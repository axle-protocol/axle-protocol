#!/usr/bin/env python3
"""
BTS 티켓팅 매크로 v3 - SeleniumBase UC Mode (10점 목표)
실전 안정성 + 에러 복구 + 봇 탐지 회피 + 캡챠 솔버

v3 핵심 개선:
- 모든 단계 재시도 (최대 3회)
- 서버 과부하 적응형 백오프
- 셀렉터 변경 자동 대응 (다중 폴백)
- 봇 탐지 회피 (인간 패턴 시뮬레이션)
- 캡챠 자동 솔버 (2captcha 연동)
- 부분 성공 저장/복구
- 네트워크 끊김 자동 재연결

Usage:
    python main_seleniumbase_v2.py --test           # 즉시 테스트
    python main_seleniumbase_v2.py --hour 20        # 20시 예매
    python main_seleniumbase_v2.py --url URL --auto-pay  # 자동 결제
"""

import os
import time
import sys
import random
from datetime import datetime
from typing import Optional, List
from dataclasses import dataclass
from dotenv import load_dotenv

# 환경변수 로드
load_dotenv('.env.local')
load_dotenv('../.env.local')

# 모듈 import
try:
    from seat_selector import SeatSelector, SeatPreference, quick_select, standing_select, emergency_select
    from payment_handler import PaymentHandler, PaymentConfig, PaymentMethod, quick_payment
    from captcha_solver import CaptchaSolver, CaptchaConfig, auto_solve_captcha, has_captcha
    from utils import (
        log, Timing, wait_for_condition, adaptive_sleep, human_delay,
        retry, retry_on_stale, get_shared_state, PartialSuccessTracker,
        get_overload_detector, NetworkRecovery, AntiDetection,
        MultiSelector, Selectors, ErrorClassifier, Timer
    )
except ImportError:
    # 상대 경로로 import
    sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
    try:
        from seat_selector import SeatSelector, SeatPreference, quick_select, standing_select, emergency_select
        from payment_handler import PaymentHandler, PaymentConfig, PaymentMethod, quick_payment
        from captcha_solver import CaptchaSolver, CaptchaConfig, auto_solve_captcha, has_captcha
        from utils import (
            log, Timing, wait_for_condition, adaptive_sleep, human_delay,
            retry, retry_on_stale, get_shared_state, PartialSuccessTracker,
            get_overload_detector, NetworkRecovery, AntiDetection,
            MultiSelector, Selectors, ErrorClassifier, Timer
        )
    except ImportError:
        # 최소 폴백
        class Timing:
            MICRO = 0.03; TINY = 0.08; SHORT = 0.2; MEDIUM = 0.4; LONG = 0.8; EXTRA_LONG = 1.5
        def log(msg, **kw): print(f'[{datetime.now().strftime("%H:%M:%S.%f")[:-3]}] {msg}')
        def wait_for_condition(c, timeout=5, **kw):
            s = time.time()
            while time.time() - s < timeout:
                if c(): return True
                time.sleep(0.01)
            return False
        def adaptive_sleep(t, **kw): time.sleep(t)
        def human_delay(a=50, b=150): time.sleep(random.uniform(a/1000, b/1000))
        def retry(**kw):
            def decorator(func): return func
            return decorator
        def retry_on_stale(func): return func
        def get_shared_state(): return None
        class PartialSuccessTracker:
            def __init__(self, sid): pass
            def checkpoint(self, s, d=None): pass
            def save_to_file(self, p): pass
        def get_overload_detector(): return None
        class NetworkRecovery:
            @staticmethod
            def reconnect_browser(sb, url, **kw): return True
        class AntiDetection:
            @staticmethod
            def stealth_js(sb): pass
            @staticmethod
            def human_typing(sb, sel, text, **kw): sb.type(sel, text)
            @staticmethod
            def human_click(sb, elem, **kw): elem.click()
        class MultiSelector:
            def __init__(self, sb, sels, desc=""): self.sb = sb; self.selectors = sels
            def find_element(self, **kw):
                for sel in self.selectors:
                    try:
                        e = self.sb.find_element(sel)
                        if e: return e
                    except: pass
                return None
            def click(self, **kw):
                e = self.find_element()
                if e: e.click(); return True
                return False
        class Selectors:
            BOOK_BUTTON = ['a:contains("예매하기")']
            EMAIL_INPUT = ['#email']
            PASSWORD_INPUT = ['#password']
            LOGIN_BUTTON = ['button:contains("로그인")']
        class Timer:
            def __init__(self, **kw): pass
            def __enter__(self): return self
            def __exit__(self, *args): pass
        class ErrorClassifier:
            @staticmethod
            def classify(e): return ('unknown', True, 1.0)
        def auto_solve_captcha(sb, config=None): return True
        def has_captcha(sb): return False
        SeatPreference = None
        SeatSelector = None
        PaymentConfig = None
        PaymentHandler = None
        PaymentMethod = None


# 설정
USER_ID = os.getenv('INTERPARK_ID', '')
USER_PW = os.getenv('INTERPARK_PWD', '')
CONCERT_URL = os.getenv('CONCERT_URL', '')
BIRTH_DATE = os.getenv('BIRTH_DATE', '')
CAPTCHA_KEY = os.getenv('TWO_CAPTCHA_KEY', '')


@dataclass
class TicketingConfig:
    """티켓팅 설정"""
    # 기본
    url: str = ''
    birth_date: str = ''
    
    # 시간
    target_hour: int = 20
    target_minute: int = 0
    
    # 좌석
    num_seats: int = 2
    consecutive: bool = True
    zone_priority: Optional[List[str]] = None
    preferred_rows: tuple = (1, 10)
    
    # 결제
    payment_method: str = 'kakao'
    auto_pay: bool = False
    
    # 옵션
    headless: bool = False
    stealth_mode: bool = True
    captcha_auto_solve: bool = True
    max_retries: int = 3
    
    # 타임아웃
    login_timeout: int = 30
    booking_timeout: int = 60
    payment_timeout: int = 300


class TicketingMacro:
    """티켓팅 매크로 v3 - 메인 클래스"""
    
    # 로그인 셀렉터 (다중)
    LOGIN_SELECTORS = {
        'email_login': [
            'a:contains("이메일로 시작하기")',
            'button:contains("이메일")',
            '[class*="email"][class*="login"]',
        ],
        'email_input': [
            '#email',
            'input[type="email"]',
            'input[name="email"]',
            'input[placeholder*="이메일"]',
        ],
        'password_input': [
            '#password',
            'input[type="password"]',
            'input[name="password"]',
        ],
        'login_button': [
            'button:contains("로그인")',
            'input[type="submit"]',
            '[class*="login"][class*="btn"]',
        ],
    }
    
    # 예매 버튼 셀렉터 (다중)
    BOOKING_SELECTORS = [
        'a:contains("예매하기")',
        'button:contains("예매하기")',
        '[class*="booking"]',
        '[class*="reserve"]',
        '[class*="ticket"]',
    ]
    
    # 모달 셀렉터 (다중)
    MODAL_SELECTORS = {
        'confirm': [
            'button:contains("확인하고 예매하기")',
            'button:contains("확인")',
            '[class*="confirm"]',
        ],
        'close': [
            '[class*="close"]',
            '[aria-label*="close"]',
            'button:contains("닫기")',
        ],
    }
    
    def __init__(self, config: TicketingConfig, session_id: int = 0):
        self.config = config
        self.session_id = session_id
        self.sb = None  # SeleniumBase 인스턴스
        
        # 상태 추적
        self._tracker = PartialSuccessTracker(session_id)
        self._shared = get_shared_state()
        self._overload = get_overload_detector()
        
        # 통계
        self.stats = {
            'login_attempts': 0,
            'booking_attempts': 0,
            'seat_clicks': 0,
            'errors': 0,
        }
    
    def _log(self, msg: str):
        log(msg, session_id=self.session_id)
    
    def _multi_select(self, selectors: List[str], desc: str = "") -> MultiSelector:
        return MultiSelector(self.sb, selectors, desc)
    
    @retry(max_attempts=3, delay=0.5)
    def _navigate_to_concert(self) -> bool:
        """공연 페이지 이동"""
        self._log(f'🎯 공연 페이지 접속: {self.config.url[:50]}...')
        
        try:
            self.sb.uc_open_with_reconnect(self.config.url, reconnect_time=4)
            adaptive_sleep(Timing.MEDIUM)
            
            # 스텔스 모드
            if self.config.stealth_mode:
                AntiDetection.stealth_js(self.sb)
            
            return True
            
        except Exception as e:
            self._log(f'⚠️ 페이지 로드 실패: {e}')
            return False
    
    @retry(max_attempts=3, delay=0.3)
    def _click_booking_button(self) -> bool:
        """예매하기 버튼 클릭"""
        self._log('📍 예매하기 클릭...')
        
        selector = self._multi_select(self.BOOKING_SELECTORS, '예매 버튼')
        
        if selector.click(timeout=Timing.ELEMENT_TIMEOUT):
            adaptive_sleep(Timing.LONG)
            return True
        
        # 폴백: 직접 링크 클릭
        try:
            self.sb.click_link('예매하기')
            adaptive_sleep(Timing.LONG)
            return True
        except:
            pass
        
        return False
    
    def _handle_captcha(self) -> bool:
        """캡챠 처리"""
        if not self.config.captcha_auto_solve:
            return True
        
        try:
            # SeleniumBase 내장 핸들러
            self.sb.uc_gui_handle_captcha()
            adaptive_sleep(Timing.MEDIUM)
        except:
            pass
        
        # 자동 솔버
        try:
            if has_captcha(self.sb):
                self._log('🔒 캡챠 감지, 솔버 실행...')
                return auto_solve_captcha(self.sb)
        except:
            pass
        
        return True
    
    @retry(max_attempts=3, delay=0.5)
    def _do_login(self) -> bool:
        """로그인 수행"""
        self._log('📍 로그인 중...')
        self.stats['login_attempts'] += 1
        
        try:
            # 이메일 로그인 버튼
            email_login_selector = self._multi_select(self.LOGIN_SELECTORS['email_login'], '이메일 로그인')
            if email_login_selector.click(timeout=3):
                adaptive_sleep(Timing.LONG)
            
            # 캡챠 처리
            self._handle_captcha()
            
            # 이메일 입력
            email_selector = self._multi_select(self.LOGIN_SELECTORS['email_input'], '이메일 입력')
            email_elem = email_selector.find_element()
            
            if email_elem:
                email_elem.clear()
                # 인간 같은 타이핑
                if self.config.stealth_mode:
                    for char in USER_ID:
                        email_elem.send_keys(char)
                        time.sleep(random.uniform(0.03, 0.08))
                else:
                    email_elem.send_keys(USER_ID)
            else:
                self.sb.type('#email', USER_ID)
            
            human_delay(100, 200)
            
            # 비밀번호 입력
            pwd_selector = self._multi_select(self.LOGIN_SELECTORS['password_input'], '비밀번호 입력')
            pwd_elem = pwd_selector.find_element()
            
            if pwd_elem:
                pwd_elem.clear()
                if self.config.stealth_mode:
                    for char in USER_PW:
                        pwd_elem.send_keys(char)
                        time.sleep(random.uniform(0.03, 0.08))
                else:
                    pwd_elem.send_keys(USER_PW)
            else:
                self.sb.type('#password', USER_PW)
            
            human_delay(100, 200)
            
            # 로그인 버튼 클릭
            self.sb.uc_click('button:contains("로그인")', reconnect_time=3)
            
            # 로그인 완료 대기
            def login_complete():
                try:
                    url = self.sb.get_current_url().lower()
                    return 'login' not in url
                except:
                    return False
            
            if wait_for_condition(login_complete, timeout=self.config.login_timeout):
                masked_id = USER_ID[:3] + '*' * min(len(USER_ID) - 3, 5)
                self._log(f'✅ 로그인 완료: {masked_id}')
                self._tracker.checkpoint('login_complete')
                return True
            
            self._log('⚠️ 로그인 대기 타임아웃')
            return False
            
        except Exception as e:
            self._log(f'⚠️ 로그인 실패: {e}')
            self.stats['errors'] += 1
            return False
    
    def _wait_for_booking_time(self) -> bool:
        """예매 시간까지 대기"""
        target_time = datetime.now().replace(
            hour=self.config.target_hour,
            minute=self.config.target_minute,
            second=0,
            microsecond=0
        )
        
        now = datetime.now()
        
        if target_time <= now:
            self._log('⏰ 목표 시간 이미 지남 - 즉시 실행')
            return True
        
        remaining = (target_time - now).total_seconds()
        self._log(f'⏳ 예매 시간까지 {int(remaining//60)}분 {int(remaining%60)}초 대기')
        
        while True:
            now = datetime.now()
            remaining = (target_time - now).total_seconds()
            
            if remaining <= 0:
                break
            elif remaining > 60:
                self._log(f'⏳ {int(remaining//60)}분 {int(remaining%60)}초 남음...')
                time.sleep(29)
            elif remaining > 10:
                self._log(f'⏳ {int(remaining)}초 남음...')
                time.sleep(4.5)
            elif remaining > 0.5:
                self._log(f'⏳ {remaining:.1f}초!')
                adaptive_sleep(min(remaining * 0.9, 0.45))
            else:
                # 마지막 500ms - busy wait
                adaptive_sleep(remaining, add_jitter=False)
                break
        
        self._log('🚀 예매 시간!')
        return True
    
    def _rapid_click_booking(self) -> bool:
        """예매 버튼 연타 - 최적화 v4"""
        self._log('📍 예매 버튼 연타 시작...')
        
        # 로그인 후 페이지 로드 대기 (중요!)
        adaptive_sleep(Timing.MEDIUM)  # 0.4초로 단축
        
        # 현재 URL 확인 - 이미 좌석 페이지면 스킵
        current_url = self.sb.get_current_url()
        if self._is_booking_page(current_url):
            self._log('✅ 이미 예매 페이지!')
            return True
        
        adaptive_sleep(Timing.SHORT)
        
        for attempt in range(15):  # 20 → 15 (더 빠른 실패 감지)
            self.stats['booking_attempts'] += 1
            
            try:
                self.sb.click_link('예매하기')
                self._log(f'🔘 예매 클릭 #{attempt+1}')
                
                # 대기열/좌석 페이지 대기 (최대 45초, 체크 간격 0.3초)
                wait_start = time.time()
                max_wait = 45  # 30초 → 45초 (대기열 충분히 대기)
                check_interval = 0.3  # 0.5초 → 0.3초 (더 빠른 반응)
                last_status = ""
                
                while time.time() - wait_start < max_wait:
                    adaptive_sleep(check_interval)
                    current_url = self.sb.get_current_url()
                    
                    # 1) 좌석 페이지 도달 → 즉시 성공
                    if self._is_booking_page(current_url):
                        elapsed = time.time() - wait_start
                        self._log(f'✅ 좌석 선택 페이지 진입! ({elapsed:.1f}초)')
                        self._tracker.checkpoint('booking_page_entered')
                        return True
                    
                    # 2) 대기열 페이지 → 상태 표시하며 대기
                    if 'waiting' in current_url.lower() or 'queue' in current_url.lower():
                        elapsed = time.time() - wait_start
                        status = f'⏳ 대기열 ({elapsed:.0f}s)'
                        if status != last_status:
                            self._log(status)
                            last_status = status
                        continue
                    
                    # 3) 에러 페이지 체크
                    if 'error' in current_url.lower() or 'fail' in current_url.lower():
                        self._log('⚠️ 에러 페이지 감지, 재시도...')
                        break
                
                # 타임아웃 - 다음 시도로
                elapsed = time.time() - wait_start
                self._log(f'⚠️ 대기 타임아웃 ({elapsed:.1f}초)')
                    
            except Exception as e:
                if attempt % 5 == 0:
                    self._log(f'⚠️ 예매 클릭 에러: {e}')
                adaptive_sleep(Timing.SHORT)
        
        return False
    
    def _is_booking_page(self, url: str) -> bool:
        """예매/좌석 페이지인지 확인"""
        url_lower = url.lower()
        booking_indicators = ['seat', 'onestop', 'booking', 'reserve', 'step']
        exclude_indicators = ['waiting', 'queue', 'login']
        
        # 제외 조건 먼저 체크
        if any(ex in url_lower for ex in exclude_indicators):
            return False
        
        return any(ind in url_lower for ind in booking_indicators)
    
    def _handle_modals(self):
        """모달 처리"""
        # 확인 모달
        confirm_selector = self._multi_select(self.MODAL_SELECTORS['confirm'], '확인 모달')
        if confirm_selector.click(timeout=2):
            self._log('✅ 모달 확인 클릭')
            adaptive_sleep(Timing.MEDIUM)
            return
        
        # 닫기 모달
        close_selector = self._multi_select(self.MODAL_SELECTORS['close'], '닫기 모달')
        if close_selector.click(timeout=1):
            self._log('✅ 모달 X 클릭')
            adaptive_sleep(Timing.MEDIUM)
    
    def _select_seats(self) -> bool:
        """좌석 선택 + 결제 페이지 이동 확인"""
        self._log('📍 좌석 선택...')
        
        if not SeatSelector:
            # 폴백 좌석 선택
            return self._fallback_seat_select()
        
        # 좌석 선호도 설정
        seat_pref = SeatPreference(
            num_seats=self.config.num_seats,
            consecutive_required=self.config.consecutive,
            preferred_rows=self.config.preferred_rows,
        )
        
        if self.config.zone_priority:
            seat_pref.zone_priority = self.config.zone_priority
        
        # 좌석 선택기
        selector = SeatSelector(self.sb, seat_pref, self.session_id)
        
        for attempt in range(self.config.max_retries):
            self._log(f'🪑 좌석 선택 시도 #{attempt+1}')
            
            if selector.select_best_seats():
                if selector.complete_selection():
                    # 선택 완료 후 결제 페이지 이동 확인
                    if self._verify_seat_selection_success(selector):
                        self._tracker.checkpoint('seats_selected', selector.get_selection_status())
                        self.stats['seat_clicks'] = len(selector.selected_seats)
                        return True
                    else:
                        self._log('⚠️ 좌석 선택 확인 실패, 재시도...')
            
            # 새로고침 후 재시도
            selector.refresh_seats()
            adaptive_sleep(Timing.MEDIUM)
        
        # 폴백: 긴급 선택
        self._log('⚠️ 일반 선택 실패, 긴급 모드...')
        return self._fallback_seat_select()
    
    def _verify_seat_selection_success(self, selector) -> bool:
        """좌석 선택 성공 확인 (결제 페이지 이동 or 선택 확정)"""
        try:
            # 1. URL 변경 확인
            current_url = self.sb.get_current_url().lower()
            seat_keywords = ['seat', 'ifrmSeat']
            payment_keywords = ['delivery', 'payment', 'order', 'checkout', 'step2', 'step3']
            
            # 좌석 페이지에서 벗어났으면 성공
            if not any(kw in current_url for kw in seat_keywords):
                self._log('✅ 좌석 페이지 이탈 확인')
                return True
            
            # 결제 관련 키워드 있으면 성공
            if any(kw in current_url for kw in payment_keywords):
                self._log('✅ 결제 페이지 URL 확인')
                return True
            
            # 2. DOM에서 결제 관련 요소 확인
            payment_elements = [
                '#YYMMDD',
                'select[id*="Price"]',
                '[class*="delivery"]',
                '[class*="payment"]',
            ]
            
            for sel in payment_elements:
                try:
                    elem = self.sb.find_element(sel)
                    if elem and elem.is_displayed():
                        self._log(f'✅ 결제 요소 발견: {sel}')
                        return True
                except:
                    pass
            
            # 3. 선택된 좌석 수 확인
            if len(selector.selected_seats) >= self.config.num_seats:
                self._log(f'✅ 좌석 {len(selector.selected_seats)}개 선택됨')
                return True
            
            return False
            
        except Exception as e:
            self._log(f'⚠️ 좌석 선택 확인 에러: {e}')
            return True  # 에러 시에도 진행
    
    def _fallback_seat_select(self) -> bool:
        """폴백 좌석 선택 - 최적화 v4"""
        self._log('🔍 폴백 좌석 선택...')
        
        # 셀렉터 우선순위 (실제 인터파크 구조 기반)
        seat_selectors = [
            # 인터파크 SVG 좌석 (가장 일반적)
            "circle[class*='seat'][class*='available']",
            "circle[fill]:not([class*='sold']):not([class*='disabled'])",
            "rect[class*='seat'][class*='available']",
            # 데이터 속성 기반
            "[data-seat-status='available']",
            "[data-available='true']",
            "[data-seat-id]:not([data-sold='true'])",
            # 일반 CSS 클래스
            "[class*='seat']:not([class*='sold']):not([class*='disabled']):not([class*='reserved'])",
            # 이미지 좌석
            "img[src*='seat'][src*='on']",
            "img[src*='seat'][src*='available']",
            # 스탠딩
            "[class*='standing'][class*='available']",
            "[class*='standing']:not([class*='sold'])",
        ]
        
        for retry in range(self.config.max_retries):
            for sel in seat_selectors:
                try:
                    seats = self.sb.find_elements(sel)
                    if not seats:
                        continue
                    
                    # 표시된 좌석만 필터 (최대 100개 - 성능 최적화)
                    available = []
                    for s in seats[:200]:  # 200개까지만 체크
                        try:
                            if s.is_displayed():
                                available.append(s)
                                if len(available) >= 100:
                                    break
                        except:
                            continue
                    
                    if available:
                        self._log(f'✅ 좌석 {len(available)}개 발견 - {sel[:40]}')
                        
                        # 좌석 위치 기반 정렬 (앞줄 우선)
                        try:
                            available.sort(key=lambda s: (s.location.get('y', 0), s.location.get('x', 0)))
                        except:
                            pass
                        
                        # 클릭 시도 (목표 수 + 여유분)
                        target_clicks = self.config.num_seats
                        click_attempts = 0
                        
                        for seat in available[:target_clicks + 3]:
                            try:
                                # 스크롤 + 클릭
                                self.sb.execute_script(
                                    "arguments[0].scrollIntoView({behavior: 'instant', block: 'center'});",
                                    seat
                                )
                                human_delay(30, 60)
                                seat.click()
                                self._log(f'🪑 좌석 클릭 #{self.stats["seat_clicks"]+1}')
                                self.stats['seat_clicks'] += 1
                                human_delay(80, 150)
                                
                                if self.stats['seat_clicks'] >= target_clicks:
                                    break
                            except Exception as e:
                                click_attempts += 1
                                if click_attempts > 10:
                                    break
                                continue
                        
                        if self.stats['seat_clicks'] >= target_clicks:
                            # 확인 모달 처리 (선택 완료 전에!)
                            self._log('🔍 모달 확인 중...')
                            try:
                                # SeleniumBase로 직접 클릭 시도
                                try:
                                    self.sb.click('button:contains("확인하고 예매하기")', timeout=2)
                                    self._log('✅ 확인하고 예매하기 클릭 성공!')
                                    adaptive_sleep(1)
                                except Exception as e1:
                                    self._log(f'⚠️ 직접 클릭 실패: {str(e1)[:50]}')
                                    # JS 폴백
                                    confirm_result = self.sb.execute_script("""
                                        var allBtns = document.querySelectorAll('button');
                                        for (var btn of allBtns) {
                                            var text = btn.textContent || '';
                                            if (text.includes('확인하고 예매하기')) {
                                                btn.click();
                                                return 'js clicked: ' + text.trim();
                                            }
                                        }
                                        return 'no button found';
                                    """)
                                    self._log(f'🔧 JS 결과: {confirm_result}')
                                    if 'clicked' in str(confirm_result):
                                        adaptive_sleep(0.8)
                            except Exception as e:
                                self._log(f'⚠️ 모달 처리 에러: {e}')
                            
                            # 선택 완료 버튼 (다중 시도)
                            complete_selectors = [
                                '#NextStepImage',
                                '#SmallNextBtnImage',
                                'button:contains("선택 완료")',
                                'button:contains("다음")',
                                'a:contains("다음")',
                                'button.EntButton_primary__UOX1_',  # 인터파크 버튼
                            ]
                            
                            pre_url = self.sb.get_current_url()
                            
                            for cs in complete_selectors:
                                try:
                                    # 일반 클릭 시도
                                    self.sb.click(cs, timeout=2)
                                    self._log('✅ 선택 완료 클릭')
                                    adaptive_sleep(Timing.LONG)
                                    break
                                except Exception as click_err:
                                    # 가려진 경우 JS 클릭
                                    if 'intercepted' in str(click_err).lower():
                                        try:
                                            elem = self.sb.find_element(cs)
                                            self.sb.execute_script("arguments[0].click();", elem)
                                            self._log('✅ 선택 완료 JS 클릭')
                                            adaptive_sleep(Timing.LONG)
                                            break
                                        except:
                                            continue
                                    continue
                            
                            # 결제 페이지 이동 확인
                            if self._verify_moved_to_payment_page(pre_url):
                                self._log('✅ 결제 페이지 이동 확인')
                            else:
                                self._log('⚠️ 결제 페이지 이동 미확인 (계속 진행)')
                            
                            return True
                            
                except Exception as e:
                    continue
            
            if retry < self.config.max_retries - 1:
                self._log(f'🔄 좌석 재검색 (시도 {retry+2})')
                # 페이지 새로고침 시도
                try:
                    refresh_selectors = ['a[onclick*="refresh"]', 'img[onclick*="refresh"]', '[class*="refresh"]']
                    for rs in refresh_selectors:
                        try:
                            self.sb.click(rs, timeout=1)
                            break
                        except:
                            continue
                except:
                    pass
                adaptive_sleep(Timing.MEDIUM)
        
        # 좌표 기반 최후 시도 (Canvas/SVG 클릭)
        self._log('⚠️ 좌표 기반 최후 시도...')
        try:
            seat_maps = self.sb.find_elements('[class*="seat-map"], svg[id*="seat"], canvas')
            for seat_map in seat_maps:
                try:
                    if seat_map.is_displayed():
                        size = seat_map.size
                        if size and size.get('width', 0) > 100:
                            # 맵 중앙 앞쪽 클릭
                            x = size['width'] // 2
                            y = int(size['height'] * 0.3)  # 앞쪽 30% 위치
                            self.sb.execute_script(
                                """arguments[0].dispatchEvent(new MouseEvent('click', {
                                    clientX: arguments[1], 
                                    clientY: arguments[2], 
                                    bubbles: true
                                }));""",
                                seat_map, x, y
                            )
                            self._log(f'🪑 좌석 맵 클릭 ({x}, {y})')
                            return True
                except:
                    continue
        except:
            pass
        
        return False
    
    def _verify_moved_to_payment_page(self, pre_url: str, timeout: float = 5.0) -> bool:
        """결제/배송 페이지로 이동했는지 확인"""
        try:
            payment_indicators = ['delivery', 'payment', 'order', 'checkout', 'step2', 'step3']
            
            start = time.time()
            while time.time() - start < timeout:
                try:
                    current_url = self.sb.get_current_url().lower()
                    
                    # URL 변경됐고, 결제 관련 키워드 포함
                    if current_url != pre_url.lower():
                        if any(ind in current_url for ind in payment_indicators):
                            return True
                        if 'seat' not in current_url:
                            return True
                    
                    # DOM에서 결제 관련 요소 확인
                    payment_dom = ['[class*="payment"]', '[class*="delivery"]', '#YYMMDD', 'select[id*="Price"]']
                    for sel in payment_dom:
                        try:
                            elem = self.sb.find_element(sel)
                            if elem and elem.is_displayed():
                                return True
                        except:
                            pass
                except:
                    pass
                
                adaptive_sleep(0.3)
            
            return False
        except:
            return False
    
    def _process_payment(self) -> bool:
        """결제 처리"""
        self._log('📍 결제 진행...')
        
        if not PaymentHandler or not PaymentConfig:
            self._log('⚠️ 결제 모듈 없음, 수동 결제 필요')
            return True
        
        # 결제 설정
        payment_methods_map = {
            'kakao': [PaymentMethod.KAKAO_PAY],
            'naver': [PaymentMethod.NAVER_PAY],
            'card': [PaymentMethod.CREDIT_CARD],
            'toss': [PaymentMethod.TOSS],
            'transfer': [PaymentMethod.BANK_TRANSFER],
            'auto': [PaymentMethod.KAKAO_PAY, PaymentMethod.NAVER_PAY, PaymentMethod.TOSS, PaymentMethod.CREDIT_CARD],
        }
        
        pay_config = PaymentConfig(
            birth_date=self.config.birth_date,
            auto_pay=self.config.auto_pay,
            payment_methods=payment_methods_map.get(self.config.payment_method, [PaymentMethod.KAKAO_PAY]),
        )
        
        handler = PaymentHandler(self.sb, pay_config, self.session_id)
        
        if handler.process_payment():
            self._log('🎉 결제 프로세스 완료!')
            
            if handler.order_number:
                self._log(f'📋 주문번호: {handler.order_number}')
            
            if not self.config.auto_pay:
                self._log('💡 수동 결제를 완료해주세요!')
            
            self._tracker.checkpoint('payment_complete', handler.get_status())
            return True
        else:
            self._log(f'❌ 결제 실패: {handler.error_message}')
            return False
    
    def run(self) -> bool:
        """티켓팅 실행"""
        from seleniumbase import SB
        
        self._start_time = time.time()
        
        self._log('=' * 60)
        self._log('🎫 BTS 티켓팅 매크로 v4 시작')
        self._log(f'🎯 URL: {self.config.url[:50]}...')
        self._log(f'⏰ 목표 시간: {self.config.target_hour:02d}:{self.config.target_minute:02d}')
        self._log(f'🪑 좌석: {self.config.num_seats}석, 연석={self.config.consecutive}')
        self._log(f'💳 결제: {self.config.payment_method}, 자동={self.config.auto_pay}')
        self._log('=' * 60)
        
        # IPRoyal 프록시 설정
        proxy_host = os.getenv('PROXY_HOST', '')
        proxy_port = os.getenv('PROXY_PORT', '')
        proxy_user = os.getenv('PROXY_USER', '')
        proxy_pass = os.getenv('PROXY_PASS', '')
        
        proxy_str = None
        if proxy_host and proxy_port and proxy_user and proxy_pass:
            # SeleniumBase UC 모드 프록시 형식
            proxy_str = f"{proxy_user}:{proxy_pass}@{proxy_host}:{proxy_port}"
            self._log(f'🌐 프록시 활성화: {proxy_host}:{proxy_port}')
        else:
            self._log('⚠️ 프록시 미설정 - 직접 연결')
        
        # SeleniumBase 옵션
        sb_kwargs = {
            'uc': True,
            'headless': self.config.headless,
            'incognito': True,
            'locale_code': 'ko',
        }
        
        if proxy_str:
            sb_kwargs['proxy'] = proxy_str
        
        with SB(**sb_kwargs) as sb:
            self.sb = sb
            
            try:
                # 1. 공연 페이지 접속
                self._log('📍 [1/7] 공연 페이지 접속...')
                if not self._navigate_to_concert():
                    self._log('❌ 페이지 접속 실패')
                    return False
                
                # 2. 예매하기 클릭
                self._log('📍 [2/7] 예매하기 클릭...')
                if not self._click_booking_button():
                    self._log('⚠️ 예매 버튼 클릭 실패, 계속 진행...')
                
                # 3. 로그인
                self._log('📍 [3/7] 로그인...')
                if not self._do_login():
                    self._log('❌ 로그인 실패')
                    self.sb.save_screenshot('/tmp/ticketing_login_fail.png')
                    return False
                
                # 4. 예매 시간 대기
                self._log('📍 [4/7] 예매 대기...')
                self._wait_for_booking_time()
                
                # 5. 예매 시도
                self._log('📍 [5/7] 예매 시도...')
                if not self._rapid_click_booking():
                    self._log('❌ 예매 페이지 진입 실패')
                    self.sb.save_screenshot('/tmp/ticketing_booking_fail.png')
                    return False
                
                # 6. 모달 처리 + 좌석 선택
                self._log('📍 [6/7] 좌석 선택...')
                self._handle_modals()
                
                if not self._select_seats():
                    self._log('❌ 좌석 선택 실패')
                    self.sb.save_screenshot('/tmp/ticketing_seat_fail.png')
                    return False
                
                # 7. 결제
                self._log('📍 [7/7] 결제...')
                if not self._process_payment():
                    self._log('❌ 결제 실패')
                    self.sb.save_screenshot('/tmp/ticketing_payment_fail.png')
                    return False
                
                # 성공!
                self._log('🎉🎉🎉 티켓팅 성공! 🎉🎉🎉')
                self.sb.save_screenshot('/tmp/ticketing_success.png')
                self._log('📸 /tmp/ticketing_success.png')
                
                # 최종 상태 저장
                self._tracker.checkpoint('success')
                self._tracker.save_to_file('/tmp/ticketing_state.json')
                
                # 최종 URL 로깅
                try:
                    final_url = self.sb.get_current_url()
                    self._log(f'📍 최종 URL: {final_url[:80]}...')
                except:
                    pass
                
                return True
                
            except Exception as e:
                error_category, _, _ = ErrorClassifier.classify(e)
                self._log(f'❌ 에러 [{error_category}]: {e}')
                self.stats['errors'] += 1
                
                import traceback
                traceback.print_exc()
                
                # 에러 스크린샷 + URL
                try:
                    self.sb.save_screenshot('/tmp/ticketing_error.png')
                    error_url = self.sb.get_current_url()
                    self._log(f'📍 에러 URL: {error_url[:80]}')
                except:
                    pass
                
                return False
            
            finally:
                # 통계 출력
                elapsed = time.time() - (self._start_time if hasattr(self, '_start_time') else time.time())
                self._log('=' * 50)
                self._log(f'📊 최종 통계 (소요: {elapsed:.1f}초):')
                for key, value in self.stats.items():
                    self._log(f'  • {key}: {value}')
                self._log('=' * 50)


def run_ticketing(
    target_url: Optional[str] = None,
    target_hour: int = 20,
    target_minute: int = 0,
    headless: bool = False,
    num_seats: int = 2,
    consecutive: bool = True,
    zone_priority: Optional[List[str]] = None,
    preferred_rows: tuple = (1, 10),
    payment_method: str = 'kakao',
    auto_pay: bool = False,
    birth_date: Optional[str] = None,
    stealth_mode: bool = True,
    captcha_auto_solve: bool = True,
) -> bool:
    """티켓팅 실행 (함수형 인터페이스)"""
    
    url = target_url or CONCERT_URL
    birth = birth_date or BIRTH_DATE
    
    if not url:
        log('❌ CONCERT_URL 설정 필요!')
        return False
    
    if not birth:
        log('❌ BIRTH_DATE 설정 필요!')
        return False
    
    config = TicketingConfig(
        url=url,
        birth_date=birth,
        target_hour=target_hour,
        target_minute=target_minute,
        headless=headless,
        num_seats=num_seats,
        consecutive=consecutive,
        zone_priority=zone_priority,
        preferred_rows=preferred_rows,
        payment_method=payment_method,
        auto_pay=auto_pay,
        stealth_mode=stealth_mode,
        captcha_auto_solve=captcha_auto_solve,
    )
    
    macro = TicketingMacro(config)
    return macro.run()


def main():
    import argparse
    
    parser = argparse.ArgumentParser(description='BTS 티켓팅 매크로 v3')
    
    # 기본 옵션
    parser.add_argument('--url', help='공연 URL')
    parser.add_argument('--hour', type=int, default=20, help='예매 시간 (시)')
    parser.add_argument('--minute', type=int, default=0, help='예매 시간 (분)')
    parser.add_argument('--headless', action='store_true', help='헤드리스')
    parser.add_argument('--test', action='store_true', help='즉시 테스트')
    
    # 좌석 옵션
    parser.add_argument('--seats', type=int, default=2, help='좌석 수')
    parser.add_argument('--no-consecutive', action='store_true', help='연석 불필요')
    parser.add_argument('--zone', nargs='+', help='구역 우선순위')
    parser.add_argument('--rows', type=str, default='1-10', help='선호 열 (예: 1-10)')
    
    # 결제 옵션
    parser.add_argument('--payment', choices=['kakao', 'naver', 'card', 'toss', 'transfer', 'auto'],
                       default='kakao', help='결제수단')
    parser.add_argument('--auto-pay', action='store_true', help='자동 결제')
    parser.add_argument('--birth', help='생년월일 (YYMMDD)')
    
    # 고급 옵션
    parser.add_argument('--no-stealth', action='store_true', help='스텔스 모드 비활성화')
    parser.add_argument('--no-captcha-solver', action='store_true', help='캡챠 솔버 비활성화')
    
    args = parser.parse_args()
    
    # 열 범위 파싱
    rows = args.rows.split('-')
    preferred_rows = (int(rows[0]), int(rows[1])) if len(rows) == 2 else (1, 10)
    
    if args.test:
        now = datetime.now()
        args.hour = now.hour
        args.minute = now.minute
    
    success = run_ticketing(
        target_url=args.url,
        target_hour=args.hour,
        target_minute=args.minute,
        headless=args.headless,
        num_seats=args.seats,
        consecutive=not args.no_consecutive,
        zone_priority=args.zone,
        preferred_rows=preferred_rows,
        payment_method=args.payment,
        auto_pay=args.auto_pay,
        birth_date=args.birth,
        stealth_mode=not args.no_stealth,
        captcha_auto_solve=not args.no_captcha_solver,
    )
    
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
