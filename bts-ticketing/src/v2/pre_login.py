"""
사전 로그인 - Playwright로 로그인 후 세션 추출
"""
import os
import time
import requests
from typing import Optional, Dict
from playwright.sync_api import sync_playwright, Page, BrowserContext
from session import AuthSession, SessionPool
from config import Account

# CapSolver API
CAPSOLVER_KEY = os.getenv('CAPSOLVER_API_KEY', '')
TURNSTILE_SITEKEY = "0x4AAAAAAAWSXlM_3OoUArlO"


def solve_turnstile_capsolver(page_url: str) -> Optional[str]:
    """CapSolver로 Turnstile 해결"""
    if not CAPSOLVER_KEY:
        return None
    
    try:
        # 태스크 생성
        resp = requests.post('https://api.capsolver.com/createTask', json={
            'clientKey': CAPSOLVER_KEY,
            'task': {
                'type': 'AntiTurnstileTaskProxyLess',
                'websiteURL': page_url,
                'websiteKey': TURNSTILE_SITEKEY,
            }
        }, timeout=10)
        
        task_id = resp.json().get('taskId')
        if not task_id:
            return None
        
        # 결과 대기
        for _ in range(30):
            time.sleep(2)
            result = requests.post('https://api.capsolver.com/getTaskResult', json={
                'clientKey': CAPSOLVER_KEY,
                'taskId': task_id
            }, timeout=10).json()
            
            if result.get('status') == 'ready':
                return result.get('solution', {}).get('token')
        
        return None
    except Exception:
        return None


def extract_session_from_browser(context: BrowserContext, account_id: str) -> Optional[AuthSession]:
    """브라우저에서 세션 추출"""
    cookies = context.cookies()
    
    cookie_dict = {}
    for cookie in cookies:
        if 'interpark' in cookie.get('domain', '') or 'yanolja' in cookie.get('domain', ''):
            cookie_dict[cookie['name']] = cookie['value']
    
    if not cookie_dict:
        return None
    
    return AuthSession(
        account_id=account_id,
        cookies=cookie_dict,
        headers={
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        }
    )


def pre_login_account(account: Account, session_pool: SessionPool) -> bool:
    """계정 사전 로그인"""
    print(f"[{account.name}] 사전 로그인 시작...")
    
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=False)
        context = browser.new_context(
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
            locale='ko-KR'
        )
        page = context.new_page()
        
        try:
            # 로그인 페이지
            page.goto('https://accounts.interpark.com/login/form')
            time.sleep(2)
            
            # 이메일 입력
            email_input = page.locator('input[type="email"], input[name="email"], #email')
            if email_input.count() > 0:
                email_input.first.fill(account.id)
            
            # 비밀번호 입력
            pw_input = page.locator('input[type="password"]')
            if pw_input.count() > 0:
                pw_input.first.fill(account.password)
            
            # Turnstile 처리
            turnstile_token = solve_turnstile_capsolver(page.url)
            if turnstile_token:
                page.evaluate(f"""
                    if (window.cfCallback) {{
                        window.cfCallback('{turnstile_token}');
                    }}
                """)
                time.sleep(1)
            
            # 로그인 버튼 클릭
            submit_btn = page.locator('button[type="submit"]')
            if submit_btn.count() > 0:
                submit_btn.first.click()
            
            # 로그인 완료 대기
            time.sleep(5)
            
            # 세션 추출
            session = extract_session_from_browser(context, account.id)
            if session:
                session_pool.add(session)
                print(f"[{account.name}] ✅ 로그인 성공!")
                return True
            else:
                print(f"[{account.name}] ❌ 세션 추출 실패")
                return False
            
        except Exception as e:
            print(f"[{account.name}] ❌ 로그인 실패: {e}")
            return False
        finally:
            browser.close()


def pre_login_all(accounts: list, session_pool: SessionPool) -> int:
    """모든 계정 사전 로그인"""
    success_count = 0
    
    for account in accounts:
        # 이미 유효한 세션 있으면 스킵
        existing = session_pool.get(account.id)
        if existing:
            print(f"[{account.name}] 기존 세션 사용")
            success_count += 1
            continue
        
        if pre_login_account(account, session_pool):
            success_count += 1
        
        time.sleep(2)  # 계정 간 딜레이
    
    return success_count
