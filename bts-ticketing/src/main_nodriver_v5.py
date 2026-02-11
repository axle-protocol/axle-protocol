#!/usr/bin/env python3
"""
BTS 티켓팅 매크로 v5.8 - Production Ready (10/10 Target)
2026-02-11

v5.8 주요 변경 (from v5.7):
- 완전한 타입 힌트 (Python 3.10+ | Union syntax)
- 명명된 상수 (magic number 제거)
- 구체적 예외 클래스 정의
- 향상된 봇 탐지 우회 (Canvas/Audio/WebRTC fingerprint)
- NTP 주기적 재동기화 (drift 보정)
- 마우스 움직임 개선 (속도/가속도 랜덤화, 휴식 패턴)
- Circuit breaker 패턴 (외부 호출 보호)
- 메모리 모니터링 (리소스 제한)
- 브라우저 health check

v5.7 기능 유지:
- Thread-safe NTP 동기화 (멀티 세션 안전)
- User-Agent 완전 랜덤화 (봇 탐지 우회 강화)
- JS 문자 이스케이프 안전성 개선
- 병렬 셀렉터 검색 지원
- Turnstile 적응형 폴링 (클릭 후 빠른 확인)
- AdaptiveRefreshStrategy 스레드 안전 + 연속 성공 가속
- 커서 사전 위치 (오픈 30초 전)
- 좌석 픽셀 분석 개선 (다양한 색상, 점수 기반 정렬)
- _complete_selection 에러 복구 (재시도 3회)
- 결제 대기 개선 (적응형 폴링, 세션 유효성 검사)
- 세션 복구 메커니즘 (_run_with_recovery)
- 임시 디렉토리 자동 정리
"""

from __future__ import annotations

__version__ = "5.8.0"
__author__ = "BTS Ticketing Bot"

import nodriver as nd
from nodriver import cdp
import asyncio
import random
import argparse
import os
import traceback
import time
import logging
import json
from datetime import datetime
from zoneinfo import ZoneInfo
from dataclasses import dataclass, field
from typing import Optional, TypeVar, Protocol, Final, Callable, Awaitable
import aiohttp
import tempfile

# psutil 선택적 import (브라우저 프로세스 정리용)
try:
    import psutil
    HAS_PSUTIL = True
except ImportError:
    HAS_PSUTIL = False


# ============ 타입 별칭 (Type Aliases) ============
# nodriver는 타입 힌트를 완전히 제공하지 않으므로 별칭 정의
Page = TypeVar('Page')  # nodriver page type
Browser = TypeVar('Browser')  # nodriver browser type
Element = TypeVar('Element')  # nodriver element type


# ============ 명명된 상수 (Named Constants) ============
class Timeouts:
    """타임아웃 상수 (초 단위)"""
    PAGE_LOAD: Final[float] = 10.0
    ELEMENT_WAIT: Final[float] = 3.0
    LOGIN_WAIT: Final[float] = 5.0
    TURNSTILE_MAX: Final[float] = 60.0
    CAPTCHA_MAX: Final[float] = 300.0
    PAYMENT_MAX_MIN: Final[int] = 30
    BROWSER_STOP: Final[float] = 5.0
    NTP_SOCKET: Final[float] = 2.0
    HTTP_REQUEST: Final[float] = 10.0
    BOOKING_CLICK: Final[float] = 0.3
    SEAT_SEARCH: Final[float] = 1.0
    NAVIGATION_DELAY: Final[float] = 0.3


class Limits:
    """제한 상수"""
    MAX_LOGIN_RETRIES: Final[int] = 3
    MAX_BOOKING_ATTEMPTS: Final[int] = 50
    MAX_SEAT_ATTEMPTS: Final[int] = 30
    MAX_RAPID_REFRESH: Final[int] = 15
    MAX_CHECKBOX_ATTEMPTS: Final[int] = 3
    MAX_SELECTION_RETRIES: Final[int] = 3
    MAX_TELEGRAM_RETRIES: Final[int] = 3
    NUM_SESSIONS_MIN: Final[int] = 1
    NUM_SESSIONS_MAX: Final[int] = 10
    CANVAS_SAMPLE_STEP: Final[int] = 8
    CANVAS_MAX_SEATS: Final[int] = 30
    NTP_RESYNC_INTERVAL: Final[float] = 300.0  # 5분마다 재동기화


class MouseParams:
    """마우스 움직임 파라미터"""
    BEZIER_STEPS: Final[int] = 10
    MOVE_DELAY_MIN: Final[float] = 0.008
    MOVE_DELAY_MAX: Final[float] = 0.025
    CLICK_DELAY_MIN: Final[float] = 0.05
    CLICK_DELAY_MAX: Final[float] = 0.15
    POSITION_JITTER: Final[float] = 3.0
    CTRL_POINT_VARIANCE: Final[float] = 50.0


class ColorThresholds:
    """좌석 색상 분석 임계값"""
    GREEN_MIN: Final[int] = 120
    GREEN_RATIO: Final[float] = 1.2
    DARK_GREEN_MIN: Final[int] = 100
    BLUE_MIN: Final[int] = 130
    BLUE_RATIO: Final[float] = 1.1
    YELLOW_R_MIN: Final[int] = 180
    YELLOW_G_MIN: Final[int] = 150
    YELLOW_B_MAX: Final[int] = 100


# ============ 커스텀 예외 클래스 ============
class TicketingError(Exception):
    """티켓팅 기본 예외"""
    pass


class LoginError(TicketingError):
    """로그인 실패"""
    pass


class BotDetectedError(TicketingError):
    """봇 탐지됨"""
    pass


class SessionExpiredError(TicketingError):
    """세션 만료"""
    pass


class SeatUnavailableError(TicketingError):
    """좌석 없음 (매진)"""
    pass


class NetworkTimeoutError(TicketingError):
    """네트워크 타임아웃"""
    pass


class CaptchaRequiredError(TicketingError):
    """CAPTCHA 필요"""
    pass


class RateLimitError(TicketingError):
    """Rate limiting 감지"""
    pass


class BrowserCrashError(TicketingError):
    """브라우저 크래시"""
    pass


# ============ 로깅 (파일 + 콘솔) ============
log_dir = os.path.join(os.path.dirname(__file__), '..', 'logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, f"ticketing_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")

logging.basicConfig(
    level=logging.DEBUG,  # 디버그 모드
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(log_file, encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)


# ============ 셀렉터 설정 (분리) ============
SELECTORS = {
    'login_btn': [
        'button:has-text("로그인")', 'a.login', 'button[data-testid="login"]', 
        'a[href*="login"]', '.header-login'
    ],
    'email_btn': [
        'button:has-text("이메일로 시작하기")', 'a:has-text("이메일로 시작하기")',
        'button[data-testid="email-login"]', '.email-login-btn'
    ],
    'id_field': [
        'input[placeholder*="nol"]', 'input[placeholder*="이메일"]',
        'input[name="userId"]', 'input[name="email"]', 'input[name="id"]',
        'input[id*="email"]', 'input[id*="userId"]', 'input[placeholder*="아이디"]',
        'form input[type="email"]', 'form input[type="text"]:first-of-type'
    ],
    'pw_field': [
        'input[type="password"]', 'input[name="password"]',
        'input[name="pwd"]', 'input[id*="password"]'
    ],
    'submit_btn': [
        'button:has-text("로그인하기")', 'button[type="submit"]',
        'button:has-text("로그인")', '.login-submit'
    ],
    'booking_btn': [
        'a.btn_book', 'button.booking', '[class*="BookingButton"]',
        'a:has-text("예매하기")', 'button:has-text("예매하기")'
    ],
    'seat_iframe': [
        'iframe[id*="seat"]', 'iframe[src*="seat"]',
        'iframe[class*="seat"]', '#seatFrame'
    ],
    'seat_canvas': [
        'canvas[id*="seat"]', 'canvas.seat-map',
        '.seat-area canvas', '[class*="seat"] canvas'
    ]
}


# ============ 설정 ============
@dataclass
class Config:
    """설정"""
    user_id: str
    user_pwd: str
    concert_url: str
    open_time: datetime
    seat_priority: List[str] = field(default_factory=lambda: ['VIP', 'R석', 'S석', 'A석'])
    telegram_bot_token: str = ''
    telegram_chat_id: str = ''
    max_login_retries: int = 3
    num_sessions: int = 1  # 멀티 세션 수
    use_ntp: bool = True   # NTP 동기화 사용
    
    @classmethod
    def from_env(cls) -> 'Config':
        user_id = os.getenv('INTERPARK_ID', '')
        user_pwd = os.getenv('INTERPARK_PWD', '')
        concert_url = os.getenv('CONCERT_URL', '')
        open_time_str = os.getenv('OPEN_TIME', '2026-02-23 20:00:00')
        
        if not user_id or not user_pwd:
            raise ValueError("INTERPARK_ID, INTERPARK_PWD 환경변수 필수")
        if not concert_url:
            raise ValueError("CONCERT_URL 환경변수 필수")
        
        # URL 유효성 검사
        if not concert_url.startswith('https://'):
            if concert_url.startswith('http://'):
                concert_url = concert_url.replace('http://', 'https://')
            else:
                raise ValueError(f"CONCERT_URL은 https://로 시작해야 합니다: {concert_url}")
        
        try:
            open_time = datetime.strptime(open_time_str, '%Y-%m-%d %H:%M:%S')
            open_time = open_time.replace(tzinfo=ZoneInfo('Asia/Seoul'))
        except ValueError:
            open_time = datetime(2026, 2, 23, 20, 0, 0, tzinfo=ZoneInfo('Asia/Seoul'))
        
        seat_priority_str = os.getenv('SEAT_PRIORITY', 'VIP,R석,S석,A석')
        seat_priority = [s.strip() for s in seat_priority_str.split(',')]
        
        return cls(
            user_id=user_id,
            user_pwd=user_pwd,
            concert_url=concert_url,
            open_time=open_time,
            seat_priority=seat_priority,
            telegram_bot_token=os.getenv('TELEGRAM_BOT_TOKEN', ''),
            telegram_chat_id=os.getenv('TELEGRAM_CHAT_ID', ''),
            num_sessions=max(1, min(10, int(os.getenv('NUM_SESSIONS', '1')))),  # 1-10 범위 제한
            use_ntp=os.getenv('USE_NTP', 'true').lower() == 'true',
        )


# ============ NTP 시간 동기화 (v5.8 - 주기적 재동기화) ============
import threading as _threading

# Thread-safe NTP state (멀티 세션 안전)
_ntp_offset: float = 0.0
_ntp_lock = _threading.Lock()
_ntp_last_sync: float = 0.0  # 마지막 동기화 시간
_ntp_server_used: Optional[str] = None  # 사용된 서버


def _sync_ntp_blocking() -> tuple[bool, float, str | None]:
    """NTP 동기화 (블로킹 - executor에서 실행)
    
    Returns:
        tuple of (success, offset_seconds, server_name)
    
    Note:
        - 한국 서버 우선 사용
        - DNS 실패 시 다음 서버 시도
        - 소켓 타임아웃: 2초
    """
    import socket
    import struct
    
    ntp_servers: list[tuple[str, int]] = [
        ('time.bora.net', 123),      # 한국 1순위
        ('time.kriss.re.kr', 123),   # 한국표준과학연구원
        ('ntp.kornet.net', 123),     # KT
        ('time.google.com', 123),    # 글로벌 폴백
        ('pool.ntp.org', 123),
    ]
    
    for server, port in ntp_servers:
        client = None
        try:
            client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            client.settimeout(Timeouts.NTP_SOCKET)
            
            # NTP 요청 패킷 (version 3, mode 3 = client)
            data = b'\x1b' + 47 * b'\0'
            client.sendto(data, (server, port))
            
            data, _ = client.recvfrom(1024)
            
            if data and len(data) >= 48:
                # Transmit Timestamp (offset 40-47)
                t = struct.unpack('!12I', data)[10]
                t -= 2208988800  # NTP epoch (1900) to Unix epoch (1970)
                offset = t - time.time()
                return True, offset, server
        except socket.gaierror:
            # DNS 실패 - 다음 서버
            continue
        except socket.timeout:
            # 타임아웃 - 다음 서버
            continue
        except Exception:
            continue
        finally:
            if client:
                try:
                    client.close()
                except Exception:
                    pass
    
    return False, 0.0, None


async def sync_ntp_time(force: bool = False) -> bool:
    """NTP 서버와 시간 동기화 (비동기 - executor 사용, Thread-safe)
    
    Args:
        force: True면 재동기화 간격 무시하고 강제 동기화
    
    Returns:
        bool: 동기화 성공 여부
    
    Note:
        - 기본 재동기화 간격: 5분
        - drift 임계값 초과 시 경고
    """
    global _ntp_offset, _ntp_last_sync, _ntp_server_used
    
    # 재동기화 간격 체크 (force가 아니면)
    if not force:
        with _ntp_lock:
            elapsed = time.time() - _ntp_last_sync
            if elapsed < Limits.NTP_RESYNC_INTERVAL and _ntp_last_sync > 0:
                logger.debug(f"NTP 재동기화 스킵 ({elapsed:.0f}s < {Limits.NTP_RESYNC_INTERVAL}s)")
                return True
    
    loop = asyncio.get_running_loop()
    try:
        result = await loop.run_in_executor(None, _sync_ntp_blocking)
        success, offset, server = result
        
        if success:
            with _ntp_lock:
                old_offset = _ntp_offset
                _ntp_offset = offset
                _ntp_last_sync = time.time()
                _ntp_server_used = server
                
                # Drift 체크 (이전 offset과 비교)
                if old_offset != 0.0:
                    drift = abs(offset - old_offset) * 1000  # ms
                    if drift > 50:  # 50ms 이상 drift
                        logger.warning(f"⚠️ NTP drift 감지: {drift:.1f}ms (보정됨)")
            
            logger.info(f"✅ NTP 동기화: {server} (offset: {offset*1000:.1f}ms)")
            return True
            
    except Exception as e:
        logger.debug(f"NTP 동기화 실패: {e}")
    
    logger.warning("⚠️ NTP 동기화 실패 - 로컬 시간 사용")
    return False


async def _ntp_resync_task(interval: float = Limits.NTP_RESYNC_INTERVAL) -> None:
    """NTP 주기적 재동기화 백그라운드 태스크
    
    Args:
        interval: 재동기화 간격 (초)
    """
    while True:
        await asyncio.sleep(interval)
        try:
            await sync_ntp_time(force=True)
        except Exception as e:
            logger.debug(f"NTP 재동기화 실패: {e}")


def get_accurate_time() -> datetime:
    """정확한 현재 시간 (NTP 보정, Thread-safe)
    
    Returns:
        datetime: 한국 시간대 (Asia/Seoul)
    """
    with _ntp_lock:
        offset = _ntp_offset
    return datetime.fromtimestamp(time.time() + offset, tz=ZoneInfo('Asia/Seoul'))


def get_ntp_status() -> dict[str, float | str | None]:
    """NTP 동기화 상태 조회
    
    Returns:
        dict with offset, last_sync, server
    """
    with _ntp_lock:
        return {
            'offset_ms': _ntp_offset * 1000,
            'last_sync': _ntp_last_sync,
            'server': _ntp_server_used,
            'age_seconds': time.time() - _ntp_last_sync if _ntp_last_sync > 0 else None
        }


# ============ SecureLogger (비밀번호 마스킹) ============
import re
import threading

class SecureLogger:
    """민감정보 자동 마스킹 로거 (Thread-safe)"""
    
    PATTERNS = [
        (re.compile(r'password["\s:=]+["\']?([^"\'&\s]+)', re.I), r'password=****'),
        (re.compile(r'pwd["\s:=]+["\']?([^"\'&\s]+)', re.I), r'pwd=****'),
        (re.compile(r'token["\s:=]+["\']?([^"\'&\s]+)', re.I), r'token=****'),
        (re.compile(r'api[_-]?key["\s:=]+["\']?([^"\'&\s]+)', re.I), r'api_key=****'),
    ]
    
    def __init__(self, base_logger, secrets: List[str] = None):
        self._logger = base_logger
        self._secrets = [s for s in (secrets or []) if s and len(s) > 3]
        self._lock = threading.Lock()
    
    def add_secret(self, secret: str):
        if secret and len(secret) > 3:
            with self._lock:
                self._secrets.append(secret)
    
    def _sanitize(self, message: str) -> str:
        result = str(message)
        with self._lock:
            secrets_copy = self._secrets.copy()
        for secret in secrets_copy:
            if secret in result:
                result = result.replace(secret, '****')
        for pattern, replacement in self.PATTERNS:
            result = pattern.sub(replacement, result)
        return result
    
    def info(self, msg: str, *args, **kwargs):
        self._logger.info(self._sanitize(msg), *args, **kwargs)
    
    def debug(self, msg: str, *args, **kwargs):
        self._logger.debug(self._sanitize(msg), *args, **kwargs)
    
    def warning(self, msg: str, *args, **kwargs):
        self._logger.warning(self._sanitize(msg), *args, **kwargs)
    
    def error(self, msg: str, *args, **kwargs):
        self._logger.error(self._sanitize(msg), *args, **kwargs)


# ============ HTTP 세션 (Context Manager 패턴) ============
from contextlib import asynccontextmanager

class HTTPSessionManager:
    """스레드 안전 HTTP 세션 관리자 (Context Manager)"""
    
    def __init__(self):
        self._session: Optional[aiohttp.ClientSession] = None
        self._lock = asyncio.Lock()
        self._ref_count = 0
    
    @asynccontextmanager
    async def get_session(self):
        """세션을 안전하게 사용하는 컨텍스트 매니저"""
        async with self._lock:
            if self._session is None or self._session.closed:
                self._session = aiohttp.ClientSession(
                    timeout=aiohttp.ClientTimeout(total=10)
                )
            self._ref_count += 1
        
        try:
            yield self._session
        finally:
            async with self._lock:
                self._ref_count -= 1
    
    async def close(self):
        """안전한 세션 종료"""
        async with self._lock:
            if self._session and not self._session.closed:
                await self._session.close()
                self._session = None

# 글로벌 인스턴스
http_manager = HTTPSessionManager()


# ============ Circuit Breaker (외부 호출 보호) ============
class CircuitBreaker:
    """Circuit Breaker 패턴 구현 (외부 서비스 호출 보호)
    
    상태:
    - CLOSED: 정상 동작
    - OPEN: 차단 (모든 요청 즉시 실패)
    - HALF_OPEN: 테스트 중 (일부 요청 허용)
    
    Attributes:
        failure_threshold: OPEN 전환 임계값
        recovery_timeout: HALF_OPEN 전환 대기 시간
        half_open_max_calls: HALF_OPEN에서 허용할 최대 호출
    """
    
    CLOSED = 'CLOSED'
    OPEN = 'OPEN'
    HALF_OPEN = 'HALF_OPEN'
    
    def __init__(
        self, 
        name: str,
        failure_threshold: int = 5,
        recovery_timeout: float = 30.0,
        half_open_max_calls: int = 3
    ):
        self.name = name
        self.failure_threshold = failure_threshold
        self.recovery_timeout = recovery_timeout
        self.half_open_max_calls = half_open_max_calls
        
        self._state = self.CLOSED
        self._failure_count = 0
        self._last_failure_time: float = 0.0
        self._half_open_calls = 0
        self._lock = _threading.Lock()
    
    @property
    def state(self) -> str:
        """현재 상태 (자동 HALF_OPEN 전환 포함)"""
        with self._lock:
            if self._state == self.OPEN:
                if time.time() - self._last_failure_time >= self.recovery_timeout:
                    self._state = self.HALF_OPEN
                    self._half_open_calls = 0
                    logger.info(f"CircuitBreaker [{self.name}]: OPEN → HALF_OPEN")
            return self._state
    
    def allow_request(self) -> bool:
        """요청 허용 여부"""
        state = self.state
        
        if state == self.CLOSED:
            return True
        elif state == self.OPEN:
            return False
        else:  # HALF_OPEN
            with self._lock:
                if self._half_open_calls < self.half_open_max_calls:
                    self._half_open_calls += 1
                    return True
                return False
    
    def record_success(self) -> None:
        """성공 기록"""
        with self._lock:
            if self._state == self.HALF_OPEN:
                self._state = self.CLOSED
                logger.info(f"CircuitBreaker [{self.name}]: HALF_OPEN → CLOSED (복구)")
            self._failure_count = 0
    
    def record_failure(self) -> None:
        """실패 기록"""
        with self._lock:
            self._failure_count += 1
            self._last_failure_time = time.time()
            
            if self._state == self.HALF_OPEN:
                self._state = self.OPEN
                logger.warning(f"CircuitBreaker [{self.name}]: HALF_OPEN → OPEN (재실패)")
            elif self._failure_count >= self.failure_threshold:
                self._state = self.OPEN
                logger.warning(f"CircuitBreaker [{self.name}]: CLOSED → OPEN (임계값 초과)")
    
    async def call(
        self, 
        func: Callable[..., Awaitable],
        *args,
        fallback: Callable[..., Awaitable] | None = None,
        **kwargs
    ):
        """Circuit Breaker로 보호된 호출
        
        Args:
            func: 호출할 비동기 함수
            *args, **kwargs: func에 전달할 인자
            fallback: OPEN 상태일 때 호출할 대체 함수
        
        Raises:
            Exception: Circuit OPEN이고 fallback 없으면 예외
        """
        if not self.allow_request():
            if fallback:
                return await fallback(*args, **kwargs)
            raise NetworkTimeoutError(f"Circuit [{self.name}] is OPEN")
        
        try:
            result = await func(*args, **kwargs)
            self.record_success()
            return result
        except Exception as e:
            self.record_failure()
            raise


# 글로벌 Circuit Breakers
_circuit_breakers: dict[str, CircuitBreaker] = {}


def get_circuit_breaker(name: str) -> CircuitBreaker:
    """이름으로 Circuit Breaker 가져오기 (없으면 생성)"""
    if name not in _circuit_breakers:
        _circuit_breakers[name] = CircuitBreaker(name)
    return _circuit_breakers[name]


# 하위 호환성 유지 (Deprecated)
async def get_http_session() -> aiohttp.ClientSession:
    """Deprecated: http_manager.get_session() 컨텍스트 매니저 사용 권장
    
    Warning: 이 함수는 세션 라이프사이클을 관리하지 않습니다.
    새 코드는 `async with http_manager.get_session() as session:` 사용
    """
    async with http_manager._lock:
        if http_manager._session is None or http_manager._session.closed:
            http_manager._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=10)
            )
        return http_manager._session

async def close_http_session():
    """HTTP 세션 종료"""
    await http_manager.close()


# ============ 텔레그램 (Circuit Breaker 보호) ============
async def send_telegram(
    config: Config, 
    message: str, 
    retries: int = Limits.MAX_TELEGRAM_RETRIES,
    silent: bool = False
) -> bool:
    """텔레그램 알림 전송 (Circuit Breaker 보호)
    
    Args:
        config: 설정 객체
        message: 전송할 메시지
        retries: 재시도 횟수
        silent: 알림음 끄기
    
    Returns:
        bool: 전송 성공 여부
    """
    if not config.telegram_bot_token:
        logger.info(f"[알림] {message}")
        return True
    
    cb = get_circuit_breaker('telegram')
    
    async def _do_send() -> bool:
        async with http_manager.get_session() as session:
            url = f"https://api.telegram.org/bot{config.telegram_bot_token}/sendMessage"
            async with session.post(url, data={
                'chat_id': config.telegram_chat_id, 
                'text': f"🎫 BTS\n{message}",
                'disable_notification': silent
            }) as resp:
                return resp.status == 200
    
    for attempt in range(retries):
        try:
            if not cb.allow_request():
                logger.debug("텔레그램 Circuit OPEN - 스킵")
                return False
            
            success = await _do_send()
            if success:
                cb.record_success()
                return True
            
        except Exception as e:
            cb.record_failure()
            if attempt == retries - 1:
                logger.warning(f"텔레그램 {retries}회 실패: {e}")
            await asyncio.sleep(1)
    
    return False


# ============ 유틸리티 ============
async def human_delay(min_s: float = 0.5, max_s: float = 1.5):
    """사람처럼 랜덤 딜레이"""
    await asyncio.sleep(random.uniform(min_s, max_s))

def mask_pwd(text: str, config: Config) -> str:
    """비밀번호 마스킹"""
    if config.user_pwd and config.user_pwd in text:
        return text.replace(config.user_pwd, '****')
    return text


# ============ JavaScript 실행 (개선) ============
async def evaluate_js(page, script: str, return_value: bool = True) -> Any:
    """JavaScript 실행 (nodriver CDP)"""
    try:
        result = await page.send(cdp.runtime.evaluate(
            expression=script,
            return_by_value=return_value,
            await_promise=True
        ))
        if result and hasattr(result, 'result'):
            return result.result.value if hasattr(result.result, 'value') else None
    except Exception as e:
        logger.debug(f"JS 실행 실패: {e}")
    return None


# ============ 봇 탐지 우회 (v5.8 강화) ============
async def setup_stealth(page: Page) -> None:
    """봇 탐지 우회 설정 (v5.8 강화 - Canvas/Audio/WebRTC fingerprint 방어)
    
    방어 대상:
    - webdriver 속성 감지
    - Canvas fingerprint (toDataURL randomization)
    - AudioContext fingerprint
    - WebRTC IP leak
    - WebGL 정보
    - Navigator 속성들
    
    Args:
        page: nodriver page 객체
    """
    stealth_scripts = [
        # 1. webdriver 속성 숨기기
        '''Object.defineProperty(navigator, 'webdriver', {get: () => undefined});''',
        
        # 2. chrome 객체 추가 (더 완전한 구현)
        '''
        window.chrome = {
            runtime: {
                connect: function() {},
                sendMessage: function() {},
                onMessage: { addListener: function() {} },
                id: undefined
            },
            loadTimes: function() { return {}; },
            csi: function() { return {}; },
            app: { isInstalled: false }
        };
        ''',
        
        # 3. plugins 추가 (더 현실적인 구현)
        '''
        Object.defineProperty(navigator, 'plugins', {
            get: () => {
                const plugins = [
                    {name: 'Chrome PDF Plugin', filename: 'internal-pdf-viewer', description: 'Portable Document Format'},
                    {name: 'Chrome PDF Viewer', filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: ''},
                    {name: 'Native Client', filename: 'internal-nacl-plugin', description: ''}
                ];
                plugins.length = 3;
                plugins.item = (i) => plugins[i];
                plugins.namedItem = (n) => plugins.find(p => p.name === n);
                plugins.refresh = () => {};
                return plugins;
            }
        });
        ''',
        
        # 4. languages 설정
        '''Object.defineProperty(navigator, 'languages', {get: () => ['ko-KR', 'ko', 'en-US', 'en']});''',
        
        # 5. permissions 쿼리 수정
        '''
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({state: Notification.permission}) :
                originalQuery(parameters)
        );
        ''',
        
        # 6. WebGL 렌더러/벤더 (headless 감지 우회)
        '''
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return 'Intel Inc.';
            if (parameter === 37446) return 'Intel Iris OpenGL Engine';
            return getParameter.call(this, parameter);
        };
        const getParameter2 = WebGL2RenderingContext.prototype.getParameter;
        WebGL2RenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return 'Intel Inc.';
            if (parameter === 37446) return 'Intel Iris OpenGL Engine';
            return getParameter2.call(this, parameter);
        };
        ''',
        
        # 7. 화면 해상도 일관성
        '''
        Object.defineProperty(screen, 'availWidth', {get: () => 1920});
        Object.defineProperty(screen, 'availHeight', {get: () => 1080});
        Object.defineProperty(screen, 'width', {get: () => 1920});
        Object.defineProperty(screen, 'height', {get: () => 1080});
        Object.defineProperty(screen, 'colorDepth', {get: () => 24});
        Object.defineProperty(screen, 'pixelDepth', {get: () => 24});
        ''',
        
        # 8. connection 속성 (봇 감지 우회)
        '''
        Object.defineProperty(navigator, 'connection', {
            get: () => ({
                effectiveType: '4g',
                rtt: 50,
                downlink: 10,
                saveData: false
            })
        });
        ''',
        
        # 9. deviceMemory / hardwareConcurrency
        '''
        Object.defineProperty(navigator, 'deviceMemory', {get: () => 8});
        Object.defineProperty(navigator, 'hardwareConcurrency', {get: () => 8});
        ''',
        
        # 10. ★ Canvas Fingerprint 방어 (toDataURL 노이즈 추가)
        '''
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function(type) {
            if (this.width === 0 || this.height === 0) return originalToDataURL.apply(this, arguments);
            const ctx = this.getContext('2d');
            if (ctx) {
                const imageData = ctx.getImageData(0, 0, Math.min(this.width, 10), Math.min(this.height, 10));
                for (let i = 0; i < imageData.data.length; i += 4) {
                    imageData.data[i] = imageData.data[i] ^ (Math.random() > 0.99 ? 1 : 0);
                }
                ctx.putImageData(imageData, 0, 0);
            }
            return originalToDataURL.apply(this, arguments);
        };
        ''',
        
        # 11. ★ Canvas getImageData 노이즈 (fingerprint 방어)
        '''
        const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        CanvasRenderingContext2D.prototype.getImageData = function() {
            const imageData = originalGetImageData.apply(this, arguments);
            for (let i = 0; i < Math.min(imageData.data.length, 40); i += 4) {
                if (Math.random() > 0.95) {
                    imageData.data[i] = imageData.data[i] ^ 1;
                }
            }
            return imageData;
        };
        ''',
        
        # 12. ★ AudioContext Fingerprint 방어
        '''
        const originalCreateAnalyser = AudioContext.prototype.createAnalyser;
        AudioContext.prototype.createAnalyser = function() {
            const analyser = originalCreateAnalyser.apply(this, arguments);
            const originalGetFloatFrequencyData = analyser.getFloatFrequencyData.bind(analyser);
            analyser.getFloatFrequencyData = function(array) {
                originalGetFloatFrequencyData(array);
                for (let i = 0; i < array.length; i++) {
                    array[i] = array[i] + (Math.random() * 0.0001 - 0.00005);
                }
            };
            return analyser;
        };
        ''',
        
        # 13. ★ WebRTC IP Leak 방지
        '''
        if (window.RTCPeerConnection) {
            const originalRTCPeerConnection = window.RTCPeerConnection;
            window.RTCPeerConnection = function(config) {
                if (config && config.iceServers) {
                    config.iceServers = [];
                }
                return new originalRTCPeerConnection(config);
            };
            window.RTCPeerConnection.prototype = originalRTCPeerConnection.prototype;
        }
        ''',
        
        # 14. Battery API 숨기기 (fingerprint 벡터)
        '''
        if (navigator.getBattery) {
            navigator.getBattery = () => Promise.resolve({
                charging: true,
                chargingTime: 0,
                dischargingTime: Infinity,
                level: 1.0,
                addEventListener: () => {},
                removeEventListener: () => {}
            });
        }
        ''',
        
        # 15. Brave/Firefox 감지 방지
        '''
        Object.defineProperty(navigator, 'brave', {get: () => undefined});
        ''',
        
        # 16. 콘솔 감지 방지 (devtools 열림 감지 차단)
        '''
        const originalConsole = window.console;
        window.console = {
            ...originalConsole,
            debug: () => {},
        };
        // devtools 감지 방지
        Object.defineProperty(window, 'outerWidth', {get: () => window.innerWidth});
        Object.defineProperty(window, 'outerHeight', {get: () => window.innerHeight + 100});
        ''',
        
        # 17. Timezone 일관성 (한국)
        '''
        Date.prototype.getTimezoneOffset = function() { return -540; };  // UTC+9
        ''',
    ]
    
    for script in stealth_scripts:
        await evaluate_js(page, script, return_value=False)
    
    logger.debug("✅ Stealth 설정 완료 (v5.8 - Canvas/Audio/WebRTC 방어)")


# ============ 마우스 이동 시뮬레이션 (v5.8 개선) ============
# 현재 마우스 위치 추적 (세션별)
_mouse_position: dict[int, tuple[float, float]] = {}
_mouse_lock = _threading.Lock()


def _get_mouse_position(session_id: int = 0) -> tuple[float, float]:
    """현재 마우스 위치 조회"""
    with _mouse_lock:
        return _mouse_position.get(session_id, (random.uniform(100, 800), random.uniform(100, 500)))


def _set_mouse_position(x: float, y: float, session_id: int = 0) -> None:
    """마우스 위치 업데이트"""
    with _mouse_lock:
        _mouse_position[session_id] = (x, y)


async def move_mouse_to(
    page: Page, 
    x: float, 
    y: float, 
    steps: int | None = None, 
    start_x: float | None = None, 
    start_y: float | None = None,
    session_id: int = 0
) -> bool:
    """베지어 곡선으로 마우스 이동 (v5.8 - 속도/가속도 랜덤화, 휴식 패턴)
    
    개선사항:
    - 이동 거리에 따른 동적 step 수
    - 속도 곡선 (처음 가속, 중간 유지, 끝 감속)
    - 랜덤 휴식 패턴 (5% 확률로 짧은 멈춤)
    - 마이크로 지터 (손 떨림 시뮬레이션)
    
    Args:
        page: nodriver page 객체
        x, y: 목표 좌표
        steps: 이동 단계 수 (None이면 거리 기반 자동 계산)
        start_x, start_y: 시작 좌표 (None이면 현재 위치 사용)
        session_id: 세션 ID (멀티 세션용)
    
    Returns:
        bool: 성공 여부
    """
    try:
        # 시작 위치 (이전 위치 또는 기본값)
        if start_x is None or start_y is None:
            start_x, start_y = _get_mouse_position(session_id)
        
        # 이동 거리 계산
        distance = ((x - start_x)**2 + (y - start_y)**2)**0.5
        
        # 거리 기반 동적 step 수 (짧으면 적게, 길면 많이)
        if steps is None:
            steps = max(5, min(20, int(distance / 30)))
        
        # 제어점 생성 (2개 - 3차 베지어)
        variance = min(MouseParams.CTRL_POINT_VARIANCE, distance * 0.3)
        ctrl1_x = start_x + (x - start_x) * 0.3 + random.uniform(-variance, variance)
        ctrl1_y = start_y + (y - start_y) * 0.3 + random.uniform(-variance * 0.6, variance * 0.6)
        ctrl2_x = start_x + (x - start_x) * 0.7 + random.uniform(-variance, variance)
        ctrl2_y = start_y + (y - start_y) * 0.7 + random.uniform(-variance * 0.6, variance * 0.6)
        
        for i in range(steps):
            t = (i + 1) / steps
            
            # 3차 베지어 곡선: B(t) = (1-t)³P0 + 3(1-t)²tP1 + 3(1-t)t²P2 + t³P3
            current_x = (
                (1-t)**3 * start_x + 
                3*(1-t)**2*t * ctrl1_x + 
                3*(1-t)*t**2 * ctrl2_x + 
                t**3 * x
            )
            current_y = (
                (1-t)**3 * start_y + 
                3*(1-t)**2*t * ctrl1_y + 
                3*(1-t)*t**2 * ctrl2_y + 
                t**3 * y
            )
            
            # 마이크로 지터 (손 떨림 시뮬레이션)
            if i < steps - 1:  # 마지막 점 제외
                current_x += random.uniform(-0.5, 0.5)
                current_y += random.uniform(-0.5, 0.5)
            
            await page.send(cdp.input_.dispatch_mouse_event(
                type_='mouseMoved',
                x=int(current_x),
                y=int(current_y)
            ))
            
            # 속도 곡선 적용 (처음/끝 느리게, 중간 빠르게)
            # ease-in-out 느낌
            speed_factor = 1.0 - 0.5 * abs(2*t - 1)  # 중간이 1.0, 양끝이 0.5
            base_delay = random.uniform(MouseParams.MOVE_DELAY_MIN, MouseParams.MOVE_DELAY_MAX)
            delay = base_delay / speed_factor
            
            # 5% 확률로 짧은 휴식 (인간적 특성)
            if random.random() < 0.05 and i < steps - 2:
                delay += random.uniform(0.03, 0.08)
            
            await asyncio.sleep(delay)
        
        # 위치 업데이트
        _set_mouse_position(x, y, session_id)
        return True
        
    except Exception as e:
        logger.debug(f"마우스 이동 실패: {e}")
        return False

async def human_click(page, element) -> bool:
    """사람처럼 클릭 (마우스 이동 + 클릭)"""
    try:
        # 요소 위치 가져오기
        if hasattr(element, 'node_id'):
            try:
                box = await page.send(cdp.dom.get_box_model(node_id=element.node_id))
                if box and box.model and box.model.content:
                    content = box.model.content
                    x = (content[0] + content[4]) / 2 + random.uniform(-3, 3)
                    y = (content[1] + content[5]) / 2 + random.uniform(-3, 3)
                    
                    # 마우스 이동
                    await move_mouse_to(page, x, y)
                    await asyncio.sleep(random.uniform(0.05, 0.15))
            except Exception:
                pass
        
        # 클릭
        await element.click()
        return True
    except Exception as e:
        logger.debug(f"human_click 실패: {e}")
        try:
            await element.click()
            return True
        except Exception:
            return False


# ============ 타이핑 (개선) ============
def _escape_js_char(char: str) -> str:
    """JavaScript 문자열 이스케이프 (안전한 처리)"""
    # 순서 중요: 백슬래시 먼저
    escape_map = [
        ('\\', '\\\\'),
        ('"', '\\"'),
        ("'", "\\'"),
        ('\n', '\\n'),
        ('\r', '\\r'),
        ('\t', '\\t'),
        ('`', '\\`'),
        ('\0', ''),  # null 문자 제거
    ]
    result = char
    for old, new in escape_map:
        result = result.replace(old, new)
    return result

async def human_type(page, element, text: str, with_mistakes: bool = True):
    """사람처럼 타이핑 (오타 + 수정 포함)
    
    Args:
        page: nodriver page 객체
        element: 입력할 요소
        text: 입력할 텍스트
        with_mistakes: 오타 시뮬레이션 여부 (비밀번호는 False 권장)
    """
    # 특수문자 집합 (JS 직접 입력 필요)
    special_chars = set('@#$%^&*()[]{}|;:,.<>?/~`\\"\'+=-_')
    
    for i, char in enumerate(text):
        # 5% 확률로 오타 + 백스페이스 (마지막 문자 제외)
        if with_mistakes and random.random() < 0.05 and i < len(text) - 1:
            wrong_char = random.choice('qwertyuiopasdfghjklzxcvbnm')
            try:
                await element.send_keys(wrong_char)
                await asyncio.sleep(random.uniform(0.1, 0.3))
                await press_key(page, 'Backspace', 8)
                await asyncio.sleep(random.uniform(0.05, 0.1))
            except Exception:
                pass  # 오타 시뮬레이션 실패는 무시
        
        # 문자 입력
        if char in special_chars:
            # 특수문자는 send_keys가 불안정하므로 JS로 직접 입력
            escaped = _escape_js_char(char)
            script = f'document.activeElement.value += "{escaped}"; document.activeElement.dispatchEvent(new Event("input", {{bubbles: true}}));'
            await evaluate_js(page, script)
        else:
            try:
                await element.send_keys(char)
            except Exception:
                # 일반 문자도 실패 시 JS로 폴백
                escaped = _escape_js_char(char)
                script = f'document.activeElement.value += "{escaped}"; document.activeElement.dispatchEvent(new Event("input", {{bubbles: true}}));'
                await evaluate_js(page, script)
        
        # 불규칙 딜레이 (사람처럼)
        if char in ' .,@':
            await asyncio.sleep(random.uniform(0.15, 0.4))
        else:
            await asyncio.sleep(random.uniform(0.04, 0.12))


# ============ 키 입력 (CDP) ============
async def press_key(page, key: str, key_code: int):
    """키 누르기 (CDP Input)"""
    try:
        await page.send(cdp.input_.dispatch_key_event(
            type_='keyDown',
            key=key,
            code=key,
            windows_virtual_key_code=key_code
        ))
        await page.send(cdp.input_.dispatch_key_event(
            type_='keyUp',
            key=key,
            code=key,
            windows_virtual_key_code=key_code
        ))
    except Exception as e:
        logger.debug(f"키 입력 실패 ({key}): {e}")

async def press_enter(page):
    """엔터키"""
    await press_key(page, 'Enter', 13)


# ============ DOM 검색 ============
async def find_by_text(page, text: str, timeout: float = 3.0):
    """텍스트로 요소 찾기"""
    try:
        elem = await asyncio.wait_for(page.find(text), timeout=timeout)
        return elem
    except (asyncio.TimeoutError, Exception):
        return None

async def find_by_selector(page, selector: str, timeout: float = 3.0):
    """CSS 셀렉터로 요소 찾기"""
    try:
        elem = await asyncio.wait_for(page.select(selector), timeout=timeout)
        return elem
    except (asyncio.TimeoutError, Exception):
        return None

async def find_by_selectors(page, selectors: List[str], timeout: float = 1.0, parallel: bool = False):
    """여러 셀렉터 시도
    
    Args:
        page: nodriver page 객체
        selectors: CSS 셀렉터 목록
        timeout: 개별 셀렉터 타임아웃
        parallel: True면 병렬 검색 (더 빠름, 순서 무시)
    """
    if parallel and len(selectors) > 1:
        # 병렬 검색 (첫 번째 발견 즉시 반환)
        tasks = [find_by_selector(page, s, timeout=timeout) for s in selectors]
        results = await asyncio.gather(*tasks, return_exceptions=True)
        for i, result in enumerate(results):
            if result and not isinstance(result, Exception):
                logger.debug(f"✓ 셀렉터 발견 (병렬): {selectors[i]}")
                return result
        return None
    else:
        # 순차 검색 (우선순위 보장)
        for selector in selectors:
            elem = await find_by_selector(page, selector, timeout=timeout)
            if elem:
                logger.debug(f"✓ 셀렉터 발견: {selector}")
                return elem
        return None

async def find_all_by_selector(page, selector: str, timeout: float = 3.0) -> List:
    """모든 요소 찾기"""
    try:
        elements = await page.select_all(selector, timeout=timeout)
        return elements if elements else []
    except Exception:
        return []


# ============ 페이지 로드 대기 (실제 구현) ============
async def wait_for_navigation(page, timeout: float = 10.0) -> bool:
    """실제 페이지 로드 완료 대기 (CDP readyState)"""
    start = time.time()
    
    while (time.time() - start) < timeout:
        try:
            result = await page.send(cdp.runtime.evaluate(
                expression="document.readyState"
            ))
            if result and hasattr(result, 'result'):
                state = result.result.value if hasattr(result.result, 'value') else None
                if state == 'complete':
                    await asyncio.sleep(0.3)  # DOM 안정화
                    return True
        except Exception:
            pass
        await asyncio.sleep(0.2)
    
    logger.debug(f"Navigation 타임아웃 ({timeout}s)")
    return False

async def wait_for_element(page, text: str, timeout: float = 10.0):
    """특정 요소 나타날 때까지 대기"""
    start = time.time()
    while (time.time() - start) < timeout:
        elem = await find_by_text(page, text, timeout=1.0)
        if elem:
            return elem
        await asyncio.sleep(0.3)
    return None


# ============ 로그인 ============
async def step_login(browser, page, config: Config) -> Tuple[bool, any]:
    """로그인 (재시도 포함)"""
    for attempt in range(1, config.max_login_retries + 1):
        logger.info(f"[1/5] 로그인 시도 {attempt}/{config.max_login_retries}...")
        
        try:
            success, page = await _do_login(browser, page, config)
            if success:
                return True, page
            
            logger.warning(f"로그인 실패 (시도 {attempt})")
            
            if attempt < config.max_login_retries:
                # 쿠키/캐시 클리어
                try:
                    await page.send(cdp.network.clear_browser_cookies())
                    await page.send(cdp.network.clear_browser_cache())
                except Exception:
                    pass
                
                await page.get('https://tickets.interpark.com/')
                await wait_for_navigation(page)
                await human_delay(2, 3)
                
        except Exception as e:
            logger.error(f"로그인 예외 (시도 {attempt}): {mask_pwd(str(e), config)}")
            if attempt < config.max_login_retries:
                await asyncio.sleep(2)
    
    return False, page


async def _do_login(browser, page, config: Config) -> Tuple[bool, any]:
    """실제 로그인 수행"""
    
    # 현재 URL 로깅
    current_url = await evaluate_js(page, 'window.location.href')
    logger.debug(f"현재 URL: {current_url}")
    
    # 로그인 버튼 찾기
    login_btn = await find_by_text(page, '로그인', timeout=3.0)
    if not login_btn:
        login_btn = await find_by_selectors(page, SELECTORS['login_btn'])
    
    if not login_btn:
        logger.error("로그인 버튼 없음")
        return False, page
    
    logger.debug("✓ 로그인 버튼 발견")
    await human_click(page, login_btn)
    await wait_for_navigation(page, timeout=5.0)
    await human_delay(1, 2)
    
    # 이메일로 시작하기 버튼 찾기
    email_btn = await wait_for_element(page, '이메일로 시작하기', timeout=5.0)
    if email_btn:
        logger.debug("✓ 이메일로 시작하기 발견")
        await human_click(page, email_btn)
        await wait_for_navigation(page, timeout=5.0)
        await human_delay(1, 2)
    else:
        logger.debug("이메일로 시작하기 버튼 없음 - 이미 이메일 로그인 페이지?")
    
    # ID 입력 필드 찾기 (여러 방법 시도)
    id_field = await find_by_selectors(page, SELECTORS['id_field'])
    if not id_field:
        id_field = await find_by_text(page, '이메일(아이디)', timeout=2.0)
    if not id_field:
        # placeholder로 직접 찾기
        id_field = await find_by_selector(page, 'input[placeholder*="nol"]', timeout=2.0)
    
    if not id_field:
        logger.error("ID 필드 없음")
        # 현재 페이지 URL 출력
        debug_url = await evaluate_js(page, 'window.location.href')
        logger.error(f"현재 URL: {debug_url}")
        return False, page
    
    logger.debug("✓ ID 필드 발견")
    await human_click(page, id_field)
    await human_delay(0.2, 0.3)
    await human_type(page, id_field, config.user_id)
    logger.debug(f"✓ ID 입력: {config.user_id[:10]}...")
    await human_delay(0.3, 0.5)
    
    # PW 입력
    pw_field = await find_by_selectors(page, SELECTORS['pw_field'])
    if not pw_field:
        logger.error("PW 필드 없음")
        return False, page
    
    logger.debug("✓ PW 필드 발견")
    await human_click(page, pw_field)
    await human_delay(0.2, 0.3)
    await human_type(page, pw_field, config.user_pwd, with_mistakes=False)
    logger.debug("✓ PW 입력 완료")
    await human_delay(0.3, 0.5)
    
    # Turnstile/CAPTCHA 완료 대기 (버튼 enabled 될 때까지)
    # 티켓팅 환경에서는 60초까지 대기 (Turnstile 처리 시간 고려)
    turnstile_ok = await _wait_for_turnstile(page, timeout=60.0)
    if not turnstile_ok:
        logger.warning("⚠️ Turnstile 대기 타임아웃 - 클릭 시도 계속")
    
    # 로그인 버튼
    submit_btn = await find_by_selectors(page, SELECTORS['submit_btn'])
    if not submit_btn:
        submit_btn = await find_by_text(page, '로그인하기', timeout=2.0)
    
    if submit_btn:
        logger.debug("✓ 로그인하기 버튼 발견")
        await human_click(page, submit_btn)
    else:
        logger.info("submit 버튼 없음 - 엔터키")
        await press_enter(page)
    
    await wait_for_navigation(page, timeout=10.0)
    await human_delay(3, 4)  # 로그인 후 리다이렉트 대기 시간 증가
    
    return await _verify_login(page), page


async def _wait_for_turnstile(page, timeout: float = 60.0) -> bool:
    """Cloudflare Turnstile 챌린지 완료 대기 (다중 전략)
    
    전략:
    1. 자연스러운 마우스 움직임 (베지어 곡선)
    2. Turnstile iframe 체크박스 클릭 (최대 3회)
    3. 스크롤 + 포커스 이벤트
    
    Args:
        timeout: 최대 대기 시간 (기본 60초)
    """
    logger.info("⏳ Turnstile 챌린지 완료 대기 중... (다중 전략)")
    start = time.time()
    last_log = 0
    mouse_move_count = 0
    checkbox_attempts = 0
    max_checkbox_attempts = 3
    
    async def _check_button_enabled():
        """로그인 버튼 활성화 확인"""
        return await evaluate_js(page, '''
            (() => {
                const btns = document.querySelectorAll('button[type="submit"], button');
                for (const btn of btns) {
                    const text = (btn.textContent || '').trim();
                    if (text === '로그인하기' || text === '로그인') {
                        const disabled = btn.disabled || btn.getAttribute('aria-disabled') === 'true';
                        return !disabled;
                    }
                }
                return null;
            })()
        ''')
    
    async def _try_checkbox_click():
        """Turnstile 체크박스 클릭 시도"""
        result = await evaluate_js(page, '''
            (() => {
                const iframes = document.querySelectorAll('iframe[src*="turnstile"], iframe[src*="challenges.cloudflare"]');
                for (const iframe of iframes) {
                    try {
                        // 먼저 뷰포트로 스크롤
                        iframe.scrollIntoView({ behavior: 'instant', block: 'center' });
                        
                        const rect = iframe.getBoundingClientRect();
                        if (rect.width > 0 && rect.height > 0) {
                            return {
                                x: rect.left + 25,
                                y: rect.top + rect.height / 2,
                                found: true
                            };
                        }
                    } catch (e) {}
                }
                return { found: false };
            })()
        ''')
        
        if result and result.get('found'):
            x, y = result['x'], result['y']
            logger.info(f"🖱️ Turnstile 체크박스 클릭 시도 ({x:.0f}, {y:.0f})")
            # 자연스럽게 이동 후 클릭
            await move_mouse_to(page, x, y)
            await asyncio.sleep(random.uniform(0.1, 0.3))
            await page.send(cdp.input_.dispatch_mouse_event(
                type_='mousePressed', x=int(x), y=int(y), button='left', click_count=1
            ))
            await asyncio.sleep(random.uniform(0.05, 0.15))
            await page.send(cdp.input_.dispatch_mouse_event(
                type_='mouseReleased', x=int(x), y=int(y), button='left'
            ))
            return True
        return False
    
    async def _simulate_human_behavior():
        """인간 행동 시뮬레이션 (스크롤 + 마우스)"""
        # 랜덤 스크롤
        await evaluate_js(page, f'''
            window.scrollTo({{
                top: {random.randint(50, 150)},
                behavior: 'smooth'
            }})
        ''')
        await asyncio.sleep(random.uniform(0.2, 0.4))
        
        # 마우스 움직임
        x = random.randint(200, 800)
        y = random.randint(200, 600)
        await move_mouse_to(page, x, y)
    
    while (time.time() - start) < timeout:
        # 버튼 활성화 확인
        if await _check_button_enabled():
            logger.info("✅ Turnstile 완료! 버튼 활성화됨")
            return True
        
        elapsed = time.time() - start
        
        # 5초, 15초, 30초에 체크박스 클릭 시도 (최대 3회)
        checkpoint_times = [5, 15, 30]
        if checkbox_attempts < max_checkbox_attempts:
            if elapsed > checkpoint_times[checkbox_attempts]:
                checkbox_attempts += 1
                clicked = await _try_checkbox_click()
                if clicked:
                    logger.info(f"✅ Turnstile 체크박스 클릭 {checkbox_attempts}/{max_checkbox_attempts}")
        
        # 3초마다 인간 행동 시뮬레이션
        if int(elapsed) % 3 == 0 and mouse_move_count < int(elapsed) // 3:
            mouse_move_count += 1
            await _simulate_human_behavior()
        
        # Turnstile iframe 존재 여부 확인
        has_turnstile = await evaluate_js(page, '''
            document.querySelector('iframe[src*="turnstile"], iframe[src*="challenges"]') !== null
        ''')
        
        # 10초마다 상태 로깅
        if int(elapsed) - last_log >= 10:
            last_log = int(elapsed)
            if has_turnstile:
                logger.info(f"⏳ Turnstile 대기 {elapsed:.0f}초... (행동 {mouse_move_count}회)")
            else:
                logger.info(f"⏳ 버튼 대기 {elapsed:.0f}초...")
        
        # 적응형 폴링 간격 (Turnstile 클릭 직후 더 빠르게)
        if checkbox_attempts > 0 and elapsed < checkpoint_times[checkbox_attempts - 1] + 5:
            await asyncio.sleep(0.2)  # 클릭 직후 5초간 빠른 폴링
        else:
            await asyncio.sleep(0.5)
    
    logger.warning("⚠️ Turnstile 자동 해결 실패 - 수동 확인 필요")
    return False


async def _verify_login(page) -> bool:
    """로그인 확인 (개선됨)"""
    
    # 1. JS로 헤더 버튼에 '님' 포함 확인 (가장 확실)
    has_user_button = await evaluate_js(page, '''
        (() => {
            const buttons = document.querySelectorAll('button, a');
            for (const btn of buttons) {
                const text = btn.textContent || btn.innerText || '';
                if (text.includes('님') && !text.includes('로그인')) {
                    return text.trim();
                }
            }
            return null;
        })()
    ''')
    if has_user_button:
        logger.info(f"✅ 로그인 성공! ('{has_user_button}' 발견)")
        return True
    
    # 2. 텍스트 기반 검색 (폴백)
    success_indicators = ['로그아웃', '마이페이지', '내 예약', '예매확인']
    for indicator in success_indicators:
        elem = await find_by_text(page, indicator, timeout=1.5)
        if elem:
            logger.info(f"✅ 로그인 성공! ('{indicator}' 발견)")
            return True
    
    # 3. URL 기반 확인 (로그인 페이지 벗어남)
    current_url = await evaluate_js(page, 'window.location.href')
    if current_url and 'login' not in current_url.lower() and 'signin' not in current_url.lower():
        # 메인 페이지로 리다이렉트됐으면 성공 가능성 높음
        if 'interpark.com' in current_url and '/ticket' in current_url:
            logger.info(f"✅ 로그인 성공! (메인 페이지 도달: {current_url[:50]})")
            return True
    
    # 4. 실패 메시지 확인
    fail_indicators = [
        '비밀번호를 확인해주세요', '비밀번호가 일치하지 않습니다',
        '로그인 실패', '존재하지 않는 계정', '보안문자', '잘못되었습니다'
    ]
    
    for indicator in fail_indicators:
        elem = await find_by_text(page, indicator, timeout=1.0)
        if elem:
            logger.error(f"❌ 로그인 실패: {indicator}")
            return False
    
    # 5. 쿠키 기반 확인 (마지막 수단)
    try:
        cookies = await page.send(cdp.network.get_cookies())
        if cookies and cookies.cookies:
            auth_cookies = [c for c in cookies.cookies 
                          if 'token' in c.name.lower() or 
                             'session' in c.name.lower() or
                             'auth' in c.name.lower()]
            if auth_cookies:
                logger.info(f"✅ 로그인 성공! (인증 쿠키 {len(auth_cookies)}개 발견)")
                return True
    except Exception as e:
        logger.debug(f"쿠키 확인 실패: {e}")
    
    logger.warning("⚠️ 로그인 상태 불확실")
    return False


# ============ 예매 ============
async def step_navigate_concert(page, config: Config) -> bool:
    """콘서트 페이지 이동"""
    logger.info("[2/5] 콘서트 페이지...")
    await page.get(config.concert_url)
    await wait_for_navigation(page, timeout=10.0)
    await human_delay(1, 2)
    logger.info("✅ 콘서트 페이지 도착")
    return True


async def step_wait_open(page: Page, config: Config) -> bool:
    """오픈 대기 (NTP 기반 정밀 대기 - v5.8 개선)
    
    개선사항:
    - 100ms 정밀도 대기 (오픈 직전)
    - 커서 사전 위치 (30초 전)
    - 페이지 프리로드 (5초 전)
    - NTP 상태 모니터링
    
    Args:
        page: nodriver page 객체
        config: 설정 객체
    
    Returns:
        bool: 항상 True (대기 완료)
    """
    logger.info("[3/5] 오픈 대기...")
    
    refresh_count: int = 0
    cursor_positioned: bool = False
    page_preloaded: bool = False
    
    # NTP 상태 확인
    ntp_status = get_ntp_status()
    if ntp_status['offset_ms'] is not None:
        logger.info(f"⏰ NTP offset: {ntp_status['offset_ms']:.1f}ms ({ntp_status['server']})")
    
    while True:
        now = get_accurate_time()
        remaining = (config.open_time - now).total_seconds()
        
        if remaining <= 0:
            break
        
        # ========== 오픈 100ms 전: 정밀 대기 ==========
        elif remaining <= 0.1:
            # 최종 스핀 대기 (busy wait - 정밀도 최대화)
            target_time = time.time() + remaining + (ntp_status.get('offset_ms', 0) or 0) / 1000
            while time.time() < target_time:
                pass  # Busy wait for precision
            break
        
        # ========== 오픈 1초 전: 100ms 단위 대기 ==========
        elif remaining <= 1.0:
            logger.info(f"⏳ {remaining*1000:.0f}ms...")
            await asyncio.sleep(0.1)
        
        # ========== 오픈 5초 전: 고속 새로고침 ==========
        elif remaining <= 5:
            # 페이지 프리로드 (한 번만)
            if not page_preloaded:
                page_preloaded = True
                logger.info("📄 페이지 프리로드...")
                try:
                    await page.reload()
                    await wait_for_navigation(page, timeout=3.0)
                except Exception:
                    pass
            
            refresh_count += 1
            if refresh_count <= Limits.MAX_RAPID_REFRESH:
                logger.info(f"⏳ {remaining:.1f}초... (새로고침 {refresh_count}/{Limits.MAX_RAPID_REFRESH})")
                await page.reload()
                await asyncio.sleep(0.3)
            else:
                logger.info(f"⏳ {remaining:.1f}초... (대기)")
                await asyncio.sleep(0.2)
        
        # ========== 오픈 30초 전: 커서 위치 ==========
        elif remaining <= 30:
            if not cursor_positioned:
                cursor_positioned = True
                try:
                    btn_pos = await evaluate_js(page, '''
                        (() => {
                            const btn = document.querySelector('a.btn_book, button.booking, [class*="BookingButton"]');
                            if (btn) {
                                const rect = btn.getBoundingClientRect();
                                return { x: rect.left + rect.width/2, y: rect.top + rect.height/2 };
                            }
                            return { x: 960, y: 500 };
                        })()
                    ''')
                    if btn_pos:
                        await move_mouse_to(page, btn_pos.get('x', 960), btn_pos.get('y', 500))
                        logger.debug("🖱️ 커서 예매 버튼 근처로 이동")
                except Exception:
                    pass
            logger.info(f"⏳ {int(remaining)}초...")
            await asyncio.sleep(1)
        
        # ========== 5분 이내: 10초 간격 ==========
        elif remaining <= 300:
            # 1분마다 NTP 재확인
            if int(remaining) % 60 == 0:
                await sync_ntp_time()
            logger.info(f"⏳ {int(remaining/60)}분 {int(remaining%60)}초...")
            await asyncio.sleep(10)
        
        # ========== 5분 이상: 1분 간격 ==========
        else:
            logger.info(f"⏳ {int(remaining/60)}분...")
            await asyncio.sleep(60)
    
    logger.info("🚀 오픈! (정밀 타이밍)")
    return True


class AdaptiveRefreshStrategy:
    """적응형 새로고침 전략 (티켓팅 최적화, Thread-safe)
    
    전략:
    - 기본 간격: 150ms
    - 연속 성공 시: 100ms까지 가속
    - 오류 시: 지수적 백오프 (최대 1초)
    - Rate limiting 시: 2초 대기 후 재시도
    """
    
    # 상수 (Named Constants)
    BASE_INTERVAL: float = 0.15   # 150ms 기본
    MIN_INTERVAL: float = 0.10    # 100ms 최소
    MAX_INTERVAL: float = 1.0     # 1초 최대
    RATE_LIMIT_COOLDOWN: float = 2.0  # Rate limit 시 대기
    ACCELERATION_THRESHOLD: int = 5   # 가속 시작 연속 성공 횟수
    ACCELERATION_FACTOR: float = 0.8  # 가속 계수
    BACKOFF_FACTOR: float = 1.5       # 백오프 계수
    
    def __init__(self):
        self._consecutive_errors: int = 0
        self._rate_limited: bool = False
        self._rate_limit_until: float = 0.0
        self._lock = _threading.Lock()
        self._success_count: int = 0  # 연속 성공 카운트 (속도 향상용)
    
    def get_interval(self, is_error: bool = False, is_rate_limited: bool = False) -> float:
        """다음 새로고침 간격 계산 (Thread-safe)
        
        Args:
            is_error: 오류 발생 여부
            is_rate_limited: 429 응답 등 rate limiting 감지
        
        Returns:
            float: 다음 새로고침까지 대기 시간 (초)
        """
        with self._lock:
            # Rate limiting 감지 시 백오프
            if is_rate_limited:
                self._rate_limited = True
                self._rate_limit_until = time.time() + self.RATE_LIMIT_COOLDOWN
                self._consecutive_errors = 0
                self._success_count = 0
                return self.RATE_LIMIT_COOLDOWN
            
            # Rate limiting 쿨다운 중
            if self._rate_limited and time.time() < self._rate_limit_until:
                return max(self._rate_limit_until - time.time(), self.BASE_INTERVAL)
            else:
                self._rate_limited = False
            
            if is_error:
                self._consecutive_errors += 1
                self._success_count = 0
                return min(
                    self.BASE_INTERVAL * (self.BACKOFF_FACTOR ** self._consecutive_errors), 
                    self.MAX_INTERVAL
                )
            else:
                self._consecutive_errors = 0
                self._success_count += 1
                # 연속 성공 시 점점 빠르게
                if self._success_count > self.ACCELERATION_THRESHOLD:
                    return max(self.MIN_INTERVAL, self.BASE_INTERVAL * self.ACCELERATION_FACTOR)
                return self.BASE_INTERVAL
    
    def reset(self) -> None:
        """상태 초기화"""
        with self._lock:
            self._consecutive_errors = 0
            self._rate_limited = False
            self._rate_limit_until = 0.0
            self._success_count = 0
    
    def get_stats(self) -> dict[str, int | bool]:
        """현재 상태 조회"""
        with self._lock:
            return {
                'consecutive_errors': self._consecutive_errors,
                'success_count': self._success_count,
                'rate_limited': self._rate_limited
            }


async def step_click_booking(browser, page, config: Config) -> Tuple[bool, any]:
    """예매 버튼 클릭 (적응형 새로고침 + 병렬 검색)"""
    logger.info("[4/5] 예매 버튼...")
    
    initial_tabs = await get_browser_tabs(browser)
    initial_count = len(initial_tabs)
    strategy = AdaptiveRefreshStrategy()
    
    for attempt in range(50):  # 50회로 증가
        try:
            # 병렬로 여러 방법 동시 검색 (더 빠름)
            tasks = [
                find_by_text(page, '예매하기', timeout=0.3),
                find_by_selectors(page, SELECTORS['booking_btn'], timeout=0.3),
            ]
            results = await asyncio.gather(*tasks, return_exceptions=True)
            
            booking = None
            for r in results:
                if r and not isinstance(r, Exception):
                    booking = r
                    break
            
            if booking:
                # 즉시 클릭 (딜레이 최소화 + 더블 클릭 방지)
                try:
                    # 버튼 비활성화 확인
                    is_disabled = await evaluate_js(page, '''
                        (() => {
                            const btn = document.querySelector('a.btn_book, button.booking, [class*="BookingButton"]');
                            return btn && (btn.disabled || btn.classList.contains('disabled'));
                        })()
                    ''')
                    if is_disabled:
                        logger.debug("버튼 비활성화 상태 - 건너뜀")
                        await asyncio.sleep(0.2)
                        continue
                    
                    await booking.click()
                except Exception:
                    await evaluate_js(page, '''
                        document.querySelector('a.btn_book, button.booking, [class*="BookingButton"]')?.click()
                    ''')
                
                logger.info(f"✅ 예매 클릭! (시도 {attempt + 1})")
                await send_telegram(config, "🎉 예매 버튼 클릭!")
                
                # 새 탭 확인 (짧은 대기)
                new_page = await _get_new_tab(browser, initial_count, timeout=2.0)
                if new_page:
                    logger.info("🔄 새 창 전환")
                    return True, new_page
                
                await asyncio.sleep(0.5)
                return True, page
            
            # 상태 빠르게 확인
            status = await evaluate_js(page, '''
                (() => {
                    const text = document.body.innerText;
                    if (text.includes('매진') || text.includes('SOLD OUT')) return 'sold_out';
                    if (text.includes('예매대기') || text.includes('준비중')) return 'waiting';
                    if (text.includes('예매하기')) return 'available';
                    return 'unknown';
                })()
            ''')
            
            if status == 'sold_out':
                logger.warning(f"❌ 매진 (시도 {attempt + 1}) - 3초 대기 후 재시도")
                await asyncio.sleep(3.0)  # 매진 시 더 긴 대기
                await page.reload()
                continue
            elif status == 'waiting':
                logger.info(f"⏳ 예매대기 (시도 {attempt + 1})")
            
            # 적응형 새로고침
            await page.reload()
            interval = strategy.get_interval()
            await asyncio.sleep(interval)
            
        except Exception as e:
            error_str = str(e).lower()
            # Rate limiting 감지 (429, too many requests 등)
            is_rate_limited = '429' in error_str or 'rate' in error_str or 'too many' in error_str
            interval = strategy.get_interval(is_error=True, is_rate_limited=is_rate_limited)
            
            if is_rate_limited:
                logger.warning(f"⚠️ Rate limiting 감지 - {interval:.1f}초 대기")
            else:
                logger.warning(f"예매 시도 {attempt + 1} 오류: {e}")
            
            await asyncio.sleep(interval)
    
    logger.error("❌ 예매 버튼 50회 실패")
    return False, page


async def get_browser_tabs(browser) -> List:
    """브라우저 탭 목록 (nodriver 호환)
    
    nodriver의 tabs 속성은 버전에 따라 property, coroutine, 또는 method일 수 있음
    """
    if not browser:
        return []
    
    try:
        tabs = browser.tabs
        
        # Coroutine이면 await
        if asyncio.iscoroutine(tabs):
            tabs = await tabs
        # Callable이면 호출
        elif callable(tabs):
            result = tabs()
            if asyncio.iscoroutine(result):
                tabs = await result
            else:
                tabs = result
        
        # 결과 정규화
        if tabs is None:
            return []
        if hasattr(tabs, '__iter__'):
            return list(tabs)
        return [tabs]  # 단일 탭인 경우
        
    except Exception as e:
        logger.debug(f"탭 목록 조회 실패: {e}")
        return []


async def _get_new_tab(browser, initial_count: int, timeout: float = 5.0):
    """새 탭 감지"""
    start = time.time()
    while (time.time() - start) < timeout:
        tabs = await get_browser_tabs(browser)
        if len(tabs) > initial_count:
            new_tab = tabs[-1]
            try:
                if hasattr(new_tab, 'bring_to_front'):
                    await new_tab.bring_to_front()
                elif hasattr(new_tab, 'activate'):
                    await new_tab.activate()
            except Exception:
                pass
            await wait_for_navigation(new_tab, timeout=3.0)
            return new_tab
        await asyncio.sleep(0.3)
    return None


# ============ 좌석 선택 ============
async def _get_seat_page(page) -> Tuple[any, bool]:
    """좌석맵 페이지 가져오기 (iframe 처리)"""
    # 1. iframe 확인
    for selector in SELECTORS['seat_iframe']:
        iframe = await find_by_selector(page, selector, timeout=1.0)
        if iframe:
            # iframe src 가져오기
            iframe_src = await evaluate_js(page, f'''
                (() => {{
                    const iframe = document.querySelector('{selector}');
                    return iframe ? iframe.src : null;
                }})()
            ''')
            if iframe_src:
                logger.info(f"📋 iframe 발견: {iframe_src[:50]}...")
                # iframe 내부 직접 접근은 어려우므로 메인 페이지에서 시도
                # CDP frame 접근 시도
                try:
                    frames = await page.send(cdp.page.get_frame_tree())
                    if frames and frames.frame_tree.child_frames:
                        for child in frames.frame_tree.child_frames:
                            if 'seat' in child.frame.url.lower():
                                logger.info(f"📋 좌석 프레임 발견: {child.frame.id}")
                                # 이 프레임에서 작업할 수 있음
                                return page, True  # iframe 모드 표시
                except Exception as e:
                    logger.debug(f"프레임 접근 실패: {e}")
            break
    
    return page, False

async def step_select_seat(page, config: Config) -> bool:
    """좌석 선택 (iframe 지원, 다중 전략)
    
    전략 순서:
    1. 구역 버튼 → 개별 좌석 선택
    2. Canvas 픽셀 분석 (녹색/파란색)
    3. Canvas 그리드 클릭 (폴백)
    4. iframe 내부 클릭 시도
    """
    logger.info("[5/5] 좌석 선택...")
    await send_telegram(config, "⚠️ 좌석 선택 페이지!")
    
    # 페이지 로드 대기
    await wait_for_navigation(page, timeout=5.0)
    
    # iframe 확인
    seat_page, is_iframe = await _get_seat_page(page)
    if is_iframe:
        logger.info("📋 iframe 모드로 좌석 선택")
    
    # 재시도 전략 (처음엔 빠르게, 나중엔 신중하게)
    max_attempts = 30
    for attempt in range(max_attempts):
        remaining = max_attempts - attempt
        logger.info(f"좌석 검색 {attempt + 1}/{max_attempts} (남은 시도: {remaining})")
        
        # 구역 선택
        for grade in config.seat_priority:
            zone_btn = await find_by_text(seat_page, grade, timeout=1.0)
            if zone_btn:
                logger.info(f"🎯 구역: {grade}")
                await human_click(seat_page, zone_btn)
                await human_delay(1, 2)
                
                # 좌석 선택
                if await _select_seat(seat_page):
                    if await _complete_selection(seat_page):
                        await send_telegram(config, f"🎉 {grade} 좌석 선택!")
                        return True
        
        # Canvas 직접 클릭 (iframe 내부 포함)
        if await _click_canvas_seat(seat_page):
            if await _complete_selection(seat_page):
                await send_telegram(config, "🎉 좌석 선택!")
                return True
        
        # iframe 내부 Canvas 클릭 시도 (JS로)
        if is_iframe:
            clicked = await evaluate_js(page, '''
                (() => {
                    const iframe = document.querySelector('iframe[id*="seat"], iframe[src*="seat"]');
                    if (!iframe || !iframe.contentDocument) return false;
                    const canvas = iframe.contentDocument.querySelector('canvas');
                    if (!canvas) return false;
                    const rect = canvas.getBoundingClientRect();
                    const event = new MouseEvent('click', {
                        bubbles: true, cancelable: true,
                        clientX: rect.left + rect.width * 0.5,
                        clientY: rect.top + rect.height * 0.5
                    });
                    canvas.dispatchEvent(event);
                    return true;
                })()
            ''')
            if clicked:
                logger.info("✅ iframe Canvas 클릭")
                await human_delay(0.5, 1.0)
        
        # 새로고침
        refresh = await find_by_text(seat_page, '새로고침', timeout=1.0)
        if refresh:
            await human_click(seat_page, refresh)
        
        await human_delay(1.5, 2.5)
    
    logger.warning("⚠️ 자동 좌석 선택 실패")
    await send_telegram(config, "⚠️ 수동 좌석 선택 필요!")
    return False


async def _select_seat(page) -> bool:
    """이용 가능한 좌석 선택"""
    try:
        # SVG 좌석
        available = await find_all_by_selector(page, 'circle[fill="green"], .seat.available')
        if available:
            await human_click(page, available[0])
            await human_delay(0.5, 1.0)
            return True
        
        # Canvas 클릭
        canvas = await find_by_selectors(page, SELECTORS['seat_canvas'])
        if canvas:
            await human_click(page, canvas)
            await human_delay(0.5, 1.0)
            
            selected = await find_by_text(page, '선택', timeout=1.0)
            if selected:
                return True
    except Exception as e:
        logger.debug(f"좌석 선택 실패: {e}")
    return False


async def _click_canvas_seat(page: Page) -> bool:
    """Canvas 좌석맵 클릭 (픽셀 분석 기반)
    
    ColorThresholds 상수를 사용하여 좌석 색상 분석:
    - GREEN_MIN/RATIO: 일반 좌석 (녹색)
    - BLUE_MIN/RATIO: VIP/프리미엄 (파란색)
    - YELLOW_*: 특별석 (노란색/금색)
    
    Returns:
        bool: 좌석 클릭 성공 여부
    """
    # ColorThresholds 상수를 JavaScript에 주입
    color_script = f'''
        (() => {{
            const canvas = document.querySelector('canvas');
            if (!canvas) return {{ error: 'no_canvas' }};
            
            // 먼저 Canvas를 뷰포트로 스크롤
            canvas.scrollIntoView({{ behavior: 'instant', block: 'center' }});
            
            const ctx = canvas.getContext('2d');
            if (!ctx) return {{ error: 'no_context' }};
            
            const width = canvas.width;
            const height = canvas.height;
            
            // Canvas 위치 정보 (CORS 에러 시에도 사용 가능) + 스크롤 오프셋
            const rect = canvas.getBoundingClientRect();
            const scrollX = window.scrollX || window.pageXOffset || 0;
            const scrollY = window.scrollY || window.pageYOffset || 0;
            const baseInfo = {{
                rect: {{
                    left: rect.left,
                    top: rect.top,
                    width: rect.width,
                    height: rect.height,
                    scaleX: rect.width / width,
                    scaleY: rect.height / height,
                    scrollX: scrollX,
                    scrollY: scrollY
                }}
            }};
            
            // ColorThresholds (Python에서 주입)
            const CT = {{
                GREEN_MIN: {ColorThresholds.GREEN_MIN},
                GREEN_RATIO: {ColorThresholds.GREEN_RATIO},
                DARK_GREEN_MIN: {ColorThresholds.DARK_GREEN_MIN},
                BLUE_MIN: {ColorThresholds.BLUE_MIN},
                BLUE_RATIO: {ColorThresholds.BLUE_RATIO},
                YELLOW_R_MIN: {ColorThresholds.YELLOW_R_MIN},
                YELLOW_G_MIN: {ColorThresholds.YELLOW_G_MIN},
                YELLOW_B_MAX: {ColorThresholds.YELLOW_B_MAX}
            }};
            
            try {{
                // CORS 에러 가능 지점 - cross-origin canvas
                const imageData = ctx.getImageData(0, 0, width, height);
                const data = imageData.data;
                
                const availableSeats = [];
                const step = {Limits.CANVAS_SAMPLE_STEP};  // 샘플링 간격
                
                for (let y = 0; y < height; y += step) {{
                    for (let x = 0; x < width; x += step) {{
                        const idx = (y * width + x) * 4;
                        const r = data[idx];
                        const g = data[idx + 1];
                        const b = data[idx + 2];
                        
                        // 녹색 계열 (선택 가능 좌석) - ColorThresholds 사용
                        const isGreen = (g > CT.GREEN_MIN && g > r * CT.GREEN_RATIO && g > b * CT.GREEN_RATIO) ||
                                       (g > CT.DARK_GREEN_MIN && r < CT.DARK_GREEN_MIN && b < CT.DARK_GREEN_MIN);
                        if (isGreen) {{
                            availableSeats.push({{ x, y, type: 'available', score: g }});
                        }}
                        // 파란색/보라색 계열 (VIP/프리미엄)
                        else if (b > CT.BLUE_MIN && b > r * CT.BLUE_RATIO && b > g * 0.9) {{
                            availableSeats.push({{ x, y, type: 'premium', score: b }});
                        }}
                        // 노란색/금색 (특별석)
                        else if (r > CT.YELLOW_R_MIN && g > CT.YELLOW_G_MIN && b < CT.YELLOW_B_MAX) {{
                            availableSeats.push({{ x, y, type: 'special', score: r + g }});
                        }}
                    }}
                }}
                
                return {{
                    seats: availableSeats.slice(0, {Limits.CANVAS_MAX_SEATS}),
                    rect: baseInfo.rect
                }};
            }} catch (e) {{
                // CORS/SecurityError 시 폴백 정보 반환
                if (e.name === 'SecurityError') {{
                    return {{ error: 'cors_blocked', ...baseInfo }};
                }}
                return {{ error: e.message, ...baseInfo }};
            }}
        }})()
    '''
    
    # 1. 픽셀 분석으로 사용 가능한 좌석 찾기 (CORS 에러 처리 포함)
    seats = await evaluate_js(page, color_script)
    
    # CORS 에러 로깅
    if seats and seats.get('error') == 'cors_blocked':
        logger.debug("Canvas CORS 차단 - 폴백 모드 사용")
    
    # 픽셀 분석 성공 시
    if seats and not seats.get('error') and seats.get('seats'):
        seat_list = seats['seats']
        rect = seats['rect']
        
        # 우선순위: special > premium > available, 점수 높은 순
        type_priority = {'special': 0, 'premium': 1, 'available': 2}
        seat_list.sort(key=lambda s: (type_priority.get(s.get('type', 'available'), 3), -s.get('score', 0)))
        
        logger.info(f"🎯 {len(seat_list)}개 좌석 발견 (픽셀 분석)")
        
        for seat in seat_list[:10]:
            screen_x = rect['left'] + seat['x'] * rect['scaleX']
            screen_y = rect['top'] + seat['y'] * rect['scaleY']
            
            await page.send(cdp.input_.dispatch_mouse_event(
                type_='mousePressed', x=int(screen_x), y=int(screen_y), button='left', click_count=1
            ))
            await asyncio.sleep(0.05)
            await page.send(cdp.input_.dispatch_mouse_event(
                type_='mouseReleased', x=int(screen_x), y=int(screen_y), button='left'
            ))
            
            await asyncio.sleep(0.3)
            
            if await find_by_text(page, '선택', timeout=0.5):
                logger.info(f"✅ 좌석 선택 성공! ({screen_x:.0f}, {screen_y:.0f})")
                return True
    
    # 2. 폴백: 고정 위치 클릭
    offsets = [(0.5, 0.5), (0.3, 0.5), (0.7, 0.5), (0.5, 0.3), (0.5, 0.7), 
               (0.4, 0.4), (0.6, 0.6), (0.3, 0.3), (0.7, 0.7)]
    
    for rx, ry in offsets:
        click_script = f'''
            (() => {{
                const canvas = document.querySelector('canvas');
                if (!canvas) return false;
                const rect = canvas.getBoundingClientRect();
                const event = new MouseEvent('click', {{
                    bubbles: true, cancelable: true,
                    clientX: rect.left + rect.width * {rx},
                    clientY: rect.top + rect.height * {ry}
                }});
                canvas.dispatchEvent(event);
                return true;
            }})()
        '''
        result = await evaluate_js(page, click_script)
        if result:
            await human_delay(0.3, 0.5)
            if await find_by_text(page, '선택', timeout=0.5):
                logger.info(f"✅ Canvas 클릭 성공 ({rx}, {ry})")
                return True
    return False


async def _complete_selection(page) -> bool:
    """선택 완료 (에러 복구 포함)
    
    단계:
    1. 선택 완료 버튼
    2. 다음 버튼 (있으면)
    3. 결제하기 버튼
    
    각 단계에서 에러 발생 시 재시도
    """
    max_retries = 3
    
    for retry in range(max_retries):
        try:
            # 1단계: 선택 완료
            btn_found = False
            for btn_text in ['선택완료', '선택 완료', '좌석선택완료', '선택하기']:
                btn = await find_by_text(page, btn_text, timeout=1.5)
                if btn:
                    logger.debug(f"✓ '{btn_text}' 버튼 발견")
                    await human_click(page, btn)
                    await wait_for_navigation(page, timeout=5.0)
                    await human_delay(0.5, 1.0)
                    btn_found = True
                    break
            
            # 에러 메시지 확인
            error_msg = await _check_selection_error(page)
            if error_msg:
                logger.warning(f"⚠️ 선택 오류: {error_msg}")
                if retry < max_retries - 1:
                    logger.info(f"재시도 {retry + 2}/{max_retries}...")
                    await asyncio.sleep(1)
                    continue
                return False
            
            # 2단계: 다음
            next_btn = await find_by_text(page, '다음', timeout=2.0)
            if next_btn:
                await human_click(page, next_btn)
                await wait_for_navigation(page, timeout=5.0)
                await human_delay(0.5, 1.0)
            
            # 3단계: 결제
            for btn_text in ['결제하기', '결제', '예매하기', '주문하기']:
                btn = await find_by_text(page, btn_text, timeout=2.0)
                if btn:
                    logger.info(f"✅ '{btn_text}' 버튼 발견 - 결제 진행")
                    await human_click(page, btn)
                    return True
            
            # 버튼을 못 찾았으면 재시도
            if retry < max_retries - 1:
                logger.warning("결제 버튼 없음 - 재시도")
                await asyncio.sleep(1)
                continue
                
        except Exception as e:
            logger.warning(f"선택 완료 오류: {e}")
            if retry < max_retries - 1:
                await asyncio.sleep(1)
                continue
    
    return False


async def _check_selection_error(page) -> Optional[str]:
    """좌석 선택 에러 메시지 확인"""
    error_texts = [
        '이미 선택된 좌석',
        '선택할 수 없는 좌석',
        '매진',
        '예매가 마감',
        '시간 초과',
        '다시 선택',
        '좌석이 없습니다',
    ]
    
    for text in error_texts:
        elem = await find_by_text(page, text, timeout=0.5)
        if elem:
            return text
    
    return None


async def _wait_for_payment(page, config: Config, session_id: int, timeout_min: int = 30) -> bool:
    """결제 완료 대기 (개선된 모니터링)
    
    Args:
        page: 결제 페이지
        config: 설정
        session_id: 세션 ID
        timeout_min: 타임아웃 (분)
    
    Returns:
        bool: 결제 성공 여부
    """
    logger.info(f"[세션 {session_id}] 💳 결제 대기 ({timeout_min}분)")
    
    start_time = time.time()
    timeout_sec = timeout_min * 60
    last_notification = 0
    notification_interval = 300  # 5분마다 알림
    
    # 성공/실패 키워드
    success_keywords = ['예매 완료', '결제 완료', '예매가 완료', '결제가 완료', '예매성공']
    failure_keywords = ['결제 실패', '결제 취소', '시간 초과', '세션 만료', '예매 실패']
    warning_keywords = ['결제 대기', '결제중', '처리중']
    
    check_count = 0
    while True:
        elapsed = time.time() - start_time
        remaining_min = int((timeout_sec - elapsed) / 60)
        
        # 타임아웃 체크
        if elapsed >= timeout_sec:
            await send_telegram(config, f"[세션 {session_id}] ⏰ 결제 대기 시간 초과 ({timeout_min}분)")
            return False
        
        check_count += 1
        
        # 성공 확인
        for keyword in success_keywords:
            elem = await find_by_text(page, keyword, timeout=2.0)
            if elem:
                logger.info(f"[세션 {session_id}] 🎉 결제 성공! ('{keyword}' 감지)")
                await send_telegram(config, f"[세션 {session_id}] 🎉 예매 완료!!!")
                return True
        
        # 실패 확인
        for keyword in failure_keywords:
            elem = await find_by_text(page, keyword, timeout=1.0)
            if elem:
                logger.warning(f"[세션 {session_id}] ❌ 결제 실패 ('{keyword}' 감지)")
                await send_telegram(config, f"[세션 {session_id}] ❌ 결제 실패: {keyword}")
                return False
        
        # 세션 유효성 확인 (페이지가 살아있는지)
        try:
            page_url = await evaluate_js(page, 'window.location.href')
            if not page_url:
                logger.warning(f"[세션 {session_id}] ⚠️ 페이지 연결 끊김")
                await send_telegram(config, f"[세션 {session_id}] ⚠️ 페이지 연결 확인 필요!")
        except Exception:
            logger.warning(f"[세션 {session_id}] ⚠️ 세션 상태 확인 실패")
        
        # 진행 상태 확인
        for keyword in warning_keywords:
            elem = await find_by_text(page, keyword, timeout=0.5)
            if elem:
                logger.debug(f"[세션 {session_id}] 💳 {keyword}...")
                break
        
        # 주기적 알림 (5분마다)
        if elapsed - last_notification >= notification_interval:
            last_notification = elapsed
            logger.info(f"[세션 {session_id}] 💳 결제 대기 중... (남은 시간: {remaining_min}분, 체크: {check_count}회)")
            if remaining_min <= 10:
                await send_telegram(config, f"[세션 {session_id}] ⚠️ 결제 남은 시간: {remaining_min}분")
        
        # 대기 (처음엔 빠르게, 나중엔 느리게)
        if elapsed < 60:
            await asyncio.sleep(5)  # 첫 1분: 5초 간격
        elif elapsed < 300:
            await asyncio.sleep(10)  # 1-5분: 10초 간격
        else:
            await asyncio.sleep(15)  # 5분 이후: 15초 간격


# ============ CAPTCHA 감지 ============
async def detect_captcha(page) -> bool:
    """CAPTCHA/본인확인 감지"""
    indicators = ['본인확인', '휴대폰 인증', 'CAPTCHA', '자동입력방지', '보안문자']
    
    for indicator in indicators:
        elem = await find_by_text(page, indicator, timeout=1.0)
        if elem:
            logger.warning(f"⚠️ CAPTCHA: {indicator}")
            return True
    
    captcha_img = await find_by_selector(page, 'img[alt*="captcha"], img[src*="captcha"]')
    if captcha_img:
        logger.warning("⚠️ 이미지 CAPTCHA")
        return True
    
    return False


async def wait_captcha_solved(page, config: Config, timeout: float = 300.0) -> bool:
    """CAPTCHA 해결 대기"""
    await send_telegram(config, "⚠️ CAPTCHA! 수동 처리 필요!")
    
    start = time.time()
    while (time.time() - start) < timeout:
        await asyncio.sleep(5)
        if not await detect_captcha(page):
            logger.info("✅ CAPTCHA 해결됨")
            await send_telegram(config, "✅ CAPTCHA 해결!")
            return True
        
        elapsed = int(time.time() - start)
        if elapsed % 30 == 0:
            logger.info(f"⏳ CAPTCHA 대기 {elapsed}초...")
    
    logger.warning("⚠️ CAPTCHA 타임아웃")
    return False


# ============ 메인 플로우 ============
async def run_single_session(config: Config, session_id: int, live: bool) -> bool:
    """단일 세션 실행"""
    # 세션별 보안 로거 (비밀번호 자동 마스킹)
    secure_log = SecureLogger(logger, secrets=[config.user_pwd, config.telegram_bot_token])
    secure_log.info(f"[세션 {session_id}] 시작")
    
    browser = None
    user_data_dir = None
    try:
        # 세션별 프로필 디렉토리 (멀티 세션 충돌 방지)
        user_data_dir = os.path.join(tempfile.gettempdir(), f'bts-session-{session_id}-{int(time.time())}')
        os.makedirs(user_data_dir, exist_ok=True)
        
        # 브라우저 시작 (봇 탐지 우회 옵션)
        # User-Agent 랜덤화 (탐지 패턴 방지)
        chrome_versions = ['120.0.6099.109', '121.0.6167.85', '122.0.6261.94', '123.0.6312.58', '124.0.6367.78']
        ua_version = random.choice(chrome_versions)
        ua_platforms = [
            'Macintosh; Intel Mac OS X 10_15_7',
            'Macintosh; Intel Mac OS X 11_6_0',
            'Windows NT 10.0; Win64; x64',
        ]
        ua_platform = random.choice(ua_platforms)
        user_agent = f'Mozilla/5.0 ({ua_platform}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{ua_version} Safari/537.36'
        
        browser = await nd.start(
            headless=False,
            browser_args=[
                '--window-size=1920,1080',
                '--lang=ko-KR',
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars',
                '--disable-dev-shm-usage',
                f'--user-data-dir={user_data_dir}',
                f'--user-agent={user_agent}',
            ]
        )
        
        page = await browser.get('https://tickets.interpark.com/')
        await wait_for_navigation(page, timeout=10.0)
        
        # Stealth 설정
        await setup_stealth(page)
        await human_delay(1, 2)
        
        # 1. 로그인
        success, page = await step_login(browser, page, config)
        if not success:
            await send_telegram(config, f"[세션 {session_id}] ❌ 로그인 실패")
            return False
        
        # 2. 콘서트 페이지
        await step_navigate_concert(page, config)
        
        # 3. 오픈 대기 (실전만)
        if live:
            await step_wait_open(page, config)
        
        # 4. 예매 클릭
        success, booking_page = await step_click_booking(browser, page, config)
        if not success:
            await send_telegram(config, f"[세션 {session_id}] ❌ 예매 버튼 실패")
            return False
        
        # CAPTCHA 체크
        if await detect_captcha(booking_page):
            await wait_captcha_solved(booking_page, config)
        
        # 5. 좌석 선택
        await step_select_seat(booking_page, config)
        
        # 결제 대기 (개선된 모니터링)
        await send_telegram(config, f"[세션 {session_id}] 💳 결제 진행하세요!")
        payment_result = await _wait_for_payment(booking_page, config, session_id, timeout_min=30)
        return payment_result
        
    except KeyboardInterrupt:
        logger.info(f"[세션 {session_id}] ⛔ 중단")
        return False
    except Exception as e:
        error = mask_pwd(str(e), config)
        logger.error(f"[세션 {session_id}] 오류: {error}")
        traceback.print_exc()
        await send_telegram(config, f"[세션 {session_id}] ❌ 오류: {error}")
        return False
    finally:
        await cleanup_browser(browser, session_id, user_data_dir)


async def cleanup_browser(
    browser: Browser | None, 
    session_id: int, 
    user_data_dir: str | None = None
) -> None:
    """브라우저 완전 정리 (좀비 프로세스 + 임시 디렉토리)
    
    Args:
        browser: nodriver 브라우저 인스턴스
        session_id: 세션 ID
        user_data_dir: 정리할 사용자 데이터 디렉토리 (선택)
    """
    if not browser:
        return
    
    # 1. 정상 종료 시도
    try:
        await asyncio.wait_for(browser.stop(), timeout=Timeouts.BROWSER_STOP)
        logger.debug(f"[세션 {session_id}] 브라우저 정상 종료")
    except asyncio.TimeoutError:
        logger.warning(f"[세션 {session_id}] 브라우저 종료 타임아웃")
    except Exception as e:
        logger.warning(f"[세션 {session_id}] 브라우저 종료 실패: {e}")
    
    # 2. 프로세스 강제 종료 (psutil 사용)
    if HAS_PSUTIL:
        try:
            if hasattr(browser, '_process') and browser._process:
                pid = browser._process.pid
                try:
                    parent = psutil.Process(pid)
                    children = parent.children(recursive=True)
                    
                    for child in children:
                        try:
                            child.terminate()
                        except Exception:
                            pass
                    parent.terminate()
                    
                    # 3초 대기 후 KILL
                    gone, alive = psutil.wait_procs([parent] + children, timeout=3)
                    for p in alive:
                        try:
                            p.kill()
                        except Exception:
                            pass
                    
                    logger.info(f"[세션 {session_id}] 브라우저 강제 종료 (PID: {pid})")
                except psutil.NoSuchProcess:
                    pass
        except Exception as e:
            logger.error(f"[세션 {session_id}] 프로세스 정리 실패: {e}")
    
    # 3. 임시 사용자 데이터 디렉토리 정리 (선택적)
    if user_data_dir and os.path.exists(user_data_dir):
        try:
            import shutil
            # 짧은 대기 후 삭제 (파일 핸들 해제)
            await asyncio.sleep(1.0)
            shutil.rmtree(user_data_dir, ignore_errors=True)
            logger.debug(f"[세션 {session_id}] 임시 디렉토리 정리: {user_data_dir}")
        except Exception as e:
            logger.debug(f"[세션 {session_id}] 디렉토리 정리 실패 (무시): {e}")


# ============ 메모리 모니터링 ============
def get_memory_usage_mb() -> float | None:
    """현재 프로세스 메모리 사용량 (MB)
    
    Returns:
        float: 메모리 사용량 (MB), psutil 없으면 None
    """
    if not HAS_PSUTIL:
        return None
    
    try:
        process = psutil.Process(os.getpid())
        memory_info = process.memory_info()
        return memory_info.rss / (1024 * 1024)  # bytes to MB
    except Exception:
        return None


def check_memory_pressure(threshold_mb: float = 2048.0) -> bool:
    """메모리 압박 상태 체크
    
    Args:
        threshold_mb: 경고 임계값 (기본 2GB)
    
    Returns:
        bool: True면 메모리 압박 상태
    """
    usage = get_memory_usage_mb()
    if usage is None:
        return False
    
    if usage > threshold_mb:
        logger.warning(f"⚠️ 메모리 사용량 높음: {usage:.0f}MB > {threshold_mb:.0f}MB")
        return True
    return False


# ============ 브라우저 Health Check ============
async def check_browser_health(browser: Browser, page: Page) -> bool:
    """브라우저/페이지 상태 확인
    
    Args:
        browser: nodriver 브라우저
        page: nodriver 페이지
    
    Returns:
        bool: True면 정상
    """
    try:
        # 1. 브라우저 프로세스 확인
        if hasattr(browser, '_process') and browser._process:
            if browser._process.returncode is not None:
                logger.error("브라우저 프로세스 종료됨")
                return False
        
        # 2. 페이지 응답 확인 (간단한 JS 실행)
        result = await asyncio.wait_for(
            evaluate_js(page, '1 + 1'),
            timeout=3.0
        )
        if result != 2:
            logger.warning("페이지 응답 이상")
            return False
        
        return True
        
    except asyncio.TimeoutError:
        logger.error("브라우저 Health Check 타임아웃")
        return False
    except Exception as e:
        logger.error(f"브라우저 Health Check 실패: {e}")
        return False


async def run_multi_session(config: Config, live: bool):
    """멀티 세션 실행 (개선된 성공 감지 + 세션 복구)"""
    if config.num_sessions == 1:
        # 단일 세션도 복구 기능 적용
        success = await _run_with_recovery(config, 1, live, max_retries=2)
        if success:
            logger.info("🎉 티켓팅 성공!")
        else:
            logger.warning("😢 세션 실패")
        return
    
    logger.info(f"🚀 {config.num_sessions}개 세션 시작")
    
    tasks = [
        asyncio.create_task(
            _run_with_recovery(config, i + 1, live, max_retries=1),
            name=f"session-{i+1}"
        )
        for i in range(config.num_sessions)
    ]
    
    success_found = False
    
    # 태스크 완료 시마다 확인 (성공 시까지 대기)
    while tasks:
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        
        for task in done:
            try:
                result = task.result()
                if result:
                    logger.info(f"🎉 세션 성공! ({task.get_name()})")
                    success_found = True
                    break
                else:
                    logger.info(f"세션 실패 ({task.get_name()})")
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.debug(f"세션 예외 ({task.get_name()}): {e}")
        
        if success_found:
            break
        
        tasks = list(pending)
    
    # 남은 태스크 취소 (성공 시 또는 모두 실패 시)
    if pending:
        for task in pending:
            task.cancel()
        await asyncio.gather(*pending, return_exceptions=True)
        logger.info(f"🧹 {len(pending)}개 세션 정리 완료")
    
    if success_found:
        logger.info("🎉 티켓팅 성공!")
    else:
        logger.warning("😢 모든 세션 실패")


async def _run_with_recovery(config: Config, session_id: int, live: bool, max_retries: int = 2) -> bool:
    """세션 실행 (크래시 복구 포함)
    
    Args:
        config: 설정
        session_id: 세션 ID
        live: 실전 모드 여부
        max_retries: 최대 재시도 횟수
    
    Returns:
        bool: 성공 여부
    """
    for attempt in range(max_retries + 1):
        try:
            if attempt > 0:
                logger.info(f"[세션 {session_id}] 🔄 복구 시도 {attempt}/{max_retries}")
                await asyncio.sleep(2)  # 복구 전 짧은 대기
            
            result = await run_single_session(config, session_id, live)
            return result
            
        except asyncio.CancelledError:
            # 명시적 취소는 재시도하지 않음
            raise
        except Exception as e:
            logger.error(f"[세션 {session_id}] 치명적 오류: {e}")
            if attempt < max_retries:
                logger.info(f"[세션 {session_id}] 복구 대기 중...")
            else:
                logger.error(f"[세션 {session_id}] 최대 재시도 초과")
    
    return False


async def run_ticketing(config: Config, live: bool):
    """메인 실행"""
    logger.info("=" * 50)
    logger.info(f"🎫 BTS 티켓팅 v{__version__}")
    logger.info(f"오픈: {config.open_time}")
    logger.info(f"현재: {get_accurate_time()}")
    logger.info(f"모드: {'실전' if live else '테스트'}")
    logger.info(f"세션: {config.num_sessions}개")
    logger.info("=" * 50)
    
    # NTP 동기화
    if config.use_ntp:
        await sync_ntp_time()
    
    try:
        await run_multi_session(config, live)
    finally:
        await close_http_session()


def main():
    parser = argparse.ArgumentParser(description='BTS 티켓팅 v5')
    parser.add_argument('--test', action='store_true', help='테스트 모드')
    parser.add_argument('--live', action='store_true', help='실전 모드')
    parser.add_argument('--sessions', type=int, default=1, help='세션 수')
    args = parser.parse_args()
    
    if not args.test and not args.live:
        print("사용법: python main_nodriver_v5.py --test 또는 --live")
        print("옵션: --sessions N (멀티 세션, 1-10)")
        return
    
    try:
        config = Config.from_env()
        if args.sessions > 1:
            # 세션 수 검증 (환경변수와 동일 로직)
            config.num_sessions = max(1, min(10, args.sessions))
            if args.sessions != config.num_sessions:
                logger.warning(f"세션 수 조정: {args.sessions} → {config.num_sessions}")
    except ValueError as e:
        logger.error(f"설정 오류: {e}")
        return
    
    try:
        asyncio.run(run_ticketing(config, args.live))
    except KeyboardInterrupt:
        logger.info("⛔ 사용자 중단 (Ctrl+C)")
    except Exception as e:
        logger.error(f"❌ 치명적 오류: {e}")
        traceback.print_exc()


if __name__ == '__main__':
    main()
