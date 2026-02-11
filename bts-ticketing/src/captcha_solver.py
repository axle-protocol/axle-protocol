#!/usr/bin/env python3
"""
CAPTCHA 솔버 모듈 - Cloudflare Turnstile 우회

지원 서비스:
- 2captcha (권장)
- CapSolver
- 수동 폴백

사용법:
    solver = TurnstileSolver(api_key="YOUR_2CAPTCHA_KEY")
    token = await solver.solve(page, sitekey, page_url)
    await solver.inject_token(page, token)
"""

import asyncio
import os
import re
import time
from dataclasses import dataclass
from typing import Optional, Callable, Awaitable
from enum import Enum
import aiohttp


class SolverService(Enum):
    """CAPTCHA 솔버 서비스"""
    TWOCAPTCHA = "2captcha"
    CAPSOLVER = "capsolver"
    MANUAL = "manual"


@dataclass
class CaptchaResult:
    """CAPTCHA 솔루션 결과"""
    success: bool
    token: Optional[str] = None
    error: Optional[str] = None
    solve_time: float = 0.0
    service: Optional[str] = None


class TurnstileSolver:
    """Cloudflare Turnstile CAPTCHA 솔버
    
    2captcha API 문서: https://2captcha.com/api-docs/cloudflare-turnstile
    """
    
    # 2captcha 엔드포인트
    TWOCAPTCHA_IN = "https://2captcha.com/in.php"
    TWOCAPTCHA_RES = "https://2captcha.com/res.php"
    
    # CapSolver 엔드포인트
    CAPSOLVER_CREATE = "https://api.capsolver.com/createTask"
    CAPSOLVER_RESULT = "https://api.capsolver.com/getTaskResult"
    
    def __init__(
        self,
        api_key: str = None,
        service: SolverService = SolverService.TWOCAPTCHA,
        timeout: float = 120.0,
        poll_interval: float = 5.0,
        on_manual_required: Callable[[], Awaitable[bool]] = None
    ):
        """
        Args:
            api_key: 2captcha 또는 CapSolver API 키
            service: 사용할 솔버 서비스
            timeout: 최대 대기 시간 (초)
            poll_interval: 결과 확인 간격 (초)
            on_manual_required: 수동 해결 필요 시 콜백 (True 반환하면 완료 대기)
        """
        self.api_key = api_key or os.getenv("TWOCAPTCHA_API_KEY") or os.getenv("CAPSOLVER_API_KEY")
        self.service = service
        self.timeout = timeout
        self.poll_interval = poll_interval
        self.on_manual_required = on_manual_required
        
        self._session: Optional[aiohttp.ClientSession] = None
    
    async def _get_session(self) -> aiohttp.ClientSession:
        """HTTP 세션 가져오기"""
        if self._session is None or self._session.closed:
            self._session = aiohttp.ClientSession(
                timeout=aiohttp.ClientTimeout(total=30)
            )
        return self._session
    
    async def close(self):
        """리소스 정리"""
        if self._session and not self._session.closed:
            await self._session.close()
    
    # ============ 메인 API ============
    
    async def solve(
        self,
        page,
        sitekey: str = None,
        page_url: str = None,
        action: str = None,
        cdata: str = None
    ) -> CaptchaResult:
        """Turnstile CAPTCHA 해결
        
        Args:
            page: Playwright/Camoufox 페이지 객체
            sitekey: Turnstile sitekey (None이면 자동 추출)
            page_url: 페이지 URL (None이면 자동)
            action: Turnstile action 파라미터
            cdata: Turnstile cData 파라미터
            
        Returns:
            CaptchaResult
        """
        start_time = time.time()
        
        # sitekey 자동 추출
        if not sitekey:
            sitekey = await self._extract_sitekey(page)
            if not sitekey:
                return CaptchaResult(
                    success=False,
                    error="sitekey를 찾을 수 없음"
                )
        
        # URL 자동 추출
        if not page_url:
            page_url = page.url
        
        print(f"🔐 Turnstile 감지: sitekey={sitekey[:20]}...")
        
        # API 키가 있으면 자동 솔버 시도
        if self.api_key and self.service != SolverService.MANUAL:
            if self.service == SolverService.TWOCAPTCHA:
                result = await self._solve_2captcha(sitekey, page_url, action, cdata)
            else:
                result = await self._solve_capsolver(sitekey, page_url, action, cdata)
            
            if result.success:
                result.solve_time = time.time() - start_time
                return result
            
            print(f"⚠️ 자동 솔버 실패: {result.error}")
        
        # 수동 폴백
        if self.on_manual_required:
            print("🖐️ 수동 CAPTCHA 해결 요청...")
            manual_success = await self.on_manual_required()
            
            if manual_success:
                # 수동 해결 후 token 추출 시도
                token = await self._extract_token(page)
                return CaptchaResult(
                    success=token is not None,
                    token=token,
                    solve_time=time.time() - start_time,
                    service="manual"
                )
        
        return CaptchaResult(
            success=False,
            error="CAPTCHA 해결 실패",
            solve_time=time.time() - start_time
        )
    
    async def inject_token(self, page, token: str) -> bool:
        """해결된 token을 페이지에 주입
        
        Args:
            page: 페이지 객체
            token: Turnstile 응답 token
            
        Returns:
            성공 여부
        """
        try:
            # cf-turnstile-response 또는 g-recaptcha-response에 주입
            script = f'''
            (() => {{
                // Turnstile 응답 필드
                const fields = [
                    'cf-turnstile-response',
                    'g-recaptcha-response',
                    'h-captcha-response'
                ];
                
                for (const name of fields) {{
                    const el = document.querySelector(`[name="${{name}}"]`) ||
                               document.querySelector(`#${{name}}`);
                    if (el) {{
                        el.value = "{token}";
                        console.log('Token injected to', name);
                    }}
                }}
                
                // 숨겨진 input에도 시도
                const hiddenInputs = document.querySelectorAll('input[type="hidden"]');
                for (const input of hiddenInputs) {{
                    if (input.name.includes('turnstile') || 
                        input.name.includes('captcha') ||
                        input.id.includes('turnstile')) {{
                        input.value = "{token}";
                        console.log('Token injected to hidden input', input.name);
                    }}
                }}
                
                // Turnstile 콜백 호출 시도
                if (window.turnstileCallback) {{
                    window.turnstileCallback("{token}");
                }}
                
                return true;
            }})();
            '''
            
            await page.evaluate(script)
            print(f"✅ Token 주입 완료")
            return True
            
        except Exception as e:
            print(f"❌ Token 주입 실패: {e}")
            return False
    
    # ============ sitekey 추출 ============
    
    async def _extract_sitekey(self, page) -> Optional[str]:
        """페이지에서 Turnstile sitekey 추출"""
        try:
            # 방법 1: data-sitekey 속성
            sitekey = await page.evaluate('''
            (() => {
                // Turnstile 위젯
                const widget = document.querySelector('[data-sitekey]');
                if (widget) return widget.getAttribute('data-sitekey');
                
                // iframe src에서 추출
                const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
                if (iframe) {
                    const match = iframe.src.match(/sitekey=([^&]+)/);
                    if (match) return match[1];
                }
                
                // 스크립트에서 추출
                const scripts = document.querySelectorAll('script');
                for (const script of scripts) {
                    const match = script.textContent.match(/sitekey['":\\s]+['"]([0-9x-]+)['"]/i);
                    if (match) return match[1];
                }
                
                return null;
            })();
            ''')
            
            if sitekey:
                return sitekey
            
            # 방법 2: 페이지 소스에서 정규식
            content = await page.content()
            patterns = [
                r'data-sitekey=["\']([0-9x-]+)["\']',
                r'sitekey["\s:=]+["\']([0-9x-]+)["\']',
                r'cf-turnstile.*?data-sitekey=["\']([0-9x-]+)["\']',
            ]
            
            for pattern in patterns:
                match = re.search(pattern, content, re.IGNORECASE)
                if match:
                    return match.group(1)
            
            return None
            
        except Exception as e:
            print(f"sitekey 추출 오류: {e}")
            return None
    
    async def _extract_token(self, page) -> Optional[str]:
        """페이지에서 완료된 token 추출"""
        try:
            token = await page.evaluate('''
            (() => {
                const fields = ['cf-turnstile-response', 'g-recaptcha-response'];
                for (const name of fields) {
                    const el = document.querySelector(`[name="${name}"]`);
                    if (el && el.value) return el.value;
                }
                return null;
            })();
            ''')
            return token
        except Exception:
            return None
    
    # ============ 2captcha 연동 ============
    
    async def _solve_2captcha(
        self,
        sitekey: str,
        page_url: str,
        action: str = None,
        cdata: str = None
    ) -> CaptchaResult:
        """2captcha로 Turnstile 해결"""
        try:
            session = await self._get_session()
            
            # Step 1: 작업 제출
            params = {
                "key": self.api_key,
                "method": "turnstile",
                "sitekey": sitekey,
                "pageurl": page_url,
                "json": 1
            }
            
            if action:
                params["action"] = action
            if cdata:
                params["data"] = cdata
            
            async with session.post(self.TWOCAPTCHA_IN, data=params) as resp:
                result = await resp.json()
                
                if result.get("status") != 1:
                    return CaptchaResult(
                        success=False,
                        error=f"2captcha 제출 실패: {result.get('request')}",
                        service="2captcha"
                    )
                
                request_id = result.get("request")
                print(f"📤 2captcha 작업 제출: {request_id}")
            
            # Step 2: 결과 폴링
            start = time.time()
            
            while time.time() - start < self.timeout:
                await asyncio.sleep(self.poll_interval)
                
                params = {
                    "key": self.api_key,
                    "action": "get",
                    "id": request_id,
                    "json": 1
                }
                
                async with session.get(self.TWOCAPTCHA_RES, params=params) as resp:
                    result = await resp.json()
                    
                    if result.get("status") == 1:
                        token = result.get("request")
                        print(f"✅ 2captcha 해결 완료")
                        return CaptchaResult(
                            success=True,
                            token=token,
                            service="2captcha"
                        )
                    
                    error = result.get("request", "")
                    if error not in ("CAPCHA_NOT_READY", "CAPTCHA_NOT_READY"):
                        return CaptchaResult(
                            success=False,
                            error=f"2captcha 오류: {error}",
                            service="2captcha"
                        )
                
                print(f"⏳ 2captcha 대기 중... ({int(time.time() - start)}s)")
            
            return CaptchaResult(
                success=False,
                error="2captcha 타임아웃",
                service="2captcha"
            )
            
        except Exception as e:
            return CaptchaResult(
                success=False,
                error=f"2captcha 오류: {e}",
                service="2captcha"
            )
    
    # ============ CapSolver 연동 ============
    
    async def _solve_capsolver(
        self,
        sitekey: str,
        page_url: str,
        action: str = None,
        cdata: str = None
    ) -> CaptchaResult:
        """CapSolver로 Turnstile 해결"""
        try:
            session = await self._get_session()
            
            # Step 1: 작업 생성
            task_data = {
                "clientKey": self.api_key,
                "task": {
                    "type": "AntiTurnstileTaskProxyLess",
                    "websiteURL": page_url,
                    "websiteKey": sitekey,
                }
            }
            
            if action:
                task_data["task"]["action"] = action
            if cdata:
                task_data["task"]["cdata"] = cdata
            
            async with session.post(
                self.CAPSOLVER_CREATE,
                json=task_data
            ) as resp:
                result = await resp.json()
                
                if result.get("errorId") != 0:
                    return CaptchaResult(
                        success=False,
                        error=f"CapSolver 오류: {result.get('errorDescription')}",
                        service="capsolver"
                    )
                
                task_id = result.get("taskId")
                print(f"📤 CapSolver 작업 제출: {task_id}")
            
            # Step 2: 결과 폴링
            start = time.time()
            
            while time.time() - start < self.timeout:
                await asyncio.sleep(self.poll_interval)
                
                async with session.post(
                    self.CAPSOLVER_RESULT,
                    json={"clientKey": self.api_key, "taskId": task_id}
                ) as resp:
                    result = await resp.json()
                    
                    if result.get("status") == "ready":
                        token = result.get("solution", {}).get("token")
                        print(f"✅ CapSolver 해결 완료")
                        return CaptchaResult(
                            success=True,
                            token=token,
                            service="capsolver"
                        )
                    
                    if result.get("errorId") != 0:
                        return CaptchaResult(
                            success=False,
                            error=f"CapSolver 오류: {result.get('errorDescription')}",
                            service="capsolver"
                        )
                
                print(f"⏳ CapSolver 대기 중... ({int(time.time() - start)}s)")
            
            return CaptchaResult(
                success=False,
                error="CapSolver 타임아웃",
                service="capsolver"
            )
            
        except Exception as e:
            return CaptchaResult(
                success=False,
                error=f"CapSolver 오류: {e}",
                service="capsolver"
            )
    
    # ============ Turnstile 감지 ============
    
    async def detect_turnstile(self, page) -> bool:
        """페이지에서 Turnstile CAPTCHA 존재 확인"""
        try:
            has_turnstile = await page.evaluate('''
            (() => {
                // Turnstile 위젯
                if (document.querySelector('.cf-turnstile')) return true;
                if (document.querySelector('[data-sitekey]')) return true;
                
                // Cloudflare iframe
                if (document.querySelector('iframe[src*="challenges.cloudflare.com"]')) return true;
                
                // Turnstile 스크립트
                const scripts = document.querySelectorAll('script[src*="turnstile"]');
                if (scripts.length > 0) return true;
                
                // Cloudflare challenge
                if (document.querySelector('#challenge-running')) return true;
                if (document.querySelector('#challenge-form')) return true;
                
                return false;
            })();
            ''')
            return has_turnstile
        except Exception:
            return False
    
    async def wait_for_turnstile_complete(
        self,
        page,
        timeout: float = 30.0
    ) -> bool:
        """Turnstile 완료 대기 (사용자 수동 해결 시)"""
        start = time.time()
        
        while time.time() - start < timeout:
            # 토큰 존재 확인
            token = await self._extract_token(page)
            if token:
                print("✅ Turnstile 완료 감지")
                return True
            
            # challenge 사라짐 확인
            challenge_gone = await page.evaluate('''
            (() => {
                const challenge = document.querySelector('#challenge-running');
                return !challenge || challenge.style.display === 'none';
            })();
            ''')
            
            if challenge_gone:
                await asyncio.sleep(0.5)
                token = await self._extract_token(page)
                if token:
                    return True
            
            await asyncio.sleep(0.5)
        
        return False


# ============ 간편 함수 ============

_default_solver: Optional[TurnstileSolver] = None


def get_solver() -> TurnstileSolver:
    """기본 솔버 인스턴스 가져오기"""
    global _default_solver
    if _default_solver is None:
        _default_solver = TurnstileSolver()
    return _default_solver


async def solve_turnstile(page, **kwargs) -> CaptchaResult:
    """Turnstile 해결 (간편 함수)"""
    solver = get_solver()
    return await solver.solve(page, **kwargs)


async def detect_and_solve(page, **kwargs) -> Optional[str]:
    """Turnstile 감지 및 해결 (간편 함수)
    
    Returns:
        해결된 token 또는 None (CAPTCHA 없거나 실패)
    """
    solver = get_solver()
    
    if not await solver.detect_turnstile(page):
        return None  # CAPTCHA 없음
    
    result = await solver.solve(page, **kwargs)
    
    if result.success and result.token:
        await solver.inject_token(page, result.token)
        return result.token
    
    return None


# ============ 테스트 ============

if __name__ == "__main__":
    async def test():
        # 테스트 URL (2captcha 데모)
        test_url = "https://2captcha.com/demo/cloudflare-turnstile"
        
        solver = TurnstileSolver(
            api_key=os.getenv("TWOCAPTCHA_API_KEY"),
            timeout=120.0
        )
        
        print(f"API Key: {'설정됨' if solver.api_key else '없음'}")
        
        # 실제 테스트는 브라우저 필요
        print("브라우저 테스트는 main_hybrid.py에서 진행")
    
    asyncio.run(test())
