#!/usr/bin/env python3
"""
공통 유틸리티 모듈 - BTS 티켓팅 v3 (10점 목표)
실전 안정성 + 에러 복구 + 성능 최적화

v3 핵심 개선:
- 서버 과부하 감지 및 지수 백오프
- 네트워크 복구 자동화
- 다중 셀렉터 자동 폴백
- 세션 간 실시간 상태 공유 (Redis-like 메모리)
- 봇 탐지 회피 랜덤화
"""

import time
import threading
import random
import os
import json
from datetime import datetime
from typing import Any, Callable, Optional, List, Dict, Tuple, Union
from dataclasses import dataclass, field
from functools import wraps
from pathlib import Path
import logging
import hashlib

# ============ 타이밍 상수 (실전 최적화) ============
class Timing:
    """타이밍 상수 - 실전 티켓팅 최적화"""
    # 기본 대기 (봇 탐지 회피용 랜덤 범위)
    MICRO = 0.03       # 30ms - 최소 대기 (기존 50ms)
    TINY = 0.08        # 80ms - 버튼 클릭 후 (기존 100ms)
    SHORT = 0.2        # 200ms - DOM 업데이트 (기존 300ms)
    MEDIUM = 0.4       # 400ms - 페이지 부분 로드 (기존 500ms)
    LONG = 0.8         # 800ms - 페이지 전환 (기존 1초)
    EXTRA_LONG = 1.5   # 1.5초 - 로그인 등 (기존 2초)
    
    # 정밀 대기 임계값
    BUSY_WAIT_THRESHOLD = 0.05  # 50ms 이하면 busy-wait
    POLL_INTERVAL = 0.005       # 5ms 폴링 (기존 10ms)
    
    # 재시도 (서버 과부하 대응)
    MAX_RETRIES = 5
    RETRY_DELAY_BASE = 0.2       # 기본 재시도 딜레이
    RETRY_DELAY_MAX = 5.0        # 최대 재시도 딜레이
    RETRY_JITTER = 0.1           # 재시도 랜덤 지터
    
    # 타임아웃 (실전 최적화)
    ELEMENT_TIMEOUT = 3          # 요소 대기 (기존 5초)
    PAGE_TIMEOUT = 8             # 페이지 로드 (기존 10초)
    PAYMENT_TIMEOUT = 300
    SESSION_TIMEOUT = 300
    NTP_TIMEOUT = 1.5            # NTP (기존 2초)
    
    # 서버 과부하 대응
    OVERLOAD_BACKOFF_BASE = 1.0  # 과부하 시 기본 백오프
    OVERLOAD_BACKOFF_MAX = 30.0  # 최대 백오프
    
    # 봇 탐지 회피
    HUMAN_DELAY_MIN = 0.05       # 최소 인간 딜레이
    HUMAN_DELAY_MAX = 0.15       # 최대 인간 딜레이


# ============ 서버 에러 코드 ============
class ServerErrors:
    """인터파크 서버 에러 코드"""
    OVERLOAD_CODES = {502, 503, 504, 429}  # 과부하 관련
    RETRY_CODES = {500, 502, 503, 504, 408, 429}  # 재시도 가능
    FATAL_CODES = {401, 403, 404}  # 재시도 불가
    
    OVERLOAD_MESSAGES = [
        '서버가 혼잡합니다',
        '잠시 후 다시 시도',
        '동시 접속자가 많습니다',
        'too many requests',
        'service unavailable',
        'gateway timeout',
        '대기열',
        'queue',
    ]
    
    BOT_DETECTION_MESSAGES = [
        '비정상적인 접근',
        '자동화된 접근',
        'bot detected',
        'captcha',
        '보안 검증',
        'cloudflare',
    ]


# ============ 통합 로거 (개선) ============
_logger_cache = {}
_log_lock = threading.Lock()

def get_logger(name: str = 'ticketing', session_id: Optional[int] = None) -> logging.Logger:
    """통합 로거 (캐시됨, 스레드 안전)"""
    cache_key = f"{name}_{session_id}"
    
    if cache_key in _logger_cache:
        return _logger_cache[cache_key]
    
    with _log_lock:
        # Double-check
        if cache_key in _logger_cache:
            return _logger_cache[cache_key]
        
        logger = logging.getLogger(cache_key)
        logger.setLevel(logging.DEBUG)
        
        if not logger.handlers:
            # 콘솔 핸들러
            ch = logging.StreamHandler()
            ch.setLevel(logging.INFO)
            
            if session_id is not None:
                fmt = f'%(asctime)s.%(msecs)03d [S{session_id:02d}] %(message)s'
            else:
                fmt = '%(asctime)s.%(msecs)03d %(message)s'
            ch.setFormatter(logging.Formatter(fmt, datefmt='%H:%M:%S'))
            logger.addHandler(ch)
        
        _logger_cache[cache_key] = logger
        return logger


def log(msg: str, session_id: Optional[int] = None, level: str = 'info'):
    """간편 로깅 (기존 호환)"""
    logger = get_logger(session_id=session_id)
    getattr(logger, level, logger.info)(msg)


# ============ 서버 과부하 감지 ============
class ServerOverloadDetector:
    """서버 과부하 감지 및 적응형 백오프"""
    
    def __init__(self):
        self._lock = threading.Lock()
        self._consecutive_errors = 0
        self._last_error_time = 0.0
        self._current_backoff = Timing.OVERLOAD_BACKOFF_BASE
        self._is_overloaded = False
    
    def record_error(self, error_code: Optional[int] = None, error_msg: str = "") -> float:
        """에러 기록, 권장 대기 시간 반환"""
        with self._lock:
            now = time.time()
            
            # 과부하 에러 확인
            is_overload = False
            if error_code and error_code in ServerErrors.OVERLOAD_CODES:
                is_overload = True
            elif any(msg in error_msg.lower() for msg in ServerErrors.OVERLOAD_MESSAGES):
                is_overload = True
            
            if is_overload:
                self._consecutive_errors += 1
                self._last_error_time = now
                self._is_overloaded = True
                
                # 지수 백오프 (2^n * base, 최대 제한)
                self._current_backoff = min(
                    Timing.OVERLOAD_BACKOFF_BASE * (2 ** self._consecutive_errors),
                    Timing.OVERLOAD_BACKOFF_MAX
                )
                
                # 랜덤 지터 추가 (thundering herd 방지)
                jitter = random.uniform(0, self._current_backoff * 0.2)
                return self._current_backoff + jitter
            
            return 0.0
    
    def record_success(self):
        """성공 기록, 상태 리셋"""
        with self._lock:
            self._consecutive_errors = max(0, self._consecutive_errors - 1)
            if self._consecutive_errors == 0:
                self._current_backoff = Timing.OVERLOAD_BACKOFF_BASE
                self._is_overloaded = False
    
    @property
    def is_overloaded(self) -> bool:
        return self._is_overloaded
    
    @property
    def current_backoff(self) -> float:
        return self._current_backoff
    
    def get_stats(self) -> dict:
        with self._lock:
            return {
                'consecutive_errors': self._consecutive_errors,
                'current_backoff': self._current_backoff,
                'is_overloaded': self._is_overloaded,
            }


# 글로벌 과부하 감지기
_overload_detector = ServerOverloadDetector()


def get_overload_detector() -> ServerOverloadDetector:
    return _overload_detector


# ============ 네트워크 복구 ============
class NetworkRecovery:
    """네트워크 끊김 감지 및 자동 복구"""
    
    @staticmethod
    def is_network_error(error: Exception) -> bool:
        """네트워크 에러인지 확인"""
        error_str = str(error).lower()
        network_keywords = [
            'connection', 'timeout', 'network', 'socket',
            'refused', 'reset', 'broken pipe', 'eof',
            'ssl', 'certificate', 'dns', 'resolve',
        ]
        return any(kw in error_str for kw in network_keywords)
    
    @staticmethod
    def wait_for_network(timeout: float = 30.0, check_interval: float = 1.0) -> bool:
        """네트워크 복구 대기"""
        import socket
        
        start = time.time()
        while time.time() - start < timeout:
            try:
                # 간단한 네트워크 체크 (DNS 해석)
                socket.gethostbyname('ticket.interpark.com')
                return True
            except socket.gaierror:
                log(f'⏳ 네트워크 복구 대기... ({int(time.time() - start)}s)')
                time.sleep(check_interval)
        
        return False
    
    @staticmethod
    def reconnect_browser(sb, url: str, max_retries: int = 3) -> bool:
        """브라우저 재연결"""
        for attempt in range(max_retries):
            try:
                log(f'🔄 브라우저 재연결 시도 #{attempt + 1}')
                sb.uc_open_with_reconnect(url, reconnect_time=5)
                return True
            except Exception as e:
                if NetworkRecovery.is_network_error(e):
                    if not NetworkRecovery.wait_for_network():
                        return False
                else:
                    log(f'⚠️ 재연결 실패: {e}')
                    time.sleep(1)
        
        return False


# ============ 다중 셀렉터 폴백 ============
class MultiSelector:
    """다중 셀렉터 자동 폴백 - 셀렉터 변경 대응"""
    
    def __init__(self, sb, selectors: List[str], description: str = ""):
        """
        Args:
            sb: SeleniumBase 인스턴스
            selectors: 우선순위 순 셀렉터 리스트
            description: 로깅용 설명
        """
        self.sb = sb
        self.selectors = selectors
        self.description = description
        self._working_selector_idx = 0  # 마지막으로 작동한 셀렉터
        self._lock = threading.Lock()
    
    def find_element(self, timeout: float = Timing.ELEMENT_TIMEOUT) -> Optional[Any]:
        """첫 번째 매칭 요소 반환"""
        # 마지막으로 작동한 셀렉터부터 시도
        ordered_selectors = (
            self.selectors[self._working_selector_idx:] +
            self.selectors[:self._working_selector_idx]
        )
        
        for idx, selector in enumerate(ordered_selectors):
            try:
                elem = self.sb.find_element(selector, timeout=timeout/len(self.selectors))
                if elem and elem.is_displayed():
                    # 작동한 셀렉터 기억
                    real_idx = (self._working_selector_idx + idx) % len(self.selectors)
                    with self._lock:
                        self._working_selector_idx = real_idx
                    return elem
            except Exception:
                continue
        
        return None
    
    def find_elements(self, timeout: float = Timing.ELEMENT_TIMEOUT) -> List[Any]:
        """모든 매칭 요소 반환"""
        all_elements = []
        seen_ids = set()
        
        for selector in self.selectors:
            try:
                elements = self.sb.find_elements(selector)
                for elem in elements:
                    # 중복 제거 (같은 요소 다른 셀렉터)
                    elem_id = id(elem)
                    if elem_id not in seen_ids and elem.is_displayed():
                        seen_ids.add(elem_id)
                        all_elements.append(elem)
            except Exception:
                continue
        
        return all_elements
    
    def click(self, timeout: float = Timing.ELEMENT_TIMEOUT) -> bool:
        """첫 번째 매칭 요소 클릭"""
        elem = self.find_element(timeout)
        if elem:
            try:
                elem.click()
                return True
            except Exception as e:
                log(f'⚠️ 클릭 실패 ({self.description}): {e}')
        return False


# ============ 동적 대기 헬퍼 (개선) ============
def wait_for_condition(
    condition: Callable[[], bool],
    timeout: float = Timing.ELEMENT_TIMEOUT,
    poll_interval: float = Timing.POLL_INTERVAL,
    message: str = "",
    raise_on_timeout: bool = False
) -> bool:
    """조건 충족까지 대기 (개선: 정밀 폴링)"""
    start = time.perf_counter()
    last_poll = start
    
    while True:
        now = time.perf_counter()
        elapsed = now - start
        
        if elapsed >= timeout:
            if message:
                log(f'⚠️ 대기 타임아웃: {message} ({elapsed:.2f}s)')
            if raise_on_timeout:
                raise TimeoutError(message)
            return False
        
        if condition():
            return True
        
        # 적응형 폴링 (초반 빠르게, 후반 느리게)
        if elapsed < 0.5:
            actual_interval = poll_interval
        elif elapsed < 2.0:
            actual_interval = poll_interval * 2
        else:
            actual_interval = poll_interval * 4
        
        time_since_poll = now - last_poll
        if time_since_poll < actual_interval:
            time.sleep(actual_interval - time_since_poll)
        
        last_poll = time.perf_counter()


def adaptive_sleep(target_seconds: float, add_jitter: bool = True):
    """적응형 슬립 - 봇 탐지 회피 + 정밀 대기"""
    if target_seconds <= 0:
        return
    
    # 봇 탐지 회피용 랜덤 지터
    if add_jitter:
        jitter = random.uniform(-0.02, 0.05)  # -20ms ~ +50ms
        target_seconds = max(0.01, target_seconds + jitter)
    
    if target_seconds > Timing.BUSY_WAIT_THRESHOLD:
        # 큰 대기는 일반 sleep
        time.sleep(target_seconds - Timing.BUSY_WAIT_THRESHOLD)
        target_seconds = Timing.BUSY_WAIT_THRESHOLD
    
    # 마지막 50ms는 busy-wait (정밀)
    end_time = time.perf_counter() + target_seconds
    while time.perf_counter() < end_time:
        pass  # busy-wait


def human_delay(min_ms: float = 50, max_ms: float = 150):
    """인간 같은 랜덤 딜레이 (봇 탐지 회피)"""
    delay = random.uniform(min_ms / 1000, max_ms / 1000)
    time.sleep(delay)


def wait_until_time(target: datetime, ntp_offset: float = 0.0) -> float:
    """목표 시간까지 정밀 대기, 남은 시간 반환 (음수면 지남)"""
    while True:
        now = datetime.now()
        remaining = (target - now).total_seconds() - ntp_offset
        
        if remaining <= 0:
            return remaining
        elif remaining > 60:
            time.sleep(29)  # 30초 대신 29초
        elif remaining > 10:
            time.sleep(4.5)  # 5초 대신 4.5초
        elif remaining > 1:
            time.sleep(0.45)
        elif remaining > 0.1:
            time.sleep(0.04)
        else:
            # 마지막 100ms - busy wait
            adaptive_sleep(remaining, add_jitter=False)
            return 0.0


# ============ 세션 간 실시간 상태 공유 ============
class SharedSessionState:
    """세션 간 실시간 상태 공유 (메모리 기반)"""
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._init_state()
        return cls._instance
    
    def _init_state(self):
        self._state_lock = threading.RLock()
        self._data: Dict[str, Any] = {}
        self._listeners: Dict[str, List[Callable]] = {}
        self._version = 0
    
    def set(self, key: str, value: Any, notify: bool = True) -> int:
        """값 설정, 버전 반환"""
        with self._state_lock:
            old_value = self._data.get(key)
            self._data[key] = value
            self._version += 1
            version = self._version
        
        if notify and key in self._listeners:
            for callback in self._listeners[key]:
                try:
                    callback(key, value, old_value)
                except Exception:
                    pass
        
        return version
    
    def get(self, key: str, default: Any = None) -> Any:
        """값 조회 (lock-free 읽기)"""
        return self._data.get(key, default)
    
    def get_all(self) -> Dict[str, Any]:
        """전체 상태 복사본"""
        with self._state_lock:
            return self._data.copy()
    
    def increment(self, key: str, delta: int = 1) -> int:
        """원자적 증가"""
        with self._state_lock:
            value = self._data.get(key, 0) + delta
            self._data[key] = value
            self._version += 1
            return value
    
    def add_to_set(self, key: str, value: Any) -> bool:
        """세트에 추가, 새로 추가됐으면 True"""
        with self._state_lock:
            if key not in self._data:
                self._data[key] = set()
            if value in self._data[key]:
                return False
            self._data[key].add(value)
            self._version += 1
            return True
    
    def remove_from_set(self, key: str, value: Any) -> bool:
        """세트에서 제거"""
        with self._state_lock:
            if key not in self._data:
                return False
            if value not in self._data[key]:
                return False
            self._data[key].discard(value)
            self._version += 1
            return True
    
    def subscribe(self, key: str, callback: Callable[[str, Any, Any], None]):
        """변경 알림 구독"""
        with self._state_lock:
            if key not in self._listeners:
                self._listeners[key] = []
            self._listeners[key].append(callback)
    
    def unsubscribe(self, key: str, callback: Callable):
        """구독 취소"""
        with self._state_lock:
            if key in self._listeners:
                self._listeners[key] = [cb for cb in self._listeners[key] if cb != callback]
    
    @property
    def version(self) -> int:
        return self._version
    
    def reset(self):
        """상태 초기화"""
        with self._state_lock:
            self._data.clear()
            self._version = 0


def get_shared_state() -> SharedSessionState:
    """공유 상태 싱글톤"""
    return SharedSessionState()


# ============ Lock-Free 상태 관리 (개선) ============
class AtomicFlag:
    """Lock-free 플래그 (compare-and-swap)"""
    
    def __init__(self, initial: bool = False):
        self._value = initial
        self._lock = threading.Lock()
    
    def set(self) -> bool:
        """True로 설정, 이전 값 반환"""
        with self._lock:
            old = self._value
            self._value = True
            return old
    
    def clear(self):
        """False로 설정"""
        with self._lock:
            self._value = False
    
    def is_set(self) -> bool:
        """현재 값 (lock-free 읽기)"""
        return self._value
    
    def test_and_set(self) -> bool:
        """원자적 test-and-set, 성공하면 True"""
        with self._lock:
            if self._value:
                return False
            self._value = True
            return True
    
    def compare_and_swap(self, expected: bool, new_value: bool) -> bool:
        """CAS 연산"""
        with self._lock:
            if self._value == expected:
                self._value = new_value
                return True
            return False


class AtomicCounter:
    """Lock-free 카운터"""
    
    def __init__(self, initial: int = 0):
        self._value = initial
        self._lock = threading.Lock()
    
    def increment(self) -> int:
        with self._lock:
            self._value += 1
            return self._value
    
    def decrement(self) -> int:
        with self._lock:
            self._value -= 1
            return self._value
    
    def get(self) -> int:
        return self._value
    
    def set(self, value: int):
        with self._lock:
            self._value = value


# ============ 재시도 데코레이터 (개선: 지수 백오프) ============
def retry(
    max_attempts: int = Timing.MAX_RETRIES,
    delay: float = Timing.RETRY_DELAY_BASE,
    max_delay: float = Timing.RETRY_DELAY_MAX,
    exceptions: tuple = (Exception,),
    on_retry: Optional[Callable] = None,
    exponential: bool = True,
    jitter: bool = True
):
    """재시도 데코레이터 - 지수 백오프 + 지터"""
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            current_delay = delay
            
            for attempt in range(max_attempts):
                try:
                    result = func(*args, **kwargs)
                    # 성공 시 과부하 감지기에 알림
                    _overload_detector.record_success()
                    return result
                    
                except exceptions as e:
                    last_exception = e
                    
                    if attempt < max_attempts - 1:
                        # 과부하 감지
                        error_code = getattr(e, 'status_code', None) or getattr(e, 'code', None)
                        backoff = _overload_detector.record_error(error_code, str(e))
                        
                        if backoff > 0:
                            current_delay = backoff
                            log(f'⚠️ 서버 과부하 감지, {current_delay:.1f}s 대기...')
                        elif exponential:
                            current_delay = min(delay * (2 ** attempt), max_delay)
                        
                        # 지터 추가
                        if jitter:
                            actual_delay = current_delay * (1 + random.uniform(-Timing.RETRY_JITTER, Timing.RETRY_JITTER))
                        else:
                            actual_delay = current_delay
                        
                        if on_retry:
                            on_retry(attempt, e, actual_delay)
                        
                        time.sleep(actual_delay)
            
            raise last_exception
        return wrapper
    return decorator


def retry_on_stale(func):
    """StaleElementReference 자동 재시도"""
    @wraps(func)
    def wrapper(*args, **kwargs):
        for _ in range(3):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                if 'stale' in str(e).lower():
                    time.sleep(0.1)
                    continue
                raise
        return func(*args, **kwargs)
    return wrapper


# ============ 성능 측정 ============
class Timer:
    """성능 측정 컨텍스트 매니저"""
    
    def __init__(self, name: str = "", log_result: bool = True, warn_threshold_ms: float = 1000):
        self.name = name
        self.log_result = log_result
        self.warn_threshold_ms = warn_threshold_ms
        self.start = 0.0
        self.elapsed = 0.0
    
    def __enter__(self):
        self.start = time.perf_counter()
        return self
    
    def __exit__(self, *args):
        self.elapsed = time.perf_counter() - self.start
        if self.log_result and self.name:
            ms = self.elapsed * 1000
            if ms > self.warn_threshold_ms:
                log(f'⚠️ {self.name}: {ms:.1f}ms (느림!)')
            else:
                log(f'⏱️ {self.name}: {ms:.1f}ms')


# ============ 부분 성공 상태 저장 ============
class PartialSuccessTracker:
    """부분 성공 상태 추적 (좌석 선택까지 됐을 때 등)"""
    
    def __init__(self, session_id: int):
        self.session_id = session_id
        self._lock = threading.Lock()
        self._checkpoints: Dict[str, Dict[str, Any]] = {}
        self._current_stage = ""
        self._start_time = time.time()
    
    def checkpoint(self, stage: str, data: Optional[Dict] = None) -> None:
        """체크포인트 저장"""
        with self._lock:
            self._current_stage = stage
            self._checkpoints[stage] = {
                'timestamp': time.time(),
                'elapsed': time.time() - self._start_time,
                'data': data or {},
            }
            log(f'📍 체크포인트: {stage}', session_id=self.session_id)
    
    def get_checkpoint(self, stage: str) -> Optional[Dict]:
        """체크포인트 조회"""
        return self._checkpoints.get(stage)
    
    def get_last_stage(self) -> str:
        """마지막 성공 단계"""
        return self._current_stage
    
    def can_resume_from(self, stage: str) -> bool:
        """해당 단계부터 재개 가능 여부"""
        return stage in self._checkpoints
    
    def save_to_file(self, filepath: str):
        """파일로 저장 (세션 간 공유용)"""
        with self._lock:
            data = {
                'session_id': self.session_id,
                'current_stage': self._current_stage,
                'checkpoints': {
                    k: {**v, 'timestamp': v['timestamp']}
                    for k, v in self._checkpoints.items()
                },
                'saved_at': datetime.now().isoformat(),
            }
        
        Path(filepath).parent.mkdir(parents=True, exist_ok=True)
        with open(filepath, 'w') as f:
            json.dump(data, f, indent=2, default=str)
    
    @classmethod
    def load_from_file(cls, filepath: str, session_id: int) -> 'PartialSuccessTracker':
        """파일에서 로드"""
        tracker = cls(session_id)
        try:
            with open(filepath) as f:
                data = json.load(f)
            tracker._current_stage = data.get('current_stage', '')
            tracker._checkpoints = data.get('checkpoints', {})
        except Exception:
            pass
        return tracker


# ============ 봇 탐지 회피 ============
class AntiDetection:
    """봇 탐지 회피 유틸리티"""
    
    # 인간 같은 마우스 이동 패턴
    MOUSE_PATTERNS = [
        'linear',
        'ease_in',
        'ease_out', 
        'ease_in_out',
    ]
    
    @staticmethod
    def random_user_agent() -> str:
        """랜덤 User-Agent"""
        chrome_versions = ['120.0.0.0', '121.0.0.0', '122.0.0.0', '123.0.0.0']
        os_versions = [
            'Windows NT 10.0; Win64; x64',
            'Macintosh; Intel Mac OS X 10_15_7',
            'Macintosh; Intel Mac OS X 14_0',
        ]
        
        chrome = random.choice(chrome_versions)
        os_ver = random.choice(os_versions)
        return f'Mozilla/5.0 ({os_ver}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/{chrome} Safari/537.36'
    
    @staticmethod
    def random_viewport() -> Tuple[int, int]:
        """랜덤 뷰포트 크기"""
        viewports = [
            (1920, 1080),
            (1366, 768),
            (1536, 864),
            (1440, 900),
            (1280, 720),
        ]
        return random.choice(viewports)
    
    @staticmethod
    def human_typing(sb, selector: str, text: str, clear_first: bool = True):
        """인간처럼 타이핑 (봇 탐지 회피)"""
        try:
            elem = sb.find_element(selector)
            if clear_first:
                elem.clear()
            
            for char in text:
                elem.send_keys(char)
                # 랜덤 타이핑 딜레이 (50-150ms)
                time.sleep(random.uniform(0.05, 0.15))
        except Exception as e:
            # 폴백: 일반 타이핑
            sb.type(selector, text)
    
    @staticmethod
    def human_click(sb, element, add_hover: bool = True):
        """인간처럼 클릭 (호버 후 클릭)"""
        try:
            if add_hover:
                # 호버 먼저
                sb.execute_script("arguments[0].scrollIntoView({behavior: 'smooth', block: 'center'});", element)
                human_delay(100, 300)
            
            element.click()
            human_delay(50, 150)
        except Exception:
            element.click()
    
    @staticmethod
    def stealth_js(sb):
        """브라우저 스텔스 JavaScript 주입"""
        stealth_script = """
        // Webdriver 속성 숨기기
        Object.defineProperty(navigator, 'webdriver', {get: () => undefined});
        
        // Chrome 속성 위장
        window.chrome = {runtime: {}};
        
        // 플러그인 위장
        Object.defineProperty(navigator, 'plugins', {
            get: () => [1, 2, 3, 4, 5]
        });
        
        // 언어 설정
        Object.defineProperty(navigator, 'languages', {
            get: () => ['ko-KR', 'ko', 'en-US', 'en']
        });
        
        // Permission API 위장
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission }) :
                originalQuery(parameters)
        );
        """
        try:
            sb.execute_script(stealth_script)
        except Exception:
            pass


# ============ 공통 셀렉터 (다중 폴백) ============
class Selectors:
    """공통 셀렉터 상수 - 다중 폴백 지원"""
    
    # 프레임
    SEAT_FRAME = ['#ifrmSeat', 'iframe[name="ifrmSeat"]', 'iframe[src*="seat"]']
    SEAT_DETAIL_FRAME = ['#ifrmSeatDetail', 'iframe[name="ifrmSeatDetail"]']
    BOOK_STEP_FRAME = ['#ifrmBookStep', 'iframe[name="ifrmBookStep"]']
    
    # 버튼 (다중 셀렉터)
    NEXT_STEP = [
        '#NextStepImage',
        '#SmallNextBtnImage',
        '#LargeNextBtnImage',
        'button:contains("다음")',
        'a:contains("다음")',
        '[class*="next"][class*="btn"]',
    ]
    
    CLOSE_MODAL = [
        '[class*="close"]',
        '[aria-label*="close"]',
        '.modal-close',
        'button:contains("닫기")',
        '[class*="popup"] [class*="close"]',
    ]
    
    CONFIRM_MODAL = [
        'button:contains("확인하고 예매하기")',
        'button:contains("확인")',
        '[class*="confirm"]',
        '[class*="agree"]',
    ]
    
    # 좌석 (다중 셀렉터)
    SEAT_AVAILABLE = [
        "circle[class*='seat'][class*='available']",
        "circle[class*='seat']:not([class*='sold']):not([class*='disabled'])",
        "rect[class*='seat'][class*='available']",
        "rect[class*='seat']:not([class*='sold'])",
        "[class*='seat']:not([class*='sold']):not([class*='disabled'])",
        "[data-seat-status='available']",
        "[data-available='true']",
        "img[src*='seat'][src*='on']",
        "img[src*='available']",
        "[class*='standing'][class*='available']",
    ]
    
    SEAT_SOLD = [
        "[class*='sold']",
        "[class*='disabled']",
        "img[src*='off']",
        "[data-seat-status='sold']",
    ]
    
    # 예매 버튼
    BOOK_BUTTON = [
        'a:contains("예매하기")',
        'button:contains("예매하기")',
        '[class*="booking"]',
        '[class*="reservation"]',
    ]
    
    # 결제
    AGREE_ALL = [
        '#checkAll',
        '#agreeAll',
        'input[id*="agreeAll"]',
        'input[name*="agreeAll"]',
        '[class*="agree"][class*="all"]',
    ]
    
    PAY_BUTTON = [
        'button:contains("결제하기")',
        'a:contains("결제하기")',
        '#LargeNextBtnImage',
        '[class*="pay"][class*="btn"]',
    ]
    
    # 로그인
    EMAIL_INPUT = [
        '#email',
        'input[type="email"]',
        'input[name="email"]',
        'input[placeholder*="이메일"]',
    ]
    
    PASSWORD_INPUT = [
        '#password',
        'input[type="password"]',
        'input[name="password"]',
    ]
    
    LOGIN_BUTTON = [
        'button:contains("로그인")',
        'input[type="submit"]',
        '[class*="login"][class*="btn"]',
    ]


# ============ 좌석 사전 분석 ============
class SeatPreAnalyzer:
    """오픈 전 좌석 구조 사전 분석"""
    
    def __init__(self, sb):
        self.sb = sb
        self._seat_structure: Dict[str, Any] = {}
        self._analyzed = False
    
    def analyze(self, concert_url: str) -> Dict[str, Any]:
        """좌석 구조 분석 (오픈 전 실행)"""
        if self._analyzed:
            return self._seat_structure
        
        log('🔍 좌석 구조 사전 분석 시작...')
        
        try:
            # 좌석 선택 페이지 접근 시도 (실패해도 일부 정보 수집)
            result = {
                'zones': [],
                'seat_selectors_found': [],
                'seat_map_type': None,  # 'svg', 'canvas', 'table'
                'estimated_total_seats': 0,
                'analyzed_at': datetime.now().isoformat(),
            }
            
            # DOM 구조 분석
            for selector_name, selectors in [
                ('svg', ['svg[id*="seat"]', 'svg[class*="seat"]']),
                ('canvas', ['canvas[id*="seat"]', 'canvas[class*="seat"]']),
                ('table', ['table[id*="seat"]', '[class*="seat-table"]']),
            ]:
                for sel in selectors:
                    try:
                        elem = self.sb.find_element(sel)
                        if elem:
                            result['seat_map_type'] = selector_name
                            break
                    except:
                        pass
                if result['seat_map_type']:
                    break
            
            # 작동하는 좌석 셀렉터 찾기
            for sel in Selectors.SEAT_AVAILABLE:
                try:
                    elems = self.sb.find_elements(sel)
                    if elems:
                        result['seat_selectors_found'].append({
                            'selector': sel,
                            'count': len(elems),
                        })
                except:
                    pass
            
            self._seat_structure = result
            self._analyzed = True
            
            log(f'✅ 사전 분석 완료: 맵타입={result["seat_map_type"]}, '
                f'셀렉터={len(result["seat_selectors_found"])}개')
            
            return result
            
        except Exception as e:
            log(f'⚠️ 사전 분석 실패: {e}')
            return {}
    
    def get_best_selectors(self) -> List[str]:
        """가장 효과적인 셀렉터 반환 (분석 기반)"""
        if not self._seat_structure.get('seat_selectors_found'):
            return Selectors.SEAT_AVAILABLE
        
        # 가장 많은 요소를 찾은 셀렉터 우선
        sorted_selectors = sorted(
            self._seat_structure['seat_selectors_found'],
            key=lambda x: x['count'],
            reverse=True
        )
        
        return [s['selector'] for s in sorted_selectors]


# ============ 에러 분류 ============
class ErrorClassifier:
    """에러 분류 및 적절한 대응 결정"""
    
    @staticmethod
    def classify(error: Exception) -> Tuple[str, bool, float]:
        """
        에러 분류
        Returns: (카테고리, 재시도가능여부, 권장대기시간)
        """
        error_str = str(error).lower()
        
        # 네트워크 에러
        if NetworkRecovery.is_network_error(error):
            return ('network', True, 2.0)
        
        # 서버 과부하
        if any(msg in error_str for msg in ServerErrors.OVERLOAD_MESSAGES):
            return ('overload', True, _overload_detector.current_backoff)
        
        # 봇 탐지
        if any(msg in error_str for msg in ServerErrors.BOT_DETECTION_MESSAGES):
            return ('bot_detected', False, 60.0)  # 수동 개입 필요
        
        # 요소 못 찾음 (셀렉터 변경?)
        if 'no such element' in error_str or 'not found' in error_str:
            return ('element_not_found', True, 0.5)
        
        # Stale element
        if 'stale' in error_str:
            return ('stale', True, 0.1)
        
        # 타임아웃
        if 'timeout' in error_str:
            return ('timeout', True, 1.0)
        
        # 알 수 없음
        return ('unknown', True, 1.0)


# 편의 함수들
def create_multi_selector(sb, selectors: Union[str, List[str]], desc: str = "") -> MultiSelector:
    """MultiSelector 생성 헬퍼"""
    if isinstance(selectors, str):
        selectors = [selectors]
    return MultiSelector(sb, selectors, desc)
