#!/usr/bin/env python3
"""
BTS 티켓팅 - 5계정 멀티세션 설정 모듈

5계정 최적 분배:
- 계정1-2: VIP 전용 (4세션씩)
- 계정3: VIP + R석 (4세션)
- 계정4-5: 모든 좌석 백업 (3세션씩)
- 총: 18세션

Usage:
    from multi_account_config import load_multi_account_config, AccountConfig
    
    config = load_multi_account_config()
    for account in config.accounts:
        print(f"{account.name}: {account.sessions}세션, 전략={account.strategy}")
"""

import os
from dataclasses import dataclass, field
from typing import List, Optional, Dict
from enum import Enum


class SeatStrategy(Enum):
    """좌석 선택 전략"""
    VIP_ONLY = "vip_only"      # VIP만 시도
    VIP_FIRST = "vip_first"   # VIP 먼저, 실패 시 R석
    ALL = "all"               # 모든 좌석


@dataclass
class AccountConfig:
    """개별 계정 설정"""
    index: int                   # 계정 번호 (1-5)
    user_id: str                 # 인터파크 ID
    user_pwd: str                # 인터파크 비밀번호
    birth_date: str              # 생년월일 (YYMMDD)
    sessions: int = 4            # 이 계정에 할당된 세션 수
    strategy: SeatStrategy = SeatStrategy.VIP_ONLY
    name: str = ""               # 별칭
    
    def __post_init__(self):
        if not self.name:
            self.name = f"Account{self.index}"
    
    @property
    def is_valid(self) -> bool:
        """필수 정보 검증"""
        return bool(self.user_id and self.user_pwd)


@dataclass
class ProxyConfig:
    """프록시 설정"""
    host: str = ""
    port: int = 12321
    username: str = ""
    password: str = ""
    
    @property
    def is_valid(self) -> bool:
        return bool(self.host and self.username and self.password)
    
    @property
    def url(self) -> str:
        """프록시 URL 형식"""
        if not self.is_valid:
            return ""
        return f"http://{self.username}:{self.password}@{self.host}:{self.port}"
    
    @property
    def playwright_format(self) -> Optional[dict]:
        """Playwright/SeleniumBase 프록시 형식"""
        if not self.is_valid:
            return None
        return {
            'server': f"http://{self.host}:{self.port}",
            'username': self.username,
            'password': self.password
        }
    
    def with_session(self, session_id: int, sticky: bool = True) -> 'ProxyConfig':
        """세션별 Sticky IP를 위한 프록시 설정 생성
        
        IPRoyal Sticky 세션:
        - username에 -session-XXX 추가
        - 30분간 같은 IP 유지
        """
        if not sticky:
            return self
        
        # IPRoyal 형식: username_session-XXX
        session_username = f"{self.username}_session-bts{session_id:02d}"
        
        return ProxyConfig(
            host=self.host,
            port=self.port,
            username=session_username,
            password=self.password
        )


@dataclass
class MultiAccountConfig:
    """5계정 멀티세션 전체 설정"""
    accounts: List[AccountConfig] = field(default_factory=list)
    proxy: ProxyConfig = field(default_factory=ProxyConfig)
    concert_url: str = ""
    capsolver_key: str = ""
    total_sessions: int = 18
    open_hour: int = 20
    open_minute: int = 0
    headless: bool = False
    debug: bool = False
    
    @property
    def is_valid(self) -> bool:
        """설정 유효성 검사"""
        if not self.concert_url or 'XXXXXXX' in self.concert_url:
            return False
        if not any(a.is_valid for a in self.accounts):
            return False
        return True
    
    def get_sessions_for_account(self, account_index: int) -> List[int]:
        """특정 계정에 할당된 세션 ID 목록"""
        session_ids = []
        current_id = 0
        
        for acc in self.accounts:
            if acc.index == account_index:
                session_ids = list(range(current_id, current_id + acc.sessions))
                break
            current_id += acc.sessions
        
        return session_ids
    
    def get_account_for_session(self, session_id: int) -> Optional[AccountConfig]:
        """세션 ID로 계정 찾기"""
        current_id = 0
        for acc in self.accounts:
            if current_id <= session_id < current_id + acc.sessions:
                return acc
            current_id += acc.sessions
        return None
    
    def summary(self) -> str:
        """설정 요약"""
        lines = [
            "=" * 50,
            "🎫 BTS 티켓팅 5계정 멀티세션 설정",
            "=" * 50,
            f"📍 공연 URL: {self.concert_url[:50]}...",
            f"🔐 CapSolver: {'✅ 설정됨' if self.capsolver_key else '❌ 미설정'}",
            f"🌐 프록시: {'✅ ' + self.proxy.host if self.proxy.is_valid else '❌ 미설정'}",
            f"⏰ 오픈 시간: {self.open_hour:02d}:{self.open_minute:02d}",
            f"📊 총 세션: {self.total_sessions}개",
            "",
            "👥 계정별 분배:",
        ]
        
        for acc in self.accounts:
            status = "✅" if acc.is_valid else "❌"
            lines.append(
                f"  {status} {acc.name}: {acc.sessions}세션, "
                f"전략={acc.strategy.value}, ID={acc.user_id[:10]}..."
            )
        
        lines.append("=" * 50)
        return "\n".join(lines)


def load_multi_account_config(env_file: str = '.env.local') -> MultiAccountConfig:
    """환경 변수에서 5계정 설정 로드"""
    
    # .env.local 로드
    if os.path.exists(env_file):
        with open(env_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip().strip('"\'')
    
    # 계정 로드 (1-5)
    accounts = []
    sessions_per_account = os.getenv('SESSIONS_PER_ACCOUNT', '4,4,4,3,3').split(',')
    
    for i in range(1, 6):
        user_id = os.getenv(f'INTERPARK_ID_{i}', os.getenv('INTERPARK_ID', ''))
        user_pwd = os.getenv(f'INTERPARK_PWD_{i}', os.getenv('INTERPARK_PWD', ''))
        birth_date = os.getenv(f'BIRTH_DATE_{i}', os.getenv('BIRTH_DATE', ''))
        
        # 전략 파싱
        strategy_str = os.getenv(f'SEAT_STRATEGY_{i}', 'vip_only').lower()
        strategy = {
            'vip_only': SeatStrategy.VIP_ONLY,
            'vip_first': SeatStrategy.VIP_FIRST,
            'all': SeatStrategy.ALL,
        }.get(strategy_str, SeatStrategy.VIP_ONLY)
        
        # 세션 수
        sessions = int(sessions_per_account[i-1]) if i <= len(sessions_per_account) else 3
        
        accounts.append(AccountConfig(
            index=i,
            user_id=user_id,
            user_pwd=user_pwd,
            birth_date=birth_date,
            sessions=sessions,
            strategy=strategy,
            name=f"계정{i}",
        ))
    
    # 프록시 로드
    proxy = ProxyConfig(
        host=os.getenv('PROXY_HOST', 'geo.iproyal.com'),
        port=int(os.getenv('PROXY_PORT', '12321')),
        username=os.getenv('PROXY_USER', ''),
        password=os.getenv('PROXY_PASS', ''),
    )
    
    # 전체 설정
    config = MultiAccountConfig(
        accounts=accounts,
        proxy=proxy,
        concert_url=os.getenv('CONCERT_URL', ''),
        capsolver_key=os.getenv('CAPSOLVER_API_KEY', ''),
        total_sessions=int(os.getenv('NUM_SESSIONS', '18')),
        open_hour=int(os.getenv('OPEN_HOUR', '20')),
        open_minute=int(os.getenv('OPEN_MINUTE', '0')),
        headless=os.getenv('HEADLESS', 'false').lower() == 'true',
        debug=os.getenv('DEBUG', 'false').lower() == 'true',
    )
    
    return config


def validate_config(config: MultiAccountConfig) -> List[str]:
    """설정 검증, 에러 목록 반환"""
    errors = []
    
    # 필수 설정
    if not config.concert_url:
        errors.append("❌ CONCERT_URL이 설정되지 않음")
    elif 'XXXXXXX' in config.concert_url:
        errors.append("❌ CONCERT_URL에 실제 공연 URL을 설정하세요")
    
    # 계정 검증
    valid_accounts = [a for a in config.accounts if a.is_valid]
    if not valid_accounts:
        errors.append("❌ 유효한 계정이 없습니다")
    elif len(valid_accounts) < 3:
        errors.append(f"⚠️ 계정이 {len(valid_accounts)}개뿐입니다 (권장: 5개)")
    
    # 세션 수 검증
    total_sessions = sum(a.sessions for a in config.accounts if a.is_valid)
    if total_sessions != config.total_sessions:
        errors.append(
            f"⚠️ 세션 수 불일치: "
            f"계정 합계={total_sessions}, 설정={config.total_sessions}"
        )
    
    # 프록시 검증
    if not config.proxy.is_valid:
        errors.append("⚠️ 프록시가 설정되지 않음 (봇 탐지 위험 증가)")
    
    # CapSolver 검증
    if not config.capsolver_key:
        errors.append("⚠️ CAPSOLVER_API_KEY가 설정되지 않음 (캡차 수동 해결 필요)")
    
    return errors


# ============ 테스트 ============

if __name__ == '__main__':
    # 설정 로드
    config = load_multi_account_config()
    
    # 요약 출력
    print(config.summary())
    
    # 검증
    errors = validate_config(config)
    if errors:
        print("\n⚠️ 설정 검증 결과:")
        for err in errors:
            print(f"  {err}")
    else:
        print("\n✅ 설정 검증 통과!")
    
    # 세션-계정 매핑 테스트
    print("\n📋 세션-계정 매핑:")
    for sid in range(config.total_sessions):
        acc = config.get_account_for_session(sid)
        if acc:
            print(f"  세션 {sid:2d} → {acc.name} ({acc.strategy.value})")
