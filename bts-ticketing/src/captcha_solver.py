#!/usr/bin/env python3
"""
캡챠 솔버 모듈 - BTS 티켓팅
2captcha, Anti-Captcha, 수동 대기 지원

기능:
- Turnstile (Cloudflare) 솔버
- reCAPTCHA v2/v3 솔버
- hCaptcha 솔버
- 솔버 실패 시 수동 대기
- 솔버 간 자동 전환
"""

import os
import time
import base64
import threading
from typing import Optional, Dict, Any, Callable
from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum

try:
    from utils import log, Timing, adaptive_sleep, get_shared_state
except ImportError:
    def log(msg): print(f'[{datetime.now().strftime("%H:%M:%S")}] {msg}')
    class Timing:
        MEDIUM = 0.5
        LONG = 1.0
    adaptive_sleep = time.sleep
    def get_shared_state(): return {}


class CaptchaType(Enum):
    """캡챠 타입"""
    TURNSTILE = "turnstile"       # Cloudflare Turnstile
    RECAPTCHA_V2 = "recaptcha_v2"
    RECAPTCHA_V3 = "recaptcha_v3"
    HCAPTCHA = "hcaptcha"
    IMAGE = "image"               # 이미지 캡챠
    UNKNOWN = "unknown"


@dataclass
class CaptchaConfig:
    """캡챠 솔버 설정"""
    # 2captcha
    two_captcha_key: str = field(default_factory=lambda: os.getenv('TWO_CAPTCHA_KEY', ''))
    
    # Anti-Captcha
    anti_captcha_key: str = field(default_factory=lambda: os.getenv('ANTI_CAPTCHA_KEY', ''))
    
    # CapMonster
    capmonster_key: str = field(default_factory=lambda: os.getenv('CAPMONSTER_KEY', ''))
    
    # 타임아웃
    solve_timeout: int = 120      # 솔버 타임아웃 (초)
    poll_interval: float = 5.0    # 폴링 간격
    
    # 수동 대기
    manual_wait_timeout: int = 180  # 수동 캡챠 대기 시간
    
    # 자동 전환
    auto_fallback: bool = True    # 솔버 실패 시 다음 솔버로
    
    # SeleniumBase UC 사용
    use_uc_handler: bool = True   # SeleniumBase 내장 핸들러 사용


class CaptchaSolver:
    """캡챠 솔버 - 다중 서비스 지원"""
    
    # Turnstile 셀렉터
    TURNSTILE_SELECTORS = [
        'iframe[src*="challenges.cloudflare.com"]',
        '[class*="cf-turnstile"]',
        '#cf-turnstile',
        '[data-sitekey]',
    ]
    
    # reCAPTCHA 셀렉터
    RECAPTCHA_SELECTORS = [
        'iframe[src*="google.com/recaptcha"]',
        '[class*="g-recaptcha"]',
        '#g-recaptcha',
        '[data-sitekey]',
    ]
    
    # hCaptcha 셀렉터
    HCAPTCHA_SELECTORS = [
        'iframe[src*="hcaptcha.com"]',
        '[class*="h-captcha"]',
        '[data-sitekey]',
    ]
    
    def __init__(self, sb, config: Optional[CaptchaConfig] = None):
        """
        Args:
            sb: SeleniumBase 인스턴스
            config: 캡챠 설정
        """
        self.sb = sb
        self.config = config or CaptchaConfig()
        self._lock = threading.Lock()
        self._solve_count = 0
        self._fail_count = 0
    
    def detect_captcha(self) -> Optional[CaptchaType]:
        """현재 페이지의 캡챠 타입 감지"""
        try:
            # Turnstile (Cloudflare)
            for sel in self.TURNSTILE_SELECTORS:
                try:
                    if self.sb.is_element_visible(sel):
                        log('🔒 Turnstile 캡챠 감지')
                        return CaptchaType.TURNSTILE
                except:
                    pass
            
            # reCAPTCHA
            for sel in self.RECAPTCHA_SELECTORS:
                try:
                    if self.sb.is_element_visible(sel):
                        # v2 vs v3 구분
                        if self.sb.is_element_visible('.g-recaptcha'):
                            log('🔒 reCAPTCHA v2 감지')
                            return CaptchaType.RECAPTCHA_V2
                        log('🔒 reCAPTCHA v3 감지')
                        return CaptchaType.RECAPTCHA_V3
                except:
                    pass
            
            # hCaptcha
            for sel in self.HCAPTCHA_SELECTORS:
                try:
                    if self.sb.is_element_visible(sel):
                        log('🔒 hCaptcha 감지')
                        return CaptchaType.HCAPTCHA
                except:
                    pass
            
            return None
            
        except Exception as e:
            log(f'⚠️ 캡챠 감지 실패: {e}')
            return CaptchaType.UNKNOWN
    
    def solve(self, captcha_type: Optional[CaptchaType] = None) -> bool:
        """
        캡챠 해결
        
        Args:
            captcha_type: 캡챠 타입 (None이면 자동 감지)
        
        Returns:
            성공 여부
        """
        if captcha_type is None:
            captcha_type = self.detect_captcha()
        
        if captcha_type is None:
            log('✅ 캡챠 없음')
            return True
        
        log(f'🔓 캡챠 해결 시작: {captcha_type.value}')
        
        # 1. SeleniumBase UC 내장 핸들러 (가장 빠름)
        if self.config.use_uc_handler:
            if self._solve_with_uc_handler(captcha_type):
                self._solve_count += 1
                return True
        
        # 2. 2captcha API
        if self.config.two_captcha_key:
            if self._solve_with_2captcha(captcha_type):
                self._solve_count += 1
                return True
        
        # 3. Anti-Captcha API
        if self.config.anti_captcha_key:
            if self._solve_with_anti_captcha(captcha_type):
                self._solve_count += 1
                return True
        
        # 4. CapMonster API
        if self.config.capmonster_key:
            if self._solve_with_capmonster(captcha_type):
                self._solve_count += 1
                return True
        
        # 5. 수동 대기 (최후 수단)
        log(f'⚠️ 자동 솔버 실패, 수동 대기 ({self.config.manual_wait_timeout}초)...')
        if self._wait_for_manual_solve():
            self._solve_count += 1
            return True
        
        self._fail_count += 1
        log('❌ 캡챠 해결 실패')
        return False
    
    def _solve_with_uc_handler(self, captcha_type: CaptchaType) -> bool:
        """SeleniumBase UC 내장 핸들러"""
        try:
            if captcha_type == CaptchaType.TURNSTILE:
                log('🔧 SeleniumBase UC Turnstile 핸들러...')
                self.sb.uc_gui_handle_captcha()
                adaptive_sleep(Timing.LONG)
                
                # 캡챠 사라졌는지 확인
                if self.detect_captcha() is None:
                    log('✅ UC 핸들러 성공')
                    return True
                    
            elif captcha_type in [CaptchaType.RECAPTCHA_V2, CaptchaType.RECAPTCHA_V3]:
                log('🔧 SeleniumBase UC reCAPTCHA 핸들러...')
                self.sb.uc_gui_handle_captcha()
                adaptive_sleep(Timing.LONG)
                
                if self.detect_captcha() is None:
                    log('✅ UC 핸들러 성공')
                    return True
                    
        except Exception as e:
            log(f'⚠️ UC 핸들러 실패: {e}')
        
        return False
    
    def _solve_with_2captcha(self, captcha_type: CaptchaType) -> bool:
        """2captcha API 사용"""
        try:
            import requests
        except ImportError:
            log('⚠️ requests 모듈 필요')
            return False
        
        try:
            api_key = self.config.two_captcha_key
            
            # 사이트키 추출
            sitekey = self._extract_sitekey()
            if not sitekey:
                log('⚠️ sitekey 추출 실패')
                return False
            
            page_url = self.sb.get_current_url()
            
            # 캡챠 타입별 요청
            if captcha_type == CaptchaType.TURNSTILE:
                method = 'turnstile'
                params = {
                    'key': api_key,
                    'method': method,
                    'sitekey': sitekey,
                    'pageurl': page_url,
                    'json': 1,
                }
            elif captcha_type == CaptchaType.RECAPTCHA_V2:
                method = 'userrecaptcha'
                params = {
                    'key': api_key,
                    'method': method,
                    'googlekey': sitekey,
                    'pageurl': page_url,
                    'json': 1,
                }
            elif captcha_type == CaptchaType.RECAPTCHA_V3:
                method = 'userrecaptcha'
                params = {
                    'key': api_key,
                    'method': method,
                    'googlekey': sitekey,
                    'pageurl': page_url,
                    'version': 'v3',
                    'action': 'verify',
                    'min_score': 0.3,
                    'json': 1,
                }
            elif captcha_type == CaptchaType.HCAPTCHA:
                method = 'hcaptcha'
                params = {
                    'key': api_key,
                    'method': method,
                    'sitekey': sitekey,
                    'pageurl': page_url,
                    'json': 1,
                }
            else:
                return False
            
            log(f'📤 2captcha 요청 전송 ({method})...')
            
            # 1. 작업 제출
            resp = requests.get('https://2captcha.com/in.php', params=params, timeout=30)
            result = resp.json()
            
            if result.get('status') != 1:
                log(f'⚠️ 2captcha 제출 실패: {result}')
                return False
            
            task_id = result['request']
            log(f'📋 2captcha 작업 ID: {task_id}')
            
            # 2. 결과 폴링
            start_time = time.time()
            while time.time() - start_time < self.config.solve_timeout:
                time.sleep(self.config.poll_interval)
                
                result_resp = requests.get(
                    'https://2captcha.com/res.php',
                    params={
                        'key': api_key,
                        'action': 'get',
                        'id': task_id,
                        'json': 1,
                    },
                    timeout=30
                )
                result = result_resp.json()
                
                if result.get('status') == 1:
                    token = result['request']
                    log('✅ 2captcha 토큰 수신!')
                    
                    # 3. 토큰 주입
                    return self._inject_token(token, captcha_type)
                
                elif result.get('request') == 'CAPCHA_NOT_READY':
                    log(f'⏳ 2captcha 처리 중... ({int(time.time() - start_time)}s)')
                    continue
                
                else:
                    log(f'⚠️ 2captcha 에러: {result}')
                    return False
            
            log('⏰ 2captcha 타임아웃')
            return False
            
        except Exception as e:
            log(f'⚠️ 2captcha 실패: {e}')
            return False
    
    def _solve_with_anti_captcha(self, captcha_type: CaptchaType) -> bool:
        """Anti-Captcha API 사용"""
        try:
            import requests
        except ImportError:
            return False
        
        try:
            api_key = self.config.anti_captcha_key
            
            sitekey = self._extract_sitekey()
            if not sitekey:
                return False
            
            page_url = self.sb.get_current_url()
            
            # 작업 타입
            if captcha_type == CaptchaType.TURNSTILE:
                task_type = 'TurnstileTaskProxyless'
            elif captcha_type == CaptchaType.RECAPTCHA_V2:
                task_type = 'RecaptchaV2TaskProxyless'
            elif captcha_type == CaptchaType.RECAPTCHA_V3:
                task_type = 'RecaptchaV3TaskProxyless'
            elif captcha_type == CaptchaType.HCAPTCHA:
                task_type = 'HCaptchaTaskProxyless'
            else:
                return False
            
            log(f'📤 Anti-Captcha 요청 전송 ({task_type})...')
            
            # 1. 작업 생성
            create_resp = requests.post(
                'https://api.anti-captcha.com/createTask',
                json={
                    'clientKey': api_key,
                    'task': {
                        'type': task_type,
                        'websiteURL': page_url,
                        'websiteKey': sitekey,
                    }
                },
                timeout=30
            )
            create_result = create_resp.json()
            
            if create_result.get('errorId') != 0:
                log(f'⚠️ Anti-Captcha 생성 실패: {create_result}')
                return False
            
            task_id = create_result['taskId']
            log(f'📋 Anti-Captcha 작업 ID: {task_id}')
            
            # 2. 결과 폴링
            start_time = time.time()
            while time.time() - start_time < self.config.solve_timeout:
                time.sleep(self.config.poll_interval)
                
                result_resp = requests.post(
                    'https://api.anti-captcha.com/getTaskResult',
                    json={
                        'clientKey': api_key,
                        'taskId': task_id,
                    },
                    timeout=30
                )
                result = result_resp.json()
                
                if result.get('status') == 'ready':
                    token = result['solution'].get('gRecaptchaResponse') or \
                            result['solution'].get('token')
                    log('✅ Anti-Captcha 토큰 수신!')
                    return self._inject_token(token, captcha_type)
                
                elif result.get('status') == 'processing':
                    log(f'⏳ Anti-Captcha 처리 중... ({int(time.time() - start_time)}s)')
                    continue
                
                else:
                    log(f'⚠️ Anti-Captcha 에러: {result}')
                    return False
            
            log('⏰ Anti-Captcha 타임아웃')
            return False
            
        except Exception as e:
            log(f'⚠️ Anti-Captcha 실패: {e}')
            return False
    
    def _solve_with_capmonster(self, captcha_type: CaptchaType) -> bool:
        """CapMonster API 사용 (2captcha 호환)"""
        try:
            import requests
        except ImportError:
            return False
        
        try:
            # CapMonster는 2captcha 호환 API 제공
            api_key = self.config.capmonster_key
            
            sitekey = self._extract_sitekey()
            if not sitekey:
                return False
            
            page_url = self.sb.get_current_url()
            
            # 캡챠 타입별 요청
            if captcha_type == CaptchaType.TURNSTILE:
                task_type = 'TurnstileTask'
            elif captcha_type == CaptchaType.RECAPTCHA_V2:
                task_type = 'NoCaptchaTask'
            elif captcha_type == CaptchaType.RECAPTCHA_V3:
                task_type = 'RecaptchaV3TaskProxyless'
            elif captcha_type == CaptchaType.HCAPTCHA:
                task_type = 'HCaptchaTask'
            else:
                return False
            
            log(f'📤 CapMonster 요청 전송 ({task_type})...')
            
            # 작업 생성
            create_resp = requests.post(
                'https://api.capmonster.cloud/createTask',
                json={
                    'clientKey': api_key,
                    'task': {
                        'type': task_type,
                        'websiteURL': page_url,
                        'websiteKey': sitekey,
                    }
                },
                timeout=30
            )
            create_result = create_resp.json()
            
            if create_result.get('errorId') != 0:
                log(f'⚠️ CapMonster 생성 실패: {create_result}')
                return False
            
            task_id = create_result['taskId']
            
            # 결과 폴링
            start_time = time.time()
            while time.time() - start_time < self.config.solve_timeout:
                time.sleep(self.config.poll_interval)
                
                result_resp = requests.post(
                    'https://api.capmonster.cloud/getTaskResult',
                    json={
                        'clientKey': api_key,
                        'taskId': task_id,
                    },
                    timeout=30
                )
                result = result_resp.json()
                
                if result.get('status') == 'ready':
                    token = result['solution'].get('gRecaptchaResponse') or \
                            result['solution'].get('token')
                    log('✅ CapMonster 토큰 수신!')
                    return self._inject_token(token, captcha_type)
                
                elif result.get('status') == 'processing':
                    continue
                
                else:
                    log(f'⚠️ CapMonster 에러: {result}')
                    return False
            
            return False
            
        except Exception as e:
            log(f'⚠️ CapMonster 실패: {e}')
            return False
    
    def _extract_sitekey(self) -> Optional[str]:
        """페이지에서 sitekey 추출"""
        try:
            # data-sitekey 속성
            for sel in ['[data-sitekey]', '.g-recaptcha', '.h-captcha', '.cf-turnstile']:
                try:
                    elem = self.sb.find_element(sel)
                    if elem:
                        sitekey = elem.get_attribute('data-sitekey')
                        if sitekey:
                            return sitekey
                except:
                    pass
            
            # iframe src에서 추출
            iframes = self.sb.find_elements('iframe[src*="sitekey"]')
            for iframe in iframes:
                src = iframe.get_attribute('src')
                if 'sitekey=' in src:
                    import re
                    match = re.search(r'sitekey=([^&]+)', src)
                    if match:
                        return match.group(1)
            
            # JavaScript 변수에서 추출
            sitekey = self.sb.execute_script("""
                // reCAPTCHA
                if (typeof grecaptcha !== 'undefined') {
                    var elements = document.querySelectorAll('.g-recaptcha');
                    for (var el of elements) {
                        if (el.dataset.sitekey) return el.dataset.sitekey;
                    }
                }
                // Turnstile
                if (typeof turnstile !== 'undefined') {
                    var elements = document.querySelectorAll('.cf-turnstile');
                    for (var el of elements) {
                        if (el.dataset.sitekey) return el.dataset.sitekey;
                    }
                }
                return null;
            """)
            
            return sitekey
            
        except Exception as e:
            log(f'⚠️ sitekey 추출 실패: {e}')
            return None
    
    def _inject_token(self, token: str, captcha_type: CaptchaType) -> bool:
        """캡챠 토큰 주입"""
        try:
            if captcha_type in [CaptchaType.RECAPTCHA_V2, CaptchaType.RECAPTCHA_V3]:
                # g-recaptcha-response 필드에 주입
                self.sb.execute_script(f"""
                    // textarea에 토큰 삽입
                    var textarea = document.getElementById('g-recaptcha-response');
                    if (!textarea) {{
                        textarea = document.querySelector('[name="g-recaptcha-response"]');
                    }}
                    if (textarea) {{
                        textarea.innerHTML = '{token}';
                        textarea.value = '{token}';
                    }}
                    
                    // 콜백 실행
                    if (typeof grecaptcha !== 'undefined') {{
                        var widgetId = grecaptcha.getWidgetId ? grecaptcha.getWidgetId() : 0;
                        var callback = grecaptcha.getResponse ? null : 
                            (document.querySelector('.g-recaptcha') || {{}}).dataset.callback;
                        if (callback && typeof window[callback] === 'function') {{
                            window[callback]('{token}');
                        }}
                    }}
                """)
                
            elif captcha_type == CaptchaType.TURNSTILE:
                # Turnstile 토큰 주입
                self.sb.execute_script(f"""
                    // 토큰 필드 찾기
                    var input = document.querySelector('[name="cf-turnstile-response"]');
                    if (!input) {{
                        input = document.querySelector('input[name*="turnstile"]');
                    }}
                    if (input) {{
                        input.value = '{token}';
                    }}
                    
                    // 콜백 실행
                    if (typeof turnstile !== 'undefined' && turnstile.getResponse) {{
                        // 수동 처리
                    }}
                """)
                
            elif captcha_type == CaptchaType.HCAPTCHA:
                # hCaptcha 토큰 주입
                self.sb.execute_script(f"""
                    var textarea = document.querySelector('[name="h-captcha-response"]');
                    if (textarea) {{
                        textarea.value = '{token}';
                    }}
                    
                    if (typeof hcaptcha !== 'undefined') {{
                        // 콜백 시도
                    }}
                """)
            
            log('💉 토큰 주입 완료')
            adaptive_sleep(Timing.MEDIUM)
            
            # 폼 제출 또는 버튼 클릭
            try:
                submit_btn = self.sb.find_element('button[type="submit"], input[type="submit"]')
                if submit_btn and submit_btn.is_displayed():
                    submit_btn.click()
                    adaptive_sleep(Timing.LONG)
            except:
                pass
            
            # 성공 확인
            if self.detect_captcha() is None:
                return True
            
            log('⚠️ 토큰 주입 후에도 캡챠 존재')
            return False
            
        except Exception as e:
            log(f'⚠️ 토큰 주입 실패: {e}')
            return False
    
    def _wait_for_manual_solve(self) -> bool:
        """수동 캡챠 해결 대기"""
        log(f'👆 수동으로 캡챠를 해결해주세요! ({self.config.manual_wait_timeout}초 대기)')
        
        # 공유 상태에 알림
        shared = get_shared_state()
        if shared:
            shared.set('captcha_manual_required', True)
        
        start_time = time.time()
        while time.time() - start_time < self.config.manual_wait_timeout:
            # 캡챠 사라졌는지 확인
            if self.detect_captcha() is None:
                log('✅ 수동 캡챠 해결 완료!')
                if shared:
                    shared.set('captcha_manual_required', False)
                return True
            
            # URL 변경 확인 (캡챠 통과 후 페이지 이동)
            time.sleep(1)
        
        log('⏰ 수동 캡챠 대기 타임아웃')
        if shared:
            shared.set('captcha_manual_required', False)
        return False
    
    def get_stats(self) -> Dict[str, int]:
        """솔버 통계"""
        return {
            'solved': self._solve_count,
            'failed': self._fail_count,
            'success_rate': self._solve_count / max(1, self._solve_count + self._fail_count) * 100,
        }


# ============ 편의 함수 ============
def auto_solve_captcha(sb, config: Optional[CaptchaConfig] = None) -> bool:
    """캡챠 자동 해결 (원샷)"""
    solver = CaptchaSolver(sb, config)
    return solver.solve()


def solve_turnstile(sb) -> bool:
    """Turnstile 전용 솔버"""
    solver = CaptchaSolver(sb)
    return solver.solve(CaptchaType.TURNSTILE)


def solve_recaptcha(sb) -> bool:
    """reCAPTCHA 전용 솔버"""
    solver = CaptchaSolver(sb)
    captcha_type = solver.detect_captcha()
    if captcha_type in [CaptchaType.RECAPTCHA_V2, CaptchaType.RECAPTCHA_V3]:
        return solver.solve(captcha_type)
    return True  # 캡챠 없음


def has_captcha(sb) -> bool:
    """캡챠 존재 여부"""
    solver = CaptchaSolver(sb)
    return solver.detect_captcha() is not None


class CaptchaAwareMixin:
    """캡챠 처리를 포함한 Mixin 클래스"""
    
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._captcha_solver = None
        self._captcha_config = kwargs.get('captcha_config')
    
    def _get_solver(self):
        if self._captcha_solver is None:
            self._captcha_solver = CaptchaSolver(self.sb, self._captcha_config)
        return self._captcha_solver
    
    def handle_captcha_if_present(self) -> bool:
        """캡챠가 있으면 해결"""
        solver = self._get_solver()
        captcha_type = solver.detect_captcha()
        if captcha_type:
            return solver.solve(captcha_type)
        return True
    
    def click_with_captcha_check(self, selector: str, timeout: float = 5.0) -> bool:
        """클릭 후 캡챠 체크"""
        try:
            self.sb.click(selector, timeout=timeout)
            adaptive_sleep(Timing.MEDIUM)
            return self.handle_captcha_if_present()
        except Exception as e:
            log(f'⚠️ 클릭 실패: {e}')
            return False
