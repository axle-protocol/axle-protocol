#!/usr/bin/env python3
"""
봇 탐지 회피 스텔스 스크립트

Cloudflare Turnstile 100% 통과를 위한 브라우저 fingerprint 조작:
- Canvas fingerprint 랜덤화
- WebGL 정보 스푸핑
- Navigator 속성 위장
- 마우스 움직임 인간화
- AudioContext fingerprint 조작
- 세션별 독립 fingerprint 생성

참고 문서:
- https://github.com/AmineMELHAS/antiCaptcha
- https://fingerprint.com/blog/browser-fingerprinting-techniques/
"""

import random
import hashlib
import string
import json
from typing import Optional, Dict, List, Tuple
from dataclasses import dataclass, field
import math


@dataclass
class FingerprintProfile:
    """세션별 독립 fingerprint 프로파일"""
    session_id: int
    
    # Canvas noise
    canvas_noise_seed: int = field(default_factory=lambda: random.randint(1, 1000000))
    canvas_noise_level: float = field(default_factory=lambda: random.uniform(0.001, 0.01))
    
    # WebGL parameters
    webgl_vendor: str = ""
    webgl_renderer: str = ""
    webgl_unmasked_vendor: str = ""
    webgl_unmasked_renderer: str = ""
    
    # Audio fingerprint
    audio_noise_seed: int = field(default_factory=lambda: random.randint(1, 1000000))
    audio_noise_level: float = field(default_factory=lambda: random.uniform(0.0001, 0.001))
    
    # Screen properties
    screen_width: int = 1920
    screen_height: int = 1080
    screen_avail_width: int = 1920
    screen_avail_height: int = 1040  # taskbar 제외
    color_depth: int = 24
    pixel_ratio: float = 1.0
    
    # Timezone
    timezone_offset: int = -540  # KST (UTC+9)
    timezone_name: str = "Asia/Seoul"
    
    # Hardware
    hardware_concurrency: int = 8
    device_memory: int = 8
    
    # Platform
    platform: str = "MacIntel"
    
    # Language
    languages: List[str] = field(default_factory=lambda: ["ko-KR", "ko", "en-US", "en"])
    
    # User-Agent components
    user_agent: str = ""
    
    def __post_init__(self):
        self._randomize_webgl()
        self._randomize_screen()
        self._randomize_hardware()
        if not self.user_agent:
            self._generate_user_agent()
    
    def _randomize_webgl(self):
        """WebGL 정보 랜덤화"""
        # 실제 GPU 정보 기반 (Mac)
        mac_gpus = [
            ("Apple", "Apple M1", "Apple Inc.", "Apple M1"),
            ("Apple", "Apple M1 Pro", "Apple Inc.", "Apple M1 Pro"),
            ("Apple", "Apple M1 Max", "Apple Inc.", "Apple M1 Max"),
            ("Apple", "Apple M2", "Apple Inc.", "Apple M2"),
            ("Apple", "Apple M2 Pro", "Apple Inc.", "Apple M2 Pro"),
            ("Apple", "Apple M3", "Apple Inc.", "Apple M3"),
            ("Apple", "AMD Radeon Pro 5500M", "Apple Inc.", "AMD Radeon Pro 5500M OpenGL Engine"),
            ("Google Inc. (Apple)", "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)", 
             "Google Inc. (Apple)", "ANGLE (Apple, ANGLE Metal Renderer: Apple M1, Unspecified Version)"),
        ]
        
        # Windows GPU 옵션
        win_gpus = [
            ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)",
             "Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 3080 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
            ("Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)",
             "Google Inc. (NVIDIA)", "ANGLE (NVIDIA, NVIDIA GeForce RTX 4090 Direct3D11 vs_5_0 ps_5_0, D3D11)"),
            ("Google Inc. (AMD)", "ANGLE (AMD, AMD Radeon RX 7900 XTX Direct3D11 vs_5_0 ps_5_0, D3D11)",
             "Google Inc. (AMD)", "ANGLE (AMD, AMD Radeon RX 7900 XTX Direct3D11 vs_5_0 ps_5_0, D3D11)"),
        ]
        
        # 플랫폼에 맞는 GPU 선택
        if "Mac" in self.platform:
            gpu = random.choice(mac_gpus)
        else:
            gpu = random.choice(win_gpus)
        
        self.webgl_vendor = gpu[0]
        self.webgl_renderer = gpu[1]
        self.webgl_unmasked_vendor = gpu[2]
        self.webgl_unmasked_renderer = gpu[3]
    
    def _randomize_screen(self):
        """화면 해상도 랜덤화"""
        resolutions = [
            (1920, 1080, 1040),
            (2560, 1440, 1400),
            (1440, 900, 860),
            (1680, 1050, 1010),
            (2560, 1600, 1560),
            (3840, 2160, 2120),
        ]
        res = random.choice(resolutions)
        self.screen_width = res[0]
        self.screen_height = res[1]
        self.screen_avail_height = res[2]
        self.screen_avail_width = res[0]
        
        # Pixel ratio (Retina)
        self.pixel_ratio = random.choice([1.0, 1.5, 2.0])
        
    def _randomize_hardware(self):
        """하드웨어 정보 랜덤화"""
        self.hardware_concurrency = random.choice([4, 6, 8, 10, 12, 16])
        self.device_memory = random.choice([4, 8, 16, 32])
    
    def _generate_user_agent(self):
        """User-Agent 생성"""
        chrome_versions = [
            "120.0.0.0", "121.0.0.0", "122.0.0.0", "123.0.0.0", 
            "124.0.0.0", "125.0.0.0", "126.0.0.0", "127.0.0.0"
        ]
        version = random.choice(chrome_versions)
        
        if "Mac" in self.platform:
            os_string = f"Macintosh; Intel Mac OS X 10_15_{random.randint(0, 7)}"
        else:
            os_string = f"Windows NT 10.0; Win64; x64"
        
        self.user_agent = (
            f"Mozilla/5.0 ({os_string}) "
            f"AppleWebKit/537.36 (KHTML, like Gecko) "
            f"Chrome/{version} Safari/537.36"
        )
    
    def get_fingerprint_hash(self) -> str:
        """고유 fingerprint 해시 생성"""
        data = f"{self.canvas_noise_seed}:{self.webgl_renderer}:{self.screen_width}:{self.session_id}"
        return hashlib.md5(data.encode()).hexdigest()[:16]


def generate_stealth_script(profile: FingerprintProfile) -> str:
    """브라우저에 주입할 스텔스 JavaScript 생성"""
    
    return f'''
    // ============================================================
    // BTS Ticketing Stealth Script v2.0
    // Session: {profile.session_id} | Hash: {profile.get_fingerprint_hash()}
    // ============================================================
    
    (function() {{
        'use strict';
        
        // 이미 주입됐는지 확인
        if (window.__stealth_injected__) return;
        window.__stealth_injected__ = true;
        
        const NOISE_SEED = {profile.canvas_noise_seed};
        const NOISE_LEVEL = {profile.canvas_noise_level};
        
        // ============ 1. Canvas Fingerprint 랜덤화 ============
        
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        const originalToBlob = HTMLCanvasElement.prototype.toBlob;
        const originalGetImageData = CanvasRenderingContext2D.prototype.getImageData;
        
        // Seeded random number generator
        function seededRandom(seed) {{
            const x = Math.sin(seed++) * 10000;
            return x - Math.floor(x);
        }}
        
        // 픽셀 데이터에 미세한 노이즈 추가
        function addNoiseToImageData(imageData) {{
            const data = imageData.data;
            let seed = NOISE_SEED;
            
            for (let i = 0; i < data.length; i += 4) {{
                // RGB 채널에만 노이즈 추가 (알파는 유지)
                for (let j = 0; j < 3; j++) {{
                    const noise = (seededRandom(seed + i + j) - 0.5) * NOISE_LEVEL * 255;
                    data[i + j] = Math.max(0, Math.min(255, data[i + j] + noise));
                }}
            }}
            
            return imageData;
        }}
        
        HTMLCanvasElement.prototype.toDataURL = function(type, quality) {{
            const ctx = this.getContext('2d');
            if (ctx) {{
                try {{
                    const imageData = ctx.getImageData(0, 0, this.width, this.height);
                    const noisyData = addNoiseToImageData(imageData);
                    ctx.putImageData(noisyData, 0, 0);
                }} catch (e) {{
                    // CORS 에러 무시
                }}
            }}
            return originalToDataURL.call(this, type, quality);
        }};
        
        HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {{
            const ctx = this.getContext('2d');
            if (ctx) {{
                try {{
                    const imageData = ctx.getImageData(0, 0, this.width, this.height);
                    const noisyData = addNoiseToImageData(imageData);
                    ctx.putImageData(noisyData, 0, 0);
                }} catch (e) {{}}
            }}
            return originalToBlob.call(this, callback, type, quality);
        }};
        
        CanvasRenderingContext2D.prototype.getImageData = function(sx, sy, sw, sh) {{
            const imageData = originalGetImageData.call(this, sx, sy, sw, sh);
            return addNoiseToImageData(imageData);
        }};
        
        
        // ============ 2. WebGL Fingerprint 스푸핑 ============
        
        const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
        const originalGetParameter2 = WebGL2RenderingContext.prototype.getParameter;
        const originalGetExtension = WebGLRenderingContext.prototype.getExtension;
        
        const WEBGL_VENDOR = "{profile.webgl_vendor}";
        const WEBGL_RENDERER = "{profile.webgl_renderer}";
        const UNMASKED_VENDOR = "{profile.webgl_unmasked_vendor}";
        const UNMASKED_RENDERER = "{profile.webgl_unmasked_renderer}";
        
        function spoofWebGLParam(target, pname) {{
            // UNMASKED_VENDOR_WEBGL
            if (pname === 37445) return UNMASKED_VENDOR;
            // UNMASKED_RENDERER_WEBGL
            if (pname === 37446) return UNMASKED_RENDERER;
            // VENDOR
            if (pname === 7936) return WEBGL_VENDOR;
            // RENDERER  
            if (pname === 7937) return WEBGL_RENDERER;
            
            return null;
        }}
        
        WebGLRenderingContext.prototype.getParameter = function(pname) {{
            const spoofed = spoofWebGLParam(this, pname);
            if (spoofed !== null) return spoofed;
            return originalGetParameter.call(this, pname);
        }};
        
        WebGL2RenderingContext.prototype.getParameter = function(pname) {{
            const spoofed = spoofWebGLParam(this, pname);
            if (spoofed !== null) return spoofed;
            return originalGetParameter2.call(this, pname);
        }};
        
        // Debug 확장 스푸핑
        WebGLRenderingContext.prototype.getExtension = function(name) {{
            const ext = originalGetExtension.call(this, name);
            if (name === 'WEBGL_debug_renderer_info' && ext) {{
                return {{
                    UNMASKED_VENDOR_WEBGL: 37445,
                    UNMASKED_RENDERER_WEBGL: 37446
                }};
            }}
            return ext;
        }};
        
        
        // ============ 3. Navigator 속성 위장 ============
        
        const navigatorProps = {{
            hardwareConcurrency: {profile.hardware_concurrency},
            deviceMemory: {profile.device_memory},
            platform: "{profile.platform}",
            languages: {json.dumps(profile.languages)},
            language: "{profile.languages[0] if profile.languages else 'ko-KR'}",
            userAgent: "{profile.user_agent}"
        }};
        
        // Navigator 속성 오버라이드
        Object.keys(navigatorProps).forEach(prop => {{
            try {{
                Object.defineProperty(navigator, prop, {{
                    get: function() {{ return navigatorProps[prop]; }},
                    enumerable: true,
                    configurable: true
                }});
            }} catch (e) {{}}
        }});
        
        // WebDriver 플래그 제거 (중요!)
        Object.defineProperty(navigator, 'webdriver', {{
            get: () => undefined,
            enumerable: true,
            configurable: true
        }});
        
        // Chrome 자동화 플래그 제거
        if (window.chrome) {{
            window.chrome.runtime = undefined;
        }}
        
        // Permissions API 스푸핑
        const originalQuery = navigator.permissions?.query;
        if (originalQuery) {{
            navigator.permissions.query = function(params) {{
                if (params.name === 'notifications') {{
                    return Promise.resolve({{ state: 'prompt', onchange: null }});
                }}
                return originalQuery.call(this, params);
            }};
        }}
        
        
        // ============ 4. Screen 속성 스푸핑 ============
        
        const screenProps = {{
            width: {profile.screen_width},
            height: {profile.screen_height},
            availWidth: {profile.screen_avail_width},
            availHeight: {profile.screen_avail_height},
            colorDepth: {profile.color_depth},
            pixelDepth: {profile.color_depth}
        }};
        
        Object.keys(screenProps).forEach(prop => {{
            try {{
                Object.defineProperty(screen, prop, {{
                    get: function() {{ return screenProps[prop]; }},
                    enumerable: true,
                    configurable: true
                }});
            }} catch (e) {{}}
        }});
        
        Object.defineProperty(window, 'devicePixelRatio', {{
            get: function() {{ return {profile.pixel_ratio}; }},
            enumerable: true,
            configurable: true
        }});
        
        
        // ============ 5. AudioContext Fingerprint 랜덤화 ============
        
        const originalGetChannelData = AudioBuffer.prototype.getChannelData;
        const AUDIO_NOISE_SEED = {profile.audio_noise_seed};
        const AUDIO_NOISE_LEVEL = {profile.audio_noise_level};
        
        AudioBuffer.prototype.getChannelData = function(channel) {{
            const data = originalGetChannelData.call(this, channel);
            let seed = AUDIO_NOISE_SEED + channel;
            
            for (let i = 0; i < data.length; i++) {{
                const noise = (seededRandom(seed + i) - 0.5) * AUDIO_NOISE_LEVEL;
                data[i] = data[i] + noise;
            }}
            
            return data;
        }};
        
        
        // ============ 6. Timezone 스푸핑 ============
        
        const targetTimezoneOffset = {profile.timezone_offset};
        const targetTimezoneName = "{profile.timezone_name}";
        
        // Date.prototype.getTimezoneOffset 오버라이드
        const originalGetTimezoneOffset = Date.prototype.getTimezoneOffset;
        Date.prototype.getTimezoneOffset = function() {{
            return targetTimezoneOffset;
        }};
        
        // Intl.DateTimeFormat 스푸핑
        const originalResolvedOptions = Intl.DateTimeFormat.prototype.resolvedOptions;
        Intl.DateTimeFormat.prototype.resolvedOptions = function() {{
            const options = originalResolvedOptions.call(this);
            options.timeZone = targetTimezoneName;
            return options;
        }};
        
        
        // ============ 7. Plugin & MimeType 스푸핑 ============
        
        // 빈 플러그인 목록 (봇처럼 보이지 않도록 기본값 유지)
        Object.defineProperty(navigator, 'plugins', {{
            get: function() {{
                return {{
                    length: 5,
                    item: function(i) {{ return null; }},
                    namedItem: function(name) {{ return null; }},
                    refresh: function() {{}}
                }};
            }},
            enumerable: true,
            configurable: true
        }});
        
        
        // ============ 8. 콘솔 로그 정리 ============
        
        // Automation 관련 콘솔 메시지 필터링
        const originalConsoleLog = console.log;
        console.log = function(...args) {{
            const msg = args.join(' ');
            if (msg.includes('automation') || msg.includes('webdriver')) {{
                return;
            }}
            return originalConsoleLog.apply(this, args);
        }};
        
        console.log('[Stealth] Session {profile.session_id} initialized | Hash: {profile.get_fingerprint_hash()}');
        
    }})();
    '''


def generate_mouse_humanizer_script() -> str:
    """인간적인 마우스 움직임을 위한 JavaScript"""
    
    return '''
    // ============================================================
    // Mouse Movement Humanizer
    // ============================================================
    
    (function() {
        'use strict';
        
        if (window.__mouse_humanizer__) return;
        window.__mouse_humanizer__ = true;
        
        // 베지어 곡선 기반 마우스 경로 생성
        function cubicBezier(t, p0, p1, p2, p3) {
            const t2 = t * t;
            const t3 = t2 * t;
            const mt = 1 - t;
            const mt2 = mt * mt;
            const mt3 = mt2 * mt;
            
            return {
                x: mt3 * p0.x + 3 * mt2 * t * p1.x + 3 * mt * t2 * p2.x + t3 * p3.x,
                y: mt3 * p0.y + 3 * mt2 * t * p1.y + 3 * mt * t2 * p2.y + t3 * p3.y
            };
        }
        
        // 인간적인 마우스 경로 생성
        window.generateHumanPath = function(startX, startY, endX, endY, steps = 30) {
            const path = [];
            
            // 컨트롤 포인트 생성 (약간의 랜덤성)
            const dx = endX - startX;
            const dy = endY - startY;
            
            const cp1 = {
                x: startX + dx * 0.3 + (Math.random() - 0.5) * Math.abs(dx) * 0.2,
                y: startY + dy * 0.1 + (Math.random() - 0.5) * Math.abs(dy) * 0.3
            };
            
            const cp2 = {
                x: startX + dx * 0.7 + (Math.random() - 0.5) * Math.abs(dx) * 0.2,
                y: startY + dy * 0.9 + (Math.random() - 0.5) * Math.abs(dy) * 0.3
            };
            
            const p0 = { x: startX, y: startY };
            const p3 = { x: endX, y: endY };
            
            for (let i = 0; i <= steps; i++) {
                const t = i / steps;
                // 이징 함수 적용 (시작과 끝에서 느려짐)
                const easedT = t < 0.5 
                    ? 4 * t * t * t 
                    : 1 - Math.pow(-2 * t + 2, 3) / 2;
                
                const point = cubicBezier(easedT, p0, cp1, cp2, p3);
                
                // 미세한 떨림 추가
                point.x += (Math.random() - 0.5) * 2;
                point.y += (Math.random() - 0.5) * 2;
                
                path.push({
                    x: Math.round(point.x),
                    y: Math.round(point.y),
                    delay: 10 + Math.random() * 20  // 10-30ms 딜레이
                });
            }
            
            return path;
        };
        
        // 인간적인 클릭 딜레이
        window.humanClick = function(element) {
            return new Promise(resolve => {
                const rect = element.getBoundingClientRect();
                const centerX = rect.left + rect.width / 2;
                const centerY = rect.top + rect.height / 2;
                
                // 약간의 오프셋 (정확히 중앙이 아닌)
                const clickX = centerX + (Math.random() - 0.5) * rect.width * 0.3;
                const clickY = centerY + (Math.random() - 0.5) * rect.height * 0.3;
                
                // 클릭 전 짧은 지연
                setTimeout(() => {
                    element.click();
                    resolve();
                }, 50 + Math.random() * 100);
            });
        };
        
        // 인간적인 타이핑
        window.humanType = function(element, text, callback) {
            let i = 0;
            
            function typeChar() {
                if (i < text.length) {
                    element.value += text[i];
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                    i++;
                    
                    // 랜덤 타이핑 딜레이 (50-150ms)
                    const delay = 50 + Math.random() * 100;
                    
                    // 가끔 더 긴 일시정지 (생각하는 듯)
                    const pause = Math.random() < 0.05 ? 300 + Math.random() * 200 : 0;
                    
                    setTimeout(typeChar, delay + pause);
                } else if (callback) {
                    callback();
                }
            }
            
            setTimeout(typeChar, 100 + Math.random() * 200);
        };
        
        console.log('[MouseHumanizer] Initialized');
        
    })();
    '''


def generate_turnstile_helper_script() -> str:
    """Turnstile 통과를 돕는 스크립트"""
    
    return '''
    // ============================================================
    // Turnstile Helper Script
    // ============================================================
    
    (function() {
        'use strict';
        
        if (window.__turnstile_helper__) return;
        window.__turnstile_helper__ = true;
        
        // Turnstile 토큰 주입 헬퍼
        window.injectTurnstileToken = function(token) {
            // 가능한 모든 필드에 주입
            const selectors = [
                '[name="cf-turnstile-response"]',
                '[name="g-recaptcha-response"]', 
                '[name="h-captcha-response"]',
                'input[name*="turnstile"]',
                'input[name*="captcha"]',
                'textarea[name*="turnstile"]',
                '#cf-turnstile-response',
                '#g-recaptcha-response'
            ];
            
            let injected = false;
            
            selectors.forEach(selector => {
                const elements = document.querySelectorAll(selector);
                elements.forEach(el => {
                    el.value = token;
                    el.dispatchEvent(new Event('change', { bubbles: true }));
                    injected = true;
                    console.log('[Turnstile] Token injected to:', selector);
                });
            });
            
            // 숨겨진 input에도 시도
            document.querySelectorAll('input[type="hidden"]').forEach(input => {
                if (input.name.includes('turnstile') || 
                    input.name.includes('captcha') ||
                    input.id.includes('turnstile')) {
                    input.value = token;
                    injected = true;
                    console.log('[Turnstile] Token injected to hidden:', input.name);
                }
            });
            
            // Turnstile 콜백 호출
            if (typeof window.turnstileCallback === 'function') {
                window.turnstileCallback(token);
                console.log('[Turnstile] Callback invoked');
            }
            
            // window._cf_chl_opt 체크
            if (window._cf_chl_opt && window._cf_chl_opt.chlApiComplete) {
                try {
                    window._cf_chl_opt.chlApiComplete(token);
                    console.log('[Turnstile] CF challenge API completed');
                } catch (e) {}
            }
            
            return injected;
        };
        
        // Turnstile 상태 확인
        window.getTurnstileStatus = function() {
            const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
            const widget = document.querySelector('.cf-turnstile');
            const token = document.querySelector('[name="cf-turnstile-response"]')?.value;
            const challenge = document.querySelector('#challenge-running');
            
            return {
                hasIframe: !!iframe,
                hasWidget: !!widget,
                hasToken: !!token && token.length > 0,
                challengeActive: !!challenge && challenge.style.display !== 'none',
                tokenLength: token?.length || 0
            };
        };
        
        // sitekey 추출
        window.extractSiteKey = function() {
            // data-sitekey 속성
            const widget = document.querySelector('[data-sitekey]');
            if (widget) return widget.getAttribute('data-sitekey');
            
            // iframe src에서
            const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"]');
            if (iframe) {
                const match = iframe.src.match(/sitekey=([^&]+)/);
                if (match) return match[1];
            }
            
            // 스크립트에서
            const scripts = document.querySelectorAll('script');
            for (const script of scripts) {
                const match = script.textContent.match(/sitekey['":\s]+['"]([0-9x-]+)['"]/i);
                if (match) return match[1];
            }
            
            return null;
        };
        
        console.log('[TurnstileHelper] Initialized');
        
    })();
    '''


def create_fingerprint_profile(
    session_id: int,
    proxy: Optional[dict] = None,
    platform: str = "MacIntel"
) -> FingerprintProfile:
    """세션용 고유 fingerprint 프로파일 생성"""
    
    # 프록시별로 다른 시드 사용
    proxy_seed = 0
    if proxy and proxy.get('server'):
        proxy_seed = hash(proxy['server']) % 1000000
    
    profile = FingerprintProfile(
        session_id=session_id,
        canvas_noise_seed=random.randint(1, 1000000) + proxy_seed,
        audio_noise_seed=random.randint(1, 1000000) + proxy_seed,
        platform=platform
    )
    
    return profile


def get_all_stealth_scripts(profile: FingerprintProfile) -> str:
    """모든 스텔스 스크립트 통합"""
    
    scripts = [
        generate_stealth_script(profile),
        generate_mouse_humanizer_script(),
        generate_turnstile_helper_script()
    ]
    
    return '\n\n'.join(scripts)


# ============ Playwright/SeleniumBase 통합 ============

async def inject_stealth_playwright(page, profile: FingerprintProfile):
    """Playwright 페이지에 스텔스 스크립트 주입"""
    scripts = get_all_stealth_scripts(profile)
    await page.add_init_script(scripts)


def inject_stealth_selenium(driver, profile: FingerprintProfile):
    """SeleniumBase/Selenium에 스텔스 스크립트 주입"""
    scripts = get_all_stealth_scripts(profile)
    driver.execute_cdp_cmd('Page.addScriptToEvaluateOnNewDocument', {
        'source': scripts
    })


async def inject_stealth_nodriver(page, profile: FingerprintProfile):
    """nodriver 페이지에 스텔스 스크립트 주입"""
    scripts = get_all_stealth_scripts(profile)
    await page.evaluate(scripts)


# ============ 테스트 ============

if __name__ == "__main__":
    # 테스트 프로파일 생성
    profile = create_fingerprint_profile(session_id=1)
    
    print(f"Session ID: {profile.session_id}")
    print(f"Fingerprint Hash: {profile.get_fingerprint_hash()}")
    print(f"User Agent: {profile.user_agent}")
    print(f"WebGL Renderer: {profile.webgl_renderer}")
    print(f"Screen: {profile.screen_width}x{profile.screen_height}")
    print(f"Hardware: {profile.hardware_concurrency} cores, {profile.device_memory}GB RAM")
    print()
    
    # 스크립트 길이 확인
    script = get_all_stealth_scripts(profile)
    print(f"Total script length: {len(script)} chars")
