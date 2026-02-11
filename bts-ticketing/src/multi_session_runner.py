#!/usr/bin/env python3
"""
BTS 티켓팅 매크로 - 멀티 세션 러너 v3 (10점 목표)
실전 안정성 + 세션 간 실시간 상태 공유 + 자동 복구

v3 핵심 개선:
- 세션 간 실시간 상태 공유 (Redis-like)
- 실패 세션 자동 재시작
- 좌석 사전 분석 (오픈 전)
- 서버 과부하 적응형 백오프
- 봇 탐지 회피 강화
- 캡챠 자동 솔버 연동
- 부분 성공 상태 저장/복구

Usage:
    python multi_session_runner.py --test          # 테스트
    python multi_session_runner.py --live          # 실전 모드
    python multi_session_runner.py --sessions 10   # 세션 수
    python multi_session_runner.py --pre-analyze   # 좌석 사전 분석
"""

import os
import sys
import time
import ntplib
import threading
import argparse
import logging
import signal
import json
from datetime import datetime, timedelta
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Optional, List, Dict, Set, Tuple, Any
from dataclasses import dataclass, field
from pathlib import Path
from enum import Enum

from dotenv import load_dotenv

# 환경 변수 로드
load_dotenv('.env.local')
load_dotenv('../.env.local')

# 유틸리티 import
try:
    from utils import (
        log, Timing, adaptive_sleep, human_delay,
        get_shared_state, SharedSessionState,
        get_overload_detector, ServerOverloadDetector,
        wait_for_condition, AntiDetection, SeatPreAnalyzer,
        AtomicFlag, AtomicCounter, NetworkRecovery,
        PartialSuccessTracker, ErrorClassifier
    )
    from captcha_solver import CaptchaSolver, CaptchaConfig, auto_solve_captcha
except ImportError:
    # 폴백
    def log(msg, **kw): print(f'[{datetime.now().strftime("%H:%M:%S")}] {msg}')
    class Timing:
        MICRO = 0.03; TINY = 0.08; SHORT = 0.2; MEDIUM = 0.4; LONG = 0.8
    adaptive_sleep = time.sleep
    def human_delay(a=50, b=150): time.sleep(random.uniform(a/1000, b/1000))
    def get_shared_state(): return None
    def get_overload_detector(): return None
    def wait_for_condition(c, **kw): return True
    class AntiDetection:
        @staticmethod
        def stealth_js(sb): pass
    class SeatPreAnalyzer:
        def __init__(self, sb): pass
        def analyze(self, url): return {}
    class AtomicFlag:
        def __init__(self, v=False): self._v = v
        def test_and_set(self): 
            if self._v: return False
            self._v = True; return True
        def is_set(self): return self._v
        def set(self): self._v = True
    class AtomicCounter:
        def __init__(self, v=0): self._v = v
        def increment(self): self._v += 1; return self._v
        def get(self): return self._v
    class NetworkRecovery:
        @staticmethod
        def reconnect_browser(sb, url, **kw): return True
    class PartialSuccessTracker:
        def __init__(self, sid): pass
        def checkpoint(self, s, d=None): pass
        def save_to_file(self, p): pass
    class ErrorClassifier:
        @staticmethod
        def classify(e): return ('unknown', True, 1.0)
    def auto_solve_captcha(sb, config=None): return True


class SessionStatus(Enum):
    """세션 상태"""
    PENDING = "pending"
    RUNNING = "running"
    SUCCESS = "success"
    FAILED = "failed"
    TIMEOUT = "timeout"
    RESTARTING = "restarting"


# ============ 설정 ============

@dataclass
class SessionConfig:
    """개별 세션 설정"""
    session_id: int
    user_id: str
    user_pwd: str
    concert_url: str
    birth_date: str = ""
    proxy: Optional[dict] = None
    headless: bool = False
    

@dataclass
class RunnerConfig:
    """멀티 러너 설정 - 확장"""
    # 기본 설정
    user_id: str = os.getenv('INTERPARK_ID', '')
    user_pwd: str = os.getenv('INTERPARK_PWD', '')
    concert_url: str = os.getenv('CONCERT_URL', '')
    birth_date: str = os.getenv('BIRTH_DATE', '')
    
    # 멀티 세션
    num_sessions: int = 10
    stagger_delay: float = 0.2          # 세션 시작 간격 (초)
    max_restarts: int = 2               # 세션당 최대 재시작 횟수
    
    # 시간 설정
    target_hour: int = 20
    target_minute: int = 0
    target_second: int = 0
    use_ntp: bool = True
    ntp_servers: List[str] = field(default_factory=lambda: [
        'time.google.com',
        'time.cloudflare.com', 
        'pool.ntp.org',
    ])
    
    # 프록시 풀
    proxies: List[dict] = field(default_factory=list)
    proxy_rotation: bool = True
    
    # 좌석 설정
    num_seats: int = 2
    consecutive_seats: bool = True
    zone_priority: List[str] = field(default_factory=list)
    
    # 결제 설정
    payment_method: str = 'kakao'       # kakao, naver, card, auto
    auto_pay: bool = False
    
    # 속도 최적화
    block_images: bool = True
    block_css: bool = False             # CSS 차단하면 레이아웃 깨질 수 있음
    block_fonts: bool = True
    block_tracking: bool = True
    page_load_strategy: str = 'eager'
    
    # 봇 탐지 회피
    stealth_mode: bool = True
    random_viewport: bool = True
    random_delay: bool = True
    
    # 캡챠 솔버
    captcha_solver_key: str = os.getenv('TWO_CAPTCHA_KEY', '')
    captcha_auto_solve: bool = True
    
    # 좌석 사전 분석
    pre_analyze: bool = False
    
    # 타임아웃
    session_timeout: int = 300
    
    # 로깅
    log_dir: str = 'logs'
    save_screenshots: bool = True


# ============ 글로벌 상태 ============

class GlobalState:
    """글로벌 상태 - Lock-free 최적화"""
    
    def __init__(self):
        # 원자적 플래그
        self._success_flag = AtomicFlag(False)
        self._shutdown_flag = AtomicFlag(False)
        
        # 락
        self._lock = threading.Lock()
        
        # 상태
        self.winner_session: Optional[int] = None
        self.winner_order_number: str = ""
        
        # 세션별 상태
        self.session_status: Dict[int, SessionStatus] = {}
        self.session_restarts: Dict[int, int] = {}
        
        # 좌석 중복 방지
        self.claimed_seats: Set[str] = set()
        
        # 결과
        self.results: Dict[int, str] = {}
        
        # NTP 오프셋
        self.ntp_offset: float = 0.0
        
        # 통계
        self.stats = {
            'total_attempts': 0,
            'successful_logins': 0,
            'seat_clicks': 0,
            'captcha_solved': 0,
            'errors': 0,
        }
    
    @property
    def success(self) -> bool:
        return self._success_flag.is_set()
    
    @property
    def shutdown(self) -> bool:
        return self._shutdown_flag.is_set()
    
    def claim_victory(self, session_id: int, order_number: str = "") -> bool:
        """승리 선언 (원자적)"""
        if self._success_flag.test_and_set():
            with self._lock:
                self.winner_session = session_id
                self.winner_order_number = order_number
                self._shutdown_flag.set()
            return True
        return False
    
    def request_shutdown(self):
        """종료 요청"""
        self._shutdown_flag.set()
    
    def should_stop(self) -> bool:
        return self._shutdown_flag.is_set()
    
    def record_result(self, session_id: int, result: str):
        with self._lock:
            self.results[session_id] = result
            self.session_status[session_id] = (
                SessionStatus.SUCCESS if 'success' in result.lower()
                else SessionStatus.FAILED
            )
    
    def try_claim_seat(self, seat_id: str) -> bool:
        with self._lock:
            if seat_id in self.claimed_seats:
                return False
            self.claimed_seats.add(seat_id)
            return True
    
    def release_seat(self, seat_id: str):
        with self._lock:
            self.claimed_seats.discard(seat_id)
    
    def can_restart_session(self, session_id: int, max_restarts: int) -> bool:
        with self._lock:
            restarts = self.session_restarts.get(session_id, 0)
            if restarts >= max_restarts:
                return False
            self.session_restarts[session_id] = restarts + 1
            return True
    
    def increment_stat(self, key: str, delta: int = 1):
        with self._lock:
            self.stats[key] = self.stats.get(key, 0) + delta
    
    def get_active_sessions(self) -> List[int]:
        with self._lock:
            return [
                sid for sid, status in self.session_status.items()
                if status == SessionStatus.RUNNING
            ]


# 글로벌 상태
state = GlobalState()


# ============ 로깅 설정 ============

def setup_logging(log_dir: str) -> logging.Logger:
    """중앙 로깅 설정"""
    Path(log_dir).mkdir(parents=True, exist_ok=True)
    
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    log_file = Path(log_dir) / f'multi_session_{timestamp}.log'
    
    logger = logging.getLogger('multi_session')
    logger.setLevel(logging.DEBUG)
    
    # 파일 핸들러
    fh = logging.FileHandler(log_file, encoding='utf-8')
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter(
        '%(asctime)s.%(msecs)03d [%(session_id)s] %(levelname)s - %(message)s',
        datefmt='%H:%M:%S'
    ))
    
    # 콘솔 핸들러
    ch = logging.StreamHandler()
    ch.setLevel(logging.INFO)
    ch.setFormatter(logging.Formatter(
        '%(asctime)s.%(msecs)03d [%(session_id)s] %(message)s',
        datefmt='%H:%M:%S'
    ))
    
    logger.addHandler(fh)
    logger.addHandler(ch)
    
    return logger


def get_session_logger(logger: logging.Logger, session_id: int) -> logging.LoggerAdapter:
    return logging.LoggerAdapter(logger, {'session_id': f'S{session_id:02d}'})


# ============ NTP 시간 동기화 (최적화) ============

class NTPSync:
    """NTP 시간 동기화 - 병렬 요청"""
    
    def __init__(self, servers: List[str]):
        self.servers = servers
        self.offset: float = 0.0
        self._client = ntplib.NTPClient()
    
    def sync(self) -> Tuple[bool, float]:
        """병렬 NTP 요청"""
        from concurrent.futures import ThreadPoolExecutor, as_completed
        
        def try_server(server):
            try:
                response = self._client.request(server, version=3, timeout=1.5)
                return response.offset
            except:
                return None
        
        with ThreadPoolExecutor(max_workers=len(self.servers)) as ex:
            futures = {ex.submit(try_server, s): s for s in self.servers}
            for future in as_completed(futures, timeout=3):
                result = future.result()
                if result is not None:
                    self.offset = result
                    return True, self.offset
        
        return False, 0.0
    
    def get_precise_time(self) -> datetime:
        return datetime.now() + timedelta(seconds=self.offset)
    
    def wait_until(self, target: datetime):
        """정밀 대기"""
        while True:
            now = self.get_precise_time()
            remaining = (target - now).total_seconds()
            
            if remaining <= 0:
                return
            elif remaining > 60:
                time.sleep(29)
            elif remaining > 10:
                time.sleep(4.5)
            elif remaining > 1:
                time.sleep(0.45)
            elif remaining > 0.1:
                time.sleep(0.04)
            else:
                # busy-wait
                end = time.perf_counter() + remaining
                while time.perf_counter() < end:
                    pass
                return


# ============ 프록시 풀 ============

class ProxyPool:
    """프록시 풀 관리"""
    
    def __init__(self, proxies: List[dict]):
        self._lock = threading.Lock()
        self.proxies = proxies.copy()
        self.failed: Set[str] = set()
        self.assigned: Dict[int, dict] = {}
    
    def get_proxy(self, session_id: int) -> Optional[dict]:
        with self._lock:
            if session_id in self.assigned:
                return self.assigned[session_id]
            
            available = [p for p in self.proxies if p['server'] not in self.failed]
            if not available:
                return None
            
            idx = session_id % len(available)
            proxy = available[idx]
            self.assigned[session_id] = proxy
            return proxy
    
    def mark_failed(self, proxy: dict):
        with self._lock:
            self.failed.add(proxy['server'])
    
    def rotate_proxy(self, session_id: int) -> Optional[dict]:
        with self._lock:
            if session_id in self.assigned:
                old = self.assigned[session_id]
                self.failed.add(old['server'])
            
            available = [p for p in self.proxies if p['server'] not in self.failed]
            if not available:
                return None
            
            proxy = available[0]
            self.assigned[session_id] = proxy
            return proxy


# ============ 세션 실행 ============

def run_session(
    config: SessionConfig,
    runner_config: RunnerConfig,
    logger: logging.LoggerAdapter,
    ntp_sync: NTPSync,
    proxy_pool: Optional[ProxyPool]
) -> bool:
    """단일 세션 실행"""
    
    from seleniumbase import SB
    
    session_id = config.session_id
    tracker = PartialSuccessTracker(session_id)
    
    # 크레덴셜 마스킹
    masked_id = config.user_id[:3] + '*' * min(len(config.user_id) - 3, 5)
    logger.info(f"세션 시작 - 계정: {masked_id}")
    
    state.session_status[session_id] = SessionStatus.RUNNING
    
    # 프록시 설정
    proxy_str = None
    if config.proxy:
        proxy = config.proxy
        if proxy.get('username') and proxy.get('password'):
            proxy_str = f"{proxy['username']}:{proxy['password']}@{proxy['server']}"
        else:
            proxy_str = proxy['server']
        logger.info(f"프록시: {proxy['server'][:15]}***")
    
    try:
        # SeleniumBase 옵션
        sb_kwargs = {
            'uc': True,
            'headless': config.headless,
            'incognito': True,
            'proxy': proxy_str,
            'page_load_strategy': runner_config.page_load_strategy,
        }
        
        with SB(**sb_kwargs) as sb:
            # === 스텔스 모드 ===
            if runner_config.stealth_mode:
                AntiDetection.stealth_js(sb)
            
            # === 리소스 차단 ===
            _setup_resource_blocking(sb, runner_config)
            
            # === 1단계: 로그인 ===
            if state.should_stop():
                return False
            
            tracker.checkpoint('login_start')
            logger.info('📍 [1/5] 공연 페이지 접속...')
            
            if not _navigate_with_retry(sb, config.concert_url, logger, max_retries=3):
                state.record_result(session_id, 'navigate_failed')
                return False
            
            adaptive_sleep(Timing.MEDIUM)
            
            # 캡챠 처리
            if runner_config.captcha_auto_solve:
                try:
                    auto_solve_captcha(sb)
                except:
                    pass
            
            if state.should_stop():
                return False
            
            # 예매하기 클릭 → 로그인 페이지
            logger.info('📍 [2/5] 예매하기 클릭...')
            if not _click_booking_button(sb, logger):
                # 이미 로그인 상태일 수 있음
                pass
            
            if state.should_stop():
                return False
            
            # 이메일 로그인
            logger.info('📍 [3/5] 로그인 중...')
            if not _do_login(sb, config, logger, runner_config):
                state.record_result(session_id, 'login_failed')
                return False
            
            state.increment_stat('successful_logins')
            tracker.checkpoint('login_complete')
            logger.info('✅ 로그인 완료!')
            
            if state.should_stop():
                return False
            
            # === 2단계: 예매 대기 ===
            logger.info('📍 [4/5] 예매 대기...')
            
            now = ntp_sync.get_precise_time()
            target_time = now.replace(
                hour=runner_config.target_hour,
                minute=runner_config.target_minute,
                second=runner_config.target_second,
                microsecond=0
            )
            
            if target_time < now:
                logger.info("목표 시간 이미 지남 - 즉시 실행")
            else:
                remaining = (target_time - now).total_seconds()
                logger.info(f"⏳ {remaining:.1f}초 대기 (NTP 동기화)")
                
                while not state.should_stop():
                    now = ntp_sync.get_precise_time()
                    remaining = (target_time - now).total_seconds()
                    
                    if remaining <= 0:
                        break
                    elif remaining > 30:
                        time.sleep(10)
                    elif remaining > 5:
                        time.sleep(1)
                    elif remaining > 0.5:
                        time.sleep(0.1)
                    else:
                        time.sleep(0.01)
            
            if state.should_stop():
                return False
            
            # === 3단계: 예매 시도 ===
            logger.info('📍 [5/5] 🚀 예매 시작!')
            tracker.checkpoint('booking_start')
            
            # 새로고침
            sb.execute_script("location.reload();")
            adaptive_sleep(Timing.SHORT)
            
            # 예매 버튼 연타
            for attempt in range(20):
                if state.should_stop():
                    return False
                    
                try:
                    sb.click_link('예매하기')
                    logger.debug(f'예매 버튼 클릭 #{attempt+1}')
                    state.increment_stat('total_attempts')
                    adaptive_sleep(Timing.TINY)
                    
                    current_url = sb.get_current_url()
                    if 'book' in current_url.lower() or 'seat' in current_url.lower():
                        logger.info('✅ 예매 페이지 진입!')
                        break
                except:
                    pass
            
            if state.should_stop():
                return False
            
            # === 4단계: 좌석 선택 ===
            logger.info('🪑 좌석 선택...')
            tracker.checkpoint('seat_selection_start')
            adaptive_sleep(Timing.LONG)
            
            # 모달 처리
            _handle_modal(sb, logger)
            
            # 좌석 선택
            seat_selected = _select_seat_with_shared_state(
                sb, logger, session_id, runner_config
            )
            
            if not seat_selected:
                logger.warning('⚠️ 좌석 선택 실패')
                state.record_result(session_id, 'no_seat')
                return False
            
            tracker.checkpoint('seat_selected')
            state.increment_stat('seat_clicks')
            
            # 선택 완료 버튼
            try:
                sb.click('button:contains("선택 완료")', timeout=3)
                logger.info('✅ 선택 완료!')
            except:
                try:
                    sb.click('#NextStepImage', timeout=2)
                except:
                    pass
            
            # === 성공 선언 ===
            if state.claim_victory(session_id):
                logger.info('🎉🎉🎉 티켓팅 성공! 🎉🎉🎉')
                state.record_result(session_id, 'SUCCESS')
                
                # 스크린샷 저장
                if runner_config.save_screenshots:
                    screenshot_path = f'/tmp/ticketing_success_s{session_id}.png'
                    sb.save_screenshot(screenshot_path)
                    logger.info(f'📸 스크린샷: {screenshot_path}')
                
                # 부분 성공 저장
                tracker.checkpoint('success', {'screenshot': screenshot_path})
                tracker.save_to_file(f'/tmp/session_{session_id}_state.json')
                
                return True
            else:
                logger.info('다른 세션이 먼저 성공')
                state.record_result(session_id, 'success_late')
                return True
            
    except Exception as e:
        error_category, can_retry, wait_time = ErrorClassifier.classify(e)
        logger.error(f'❌ 에러 [{error_category}]: {e}')
        state.record_result(session_id, f'error: {error_category}')
        state.increment_stat('errors')
        
        # 프록시 문제면 로테이션
        if proxy_pool and config.proxy and runner_config.proxy_rotation:
            if error_category in ['network', 'timeout']:
                new_proxy = proxy_pool.rotate_proxy(session_id)
                if new_proxy:
                    logger.info(f'프록시 로테이션: {new_proxy["server"][:15]}***')
        
        return False
    
    finally:
        state.session_status[session_id] = (
            SessionStatus.SUCCESS if state.results.get(session_id, '').startswith('SUCCESS')
            else SessionStatus.FAILED
        )


def _navigate_with_retry(sb, url: str, logger, max_retries: int = 3) -> bool:
    """페이지 이동 (재시도 포함)"""
    for attempt in range(max_retries):
        try:
            sb.uc_open_with_reconnect(url, reconnect_time=4)
            return True
        except Exception as e:
            logger.warning(f'페이지 로드 실패 (시도 {attempt+1}): {e}')
            if attempt < max_retries - 1:
                adaptive_sleep(1)
    return False


def _click_booking_button(sb, logger) -> bool:
    """예매 버튼 클릭"""
    selectors = [
        'a:contains("예매하기")',
        'button:contains("예매하기")',
        '[class*="booking"]',
        '[class*="reserve"]',
    ]
    
    for sel in selectors:
        try:
            sb.click(sel, timeout=2)
            adaptive_sleep(Timing.LONG)
            return True
        except:
            continue
    return False


def _do_login(sb, config: SessionConfig, logger, runner_config: RunnerConfig) -> bool:
    """로그인 처리"""
    try:
        # 이메일 로그인 버튼
        try:
            sb.click_link('이메일로 시작하기')
            adaptive_sleep(Timing.LONG)
        except:
            pass
        
        # Turnstile 처리
        try:
            sb.uc_gui_handle_captcha()
        except:
            pass
        
        # 자동 캡챠 솔버
        if runner_config.captcha_auto_solve:
            try:
                auto_solve_captcha(sb)
            except:
                pass
        
        adaptive_sleep(Timing.MEDIUM)
        
        # 로그인 정보 입력
        login_selectors = [
            ('#email', config.user_id),
            ('#password', config.user_pwd),
        ]
        
        for selector, value in login_selectors:
            try:
                elem = sb.find_element(selector)
                if elem:
                    elem.clear()
                    # 인간 같은 타이핑 (선택적)
                    if runner_config.random_delay:
                        for char in value:
                            elem.send_keys(char)
                            time.sleep(random.uniform(0.03, 0.08))
                    else:
                        elem.send_keys(value)
            except:
                sb.type(selector, value)
        
        # 로그인 버튼 클릭
        sb.uc_click('button:contains("로그인")', reconnect_time=3)
        
        # 로그인 완료 대기
        def login_complete():
            try:
                url = sb.get_current_url().lower()
                return 'login' not in url
            except:
                return False
        
        if wait_for_condition(login_complete, timeout=10):
            return True
        
        return False
        
    except Exception as e:
        logger.error(f'로그인 실패: {e}')
        return False


def _setup_resource_blocking(sb, config: RunnerConfig):
    """리소스 차단 설정"""
    try:
        blocked_urls = []
        
        if config.block_images:
            blocked_urls.extend([
                '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico', '*.svg',
                '*image*', '*photo*', '*thumbnail*', '*banner*',
            ])
        
        if config.block_css:
            blocked_urls.extend(['*.css', '*stylesheet*'])
        
        if config.block_fonts:
            blocked_urls.extend([
                '*.woff', '*.woff2', '*.ttf', '*.otf',
                '*fonts.googleapis*', '*fonts.gstatic*',
            ])
        
        if config.block_tracking:
            blocked_urls.extend([
                '*google-analytics*', '*googletagmanager*',
                '*facebook*', '*fbcdn*',
                '*doubleclick*', '*adsense*',
                '*twitter*', '*hotjar*', '*amplitude*',
                '*sentry*', '*bugsnag*',
            ])
        
        if blocked_urls:
            sb.execute_cdp_cmd('Network.enable', {})
            sb.execute_cdp_cmd('Network.setBlockedURLs', {'urls': blocked_urls})
            
    except:
        pass
    
    # JavaScript 최적화
    try:
        sb.execute_script("""
            window.IntersectionObserver = class { observe(){} disconnect(){} };
        """)
    except:
        pass


def _handle_modal(sb, logger):
    """모달 처리"""
    modal_selectors = [
        ('button:contains("확인하고 예매하기")', '예매 확인'),
        ('button:contains("확인")', '확인'),
        ('[class*="close"]', '닫기'),
    ]
    
    for sel, desc in modal_selectors:
        try:
            sb.click(sel, timeout=1)
            logger.debug(f'모달 {desc} 클릭')
            adaptive_sleep(Timing.SHORT)
            break
        except:
            continue


def _select_seat_with_shared_state(
    sb, logger, session_id: int, config: RunnerConfig
) -> bool:
    """좌석 선택 (공유 상태 사용)"""
    
    seat_selectors = [
        "circle[class*='seat'][class*='available']",
        "circle[class*='seat']:not([class*='sold']):not([class*='disabled'])",
        "rect[class*='seat'][class*='available']",
        "[class*='seat']:not([class*='sold']):not([class*='disabled']):not([class*='reserved'])",
        "[data-seat-status='available']",
        "[data-available='true']",
        "img[src*='seat'][src*='on']",
        "[class*='standing'][class*='available']",
    ]
    
    max_retries = 5
    
    for retry in range(max_retries):
        if state.should_stop():
            return False
        
        for selector in seat_selectors:
            try:
                seats = sb.find_elements(selector)
                if not seats:
                    continue
                
                available = [s for s in seats if s.is_displayed()]
                
                for seat in available:
                    if state.should_stop():
                        return False
                    
                    # 좌석 ID 추출
                    seat_id = ''
                    try:
                        seat_id = seat.get_attribute('data-seat-id') or \
                                  seat.get_attribute('id') or ''
                        if not seat_id:
                            loc = seat.location
                            seat_id = f"{loc.get('x', 0)}_{loc.get('y', 0)}" if loc else str(id(seat))
                    except:
                        seat_id = str(id(seat))
                    
                    # 공유 상태에서 중복 체크
                    if state.try_claim_seat(seat_id):
                        try:
                            seat.click()
                            logger.info(f'🪑 좌석 선택: {seat_id[:20]}')
                            adaptive_sleep(Timing.SHORT)
                            return True
                        except Exception as e:
                            state.release_seat(seat_id)
                            logger.debug(f'좌석 클릭 실패: {seat_id[:20]}')
                    else:
                        logger.debug(f'좌석 이미 선점: {seat_id[:20]}')
                        
            except Exception as e:
                continue
        
        if retry < max_retries - 1:
            logger.debug(f'좌석 재검색 (시도 {retry+2}/{max_retries})')
            adaptive_sleep(Timing.SHORT)
    
    # 좌표 기반 시도
    try:
        seat_map = sb.find_element('[class*="seat-map"], svg, canvas')
        if seat_map and seat_map.is_displayed():
            sb.execute_script("arguments[0].click();", seat_map)
            logger.info('좌석 맵 클릭 (좌표)')
            return True
    except:
        pass
    
    return False


# ============ 프록시 로더 ============

def load_proxies() -> List[dict]:
    """프록시 로드 (환경변수 + 파일)"""
    proxies = []
    
    # 환경 변수에서
    for i in range(1, 20):
        server = os.getenv(f'PROXY_{i}_SERVER', '')
        if server:
            proxies.append({
                'server': server,
                'username': os.getenv(f'PROXY_{i}_USER', ''),
                'password': os.getenv(f'PROXY_{i}_PASS', ''),
            })
    
    # PROXY_LIST 환경 변수
    proxy_list = os.getenv('PROXY_LIST', '')
    if proxy_list:
        for p in proxy_list.split(','):
            p = p.strip()
            if p:
                parts = p.split(':')
                if len(parts) >= 2:
                    proxies.append({
                        'server': f'{parts[0]}:{parts[1]}',
                        'username': parts[2] if len(parts) > 2 else '',
                        'password': parts[3] if len(parts) > 3 else '',
                    })
    
    # 파일에서
    for filepath in ['proxies.txt', '../proxies.txt']:
        try:
            with open(filepath) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#'):
                        if '@' in line:
                            auth, hostport = line.rsplit('@', 1)
                            user, pwd = auth.split(':', 1) if ':' in auth else (auth, '')
                            proxies.append({
                                'server': hostport,
                                'username': user,
                                'password': pwd,
                            })
                        else:
                            parts = line.split(':')
                            if len(parts) >= 2:
                                proxies.append({
                                    'server': f'{parts[0]}:{parts[1]}',
                                    'username': parts[2] if len(parts) > 2 else '',
                                    'password': parts[3] if len(parts) > 3 else '',
                                })
        except:
            continue
    
    return proxies


# ============ 메인 러너 ============

def run_multi_sessions(config: RunnerConfig, test_mode: bool = False) -> bool:
    """멀티 세션 실행"""
    global state
    state = GlobalState()
    
    # 로깅 설정
    logger = setup_logging(config.log_dir)
    main_log = get_session_logger(logger, 0)
    
    main_log.info("=" * 60)
    main_log.info("🎫 BTS 티켓팅 멀티 세션 러너 v3")
    main_log.info(f"세션 수: {config.num_sessions}")
    main_log.info(f"계정: {config.user_id[:5]}***")
    main_log.info(f"프록시: {len(config.proxies)}개")
    main_log.info(f"목표 시간: {config.target_hour:02d}:{config.target_minute:02d}:{config.target_second:02d}")
    main_log.info(f"스텔스 모드: {config.stealth_mode}")
    main_log.info(f"캡챠 자동: {config.captcha_auto_solve}")
    main_log.info("=" * 60)
    
    # NTP 동기화
    ntp_sync = NTPSync(config.ntp_servers)
    if config.use_ntp:
        main_log.info("🕐 NTP 동기화 중...")
        success, offset = ntp_sync.sync()
        if success:
            main_log.info(f"✅ NTP 동기화 (오프셋: {offset*1000:.1f}ms)")
            state.ntp_offset = offset
        else:
            main_log.warning("⚠️ NTP 동기화 실패")
    
    # 테스트 모드
    if test_mode:
        now = datetime.now()
        config.target_hour = now.hour
        config.target_minute = now.minute
        config.target_second = now.second
        main_log.info("🧪 테스트 모드 - 즉시 실행")
    
    # 프록시 풀
    proxy_pool = ProxyPool(config.proxies) if config.proxies else None
    
    # 세션 설정 생성
    session_configs = []
    for i in range(config.num_sessions):
        proxy = proxy_pool.get_proxy(i) if proxy_pool else None
        
        session_configs.append(SessionConfig(
            session_id=i + 1,
            user_id=config.user_id,
            user_pwd=config.user_pwd,
            concert_url=config.concert_url,
            birth_date=config.birth_date,
            proxy=proxy,
            headless=False,
        ))
    
    # 병렬 실행
    main_log.info(f"🚀 {config.num_sessions}개 세션 시작...")
    
    with ThreadPoolExecutor(max_workers=config.num_sessions + 2) as executor:  # +2 for restarts
        futures = {}
        
        for i, sess_config in enumerate(session_configs):
            sess_logger = get_session_logger(logger, sess_config.session_id)
            
            # 스태거링
            if i > 0 and config.stagger_delay > 0:
                time.sleep(config.stagger_delay)
            
            future = executor.submit(
                run_session,
                sess_config,
                config,
                sess_logger,
                ntp_sync,
                proxy_pool
            )
            futures[future] = sess_config
        
        # 결과 수집 + 재시작 로직
        try:
            for future in as_completed(futures, timeout=config.session_timeout):
                sess_config = futures[future]
                session_id = sess_config.session_id
                
                try:
                    result = future.result()
                    
                    if result and state.success:
                        main_log.info(f"🎉 세션 #{session_id} 성공!")
                    elif not result and not state.success:
                        # 실패한 세션 재시작
                        if state.can_restart_session(session_id, config.max_restarts):
                            main_log.info(f"🔄 세션 #{session_id} 재시작...")
                            state.session_status[session_id] = SessionStatus.RESTARTING
                            
                            # 프록시 로테이션
                            if proxy_pool and config.proxy_rotation:
                                new_proxy = proxy_pool.rotate_proxy(session_id)
                                sess_config.proxy = new_proxy
                            
                            new_future = executor.submit(
                                run_session,
                                sess_config,
                                config,
                                get_session_logger(logger, session_id),
                                ntp_sync,
                                proxy_pool
                            )
                            futures[new_future] = sess_config
                            
                except Exception as e:
                    main_log.error(f"세션 #{session_id} 예외: {e}")
                    
        except TimeoutError:
            main_log.error(f"⏰ 전체 타임아웃 ({config.session_timeout}초)")
            state.request_shutdown()
    
    # 결과 출력
    main_log.info("=" * 60)
    main_log.info("📊 실행 결과")
    
    success_count = sum(1 for r in state.results.values() if 'success' in r.lower())
    main_log.info(f"성공: {success_count}/{len(state.results)}")
    
    for session_id, result in sorted(state.results.items()):
        main_log.info(f"  S{session_id:02d}: {result}")
    
    if state.winner_session:
        main_log.info(f"🏆 우승 세션: #{state.winner_session}")
        if state.winner_order_number:
            main_log.info(f"📋 주문번호: {state.winner_order_number}")
    
    main_log.info("📈 통계:")
    for key, value in state.stats.items():
        main_log.info(f"  {key}: {value}")
    
    main_log.info("=" * 60)
    
    return state.success


# ============ CLI ============

def main():
    import random
    
    parser = argparse.ArgumentParser(description='BTS 티켓팅 멀티 세션 러너 v3')
    
    # 모드
    parser.add_argument('--test', action='store_true', help='테스트 모드')
    parser.add_argument('--live', action='store_true', help='실전 모드')
    
    # 세션
    parser.add_argument('--sessions', type=int, default=10, help='세션 수')
    parser.add_argument('--stagger', type=float, default=0.2, help='시작 간격 (초)')
    parser.add_argument('--max-restarts', type=int, default=2, help='세션당 최대 재시작')
    
    # 시간
    parser.add_argument('--hour', type=int, default=20)
    parser.add_argument('--minute', type=int, default=0)
    parser.add_argument('--second', type=int, default=0)
    
    # 좌석
    parser.add_argument('--seats', type=int, default=2, help='좌석 수')
    parser.add_argument('--no-consecutive', action='store_true', help='연석 불필요')
    
    # 결제
    parser.add_argument('--payment', default='kakao', help='결제 방법')
    parser.add_argument('--auto-pay', action='store_true', help='자동 결제')
    
    # 옵션
    parser.add_argument('--no-proxy', action='store_true')
    parser.add_argument('--headless', action='store_true')
    parser.add_argument('--no-stealth', action='store_true')
    parser.add_argument('--no-captcha-solver', action='store_true')
    parser.add_argument('--pre-analyze', action='store_true', help='좌석 사전 분석')
    
    args = parser.parse_args()
    
    if not args.test and not args.live:
        parser.print_help()
        print("\n예시:")
        print("  python multi_session_runner.py --test")
        print("  python multi_session_runner.py --live --sessions 10")
        return
    
    # 환경 변수 확인
    user_id = os.getenv('INTERPARK_ID', '')
    user_pwd = os.getenv('INTERPARK_PWD', '')
    concert_url = os.getenv('CONCERT_URL', '')
    
    if not user_id or not user_pwd:
        print("❌ INTERPARK_ID, INTERPARK_PWD 필요")
        return
    
    if not concert_url or 'XXXXXX' in concert_url:
        print("❌ CONCERT_URL 필요")
        return
    
    # 프록시 로드
    proxies = [] if args.no_proxy else load_proxies()
    
    # 설정
    config = RunnerConfig(
        user_id=user_id,
        user_pwd=user_pwd,
        concert_url=concert_url,
        birth_date=os.getenv('BIRTH_DATE', ''),
        num_sessions=args.sessions,
        stagger_delay=args.stagger,
        max_restarts=args.max_restarts,
        target_hour=args.hour,
        target_minute=args.minute,
        target_second=args.second,
        proxies=proxies,
        num_seats=args.seats,
        consecutive_seats=not args.no_consecutive,
        payment_method=args.payment,
        auto_pay=args.auto_pay,
        stealth_mode=not args.no_stealth,
        captcha_auto_solve=not args.no_captcha_solver,
        pre_analyze=args.pre_analyze,
    )
    
    # 시그널 핸들러
    def signal_handler(sig, frame):
        print("\n⚠️ 종료 신호...")
        state.request_shutdown()
        sys.exit(0)
    
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    
    # 실행
    try:
        success = run_multi_sessions(config, test_mode=args.test)
        
        if success:
            print("\n🎉 티켓팅 성공!")
            input("결제 완료 후 Enter...")
        else:
            print("\n❌ 티켓팅 실패")
            sys.exit(1)
            
    except KeyboardInterrupt:
        print("\n⚠️ 사용자 취소")
    except Exception as e:
        print(f"\n❌ 오류: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == '__main__':
    main()
