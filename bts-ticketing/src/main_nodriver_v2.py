#!/usr/bin/env python3
"""
BTS 티켓팅 매크로 v2.0 - 구조 개선 버전
- dataclass 기반 설정
- 단계별 함수 분리
- 다중 셀렉터 + 폴백
- 견고한 에러 핸들링
"""

import nodriver as nd
import asyncio
import random
import argparse
import os
import traceback
import time
import io
import logging
from datetime import datetime
from zoneinfo import ZoneInfo
from dataclasses import dataclass, field
from typing import Optional, List
import aiohttp

# ============ 로깅 설정 ============
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# ============ 설정 (Dataclass) ============
@dataclass(frozen=True)
class Config:
    """불변 설정 객체"""
    user_id: str
    user_pwd: str
    concert_url: str
    open_time: datetime
    seat_priority: List[str] = field(default_factory=lambda: ['VIP', 'R석', 'S석', 'A석'])
    telegram_bot_token: str = ''
    telegram_chat_id: str = ''
    
    @classmethod
    def from_env(cls) -> 'Config':
        """환경변수에서 설정 로드"""
        user_id = os.getenv('INTERPARK_ID', '')
        user_pwd = os.getenv('INTERPARK_PWD', '')
        concert_url = os.getenv('CONCERT_URL', '')
        
        if not user_id or not user_pwd:
            raise ValueError("필수 환경변수 누락: INTERPARK_ID, INTERPARK_PWD")
        if not concert_url or 'XXXXXXX' in concert_url:
            raise ValueError("CONCERT_URL 환경변수를 실제 URL로 설정하세요")
        
        return cls(
            user_id=user_id,
            user_pwd=user_pwd,
            concert_url=concert_url,
            open_time=datetime(2026, 2, 23, 20, 0, 0, tzinfo=ZoneInfo('Asia/Seoul')),
            telegram_bot_token=os.getenv('TELEGRAM_BOT_TOKEN', ''),
            telegram_chat_id=os.getenv('TELEGRAM_CHAT_ID', ''),
        )
    
    def validate(self) -> None:
        """설정 검증"""
        if not self.user_id:
            raise ValueError("user_id 필수")
        if not self.user_pwd:
            raise ValueError("user_pwd 필수")
        if not self.concert_url or 'XXXXXXX' in self.concert_url:
            raise ValueError("concert_url 필수 (실제 URL)")
        logger.info("✅ 설정 검증 완료")


# ============ 셀렉터 정의 (다중 폴백) ============
class Selectors:
    """CSS 셀렉터 모음 (2026-02-11 실제 DOM 분석 기반)"""
    
    # [Step 1] 메인페이지 로그인 버튼
    MAIN_LOGIN_BTN = [
        'button',  # "로그인" 텍스트로 찾기
    ]
    
    # [Step 2] 기존 인터파크 계정 로그인 버튼
    LEGACY_LOGIN_BTN = [
        'button',  # "기존 인터파크 계정 로그인" 텍스트
    ]
    
    # [Step 3] 로그인 폼 (iframe 없음!)
    LOGIN_ID = [
        'input[type="text"]',  # "아이디" 텍스트박스
    ]
    
    LOGIN_PWD = [
        'input[type="password"]',  # "비밀번호" 텍스트박스
    ]
    
    # 로그인 제출 버튼
    LOGIN_SUBMIT = [
        'button',  # "로그인" 텍스트
    ]
    
    # 로그아웃 (로그인 확인용)
    LOGOUT_BTN = [
        'button',  # "로그아웃" or 내 예약 버튼 등
    ]
    
    # 예매 버튼 (CSS only)
    BOOKING_BTN = [
        '.btn-booking',
        '#btnBooking',
        'a[href*="book"]',
        '[class*="booking"]',
        '[class*="reserve"]',
    ]
    
    # 좌석 영역
    SEAT_AREA = [
        '#seatArea',
        '.seat-map',
        '[class*="seat"]',
        'svg',  # SVG 기반 좌석맵
    ]
    
    # 새로고침
    REFRESH_BTN = [
        '.btn-refresh',
        '#refreshBtn',
        '[class*="refresh"]',
    ]
    
    # 좌석 등급별 (CSS only)
    @staticmethod
    def seat_grade(grade: str) -> list:
        """좌석 등급별 셀렉터 생성"""
        grade_lower = grade.lower().replace('석', '')
        return [
            f'[data-grade="{grade}"]',
            f'.seat-{grade_lower}',
            f'[class*="{grade_lower}"]',
            f'td[class*="{grade_lower}"]',
        ]


# ============ HTTP 세션 관리 ============
class HttpSessionManager:
    """aiohttp 세션 싱글톤 관리"""
    
    _instance: Optional[aiohttp.ClientSession] = None
    
    @classmethod
    async def get(cls) -> aiohttp.ClientSession:
        if cls._instance is None or cls._instance.closed:
            cls._instance = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=10)
            )
        return cls._instance
    
    @classmethod
    async def close(cls) -> None:
        if cls._instance and not cls._instance.closed:
            await cls._instance.close()
            logger.info("🔒 HTTP 세션 종료됨")


# ============ 텔레그램 알림 ============
async def send_telegram(config: Config, message: str) -> None:
    """텔레그램 알림 (비동기, 안전)"""
    if not config.telegram_bot_token:
        logger.info(f"[알림] {message}")
        return
    
    url = f"https://api.telegram.org/bot{config.telegram_bot_token}/sendMessage"
    data = {
        'chat_id': config.telegram_chat_id,
        'text': f"🎫 BTS 티켓팅\n{message}",
    }
    
    try:
        session = await HttpSessionManager.get()
        async with session.post(url, data=data) as resp:
            if resp.status != 200:
                logger.warning(f"텔레그램 전송 실패: HTTP {resp.status}")
    except Exception as e:
        logger.error(f"텔레그램 전송 오류: {e}")


# ============ 유틸리티 ============
async def human_delay(min_sec: float = 0.5, max_sec: float = 2.0) -> None:
    """인간처럼 랜덤 대기"""
    await asyncio.sleep(random.uniform(min_sec, max_sec))


async def human_type(element, text: str) -> None:
    """인간처럼 타이핑"""
    for char in text:
        await element.send_keys(char)
        await asyncio.sleep(random.uniform(0.05, 0.15))


async def find_element(page, selectors: List[str], timeout: int = 2000):
    """다중 셀렉터로 요소 찾기 (폴백 지원, 에러 로깅)"""
    for selector in selectors:
        try:
            elem = await page.find(selector, timeout=timeout)
            if elem:
                logger.debug(f"요소 발견: {selector}")
                return elem
        except TimeoutError:
            logger.debug(f"타임아웃: {selector}")
            continue
        except Exception as e:
            # 예상치 못한 에러는 경고 로깅
            logger.warning(f"셀렉터 오류 [{selector}]: {type(e).__name__}: {e}")
            continue
    return None


async def find_element_text(page, text: str, timeout: int = 2000):
    """텍스트로 요소 찾기 (nodriver 호환)"""
    try:
        # nodriver의 텍스트 검색 방식
        elem = await page.find(text, timeout=timeout)
        if elem:
            logger.debug(f"텍스트 요소 발견: {text}")
            return elem
    except Exception as e:
        logger.debug(f"텍스트 검색 실패 [{text}]: {e}")
    return None


def mask_credentials(text: str, config: Config) -> str:
    """credential 마스킹"""
    result = text
    if config.user_pwd and config.user_pwd in result:
        result = result.replace(config.user_pwd, '****')
    if config.user_id and config.user_id in result:
        result = result.replace(config.user_id, '[ID]')
    return result


# ============ 단계별 함수 ============
async def step_login(page, config: Config) -> bool:
    """1단계: 로그인 (2026-02-11 실제 테스트 기반)
    
    플로우:
    1. 메인페이지 → "로그인" 버튼 클릭
    2. 새 페이지 → "기존 인터파크 계정 로그인" 클릭
    3. ID/PW 입력 → 로그인
    """
    logger.info("[1/6] 로그인 시작...")
    
    # Step 1: 메인페이지 로그인 버튼 클릭
    login_btn = await find_element_text(page, '로그인')
    if not login_btn:
        logger.error("메인 로그인 버튼을 찾을 수 없음")
        return False
    
    await login_btn.click()
    await human_delay(2, 3)  # 새 페이지 로드 대기
    
    # Step 2: 기존 인터파크 계정 로그인 버튼 클릭
    legacy_btn = await find_element_text(page, '기존 인터파크 계정 로그인')
    if not legacy_btn:
        # 이미 로그인 폼이 보일 수도 있음
        logger.info("기존 계정 버튼 없음 - 바로 로그인 폼 시도")
    else:
        await legacy_btn.click()
        await human_delay(1, 2)
    
    # Step 3: ID 입력 (iframe 없음!)
    user_id_input = await find_element_text(page, '아이디')
    if not user_id_input:
        user_id_input = await find_element(page, Selectors.LOGIN_ID, timeout=5000)
    if not user_id_input:
        logger.error("아이디 입력 필드를 찾을 수 없음")
        return False
    
    await human_type(user_id_input, config.user_id)
    await human_delay(0.3, 0.5)
    
    # Step 4: PW 입력
    user_pwd_input = await find_element_text(page, '비밀번호')
    if not user_pwd_input:
        user_pwd_input = await find_element(page, Selectors.LOGIN_PWD)
    if not user_pwd_input:
        logger.error("비밀번호 입력 필드를 찾을 수 없음")
        return False
    
    await human_type(user_pwd_input, config.user_pwd)
    await human_delay(0.3, 0.5)
    
    # Step 5: 로그인 버튼 클릭 (폼 내부)
    login_submit = await find_element_text(page, '로그인')
    if login_submit:
        await login_submit.click()
    else:
        # 엔터키 폴백
        await user_pwd_input.send_keys('\n')
    
    await human_delay(3, 5)  # 로그인 처리 대기
    
    # Step 6: 로그인 확인 (내 예약 버튼 또는 로그아웃 버튼)
    my_booking = await find_element_text(page, '내 예약')
    if my_booking:
        logger.info("✅ 로그인 성공 (내 예약 버튼 확인)")
        return True
    
    logout_btn = await find_element_text(page, '로그아웃')
    if logout_btn:
        logger.info("✅ 로그인 성공 (로그아웃 버튼 확인)")
        return True
    
    logger.error("❌ 로그인 실패 - 로그인 상태 확인 불가")
    return False


async def step_navigate(page, config: Config) -> bool:
    """2단계: 공연 페이지 이동"""
    logger.info("[2/6] 공연 페이지 이동...")
    
    await page.get(config.concert_url)
    await human_delay(1, 2)
    
    logger.info("✅ 공연 페이지 도착")
    return True


async def step_wait_open(page, config: Config) -> bool:
    """3단계: 오픈 대기"""
    logger.info("[3/6] 오픈 대기...")
    
    while datetime.now(ZoneInfo('Asia/Seoul')) < config.open_time:
        remaining = (config.open_time - datetime.now(ZoneInfo('Asia/Seoul'))).total_seconds()
        
        if remaining > 60:
            logger.info(f"⏳ 오픈까지 {int(remaining)}초...")
            await asyncio.sleep(30)
            await page.reload()
        elif remaining > 5:
            logger.info(f"⏳ {int(remaining)}초...")
            await asyncio.sleep(1)
        else:
            await asyncio.sleep(0.1)
    
    logger.info("🚀 오픈!")
    return True


async def step_booking(page, config: Config) -> bool:
    """4단계: 예매 버튼 클릭"""
    logger.info("[4/6] 예매 버튼 클릭...")
    
    for attempt in range(10):
        booking_btn = await find_element(page, Selectors.BOOKING_BTN)
        if booking_btn:
            await booking_btn.click()
            logger.info(f"✅ 예매 버튼 클릭 성공 (시도 {attempt + 1})")
            await human_delay(2, 3)
            return True
        
        logger.warning(f"[시도 {attempt + 1}] 예매 버튼 찾기 실패")
        await page.reload()
        backoff = min(0.5 * (2 ** attempt), 5)
        await asyncio.sleep(backoff)
    
    logger.error("❌ 예매 버튼 10회 시도 실패")
    return False


async def step_select_seat(page, config: Config) -> bool:
    """5단계: 좌석 선택"""
    logger.info("[5/6] 좌석 선택...")
    await send_telegram(config, "⚠️ 예매창 열림! CAPTCHA 확인하세요!")
    
    for attempt in range(50):
        for seat_grade in config.seat_priority:
            # CSS 셀렉터 (nodriver 호환)
            selectors = Selectors.seat_grade(seat_grade)
            seat = await find_element(page, selectors, timeout=1000)
            
            # 텍스트 검색 폴백
            if not seat:
                seat = await find_element_text(page, seat_grade, timeout=500)
            
            if seat:
                await seat.click()
                logger.info(f"✅ {seat_grade} 좌석 선택!")
                await send_telegram(config, f"🎉 {seat_grade} 좌석 선택!")
                return True
        
        logger.info(f"시도 {attempt + 1}/50: 좌석 찾는 중...")
        
        refresh_btn = await find_element(page, Selectors.REFRESH_BTN, timeout=500)
        if refresh_btn:
            await refresh_btn.click()
        
        await human_delay(1, min(3, 1 + attempt * 0.1))
    
    logger.warning("⚠️ 자동 좌석 선택 실패")
    await send_telegram(config, "⚠️ 자동 좌석 선택 실패 - 수동으로 선택하세요!")
    return False


async def step_payment_wait(config: Config, timeout_minutes: int = 30) -> None:
    """6단계: 결제 대기"""
    logger.info("[6/6] 결제 대기...")
    await send_telegram(config, "💳 결제 화면에서 직접 결제하세요!")
    
    print("\n" + "=" * 50)
    print("🎉 좌석 선택 완료! 결제를 진행하세요!")
    print(f"💡 {timeout_minutes}분 후 자동 종료 (Ctrl+C로 즉시 종료)")
    print("=" * 50)
    
    deadline = time.time() + (timeout_minutes * 60)
    while time.time() < deadline:
        await asyncio.sleep(60)
        remaining = int((deadline - time.time()) / 60)
        logger.info(f"⏳ 남은 대기 시간: {remaining}분")
    
    await send_telegram(config, f"⏰ {timeout_minutes}분 타임아웃 - 자동 종료")
    logger.info(f"⏰ {timeout_minutes}분 타임아웃 - 자동 종료")


# ============ 메인 실행 ============
async def run_ticketing(config: Config, is_live: bool) -> bool:
    """티켓팅 메인 플로우"""
    logger.info("🎫 BTS 티켓팅 시작")
    logger.info(f"오픈 시간: {config.open_time}")
    logger.info(f"현재 시간: {datetime.now(ZoneInfo('Asia/Seoul'))}")
    logger.info(f"모드: {'실전' if is_live else '테스트'}")
    print("-" * 50)
    
    browser = None
    
    try:
        # 브라우저 시작
        browser = await nd.start(
            headless=False,
            browser_args=[
                '--window-size=1920,1080',
                '--lang=ko-KR',
                '--no-sandbox',
                '--disable-dev-shm-usage',
            ]
        )
        
        page = await browser.get('https://tickets.interpark.com/')
        await human_delay(1, 2)
        
        # 1. 로그인
        if not await step_login(page, config):
            await send_telegram(config, "❌ 로그인 실패!")
            return False
        
        # 2. 공연 페이지 이동
        if not await step_navigate(page, config):
            return False
        
        # 3. 오픈 대기 (실전 모드만)
        if is_live:
            await step_wait_open(page, config)
        
        # 4. 예매 버튼 클릭
        if not await step_booking(page, config):
            await send_telegram(config, "❌ 예매 버튼 실패!")
            return False
        
        # 5. 좌석 선택
        await step_select_seat(page, config)
        
        # 6. 결제 대기
        await step_payment_wait(config)
        
        return True
        
    except (KeyboardInterrupt, asyncio.CancelledError):
        logger.info("\n⛔ 사용자가 중단함 (Ctrl+C)")
        try:
            await send_telegram(config, "⛔ 사용자가 중단함")
        except Exception:
            pass
        return False
        
    except Exception as e:
        error_msg = mask_credentials(str(e), config)
        
        try:
            await send_telegram(config, f"❌ 오류: {error_msg}")
        except Exception:
            pass
        
        logger.error(f"오류: {error_msg}")
        
        # traceback 마스킹
        tb_buffer = io.StringIO()
        traceback.print_exc(file=tb_buffer)
        tb_str = mask_credentials(tb_buffer.getvalue(), config)
        print(tb_str)
        
        return False
        
    finally:
        # 브라우저 종료
        if browser:
            try:
                browser.stop()
                logger.info("🔒 브라우저 종료됨")
            except Exception as e:
                logger.warning(f"브라우저 종료 오류: {e}")
        
        # HTTP 세션 종료
        await HttpSessionManager.close()


# ============ 진입점 ============
def main():
    parser = argparse.ArgumentParser(description='BTS 티켓팅 (Nodriver v2)')
    parser.add_argument('--test', action='store_true', help='테스트 모드')
    parser.add_argument('--live', action='store_true', help='실전 모드')
    args = parser.parse_args()
    
    if not args.test and not args.live:
        print("사용법: python main_nodriver_v2.py --test 또는 --live")
        return
    
    try:
        config = Config.from_env()
        config.validate()
    except ValueError as e:
        logger.error(f"❌ 설정 오류: {e}")
        return
    
    asyncio.run(run_ticketing(config, is_live=args.live))


if __name__ == '__main__':
    main()
