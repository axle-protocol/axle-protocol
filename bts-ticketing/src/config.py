#!/usr/bin/env python3
"""
BTS 티켓팅 매크로 - 설정 파일
환경 변수 또는 직접 설정 가능
"""

import os
from datetime import datetime
from dataclasses import dataclass, field
from typing import List, Optional


@dataclass
class ProxyConfig:
    """프록시 설정 (IPRoyal 기준)
    
    공식 문서: https://iproyal.com/docs/
    형식: http://customer-USERNAME-country-kr:PASSWORD@geo.iproyal.com:12321
    """
    enabled: bool = True
    server: str = os.getenv('PROXY_SERVER', 'geo.iproyal.com:12321')
    username: str = os.getenv('PROXY_USERNAME', '')  # customer-USERNAME-country-kr
    password: str = os.getenv('PROXY_PASSWORD', '')
    max_retries: int = int(os.getenv('PROXY_MAX_RETRIES', '3'))  # 프록시 실패 시 재시도 횟수
    retry_delay: float = float(os.getenv('PROXY_RETRY_DELAY', '2.0'))  # 재시도 간격 (초)
    
    @property
    def playwright_proxy(self) -> Optional[dict]:
        """Playwright/Camoufox 프록시 형식으로 변환"""
        if not self.enabled or not self.username:
            return None
        return {
            'server': f'http://{self.server}',
            'username': self.username,
            'password': self.password
        }


@dataclass
class CaptchaSolverConfig:
    """CAPTCHA 솔버 설정
    
    지원 서비스:
    - 2captcha (권장): https://2captcha.com/api-docs/cloudflare-turnstile
    - CapSolver: https://docs.capsolver.com/
    """
    enabled: bool = True
    
    # 2captcha 설정 (Turnstile 전용, 권장)
    twocaptcha_api_key: str = os.getenv('TWOCAPTCHA_API_KEY', '')
    
    # CapSolver 설정 (이미지 CAPTCHA용)
    capsolver_api_key: str = os.getenv('CAPSOLVER_API_KEY', '')
    capsolver_api_url: str = 'https://api.capsolver.com/createTask'
    capsolver_module: str = 'common'  # 'common' or 'number'
    
    # 공통 설정
    timeout: int = 120  # API 응답 대기 타임아웃 (초)
    poll_interval: float = 5.0  # 결과 확인 간격 (초)
    manual_timeout: int = int(os.getenv('CAPTCHA_MANUAL_TIMEOUT', '120'))  # 수동 입력 대기 (초)
    manual_fallback: bool = True  # 자동 실패 시 수동 폴백 허용
    
    @property
    def api_key(self) -> str:
        """하위 호환성: 기존 코드에서 api_key로 접근"""
        return self.twocaptcha_api_key or self.capsolver_api_key


@dataclass 
class TelegramConfig:
    """텔레그램 알림 설정"""
    enabled: bool = True
    bot_token: str = os.getenv('TELEGRAM_BOT_TOKEN', '')
    chat_id: str = os.getenv('TELEGRAM_CHAT_ID', '')


@dataclass
class BrowserConfig:
    """Camoufox 브라우저 설정
    
    공식 문서: https://camoufox.com/python/usage/
    """
    headless: bool = False  # True, False, or 'virtual' (Linux Xvfb)
    humanize: float = 2.0  # 커서 움직임 최대 지속시간 (초)
    os: str = 'macos'  # 'windows', 'macos', 'linux'
    locale: str = 'ko-KR'
    window_size: tuple = (1920, 1080)
    geoip: bool = True  # 프록시 IP 기반 지오로케이션 자동 설정
    disable_coop: bool = True  # Turnstile 체크박스 클릭 허용


@dataclass
class HumanBehaviorConfig:
    """인간 행동 시뮬레이션 설정"""
    # 랜덤 딜레이 범위 (초)
    delay_min: float = 0.5
    delay_max: float = 2.0
    
    # 타이핑 속도 (초/글자)
    typing_delay_min: float = 0.05
    typing_delay_max: float = 0.15
    
    # 베지어 곡선 마우스 움직임
    mouse_steps_min: int = 20
    mouse_steps_max: int = 50
    
    # 클릭 간 최소 간격 (IP 밴 방지: 1초 5회 이상 → 밴)
    click_cooldown: float = 0.25  # 1초에 최대 4회


@dataclass
class InterparkConfig:
    """인터파크 로그인/예매 설정"""
    user_id: str = os.getenv('INTERPARK_ID', '')
    user_pwd: str = os.getenv('INTERPARK_PWD', '')
    
    # 공연 URL (TODO: 실제 URL로 교체)
    concert_url: str = 'https://tickets.interpark.com/goods/XXXXXXX'
    
    # 티켓 오픈 시간
    open_time: datetime = datetime(2026, 2, 23, 20, 0, 0)
    
    # 좌석 우선순위
    seat_priority: List[str] = field(default_factory=lambda: ['VIP', 'R석', 'S석', 'A석'])
    
    # 새로고침 간격 (초) - 너무 빠르면 차단
    refresh_interval: float = 3.0
    
    # 결제 타임아웃 (초) - 결제 완료 대기 시간
    payment_timeout: int = int(os.getenv('PAYMENT_TIMEOUT', '300'))  # 기본 5분


@dataclass
class AccountConfig:
    """계정 설정 (멀티 인스턴스용)"""
    user_id: str
    user_pwd: str
    name: str = ""  # 식별용 별칭


@dataclass
class ProxyEntry:
    """프록시 설정 항목 (멀티 인스턴스용)"""
    server: str
    username: str
    password: str
    name: str = ""  # 식별용 별칭 (예: KR-1, US-1)
    
    @property
    def playwright_proxy(self) -> dict:
        """Playwright 프록시 형식으로 변환"""
        return {
            'server': f'http://{self.server}',
            'username': self.username,
            'password': self.password
        }


@dataclass
class MultiInstanceConfig:
    """멀티 인스턴스 설정"""
    enabled: bool = False
    
    # 동시 실행 인스턴스 수
    instance_count: int = 3
    
    # 계정 목록 (인스턴스별로 할당)
    accounts: List[AccountConfig] = field(default_factory=list)
    
    # 프록시 목록 (인스턴스별로 할당, 로테이션)
    proxies: List[ProxyEntry] = field(default_factory=list)
    
    # 중앙 로그 파일
    log_file: str = 'logs/multi_runner.log'
    
    # 성공 시 다른 인스턴스 중단
    stop_on_success: bool = True
    
    # 인스턴스 시작 딜레이 (스태거링, 초)
    stagger_delay: float = 0.5
    
    # 인스턴스별 타임아웃 (초, 0=무제한)
    instance_timeout: int = 300


@dataclass
class Config:
    """전체 설정"""
    proxy: ProxyConfig = field(default_factory=ProxyConfig)
    captcha: CaptchaSolverConfig = field(default_factory=CaptchaSolverConfig)
    telegram: TelegramConfig = field(default_factory=TelegramConfig)
    browser: BrowserConfig = field(default_factory=BrowserConfig)
    human: HumanBehaviorConfig = field(default_factory=HumanBehaviorConfig)
    interpark: InterparkConfig = field(default_factory=InterparkConfig)
    multi: MultiInstanceConfig = field(default_factory=MultiInstanceConfig)
    
    # 디버그 모드
    debug: bool = os.getenv('DEBUG', 'false').lower() == 'true'
    
    # 최대 재시도 횟수
    max_retries: int = 100


# 기본 설정 인스턴스 (load_config()로 재생성 권장)
config: Config = Config()


def load_env_file(filepath: str = '.env.local') -> None:
    """로컬 환경 변수 파일 로드"""
    if os.path.exists(filepath):
        with open(filepath) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#') and '=' in line:
                    key, value = line.split('=', 1)
                    os.environ[key.strip()] = value.strip().strip('"\'')


def load_config(env_file: str = '.env.local') -> Config:
    """환경 변수 로드 후 Config 인스턴스 생성"""
    global config
    load_env_file(env_file)
    config = Config()
    return config


def validate_config(cfg: Config) -> List[str]:
    """설정 유효성 검사, 오류 목록 반환
    
    Critical 버그 수정 (C4, C5):
    - 빈 자격증명 검증
    - CONCERT_URL 플레이스홀더 검증
    """
    errors = []
    
    # C4: 빈 자격증명 검증
    if not cfg.interpark.user_id:
        errors.append("INTERPARK_ID 환경 변수 필요")
    if not cfg.interpark.user_id.strip():
        errors.append("INTERPARK_ID가 비어 있습니다")
    if not cfg.interpark.user_pwd:
        errors.append("INTERPARK_PWD 환경 변수 필요")
    if not cfg.interpark.user_pwd.strip():
        errors.append("INTERPARK_PWD가 비어 있습니다")
    
    # C5: CONCERT_URL 플레이스홀더 검증
    if 'XXXXXXX' in cfg.interpark.concert_url:
        errors.append("CONCERT_URL에 실제 공연 URL을 설정하세요 (현재: 플레이스홀더 'XXXXXXX')")
    if not cfg.interpark.concert_url.startswith('https://tickets.interpark.com/'):
        errors.append("CONCERT_URL은 'https://tickets.interpark.com/'으로 시작해야 합니다")
    
    # 기타 필수 설정
    if cfg.captcha.enabled and not cfg.captcha.api_key:
        errors.append("CAPSOLVER_API_KEY 환경 변수 필요 (또는 captcha.enabled=False)")
    if cfg.proxy.enabled and not cfg.proxy.username:
        errors.append("PROXY_USERNAME 환경 변수 필요 (또는 proxy.enabled=False)")
    if cfg.telegram.enabled and not cfg.telegram.bot_token:
        errors.append("TELEGRAM_BOT_TOKEN 환경 변수 필요 (또는 telegram.enabled=False)")
    
    return errors
