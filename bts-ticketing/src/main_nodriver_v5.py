#!/usr/bin/env python3
"""
BTS 티켓팅 매크로 v5.0 - 딥 리뷰 기반 완전 재작성
2026-02-11

주요 변경:
- wait_for_navigation: CDP readyState 실제 구현
- NTP 시간 동기화
- 봇 탐지 우회 (webdriver, User-Agent, 마우스 이동)
- 멀티 세션 지원
- 셀렉터 config 분리
- 엔터키 CDP 방식
- iframe 접근 개선
"""

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
from typing import Optional, List, Tuple, Dict, Any
import aiohttp

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
            num_sessions=int(os.getenv('NUM_SESSIONS', '1')),
            use_ntp=os.getenv('USE_NTP', 'true').lower() == 'true',
        )


# ============ NTP 시간 동기화 (비동기) ============
_ntp_offset: float = 0.0

def _sync_ntp_blocking() -> Tuple[bool, float]:
    """NTP 동기화 (블로킹 - executor에서 실행)"""
    import socket
    import struct
    
    ntp_servers = [
        ('time.google.com', 123),
        ('time.nist.gov', 123),
        ('pool.ntp.org', 123),
    ]
    
    for server, port in ntp_servers:
        try:
            client = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            client.settimeout(2)
            
            data = b'\x1b' + 47 * b'\0'
            client.sendto(data, (server, port))
            
            data, _ = client.recvfrom(1024)
            client.close()
            
            if data:
                t = struct.unpack('!12I', data)[10]
                t -= 2208988800
                offset = t - time.time()
                return True, offset, server
        except Exception:
            continue
    
    return False, 0.0, None

async def sync_ntp_time():
    """NTP 서버와 시간 동기화 (비동기 - executor 사용)"""
    global _ntp_offset
    
    loop = asyncio.get_event_loop()
    try:
        result = await loop.run_in_executor(None, _sync_ntp_blocking)
        success, offset, server = result
        if success:
            _ntp_offset = offset
            logger.info(f"✅ NTP 동기화: {server} (offset: {_ntp_offset*1000:.1f}ms)")
            return True
    except Exception as e:
        logger.debug(f"NTP 동기화 실패: {e}")
    
    logger.warning("⚠️ NTP 동기화 실패 - 로컬 시간 사용")
    return False

def get_accurate_time() -> datetime:
    """정확한 현재 시간 (NTP 보정)"""
    return datetime.fromtimestamp(time.time() + _ntp_offset, tz=ZoneInfo('Asia/Seoul'))


# ============ SecureLogger (비밀번호 마스킹) ============
import re

class SecureLogger:
    """민감정보 자동 마스킹 로거"""
    
    PATTERNS = [
        (re.compile(r'password["\s:=]+["\']?([^"\'&\s]+)', re.I), r'password=****'),
        (re.compile(r'pwd["\s:=]+["\']?([^"\'&\s]+)', re.I), r'pwd=****'),
        (re.compile(r'token["\s:=]+["\']?([^"\'&\s]+)', re.I), r'token=****'),
        (re.compile(r'api[_-]?key["\s:=]+["\']?([^"\'&\s]+)', re.I), r'api_key=****'),
    ]
    
    def __init__(self, base_logger, secrets: List[str] = None):
        self._logger = base_logger
        self._secrets = [s for s in (secrets or []) if s and len(s) > 3]
    
    def add_secret(self, secret: str):
        if secret and len(secret) > 3:
            self._secrets.append(secret)
    
    def _sanitize(self, message: str) -> str:
        result = str(message)
        for secret in self._secrets:
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

# 하위 호환성 유지
async def get_http_session() -> aiohttp.ClientSession:
    """Deprecated: http_manager.get_session() 사용 권장"""
    async with http_manager._lock:
        if http_manager._session is None or http_manager._session.closed:
            http_manager._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=10)
            )
        return http_manager._session

async def close_http_session():
    """HTTP 세션 종료"""
    await http_manager.close()


# ============ 텔레그램 (재시도 포함) ============
async def send_telegram(config: Config, message: str, retries: int = 3):
    if not config.telegram_bot_token:
        logger.info(f"[알림] {message}")
        return
    
    for attempt in range(retries):
        try:
            session = await get_http_session()
            url = f"https://api.telegram.org/bot{config.telegram_bot_token}/sendMessage"
            async with session.post(url, data={
                'chat_id': config.telegram_chat_id, 
                'text': f"🎫 BTS\n{message}"
            }) as resp:
                if resp.status == 200:
                    return
        except Exception as e:
            if attempt == retries - 1:
                logger.warning(f"텔레그램 {retries}회 실패: {e}")
            await asyncio.sleep(1)


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


# ============ 봇 탐지 우회 ============
async def setup_stealth(page):
    """봇 탐지 우회 설정"""
    stealth_scripts = [
        # webdriver 속성 숨기기
        '''Object.defineProperty(navigator, 'webdriver', {get: () => undefined});''',
        
        # chrome 객체 추가
        '''window.chrome = {runtime: {}};''',
        
        # plugins 추가
        '''Object.defineProperty(navigator, 'plugins', {get: () => [1,2,3,4,5]});''',
        
        # languages 설정
        '''Object.defineProperty(navigator, 'languages', {get: () => ['ko-KR', 'ko', 'en-US', 'en']});''',
        
        # permissions 쿼리 수정
        '''
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({state: Notification.permission}) :
                originalQuery(parameters)
        );
        ''',
    ]
    
    for script in stealth_scripts:
        await evaluate_js(page, script, return_value=False)
    
    logger.debug("✅ Stealth 설정 완료")


# ============ 마우스 이동 시뮬레이션 ============
async def move_mouse_to(page, x: float, y: float, steps: int = 10):
    """베지어 곡선으로 마우스 이동"""
    try:
        for i in range(steps):
            t = (i + 1) / steps
            # 간단한 선형 이동 (실제로는 베지어가 더 자연스러움)
            await page.send(cdp.input_.dispatch_mouse_event(
                type_='mouseMoved',
                x=int(x * t),
                y=int(y * t)
            ))
            await asyncio.sleep(random.uniform(0.01, 0.03))
    except Exception as e:
        logger.debug(f"마우스 이동 실패: {e}")

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
async def human_type(page, element, text: str, with_mistakes: bool = True):
    """사람처럼 타이핑 (오타 + 수정 포함)"""
    for i, char in enumerate(text):
        # 5% 확률로 오타 + 백스페이스
        if with_mistakes and random.random() < 0.05 and i < len(text) - 1:
            wrong_char = random.choice('qwertyuiopasdfghjklzxcvbnm')
            await element.send_keys(wrong_char)
            await asyncio.sleep(random.uniform(0.1, 0.3))
            # 백스페이스
            await press_key(page, 'Backspace', 8)
            await asyncio.sleep(random.uniform(0.05, 0.1))
        
        # 문자 입력
        try:
            await element.send_keys(char)
        except Exception:
            # 특수문자 실패 시 JS로 직접 입력
            escaped_char = char.replace('"', '\\"')
            script = f'document.activeElement.value += "{escaped_char}"; document.activeElement.dispatchEvent(new Event("input", {{bubbles: true}}));'
            await evaluate_js(page, script)
        
        # 불규칙 딜레이
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

async def find_by_selectors(page, selectors: List[str], timeout: float = 1.0):
    """여러 셀렉터 순서대로 시도"""
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
    turnstile_ok = await _wait_for_turnstile(page, timeout=30.0)
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


async def _wait_for_turnstile(page, timeout: float = 90.0) -> bool:
    """Cloudflare Turnstile 챌린지 완료 대기 (다중 전략)
    
    전략:
    1. 자연스러운 마우스 움직임 (베지어 곡선)
    2. Turnstile iframe 체크박스 클릭
    3. 스크롤 + 포커스 이벤트
    """
    logger.info("⏳ Turnstile 챌린지 완료 대기 중... (다중 전략)")
    start = time.time()
    last_log = 0
    mouse_move_count = 0
    checkbox_attempted = False
    
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
        
        # 5초 후 체크박스 클릭 시도 (1회만)
        if elapsed > 5 and not checkbox_attempted:
            checkbox_attempted = True
            await _try_checkbox_click()
        
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


async def step_wait_open(page, config: Config) -> bool:
    """오픈 대기 (NTP 기반 정밀 대기)"""
    logger.info("[3/5] 오픈 대기...")
    
    while True:
        now = get_accurate_time()
        remaining = (config.open_time - now).total_seconds()
        
        if remaining <= 0:
            break
        elif remaining <= 5:
            # 오픈 5초 전: 고속 새로고침
            logger.info(f"⏳ {remaining:.1f}초...")
            await page.reload()
            await asyncio.sleep(0.1)
        elif remaining <= 30:
            logger.info(f"⏳ {int(remaining)}초...")
            await asyncio.sleep(1)
        elif remaining <= 300:
            logger.info(f"⏳ {int(remaining/60)}분 {int(remaining%60)}초...")
            await asyncio.sleep(10)
        else:
            logger.info(f"⏳ {int(remaining/60)}분...")
            await asyncio.sleep(60)
    
    logger.info("🚀 오픈!")
    return True


class AdaptiveRefreshStrategy:
    """적응형 새로고침 전략 (티켓팅 최적화)"""
    
    def __init__(self):
        self.base_interval = 0.15  # 150ms 기본
        self.min_interval = 0.1    # 100ms 최소
        self.max_interval = 1.0    # 1초 최대
        self.consecutive_errors = 0
        self.rate_limited = False
    
    def get_interval(self, is_error: bool = False) -> float:
        """다음 새로고침 간격 계산"""
        if is_error:
            self.consecutive_errors += 1
            return min(self.base_interval * (1.5 ** self.consecutive_errors), self.max_interval)
        else:
            self.consecutive_errors = 0
            return self.base_interval


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
                # 즉시 클릭 (딜레이 최소화)
                try:
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
                    if (text.includes('매진')) return 'sold_out';
                    if (text.includes('예매대기')) return 'waiting';
                    if (text.includes('예매하기')) return 'available';
                    return 'unknown';
                })()
            ''')
            
            if status == 'sold_out':
                logger.warning(f"❌ 매진 (시도 {attempt + 1})")
            elif status == 'waiting':
                logger.info(f"⏳ 예매대기 (시도 {attempt + 1})")
            
            # 적응형 새로고침
            await page.reload()
            interval = strategy.get_interval()
            await asyncio.sleep(interval)
            
        except Exception as e:
            interval = strategy.get_interval(is_error=True)
            logger.warning(f"예매 시도 {attempt + 1} 오류: {e}")
            await asyncio.sleep(interval)
    
    logger.error("❌ 예매 버튼 50회 실패")
    return False, page


async def get_browser_tabs(browser) -> List:
    """브라우저 탭 목록"""
    try:
        tabs = browser.tabs
        if asyncio.iscoroutine(tabs):
            tabs = await tabs
        elif callable(tabs):
            tabs = tabs()
            if asyncio.iscoroutine(tabs):
                tabs = await tabs
        return list(tabs) if tabs else []
    except Exception:
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
    """좌석 선택 (iframe 지원)"""
    logger.info("[5/5] 좌석 선택...")
    await send_telegram(config, "⚠️ 좌석 선택 페이지!")
    
    # iframe 확인
    seat_page, is_iframe = await _get_seat_page(page)
    if is_iframe:
        logger.info("📋 iframe 모드로 좌석 선택")
    
    for attempt in range(30):
        logger.info(f"좌석 검색 {attempt + 1}/30...")
        
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


async def _click_canvas_seat(page) -> bool:
    """Canvas 좌석맵 클릭 (픽셀 분석 기반)"""
    
    # 1. 픽셀 분석으로 사용 가능한 좌석 찾기
    seats = await evaluate_js(page, '''
        (() => {
            const canvas = document.querySelector('canvas');
            if (!canvas) return { error: 'no_canvas' };
            
            const ctx = canvas.getContext('2d');
            if (!ctx) return { error: 'no_context' };
            
            const width = canvas.width;
            const height = canvas.height;
            
            try {
                const imageData = ctx.getImageData(0, 0, width, height);
                const data = imageData.data;
                
                const availableSeats = [];
                const step = 8;  // 8px 간격으로 샘플링
                
                for (let y = 0; y < height; y += step) {
                    for (let x = 0; x < width; x += step) {
                        const idx = (y * width + x) * 4;
                        const r = data[idx];
                        const g = data[idx + 1];
                        const b = data[idx + 2];
                        
                        // 녹색 계열 (선택 가능 좌석)
                        if (g > 150 && g > r * 1.3 && g > b * 1.3) {
                            availableSeats.push({ x, y, type: 'available' });
                        }
                        // 파란색/보라색 계열 (VIP/프리미엄)
                        else if (b > 150 && b > r * 1.2 && b > g * 0.8) {
                            availableSeats.push({ x, y, type: 'premium' });
                        }
                    }
                }
                
                // Canvas 실제 위치
                const rect = canvas.getBoundingClientRect();
                
                return {
                    seats: availableSeats.slice(0, 30),
                    rect: {
                        left: rect.left,
                        top: rect.top,
                        scaleX: rect.width / width,
                        scaleY: rect.height / height
                    }
                };
            } catch (e) {
                return { error: e.message };
            }
        })()
    ''')
    
    # 픽셀 분석 성공 시
    if seats and not seats.get('error') and seats.get('seats'):
        seat_list = seats['seats']
        rect = seats['rect']
        
        # 우선순위: premium > available
        seat_list.sort(key=lambda s: (0 if s['type'] == 'premium' else 1))
        
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
    """선택 완료"""
    # 1단계: 선택 완료
    for btn_text in ['선택완료', '선택 완료']:
        btn = await find_by_text(page, btn_text, timeout=1.0)
        if btn:
            await human_click(page, btn)
            await wait_for_navigation(page, timeout=5.0)
            await human_delay(1, 2)
            break
    
    # 2단계: 다음
    next_btn = await find_by_text(page, '다음', timeout=2.0)
    if next_btn:
        await human_click(page, next_btn)
        await wait_for_navigation(page, timeout=5.0)
        await human_delay(1, 2)
    
    # 3단계: 결제
    for btn_text in ['결제하기', '결제']:
        btn = await find_by_text(page, btn_text, timeout=2.0)
        if btn:
            await human_click(page, btn)
            return True
    
    return False


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
    logger.info(f"[세션 {session_id}] 시작")
    
    browser = None
    try:
        # 세션별 프로필 디렉토리 (멀티 세션 충돌 방지)
        import tempfile
        user_data_dir = os.path.join(tempfile.gettempdir(), f'bts-session-{session_id}')
        os.makedirs(user_data_dir, exist_ok=True)
        
        # 브라우저 시작 (봇 탐지 우회 옵션)
        browser = await nd.start(
            headless=False,
            browser_args=[
                '--window-size=1920,1080',
                '--lang=ko-KR',
                '--disable-blink-features=AutomationControlled',
                f'--user-data-dir={user_data_dir}',
                f'--user-agent=Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.{120 + session_id}.0 Safari/537.36',
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
        
        # 결제 대기
        await send_telegram(config, f"[세션 {session_id}] 💳 결제 진행하세요!")
        logger.info(f"[세션 {session_id}] 💳 결제 대기 (30분)")
        
        # 결제 완료 감지
        for _ in range(180):
            completed = await find_by_text(booking_page, '예매 완료', timeout=5.0)
            if completed:
                await send_telegram(config, f"[세션 {session_id}] 🎉 예매 완료!!!")
                return True
            
            failed = await find_by_text(booking_page, '결제 실패', timeout=5.0)
            if failed:
                await send_telegram(config, f"[세션 {session_id}] ❌ 결제 실패")
                return False
            
            await asyncio.sleep(10)
        
        return False
        
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
        await cleanup_browser(browser, session_id)


async def cleanup_browser(browser, session_id: int):
    """브라우저 완전 정리 (좀비 프로세스 방지)"""
    if not browser:
        return
    
    # 1. 정상 종료 시도
    try:
        await asyncio.wait_for(browser.stop(), timeout=5.0)
        logger.debug(f"[세션 {session_id}] 브라우저 정상 종료")
        return
    except asyncio.TimeoutError:
        logger.warning(f"[세션 {session_id}] 브라우저 종료 타임아웃")
    except Exception as e:
        logger.warning(f"[세션 {session_id}] 브라우저 종료 실패: {e}")
    
    # 2. 프로세스 강제 종료 (psutil 사용)
    try:
        import psutil
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
    except ImportError:
        logger.debug("psutil 미설치 - 강제 종료 건너뜀")
    except Exception as e:
        logger.error(f"[세션 {session_id}] 프로세스 정리 실패: {e}")


async def run_multi_session(config: Config, live: bool):
    """멀티 세션 실행"""
    if config.num_sessions == 1:
        await run_single_session(config, 1, live)
        return
    
    logger.info(f"🚀 {config.num_sessions}개 세션 시작")
    
    tasks = [
        run_single_session(config, i + 1, live) 
        for i in range(config.num_sessions)
    ]
    
    # 하나라도 성공하면 나머지 취소
    done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
    
    # 취소 및 cleanup 대기 (좀비 프로세스 방지)
    for task in pending:
        task.cancel()
    
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
        logger.info(f"🧹 {len(pending)}개 세션 정리 완료")
    
    # 결과 확인
    for task in done:
        try:
            if task.result():
                logger.info("🎉 성공!")
                return
        except Exception:
            pass
    
    logger.warning("😢 모든 세션 실패")


async def run_ticketing(config: Config, live: bool):
    """메인 실행"""
    logger.info("=" * 50)
    logger.info("🎫 BTS 티켓팅 v5.0")
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
        print("옵션: --sessions N (멀티 세션)")
        return
    
    try:
        config = Config.from_env()
        if args.sessions > 1:
            config.num_sessions = args.sessions
    except ValueError as e:
        logger.error(f"설정 오류: {e}")
        return
    
    asyncio.run(run_ticketing(config, args.live))


if __name__ == '__main__':
    main()
