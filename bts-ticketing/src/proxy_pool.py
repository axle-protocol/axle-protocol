#!/usr/bin/env python3
"""
프록시 풀 관리 모듈 - IPRoyal 프록시 로테이션

기능:
- 프록시 리스트 로드 (파일 or 환경변수)
- 랜덤 프록시 선택
- 실패한 프록시 블랙리스트
- 프록시 헬스체크
- 자동 로테이션 (N번 요청마다)

IPRoyal 프록시 형식:
- http://username:password@host:port
- host:port:username:password
- username:password@host:port

공식 문서: https://iproyal.com/docs/
"""

import os
import random
import asyncio
import time
import secrets
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Set
from pathlib import Path
import httpx


@dataclass
class Proxy:
    """프록시 정보"""
    host: str
    port: int
    username: str = ''
    password: str = ''
    
    # IPRoyal 세션 키 (동일 IP 유지용)
    session_id: str = ''
    
    # 상태 추적
    fail_count: int = 0
    success_count: int = 0
    last_used: float = 0
    last_check: float = 0
    is_healthy: bool = True
    
    @property
    def url(self) -> str:
        """프록시 URL 생성"""
        password = self._build_password()
        if self.username and password:
            return f"http://{self.username}:{password}@{self.host}:{self.port}"
        return f"http://{self.host}:{self.port}"
    
    def _build_password(self) -> str:
        """IPRoyal 형식: 비밀번호에 세션 키 추가"""
        if not self.password:
            return ''
        if self.session_id:
            # IPRoyal 세션 형식: password_session-XXXXX
            base_pass = self.password.split('_session-')[0]  # 기존 세션 제거
            return f"{base_pass}_session-{self.session_id}"
        return self.password
    
    @property
    def playwright_format(self) -> dict:
        """Playwright/Camoufox 프록시 형식"""
        proxy_dict = {'server': f'http://{self.host}:{self.port}'}
        if self.username:
            proxy_dict['username'] = self.username
        password = self._build_password()
        if password:
            proxy_dict['password'] = password
        return proxy_dict
    
    def with_session(self, session_id: str) -> 'Proxy':
        """새 세션 ID로 프록시 복제"""
        return Proxy(
            host=self.host,
            port=self.port,
            username=self.username,
            password=self.password,
            session_id=session_id,
            fail_count=0,
            success_count=0,
            is_healthy=True,
        )
    
    def __hash__(self):
        return hash(f"{self.host}:{self.port}:{self.session_id}")
    
    def __eq__(self, other):
        if isinstance(other, Proxy):
            return (self.host == other.host and 
                    self.port == other.port and 
                    self.session_id == other.session_id)
        return False


class ProxyPool:
    """프록시 풀 관리자
    
    Usage:
        pool = ProxyPool()
        pool.load_from_file('proxies.txt')
        
        proxy = pool.get_proxy()
        # 사용 후
        pool.mark_success(proxy)  # 또는 pool.mark_failure(proxy)
    """
    
    def __init__(
        self,
        max_fails: int = 3,
        rotation_interval: int = 5,
        health_check_interval: float = 300,
        blacklist_duration: float = 600
    ):
        """
        Args:
            max_fails: 연속 실패 시 블랙리스트에 추가하는 기준
            rotation_interval: N번 요청마다 프록시 로테이션
            health_check_interval: 헬스체크 간격 (초)
            blacklist_duration: 블랙리스트 유지 시간 (초)
        """
        self.proxies: List[Proxy] = []
        self.blacklist: Set[Proxy] = set()
        self.blacklist_times: Dict[Proxy, float] = {}
        
        self.max_fails = max_fails
        self.rotation_interval = rotation_interval
        self.health_check_interval = health_check_interval
        self.blacklist_duration = blacklist_duration
        
        self._current_proxy: Optional[Proxy] = None
        self._request_count = 0
        
    def load_from_file(self, filepath: str) -> int:
        """파일에서 프록시 로드
        
        지원 형식:
        - http://username:password@host:port
        - host:port:username:password
        - host:port
        - username:password@host:port
        
        Returns:
            로드된 프록시 수
        """
        path = Path(filepath)
        if not path.exists():
            print(f"[ProxyPool] 파일 없음: {filepath}")
            return 0
        
        count = 0
        with open(path, 'r') as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                    
                proxy = self._parse_proxy(line)
                if proxy and proxy not in self.proxies:
                    self.proxies.append(proxy)
                    count += 1
        
        print(f"[ProxyPool] {count}개 프록시 로드 완료 (파일: {filepath})")
        return count
    
    def load_from_env(self, env_var: str = 'PROXY_LIST') -> int:
        """환경변수에서 프록시 로드
        
        형식: 프록시들을 쉼표(,) 또는 세미콜론(;)으로 구분
        예: "host1:port1:user:pass,host2:port2:user:pass"
        
        Returns:
            로드된 프록시 수
        """
        proxy_list = os.getenv(env_var, '')
        if not proxy_list:
            print(f"[ProxyPool] 환경변수 없음: {env_var}")
            return 0
        
        count = 0
        # 쉼표 또는 세미콜론으로 분리
        for proxy_str in proxy_list.replace(';', ',').split(','):
            proxy_str = proxy_str.strip()
            if not proxy_str:
                continue
                
            proxy = self._parse_proxy(proxy_str)
            if proxy and proxy not in self.proxies:
                self.proxies.append(proxy)
                count += 1
        
        print(f"[ProxyPool] {count}개 프록시 로드 완료 (환경변수: {env_var})")
        return count
    
    def add_proxy(
        self,
        host: str,
        port: int,
        username: str = '',
        password: str = ''
    ) -> Proxy:
        """프록시 직접 추가"""
        proxy = Proxy(host=host, port=port, username=username, password=password)
        if proxy not in self.proxies:
            self.proxies.append(proxy)
        return proxy
    
    def _parse_proxy(self, proxy_str: str) -> Optional[Proxy]:
        """프록시 문자열 파싱
        
        지원 형식:
        - http://username:password@host:port
        - host:port:username:password
        - host:port
        - username:password@host:port
        """
        try:
            proxy_str = proxy_str.strip()
            
            # http:// 제거
            if proxy_str.startswith('http://'):
                proxy_str = proxy_str[7:]
            elif proxy_str.startswith('https://'):
                proxy_str = proxy_str[8:]
            
            username, password = '', ''
            
            # @ 있으면 username:password@host:port 형식
            if '@' in proxy_str:
                auth, hostport = proxy_str.rsplit('@', 1)
                if ':' in auth:
                    username, password = auth.split(':', 1)
                host, port = hostport.rsplit(':', 1)
            else:
                # host:port 또는 host:port:username:password
                parts = proxy_str.split(':')
                if len(parts) == 2:
                    host, port = parts
                elif len(parts) == 4:
                    host, port, username, password = parts
                else:
                    return None
            
            return Proxy(
                host=host,
                port=int(port),
                username=username,
                password=password
            )
            
        except Exception as e:
            print(f"[ProxyPool] 파싱 오류: {proxy_str} - {e}")
            return None
    
    def get_proxy(self, force_rotate: bool = False) -> Optional[Proxy]:
        """사용 가능한 프록시 반환
        
        Args:
            force_rotate: 강제 로테이션 여부
            
        Returns:
            Proxy 또는 None (사용 가능한 프록시 없음)
        """
        self._cleanup_blacklist()
        
        available = [p for p in self.proxies if p not in self.blacklist and p.is_healthy]
        
        if not available:
            print("[ProxyPool] ⚠️ 사용 가능한 프록시 없음!")
            # 블랙리스트 초기화 시도
            if self.blacklist:
                print("[ProxyPool] 블랙리스트 초기화...")
                self.blacklist.clear()
                self.blacklist_times.clear()
                available = [p for p in self.proxies if p.is_healthy]
            
            if not available:
                return None
        
        self._request_count += 1
        
        # 로테이션 필요 여부 확인
        should_rotate = (
            force_rotate or
            self._current_proxy is None or
            self._current_proxy in self.blacklist or
            not self._current_proxy.is_healthy or
            self._request_count % self.rotation_interval == 0
        )
        
        if should_rotate:
            # 가장 적게 사용된 프록시 선택 (로드 밸런싱)
            # 동일 사용량이면 랜덤
            min_used = min(p.success_count + p.fail_count for p in available)
            candidates = [p for p in available if p.success_count + p.fail_count == min_used]
            self._current_proxy = random.choice(candidates)
            print(f"[ProxyPool] 프록시 로테이션: {self._current_proxy.host}:{self._current_proxy.port}")
        
        self._current_proxy.last_used = time.time()
        return self._current_proxy
    
    def mark_success(self, proxy: Proxy) -> None:
        """프록시 성공 기록"""
        proxy.success_count += 1
        proxy.fail_count = 0  # 연속 실패 카운트 리셋
        proxy.is_healthy = True
    
    def mark_failure(self, proxy: Proxy) -> None:
        """프록시 실패 기록"""
        proxy.fail_count += 1
        
        if proxy.fail_count >= self.max_fails:
            self._add_to_blacklist(proxy)
            print(f"[ProxyPool] ⚠️ 블랙리스트 추가: {proxy.host}:{proxy.port} ({proxy.fail_count}회 실패)")
    
    def _add_to_blacklist(self, proxy: Proxy) -> None:
        """프록시를 블랙리스트에 추가"""
        self.blacklist.add(proxy)
        self.blacklist_times[proxy] = time.time()
        proxy.is_healthy = False
    
    def _cleanup_blacklist(self) -> None:
        """만료된 블랙리스트 항목 제거"""
        now = time.time()
        expired = [
            p for p, t in self.blacklist_times.items()
            if now - t > self.blacklist_duration
        ]
        
        for proxy in expired:
            self.blacklist.discard(proxy)
            del self.blacklist_times[proxy]
            proxy.fail_count = 0
            proxy.is_healthy = True
            print(f"[ProxyPool] ✅ 블랙리스트 해제: {proxy.host}:{proxy.port}")
    
    async def health_check(self, proxy: Proxy, timeout: float = 10) -> bool:
        """프록시 헬스체크
        
        Args:
            proxy: 체크할 프록시
            timeout: 타임아웃 (초)
            
        Returns:
            True if healthy
        """
        test_url = "https://httpbin.org/ip"
        
        try:
            async with httpx.AsyncClient(
                proxies={"all://": proxy.url},
                timeout=timeout
            ) as client:
                response = await client.get(test_url)
                
                if response.status_code == 200:
                    proxy.last_check = time.time()
                    proxy.is_healthy = True
                    return True
                    
        except Exception as e:
            print(f"[ProxyPool] 헬스체크 실패: {proxy.host}:{proxy.port} - {e}")
        
        proxy.is_healthy = False
        return False
    
    async def health_check_all(self, timeout: float = 10) -> Dict[str, int]:
        """모든 프록시 헬스체크
        
        Returns:
            {'healthy': N, 'unhealthy': M}
        """
        print(f"[ProxyPool] {len(self.proxies)}개 프록시 헬스체크 시작...")
        
        tasks = [self.health_check(p, timeout) for p in self.proxies]
        results = await asyncio.gather(*tasks)
        
        healthy = sum(1 for r in results if r)
        unhealthy = len(results) - healthy
        
        print(f"[ProxyPool] 헬스체크 완료: ✅ {healthy}개 / ❌ {unhealthy}개")
        return {'healthy': healthy, 'unhealthy': unhealthy}
    
    def get_stats(self) -> dict:
        """프록시 풀 통계"""
        total = len(self.proxies)
        healthy = sum(1 for p in self.proxies if p.is_healthy and p not in self.blacklist)
        blacklisted = len(self.blacklist)
        
        return {
            'total': total,
            'healthy': healthy,
            'blacklisted': blacklisted,
            'current': self._current_proxy.host if self._current_proxy else None,
            'request_count': self._request_count
        }
    
    def __len__(self) -> int:
        return len(self.proxies)
    
    def __repr__(self) -> str:
        stats = self.get_stats()
        return f"ProxyPool(total={stats['total']}, healthy={stats['healthy']}, blacklisted={stats['blacklisted']})"


# 글로벌 프록시 풀 인스턴스
proxy_pool = ProxyPool()


def create_iproyal_proxy(
    username: str,
    password: str,
    country: str = 'kr',
    session_id: str = None,
    host: str = 'geo.iproyal.com',
    port: int = 12321
) -> Proxy:
    """IPRoyal 프록시 생성 헬퍼
    
    Args:
        username: IPRoyal 사용자명
        password: IPRoyal 비밀번호
        country: 국가 코드 (kr, us, jp 등)
        session_id: 세션 ID (동일 IP 유지용, None이면 랜덤 생성)
        host: 프록시 호스트
        port: 프록시 포트
        
    Returns:
        Proxy 객체
        
    Example:
        >>> proxy = create_iproyal_proxy(
        ...     username='myuser',
        ...     password='mypass',
        ...     country='kr',
        ...     session_id='session123'
        ... )
        >>> print(proxy.url)
        http://myuser:mypass_country-kr_session-session123@geo.iproyal.com:12321
    """
    import secrets
    
    # 세션 ID 생성
    if session_id is None:
        session_id = secrets.token_hex(8)
    
    # 비밀번호에 국가 코드 추가 (아직 없으면)
    if f'_country-{country}' not in password:
        password = f'{password}_country-{country}'
    
    return Proxy(
        host=host,
        port=port,
        username=username,
        password=password,
        session_id=session_id,
    )


def create_iproyal_pool(
    username: str,
    password: str,
    country: str = 'kr',
    num_sessions: int = 10,
    host: str = 'geo.iproyal.com',
    port: int = 12321
) -> ProxyPool:
    """IPRoyal 프록시 풀 생성 (멀티세션용)
    
    각 세션마다 고유한 세션 ID를 가진 프록시 생성
    
    Args:
        username: IPRoyal 사용자명
        password: IPRoyal 비밀번호 (country 포함 가능)
        country: 국가 코드
        num_sessions: 세션 수
        host: 프록시 호스트
        port: 프록시 포트
        
    Returns:
        ProxyPool with N proxies
    """
    pool = ProxyPool()
    
    for i in range(num_sessions):
        session_id = f's{i:02d}_{secrets.token_hex(4)}'
        proxy = create_iproyal_proxy(
            username=username,
            password=password,
            country=country,
            session_id=session_id,
            host=host,
            port=port,
        )
        pool.proxies.append(proxy)
    
    print(f"[ProxyPool] IPRoyal 프록시 풀 생성: {num_sessions}개 세션")
    return pool


# 환경변수에서 IPRoyal 프록시 로드
def load_iproyal_from_env(num_sessions: int = 10) -> Optional[ProxyPool]:
    """환경변수에서 IPRoyal 프록시 로드
    
    필요한 환경변수:
    - PROXY_HOST (기본: geo.iproyal.com)
    - PROXY_PORT (기본: 12321)
    - PROXY_USER
    - PROXY_PASS
    """
    import secrets
    
    host = os.getenv('PROXY_HOST', 'geo.iproyal.com')
    port = int(os.getenv('PROXY_PORT', '12321'))
    username = os.getenv('PROXY_USER', '')
    password = os.getenv('PROXY_PASS', '')
    
    if not username or not password:
        print("[ProxyPool] ⚠️ PROXY_USER, PROXY_PASS 환경변수 필요")
        return None
    
    return create_iproyal_pool(
        username=username,
        password=password,
        num_sessions=num_sessions,
        host=host,
        port=port,
    )


def init_proxy_pool(
    proxy_file: str = None,
    env_var: str = 'PROXY_LIST',
    **kwargs
) -> ProxyPool:
    """프록시 풀 초기화 헬퍼
    
    Args:
        proxy_file: 프록시 파일 경로 (예: 'proxies.txt')
        env_var: 환경변수 이름
        **kwargs: ProxyPool 생성자 인자
        
    Returns:
        초기화된 ProxyPool
    """
    global proxy_pool
    proxy_pool = ProxyPool(**kwargs)
    
    loaded = 0
    
    # 파일에서 로드
    if proxy_file:
        loaded += proxy_pool.load_from_file(proxy_file)
    
    # 환경변수에서 로드
    loaded += proxy_pool.load_from_env(env_var)
    
    if loaded == 0:
        print("[ProxyPool] ⚠️ 프록시가 로드되지 않았습니다!")
    
    return proxy_pool


# 편의 함수들
def get_proxy(force_rotate: bool = False) -> Optional[Proxy]:
    """현재 프록시 풀에서 프록시 가져오기"""
    return proxy_pool.get_proxy(force_rotate)


def mark_success(proxy: Proxy) -> None:
    """프록시 성공 표시"""
    proxy_pool.mark_success(proxy)


def mark_failure(proxy: Proxy) -> None:
    """프록시 실패 표시"""
    proxy_pool.mark_failure(proxy)


async def check_all_proxies() -> Dict[str, int]:
    """모든 프록시 헬스체크"""
    return await proxy_pool.health_check_all()


if __name__ == '__main__':
    # 테스트
    import asyncio
    
    async def test():
        pool = init_proxy_pool(
            proxy_file='../proxies.txt',
            max_fails=3,
            rotation_interval=3
        )
        
        print(f"\n{pool}")
        
        if len(pool) > 0:
            print("\n헬스체크 실행...")
            await pool.health_check_all()
            
            print("\n프록시 로테이션 테스트:")
            for i in range(10):
                proxy = pool.get_proxy()
                if proxy:
                    print(f"  [{i+1}] {proxy.host}:{proxy.port}")
                    pool.mark_success(proxy)
    
    asyncio.run(test())
