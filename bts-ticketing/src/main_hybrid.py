#!/usr/bin/env python3
"""
BTS 티켓팅 봇 - 하이브리드 모드 (프로덕션 버전)

핵심 전략:
1. Camoufox (Firefox 기반) - CDP 탐지 회피
2. 2captcha Turnstile 솔버 - 자동 CAPTCHA 해결
3. 수동 폴백 - 실패 시 사용자 개입 요청
4. 프록시 로테이션 - 멀티 세션 지원

사용법:
    python main_hybrid.py --url "https://tickets.interpark.com/goods/12345"
    python main_hybrid.py --wait --hour 8 --minute 0  # 8시 정각 대기

환경변수:
    TICKET_USER_ID: 로그인 ID
    TICKET_USER_PW: 로그인 비밀번호
    TWOCAPTCHA_API_KEY: 2captcha API 키 (선택)
    PROXY_LIST: 프록시 목록 (선택)
"""

import asyncio
import argparse
import os
import sys
import time
import traceback
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from typing import Optional, Dict, List, Tuple
from dataclasses import dataclass

# Camoufox (pip install camoufox)
try:
    from camoufox.async_api import AsyncCamoufox
    HAS_CAMOUFOX = True
except ImportError:
    HAS_CAMOUFOX = False
    print("⚠️ Camoufox 필요: pip install camoufox")

# 내부 모듈
from captcha_solver import TurnstileSolver, CaptchaResult
from proxy_pool import ProxyPool, Proxy, init_proxy_pool
from ai_helper import AIHelper, HybridClicker, PreciseTimer


# ==================== 설정 ====================

@dataclass
class TicketConfig:
    """티켓팅 설정"""
    # 필수
    target_url: str
    user_id: str
    user_pw: str
    
    # 타이밍
    start_hour: int = 8
    start_minute: int = 0
    wait_for_time: bool = False
    
    # CAPTCHA
    captcha_api_key: str = ""
    manual_captcha: bool = True  # 수동 폴백 허용
    
    # 세션
    num_sessions: int = 1
    session_delay: float = 30.0  # 세션 간 딜레이 (초)
    
    # 좌석
    seat_priority: List[str] = None
    auto_select_best: bool = True
    
    # 디버그
    debug: bool = False
    headless: bool = False
    
    @classmethod
    def from_env(cls) -> "TicketConfig":
        """환경변수에서 설정 로드"""
        return cls(
            target_url=os.getenv("TICKET_URL", ""),
            user_id=os.getenv("TICKET_USER_ID", ""),
            user_pw=os.getenv("TICKET_USER_PW", ""),
            start_hour=int(os.getenv("TICKET_START_HOUR", "8")),
            start_minute=int(os.getenv("TICKET_START_MINUTE", "0")),
            captcha_api_key=os.getenv("TWOCAPTCHA_API_KEY", ""),
            num_sessions=int(os.getenv("NUM_SESSIONS", "1")),
            debug=os.getenv("TICKET_DEBUG", "0") == "1",
            seat_priority=os.getenv("SEAT_PRIORITY", "VIP,R석,S석,A석").split(",")
        )


# ==================== 셀렉터 (NOL 티켓 / 인터파크) ====================

class Selectors:
    """NOL 티켓 (tickets.interpark.com) 셀렉터
    
    Note: 실제 테스트로 검증 필요. AI 폴백으로 보완.
    """
    
    # 로그인
    LOGIN_BTN = ".header-login, a[href*='login'], button:has-text('로그인')"
    LOGIN_ID = "input[name='userId'], input[name='email'], input[type='email'], #userId"
    LOGIN_PW = "input[name='password'], input[type='password'], #password"
    LOGIN_SUBMIT = "button[type='submit'], .login-btn, button:has-text('로그인')"
    
    # 예매 버튼 (상품 페이지)
    BOOK_BTN = ".btn-book, .booking-btn, a[href*='booking'], button:has-text('예매하기'), button:has-text('예매')"
    
    # 날짜/회차 선택
    DATE_ITEM = ".date-item:not(.disabled), .calendar-date.available, [data-date]:not(.sold-out)"
    TIME_ITEM = ".time-item:not(.disabled), .session-item.available, [data-time]:not(.sold-out)"
    
    # 좌석 선택
    SEAT_SECTION = ".section-item, .area-item, [data-section]"
    SEAT_AVAILABLE = ".seat.available, .seat:not(.sold):not(.reserved), [data-seat]:not(.disabled)"
    SEAT_CONFIRM = ".btn-seat-confirm, #seatConfirm, button:has-text('선택완료')"
    
    # 결제
    AGREE_ALL = "#agreeAll, .agree-all, input[name='agreeAll'], label:has-text('전체 동의')"
    PAY_BTN = ".btn-pay, #payBtn, button:has-text('결제')"
    
    # 팝업/모달
    POPUP_CLOSE = ".popup-close, .modal-close, button:has-text('닫기'), .close-btn, [aria-label='close']"
    POPUP_CONFIRM = ".popup-confirm, button:has-text('확인'), button:has-text('OK')"
    
    # 대기열
    QUEUE_STATUS = ".queue-status, #queuePosition, .waiting-position"
    QUEUE_MESSAGE = ".queue-message, .waiting-message"


# ==================== 메인 봇 ====================

class HybridTicketBot:
    """하이브리드 티켓팅 봇
    
    특징:
    - Camoufox 기반 (CDP 탐지 회피)
    - 자동 CAPTCHA + 수동 폴백
    - 프록시 로테이션
    - AI 셀렉터 보정
    """
    
    def __init__(self, config: TicketConfig):
        self.config = config
        self.browser = None
        self.page = None
        
        # AI 헬퍼
        self.ai = AIHelper(debug=config.debug)
        self.clicker: Optional[HybridClicker] = None
        
        # CAPTCHA 솔버
        self.captcha_solver = TurnstileSolver(
            api_key=config.captcha_api_key,
            on_manual_required=self._handle_manual_captcha if config.manual_captcha else None
        )
        
        # 프록시
        self.proxy_pool: Optional[ProxyPool] = None
        self.current_proxy: Optional[Proxy] = None
        
        # 상태
        self.session_id: int = 0
        self.is_logged_in: bool = False
        self.ticket_secured: bool = False
    
    def log(self, message: str, emoji: str = "📌"):
        """로깅"""
        timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
        session_prefix = f"[S{self.session_id}]" if self.session_id > 0 else ""
        print(f"{emoji} [{timestamp}]{session_prefix} {message}")
    
    # ============ 브라우저 관리 ============
    
    async def start_browser(self, proxy: Proxy = None) -> bool:
        """Camoufox 브라우저 시작"""
        if not HAS_CAMOUFOX:
            self.log("Camoufox가 설치되지 않음!", "❌")
            return False
        
        self.log("Camoufox 브라우저 시작...", "🦊")
        
        try:
            # Camoufox 옵션
            camoufox_args = {
                "headless": self.config.headless,
                "locale": "ko-KR",
                "geoip": True,  # IP 기반 geolocation
                "humanize": True,  # 인간적 행동 시뮬레이션
            }
            
            # 프록시 설정
            if proxy:
                camoufox_args["proxy"] = proxy.playwright_format
                self.log(f"프록시 사용: {proxy.host}:{proxy.port}", "🌐")
            
            self.browser = await AsyncCamoufox(**camoufox_args).start()
            self.page = await self.browser.new_page()
            
            # HybridClicker 초기화
            self.clicker = HybridClicker(self.ai, self.page)
            
            self.log("브라우저 준비 완료", "✅")
            return True
            
        except Exception as e:
            self.log(f"브라우저 시작 실패: {e}", "❌")
            traceback.print_exc()
            return False
    
    async def stop_browser(self):
        """브라우저 종료"""
        if self.browser:
            try:
                await self.browser.stop()
                self.log("브라우저 종료됨", "🔒")
            except Exception as e:
                self.log(f"브라우저 종료 오류: {e}", "⚠️")
    
    # ============ 메인 플로우 ============
    
    async def run(self) -> bool:
        """티켓팅 실행"""
        self.log("BTS 티켓팅 봇 시작", "🚀")
        
        # 설정 검증
        if not self._validate_config():
            return False
        
        # 프록시 초기화
        self._init_proxy_pool()
        
        # 정시 대기
        if self.config.wait_for_time:
            await self._wait_for_open_time()
        
        # 브라우저 시작
        proxy = self.proxy_pool.get_proxy() if self.proxy_pool else None
        if not await self.start_browser(proxy):
            return False
        
        try:
            # 티켓팅 프로세스
            success = await self._run_ticketing_flow()
            
            if success:
                self.ticket_secured = True
                self.ai.announce_success()
                self.log("🎉 티켓팅 성공!", "✅")
            else:
                self.ai.announce_failure(retry=False)
                self.log("티켓팅 실패", "❌")
            
            return success
            
        except KeyboardInterrupt:
            self.log("사용자 중단 (Ctrl+C)", "⛔")
            return False
            
        except Exception as e:
            self.log(f"오류 발생: {e}", "💥")
            traceback.print_exc()
            
            # AI 오류 분석
            if self.page:
                analysis = await self.ai.analyze_error(self.page, e)
                self.log(f"원인: {analysis.get('cause')}", "🔍")
                self.log(f"해결: {analysis.get('suggestion')}", "💡")
            
            return False
            
        finally:
            await self.stop_browser()
            await self.captcha_solver.close()
    
    async def _run_ticketing_flow(self) -> bool:
        """티켓팅 전체 플로우"""
        
        # 1. 사이트 접속
        self.log(f"사이트 접속: {self.config.target_url}", "🌐")
        await self.page.goto(self.config.target_url, wait_until="domcontentloaded")
        
        # 팝업 처리
        await self._handle_popups()
        
        # 2. CAPTCHA 체크 (초기)
        await self._handle_captcha()
        
        # 3. 로그인
        if not self.is_logged_in:
            await self._login()
        
        # 4. 예매 버튼 클릭
        await self._click_book_button()
        
        # 5. 대기열 처리
        await self._handle_queue()
        
        # 6. 날짜/회차 선택
        await self._select_date_time()
        
        # 7. 좌석 선택
        await self._select_seats()
        
        # 8. 결제 페이지
        return await self._proceed_payment()
    
    # ============ 개별 단계 ============
    
    async def _handle_popups(self):
        """팝업 처리"""
        try:
            # 빠른 시도
            close_btn = await self.page.query_selector(Selectors.POPUP_CLOSE)
            if close_btn:
                await close_btn.click()
                self.log("팝업 닫음", "✅")
                await asyncio.sleep(0.3)
        except Exception:
            pass
        
        # AI 폴백
        await self.ai.handle_unexpected_popup(self.page)
    
    async def _handle_captcha(self) -> bool:
        """CAPTCHA 처리"""
        if await self.captcha_solver.detect_turnstile(self.page):
            self.log("Turnstile CAPTCHA 감지!", "🔐")
            
            result = await self.captcha_solver.solve(self.page)
            
            if result.success:
                await self.captcha_solver.inject_token(self.page, result.token)
                self.log(f"CAPTCHA 해결 ({result.service}, {result.solve_time:.1f}s)", "✅")
                await asyncio.sleep(1)
                return True
            else:
                self.log(f"CAPTCHA 해결 실패: {result.error}", "❌")
                return False
        
        return True  # CAPTCHA 없음
    
    async def _handle_manual_captcha(self) -> bool:
        """수동 CAPTCHA 해결 요청"""
        self.log("수동 CAPTCHA 해결 필요!", "🖐️")
        self.ai.speak("캡챠 해결 필요해요!")
        
        # 사용자가 수동으로 해결할 때까지 대기
        return await self.captcha_solver.wait_for_turnstile_complete(
            self.page, timeout=120.0
        )
    
    async def _login(self):
        """로그인"""
        self.log("로그인 시도...", "🔐")
        
        try:
            # 로그인 버튼 클릭 (이미 로그인 페이지면 스킵)
            if "login" not in self.page.url.lower():
                success = await self.clicker.click(
                    Selectors.LOGIN_BTN,
                    "로그인 버튼",
                    timeout=2000
                )
                if success:
                    await asyncio.sleep(1)
            
            # ID 입력
            await self.clicker.click(
                Selectors.LOGIN_ID,
                "아이디 입력 필드",
                timeout=3000
            )
            await self.page.keyboard.type(self.config.user_id, delay=50)
            
            # PW 입력
            await self.clicker.click(
                Selectors.LOGIN_PW,
                "비밀번호 입력 필드"
            )
            await self.page.keyboard.type(self.config.user_pw, delay=50)
            
            # 로그인 버튼 클릭
            await self.clicker.click(
                Selectors.LOGIN_SUBMIT,
                "로그인 제출 버튼"
            )
            
            await asyncio.sleep(2)
            
            # CAPTCHA 체크
            await self._handle_captcha()
            
            self.is_logged_in = True
            self.log("로그인 완료", "✅")
            
        except Exception as e:
            self.log(f"로그인 실패: {e}", "❌")
            raise
    
    async def _click_book_button(self):
        """예매 버튼 클릭"""
        self.log("예매 버튼 찾는 중...", "🎫")
        
        max_retries = 10
        for i in range(max_retries):
            # CAPTCHA 체크
            await self._handle_captcha()
            
            success = await self.clicker.click(
                Selectors.BOOK_BTN,
                "예매하기 버튼",
                timeout=500
            )
            
            if success:
                self.log("예매 버튼 클릭 완료", "✅")
                await asyncio.sleep(1)
                return
            
            # 새로고침 후 재시도
            if i < max_retries - 1:
                await self.page.reload()
                await asyncio.sleep(0.2)
        
        raise Exception("예매 버튼을 찾을 수 없음")
    
    async def _handle_queue(self):
        """대기열 처리"""
        try:
            queue_el = await self.page.query_selector(Selectors.QUEUE_STATUS)
            if queue_el:
                self.log("대기열 진입...", "⏳")
                
                # 대기열 통과까지 대기
                while True:
                    queue_el = await self.page.query_selector(Selectors.QUEUE_STATUS)
                    if not queue_el:
                        break
                    
                    # 대기 위치 표시
                    try:
                        position = await queue_el.text_content()
                        self.log(f"대기열: {position}", "⏳")
                    except Exception:
                        pass
                    
                    await asyncio.sleep(2)
                
                self.log("대기열 통과!", "✅")
        except Exception:
            pass
    
    async def _select_date_time(self):
        """날짜/회차 선택"""
        self.log("날짜 선택 중...", "📅")
        
        # 날짜 선택
        success = await self.clicker.click(
            Selectors.DATE_ITEM,
            "예매 가능한 날짜",
            timeout=2000
        )
        if not success:
            self.log("날짜 자동 선택 실패 - 수동 선택 대기", "⚠️")
            await asyncio.sleep(5)
        
        await asyncio.sleep(0.5)
        
        # 회차 선택
        self.log("회차 선택 중...", "🕐")
        success = await self.clicker.click(
            Selectors.TIME_ITEM,
            "예매 가능한 회차",
            timeout=2000
        )
        if not success:
            self.log("회차 자동 선택 실패 - 수동 선택 대기", "⚠️")
            await asyncio.sleep(5)
        
        self.log("날짜/회차 선택 완료", "✅")
    
    async def _select_seats(self):
        """좌석 선택"""
        self.log("좌석 선택 중...", "💺")
        
        # 구역 선택 (우선순위 순)
        if self.config.seat_priority:
            for section in self.config.seat_priority:
                try:
                    await self.page.click(f"text={section}", timeout=500)
                    self.log(f"구역 선택: {section}", "✅")
                    break
                except Exception:
                    continue
        
        await asyncio.sleep(0.5)
        
        # 가능한 좌석 클릭
        success = await self.clicker.click(
            Selectors.SEAT_AVAILABLE,
            "선택 가능한 좌석",
            timeout=3000
        )
        
        if not success:
            # 자동 배정 시도
            success = await self.clicker.click(
                "button:has-text('자동선택'), button:has-text('자동배정')",
                "자동 좌석 배정 버튼"
            )
        
        if not success:
            self.log("좌석 선택 실패 - 수동 선택 필요", "⚠️")
            self.ai.speak("좌석 직접 선택해주세요!")
            await asyncio.sleep(30)  # 수동 선택 대기
        
        await asyncio.sleep(0.5)
        
        # 선택 완료 버튼
        await self.clicker.click(
            Selectors.SEAT_CONFIRM,
            "좌석 선택 완료 버튼",
            timeout=5000
        )
        
        self.log("좌석 선택 완료", "✅")
    
    async def _proceed_payment(self) -> bool:
        """결제 페이지 진행"""
        self.log("결제 페이지...", "💳")
        
        await asyncio.sleep(1)
        
        # 전체 동의
        await self.clicker.click(
            Selectors.AGREE_ALL,
            "전체 동의 체크박스",
            ai_fallback=True
        )
        
        await asyncio.sleep(0.5)
        
        # 결제 버튼
        success = await self.clicker.click(
            Selectors.PAY_BTN,
            "결제하기 버튼"
        )
        
        if success:
            self.log("💳 결제 페이지 진입 성공! 이제 수동으로 결제 진행하세요.", "✅")
            self.ai.speak("티켓 잡았어요! 결제 진행해주세요!")
            return True
        else:
            return False
    
    # ============ 유틸리티 ============
    
    def _validate_config(self) -> bool:
        """설정 검증"""
        if not self.config.target_url:
            self.log("TICKET_URL 설정 필요!", "❌")
            return False
        if not self.config.user_id or not self.config.user_pw:
            self.log("TICKET_USER_ID, TICKET_USER_PW 설정 필요!", "❌")
            return False
        return True
    
    def _init_proxy_pool(self):
        """프록시 풀 초기화"""
        proxy_list = os.getenv("PROXY_LIST", "")
        if proxy_list:
            self.proxy_pool = init_proxy_pool(env_var="PROXY_LIST")
            self.log(f"프록시 풀 초기화: {len(self.proxy_pool)}개", "🌐")
    
    async def _wait_for_open_time(self):
        """티켓 오픈 시간까지 대기"""
        self.log(f"목표 시간: {self.config.start_hour:02d}:{self.config.start_minute:02d}", "⏰")
        
        await PreciseTimer.wait_until(
            self.config.start_hour,
            self.config.start_minute
        )


# ==================== 멀티 세션 러너 ====================

async def run_multi_session(config: TicketConfig) -> bool:
    """멀티 세션 실행"""
    if config.num_sessions == 1:
        bot = HybridTicketBot(config)
        return await bot.run()
    
    print(f"🚀 {config.num_sessions}개 세션 시작...")
    
    tasks = []
    for i in range(config.num_sessions):
        bot = HybridTicketBot(config)
        bot.session_id = i + 1
        
        # 세션 간 딜레이
        if i > 0:
            await asyncio.sleep(config.session_delay)
        
        tasks.append(bot.run())
    
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    # 하나라도 성공하면 성공
    success = any(r is True for r in results if not isinstance(r, Exception))
    return success


# ==================== CLI ====================

def main():
    parser = argparse.ArgumentParser(description="BTS 티켓팅 봇 (하이브리드 모드)")
    parser.add_argument("--url", type=str, help="티켓팅 URL")
    parser.add_argument("--wait", action="store_true", help="정시까지 대기")
    parser.add_argument("--hour", type=int, default=8, help="시작 시간 (시)")
    parser.add_argument("--minute", type=int, default=0, help="시작 시간 (분)")
    parser.add_argument("--sessions", type=int, default=1, help="세션 수")
    parser.add_argument("--headless", action="store_true", help="헤드리스 모드")
    parser.add_argument("--debug", action="store_true", help="디버그 모드")
    
    args = parser.parse_args()
    
    # 설정 로드
    config = TicketConfig.from_env()
    
    # CLI 인자로 오버라이드
    if args.url:
        config.target_url = args.url
    config.wait_for_time = args.wait
    config.start_hour = args.hour
    config.start_minute = args.minute
    config.num_sessions = args.sessions
    config.headless = args.headless
    config.debug = args.debug
    
    # 실행
    success = asyncio.run(run_multi_session(config))
    sys.exit(0 if success else 1)


if __name__ == "__main__":
    main()
