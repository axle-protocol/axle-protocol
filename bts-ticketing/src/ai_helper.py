"""
AI Helper for BTS Ticketing
- OpenClaw/Claude API 연동
- 화면 분석 및 요소 찾기
- 예외 처리 및 복구
- TTS 음성 알림
"""

import asyncio
import base64
import os
import subprocess
from datetime import datetime, timedelta
from typing import Optional, Tuple, Dict, Any
import json


class AIHelper:
    """AI 기반 티켓팅 보조 시스템"""
    
    def __init__(self, debug: bool = False):
        self.debug = debug
        self.last_screenshot: Optional[bytes] = None
        self.analysis_cache: Dict[str, Any] = {}
        
    def log(self, message: str):
        """디버그 로깅"""
        if self.debug:
            timestamp = datetime.now().strftime("%H:%M:%S.%f")[:-3]
            print(f"[AI {timestamp}] {message}")
    
    # ==================== AI 화면 분석 ====================
    
    async def ai_find_element(
        self, 
        page, 
        description: str,
        return_type: str = "selector"  # "selector" | "coordinates"
    ) -> Optional[str]:
        """
        화면 스크린샷 찍고 AI에게 요소 위치 물어봄
        
        Args:
            page: Playwright 페이지 객체
            description: 찾고 싶은 요소 설명 (예: "좌석 선택 버튼", "결제하기 버튼")
            return_type: 반환 타입 - "selector" (CSS 셀렉터) 또는 "coordinates" (x, y 좌표)
            
        Returns:
            셀렉터 문자열 또는 "x,y" 좌표 문자열
        """
        try:
            # 스크린샷 캡처
            screenshot = await page.screenshot(type="png")
            self.last_screenshot = screenshot
            screenshot_b64 = base64.b64encode(screenshot).decode('utf-8')
            
            # AI 프롬프트 구성
            prompt = self._build_find_element_prompt(description, return_type)
            
            # OpenClaw API 호출 (Claude)
            result = await self._call_openclaw_vision(screenshot_b64, prompt)
            
            if result:
                self.log(f"AI 발견: {description} -> {result}")
                return result
            else:
                self.log(f"AI 찾기 실패: {description}")
                return None
                
        except Exception as e:
            self.log(f"AI 분석 에러: {e}")
            return None
    
    def _build_find_element_prompt(self, description: str, return_type: str) -> str:
        """AI 프롬프트 생성"""
        if return_type == "coordinates":
            return f"""웹페이지 스크린샷에서 다음 요소를 찾아주세요: "{description}"

요소의 중앙 좌표를 "x,y" 형식으로만 반환하세요.
예: 450,320

요소를 찾을 수 없으면 "NOT_FOUND"를 반환하세요."""
        else:
            return f"""웹페이지 스크린샷에서 다음 요소를 찾아주세요: "{description}"

해당 요소를 선택할 수 있는 CSS 셀렉터를 반환하세요.
가능한 구체적인 셀렉터를 사용하세요 (id > class > tag).
예: #btn-purchase, .seat-select-btn, button[data-action="buy"]

요소를 찾을 수 없으면 "NOT_FOUND"를 반환하세요."""

    async def _call_openclaw_vision(self, image_b64: str, prompt: str) -> Optional[str]:
        """OpenClaw API 호출 (비전 모델)"""
        try:
            # OpenClaw CLI 사용 (subprocess)
            # 실제로는 OpenClaw의 Python SDK나 HTTP API 사용 권장
            
            # 임시 이미지 파일 저장
            import tempfile
            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as f:
                f.write(base64.b64decode(image_b64))
                temp_path = f.name
            
            try:
                # OpenClaw CLI 호출 예시
                # 실제 구현시 적절한 API 엔드포인트 사용
                result = await self._call_claude_api(temp_path, prompt)
                return result
            finally:
                os.unlink(temp_path)
                
        except Exception as e:
            self.log(f"OpenClaw API 에러: {e}")
            return None
    
    async def _call_claude_api(self, image_path: str, prompt: str) -> Optional[str]:
        """Claude API 직접 호출 (Anthropic SDK 사용)"""
        try:
            import anthropic
            
            client = anthropic.Anthropic()  # ANTHROPIC_API_KEY 환경변수 사용
            
            with open(image_path, "rb") as f:
                image_data = base64.standard_b64encode(f.read()).decode("utf-8")
            
            message = client.messages.create(
                model="claude-sonnet-4-20250514",
                max_tokens=256,
                messages=[{
                    "role": "user",
                    "content": [
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": image_data,
                            },
                        },
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ],
                }],
            )
            
            result = message.content[0].text.strip()
            return result if result != "NOT_FOUND" else None
            
        except ImportError:
            self.log("anthropic 패키지 필요: pip install anthropic")
            return None
        except Exception as e:
            self.log(f"Claude API 에러: {e}")
            return None

    # ==================== 예외 처리 ====================
    
    async def handle_unexpected_popup(self, page) -> bool:
        """
        예상 못한 팝업 감지 및 닫기
        
        Returns:
            팝업을 닫았으면 True
        """
        try:
            screenshot = await page.screenshot(type="png")
            screenshot_b64 = base64.b64encode(screenshot).decode('utf-8')
            
            prompt = """웹페이지 스크린샷을 분석해주세요.

팝업, 모달, 알림창이 보이면:
1. 팝업의 종류 (광고/경고/확인창/로그인요청 등)
2. 닫기 버튼의 CSS 셀렉터

JSON 형식으로 반환:
{"has_popup": true, "type": "광고", "close_selector": ".popup-close"}

팝업이 없으면:
{"has_popup": false}"""

            result = await self._call_openclaw_vision(screenshot_b64, prompt)
            
            if result:
                try:
                    data = json.loads(result)
                    if data.get("has_popup") and data.get("close_selector"):
                        self.log(f"팝업 감지: {data.get('type')} - 닫기 시도")
                        await page.click(data["close_selector"], timeout=2000)
                        return True
                except json.JSONDecodeError:
                    pass
                    
            return False
            
        except Exception as e:
            self.log(f"팝업 처리 에러: {e}")
            return False
    
    async def find_new_selector(
        self, 
        page, 
        element_description: str,
        old_selector: str
    ) -> Optional[str]:
        """
        UI 변경시 새로운 셀렉터 찾기
        
        Args:
            page: Playwright 페이지
            element_description: 요소 설명
            old_selector: 작동하지 않는 기존 셀렉터
            
        Returns:
            새로운 CSS 셀렉터
        """
        prompt_addition = f"""
참고: 기존에 "{old_selector}" 셀렉터를 사용했으나 현재 작동하지 않습니다.
UI가 변경되었을 수 있으니 현재 화면에서 올바른 셀렉터를 찾아주세요."""
        
        # 기본 find_element에 추가 컨텍스트 제공
        result = await self.ai_find_element(page, element_description + prompt_addition)
        return result
    
    async def analyze_error(self, page, error: Exception) -> Dict[str, Any]:
        """
        에러 발생시 AI가 원인 분석
        
        Returns:
            {"cause": "원인 설명", "suggestion": "해결 방안", "retry": True/False}
        """
        try:
            screenshot = await page.screenshot(type="png")
            screenshot_b64 = base64.b64encode(screenshot).decode('utf-8')
            
            prompt = f"""티켓팅 중 에러가 발생했습니다.
            
에러 메시지: {str(error)}

현재 화면을 분석하고 다음을 JSON으로 반환해주세요:
{{
    "cause": "에러 원인 분석",
    "suggestion": "해결 방안",
    "retry": true/false (재시도 가능 여부),
    "wait_seconds": 0 (재시도 전 대기 시간)
}}"""

            result = await self._call_openclaw_vision(screenshot_b64, prompt)
            
            if result:
                try:
                    return json.loads(result)
                except json.JSONDecodeError:
                    pass
                    
            return {
                "cause": "AI 분석 실패",
                "suggestion": "수동 확인 필요",
                "retry": True,
                "wait_seconds": 1
            }
            
        except Exception as e:
            self.log(f"에러 분석 실패: {e}")
            return {
                "cause": str(e),
                "suggestion": "재시도",
                "retry": True,
                "wait_seconds": 1
            }

    # ==================== TTS 음성 알림 ====================
    
    def speak(self, message: str, blocking: bool = False):
        """
        TTS 음성 알림
        
        Args:
            message: 읽을 메시지
            blocking: True면 완료까지 대기
        """
        try:
            # macOS say 명령 사용 (빠름)
            if os.name == 'posix' and os.uname().sysname == 'Darwin':
                cmd = ["say", "-v", "Yuna", message]  # 한국어 음성
                if blocking:
                    subprocess.run(cmd)
                else:
                    subprocess.Popen(cmd)
                return
            
            # Windows SAPI
            elif os.name == 'nt':
                import win32com.client
                speaker = win32com.client.Dispatch("SAPI.SpVoice")
                speaker.Speak(message)
                return
                
            # 폴백: OpenClaw TTS
            self._openclaw_tts(message)
            
        except Exception as e:
            self.log(f"TTS 에러: {e}")
            print(f"🔊 {message}")  # 텍스트 폴백
    
    def _openclaw_tts(self, message: str):
        """OpenClaw TTS API 사용"""
        try:
            # OpenClaw CLI TTS 호출
            subprocess.Popen([
                "openclaw", "tts", "--text", message
            ])
        except Exception as e:
            self.log(f"OpenClaw TTS 에러: {e}")
    
    def announce_success(self):
        """티켓팅 성공 알림"""
        self.speak("티켓 잡았어!", blocking=False)
    
    def announce_failure(self, retry: bool = True):
        """티켓팅 실패 알림"""
        if retry:
            self.speak("실패했어, 다시 시도해", blocking=False)
        else:
            self.speak("티켓팅 실패. 매진된 것 같아", blocking=False)


# ==================== 정시 시작 유틸리티 ====================

class PreciseTimer:
    """밀리초 단위 정시 시작 타이머"""
    
    @staticmethod
    async def wait_until(target_hour: int, target_minute: int = 0, target_second: int = 0):
        """
        지정된 시간까지 대기 (밀리초 단위 정확도)
        
        Args:
            target_hour: 목표 시 (0-23)
            target_minute: 목표 분 (0-59)
            target_second: 목표 초 (0-59)
        """
        now = datetime.now()
        target = now.replace(
            hour=target_hour,
            minute=target_minute,
            second=target_second,
            microsecond=0
        )
        
        # 이미 지난 시간이면 다음 날
        if target <= now:
            target += timedelta(days=1)
        
        wait_seconds = (target - now).total_seconds()
        
        print(f"⏰ 목표 시간: {target.strftime('%Y-%m-%d %H:%M:%S')}")
        print(f"⏳ 대기 시간: {wait_seconds:.1f}초")
        
        # 대기 시간이 10초 이상이면 큰 단위로 먼저 대기
        if wait_seconds > 10:
            # 5초 전까지 sleep
            await asyncio.sleep(wait_seconds - 5)
        
        # 마지막 5초는 busy-wait로 정확도 확보
        while True:
            now = datetime.now()
            remaining = (target - now).total_seconds()
            
            if remaining <= 0:
                break
            elif remaining > 0.1:
                await asyncio.sleep(0.05)
            elif remaining > 0.01:
                await asyncio.sleep(0.001)
            # 마지막 10ms는 busy-wait
        
        print(f"🚀 시작! (실제 시간: {datetime.now().strftime('%H:%M:%S.%f')[:-3]})")
    
    @staticmethod
    async def sync_to_ntp() -> float:
        """
        NTP 서버와 시간 동기화하여 오프셋 반환
        
        Returns:
            로컬 시간과 NTP 시간의 차이 (초)
        """
        try:
            import ntplib
            client = ntplib.NTPClient()
            response = client.request('pool.ntp.org', version=3)
            offset = response.offset
            print(f"⏱️ NTP 오프셋: {offset*1000:.1f}ms")
            return offset
        except ImportError:
            print("⚠️ ntplib 패키지 필요: pip install ntplib")
            return 0.0
        except Exception as e:
            print(f"⚠️ NTP 동기화 실패: {e}")
            return 0.0


# ==================== 하이브리드 클릭 ====================

class HybridClicker:
    """하드코딩 셀렉터 + AI 폴백 하이브리드 클릭"""
    
    def __init__(self, ai_helper: AIHelper, page):
        self.ai = ai_helper
        self.page = page
        self.selector_cache: Dict[str, str] = {}
    
    async def click(
        self, 
        selector: str, 
        description: str,
        timeout: int = 100,  # 기본 100ms (빠른 실패)
        ai_fallback: bool = True
    ) -> bool:
        """
        하이브리드 클릭: 빠른 셀렉터 시도 후 실패시 AI 폴백
        
        Args:
            selector: 하드코딩된 CSS 셀렉터
            description: AI용 요소 설명
            timeout: 셀렉터 대기 시간 (ms)
            ai_fallback: 실패시 AI 폴백 사용 여부
            
        Returns:
            클릭 성공 여부
        """
        start = datetime.now()
        
        # 1단계: 하드코딩 셀렉터 시도 (매우 빠름)
        try:
            await self.page.click(selector, timeout=timeout)
            elapsed = (datetime.now() - start).total_seconds() * 1000
            self.ai.log(f"✅ 빠른 클릭 성공: {selector} ({elapsed:.1f}ms)")
            return True
        except Exception as e:
            self.ai.log(f"⚠️ 셀렉터 실패: {selector}")
        
        # 2단계: 캐시된 대체 셀렉터 시도
        if description in self.selector_cache:
            cached = self.selector_cache[description]
            try:
                await self.page.click(cached, timeout=100)
                self.ai.log(f"✅ 캐시 셀렉터 성공: {cached}")
                return True
            except Exception as e:
                self.ai.log(f"⚠️ 캐시 셀렉터 실패 ({cached}): {e}")
        
        # 3단계: AI 폴백
        if ai_fallback:
            self.ai.log(f"🤖 AI 폴백 시작: {description}")
            
            # 먼저 팝업 확인
            await self.ai.handle_unexpected_popup(self.page)
            
            # AI로 새 셀렉터 찾기
            new_selector = await self.ai.find_new_selector(
                self.page, 
                description, 
                selector
            )
            
            if new_selector:
                try:
                    await self.page.click(new_selector, timeout=2000)
                    self.selector_cache[description] = new_selector
                    elapsed = (datetime.now() - start).total_seconds() * 1000
                    self.ai.log(f"✅ AI 폴백 성공: {new_selector} ({elapsed:.1f}ms)")
                    return True
                except Exception as e:
                    self.ai.log(f"❌ AI 셀렉터도 실패: {new_selector}")
            
            # 좌표로 시도
            coords = await self.ai.ai_find_element(
                self.page, 
                description, 
                return_type="coordinates"
            )
            if coords and "," in coords:
                try:
                    x, y = map(int, coords.split(","))
                    await self.page.mouse.click(x, y)
                    elapsed = (datetime.now() - start).total_seconds() * 1000
                    self.ai.log(f"✅ 좌표 클릭 성공: ({x}, {y}) ({elapsed:.1f}ms)")
                    return True
                except Exception as e:
                    self.ai.log(f"❌ 좌표 클릭 실패: {coords}")
        
        elapsed = (datetime.now() - start).total_seconds() * 1000
        self.ai.log(f"❌ 클릭 완전 실패: {description} ({elapsed:.1f}ms)")
        return False


# ==================== 메인 export ====================

__all__ = [
    'AIHelper',
    'PreciseTimer',
    'HybridClicker',
]
