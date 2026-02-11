#!/usr/bin/env python3
"""
BTS 티켓팅 매크로 - SeleniumBase UC Mode 버전
2026-02-11

SeleniumBase UC Mode를 사용한 봇 탐지 우회:
- undetected-chromedriver 기반
- CDP 탐지 우회 검증됨
- Cloudflare/Turnstile 우회 지원
- PyAutoGUI 기반 CAPTCHA 클릭

사용법:
    python main_seleniumbase.py --test-login  # 로그인 테스트
    python main_seleniumbase.py               # 실제 실행

환경변수 (.env.local):
    INTERPARK_ID=your_id
    INTERPARK_PWD=your_password
    CONCERT_URL=https://tickets.interpark.com/goods/XXXXXXX
    OPEN_TIME=2026-02-23 20:00:00
"""

from __future__ import annotations

__version__ = "1.0.0"
__author__ = "BTS Ticketing Bot"

import os
import sys
import time
import random
import logging
import argparse
from datetime import datetime
from zoneinfo import ZoneInfo
from dataclasses import dataclass, field
from typing import Optional, List, Tuple, Final

# SeleniumBase import
from seleniumbase import SB

# ============ 로깅 설정 ============
log_dir = os.path.join(os.path.dirname(__file__), '..', 'logs')
os.makedirs(log_dir, exist_ok=True)
log_file = os.path.join(log_dir, f"seleniumbase_{datetime.now().strftime('%Y%m%d_%H%M%S')}.log")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S',
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler(log_file, encoding='utf-8')
    ]
)
logger = logging.getLogger(__name__)


# ============ 상수 ============
class Timeouts:
    """타임아웃 상수 (초)"""
    PAGE_LOAD: Final[float] = 30.0
    ELEMENT_WAIT: Final[float] = 10.0
    LOGIN_WAIT: Final[float] = 5.0
    TURNSTILE_MAX: Final[float] = 60.0
    CAPTCHA_RECONNECT: Final[float] = 4.0  # UC 모드 reconnect 시간
    BOOKING_POPUP: Final[float] = 30.0
    SEAT_SEARCH: Final[float] = 30.0
    PAYMENT_MAX: Final[int] = 600  # 10분


class Limits:
    """제한 상수"""
    MAX_LOGIN_RETRIES: Final[int] = 3
    MAX_BOOKING_ATTEMPTS: Final[int] = 50
    MAX_SEAT_ATTEMPTS: Final[int] = 30


# ============ 셀렉터 (인터파크 NOL 티켓) ============
SELECTORS = {
    # 로그인 관련
    'login_btn': [
        'a[href*="login"]',
        'button:contains("로그인")',
        '.login-btn',
        '[data-testid="login"]',
    ],
    'email_login_btn': [
        'button:contains("이메일")',
        'a:contains("이메일로 시작")',
        '.email-login',
        '[data-testid="email-login"]',
    ],
    'id_field': [
        'input[placeholder*="nol"]',
        'input[placeholder*="이메일"]',
        'input[name="userId"]',
        'input[name="email"]',
        'input[type="email"]',
        '#userId',
        '#email',
    ],
    'pw_field': [
        'input[type="password"]',
        'input[name="password"]',
        '#password',
    ],
    'login_submit': [
        'button:contains("로그인")',
        'button[type="submit"]',
        '.login-submit',
    ],
    
    # 예매 관련
    'booking_btn': [
        'a.btn_book',
        'button:contains("예매하기")',
        'a:contains("예매하기")',
        '[class*="BookingButton"]',
        '.booking-btn',
    ],
    'date_select': [
        '.date-item',
        '[class*="DateSelect"]',
        '.calendar-date',
    ],
    'time_select': [
        '.time-item',
        '[class*="TimeSelect"]',
        '.schedule-time',
    ],
    
    # 좌석 관련
    'seat_grade': [
        '.seat-grade',
        '[class*="SeatGrade"]',
        '.grade-item',
    ],
    'seat_area': [
        '.seat-area',
        '[class*="SeatArea"]',
        '.area-item',
    ],
    'seat_available': [
        '.seat.available',
        '.seat:not(.sold)',
        '[class*="available"]',
    ],
    'seat_canvas': [
        'canvas#seatCanvas',
        'canvas[class*="seat"]',
        '.seat-map canvas',
    ],
    
    # CAPTCHA 관련
    'captcha_image': [
        'img[src*="captcha"]',
        '.captcha-image',
        '#captchaImage',
    ],
    'captcha_input': [
        'input[name*="captcha"]',
        '#captchaInput',
        '.captcha-input',
    ],
    
    # Turnstile (Cloudflare)
    'turnstile_frame': [
        'iframe[src*="turnstile"]',
        'iframe[src*="challenges.cloudflare.com"]',
        '#cf-turnstile iframe',
    ],
    
    # 동의/확인
    'agree_checkbox': [
        'input[type="checkbox"]',
        '.agree-checkbox',
        '[name*="agree"]',
    ],
    'confirm_btn': [
        'button:contains("확인")',
        'button:contains("동의")',
        '.confirm-btn',
    ],
    'next_btn': [
        'button:contains("다음")',
        'a:contains("다음")',
        '.next-btn',
    ],
    
    # 결제
    'payment_btn': [
        'button:contains("결제")',
        '.payment-btn',
        '[class*="PaymentButton"]',
    ],
}


# ============ 설정 ============
@dataclass
class Config:
    """티켓팅 설정"""
    user_id: str
    user_pwd: str
    concert_url: str
    open_time: datetime
    seat_priority: List[str] = field(default_factory=lambda: ['VIP', 'R석', 'S석', 'A석'])
    headless: bool = False  # UC 모드는 headless에서 탐지됨
    incognito: bool = True  # 시크릿 모드 (탐지 우회 강화)
    
    @classmethod
    def from_env(cls, env_file: str = '.env.local') -> 'Config':
        """환경변수에서 설정 로드"""
        # .env.local 파일 로드
        env_path = os.path.join(os.path.dirname(__file__), '..', env_file)
        if os.path.exists(env_path):
            with open(env_path) as f:
                for line in f:
                    line = line.strip()
                    if line and not line.startswith('#') and '=' in line:
                        key, value = line.split('=', 1)
                        os.environ[key.strip()] = value.strip().strip('"\'')
        
        user_id = os.getenv('INTERPARK_ID', '')
        user_pwd = os.getenv('INTERPARK_PWD', '')
        concert_url = os.getenv('CONCERT_URL', '')
        open_time_str = os.getenv('OPEN_TIME', '2026-02-23 20:00:00')
        
        if not user_id or not user_pwd:
            raise ValueError("INTERPARK_ID, INTERPARK_PWD 환경변수 필수")
        if not concert_url or 'XXXXXXX' in concert_url:
            raise ValueError("CONCERT_URL 환경변수에 실제 URL 필요")
        
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
        )


# ============ 유틸리티 ============
def human_delay(min_sec: float = 0.3, max_sec: float = 1.0) -> None:
    """인간적인 랜덤 딜레이"""
    time.sleep(random.uniform(min_sec, max_sec))


def find_first_selector(sb, selectors: List[str], timeout: float = 3.0) -> Optional[str]:
    """여러 셀렉터 중 첫 번째로 찾은 것 반환"""
    for selector in selectors:
        try:
            if sb.is_element_present(selector, timeout=0.5):
                return selector
        except:
            continue
    return None


def get_korean_time() -> datetime:
    """한국 시간 반환"""
    return datetime.now(ZoneInfo('Asia/Seoul'))


# ============ 메인 티켓팅 클래스 ============
class InterparkTicketing:
    """인터파크 티켓팅 자동화 (SeleniumBase UC Mode)"""
    
    def __init__(self, config: Config):
        self.config = config
        self.sb = None
        self.logged_in = False
        
    def run(self) -> bool:
        """메인 실행"""
        logger.info(f"=== BTS 티켓팅 시작 (SeleniumBase UC Mode v{__version__}) ===")
        logger.info(f"공연 URL: {self.config.concert_url}")
        logger.info(f"오픈 시간: {self.config.open_time}")
        
        # SeleniumBase UC 모드 실행
        with SB(
            uc=True,  # Undetected Chrome 모드
            headless=self.config.headless,
            incognito=self.config.incognito,
            locale="ko_KR",
            # test=True,  # 디버그용 (스크린샷 등)
        ) as sb:
            self.sb = sb
            
            try:
                # 1. 로그인
                if not self._login():
                    logger.error("로그인 실패")
                    return False
                
                # 2. 공연 페이지로 이동
                self._navigate_to_concert()
                
                # 3. 오픈 시간까지 대기
                self._wait_for_open_time()
                
                # 4. 예매 진행
                if self._do_booking():
                    logger.info("🎉 예매 성공!")
                    return True
                else:
                    logger.error("예매 실패")
                    return False
                    
            except Exception as e:
                logger.exception(f"실행 중 오류: {e}")
                return False
    
    def _login(self) -> bool:
        """인터파크 로그인"""
        logger.info("로그인 시작...")
        
        login_url = "https://accounts.interpark.com/login/form"
        
        for attempt in range(Limits.MAX_LOGIN_RETRIES):
            try:
                logger.info(f"로그인 시도 {attempt + 1}/{Limits.MAX_LOGIN_RETRIES}")
                
                # UC 모드로 페이지 열기 (봇 탐지 우회)
                self.sb.uc_open_with_reconnect(login_url, reconnect_time=Timeouts.CAPTCHA_RECONNECT)
                
                # Turnstile CAPTCHA 처리 (있으면)
                self._handle_turnstile()
                
                human_delay(1.0, 2.0)
                
                # 이메일 로그인 버튼 클릭 (있으면)
                email_btn = find_first_selector(self.sb, SELECTORS['email_login_btn'])
                if email_btn:
                    logger.info("이메일 로그인 버튼 클릭")
                    self.sb.uc_click(email_btn, reconnect_time=2)
                    human_delay(0.5, 1.0)
                
                # Turnstile 다시 확인
                self._handle_turnstile()
                
                # 아이디 입력
                id_field = find_first_selector(self.sb, SELECTORS['id_field'])
                if not id_field:
                    logger.warning("아이디 입력 필드를 찾을 수 없음")
                    continue
                
                logger.info("아이디 입력")
                self.sb.type(id_field, self.config.user_id, timeout=5)
                human_delay(0.3, 0.7)
                
                # 비밀번호 입력
                pw_field = find_first_selector(self.sb, SELECTORS['pw_field'])
                if not pw_field:
                    logger.warning("비밀번호 입력 필드를 찾을 수 없음")
                    continue
                
                logger.info("비밀번호 입력")
                self.sb.type(pw_field, self.config.user_pwd, timeout=5)
                human_delay(0.3, 0.7)
                
                # 로그인 버튼 클릭
                submit_btn = find_first_selector(self.sb, SELECTORS['login_submit'])
                if submit_btn:
                    logger.info("로그인 버튼 클릭")
                    self.sb.uc_click(submit_btn, reconnect_time=3)
                else:
                    # 엔터키로 제출
                    self.sb.press_keys(pw_field, "\\n")
                
                human_delay(2.0, 3.0)
                
                # Turnstile 다시 처리
                self._handle_turnstile()
                
                # 로그인 성공 확인
                if self._verify_login():
                    logger.info("✅ 로그인 성공!")
                    self.logged_in = True
                    return True
                else:
                    logger.warning("로그인 확인 실패, 재시도...")
                    
            except Exception as e:
                logger.warning(f"로그인 시도 {attempt + 1} 실패: {e}")
                human_delay(1.0, 2.0)
        
        return False
    
    def _verify_login(self) -> bool:
        """로그인 성공 확인"""
        try:
            # 로그인 페이지에 머물러 있으면 실패
            current_url = self.sb.get_current_url()
            if 'login' in current_url.lower():
                # 에러 메시지 확인
                if self.sb.is_element_present('.error-message', timeout=1):
                    error = self.sb.get_text('.error-message')
                    logger.error(f"로그인 에러: {error}")
                return False
            
            # 마이페이지나 로그아웃 버튼이 있으면 성공
            if (self.sb.is_element_present('a[href*="logout"]', timeout=2) or
                self.sb.is_element_present('a[href*="mypage"]', timeout=1) or
                self.sb.is_element_present('.user-info', timeout=1)):
                return True
            
            # URL이 메인 페이지로 리다이렉트 되었으면 성공으로 간주
            if 'interpark.com' in current_url and 'login' not in current_url:
                return True
                
            return False
        except Exception as e:
            logger.debug(f"로그인 확인 중 오류: {e}")
            return False
    
    def _handle_turnstile(self) -> bool:
        """Cloudflare Turnstile CAPTCHA 처리"""
        try:
            # Turnstile iframe 확인
            turnstile_present = False
            for selector in SELECTORS['turnstile_frame']:
                if self.sb.is_element_present(selector, timeout=1):
                    turnstile_present = True
                    break
            
            if not turnstile_present:
                # Turnstile 없음 - 다른 challenge 확인
                if self.sb.is_element_present('div[class*="challenge"]', timeout=0.5):
                    turnstile_present = True
            
            if turnstile_present:
                logger.info("🔐 Turnstile CAPTCHA 감지 - 처리 중...")
                
                # PyAutoGUI로 CAPTCHA 클릭 (SeleniumBase UC 메서드)
                try:
                    self.sb.uc_gui_handle_captcha()
                    logger.info("✅ Turnstile 처리 완료")
                    human_delay(1.0, 2.0)
                    return True
                except Exception as e:
                    logger.warning(f"자동 Turnstile 처리 실패: {e}")
                    
                    # 대안: 수동 클릭 시도
                    try:
                        self.sb.uc_gui_click_captcha()
                        human_delay(2.0, 3.0)
                        return True
                    except:
                        logger.warning("수동 CAPTCHA 클릭도 실패")
                        return False
            
            return True  # Turnstile 없음
            
        except Exception as e:
            logger.debug(f"Turnstile 처리 중 오류: {e}")
            return True  # 에러 시 계속 진행
    
    def _navigate_to_concert(self) -> None:
        """공연 페이지로 이동"""
        logger.info(f"공연 페이지로 이동: {self.config.concert_url}")
        
        # UC 모드로 이동 (봇 탐지 우회)
        self.sb.uc_open_with_reconnect(self.config.concert_url, reconnect_time=Timeouts.CAPTCHA_RECONNECT)
        
        # Turnstile 처리
        self._handle_turnstile()
        
        human_delay(1.0, 2.0)
        logger.info(f"현재 URL: {self.sb.get_current_url()}")
    
    def _wait_for_open_time(self) -> None:
        """오픈 시간까지 대기"""
        while True:
            now = get_korean_time()
            remaining = (self.config.open_time - now).total_seconds()
            
            if remaining <= 0:
                logger.info("⏰ 오픈 시간 도달!")
                break
            
            if remaining > 60:
                logger.info(f"오픈까지 {remaining/60:.1f}분 남음...")
                time.sleep(30)  # 30초마다 체크
            elif remaining > 10:
                logger.info(f"오픈까지 {remaining:.0f}초 남음...")
                time.sleep(5)  # 5초마다 체크
            else:
                logger.info(f"오픈까지 {remaining:.1f}초...")
                time.sleep(0.5)  # 0.5초마다 체크
            
            # 페이지 새로고침 (세션 유지)
            if remaining > 60 and int(remaining) % 60 == 0:
                try:
                    self.sb.refresh()
                    self._handle_turnstile()
                except:
                    pass
    
    def _do_booking(self) -> bool:
        """예매 진행"""
        logger.info("🎫 예매 시작...")
        
        for attempt in range(Limits.MAX_BOOKING_ATTEMPTS):
            try:
                logger.info(f"예매 시도 {attempt + 1}/{Limits.MAX_BOOKING_ATTEMPTS}")
                
                # 페이지 새로고침
                self.sb.refresh()
                self._handle_turnstile()
                human_delay(0.3, 0.7)
                
                # 예매하기 버튼 찾기
                booking_btn = find_first_selector(self.sb, SELECTORS['booking_btn'], timeout=3)
                
                if not booking_btn:
                    logger.info("예매 버튼 없음 - 아직 오픈 안됨, 재시도...")
                    human_delay(0.5, 1.0)
                    continue
                
                # 예매 버튼 클릭 (UC 모드)
                logger.info("예매 버튼 클릭!")
                self.sb.uc_click(booking_btn, reconnect_time=2)
                
                human_delay(1.0, 2.0)
                
                # 팝업/새 창 처리
                if self._handle_booking_popup():
                    # 좌석 선택
                    if self._select_seat():
                        # 결제 진행
                        if self._proceed_to_payment():
                            return True
                
            except Exception as e:
                logger.warning(f"예매 시도 {attempt + 1} 실패: {e}")
                human_delay(0.5, 1.0)
        
        return False
    
    def _handle_booking_popup(self) -> bool:
        """예매 팝업/새 창 처리"""
        try:
            # 새 창 처리
            windows = self.sb.driver.window_handles
            if len(windows) > 1:
                logger.info("새 창 감지 - 전환")
                self.sb.switch_to_window(windows[-1])
            
            human_delay(1.0, 2.0)
            
            # Turnstile 처리
            self._handle_turnstile()
            
            # 날짜 선택 (필요 시)
            date_selector = find_first_selector(self.sb, SELECTORS['date_select'], timeout=3)
            if date_selector:
                logger.info("날짜 선택")
                self.sb.click(date_selector)
                human_delay(0.5, 1.0)
            
            # 시간 선택 (필요 시)
            time_selector = find_first_selector(self.sb, SELECTORS['time_select'], timeout=3)
            if time_selector:
                logger.info("시간 선택")
                self.sb.click(time_selector)
                human_delay(0.5, 1.0)
            
            return True
            
        except Exception as e:
            logger.warning(f"팝업 처리 중 오류: {e}")
            return False
    
    def _select_seat(self) -> bool:
        """좌석 선택"""
        logger.info("좌석 선택 시작...")
        
        for attempt in range(Limits.MAX_SEAT_ATTEMPTS):
            try:
                # 등급 선택
                for grade in self.config.seat_priority:
                    grade_found = self._try_select_grade(grade)
                    if grade_found:
                        break
                
                # 가용 좌석 클릭
                seat_selector = find_first_selector(self.sb, SELECTORS['seat_available'], timeout=5)
                if seat_selector:
                    logger.info("가용 좌석 발견 - 클릭")
                    self.sb.click(seat_selector)
                    human_delay(0.5, 1.0)
                    return True
                
                # Canvas 기반 좌석 맵 처리
                canvas_selector = find_first_selector(self.sb, SELECTORS['seat_canvas'], timeout=2)
                if canvas_selector:
                    logger.info("Canvas 좌석 맵 발견")
                    if self._click_canvas_seat(canvas_selector):
                        return True
                
                # 좌석 없음 - 재시도
                logger.info(f"가용 좌석 없음 - 재시도 {attempt + 1}/{Limits.MAX_SEAT_ATTEMPTS}")
                self.sb.refresh()
                human_delay(0.5, 1.0)
                
            except Exception as e:
                logger.warning(f"좌석 선택 오류: {e}")
                human_delay(0.5, 1.0)
        
        return False
    
    def _try_select_grade(self, grade: str) -> bool:
        """등급 선택 시도"""
        try:
            # 등급 버튼 찾기
            for selector in SELECTORS['seat_grade']:
                elements = self.sb.find_elements(selector)
                for elem in elements:
                    if grade in elem.text:
                        logger.info(f"등급 선택: {grade}")
                        elem.click()
                        human_delay(0.5, 1.0)
                        return True
            return False
        except:
            return False
    
    def _click_canvas_seat(self, canvas_selector: str) -> bool:
        """Canvas 좌석 맵에서 좌석 클릭"""
        try:
            # Canvas 요소 찾기
            canvas = self.sb.find_element(canvas_selector)
            
            # Canvas 중앙 근처 클릭 (좌석이 있을 확률 높은 위치)
            # 실제로는 픽셀 분석이 필요하지만, 간단한 구현
            width = canvas.size['width']
            height = canvas.size['height']
            
            # 여러 위치 시도
            positions = [
                (width // 2, height // 2),
                (width // 3, height // 2),
                (width * 2 // 3, height // 2),
                (width // 2, height // 3),
                (width // 2, height * 2 // 3),
            ]
            
            for x, y in positions:
                try:
                    self.sb.execute_script(
                        f"arguments[0].dispatchEvent(new MouseEvent('click', {{clientX: {x}, clientY: {y}}}));",
                        canvas
                    )
                    human_delay(0.3, 0.5)
                    
                    # 좌석 선택 확인 팝업 체크
                    if self.sb.is_element_present('.seat-selected', timeout=0.5):
                        logger.info(f"좌석 선택됨: ({x}, {y})")
                        return True
                except:
                    continue
            
            return False
            
        except Exception as e:
            logger.warning(f"Canvas 클릭 오류: {e}")
            return False
    
    def _proceed_to_payment(self) -> bool:
        """결제 진행"""
        logger.info("결제 페이지로 진행...")
        
        try:
            # 동의 체크박스 처리
            for selector in SELECTORS['agree_checkbox']:
                if self.sb.is_element_present(selector, timeout=1):
                    self.sb.click(selector)
                    human_delay(0.3, 0.5)
            
            # 다음/확인 버튼
            next_btn = find_first_selector(self.sb, SELECTORS['next_btn'], timeout=3)
            if next_btn:
                self.sb.click(next_btn)
                human_delay(1.0, 2.0)
            
            # CAPTCHA 처리 (문자열 입력)
            if self._handle_captcha():
                logger.info("CAPTCHA 처리 완료")
            
            # 결제 버튼
            payment_btn = find_first_selector(self.sb, SELECTORS['payment_btn'], timeout=10)
            if payment_btn:
                logger.info("결제 버튼 클릭!")
                self.sb.click(payment_btn)
                
                # 결제 완료 대기 (수동 결제)
                logger.info(f"⏳ 결제 대기 중... (최대 {Timeouts.PAYMENT_MAX // 60}분)")
                logger.info("💳 수동으로 결제를 완료해주세요!")
                
                # 알림음 (macOS)
                os.system('say "결제 페이지 도착. 수동 결제 필요."')
                
                time.sleep(Timeouts.PAYMENT_MAX)
                return True
            
            return False
            
        except Exception as e:
            logger.warning(f"결제 진행 오류: {e}")
            return False
    
    def _handle_captcha(self) -> bool:
        """CAPTCHA (문자열 입력) 처리"""
        try:
            captcha_input = find_first_selector(self.sb, SELECTORS['captcha_input'], timeout=3)
            if not captcha_input:
                return True  # CAPTCHA 없음
            
            logger.info("🔐 CAPTCHA 감지 - 수동 입력 대기...")
            logger.info("⌨️ CAPTCHA 문자를 입력한 후 Enter를 눌러주세요!")
            
            # 알림음
            os.system('say "캡챠 입력 필요"')
            
            # 사용자 입력 대기 (최대 60초)
            start_time = time.time()
            while time.time() - start_time < 60:
                if not self.sb.is_element_present(captcha_input, timeout=1):
                    # CAPTCHA가 사라짐 = 성공
                    return True
                time.sleep(1)
            
            return False
            
        except Exception as e:
            logger.warning(f"CAPTCHA 처리 오류: {e}")
            return False
    
    def test_login_only(self) -> bool:
        """로그인만 테스트"""
        logger.info("=== 로그인 테스트 모드 ===")
        
        with SB(
            uc=True,
            headless=False,
            incognito=True,
            locale="ko_KR",
        ) as sb:
            self.sb = sb
            
            if self._login():
                logger.info("✅ 로그인 테스트 성공!")
                
                # 5초 대기 후 종료
                logger.info("5초 후 브라우저 종료...")
                time.sleep(5)
                return True
            else:
                logger.error("❌ 로그인 테스트 실패!")
                return False


# ============ CLI ============
def main():
    parser = argparse.ArgumentParser(description='BTS 티켓팅 매크로 (SeleniumBase UC Mode)')
    parser.add_argument('--test-login', action='store_true', help='로그인만 테스트')
    parser.add_argument('--env', default='.env.local', help='환경변수 파일 경로')
    args = parser.parse_args()
    
    try:
        config = Config.from_env(args.env)
    except ValueError as e:
        logger.error(f"설정 오류: {e}")
        logger.info("환경변수를 .env.local 파일에 설정하세요:")
        logger.info("  INTERPARK_ID=your_id")
        logger.info("  INTERPARK_PWD=your_password")
        logger.info("  CONCERT_URL=https://tickets.interpark.com/goods/XXXXXXX")
        sys.exit(1)
    
    ticketing = InterparkTicketing(config)
    
    if args.test_login:
        success = ticketing.test_login_only()
    else:
        success = ticketing.run()
    
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
