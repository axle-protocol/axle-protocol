#!/usr/bin/env python3
"""
BTS 티켓팅 매크로 - Playwright 버전 v2.0
- NOL 인터파크 로그인 + 예매 플로우
- Turnstile 캡챠 자동 해결 (headful iframe 클릭)
- 고급 좌석 선택 + 결제 자동화
- 에러 복구 및 재시도 로직

Usage:
    python main_playwright.py --test           # 즉시 테스트
    python main_playwright.py --hour 20        # 20시 예매
    python main_playwright.py --url URL        # 특정 공연 URL
    python main_playwright.py --login-only     # 로그인만 테스트
"""

import os
import sys
import time
import random
import argparse
import re
import requests
from datetime import datetime
from typing import Optional, List, Dict, Any, Tuple
from dataclasses import dataclass, field
from enum import Enum

from playwright.sync_api import (
    sync_playwright, Page, Browser, BrowserContext, 
    Frame, Locator, TimeoutError as PlaywrightTimeout
)
from dotenv import load_dotenv

# Stealth 모드
try:
    from playwright_stealth import stealth_sync
    STEALTH_AVAILABLE = True
except ImportError:
    STEALTH_AVAILABLE = False
    print("⚠️ playwright-stealth 미설치. pip install playwright-stealth")

# 환경변수 로드
load_dotenv('.env.local')
load_dotenv('../.env.local')

# ============ 설정 ============
USER_ID = os.getenv('INTERPARK_ID', '')
USER_PW = os.getenv('INTERPARK_PWD', '')
CONCERT_URL = os.getenv('CONCERT_URL', '')
BIRTH_DATE = os.getenv('BIRTH_DATE', '')
CAPSOLVER_KEY = os.getenv('CAPSOLVER_API_KEY', '')

# IPRoyal 프록시 설정
PROXY_HOST = os.getenv('PROXY_HOST', '')
PROXY_PORT = os.getenv('PROXY_PORT', '')
PROXY_USER = os.getenv('PROXY_USER', '')
PROXY_PASS = os.getenv('PROXY_PASS', '')

# 테스트용 공연 URL (실제 예매 가능한 공연)
TEST_URLS = [
    'https://tickets.interpark.com/goods/26002054',  # 뮤지컬
    'https://tickets.interpark.com/goods/26001724',
    'https://tickets.interpark.com/goods/26001819',
]


# ============ 유틸리티 ============
class LogLevel(Enum):
    DEBUG = 'DEBUG'
    INFO = 'INFO'
    WARN = 'WARN'
    ERROR = 'ERROR'
    SUCCESS = 'SUCCESS'


def log(msg: str, level: LogLevel = LogLevel.INFO):
    """로그 출력"""
    timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
    emoji_map = {
        LogLevel.DEBUG: '🔍',
        LogLevel.INFO: 'ℹ️',
        LogLevel.WARN: '⚠️',
        LogLevel.ERROR: '❌',
        LogLevel.SUCCESS: '✅',
    }
    emoji = emoji_map.get(level, '')
    print(f'[{timestamp}] {emoji} {msg}', flush=True)


def human_delay(min_ms: int = 50, max_ms: int = 150):
    """인간적인 딜레이"""
    time.sleep(random.uniform(min_ms / 1000, max_ms / 1000))


def adaptive_sleep(base: float, variance: float = 0.3):
    """적응형 대기"""
    actual = base * (1 + random.uniform(-variance, variance))
    time.sleep(max(0.01, actual))


def solve_turnstile_capsolver(url: str, sitekey: str) -> Optional[str]:
    """CapSolver API로 Turnstile 캡챠 해결"""
    if not CAPSOLVER_KEY:
        log("⚠️ CAPSOLVER_API_KEY 없음", LogLevel.WARN)
        return None
    
    log(f"🔐 CapSolver로 Turnstile 해결 중... (sitekey: {sitekey[:20]}...)")
    
    try:
        # 1. 태스크 생성
        create_task_url = "https://api.capsolver.com/createTask"
        task_payload = {
            "clientKey": CAPSOLVER_KEY,
            "task": {
                "type": "AntiTurnstileTaskProxyLess",
                "websiteURL": url,
                "websiteKey": sitekey,
            }
        }
        
        response = requests.post(create_task_url, json=task_payload, timeout=30)
        result = response.json()
        
        if result.get("errorId") != 0:
            log(f"CapSolver 태스크 생성 실패: {result.get('errorDescription')}", LogLevel.ERROR)
            return None
        
        task_id = result.get("taskId")
        log(f"태스크 생성됨: {task_id}")
        
        # 2. 결과 폴링 (최대 120초)
        get_result_url = "https://api.capsolver.com/getTaskResult"
        for i in range(60):  # 2초 간격 × 60 = 120초
            time.sleep(2)
            
            result_payload = {
                "clientKey": CAPSOLVER_KEY,
                "taskId": task_id
            }
            
            response = requests.post(get_result_url, json=result_payload, timeout=30)
            result = response.json()
            
            status = result.get("status")
            if status == "ready":
                token = result.get("solution", {}).get("token")
                if token:
                    log(f"✅ Turnstile 토큰 획득! (길이: {len(token)})", LogLevel.SUCCESS)
                    return token
            elif status == "failed":
                log(f"CapSolver 실패: {result.get('errorDescription')}", LogLevel.ERROR)
                return None
            
            if i % 5 == 0:
                log(f"⏳ 대기 중... ({i*2}초)", LogLevel.DEBUG)
        
        log("CapSolver 타임아웃 (120초)", LogLevel.ERROR)
        return None
        
    except Exception as e:
        log(f"CapSolver 에러: {e}", LogLevel.ERROR)
        return None


# ============ 설정 클래스 ============
class PaymentMethod(Enum):
    KAKAO_PAY = "kakaopay"
    NAVER_PAY = "naverpay"
    CREDIT_CARD = "card"
    BANK_TRANSFER = "transfer"
    TOSS = "toss"


@dataclass
class TicketingConfig:
    """티켓팅 설정"""
    url: str = ''
    birth_date: str = ''
    target_hour: int = 20
    target_minute: int = 0
    num_seats: int = 2
    consecutive: bool = True
    zone_priority: Optional[List[str]] = None
    preferred_rows: Tuple[int, int] = (1, 10)
    payment_method: str = 'kakao'
    auto_pay: bool = False
    headless: bool = False
    use_capsolver: bool = False
    use_proxy: bool = False  # 프록시 사용 여부
    max_retries: int = 3
    timeout_ms: int = 30000
    
    def __post_init__(self):
        if self.zone_priority is None:
            self.zone_priority = [
                '스탠딩A', '스탠딩B', 'VIP', 'VVIP', 'R석', 'S석', 'A석', 'B석',
                '1층', '2층', '3층', 'FLOOR', 'STANDING'
            ]


@dataclass
class SeatInfo:
    """좌석 정보"""
    zone: str = ""
    grade: str = ""
    row: str = ""
    seat_num: str = ""
    x: int = 0
    y: int = 0
    score: float = 0.0
    selector: str = ""
    raw_id: str = ""


# ============ 메인 클래스 ============
class NOLTicketing:
    """NOL 인터파크 티켓팅 매크로 - Playwright"""
    
    # URL 상수
    LOGIN_BASE = 'https://accounts.yanolja.com/signin/email'
    LOGIN_PARAMS = 'clientId=ticket-pc&postProc=FULLSCREEN&origin=https%3A%2F%2Fnol.interpark.com%2Fticket&service=interpark-ticket'
    TURNSTILE_SITEKEY = '0x4AAAAAAAWSXlM_3OoUgVHN'
    
    # 셀렉터 상수
    SEAT_FRAME_SELECTORS = ['#ifrmSeat', 'iframe[name="ifrmSeat"]', 'iframe[src*="seat"]']
    BOOK_FRAME_SELECTORS = ['#ifrmBookStep', 'iframe[name="ifrmBookStep"]']
    
    SEAT_SELECTORS = [
        "circle[class*='st'][fill]:not([fill*='gray']):not([fill*='#ccc']):not([fill*='#999'])",
        "circle[class*='seat'][class*='available']",
        "circle[class*='seat']:not([class*='sold']):not([class*='disabled'])",
        "circle.available",
        "rect[class*='seat']:not([class*='sold'])",
        "[data-seat-status='available']",
        "[data-available='true']",
    ]
    
    NEXT_STEP_SELECTORS = [
        '#SmallNextBtnImage',
        '#LargeNextBtnImage', 
        '#NextStepImage',
        'button:has-text("다음")',
        'a:has-text("다음")',
    ]
    
    PRICE_SELECTORS = [
        '#PriceRow001 td select',
        'tr[id*="PriceRow"] td select',
        'select[id*="Price"]',
    ]
    
    BIRTH_SELECTORS = [
        '#YYMMDD',
        'input[name="YYMMDD"]',
        'input[placeholder*="생년월일"]',
        'input[maxlength="6"]',
    ]
    
    PAYMENT_SELECTORS = {
        PaymentMethod.KAKAO_PAY: ['#Payment_22019 input', '[class*="kakao"] input', 'img[src*="kakao"]'],
        PaymentMethod.NAVER_PAY: ['#Payment_22020 input', '[class*="naver"] input', 'img[src*="naver"]'],
        PaymentMethod.CREDIT_CARD: ['#Payment_22001 input', 'input[value*="카드"]'],
        PaymentMethod.BANK_TRANSFER: ['#Payment_22004 input', 'input[value*="이체"]'],
        PaymentMethod.TOSS: ['#Payment_22022 input', '[class*="toss"] input'],
    }
    
    AGREE_SELECTORS = ['#checkAll', '#agreeAll', 'input[id*="agreeAll"]']
    
    def __init__(self, config: TicketingConfig):
        self.config = config
        self.browser: Optional[Browser] = None
        self.context: Optional[BrowserContext] = None
        self.page: Optional[Page] = None
        self.booking_page: Optional[Page] = None  # 예매 팝업 페이지
        self.logged_in = False
        
        # 상태 추적
        self.selected_seats: List[SeatInfo] = []
        self.current_zone: str = ""
        self.order_number: str = ""
        
        # 통계
        self.stats = {
            'login_attempts': 0,
            'booking_attempts': 0,
            'seat_clicks': 0,
            'errors': 0,
            'retries': 0,
        }
    
    def _log(self, msg: str, level: LogLevel = LogLevel.INFO):
        log(msg, level)
    
    # ============ 브라우저 관리 ============
    def start_browser(self, playwright) -> bool:
        """브라우저 시작 (프록시 + Stealth 모드)"""
        self._log('🌐 브라우저 시작...')
        
        try:
            # 프록시 설정 (IPRoyal 형식)
            proxy_config = None
            if PROXY_HOST and PROXY_PORT and self.config.use_proxy:
                # IPRoyal은 URL 형식 인증 필요
                proxy_config = {
                    "server": f"http://{PROXY_HOST}:{PROXY_PORT}",
                }
                if PROXY_USER and PROXY_PASS:
                    proxy_config["username"] = PROXY_USER
                    proxy_config["password"] = PROXY_PASS
                self._log(f'🌍 프록시 설정: {PROXY_HOST}:{PROXY_PORT} (한국)')
            
            self.browser = playwright.chromium.launch(
                headless=self.config.headless,
                args=[
                    '--disable-blink-features=AutomationControlled',
                    '--disable-dev-shm-usage',
                    '--no-sandbox',
                    '--disable-infobars',
                    '--disable-extensions',
                    '--disable-gpu',
                    '--disable-setuid-sandbox',
                    '--ignore-certificate-errors',
                ]
            )
            
            context_options = {
                'locale': 'ko-KR',
                'user_agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
                'viewport': {'width': 1280, 'height': 900},
                'java_script_enabled': True,
                'bypass_csp': True,
                'ignore_https_errors': True,
            }
            
            # 프록시 적용
            if proxy_config:
                context_options['proxy'] = proxy_config
            
            self.context = self.browser.new_context(**context_options)
            
            # 타임아웃 설정
            self.context.set_default_timeout(self.config.timeout_ms)
            
            self.page = self.context.new_page()
            
            # Stealth 모드 적용
            if STEALTH_AVAILABLE:
                stealth_sync(self.page)
                self._log('🥷 Stealth 모드 활성화', LogLevel.SUCCESS)
            
            # 추가 자동화 감지 우회 + Turnstile 콜백 인터셉트
            self.page.add_init_script("""
                // webdriver 숨김
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
                
                // plugins 배열 추가
                Object.defineProperty(navigator, 'plugins', {
                    get: () => [1, 2, 3, 4, 5]
                });
                
                // languages 설정
                Object.defineProperty(navigator, 'languages', {
                    get: () => ['ko-KR', 'ko', 'en-US', 'en']
                });
                
                // Chrome 객체 추가
                window.chrome = {
                    runtime: {},
                    loadTimes: function() {},
                    csi: function() {},
                    app: {}
                };
                
                // Permissions 우회
                const originalQuery = window.navigator.permissions.query;
                window.navigator.permissions.query = (parameters) => (
                    parameters.name === 'notifications' ?
                        Promise.resolve({ state: Notification.permission }) :
                        originalQuery(parameters)
                );
                
                // ⭐ Turnstile 콜백 인터셉트 (핵심!)
                const turnstileInterval = setInterval(() => {
                    if (window.turnstile) {
                        clearInterval(turnstileInterval);
                        const originalRender = window.turnstile.render;
                        window.turnstile.render = function(container, options) {
                            // 콜백 함수를 전역 변수에 저장
                            window.cfCallback = options.callback;
                            window.cfSitekey = options.sitekey;
                            console.log('✅ Turnstile 콜백 인터셉트 완료');
                            // 원본 render 호출
                            return originalRender.call(this, container, options);
                        };
                    }
                }, 50);
            """)
            
            self._log('브라우저 준비 완료', LogLevel.SUCCESS)
            return True
            
        except Exception as e:
            self._log(f'브라우저 시작 실패: {e}', LogLevel.ERROR)
            return False
    
    def close_browser(self):
        """브라우저 종료"""
        if self.browser:
            self.browser.close()
            self._log('🔒 브라우저 종료')
    
    # ============ 로그인 ============
    def login(self) -> bool:
        """NOL 로그인"""
        self._log('🔐 로그인 시작...')
        self.stats['login_attempts'] += 1
        
        for attempt in range(self.config.max_retries):
            try:
                # 로그인 페이지 접속
                login_url = f'{self.LOGIN_BASE}?{self.LOGIN_PARAMS}'
                self._log(f'로그인 페이지 접속 (시도 {attempt + 1})...')
                self.page.goto(login_url, wait_until='domcontentloaded', timeout=60000)
                adaptive_sleep(2)
                
                # 이메일 입력
                self._log(f'이메일 입력: {USER_ID[:3]}***')
                email_input = self.page.locator('input[name="email"]')
                email_input.fill('')
                email_input.type(USER_ID, delay=random.uniform(30, 80))
                human_delay(100, 200)
                
                # 비밀번호 입력
                self._log('비밀번호 입력...')
                pw_input = self.page.locator('input[name="password"]')
                pw_input.fill('')
                pw_input.type(USER_PW, delay=random.uniform(30, 80))
                human_delay(100, 200)
                
                # Turnstile 캡챠 처리
                self._log('Turnstile 캡챠 처리...')
                self._handle_turnstile()
                adaptive_sleep(3)  # 캡챠 처리 대기
                
                # 로그인 버튼 활성화 대기 (캡챠 완료 필요)
                self._log('로그인 버튼 대기...')
                submit_btn = self.page.locator('button[type="submit"]:not([disabled]):not([aria-disabled="true"])')
                
                # 버튼 활성화 대기 (최대 30초, 캡챠 완료 시간 필요)
                max_wait = 30
                for wait_i in range(max_wait):
                    try:
                        if submit_btn.count() > 0 and submit_btn.first.is_enabled(timeout=500):
                            self._log('로그인 버튼 활성화됨', LogLevel.SUCCESS)
                            break
                    except:
                        pass
                    
                    # 5초마다 캡챠 재시도
                    if wait_i > 0 and wait_i % 5 == 0:
                        self._log(f'버튼 대기 중... ({wait_i}초)', LogLevel.DEBUG)
                        self._handle_turnstile()
                    
                    adaptive_sleep(1)
                else:
                    # 30초 후에도 비활성화면 수동 처리 안내
                    self._log('⏳ 캡챠 자동 처리 실패 - 30초 수동 대기...', LogLevel.WARN)
                    self._log('💡 브라우저에서 캡챠를 직접 해결해주세요', LogLevel.INFO)
                    self.page.screenshot(path='/tmp/captcha_manual.png')
                    
                    # 수동 대기 (30초)
                    for manual_i in range(30):
                        try:
                            if submit_btn.count() > 0 and submit_btn.first.is_enabled(timeout=500):
                                self._log('수동 캡챠 처리 완료!', LogLevel.SUCCESS)
                                break
                        except:
                            pass
                        adaptive_sleep(1)
                
                # 로그인 버튼 클릭
                self._log('로그인 버튼 클릭...')
                if submit_btn.count() > 0:
                    try:
                        submit_btn.first.click(timeout=5000)
                    except:
                        # 강제 클릭
                        self.page.evaluate('document.querySelector("button[type=submit]").click()')
                
                # 로그인 완료 대기
                adaptive_sleep(5)
                
                # 로그인 성공 확인
                if self._verify_login():
                    self._log('로그인 성공!', LogLevel.SUCCESS)
                    self.logged_in = True
                    return True
                
                self._log(f'로그인 확인 실패 (시도 {attempt + 1})', LogLevel.WARN)
                
            except Exception as e:
                self._log(f'로그인 에러 (시도 {attempt + 1}): {e}', LogLevel.ERROR)
                self.stats['errors'] += 1
        
        self._log('로그인 최종 실패', LogLevel.ERROR)
        return False
    
    def _verify_login(self) -> bool:
        """로그인 성공 확인"""
        current_url = self.page.url.lower()
        
        # URL 기반 확인
        if 'signin' not in current_url and 'accounts.yanolja' not in current_url:
            return True
        
        if 'nol.interpark.com' in current_url or 'tickets.interpark.com' in current_url:
            return True
        
        # 요소 기반 확인 (로그아웃 버튼 등)
        try:
            logout_btn = self.page.locator('text=로그아웃, text=마이페이지')
            if logout_btn.count() > 0:
                return True
        except:
            pass
        
        return False
    
    def handle_yanolja_redirect(self) -> bool:
        """야놀자 로그인 리다이렉트 감지 및 처리"""
        current_url = self.page.url.lower()
        
        if 'accounts.yanolja.com' not in current_url:
            return True  # 리다이렉트 없음
        
        self._log('⚠️ 야놀자 로그인 리다이렉트 감지!')
        self._log('🔐 야놀자 계정으로 재로그인...')
        
        try:
            # 이미 로그인 폼이 보이는지 확인
            email_input = self.page.locator('input[name="email"], input[type="email"]')
            if email_input.is_visible(timeout=5000):
                # 이메일/비밀번호 입력
                email_input.fill(USER_ID)
                adaptive_sleep(0.5)
                
                pw_input = self.page.locator('input[name="password"], input[type="password"]')
                pw_input.fill(USER_PW)
                adaptive_sleep(0.5)
                
                # Turnstile 처리
                self._handle_turnstile()
                adaptive_sleep(2)
                
                # 로그인 버튼 클릭
                submit_btn = self.page.locator('button[type="submit"]')
                submit_btn.click()
                adaptive_sleep(5)
                
                # 리다이렉트 완료 확인
                new_url = self.page.url.lower()
                if 'tickets.interpark' in new_url or 'nol.interpark' in new_url:
                    self._log('✅ 야놀자 로그인 후 복귀 성공!')
                    return True
                    
        except Exception as e:
            self._log(f'야놀자 로그인 실패: {e}', LogLevel.ERROR)
        
        return False
    
    def _handle_turnstile(self):
        """Turnstile 캡챠 처리 - CapSolver API 우선, 폴백으로 클릭"""
        
        # 방법 1: CapSolver API 사용 (권장)
        if CAPSOLVER_KEY:
            self._log('🔐 CapSolver API로 Turnstile 해결 시도...')
            token = solve_turnstile_capsolver(self.page.url, self.TURNSTILE_SITEKEY)
            
            if token:
                # 토큰 주입 (개선된 버전)
                try:
                    self.page.evaluate(f'''
                        (function() {{
                            const token = "{token}";
                            
                            // ⭐ 방법 1: 인터셉트한 콜백 함수 호출 (핵심!)
                            if (typeof window.cfCallback === 'function') {{
                                window.cfCallback(token);
                                console.log('✅ cfCallback 호출 완료');
                            }}
                            
                            // 방법 2: hidden input 필드 업데이트 + 이벤트 트리거
                            const selectors = [
                                'input[name="cf-turnstile-response"]',
                                'input[name="g-recaptcha-response"]',
                                'textarea[name="cf-turnstile-response"]',
                                'input[id*="cf-chl-widget"]'
                            ];
                            
                            for (const sel of selectors) {{
                                const input = document.querySelector(sel);
                                if (input) {{
                                    input.value = token;
                                    input.dispatchEvent(new Event('input', {{ bubbles: true }}));
                                    input.dispatchEvent(new Event('change', {{ bubbles: true }}));
                                    console.log('✅ 토큰 주입:', sel);
                                }}
                            }}
                            
                            // 방법 3: data-sitekey 요소의 hidden input
                            const turnstileDiv = document.querySelector('[data-sitekey], .cf-turnstile');
                            if (turnstileDiv) {{
                                const hiddenInput = turnstileDiv.querySelector('input[type="hidden"]');
                                if (hiddenInput) {{
                                    hiddenInput.value = token;
                                    hiddenInput.dispatchEvent(new Event('change', {{ bubbles: true }}));
                                }}
                            }}
                            
                            // 방법 4: 폼 유효성 재검사 트리거
                            const form = document.querySelector('form');
                            if (form) {{
                                form.dispatchEvent(new Event('change', {{ bubbles: true }}));
                            }}
                            
                            // 방법 5: 로그인 버튼 강제 활성화 시도
                            const submitBtn = document.querySelector('button[type="submit"]');
                            if (submitBtn && submitBtn.disabled) {{
                                submitBtn.disabled = false;
                                submitBtn.removeAttribute('disabled');
                                submitBtn.removeAttribute('aria-disabled');
                                console.log('✅ 로그인 버튼 강제 활성화');
                            }}
                            
                            console.log('✅ Turnstile 토큰 주입 완료');
                        }})();
                    ''')
                    self._log('✅ CapSolver 토큰 주입 완료!', LogLevel.SUCCESS)
                    adaptive_sleep(2)
                    return
                except Exception as e:
                    self._log(f'토큰 주입 실패: {e}', LogLevel.WARN)
        
        # 방법 2: iframe 클릭 (폴백)
        self._log('📍 iframe 클릭으로 Turnstile 시도 (폴백)...')
        try:
            turnstile_selectors = [
                'iframe[src*="challenges"]',
                'iframe[src*="turnstile"]',
                'iframe[title*="Turnstile"]',
                '[data-testid="turnstile-widget"] iframe',
            ]
            
            for selector in turnstile_selectors:
                try:
                    iframe = self.page.locator(selector).first
                    if iframe.is_visible(timeout=3000):
                        box = iframe.bounding_box()
                        if box:
                            click_x = box['x'] + 25
                            click_y = box['y'] + 25
                            
                            self._log(f'Turnstile 클릭: ({click_x:.0f}, {click_y:.0f})', LogLevel.DEBUG)
                            self.page.mouse.click(click_x, click_y)
                            self._log('Turnstile 체크박스 클릭 완료')
                            adaptive_sleep(4)
                            return
                except:
                    continue
            
            # 방법 3: frame 내부 클릭 (최후의 폴백)
            for frame in self.page.frames:
                if 'challenges' in frame.url or 'turnstile' in frame.url:
                    self._log('Turnstile 프레임 발견 (폴백)', LogLevel.DEBUG)
                    try:
                        frame.locator('body').click(position={'x': 25, 'y': 25}, timeout=5000)
                        self._log('체크박스 클릭 완료')
                        adaptive_sleep(4)
                    except Exception as e:
                        self._log(f'체크박스 클릭 실패: {str(e)[:50]}', LogLevel.WARN)
                    break
                    
        except Exception as e:
            self._log(f'Turnstile 처리 실패: {str(e)[:50]}', LogLevel.WARN)
    
    # ============ 공연 페이지 ============
    def navigate_to_concert(self) -> bool:
        """공연 페이지 이동"""
        if not self.config.url:
            self._log('공연 URL 없음', LogLevel.ERROR)
            return False
        
        self._log(f'🎯 공연 페이지 접속: {self.config.url[:60]}...')
        
        for attempt in range(self.config.max_retries):
            try:
                self.page.goto(self.config.url, wait_until='domcontentloaded', timeout=30000)
                adaptive_sleep(3)
                
                current_url = self.page.url
                title = self.page.title()
                
                self._log(f'현재 URL: {current_url[:60]}...')
                self._log(f'페이지 제목: {title[:40]}...' if len(title) > 40 else f'페이지 제목: {title}')
                
                # 리다이렉트 확인
                if 'nol.interpark.com' in current_url and 'goods' not in current_url:
                    self._log('NOL 메인으로 리다이렉트됨', LogLevel.WARN)
                    continue
                
                # 예매 버튼 확인
                booking_btn = self.page.locator('text=예매하기, a:has-text("예매"), button:has-text("예매")')
                if booking_btn.count() > 0:
                    self._log('공연 페이지 정상 로드', LogLevel.SUCCESS)
                    return True
                
            except Exception as e:
                self._log(f'페이지 접속 에러 (시도 {attempt + 1}): {e}', LogLevel.ERROR)
                self.stats['errors'] += 1
        
        return False
    
    def click_booking_button(self) -> bool:
        """NOL 티켓 예매 플로우: 모달 닫기 → 날짜 → 회차 → 예매하기"""
        self._log('📍 예매 플로우 시작...')
        self.stats['booking_attempts'] += 1
        
        # React SPA 로딩 대기
        try:
            self.page.wait_for_load_state('networkidle', timeout=10000)
            adaptive_sleep(2)
        except:
            pass
        
        # Step 1: "예매 안내" 모달 닫기 (force 클릭)
        self._log('📋 Step 1: 모달 닫기...')
        try:
            close_btn = self.page.locator('button:has-text("닫기")').first
            if close_btn.is_visible(timeout=3000):
                close_btn.click(force=True)
                self._log('✅ 모달 닫기 성공')
                adaptive_sleep(1)
        except:
            self._log('ℹ️ 닫기 버튼 없음 (모달 없을 수 있음)')
        
        # Step 2: 하단 "예매하기" 버튼 클릭
        self._log('📋 Step 2: 예매하기 버튼 클릭...')
        booking_selectors = [
            'a.sideBtn.is-primary',  # NOL 티켓 예매하기 버튼
            'a[class*="sideBtn"][class*="primary"]',
            'button:has-text("예매하기")',
            '[class*="bookingBtn"]',
        ]
        
        # 예매 버튼 찾기
        btn = None
        for selector in booking_selectors:
            try:
                elements = self.page.locator(selector).all()
                for el in elements:
                    if el.is_visible(timeout=1000):
                        text = (el.text_content() or "").strip()
                        href = el.get_attribute('href') or ""
                        
                        # 앵커 링크 제외
                        if href.startswith('#'):
                            continue
                        
                        # "바로가기" 제외
                        if '바로가기' in text:
                            continue
                        
                        # ⭐ "예매하기" 버튼 = 최우선!
                        if text == '예매하기':
                            self._log(f'✅ 예매하기 버튼 발견: {selector[:30]}')
                            btn = el
                            break
                            
                        # 날짜 패턴 또는 예매/선예매 텍스트
                        if '예매' in text or '선예매' in text or ('.' in text and '(' in text):
                            self._log(f'버튼 발견: {selector[:30]} (텍스트: {text[:30]})')
                            btn = el
                            break
                if btn:
                    break
            except:
                continue
        
        if not btn:
            # JS로 예매하기 버튼 클릭 시도
            self._log('📋 JS로 예매하기 버튼 클릭 시도...')
            try:
                clicked = self.page.evaluate('''(function() {
                    var btn = document.querySelector('a.sideBtn.is-primary');
                    if (btn && btn.textContent.includes('예매하기')) {
                        btn.click();
                        return true;
                    }
                    return false;
                })()''')
                if clicked:
                    self._log('✅ JS 클릭 성공')
                    adaptive_sleep(3)
                else:
                    self._log('예매 버튼 못찾음', LogLevel.WARN)
                    return False
            except Exception as e:
                self._log(f'JS 클릭 실패: {e}', LogLevel.WARN)
                return False
        else:
            # 예매하기 버튼 클릭
            self._log('🚀 예매하기 버튼 클릭...')
            btn.click(force=True)
            adaptive_sleep(2)
        
        # ⭐ 모달 내 예매 버튼 찾기 + 클릭
        self._log('📋 모달 내 예매 버튼 검색...')
        
        modal_booking_selectors = [
            # ⭐ BottomSheet 모달 내 스케줄 카드 (NOL 신규)
            '[class*="BottomSheet"] [class*="schedule"]',
            '[class*="BottomSheet"] [class*="Schedule"]',
            '[class*="BottomSheet"] [class*="item"]',
            '[class*="BottomSheet"] a',
            '[class*="PopupContainer"] [class*="schedule"]',
            '[class*="PopupContainer"] a',
            
            # 모달 내 카드/아이템 전체 클릭
            '[role="dialog"] [class*="card"]',
            '[role="dialog"] [class*="Card"]',
            '[role="presentation"] a',
            
            # 모달 내 예매 버튼 패턴
            '.modal button:has-text("예매")',
            '.modal a:has-text("예매")',
            '[class*="modal"] button:has-text("예매")',
            '[class*="modal"] a:has-text("예매")',
            '[role="dialog"] button:has-text("예매")',
            '[role="dialog"] a:has-text("예매")',
            
            # 일반 예매 버튼
            'button:has-text("예매하기")',
            'a:has-text("예매하기")',
            'button:has-text("선예매")',
            'a:has-text("선예매")',
        ]
        
        for selector in modal_booking_selectors:
            try:
                modal_btn = self.page.locator(selector).first
                if modal_btn.is_visible(timeout=2000):
                    text = modal_btn.text_content() or ""
                    self._log(f'모달 예매 버튼 발견: {selector[:30]} (텍스트: {text[:20]})')
                    
                    # ⭐ force 클릭 (backdrop 차단 우회)
                    try:
                        # 방법 1: force=True로 강제 클릭
                        self._log('강제 클릭 시도 (force=True)...')
                        
                        try:
                            with self.page.expect_popup(timeout=10000) as popup_info:
                                modal_btn.click(force=True, timeout=5000)
                            
                            self.booking_page = popup_info.value
                            self.booking_page.wait_for_load_state('domcontentloaded', timeout=30000)
                            self._log(f'✅ 예매 팝업 열림: {self.booking_page.url[:50]}...', LogLevel.SUCCESS)
                            return True
                        except:
                            pass
                        
                        # 방법 2: JavaScript로 직접 클릭
                        self._log('JS 클릭 시도...')
                        self.page.evaluate('''
                            var links = document.querySelectorAll('a, button');
                            for (var link of links) {
                                if (link.textContent && (link.textContent.includes('예매') || link.textContent.includes('선예매'))) {
                                    link.click();
                                    break;
                                }
                            }
                        ''')
                        
                        adaptive_sleep(3)
                        current_url = self.page.url.lower()
                        if 'book' in current_url or 'seat' in current_url or 'onestop' in current_url:
                            self.booking_page = self.page
                            self._log(f'✅ JS 클릭 후 예매 진행: {self.page.url[:50]}...', LogLevel.SUCCESS)
                            return True
                            
                    except Exception as click_err:
                        self._log(f'클릭 실패: {click_err}', LogLevel.DEBUG)
            except:
                continue
        
        # 폴백: 모달이 아닌 일반 페이지 변경 확인
        adaptive_sleep(2)
        current_url = self.page.url.lower()
        self._log(f'현재 URL: {current_url[:60]}')
        
        # ⭐ 야놀자 리다이렉트 체크
        if 'accounts.yanolja.com' in current_url:
            self._log('⚠️ 야놀자 로그인 리다이렉트 감지!')
            if self.handle_yanolja_redirect():
                # 리다이렉트 처리 후 다시 예매 시도
                return self.click_booking_button()
            else:
                self._log('야놀자 로그인 실패', LogLevel.ERROR)
                return False
        
        if 'book' in current_url or 'seat' in current_url or 'onestop' in current_url:
            self.booking_page = self.page
            self._log(f'✅ 예매 페이지 진입: {self.page.url[:50]}...', LogLevel.SUCCESS)
            return True
        
        # 디버깅
        self._dump_page_buttons()
        self._log('모달 예매 버튼 못찾음', LogLevel.WARN)
        return False
    
    def _get_active_page(self) -> Page:
        """예매 진행 중인 페이지 반환 (팝업 또는 현재)"""
        return self.booking_page if self.booking_page else self.page
    
    def _dump_page_buttons(self):
        """디버깅: 페이지 내 모든 버튼/링크 출력"""
        try:
            buttons = self.page.evaluate('''
                var result = [];
                var elements = document.querySelectorAll('a, button, [role="button"]');
                elements.forEach(function(el, i) {
                    if (i < 20) {  // 최대 20개
                        result.push({
                            tag: el.tagName,
                            text: (el.textContent || "").slice(0, 50).trim(),
                            class: (el.className || "").slice(0, 50)
                        });
                    }
                });
                return result;
            ''')
            
            self._log('📋 페이지 버튼/링크 목록:', LogLevel.DEBUG)
            for btn in buttons[:10]:
                self._log(f'  {btn["tag"]}: "{btn["text"]}" (class: {btn["class"][:30]})', LogLevel.DEBUG)
                
            # HTML 파일로 저장
            html = self.page.content()
            with open('/tmp/nol_page_debug.html', 'w', encoding='utf-8') as f:
                f.write(html)
            self._log('📄 HTML 저장: /tmp/nol_page_debug.html', LogLevel.DEBUG)
            
        except Exception as e:
            self._log(f'디버깅 실패: {e}', LogLevel.WARN)
    
    # ============ 예매 시간 대기 ============
    def wait_for_booking_time(self):
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
            return
        
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
                time.sleep(min(remaining * 0.9, 0.45))
            else:
                time.sleep(remaining)
                break
        
        self._log('🚀 예매 시간!')
    
    # ============ 좌석 선택 ============
    def is_seat_page(self) -> bool:
        """좌석 선택 페이지인지 확인"""
        url = self.page.url.lower()
        return any(kw in url for kw in ['seat', 'onestop', 'booking', 'reserve', 'step'])
    
    def _get_seat_frame(self) -> Optional[Frame]:
        """좌석 iframe 찾기"""
        for selector in self.SEAT_FRAME_SELECTORS:
            try:
                frame_elem = self.page.locator(selector).first
                if frame_elem.is_visible(timeout=2000):
                    frame = self.page.frame_locator(selector)
                    return frame
            except:
                continue
        return None
    
    def _get_book_frame(self) -> Optional[Frame]:
        """예매 스텝 iframe 찾기"""
        for selector in self.BOOK_FRAME_SELECTORS:
            try:
                frame_elem = self.page.locator(selector).first
                if frame_elem.is_visible(timeout=2000):
                    return self.page.frame_locator(selector)
            except:
                continue
        return None
    
    def select_zone(self) -> bool:
        """구역 선택"""
        self._log('📍 구역 선택...')
        
        zone_selectors = [
            '#GradeDetail > div > ul > li > a',
            '[class*="grade"] a',
            '[class*="zone"] a',
            'li[class*="grade"] a',
        ]
        
        seat_frame = self._get_seat_frame()
        if not seat_frame:
            self._log('좌석 프레임 없음', LogLevel.WARN)
            return True  # 프레임 없이 진행
        
        for selector in zone_selectors:
            try:
                zones = seat_frame.locator(selector).all()
                if not zones:
                    continue
                
                self._log(f'구역 {len(zones)}개 발견')
                
                # 우선순위대로 선택
                for zone in zones:
                    try:
                        text = zone.text_content() or ''
                        class_attr = zone.get_attribute('class') or ''
                        
                        # 매진 제외
                        if 'sold' in class_attr.lower() or 'disable' in class_attr.lower():
                            continue
                        
                        zone.click()
                        self.current_zone = text
                        self._log(f'구역 선택: {text}', LogLevel.SUCCESS)
                        adaptive_sleep(0.5)
                        return True
                        
                    except:
                        continue
                        
            except:
                continue
        
        self._log('구역 선택 스킵 (자동 선택 또는 단일 구역)', LogLevel.WARN)
        return True
    
    def find_available_seats(self) -> List[SeatInfo]:
        """사용 가능한 좌석 찾기"""
        self._log('🔍 좌석 검색...')
        seats = []
        
        seat_frame = self._get_seat_frame()
        target = seat_frame if seat_frame else self.page
        
        for selector in self.SEAT_SELECTORS:
            try:
                elements = target.locator(selector).all()
                if not elements:
                    continue
                
                self._log(f'좌석 후보 {len(elements)}개 발견 ({selector[:40]}...)')
                
                for elem in elements:
                    try:
                        if not elem.is_visible(timeout=500):
                            continue
                        
                        seat = self._parse_seat_element(elem, selector)
                        if seat:
                            seats.append(seat)
                            
                    except:
                        continue
                
                if seats:
                    break
                    
            except:
                continue
        
        # SVG 좌석맵 분석 (폴백)
        if not seats:
            self._log('SVG 좌석맵 분석 시도...')
            seats = self._analyze_svg_seats(target)
        
        # 점수 계산 및 정렬
        for seat in seats:
            seat.score = self._calculate_seat_score(seat)
        
        seats.sort(key=lambda s: s.score, reverse=True)
        
        self._log(f'🪑 총 {len(seats)}개 가용 좌석')
        return seats
    
    def _parse_seat_element(self, elem: Locator, selector: str) -> Optional[SeatInfo]:
        """좌석 요소 파싱"""
        try:
            seat = SeatInfo(selector=selector)
            
            # 속성 추출
            seat_id = elem.get_attribute('id') or ''
            seat_class = elem.get_attribute('class') or ''
            data_seat = elem.get_attribute('data-seat') or elem.get_attribute('data-seat-id') or ''
            title = elem.get_attribute('title') or ''
            
            seat.raw_id = seat_id or data_seat or f'seat_{id(elem)}'
            
            # 매진 확인
            if any(kw in seat_class.lower() for kw in ['sold', 'disabled', 'reserved', 'taken']):
                return None
            
            # 좌석 정보 파싱
            info_text = title or data_seat or seat_id
            if info_text:
                row_match = re.search(r'(\d+)\s*열', info_text)
                seat_match = re.search(r'(\d+)\s*번', info_text)
                
                if row_match:
                    seat.row = row_match.group(1)
                if seat_match:
                    seat.seat_num = seat_match.group(1)
            
            # 좌표
            try:
                box = elem.bounding_box()
                if box:
                    seat.x = int(box.get('x', 0))
                    seat.y = int(box.get('y', 0))
            except:
                pass
            
            return seat
            
        except:
            return None
    
    def _analyze_svg_seats(self, target) -> List[SeatInfo]:
        """SVG 기반 좌석 분석"""
        seats = []
        
        try:
            svg_data = target.evaluate('''
                () => {
                    var seats = [];
                    var svgs = document.querySelectorAll('svg');
                    
                    svgs.forEach(function(svg) {
                        var circles = svg.querySelectorAll('circle, rect');
                        circles.forEach(function(elem, idx) {
                            var fill = (elem.getAttribute('fill') || '').toLowerCase();
                            var cls = (elem.getAttribute('class') || '').toLowerCase();
                            
                            // 매진 제외
                            if (cls.includes('sold') || cls.includes('disabled')) return;
                            if (fill.includes('gray') || fill.includes('#ccc') || fill.includes('#999')) return;
                            
                            var cx = parseFloat(elem.getAttribute('cx') || elem.getAttribute('x') || 0);
                            var cy = parseFloat(elem.getAttribute('cy') || elem.getAttribute('y') || 0);
                            
                            if (cx > 0 || cy > 0) {
                                seats.push({
                                    x: cx,
                                    y: cy,
                                    id: elem.getAttribute('id') || 'svg_' + idx,
                                    fill: fill,
                                    cls: cls
                                });
                            }
                        });
                    });
                    
                    return seats;
                }
            ''')
            
            if svg_data:
                self._log(f'SVG에서 {len(svg_data)}개 좌석 후보 발견')
                
                for data in svg_data[:100]:  # 최대 100개
                    seat = SeatInfo(
                        x=int(data.get('x', 0)),
                        y=int(data.get('y', 0)),
                        raw_id=data.get('id', ''),
                    )
                    seats.append(seat)
                    
        except Exception as e:
            self._log(f'SVG 분석 실패: {e}', LogLevel.WARN)
        
        return seats
    
    def _calculate_seat_score(self, seat: SeatInfo) -> float:
        """좌석 점수 계산"""
        score = 50.0
        
        # 열 점수
        try:
            row_num = int(seat.row) if seat.row else 0
            if row_num > 0:
                if self.config.preferred_rows[0] <= row_num <= self.config.preferred_rows[1]:
                    score += 30 - (row_num - self.config.preferred_rows[0]) * 2
                else:
                    score -= abs(row_num - self.config.preferred_rows[0]) * 2
        except:
            pass
        
        # 좌표 기반 (y가 작을수록 앞쪽)
        if seat.y > 0:
            score += max(0, 10 - seat.y / 50)
        
        return score
    
    def select_consecutive_seats(self, seats: List[SeatInfo], count: int) -> List[SeatInfo]:
        """연석 선택"""
        if len(seats) < count:
            return seats[:count]
        
        self._log(f'🔍 연석 {count}석 검색...')
        
        # Y좌표로 열 그룹화
        rows: Dict[int, List[SeatInfo]] = {}
        tolerance = 20  # 같은 열 허용 오차
        
        for seat in seats:
            row_key = seat.y // tolerance
            if row_key not in rows:
                rows[row_key] = []
            rows[row_key].append(seat)
        
        best_group = []
        best_score = -1000
        
        for row_key, row_seats in rows.items():
            if len(row_seats) < count:
                continue
            
            # X좌표로 정렬
            row_seats.sort(key=lambda s: s.x)
            
            # 슬라이딩 윈도우
            for i in range(len(row_seats) - count + 1):
                group = row_seats[i:i + count]
                
                # 연속성 확인 (간격 체크)
                is_consecutive = True
                gaps = []
                
                for j in range(1, len(group)):
                    gap = group[j].x - group[j-1].x
                    gaps.append(gap)
                    if gap > 60 or gap < 5:  # 연석 허용 간격
                        is_consecutive = False
                        break
                
                if is_consecutive:
                    group_score = sum(s.score for s in group)
                    if group_score > best_score:
                        best_score = group_score
                        best_group = group
        
        if best_group:
            self._log(f'연석 {count}석 발견 (점수: {best_score:.1f})', LogLevel.SUCCESS)
            return best_group
        
        # 폴백: 상위 점수 개별 선택
        self._log('연석 실패, 개별 선택', LogLevel.WARN)
        return seats[:count]
    
    def click_seat(self, seat: SeatInfo) -> bool:
        """좌석 클릭"""
        try:
            seat_frame = self._get_seat_frame()
            target = seat_frame if seat_frame else self.page
            
            # 셀렉터로 클릭 시도
            if seat.selector and seat.raw_id:
                try:
                    elem = target.locator(f'[id="{seat.raw_id}"], [data-seat="{seat.raw_id}"]').first
                    if elem.is_visible(timeout=1000):
                        elem.click()
                        self.stats['seat_clicks'] += 1
                        seat_desc = f'{seat.row}열 {seat.seat_num}번' if seat.row else seat.raw_id[:20]
                        self._log(f'🪑 좌석 클릭: {seat_desc}')
                        human_delay(80, 150)
                        return True
                except:
                    pass
            
            # 좌표로 클릭 (폴백)
            if seat.x > 0 and seat.y > 0:
                try:
                    target.locator('svg, canvas, #Seats').first.click(position={'x': seat.x, 'y': seat.y})
                    self.stats['seat_clicks'] += 1
                    self._log(f'🪑 좌표 클릭: ({seat.x}, {seat.y})')
                    human_delay(80, 150)
                    return True
                except:
                    pass
            
            return False
            
        except Exception as e:
            self._log(f'좌석 클릭 실패: {e}', LogLevel.ERROR)
            return False
    
    def select_seats(self) -> bool:
        """좌석 선택 메인 로직"""
        self._log(f'🎯 좌석 선택 시작 (목표: {self.config.num_seats}석)')
        
        for attempt in range(self.config.max_retries):
            try:
                # 구역 선택
                self.select_zone()
                adaptive_sleep(1)
                
                # 좌석 찾기
                seats = self.find_available_seats()
                
                if not seats:
                    self._log(f'좌석 없음, 새로고침 (시도 {attempt + 1})', LogLevel.WARN)
                    self._refresh_seats()
                    continue
                
                # 연석 선택
                target_seats = self.select_consecutive_seats(seats, self.config.num_seats)
                
                if len(target_seats) < self.config.num_seats:
                    self._log(f'좌석 부족 ({len(target_seats)}/{self.config.num_seats})', LogLevel.WARN)
                    self._refresh_seats()
                    continue
                
                # 좌석 클릭
                success_count = 0
                for seat in target_seats:
                    if self.click_seat(seat):
                        self.selected_seats.append(seat)
                        success_count += 1
                
                if success_count >= self.config.num_seats:
                    self._log(f'좌석 선택 완료: {success_count}석', LogLevel.SUCCESS)
                    
                    # 선택 완료 버튼
                    self._click_next_step()
                    return True
                
                self._log(f'좌석 클릭 부족 ({success_count}/{self.config.num_seats})', LogLevel.WARN)
                
            except Exception as e:
                self._log(f'좌석 선택 에러: {e}', LogLevel.ERROR)
                self.stats['errors'] += 1
        
        self._log('좌석 선택 최종 실패', LogLevel.ERROR)
        return False
    
    def _refresh_seats(self):
        """좌석 새로고침"""
        try:
            seat_frame = self._get_seat_frame()
            target = seat_frame if seat_frame else self.page
            
            refresh_btn = target.locator('text=새로고침, [class*="refresh"], img[onclick*="refresh"]').first
            if refresh_btn.is_visible(timeout=2000):
                refresh_btn.click()
                adaptive_sleep(1)
        except:
            pass
    
    def _click_next_step(self) -> bool:
        """다음 단계 버튼 클릭"""
        for selector in self.NEXT_STEP_SELECTORS:
            try:
                btn = self.page.locator(selector).first
                if btn.is_visible(timeout=2000):
                    btn.click()
                    self._log('다음 단계 클릭', LogLevel.SUCCESS)
                    adaptive_sleep(2)
                    return True
            except:
                continue
        
        return False
    
    # ============ 결제 처리 ============
    def process_payment(self) -> bool:
        """결제 프로세스"""
        self._log('💳 결제 프로세스 시작')
        
        steps = [
            ('가격선택', self._select_price),
            ('다음단계', self._click_next_step),
            ('예매자정보', self._input_buyer_info),
            ('다음단계', self._click_next_step),
            ('결제수단', self._select_payment_method),
            ('다음단계', self._click_next_step),
            ('약관동의', self._agree_terms),
        ]
        
        for step_name, step_func in steps:
            self._log(f'📍 [{step_name}]')
            
            for attempt in range(self.config.max_retries):
                try:
                    if step_func():
                        break
                except Exception as e:
                    self._log(f'{step_name} 에러 (시도 {attempt + 1}): {e}', LogLevel.WARN)
                    self.stats['retries'] += 1
                    adaptive_sleep(0.5)
        
        # 결제 대기
        if not self.config.auto_pay:
            self._log('결제 페이지 도달 - 수동 결제 필요', LogLevel.SUCCESS)
            self.page.screenshot(path='/tmp/payment_ready.png')
            self._log('📸 /tmp/payment_ready.png')
            return True
        
        return self._click_pay_button()
    
    def _select_price(self) -> bool:
        """가격 선택"""
        book_frame = self._get_book_frame()
        target = book_frame if book_frame else self.page
        
        for selector in self.PRICE_SELECTORS:
            try:
                select = target.locator(selector).first
                if select.is_visible(timeout=2000):
                    select.select_option(index=1)
                    self._log('가격 선택 완료', LogLevel.SUCCESS)
                    return True
            except:
                continue
        
        return True  # 없으면 스킵
    
    def _input_buyer_info(self) -> bool:
        """예매자 정보 입력"""
        if not self.config.birth_date:
            return True
        
        book_frame = self._get_book_frame()
        target = book_frame if book_frame else self.page
        
        for selector in self.BIRTH_SELECTORS:
            try:
                input_elem = target.locator(selector).first
                if input_elem.is_visible(timeout=2000):
                    existing = input_elem.get_attribute('value') or ''
                    if len(existing) < 6:
                        input_elem.fill('')
                        input_elem.type(self.config.birth_date, delay=random.uniform(30, 80))
                        masked = self.config.birth_date[:2] + '****'
                        self._log(f'생년월일 입력: {masked}', LogLevel.SUCCESS)
                    else:
                        self._log('생년월일 이미 입력됨')
                    return True
            except:
                continue
        
        return True
    
    def _select_payment_method(self) -> bool:
        """결제수단 선택"""
        book_frame = self._get_book_frame()
        target = book_frame if book_frame else self.page
        
        method_map = {
            'kakao': PaymentMethod.KAKAO_PAY,
            'naver': PaymentMethod.NAVER_PAY,
            'card': PaymentMethod.CREDIT_CARD,
            'transfer': PaymentMethod.BANK_TRANSFER,
            'toss': PaymentMethod.TOSS,
        }
        
        method = method_map.get(self.config.payment_method, PaymentMethod.KAKAO_PAY)
        selectors = self.PAYMENT_SELECTORS.get(method, [])
        
        for selector in selectors:
            try:
                elem = target.locator(selector).first
                if elem.is_visible(timeout=2000):
                    elem.click()
                    self._log(f'결제수단 선택: {method.value}', LogLevel.SUCCESS)
                    adaptive_sleep(0.5)
                    return True
            except:
                continue
        
        self._log(f'결제수단 {method.value} 못찾음', LogLevel.WARN)
        return False
    
    def _agree_terms(self) -> bool:
        """약관 동의"""
        book_frame = self._get_book_frame()
        target = book_frame if book_frame else self.page
        
        for selector in self.AGREE_SELECTORS:
            try:
                checkbox = target.locator(selector).first
                if checkbox.is_visible(timeout=2000):
                    if not checkbox.is_checked():
                        checkbox.click()
                    self._log('약관 동의 완료', LogLevel.SUCCESS)
                    return True
            except:
                continue
        
        # 개별 체크박스
        try:
            checkboxes = target.locator('input[type="checkbox"][id*="agree"], input[type="checkbox"][name*="agree"]').all()
            for cb in checkboxes:
                if cb.is_visible() and not cb.is_checked():
                    cb.click()
                    human_delay(50, 100)
            
            if checkboxes:
                self._log(f'{len(checkboxes)}개 약관 동의', LogLevel.SUCCESS)
                return True
        except:
            pass
        
        return True
    
    def _click_pay_button(self) -> bool:
        """결제하기 버튼 클릭"""
        pay_selectors = [
            '#LargeNextBtnImage',
            'button:has-text("결제하기")',
            'a:has-text("결제하기")',
        ]
        
        for selector in pay_selectors:
            try:
                btn = self.page.locator(selector).first
                if btn.is_visible(timeout=3000):
                    btn.click()
                    self._log('결제하기 클릭!', LogLevel.SUCCESS)
                    return True
            except:
                continue
        
        return False
    
    # ============ 예매 대기열 ============
    def handle_waiting_queue(self) -> bool:
        """대기열 처리 (팝업/메인 페이지 모두 지원)"""
        max_wait = 300  # 5분
        start_time = time.time()
        
        # 예매 진행 페이지 (팝업 또는 메인)
        page = self._get_active_page()
        self._log(f'📍 대기열 확인 페이지: {page.url[:50]}...')
        
        # 대기열 URL 패턴
        queue_patterns = ['waiting', 'queue', 'onestop', 'book.interpark', 'poticket']
        seat_patterns = ['seat', 'schedule', 'area', 'zone']
        
        while time.time() - start_time < max_wait:
            try:
                current_url = page.url.lower()
                
                # 대기열 페이지 확인
                is_queue = any(p in current_url for p in queue_patterns)
                if is_queue:
                    elapsed = int(time.time() - start_time)
                    if elapsed % 10 == 0:
                        self._log(f'⏳ 대기열 대기중... ({elapsed}초)')
                    adaptive_sleep(1)
                    continue
                
                # 좌석 선택 페이지 도달
                is_seat = any(p in current_url for p in seat_patterns)
                if is_seat or self.is_seat_page():
                    self._log(f'✅ 대기열 통과! URL: {current_url[:50]}', LogLevel.SUCCESS)
                    return True
                
                # 에러 페이지
                if 'error' in current_url:
                    self._log('에러 페이지 감지', LogLevel.ERROR)
                    return False
                
                # 알 수 없는 페이지 - 스크린샷
                elapsed = int(time.time() - start_time)
                if elapsed % 30 == 0 and elapsed > 0:
                    page.screenshot(path=f'/tmp/queue_debug_{elapsed}.png')
                    self._log(f'📸 스크린샷: /tmp/queue_debug_{elapsed}.png')
                
                adaptive_sleep(0.5)
                
            except Exception as e:
                self._log(f'대기열 확인 에러: {e}', LogLevel.WARN)
                adaptive_sleep(1)
        
        self._log('대기열 타임아웃', LogLevel.ERROR)
        return False
    
    # ============ 메인 실행 ============
    def run(self) -> bool:
        """티켓팅 실행"""
        self._log('=' * 60)
        self._log('🎫 BTS 티켓팅 매크로 (Playwright v2.0) 시작')
        self._log(f'🎯 URL: {self.config.url[:60]}...' if self.config.url else '🎯 URL: 미설정')
        self._log(f'⏰ 목표 시간: {self.config.target_hour:02d}:{self.config.target_minute:02d}')
        self._log(f'🪑 좌석: {self.config.num_seats}석 (연석: {self.config.consecutive})')
        self._log(f'💳 결제: {self.config.payment_method} (자동: {self.config.auto_pay})')
        self._log(f'🖥️ Headless: {self.config.headless}')
        self._log('=' * 60)
        
        with sync_playwright() as playwright:
            try:
                # 1. 브라우저 시작
                if not self.start_browser(playwright):
                    return False
                
                # 2. 로그인
                self._log('\n📍 [1/6] 로그인...')
                if not self.login():
                    return False
                
                # 3. 공연 페이지 이동
                self._log('\n📍 [2/6] 공연 페이지 이동...')
                if not self.navigate_to_concert():
                    self._log('공연 페이지 접속 실패', LogLevel.WARN)
                
                # 4. 예매 시간 대기
                self._log('\n📍 [3/6] 예매 대기...')
                self.wait_for_booking_time()
                
                # 5. 예매 버튼 클릭 + 대기열
                self._log('\n📍 [4/6] 예매 시작...')
                self.click_booking_button()
                
                # 대기열 처리
                if not self.handle_waiting_queue():
                    if not self.is_seat_page():
                        self._log('좌석 페이지 진입 실패', LogLevel.ERROR)
                
                # 6. 좌석 선택
                self._log('\n📍 [5/6] 좌석 선택...')
                if not self.select_seats():
                    self._log('좌석 선택 실패', LogLevel.WARN)
                
                # 7. 결제
                self._log('\n📍 [6/6] 결제...')
                self.process_payment()
                
                # 완료
                self._log('\n🎉 티켓팅 프로세스 완료!')
                self.page.screenshot(path='/tmp/ticketing_result.png')
                self._log('📸 /tmp/ticketing_result.png')
                
                # 대기 (수동 결제용)
                if not self.config.auto_pay:
                    self._log('\n⏳ 120초 대기 (수동 결제)...')
                    time.sleep(120)
                
                return True
                
            except Exception as e:
                self._log(f'치명적 에러: {e}', LogLevel.ERROR)
                import traceback
                traceback.print_exc()
                return False
            
            finally:
                # 통계 출력
                self._log('\n' + '=' * 50)
                self._log('📊 최종 통계:')
                for key, value in self.stats.items():
                    self._log(f'   • {key}: {value}')
                self._log('=' * 50)
                
                self.close_browser()
    
    def login_only(self) -> bool:
        """로그인만 테스트"""
        self._log('🔐 로그인 테스트 모드')
        
        with sync_playwright() as playwright:
            try:
                if not self.start_browser(playwright):
                    return False
                
                if self.login():
                    self._log('로그인 테스트 성공!', LogLevel.SUCCESS)
                    
                    # NOL 티켓 메인으로 이동
                    self.page.goto('https://nol.interpark.com/ticket', wait_until='domcontentloaded', timeout=30000)
                    adaptive_sleep(3)
                    
                    self.page.screenshot(path='/tmp/login_test.png')
                    self._log('📸 /tmp/login_test.png')
                    
                    return True
                
                return False
                
            finally:
                self.close_browser()


# ============ CLI ============
def main():
    parser = argparse.ArgumentParser(description='BTS 티켓팅 매크로 (Playwright v2.0)')
    
    parser.add_argument('--url', help='공연 URL')
    parser.add_argument('--hour', type=int, default=20, help='예매 시간 (시)')
    parser.add_argument('--minute', type=int, default=0, help='예매 시간 (분)')
    parser.add_argument('--seats', type=int, default=2, help='좌석 수')
    parser.add_argument('--headless', action='store_true', help='헤드리스 모드')
    parser.add_argument('--test', action='store_true', help='즉시 테스트')
    parser.add_argument('--login-only', action='store_true', help='로그인만 테스트')
    parser.add_argument('--payment', default='kakao', choices=['kakao', 'naver', 'card', 'transfer', 'toss'])
    parser.add_argument('--birth', help='생년월일 (YYMMDD)')
    parser.add_argument('--auto-pay', action='store_true', help='자동 결제')
    
    args = parser.parse_args()
    
    # URL 결정
    url = args.url or CONCERT_URL
    if not url and args.test:
        url = TEST_URLS[0]  # 테스트용 기본 URL
    
    # 설정
    config = TicketingConfig(
        url=url,
        birth_date=args.birth or BIRTH_DATE,
        target_hour=args.hour,
        target_minute=args.minute,
        num_seats=args.seats,
        headless=args.headless,
        payment_method=args.payment,
        auto_pay=args.auto_pay,
    )
    
    if args.test:
        now = datetime.now()
        config.target_hour = now.hour
        config.target_minute = now.minute
    
    # 실행
    macro = NOLTicketing(config)
    
    if args.login_only:
        success = macro.login_only()
    else:
        success = macro.run()
    
    sys.exit(0 if success else 1)


if __name__ == '__main__':
    main()
