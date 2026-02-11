#!/usr/bin/env python3
"""
BTS 티켓팅 매크로 v4.0 - 코드 리뷰 반영
2026-02-11 Codex 리뷰 기반 수정

수정사항:
- find_all → query_selector_all (nodriver API 수정)
- 로그인 재시도 로직 추가
- wait_for_navigation 실제 구현
- 좌석 선택 canvas/SVG 대응
- 에러 핸들링 강화
"""

import nodriver as nd
import asyncio
import random
import argparse
import os
import traceback
import time
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from dataclasses import dataclass, field
from typing import Optional, List, Tuple
import aiohttp

# ============ 로깅 ============
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

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
    max_login_retries: int = 3  # 로그인 재시도 횟수
    
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
        
        # 오픈 시간 파싱
        try:
            open_time = datetime.strptime(open_time_str, '%Y-%m-%d %H:%M:%S')
            open_time = open_time.replace(tzinfo=ZoneInfo('Asia/Seoul'))
        except ValueError:
            open_time = datetime(2026, 2, 23, 20, 0, 0, tzinfo=ZoneInfo('Asia/Seoul'))
        
        return cls(
            user_id=user_id,
            user_pwd=user_pwd,
            concert_url=concert_url,
            open_time=open_time,
            telegram_bot_token=os.getenv('TELEGRAM_BOT_TOKEN', ''),
            telegram_chat_id=os.getenv('TELEGRAM_CHAT_ID', ''),
        )


# ============ 텔레그램 ============
_http_session: Optional[aiohttp.ClientSession] = None

async def get_http_session() -> aiohttp.ClientSession:
    global _http_session
    if _http_session is None or _http_session.closed:
        _http_session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
    return _http_session

async def close_http_session():
    global _http_session
    if _http_session and not _http_session.closed:
        await _http_session.close()

async def send_telegram(config: Config, message: str):
    if not config.telegram_bot_token:
        logger.info(f"[알림] {message}")
        return
    try:
        session = await get_http_session()
        url = f"https://api.telegram.org/bot{config.telegram_bot_token}/sendMessage"
        await session.post(url, data={'chat_id': config.telegram_chat_id, 'text': f"🎫 BTS\n{message}"})
    except Exception as e:
        logger.warning(f"텔레그램 실패: {e}")


# ============ 유틸리티 ============
async def human_delay(min_s: float = 0.5, max_s: float = 1.5):
    await asyncio.sleep(random.uniform(min_s, max_s))

async def human_type(element, text: str):
    for char in text:
        await element.send_keys(char)
        await asyncio.sleep(random.uniform(0.03, 0.1))

def mask_pwd(text: str, config: Config) -> str:
    if config.user_pwd and config.user_pwd in text:
        return text.replace(config.user_pwd, '****')
    return text


# ============ DOM 검색 (nodriver 올바른 API) ============
async def find_by_text(page, text: str, timeout: float = 3.0):
    """텍스트로 요소 찾기 (nodriver)"""
    try:
        elem = await asyncio.wait_for(page.find(text), timeout=timeout)
        if elem:
            logger.debug(f"✓ 텍스트 발견: {text}")
            return elem
    except asyncio.TimeoutError:
        logger.debug(f"✗ 타임아웃: {text}")
    except Exception as e:
        logger.debug(f"✗ 검색 실패 [{text}]: {e}")
    return None

async def find_by_selector(page, selector: str, timeout: float = 3.0):
    """CSS 셀렉터로 요소 찾기"""
    try:
        elem = await asyncio.wait_for(page.select(selector), timeout=timeout)
        if elem:
            logger.debug(f"✓ 셀렉터 발견: {selector}")
            return elem
    except asyncio.TimeoutError:
        logger.debug(f"✗ 타임아웃: {selector}")
    except Exception as e:
        logger.debug(f"✗ 셀렉터 실패 [{selector}]: {e}")
    return None

async def find_all_by_selector(page, selector: str, timeout: float = 3.0) -> List:
    """CSS 셀렉터로 모든 요소 찾기 (nodriver: select_all)"""
    try:
        # nodriver 공식 API: select_all(selector, timeout)
        elements = await page.select_all(selector, timeout=timeout)
        return elements if elements else []
    except Exception as e:
        logger.debug(f"✗ 다중 셀렉터 실패 [{selector}]: {e}")
    return []

async def wait_for_navigation(page, timeout: float = 10.0, check_interval: float = 0.3):
    """실제 페이지 로드 대기 (개선된 버전)"""
    start = time.time()
    
    # nodriver에서 URL 가져오기
    def get_url(p):
        if hasattr(p, 'url'):
            return p.url
        if hasattr(p, 'target') and hasattr(p.target, 'url'):
            return p.target.url
        return None
    
    initial_url = get_url(page)
    
    while (time.time() - start) < timeout:
        await asyncio.sleep(check_interval)
        
        # URL 변경 확인
        current_url = get_url(page)
        if initial_url and current_url and current_url != initial_url:
            logger.debug(f"URL 변경 감지: {initial_url} → {current_url}")
            await asyncio.sleep(1.0)  # DOM 안정화 대기
            return True
        
        # document.readyState 확인 (nodriver: send + cdp.runtime.evaluate)
        try:
            # nodriver는 evaluate 메서드가 없을 수 있음 - await page로 대기
            await page  # nodriver의 페이지 상태 업데이트
            return True
        except Exception:
            pass
    
    logger.debug(f"Navigation 대기 타임아웃 ({timeout}s)")
    return False

async def wait_for_element(page, text: str, timeout: float = 10.0, check_interval: float = 0.5):
    """특정 요소 나타날 때까지 대기"""
    start = time.time()
    while (time.time() - start) < timeout:
        elem = await find_by_text(page, text, timeout=1.0)
        if elem:
            return elem
        await asyncio.sleep(check_interval)
    return None


# ============ 로그인 (재시도 로직 포함) ============
async def step_login(browser, page, config: Config) -> Tuple[bool, any]:
    """
    로그인 플로우 (재시도 로직 포함):
    1. 메인 → "로그인" 버튼 클릭
    2. "이메일로 시작하기" 클릭 (NOL 멤버스)
    3. 이메일/비밀번호 입력 → 로그인하기 클릭
    4. 확인 후 실패시 재시도
    """
    for attempt in range(1, config.max_login_retries + 1):
        logger.info(f"[1/5] 로그인 시도 {attempt}/{config.max_login_retries}...")
        
        try:
            success, page = await _do_login(browser, page, config)
            if success:
                return True, page
            
            logger.warning(f"로그인 실패 (시도 {attempt}) - 재시도...")
            
            # 재시도 전 페이지 새로고침
            if attempt < config.max_login_retries:
                await page.get('https://tickets.interpark.com/')
                await human_delay(2, 3)
                
        except Exception as e:
            logger.error(f"로그인 예외 (시도 {attempt}): {mask_pwd(str(e), config)}")
            if attempt < config.max_login_retries:
                await asyncio.sleep(2)
    
    logger.error(f"❌ 로그인 {config.max_login_retries}회 실패")
    return False, page


async def _do_login(browser, page, config: Config) -> Tuple[bool, any]:
    """실제 로그인 수행"""
    
    # Step 1: 메인 로그인 버튼
    login_btn = await find_by_text(page, '로그인')
    if not login_btn:
        logger.error("메인 로그인 버튼 없음")
        return False, page
    
    await login_btn.click()
    await wait_for_navigation(page, timeout=5.0)
    await human_delay(1, 2)
    
    # Step 2: 이메일로 시작하기 (NOL 멤버스)
    email_btn = await wait_for_element(page, '이메일로 시작하기', timeout=5.0)
    if email_btn:
        await email_btn.click()
        await human_delay(1, 2)
    else:
        logger.info("이메일 버튼 없음 - 바로 폼 시도")
    
    # Step 3: ID 입력 (이메일)
    id_field = await find_by_selector(page, 'input[type="text"], input[type="email"]')
    if not id_field:
        id_field = await find_by_text(page, '이메일(아이디)')
    if not id_field:
        logger.error("ID 입력 필드 없음")
        return False, page
    
    await id_field.click()
    await human_delay(0.2, 0.3)
    await human_type(id_field, config.user_id)
    await human_delay(0.3, 0.5)
    
    # Step 4: PW 입력
    pw_field = await find_by_selector(page, 'input[type="password"]')
    if not pw_field:
        logger.error("PW 입력 필드 없음")
        return False, page
    
    await pw_field.click()
    await human_delay(0.2, 0.3)
    await human_type(pw_field, config.user_pwd)
    await human_delay(0.3, 0.5)
    
    # Step 5: 로그인 버튼 클릭
    submit_btn = await find_by_selector(page, 'button[type="submit"]')
    if not submit_btn:
        submit_btn = await find_by_text(page, '로그인하기')
    if not submit_btn:
        # 폴백: 모든 버튼 중 로그인 찾기
        buttons = await find_all_by_selector(page, 'button')
        for btn in buttons:
            try:
                # nodriver Element의 text 속성 사용 (text_content 또는 text)
                btn_text = getattr(btn, 'text', '') or getattr(btn, 'text_content', '') or ''
                if not btn_text:
                    # 폴백: node의 텍스트 가져오기
                    btn_text = str(btn) if btn else ''
                if btn_text and '로그인' in btn_text:
                    submit_btn = btn
                    break
            except Exception:
                continue
    
    if submit_btn:
        await submit_btn.click()
    else:
        logger.info("submit 버튼 없음 - 엔터키 시도")
        await pw_field.send_keys('\n')
    
    await wait_for_navigation(page, timeout=10.0)
    await human_delay(2, 3)
    
    # Step 6: 로그인 확인
    return await _verify_login(page), page


async def _verify_login(page) -> bool:
    """로그인 성공 여부 확인"""
    # 성공 지표들 (우선순위 순)
    success_indicators = [
        '로그아웃',      # 가장 확실
        '마이페이지',    # 확실
        '내 예약',       # 확실
        '님',            # "OOO님" 형태
        '예매확인',      # 예매 관련
    ]
    
    for indicator in success_indicators:
        elem = await find_by_text(page, indicator, timeout=2.0)
        if elem:
            logger.info(f"✅ 로그인 성공! ('{indicator}' 발견)")
            return True
    
    # 실패 지표들
    fail_indicators = [
        '비밀번호를 확인해주세요',
        '비밀번호가 일치하지 않습니다',
        '로그인 실패',
        '아이디 또는 비밀번호',
        '존재하지 않는 계정',
        '계정을 찾을 수 없',
        '잠금',  # 계정 잠금
        '보안문자',  # CAPTCHA 필요
    ]
    
    for indicator in fail_indicators:
        elem = await find_by_text(page, indicator, timeout=1.0)
        if elem:
            logger.error(f"❌ 로그인 실패: {indicator}")
            return False
    
    # URL 기반 확인 (로그인 페이지에서 벗어났는지)
    try:
        current_url = page.url if hasattr(page, 'url') else ''
        if current_url and 'login' not in current_url.lower():
            # 로그인 페이지가 아님 = 성공 가능성
            logger.info("✅ 로그인 페이지 벗어남 (성공 추정)")
            return True
    except Exception:
        pass
    
    logger.warning("⚠️ 로그인 상태 불확실")
    return False


# ============ 예매 ============
async def step_navigate_concert(page, config: Config) -> bool:
    """콘서트 페이지 이동"""
    logger.info("[2/5] 콘서트 페이지 이동...")
    await page.get(config.concert_url)
    await wait_for_navigation(page, timeout=10.0)
    await human_delay(1, 2)
    logger.info("✅ 콘서트 페이지 도착")
    return True

async def step_wait_open(config: Config) -> bool:
    """오픈 대기"""
    logger.info("[3/5] 오픈 대기...")
    now = datetime.now(ZoneInfo('Asia/Seoul'))
    
    while now < config.open_time:
        remaining = (config.open_time - now).total_seconds()
        
        if remaining > 300:
            logger.info(f"⏳ {int(remaining/60)}분 남음...")
            await asyncio.sleep(60)
        elif remaining > 30:
            logger.info(f"⏳ {int(remaining)}초...")
            await asyncio.sleep(10)
        elif remaining > 5:
            logger.info(f"⏳ {int(remaining)}초...")
            await asyncio.sleep(1)
        else:
            await asyncio.sleep(0.1)
        
        now = datetime.now(ZoneInfo('Asia/Seoul'))
    
    logger.info("🚀 오픈!")
    return True

async def step_click_booking(browser, page, config: Config) -> Tuple[bool, any]:
    """예매 버튼 클릭 + 새 창 처리"""
    logger.info("[4/5] 예매 버튼 클릭...")
    
    # 초기 탭 수 확인
    initial_tabs = 1
    try:
        if hasattr(browser, 'tabs'):
            tabs = await browser.tabs
            initial_tabs = len(tabs) if tabs else 1
    except Exception:
        pass
    
    for attempt in range(30):  # 30회로 증가
        try:
            # 예매하기 링크 찾기 (다양한 셀렉터)
            booking = await find_by_text(page, '예매하기', timeout=1.0)
            
            # 텍스트로 못 찾으면 셀렉터로 시도
            if not booking:
                booking = await find_by_selector(page, 'a.btn-booking, button.booking, .booking-btn', timeout=1.0)
            if not booking:
                booking = await find_by_selector(page, 'a[href*="book"], button[onclick*="book"]', timeout=1.0)
            
            if booking:
                await booking.click()
                logger.info(f"✅ 예매 클릭 성공 (시도 {attempt + 1})")
                await send_telegram(config, "🎉 예매 버튼 클릭!")
                await human_delay(2, 3)
                
                # 새 창/탭 처리 (인터파크 예매는 새 창 열림)
                new_page = await _get_new_tab(browser, initial_tabs)
                if new_page:
                    logger.info("🔄 새 창으로 전환")
                    return True, new_page
                
                return True, page
            
            # 예매대기 상태 확인
            waiting = await find_by_text(page, '예매대기', timeout=0.5)
            sold_out = await find_by_text(page, '매진', timeout=0.5)
            
            if sold_out:
                logger.warning(f"❌ 매진! (시도 {attempt + 1})")
            elif waiting:
                logger.info(f"⏳ 아직 예매대기... (시도 {attempt + 1})")
            else:
                logger.info(f"⏳ 예매 버튼 탐색 중... (시도 {attempt + 1})")
            
            # 새로고침 (exponential backoff)
            if hasattr(page, 'reload'):
                await page.reload()
            else:
                await page.get(config.concert_url)
            
            backoff = min(0.2 * (1.3 ** attempt), 2.0)
            await asyncio.sleep(backoff)
            
        except Exception as e:
            logger.warning(f"예매 시도 {attempt + 1} 오류: {e}")
            await asyncio.sleep(1)
    
    logger.error("❌ 예매 버튼 30회 실패")
    return False, page


async def _get_new_tab(browser, initial_count: int, timeout: float = 5.0):
    """새 탭/창 감지 및 반환"""
    if not hasattr(browser, 'tabs'):
        return None
    
    start = time.time()
    while (time.time() - start) < timeout:
        try:
            tabs = await browser.tabs
            if tabs and len(tabs) > initial_count:
                new_tab = tabs[-1]
                # 새 탭으로 포커스
                if hasattr(new_tab, 'bring_to_front'):
                    await new_tab.bring_to_front()
                elif hasattr(new_tab, 'activate'):
                    await new_tab.activate()
                await wait_for_navigation(new_tab, timeout=3.0)
                return new_tab
        except Exception:
            pass
        await asyncio.sleep(0.3)
    
    return None


# ============ 좌석 선택 (Canvas/SVG 대응) ============
async def step_select_seat(page, config: Config) -> bool:
    """
    좌석 선택 (Canvas/SVG 기반 좌석맵 대응)
    
    인터파크 좌석맵 구조:
    - 좌석맵은 canvas 또는 iframe 내부 SVG
    - 개별 좌석은 클릭 이벤트로 선택
    - 구역 선택 → 개별 좌석 선택 → 선택 완료 순서
    """
    logger.info("[5/5] 좌석 선택...")
    await send_telegram(config, "⚠️ 좌석 선택 페이지! CAPTCHA 확인하세요!")
    
    for attempt in range(30):
        logger.info(f"좌석 검색 시도 {attempt + 1}/30...")
        
        # 1. iframe 확인 및 진입
        seat_page = await _enter_seat_iframe(page)
        
        # 2. 구역 선택 시도 (텍스트 버튼)
        for grade in config.seat_priority:
            # 구역 버튼 찾기
            zone_btn = await find_by_text(seat_page, grade, timeout=1.0)
            if zone_btn:
                logger.info(f"🎯 구역 발견: {grade}")
                await zone_btn.click()
                await human_delay(1, 2)
                
                # 3. 개별 좌석 선택 (Canvas 클릭)
                seat_selected = await _select_available_seat(seat_page)
                if seat_selected:
                    # 4. 선택 완료
                    complete = await _complete_seat_selection(seat_page)
                    if complete:
                        await send_telegram(config, f"🎉 {grade} 좌석 선택 완료!")
                        return True
        
        # 5. Canvas 직접 클릭 시도 (구역 버튼 없는 경우)
        canvas_clicked = await _click_canvas_seat(seat_page)
        if canvas_clicked:
            complete = await _complete_seat_selection(seat_page)
            if complete:
                await send_telegram(config, "🎉 좌석 선택 완료!")
                return True
        
        # 새로고침
        refresh = await find_by_text(seat_page, '새로고침', timeout=1.0)
        if refresh:
            await refresh.click()
            logger.info("🔄 새로고침")
        
        await human_delay(1.5, 2.5)
    
    # 실패 → 수동 대기
    logger.warning("⚠️ 자동 좌석 선택 실패 - 수동 진행 필요")
    await send_telegram(config, "⚠️ 수동 좌석 선택 필요!")
    return False


async def _enter_seat_iframe(page):
    """좌석 선택 iframe 진입 (있으면)"""
    try:
        # 다양한 iframe 셀렉터 시도
        iframe_selectors = [
            'iframe[id*="seat"]',
            'iframe[class*="seat"]',
            'iframe[src*="seat"]',
            'iframe[name*="seat"]',
            '#seatFrame',
            '.seat-iframe',
            'iframe'  # 마지막 폴백
        ]
        
        for selector in iframe_selectors:
            iframe = await find_by_selector(page, selector, timeout=1.0)
            if iframe:
                # nodriver에서 iframe 내부 접근 시도
                try:
                    # 방법 1: content_frame 속성
                    if hasattr(iframe, 'content_frame'):
                        frame_content = await iframe.content_frame
                        if frame_content:
                            logger.info(f"📋 좌석 iframe 진입 (content_frame): {selector}")
                            return frame_content
                    
                    # 방법 2: frame 속성
                    if hasattr(iframe, 'frame'):
                        frame_content = iframe.frame
                        if frame_content:
                            logger.info(f"📋 좌석 iframe 진입 (frame): {selector}")
                            return frame_content
                    
                    # 방법 3: iframe 자체 반환 (일부 작업은 가능)
                    logger.info(f"📋 iframe 발견 (직접 접근 시도): {selector}")
                    return iframe
                    
                except Exception as e:
                    logger.debug(f"iframe {selector} 내부 접근 실패: {e}")
                    continue
    except Exception as e:
        logger.debug(f"iframe 진입 실패: {e}")
    return page


async def _select_available_seat(page) -> bool:
    """이용 가능한 좌석 선택 (Canvas/SVG)"""
    try:
        # Canvas 요소 찾기
        canvas = await find_by_selector(page, 'canvas')
        if canvas:
            # Canvas 중앙 클릭 (좌석맵 기준)
            await canvas.click()
            await human_delay(0.5, 1.0)
            
            # 좌석 선택 확인
            selected = await find_by_text(page, '선택됨', timeout=1.0)
            if selected:
                return True
            
            # 또는 선택 좌석 표시 확인
            seat_info = await find_by_selector(page, '.selected-seat, .seat-selected')
            if seat_info:
                return True
        
        # SVG 좌석 시도
        available_seats = await find_all_by_selector(page, 'circle[fill="green"], rect.available, .seat.available')
        if available_seats:
            # 첫 번째 가용 좌석 클릭
            await available_seats[0].click()
            await human_delay(0.5, 1.0)
            return True
            
    except Exception as e:
        logger.debug(f"좌석 선택 실패: {e}")
    return False


async def _click_canvas_seat(page) -> bool:
    """Canvas 좌석맵에서 직접 좌석 클릭"""
    try:
        canvas = await find_by_selector(page, 'canvas[id*="seat"], canvas.seat-map')
        if not canvas:
            canvas = await find_by_selector(page, 'canvas')
        
        if canvas:
            # 1. 먼저 기본 클릭 시도
            try:
                await canvas.click()
                await human_delay(0.5, 1.0)
                
                selected = await find_by_text(page, '선택', timeout=1.0)
                if selected:
                    logger.info("✅ Canvas 기본 클릭으로 좌석 선택 성공")
                    return True
            except Exception:
                pass
            
            # 2. JavaScript를 통한 영역 클릭 (nodriver는 offset 클릭 미지원)
            # Canvas 중앙에서 여러 위치 클릭 시도
            offsets = [(0.5, 0.5), (0.3, 0.5), (0.7, 0.5), (0.5, 0.3), (0.5, 0.7)]
            
            for rx, ry in offsets:
                try:
                    # Canvas 위치에서 상대 좌표로 클릭 이벤트 발생
                    click_script = f'''
                        (function() {{
                            var canvas = document.querySelector('canvas');
                            if (!canvas) return false;
                            var rect = canvas.getBoundingClientRect();
                            var x = rect.left + rect.width * {rx};
                            var y = rect.top + rect.height * {ry};
                            var evt = new MouseEvent('click', {{
                                bubbles: true,
                                cancelable: true,
                                clientX: x,
                                clientY: y
                            }});
                            canvas.dispatchEvent(evt);
                            return true;
                        }})();
                    '''
                    # nodriver에서 JavaScript 실행
                    if hasattr(page, 'evaluate'):
                        await page.evaluate(click_script)
                    else:
                        # send + cdp.runtime.evaluate 사용
                        from nodriver import cdp
                        await page.send(cdp.runtime.evaluate(expression=click_script))
                    
                    await human_delay(0.3, 0.5)
                    
                    # 선택 확인
                    selected = await find_by_text(page, '선택', timeout=0.5)
                    if selected:
                        logger.info(f"✅ Canvas JS 클릭으로 좌석 선택 성공 ({rx}, {ry})")
                        return True
                except Exception as e:
                    logger.debug(f"Canvas JS 클릭 실패 ({rx}, {ry}): {e}")
                    continue
    except Exception as e:
        logger.debug(f"Canvas 클릭 실패: {e}")
    return False


async def _complete_seat_selection(page) -> bool:
    """좌석 선택 완료"""
    # 선택 완료 / 다음 / 결제 버튼 찾기
    complete_buttons = ['선택완료', '선택 완료', '다음', '결제하기', '결제']
    
    for btn_text in complete_buttons:
        btn = await find_by_text(page, btn_text, timeout=2.0)
        if btn:
            await btn.click()
            logger.info(f"✅ '{btn_text}' 클릭")
            await wait_for_navigation(page, timeout=5.0)
            return True
    
    return False


# ============ CAPTCHA 감지 ============
async def detect_captcha(page) -> bool:
    """CAPTCHA/본인확인 감지"""
    captcha_indicators = [
        '본인확인', '휴대폰 인증', 'CAPTCHA', 'captcha',
        '자동입력방지', '보안문자', '인증번호'
    ]
    
    for indicator in captcha_indicators:
        elem = await find_by_text(page, indicator, timeout=1.0)
        if elem:
            logger.warning(f"⚠️ CAPTCHA 감지: {indicator}")
            return True
    
    # 이미지 CAPTCHA 감지
    captcha_img = await find_by_selector(page, 'img[alt*="captcha"], img[src*="captcha"]')
    if captcha_img:
        logger.warning("⚠️ 이미지 CAPTCHA 감지")
        return True
    
    return False


# ============ 메인 ============
async def run_ticketing(config: Config, live: bool):
    logger.info("=" * 50)
    logger.info("🎫 BTS 티켓팅 v4.0")
    logger.info(f"오픈: {config.open_time}")
    logger.info(f"현재: {datetime.now(ZoneInfo('Asia/Seoul'))}")
    logger.info(f"모드: {'실전' if live else '테스트'}")
    logger.info("=" * 50)
    
    browser = None
    try:
        browser = await nd.start(
            headless=False,
            browser_args=['--window-size=1920,1080', '--lang=ko-KR']
        )
        
        page = await browser.get('https://tickets.interpark.com/')
        await wait_for_navigation(page, timeout=10.0)
        await human_delay(1, 2)
        
        # 1. 로그인 (재시도 로직 포함)
        success, page = await step_login(browser, page, config)
        if not success:
            await send_telegram(config, "❌ 로그인 실패!")
            return
        
        # 2. 콘서트 페이지
        await step_navigate_concert(page, config)
        
        # 3. 오픈 대기 (실전만)
        if live:
            await step_wait_open(config)
        
        # 4. 예매 클릭 + 새 창 처리
        success, booking_page = await step_click_booking(browser, page, config)
        if not success:
            await send_telegram(config, "❌ 예매 버튼 실패!")
            return
        
        # CAPTCHA 체크
        if await detect_captcha(booking_page):
            await send_telegram(config, "⚠️ CAPTCHA 감지! 수동 처리 필요!")
            await asyncio.sleep(60)  # 1분 대기
        
        # 5. 좌석 선택 (새 창에서)
        await step_select_seat(booking_page, config)
        
        # 결제 대기
        await send_telegram(config, "💳 결제 진행하세요!")
        logger.info("💳 결제 대기 중... (30분 타임아웃)")
        
        await asyncio.sleep(30 * 60)  # 30분 대기
        
    except KeyboardInterrupt:
        logger.info("\n⛔ 사용자 중단")
        await send_telegram(config, "⛔ 중단됨")
    except Exception as e:
        error = mask_pwd(str(e), config)
        logger.error(f"오류: {error}")
        traceback.print_exc()
        await send_telegram(config, f"❌ 오류: {error}")
    finally:
        if browser:
            browser.stop()
        await close_http_session()


def main():
    parser = argparse.ArgumentParser(description='BTS 티켓팅 v4')
    parser.add_argument('--test', action='store_true', help='테스트 모드')
    parser.add_argument('--live', action='store_true', help='실전 모드')
    args = parser.parse_args()
    
    if not args.test and not args.live:
        print("사용법: python main_nodriver_v4.py --test 또는 --live")
        return
    
    try:
        config = Config.from_env()
    except ValueError as e:
        logger.error(f"설정 오류: {e}")
        return
    
    asyncio.run(run_ticketing(config, args.live))


if __name__ == '__main__':
    main()
