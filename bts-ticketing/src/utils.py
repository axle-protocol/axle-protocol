#!/usr/bin/env python3
"""
공통 유틸리티 모듈 - BTS 티켓팅

로깅, 타이밍, 재시도, 상태 관리 등 공통 기능
"""

import os
import sys
import time
import random
import json
import threading
import functools
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional, List, Dict, Any, Callable, Set
from pathlib import Path


# ============ 로깅 ============
class Colors:
    """터미널 색상"""
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    RESET = '\033[0m'
    BOLD = '\033[1m'


def log(msg: str, session_id: int = 0, level: str = 'INFO'):
    """통합 로깅
    
    Args:
        msg: 로그 메시지
        session_id: 세션 ID (멀티세션용)
        level: 로그 레벨 (INFO, WARN, ERROR, DEBUG)
    """
    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    
    # 레벨별 색상
    level_colors = {
        'INFO': Colors.CYAN,
        'WARN': Colors.YELLOW,
        'ERROR': Colors.RED,
        'DEBUG': Colors.MAGENTA,
        'SUCCESS': Colors.GREEN,
    }
    color = level_colors.get(level, '')
    
    # 세션 ID 표시
    session_str = f"[S{session_id}]" if session_id > 0 else ""
    
    print(f"{color}[{timestamp}]{session_str} {msg}{Colors.RESET}")


# ============ 타이밍 상수 ============
class Timing:
    """타이밍 상수 (밀리초 → 초 변환됨)"""
    # 극초단위 (봇 탐지 회피용)
    MICRO = 0.03       # 30ms
    TINY = 0.08        # 80ms
    
    # 일반 대기
    SHORT = 0.2        # 200ms
    MEDIUM = 0.4       # 400ms
    LONG = 0.8         # 800ms
    EXTRA_LONG = 1.5   # 1.5s
    
    # 작업별 타임아웃
    ELEMENT_TIMEOUT = 5     # 요소 찾기
    PAGE_TIMEOUT = 30       # 페이지 로드
    LOGIN_TIMEOUT = 30      # 로그인
    BOOKING_TIMEOUT = 60    # 예매
    PAYMENT_TIMEOUT = 300   # 결제
    
    # 재시도
    MAX_RETRIES = 5


# ============ 대기 함수 ============
def adaptive_sleep(base_time: float, add_jitter: bool = True, jitter_pct: float = 0.2):
    """적응형 대기 (서버 부하 고려)
    
    Args:
        base_time: 기본 대기 시간 (초)
        add_jitter: 랜덤 지터 추가 여부
        jitter_pct: 지터 비율 (0.2 = ±20%)
    """
    if add_jitter:
        jitter = base_time * jitter_pct
        sleep_time = base_time + random.uniform(-jitter, jitter)
    else:
        sleep_time = base_time
    
    time.sleep(max(0, sleep_time))


def human_delay(min_ms: int = 50, max_ms: int = 150):
    """인간 같은 딜레이 (밀리초)"""
    time.sleep(random.uniform(min_ms / 1000, max_ms / 1000))


def wait_for_condition(
    condition: Callable[[], bool],
    timeout: float = 10,
    poll_interval: float = 0.1,
    description: str = ""
) -> bool:
    """조건이 True가 될 때까지 대기
    
    Args:
        condition: 조건 함수 (True 반환 시 종료)
        timeout: 최대 대기 시간 (초)
        poll_interval: 폴링 간격 (초)
        description: 로그용 설명
        
    Returns:
        조건 만족 여부
    """
    start = time.time()
    while time.time() - start < timeout:
        try:
            if condition():
                return True
        except:
            pass
        time.sleep(poll_interval)
    
    if description:
        log(f'⏰ 조건 대기 타임아웃: {description}', level='WARN')
    return False


# ============ 재시도 데코레이터 ============
def retry(
    max_attempts: int = 3,
    delay: float = 0.5,
    exceptions: tuple = (Exception,),
    on_retry: Callable = None
):
    """재시도 데코레이터
    
    Args:
        max_attempts: 최대 시도 횟수
        delay: 재시도 간 대기 시간
        exceptions: 재시도할 예외 타입들
        on_retry: 재시도 시 호출할 콜백
        
    Usage:
        @retry(max_attempts=3, delay=0.5)
        def flaky_function():
            ...
    """
    def decorator(func):
        @functools.wraps(func)
        def wrapper(*args, **kwargs):
            last_exception = None
            for attempt in range(max_attempts):
                try:
                    return func(*args, **kwargs)
                except exceptions as e:
                    last_exception = e
                    if attempt < max_attempts - 1:
                        if on_retry:
                            on_retry(attempt, e)
                        adaptive_sleep(delay * (attempt + 1))  # 백오프
            raise last_exception
        return wrapper
    return decorator


def retry_on_stale(func):
    """StaleElementReferenceException 재시도 데코레이터"""
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        for attempt in range(3):
            try:
                return func(*args, **kwargs)
            except Exception as e:
                if 'stale' in str(e).lower():
                    if attempt < 2:
                        human_delay(50, 100)
                        continue
                raise
    return wrapper


# ============ 에러 분류 ============
class ErrorClassifier:
    """에러 분류기"""
    
    # 재시도 가능한 에러
    RETRIABLE = [
        'timeout', 'stale', 'no such element', 'element not interactable',
        'element click intercepted', 'connection', 'network',
    ]
    
    # 치명적 에러 (재시도 불가)
    FATAL = [
        'sold out', '매진', 'session expired', 'login required',
        'access denied', 'blocked',
    ]
    
    @classmethod
    def classify(cls, error: Exception) -> tuple:
        """에러 분류
        
        Returns:
            (category, is_retriable, suggested_delay)
        """
        error_str = str(error).lower()
        
        # 치명적 에러
        for pattern in cls.FATAL:
            if pattern in error_str:
                return ('fatal', False, 0)
        
        # 재시도 가능
        for pattern in cls.RETRIABLE:
            if pattern in error_str:
                return ('retriable', True, 0.5)
        
        # 기타
        return ('unknown', True, 1.0)


# ============ 멀티 셀렉터 ============
class MultiSelector:
    """다중 셀렉터 (폴백 지원)
    
    여러 셀렉터를 순서대로 시도하여 첫 번째 성공하는 것 사용
    """
    
    def __init__(self, sb, selectors: List[str], description: str = ""):
        """
        Args:
            sb: SeleniumBase 인스턴스
            selectors: 시도할 셀렉터 목록 (우선순위 순)
            description: 로깅용 설명
        """
        self.sb = sb
        self.selectors = selectors
        self.description = description
        self._working_selector: Optional[str] = None
    
    def find_element(self, timeout: float = Timing.ELEMENT_TIMEOUT):
        """요소 찾기 (첫 번째 성공하는 셀렉터 사용)"""
        # 캐시된 셀렉터 먼저 시도
        if self._working_selector:
            try:
                elem = self.sb.find_element(self._working_selector)
                if elem and elem.is_displayed():
                    return elem
            except:
                self._working_selector = None
        
        # 모든 셀렉터 순회
        for sel in self.selectors:
            try:
                elem = self.sb.find_element(sel)
                if elem and elem.is_displayed():
                    self._working_selector = sel
                    return elem
            except:
                continue
        
        return None
    
    def find_elements(self) -> List:
        """모든 매칭 요소 찾기"""
        for sel in self.selectors:
            try:
                elements = self.sb.find_elements(sel)
                if elements:
                    return elements
            except:
                continue
        return []
    
    def click(self, timeout: float = Timing.ELEMENT_TIMEOUT) -> bool:
        """요소 클릭"""
        elem = self.find_element(timeout)
        if elem:
            try:
                elem.click()
                return True
            except:
                # JS 클릭 폴백
                try:
                    self.sb.execute_script("arguments[0].click();", elem)
                    return True
                except:
                    pass
        return False


# 셀렉터 상수
class Selectors:
    """공통 셀렉터"""
    # 프레임
    SEAT_FRAME = ['#ifrmSeat', 'iframe[name="ifrmSeat"]']
    BOOK_FRAME = ['#ifrmBookStep', 'iframe[name="ifrmBookStep"]']
    
    # 예매 버튼
    BOOK_BUTTON = [
        'a:contains("예매하기")',
        'button:contains("예매하기")',
        '[class*="booking"]',
    ]
    
    # 로그인
    EMAIL_INPUT = ['#email', 'input[type="email"]', 'input[name="email"]']
    PASSWORD_INPUT = ['#password', 'input[type="password"]']
    LOGIN_BUTTON = ['button:contains("로그인")', 'input[type="submit"]']
    
    # 좌석
    SEAT_AVAILABLE = [
        "circle[class*='seat'][class*='available']",
        "[data-seat-status='available']",
        "[class*='seat']:not([class*='sold'])",
    ]
    
    # 다음 단계
    NEXT_STEP = [
        '#NextStepImage',
        '#SmallNextBtnImage',
        'button:contains("다음")',
    ]


# ============ 상태 관리 ============
class SharedState:
    """세션 간 공유 상태 (멀티세션용)"""
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._data = {}
                    cls._instance._sets = {}
        return cls._instance
    
    def get(self, key: str, default=None):
        return self._data.get(key, default)
    
    def set(self, key: str, value):
        with self._lock:
            self._data[key] = value
    
    def add_to_set(self, set_name: str, value) -> bool:
        """세트에 값 추가 (이미 있으면 False)"""
        with self._lock:
            if set_name not in self._sets:
                self._sets[set_name] = set()
            if value in self._sets[set_name]:
                return False
            self._sets[set_name].add(value)
            return True
    
    def remove_from_set(self, set_name: str, value):
        """세트에서 값 제거"""
        with self._lock:
            if set_name in self._sets:
                self._sets[set_name].discard(value)


def get_shared_state() -> SharedState:
    """공유 상태 인스턴스 반환"""
    return SharedState()


# ============ 부분 성공 추적 ============
class PartialSuccessTracker:
    """부분 성공 상태 추적 (에러 복구용)"""
    
    def __init__(self, session_id: int = 0):
        self.session_id = session_id
        self.stages: List[Dict] = []
        self._last_stage = ""
    
    def checkpoint(self, stage: str, data: Dict = None):
        """체크포인트 저장"""
        self._last_stage = stage
        self.stages.append({
            'stage': stage,
            'timestamp': datetime.now().isoformat(),
            'data': data or {},
        })
        log(f'📍 체크포인트: {stage}', session_id=self.session_id, level='DEBUG')
    
    def get_last_stage(self) -> str:
        """마지막 완료 단계"""
        return self._last_stage
    
    def save_to_file(self, filepath: str):
        """상태를 파일로 저장"""
        try:
            with open(filepath, 'w') as f:
                json.dump({
                    'session_id': self.session_id,
                    'stages': self.stages,
                    'last_stage': self._last_stage,
                }, f, indent=2, ensure_ascii=False)
        except Exception as e:
            log(f'⚠️ 상태 저장 실패: {e}', level='WARN')
    
    def load_from_file(self, filepath: str) -> bool:
        """파일에서 상태 복구"""
        try:
            if Path(filepath).exists():
                with open(filepath, 'r') as f:
                    data = json.load(f)
                    self.stages = data.get('stages', [])
                    self._last_stage = data.get('last_stage', '')
                    return True
        except Exception as e:
            log(f'⚠️ 상태 로드 실패: {e}', level='WARN')
        return False


# ============ 서버 과부하 감지 ============
class ServerOverloadDetector:
    """서버 과부하 감지기"""
    
    def __init__(self, threshold: int = 5, window_seconds: float = 30):
        """
        Args:
            threshold: 윈도우 내 에러 수 임계값
            window_seconds: 감지 윈도우 (초)
        """
        self.threshold = threshold
        self.window = window_seconds
        self.errors: List[float] = []
        self._lock = threading.Lock()
    
    def record_error(self):
        """에러 기록"""
        now = time.time()
        with self._lock:
            self.errors.append(now)
            # 오래된 에러 제거
            self.errors = [t for t in self.errors if now - t < self.window]
    
    def is_overloaded(self) -> bool:
        """과부하 상태 확인"""
        now = time.time()
        with self._lock:
            recent = [t for t in self.errors if now - t < self.window]
            return len(recent) >= self.threshold
    
    def get_backoff_time(self) -> float:
        """백오프 시간 계산"""
        if not self.is_overloaded():
            return 0
        
        # 에러 수에 비례한 백오프
        with self._lock:
            error_count = len(self.errors)
        
        return min(30, 2 ** (error_count - self.threshold + 1))


_overload_detector: Optional[ServerOverloadDetector] = None


def get_overload_detector() -> ServerOverloadDetector:
    """과부하 감지기 인스턴스"""
    global _overload_detector
    if _overload_detector is None:
        _overload_detector = ServerOverloadDetector()
    return _overload_detector


# ============ 네트워크 복구 ============
class NetworkRecovery:
    """네트워크 연결 복구"""
    
    @staticmethod
    def reconnect_browser(sb, url: str, max_retries: int = 3) -> bool:
        """브라우저 재연결
        
        Args:
            sb: SeleniumBase 인스턴스
            url: 복구할 URL
            max_retries: 최대 재시도 횟수
            
        Returns:
            성공 여부
        """
        for attempt in range(max_retries):
            try:
                sb.uc_open_with_reconnect(url, reconnect_time=4)
                return True
            except Exception as e:
                log(f'⚠️ 재연결 실패 (시도 {attempt+1}): {e}', level='WARN')
                adaptive_sleep(2 ** attempt)  # 지수 백오프
        
        return False


# ============ 봇 탐지 회피 ============
class AntiDetection:
    """봇 탐지 회피 유틸리티"""
    
    @staticmethod
    def stealth_js(sb):
        """스텔스 JavaScript 주입"""
        try:
            sb.execute_script("""
                // webdriver 속성 숨기기
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
                
                // plugins 가짜 데이터
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5]
                });
                
                // languages 설정
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['ko-KR', 'ko', 'en-US', 'en']
                });
                
                // Chrome 속성 추가
                window.chrome = {
                    runtime: {}
                };
            """)
        except:
            pass
    
    @staticmethod
    def human_typing(sb, selector_or_elem, text: str, clear_first: bool = True):
        """인간 같은 타이핑
        
        Args:
            sb: SeleniumBase 인스턴스
            selector_or_elem: CSS 셀렉터 또는 요소
            text: 입력할 텍스트
            clear_first: 기존 내용 삭제 여부
        """
        # 요소 가져오기
        if isinstance(selector_or_elem, str):
            elem = sb.find_element(selector_or_elem)
        else:
            elem = selector_or_elem
        
        if clear_first:
            elem.clear()
        
        # 한 글자씩 타이핑 (랜덤 딜레이)
        for char in text:
            elem.send_keys(char)
            time.sleep(random.uniform(0.03, 0.08))
    
    @staticmethod
    def human_click(sb, elem, pre_delay: bool = True):
        """인간 같은 클릭
        
        Args:
            sb: SeleniumBase 인스턴스
            elem: 클릭할 요소
            pre_delay: 클릭 전 딜레이
        """
        if pre_delay:
            human_delay(30, 80)
        
        try:
            # ActionChains로 자연스러운 클릭
            from selenium.webdriver.common.action_chains import ActionChains
            actions = ActionChains(sb.driver)
            actions.move_to_element(elem)
            actions.pause(random.uniform(0.05, 0.15))
            actions.click()
            actions.perform()
        except:
            # 폴백: 직접 클릭
            elem.click()


# ============ 타이머 ============
class Timer:
    """컨텍스트 매니저 타이머"""
    
    def __init__(self, name: str = "", log_result: bool = True, session_id: int = 0):
        self.name = name
        self.log_result = log_result
        self.session_id = session_id
        self.start_time = 0
        self.elapsed = 0
    
    def __enter__(self):
        self.start_time = time.time()
        return self
    
    def __exit__(self, *args):
        self.elapsed = time.time() - self.start_time
        if self.log_result and self.name:
            log(f'⏱️ {self.name}: {self.elapsed:.2f}s', session_id=self.session_id, level='DEBUG')


# ============ 프록시 헬퍼 ============
def get_proxy_url_from_env() -> Optional[str]:
    """환경변수에서 프록시 URL 생성
    
    Returns:
        프록시 URL 또는 None
    """
    host = os.getenv('PROXY_HOST', '')
    port = os.getenv('PROXY_PORT', '')
    user = os.getenv('PROXY_USER', '')
    password = os.getenv('PROXY_PASS', '')
    
    if not all([host, port, user, password]):
        return None
    
    return f"http://{user}:{password}@{host}:{port}"


def get_proxy_dict_from_env() -> Optional[Dict[str, str]]:
    """환경변수에서 프록시 딕셔너리 생성 (SeleniumBase 형식)
    
    Returns:
        {'http': url, 'https': url} 또는 None
    """
    url = get_proxy_url_from_env()
    if url:
        return {'http': url, 'https': url}
    return None
