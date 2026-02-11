#!/usr/bin/env python3
"""
하이브리드 모드 테스트 스크립트

테스트 항목:
1. Camoufox 브라우저 시작
2. Turnstile CAPTCHA 감지 및 해결
3. 프록시 연결
4. 셀렉터 동작

실행:
    python test_hybrid.py
"""

import asyncio
import os
import sys

# 현재 디렉토리를 path에 추가
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


async def test_camoufox():
    """Camoufox 브라우저 테스트"""
    print("\n🧪 Test 1: Camoufox 브라우저")
    print("-" * 40)
    
    try:
        from camoufox.async_api import AsyncCamoufox
        print("✅ camoufox 임포트 성공")
        
        browser = await AsyncCamoufox(
            headless=True,
            humanize=True,
        ).start()
        
        page = await browser.new_page()
        await page.goto("https://httpbin.org/headers")
        
        # User-Agent 확인
        content = await page.content()
        if "HeadlessChrome" in content:
            print("⚠️ Headless 감지됨!")
        else:
            print("✅ Headless 미감지")
        
        await browser.stop()
        print("✅ 브라우저 시작/종료 성공")
        return True
        
    except ImportError as e:
        print(f"❌ camoufox 설치 필요: pip install camoufox")
        print(f"   오류: {e}")
        return False
    except Exception as e:
        print(f"❌ 브라우저 테스트 실패: {e}")
        return False


async def test_captcha_solver():
    """CAPTCHA 솔버 테스트 (API 키 없이)"""
    print("\n🧪 Test 2: CAPTCHA 솔버 모듈")
    print("-" * 40)
    
    try:
        from captcha_solver import TurnstileSolver, CaptchaResult
        print("✅ captcha_solver 임포트 성공")
        
        solver = TurnstileSolver(api_key=None)
        
        # API 키 확인
        api_key = os.getenv("TWOCAPTCHA_API_KEY", "")
        if api_key:
            print(f"✅ 2captcha API 키 설정됨: {api_key[:10]}...")
        else:
            print("⚠️ TWOCAPTCHA_API_KEY 미설정 (수동 폴백 사용)")
        
        await solver.close()
        return True
        
    except Exception as e:
        print(f"❌ CAPTCHA 솔버 테스트 실패: {e}")
        return False


async def test_proxy_pool():
    """프록시 풀 테스트"""
    print("\n🧪 Test 3: 프록시 풀")
    print("-" * 40)
    
    try:
        from proxy_pool import ProxyPool, init_proxy_pool
        print("✅ proxy_pool 임포트 성공")
        
        pool = ProxyPool()
        
        # 환경변수에서 로드 시도
        loaded = pool.load_from_env("PROXY_LIST")
        if loaded > 0:
            print(f"✅ {loaded}개 프록시 로드됨")
        else:
            print("⚠️ PROXY_LIST 미설정 (프록시 없이 실행)")
        
        return True
        
    except Exception as e:
        print(f"❌ 프록시 풀 테스트 실패: {e}")
        return False


async def test_ai_helper():
    """AI 헬퍼 테스트"""
    print("\n🧪 Test 4: AI 헬퍼")
    print("-" * 40)
    
    try:
        from ai_helper import AIHelper, HybridClicker, PreciseTimer
        print("✅ ai_helper 임포트 성공")
        
        ai = AIHelper(debug=True)
        
        # TTS 테스트 (macOS)
        import platform
        if platform.system() == "Darwin":
            print("🔊 TTS 테스트...")
            ai.speak("테스트", blocking=False)
            print("✅ TTS 호출 성공")
        
        return True
        
    except Exception as e:
        print(f"❌ AI 헬퍼 테스트 실패: {e}")
        return False


async def test_turnstile_detection():
    """Turnstile 감지 테스트 (2captcha 데모 페이지)"""
    print("\n🧪 Test 5: Turnstile 감지 테스트")
    print("-" * 40)
    
    try:
        from camoufox.async_api import AsyncCamoufox
        from captcha_solver import TurnstileSolver
        
        browser = await AsyncCamoufox(headless=True).start()
        page = await browser.new_page()
        
        # 2captcha Turnstile 데모 페이지
        test_url = "https://2captcha.com/demo/cloudflare-turnstile"
        print(f"🌐 테스트 페이지: {test_url}")
        
        await page.goto(test_url, wait_until="domcontentloaded")
        await asyncio.sleep(3)  # Turnstile 로드 대기
        
        solver = TurnstileSolver()
        has_turnstile = await solver.detect_turnstile(page)
        
        if has_turnstile:
            print("✅ Turnstile 감지됨!")
            
            # sitekey 추출 테스트
            sitekey = await solver._extract_sitekey(page)
            if sitekey:
                print(f"✅ sitekey 추출: {sitekey[:30]}...")
            else:
                print("⚠️ sitekey 추출 실패")
        else:
            print("⚠️ Turnstile 미감지 (페이지 로드 확인 필요)")
        
        await solver.close()
        await browser.stop()
        return True
        
    except Exception as e:
        print(f"❌ Turnstile 감지 테스트 실패: {e}")
        return False


async def test_interpark_connection():
    """인터파크 (NOL 티켓) 연결 테스트"""
    print("\n🧪 Test 6: 인터파크 연결 테스트")
    print("-" * 40)
    
    try:
        from camoufox.async_api import AsyncCamoufox
        
        browser = await AsyncCamoufox(
            headless=True,
            locale="ko-KR",
        ).start()
        page = await browser.new_page()
        
        # NOL 티켓 메인 페이지
        test_url = "https://tickets.interpark.com/"
        print(f"🌐 테스트 페이지: {test_url}")
        
        response = await page.goto(test_url, wait_until="domcontentloaded")
        
        if response and response.status == 200:
            print("✅ 인터파크 연결 성공")
            
            # 페이지 타이틀 확인
            title = await page.title()
            print(f"   페이지 제목: {title}")
            
            # Cloudflare 체크
            content = await page.content()
            if "cf-" in content or "challenge" in content.lower():
                print("⚠️ Cloudflare 보호 감지됨")
            else:
                print("✅ Cloudflare 보호 없음")
        else:
            print(f"⚠️ 연결 실패: status={response.status if response else 'None'}")
        
        await browser.stop()
        return True
        
    except Exception as e:
        print(f"❌ 인터파크 연결 테스트 실패: {e}")
        return False


async def main():
    """모든 테스트 실행"""
    print("=" * 50)
    print("🚀 BTS 티켓팅 봇 - 하이브리드 모드 테스트")
    print("=" * 50)
    
    results = {}
    
    # 기본 테스트
    results["camoufox"] = await test_camoufox()
    results["captcha_solver"] = await test_captcha_solver()
    results["proxy_pool"] = await test_proxy_pool()
    results["ai_helper"] = await test_ai_helper()
    
    # 연결 테스트 (camoufox 성공 시에만)
    if results["camoufox"]:
        results["turnstile"] = await test_turnstile_detection()
        results["interpark"] = await test_interpark_connection()
    
    # 결과 요약
    print("\n" + "=" * 50)
    print("📊 테스트 결과 요약")
    print("=" * 50)
    
    all_passed = True
    for name, passed in results.items():
        status = "✅ PASS" if passed else "❌ FAIL"
        print(f"  {name}: {status}")
        if not passed:
            all_passed = False
    
    print("-" * 50)
    if all_passed:
        print("🎉 모든 테스트 통과! 티켓팅 봇 사용 준비 완료.")
    else:
        print("⚠️ 일부 테스트 실패. 위의 오류를 확인하세요.")
    
    return all_passed


if __name__ == "__main__":
    success = asyncio.run(main())
    sys.exit(0 if success else 1)
