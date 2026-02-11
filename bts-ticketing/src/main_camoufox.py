#!/usr/bin/env python3
"""
BTS Ticketing Bot - Camoufox 버전
하이브리드 모드: 하드코딩 셀렉터 + AI 폴백
"""

import asyncio
import argparse
import os
import sys
from datetime import datetime
from typing import Optional, Dict, List

# Camoufox (anti-detect Playwright)
try:
    from camoufox.async_api import AsyncCamoufox
except ImportError:
    print("⚠️ camoufox 패키지 필요: pip install camoufox")
    AsyncCamoufox = None

# AI Helper
from ai_helper import AIHelper, PreciseTimer, HybridClicker


# ==================== 설정 ====================

class Config:
    """티켓팅 설정"""
    
    # 티켓팅 URL (예시)
    TARGET_URL = os.getenv("TICKET_URL", "https://ticket.example.com/bts")
    
    # 로그인 정보
    USER_ID = os.getenv("TICKET_USER_ID", "")
    USER_PW = os.getenv("TICKET_USER_PW", "")
    
    # 정시 시작 설정
    START_HOUR = int(os.getenv("TICKET_START_HOUR", "8"))
    START_MINUTE = int(os.getenv("TICKET_START_MINUTE", "0"))
    
    # 타이밍 설정
    FAST_TIMEOUT = 100      # 빠른 셀렉터 타임아웃 (ms)
    NORMAL_TIMEOUT = 2000   # 일반 타임아웃 (ms)
    MAX_RETRIES = 10        # 최대 재시도 횟수
    
    # 디버그 모드
    DEBUG = os.getenv("TICKET_DEBUG", "0") == "1"
    
    # 좌석 설정
    PREFERRED_SECTIONS = ["VIP", "R석", "S석"]  # 우선순위 순
    
    
# ==================== 셀렉터 정의 ====================

class Selectors:
    """하드코딩된 CSS 셀렉터 (빠른 경로)"""
    
    # 로그인
    LOGIN_ID = "#userId, input[name='userId'], input[type='text']"
    LOGIN_PW = "#userPw, input[name='userPw'], input[type='password']"
    LOGIN_BTN = "#loginBtn, button[type='submit'], .login-button"
    
    # 티켓 선택
    BUY_BTN = ".btn-buy, #ticketBuy, button:has-text('예매')"
    DATE_SELECT = ".date-item.available, .calendar-date:not(.disabled)"
    TIME_SELECT = ".time-item.available, .session-time:not(.sold-out)"
    
    # 좌석 선택
    SEAT_AREA = ".seat-area, .section-map"
    SEAT_AVAILABLE = ".seat.available, .seat:not(.sold):not(.reserved)"
    SEAT_CONFIRM = "#seatConfirm, .btn-seat-confirm, button:has-text('선택완료')"
    
    # 결제
    AGREE_ALL = "#agreeAll, .agree-all, input[name='agreeAll']"
    PAY_BTN = "#payBtn, .btn-pay, button:has-text('결제')"
    
    # 팝업/모달
    POPUP_CLOSE = ".popup-close, .modal-close, button:has-text('닫기'), .close-btn"
    CAPTCHA_FRAME = "iframe[src*='captcha'], #captchaFrame"


# ==================== 메인 봇 ====================

class BTSTicketBot:
    """BTS 티켓팅 봇"""
    
    def __init__(self, config: Config, debug: bool = False):
        self.config = config
        self.debug = debug or config.DEBUG
        self.ai = AIHelper(debug=self.debug)
        self.browser = None
        self.page = None
        self.clicker: Optional[HybridClicker] = None
        
    def log(self, message: str, emoji: str = "📌"):
        """로깅"""
        timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        print(f"{emoji} [{timestamp}] {message}")
    
    async def start(self, headless: bool = False, wait_for_time: bool = False):
        """봇 시작"""
        self.log("BTS 티켓팅 봇 시작", "🚀")
        
        # 정시 대기
        if wait_for_time:
            self.log(f"목표 시간: {self.config.START_HOUR:02d}:{self.config.START_MINUTE:02d}", "⏰")
            await PreciseTimer.wait_until(
                self.config.START_HOUR,
                self.config.START_MINUTE
            )
        
        # 브라우저 시작
        await self._launch_browser(headless)
        
        try:
            # 티켓팅 프로세스 실행
            success = await self._run_ticketing()
            
            if success:
                self.ai.announce_success()
                self.log("🎉 티켓팅 성공!", "✅")
            else:
                self.ai.announce_failure(retry=False)
                self.log("티켓팅 실패", "❌")
                
            return success
            
        except KeyboardInterrupt:
            self.log("사용자가 중단함 (Ctrl+C)", "⛔")
            return False
        except Exception as e:
            import traceback
            self.log(f"에러 발생: {e}", "💥")
            traceback.print_exc()  # 전체 스택트레이스 출력
            
            # AI 에러 분석
            if self.page:
                analysis = await self.ai.analyze_error(self.page, e)
                self.log(f"원인: {analysis.get('cause')}", "🔍")
                self.log(f"해결: {analysis.get('suggestion')}", "💡")
            
            self.ai.announce_failure(retry=True)
            return False
            
        finally:
            if self.browser:
                try:
                    await self.browser.stop()
                    self.log("브라우저 종료됨", "🔒")
                except Exception as cleanup_err:
                    self.log(f"브라우저 종료 중 오류: {cleanup_err}", "⚠️")
    
    async def _launch_browser(self, headless: bool):
        """Camoufox 브라우저 실행"""
        if AsyncCamoufox is None:
            raise RuntimeError("camoufox 패키지가 설치되지 않음")
        
        self.log("Camoufox 브라우저 시작...", "🦊")
        
        self.browser = await AsyncCamoufox(
            headless=headless,
            # 한국 설정
            locale="ko-KR",
            timezone="Asia/Seoul",
            # 안티 디텍션
            humanize=True,
        ).start()
        
        self.page = await self.browser.new_page()
        self.clicker = HybridClicker(self.ai, self.page)
        
        self.log("브라우저 준비 완료", "✅")
    
    async def _run_ticketing(self) -> bool:
        """티켓팅 메인 프로세스"""
        
        # 1. 사이트 접속
        self.log(f"사이트 접속: {self.config.TARGET_URL}", "🌐")
        await self.page.goto(self.config.TARGET_URL, wait_until="domcontentloaded")
        
        # 팝업 처리
        await self._handle_popups()
        
        # 2. 로그인 (필요시)
        if self.config.USER_ID and self.config.USER_PW:
            await self._login()
        
        # 3. 예매 버튼 클릭
        await self._click_buy_button()
        
        # 4. 날짜/시간 선택
        await self._select_date_time()
        
        # 5. 좌석 선택
        await self._select_seats()
        
        # 6. 결제 진행
        success = await self._proceed_payment()
        
        return success
    
    async def _handle_popups(self):
        """팝업 처리"""
        self.log("팝업 확인 중...", "🔍")
        
        # 하드코딩 셀렉터로 빠르게 시도
        try:
            close_btn = await self.page.query_selector(Selectors.POPUP_CLOSE)
            if close_btn:
                await close_btn.click()
                self.log("팝업 닫음 (빠른 경로)", "✅")
                return
        except Exception as e:
            self.log(f"팝업 닫기 빠른 경로 실패: {e}", "⚠️")
        
        # AI 폴백
        closed = await self.ai.handle_unexpected_popup(self.page)
        if closed:
            self.log("팝업 닫음 (AI)", "✅")
    
    async def _login(self):
        """로그인"""
        self.log("로그인 시도...", "🔐")
        
        # ID 입력
        await self.clicker.click(
            Selectors.LOGIN_ID,
            "아이디 입력 필드"
        )
        await self.page.keyboard.type(self.config.USER_ID, delay=10)
        
        # PW 입력
        await self.clicker.click(
            Selectors.LOGIN_PW,
            "비밀번호 입력 필드"
        )
        await self.page.keyboard.type(self.config.USER_PW, delay=10)
        
        # 로그인 버튼
        await self.clicker.click(
            Selectors.LOGIN_BTN,
            "로그인 버튼"
        )
        
        await asyncio.sleep(1)
        self.log("로그인 완료", "✅")
    
    async def _click_buy_button(self):
        """예매 버튼 클릭"""
        self.log("예매 버튼 찾는 중...", "🎫")
        
        for i in range(self.config.MAX_RETRIES):
            success = await self.clicker.click(
                Selectors.BUY_BTN,
                "예매하기 버튼, 티켓 구매 버튼",
                timeout=self.config.FAST_TIMEOUT
            )
            
            if success:
                self.log("예매 버튼 클릭 완료", "✅")
                return
            
            # 페이지 리프레시 후 재시도
            if i < self.config.MAX_RETRIES - 1:
                await self.page.reload()
                await asyncio.sleep(0.1)
        
        raise Exception("예매 버튼을 찾을 수 없음")
    
    async def _select_date_time(self):
        """날짜/시간 선택"""
        self.log("날짜 선택 중...", "📅")
        
        # 날짜 선택
        success = await self.clicker.click(
            Selectors.DATE_SELECT,
            "예매 가능한 날짜, 선택 가능한 공연 날짜"
        )
        if not success:
            raise Exception("날짜 선택 실패")
        
        await asyncio.sleep(0.3)
        
        # 시간 선택
        self.log("시간 선택 중...", "🕐")
        success = await self.clicker.click(
            Selectors.TIME_SELECT,
            "예매 가능한 시간, 공연 회차 선택"
        )
        if not success:
            raise Exception("시간 선택 실패")
        
        self.log("날짜/시간 선택 완료", "✅")
    
    async def _select_seats(self):
        """좌석 선택"""
        self.log("좌석 선택 중...", "💺")
        
        # 구역 선택 (VIP > R석 > S석 순)
        for section in self.config.PREFERRED_SECTIONS:
            try:
                await self.page.click(
                    f"text={section}",
                    timeout=self.config.FAST_TIMEOUT
                )
                self.log(f"구역 선택: {section}", "✅")
                break
            except Exception as e:
                self.log(f"구역 '{section}' 선택 실패: {e}", "⚠️")
                continue
        
        await asyncio.sleep(0.2)
        
        # 가능한 좌석 클릭
        success = await self.clicker.click(
            Selectors.SEAT_AVAILABLE,
            "선택 가능한 좌석, 빈 좌석, 예매 가능한 자리"
        )
        if not success:
            # 자동 배정 시도
            success = await self.clicker.click(
                "button:has-text('자동선택'), button:has-text('자동배정')",
                "자동 좌석 배정 버튼"
            )
        
        if not success:
            raise Exception("좌석 선택 실패")
        
        await asyncio.sleep(0.2)
        
        # 선택 완료 버튼
        await self.clicker.click(
            Selectors.SEAT_CONFIRM,
            "좌석 선택 완료 버튼"
        )
        
        self.log("좌석 선택 완료", "✅")
    
    async def _proceed_payment(self) -> bool:
        """결제 진행"""
        self.log("결제 페이지 진입...", "💳")
        
        await asyncio.sleep(0.5)
        
        # 전체 동의
        await self.clicker.click(
            Selectors.AGREE_ALL,
            "전체 동의 체크박스, 약관 전체 동의",
            ai_fallback=True
        )
        
        await asyncio.sleep(0.2)
        
        # 결제 버튼
        success = await self.clicker.click(
            Selectors.PAY_BTN,
            "결제하기 버튼, 결제 진행 버튼"
        )
        
        if success:
            self.log("결제 페이지 진입 성공!", "✅")
            # 여기서 실제 결제는 사용자가 진행
            return True
        else:
            return False


# ==================== 크론 정시 시작 ====================

async def scheduled_start():
    """크론용 정시 시작 (8시 정각)"""
    config = Config()
    bot = BTSTicketBot(config, debug=True)
    
    # 정시 대기 후 시작
    success = await bot.start(
        headless=False,
        wait_for_time=True
    )
    
    return success


# ==================== CLI ====================

def main():
    """CLI 엔트리포인트"""
    parser = argparse.ArgumentParser(description="BTS 티켓팅 봇")
    parser.add_argument("--headless", action="store_true", help="헤드리스 모드")
    parser.add_argument("--wait", action="store_true", help="정시까지 대기")
    parser.add_argument("--hour", type=int, default=8, help="시작 시간 (시)")
    parser.add_argument("--minute", type=int, default=0, help="시작 시간 (분)")
    parser.add_argument("--debug", action="store_true", help="디버그 모드")
    parser.add_argument("--url", type=str, help="티켓팅 URL")
    
    args = parser.parse_args()
    
    # 설정 오버라이드
    if args.url:
        Config.TARGET_URL = args.url
    Config.START_HOUR = args.hour
    Config.START_MINUTE = args.minute
    Config.DEBUG = args.debug
    
    config = Config()
    
    # 설정 검증
    if not config.USER_ID or not config.USER_PW:
        print("❌ 필수 설정 누락: TICKET_USER_ID, TICKET_USER_PW 환경변수 확인")
        return
    print("✅ 설정 검증 완료")
    
    bot = BTSTicketBot(config, debug=args.debug)
    
    # 실행
    asyncio.run(bot.start(
        headless=args.headless,
        wait_for_time=args.wait
    ))


if __name__ == "__main__":
    main()
