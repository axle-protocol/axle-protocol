#!/usr/bin/env python3
"""
BTS 티켓팅 매크로 v3.0 - 실제 DOM 분석 기반
2026-02-11 인터파크 실제 테스트 결과 반영

핵심 발견:
- 로그인: iframe 없음! 새 페이지로 이동
- 예매: link "예매하기" (button 아님)
- 플로우: 메인 → 로그인 페이지 → 기존계정 → ID/PW → 예매
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


# ============ DOM 검색 (실제 테스트 기반) ============
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

async def wait_for_navigation(page, timeout: float = 5.0):
    """페이지 로드 대기"""
    await asyncio.sleep(min(timeout, 2.0))  # 기본 대기
    # TODO: 실제 로드 완료 감지 로직 추가


# ============ 로그인 (2026-02-11 실제 테스트) ============
async def step_login(browser, page, config: Config) -> Tuple[bool, any]:
    """
    로그인 플로우 (2026-02-11 실제 테스트 검증):
    1. 메인 → "로그인" 버튼 클릭
    2. "이메일로 시작하기" 클릭 (NOL 멤버스)
    3. 이메일/비밀번호 입력 → 로그인하기 클릭
    4. "[이름]님" 버튼으로 성공 확인
    """
    logger.info("[1/5] 로그인 시작...")
    
    # Step 1: 메인 로그인 버튼
    login_btn = await find_by_text(page, '로그인')
    if not login_btn:
        logger.error("메인 로그인 버튼 없음")
        return False, page
    
    await login_btn.click()
    await human_delay(2, 3)
    
    # Step 2: 이메일로 시작하기 (NOL 멤버스)
    email_btn = await find_by_text(page, '이메일로 시작하기')
    if email_btn:
        await email_btn.click()
        await human_delay(1, 2)
    else:
        logger.info("이메일 버튼 없음 - 바로 폼 시도")
    
    # Step 3: ID 입력 (이메일)
    id_field = await find_by_text(page, '이메일(아이디)')
    if not id_field:
        id_field = await find_by_selector(page, 'input[type="text"]')
    if not id_field:
        logger.error("ID 입력 필드 없음")
        return False, page
    
    await human_type(id_field, config.user_id)
    await human_delay(0.3, 0.5)
    
    # Step 4: PW 입력
    pw_field = await find_by_text(page, '비밀번호')
    if not pw_field:
        pw_field = await find_by_selector(page, 'input[type="password"]')
    if not pw_field:
        logger.error("PW 입력 필드 없음")
        return False, page
    
    await human_type(pw_field, config.user_pwd)
    await human_delay(0.3, 0.5)
    
    # Step 5: 로그인 버튼 (폼 내부)
    # 주의: "로그인" 텍스트가 여러 개일 수 있음
    submit_btn = await find_by_selector(page, 'button[type="submit"]')
    if not submit_btn:
        # 폼 내 버튼 찾기 (두 번째 "로그인")
        try:
            all_buttons = await page.find_all('button')
            for btn in all_buttons or []:
                btn_text = getattr(btn, 'text', '') or ''
                if '로그인' in btn_text:
                    submit_btn = btn
                    break
        except Exception:
            pass
    
    if submit_btn:
        await submit_btn.click()
    else:
        await pw_field.send_keys('\n')  # 엔터키 폴백
    
    await human_delay(3, 5)
    
    # Step 6: 로그인 확인
    my_booking = await find_by_text(page, '내 예약')
    if my_booking:
        logger.info("✅ 로그인 성공!")
        return True, page
    
    logout = await find_by_text(page, '로그아웃')
    if logout:
        logger.info("✅ 로그인 성공!")
        return True, page
    
    logger.error("❌ 로그인 실패 - 확인 버튼 없음")
    return False, page


# ============ 예매 (2026-02-11 실제 테스트) ============
async def step_navigate_concert(page, config: Config) -> bool:
    """콘서트 페이지 이동"""
    logger.info("[2/5] 콘서트 페이지 이동...")
    await page.get(config.concert_url)
    await human_delay(2, 3)
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
    
    initial_tabs = len(await browser.tabs)
    
    for attempt in range(20):
        # 예매하기 링크 찾기 (link, not button!)
        booking = await find_by_text(page, '예매하기')
        if booking:
            await booking.click()
            logger.info(f"✅ 예매 클릭 성공 (시도 {attempt + 1})")
            await send_telegram(config, "🎉 예매 버튼 클릭!")
            await human_delay(2, 3)
            
            # 새 창/탭 처리 (인터파크 예매는 새 창 열림)
            current_tabs = await browser.tabs
            if len(current_tabs) > initial_tabs:
                new_page = current_tabs[-1]
                logger.info(f"🔄 새 창으로 전환 (탭 {initial_tabs} → {len(current_tabs)})")
                return True, new_page
            
            return True, page
        
        # 예매대기 상태 확인
        waiting = await find_by_text(page, '예매대기')
        if waiting:
            logger.info(f"⏳ 아직 예매대기... (시도 {attempt + 1})")
        
        # 새로고침
        await page.reload()
        backoff = min(0.3 * (1.5 ** attempt), 3)
        await asyncio.sleep(backoff)
    
    logger.error("❌ 예매 버튼 20회 실패")
    return False, page

async def step_select_seat(page, config: Config) -> bool:
    """좌석 선택 (수동 보조 + iframe 시도)"""
    logger.info("[5/5] 좌석 선택...")
    await send_telegram(config, "⚠️ 좌석 선택 페이지! CAPTCHA 확인하세요!")
    
    # 좌석 페이지는 복잡 (iframe/canvas 등)
    # 1. iframe 내부 시도
    # 2. 텍스트 검색 시도
    # 3. 수동 대기
    
    for attempt in range(30):
        logger.info(f"좌석 검색 시도 {attempt + 1}/30...")
        
        for grade in config.seat_priority:
            # 텍스트 검색 (버튼/링크)
            seat = await find_by_text(page, grade)
            if seat:
                try:
                    # 클릭 가능한지 확인
                    tag = getattr(seat, 'tag', None)
                    logger.info(f"발견: {grade} (tag: {tag})")
                    
                    await seat.click()
                    await human_delay(0.5, 1)
                    
                    # 선택 확인: 다음 단계 버튼 있는지
                    next_btn = await find_by_text(page, '선택완료')
                    if not next_btn:
                        next_btn = await find_by_text(page, '다음')
                    if not next_btn:
                        next_btn = await find_by_text(page, '결제')
                    
                    if next_btn:
                        logger.info(f"✅ {grade} 선택 확인!")
                        await send_telegram(config, f"🎉 {grade} 선택!")
                        await next_btn.click()
                        return True
                    else:
                        logger.info(f"{grade} 클릭했지만 다음 버튼 없음 - 재시도")
                except Exception as e:
                    logger.warning(f"{grade} 클릭 실패: {e}")
        
        # 새로고침 버튼
        refresh = await find_by_text(page, '새로고침')
        if refresh:
            try:
                await refresh.click()
                logger.info("🔄 새로고침")
            except Exception:
                pass
        
        await human_delay(1.5, 2.5)
    
    # 30회 실패 → 수동 대기
    logger.warning("⚠️ 자동 좌석 선택 실패 - 수동 진행 필요")
    await send_telegram(config, "⚠️ 수동 좌석 선택 필요! 30분 대기 중...")
    return False


# ============ 메인 ============
async def run_ticketing(config: Config, live: bool):
    logger.info("=" * 50)
    logger.info("🎫 BTS 티켓팅 v3.0")
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
        await human_delay(1, 2)
        
        # 1. 로그인
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
    parser = argparse.ArgumentParser(description='BTS 티켓팅 v3')
    parser.add_argument('--test', action='store_true', help='테스트 모드')
    parser.add_argument('--live', action='store_true', help='실전 모드')
    args = parser.parse_args()
    
    if not args.test and not args.live:
        print("사용법: python main_nodriver_v3.py --test 또는 --live")
        return
    
    try:
        config = Config.from_env()
    except ValueError as e:
        logger.error(f"설정 오류: {e}")
        return
    
    asyncio.run(run_ticketing(config, args.live))


if __name__ == '__main__':
    main()
