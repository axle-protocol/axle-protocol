#!/usr/bin/env python3
"""
인터파크(NOL) 로그인 플로우 테스트
- headful 모드
- 프록시 설정 테스트
- 실제 로그인 테스트
"""

import os
import time
import random
from dotenv import load_dotenv

# 환경변수 로드
load_dotenv('.env.local')
load_dotenv('../.env.local')

# 설정
USER_ID = os.getenv('INTERPARK_ID', '')
USER_PW = os.getenv('INTERPARK_PWD', '')
CONCERT_URL = os.getenv('CONCERT_URL', 'https://tickets.interpark.com/goods/26004867')

# 프록시 설정
PROXY_HOST = os.getenv('PROXY_HOST', '')
PROXY_PORT = os.getenv('PROXY_PORT', '')
PROXY_USER = os.getenv('PROXY_USER', '')
PROXY_PASS = os.getenv('PROXY_PASS', '')


def log(msg):
    from datetime import datetime
    print(f'[{datetime.now().strftime("%H:%M:%S.%f")[:-3]}] {msg}')


def human_delay(min_ms=50, max_ms=150):
    """인간적인 딜레이"""
    time.sleep(random.uniform(min_ms/1000, max_ms/1000))


def human_type(sb, selector, text):
    """인간처럼 타이핑"""
    elem = sb.find_element(selector)
    elem.clear()
    for char in text:
        elem.send_keys(char)
        time.sleep(random.uniform(0.03, 0.08))


def test_login_flow():
    """로그인 플로우 테스트"""
    from seleniumbase import SB
    
    log('=' * 60)
    log('🧪 인터파크(NOL) 로그인 플로우 테스트')
    log(f'🎯 URL: {CONCERT_URL}')
    log(f'👤 ID: {USER_ID[:3]}***')
    log('=' * 60)
    
    # 프록시 설정
    proxy_str = None
    if PROXY_HOST and PROXY_PORT and PROXY_USER and PROXY_PASS:
        proxy_str = f"{PROXY_USER}:{PROXY_PASS}@{PROXY_HOST}:{PROXY_PORT}"
        log(f'🌐 프록시: {PROXY_HOST}:{PROXY_PORT}')
    else:
        log('⚠️ 프록시 미설정')
    
    # SeleniumBase 옵션
    sb_kwargs = {
        'uc': True,              # Undetected Chrome
        'headless': False,       # headful 모드
        'incognito': True,
        'locale_code': 'ko',
    }
    
    if proxy_str:
        sb_kwargs['proxy'] = proxy_str
    
    with SB(**sb_kwargs) as sb:
        try:
            # 1. 공연 페이지 접속
            log('📍 [1] 공연 페이지 접속...')
            sb.uc_open_with_reconnect(CONCERT_URL, reconnect_time=4)
            time.sleep(2)
            
            # 현재 URL과 제목 확인
            current_url = sb.get_current_url()
            log(f'📍 현재 URL: {current_url}')
            
            try:
                title = sb.get_title()
                log(f'📍 페이지 제목: {title}')
            except:
                pass
            
            # IP 확인 (프록시 테스트)
            log('📍 [IP 확인] 새 탭에서 IP 확인...')
            sb.open_new_tab()
            sb.uc_open_with_reconnect('https://ipinfo.io/json', reconnect_time=2)
            time.sleep(1)
            try:
                page_text = sb.get_page_source()
                if '"ip"' in page_text:
                    import json
                    # JSON 추출
                    start = page_text.find('{')
                    end = page_text.rfind('}') + 1
                    if start >= 0 and end > start:
                        ip_data = json.loads(page_text[start:end])
                        log(f'🌐 현재 IP: {ip_data.get("ip", "?")} ({ip_data.get("country", "?")})')
            except Exception as e:
                log(f'⚠️ IP 확인 실패: {e}')
            
            # 원래 탭으로 복귀
            sb.switch_to_window(0)
            time.sleep(1)
            
            # 2. 예매하기 버튼 찾기
            log('📍 [2] 예매하기 버튼 찾기...')
            
            booking_selectors = [
                'a:contains("예매하기")',
                'button:contains("예매하기")',
                '[class*="booking"]',
                'a[href*="booking"]',
            ]
            
            clicked = False
            for sel in booking_selectors:
                try:
                    sb.click(sel, timeout=3)
                    log(f'✅ 예매하기 클릭: {sel}')
                    clicked = True
                    break
                except:
                    continue
            
            if not clicked:
                # link 텍스트로 시도
                try:
                    sb.click_link('예매하기')
                    log('✅ 예매하기 링크 클릭')
                    clicked = True
                except:
                    log('⚠️ 예매하기 버튼 못찾음')
            
            time.sleep(2)
            current_url = sb.get_current_url()
            log(f'📍 현재 URL: {current_url}')
            
            # 3. 로그인 페이지 감지 및 로그인
            log('📍 [3] 로그인 페이지 감지...')
            
            # 로그인이 필요한지 확인
            if 'login' in current_url.lower() or 'accounts' in current_url.lower() or 'nol' in current_url.lower():
                log('🔐 로그인 페이지 감지!')
                
                # 캡챠 핸들링
                try:
                    sb.uc_gui_handle_captcha()
                except:
                    pass
                
                # 이메일 로그인 버튼 클릭 (NOL 스타일)
                email_login_selectors = [
                    'a:contains("이메일로 시작하기")',
                    'button:contains("이메일")',
                    'a:contains("이메일")',
                    '[class*="email"][class*="login"]',
                    '[class*="email"][class*="btn"]',
                ]
                
                for sel in email_login_selectors:
                    try:
                        sb.click(sel, timeout=2)
                        log(f'✅ 이메일 로그인 버튼 클릭: {sel}')
                        time.sleep(1)
                        break
                    except:
                        continue
                
                time.sleep(1)
                current_url = sb.get_current_url()
                log(f'📍 현재 URL: {current_url}')
                
                # 이메일 입력
                log('📍 [4] 이메일/비밀번호 입력...')
                
                email_selectors = [
                    '#email',
                    'input[type="email"]',
                    'input[name="email"]',
                    'input[placeholder*="이메일"]',
                    'input[id*="email"]',
                ]
                
                email_entered = False
                for sel in email_selectors:
                    try:
                        human_type(sb, sel, USER_ID)
                        log(f'✅ 이메일 입력: {sel}')
                        email_entered = True
                        break
                    except:
                        continue
                
                if not email_entered:
                    log('⚠️ 이메일 입력 필드 못찾음')
                
                human_delay(100, 200)
                
                # 비밀번호 입력
                pwd_selectors = [
                    '#password',
                    'input[type="password"]',
                    'input[name="password"]',
                ]
                
                pwd_entered = False
                for sel in pwd_selectors:
                    try:
                        human_type(sb, sel, USER_PW)
                        log(f'✅ 비밀번호 입력: {sel}')
                        pwd_entered = True
                        break
                    except:
                        continue
                
                if not pwd_entered:
                    log('⚠️ 비밀번호 입력 필드 못찾음')
                
                human_delay(200, 400)
                
                # 로그인 버튼 클릭
                log('📍 [5] 로그인 버튼 클릭...')
                
                login_btn_selectors = [
                    'button:contains("로그인")',
                    'button[type="submit"]',
                    'input[type="submit"]',
                    '[class*="login"][class*="btn"]',
                ]
                
                for sel in login_btn_selectors:
                    try:
                        sb.uc_click(sel, reconnect_time=3)
                        log(f'✅ 로그인 버튼 클릭: {sel}')
                        break
                    except:
                        continue
                
                # 로그인 완료 대기
                log('📍 [6] 로그인 완료 대기...')
                time.sleep(5)
                
                current_url = sb.get_current_url()
                log(f'📍 현재 URL: {current_url}')
                
                if 'login' not in current_url.lower():
                    log('✅ 로그인 성공!')
                else:
                    log('⚠️ 아직 로그인 페이지에 있음')
                    
                    # 에러 메시지 확인
                    try:
                        error_elem = sb.find_element('[class*="error"]')
                        if error_elem:
                            log(f'❌ 에러 메시지: {error_elem.text}')
                    except:
                        pass
            
            else:
                log('ℹ️ 로그인 페이지 아님 - 이미 로그인됨?')
            
            # 7. 현재 상태 스크린샷
            log('📍 [7] 스크린샷 저장...')
            sb.save_screenshot('/tmp/test_login_flow.png')
            log('📸 /tmp/test_login_flow.png')
            
            # 8. 페이지 소스 일부 확인
            try:
                page_source = sb.get_page_source()[:2000]
                log(f'📄 페이지 소스 (처음 2000자):\n{page_source}')
            except:
                pass
            
            # 대기 (수동 확인용)
            log('⏳ 30초 대기 (수동 확인)...')
            time.sleep(30)
            
            return True
            
        except Exception as e:
            log(f'❌ 에러: {e}')
            import traceback
            traceback.print_exc()
            
            try:
                sb.save_screenshot('/tmp/test_login_error.png')
            except:
                pass
            
            return False


if __name__ == '__main__':
    test_login_flow()
