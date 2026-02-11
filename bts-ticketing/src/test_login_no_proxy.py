#!/usr/bin/env python3
"""
인터파크(NOL) 로그인 플로우 테스트 - 프록시 없이
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


def log(msg):
    from datetime import datetime
    print(f'[{datetime.now().strftime("%H:%M:%S.%f")[:-3]}] {msg}')


def human_delay(min_ms=50, max_ms=150):
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
    log('🧪 인터파크(NOL) 로그인 플로우 테스트 (프록시 없이)')
    log(f'🎯 URL: {CONCERT_URL}')
    log(f'👤 ID: {USER_ID[:3]}***')
    log('=' * 60)
    
    # SeleniumBase 옵션 - 프록시 없이!
    sb_kwargs = {
        'uc': True,              # Undetected Chrome
        'headless': False,       # headful 모드
        'incognito': True,
        'locale_code': 'ko',
    }
    
    with SB(**sb_kwargs) as sb:
        try:
            # 1. 공연 페이지 접속
            log('📍 [1] 공연 페이지 접속...')
            sb.uc_open_with_reconnect(CONCERT_URL, reconnect_time=6)
            time.sleep(3)
            
            # 현재 URL과 제목 확인
            current_url = sb.get_current_url()
            log(f'📍 현재 URL: {current_url}')
            
            try:
                title = sb.get_title()
                log(f'📍 페이지 제목: {title}')
            except:
                pass
            
            # 스크린샷 1
            sb.save_screenshot('/tmp/test_step1_concert_page.png')
            log('📸 /tmp/test_step1_concert_page.png')
            
            # 페이지 소스 일부 확인
            page_source = sb.get_page_source()
            log(f'📄 페이지 길이: {len(page_source)}')
            
            if len(page_source) < 1000:
                log('⚠️ 페이지가 제대로 로드되지 않음!')
                log(f'내용: {page_source}')
                return False
            
            # 2. 예매하기 버튼 찾기
            log('📍 [2] 예매하기 버튼 찾기...')
            
            # 먼저 페이지 스크롤
            sb.execute_script("window.scrollBy(0, 300);")
            time.sleep(1)
            
            booking_selectors = [
                'a:contains("예매하기")',
                'button:contains("예매하기")',
                'span:contains("예매하기")',
                '[class*="booking"]',
                'a[href*="booking"]',
            ]
            
            clicked = False
            for sel in booking_selectors:
                try:
                    log(f'  시도: {sel}')
                    sb.click(sel, timeout=3)
                    log(f'✅ 예매하기 클릭: {sel}')
                    clicked = True
                    break
                except Exception as e:
                    log(f'  실패: {str(e)[:50]}')
                    continue
            
            if not clicked:
                # link 텍스트로 시도
                try:
                    sb.click_link('예매하기')
                    log('✅ 예매하기 링크 클릭')
                    clicked = True
                except Exception as e:
                    log(f'⚠️ 예매하기 링크 클릭 실패: {str(e)[:50]}')
            
            if not clicked:
                # JavaScript로 찾기
                log('📍 JavaScript로 예매하기 버튼 찾기...')
                result = sb.execute_script("""
                    var links = document.querySelectorAll('a, button, span');
                    for (var i = 0; i < links.length; i++) {
                        var text = links[i].textContent || '';
                        if (text.includes('예매하기') || text.includes('예매')) {
                            return {
                                tag: links[i].tagName,
                                text: text.trim().substring(0, 50),
                                href: links[i].href || '',
                                className: links[i].className || ''
                            };
                        }
                    }
                    return null;
                """)
                log(f'JS 결과: {result}')
                
                if result:
                    # 찾은 요소 클릭
                    click_result = sb.execute_script("""
                        var links = document.querySelectorAll('a, button, span');
                        for (var i = 0; i < links.length; i++) {
                            var text = links[i].textContent || '';
                            if (text.includes('예매하기')) {
                                links[i].click();
                                return 'clicked';
                            }
                        }
                        return 'not found';
                    """)
                    log(f'JS 클릭 결과: {click_result}')
                    if click_result == 'clicked':
                        clicked = True
            
            time.sleep(3)
            current_url = sb.get_current_url()
            log(f'📍 현재 URL: {current_url}')
            
            # 스크린샷 2
            sb.save_screenshot('/tmp/test_step2_after_booking_click.png')
            log('📸 /tmp/test_step2_after_booking_click.png')
            
            # 3. 로그인 페이지 감지 및 로그인
            log('📍 [3] 로그인 페이지 감지...')
            
            # 로그인이 필요한지 확인
            needs_login = (
                'login' in current_url.lower() or 
                'accounts' in current_url.lower() or 
                'nol' in current_url.lower() or
                'auth' in current_url.lower()
            )
            
            # DOM에서 로그인 폼 확인
            if not needs_login:
                login_form = sb.execute_script("""
                    var emailInput = document.querySelector('input[type="email"], input[name="email"], #email');
                    var pwdInput = document.querySelector('input[type="password"]');
                    return emailInput && pwdInput ? 'login form found' : 'no login form';
                """)
                if 'found' in login_form:
                    needs_login = True
                    log('🔐 DOM에서 로그인 폼 발견')
            
            if needs_login:
                log('🔐 로그인 필요!')
                
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
                        time.sleep(1.5)
                        break
                    except:
                        continue
                
                current_url = sb.get_current_url()
                log(f'📍 현재 URL: {current_url}')
                
                # 스크린샷 3
                sb.save_screenshot('/tmp/test_step3_login_page.png')
                log('📸 /tmp/test_step3_login_page.png')
                
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
                    except Exception as e:
                        log(f'  {sel} 실패: {str(e)[:30]}')
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
                    except Exception as e:
                        log(f'  {sel} 실패: {str(e)[:30]}')
                        continue
                
                if not pwd_entered:
                    log('⚠️ 비밀번호 입력 필드 못찾음')
                
                human_delay(200, 400)
                
                # 스크린샷 4
                sb.save_screenshot('/tmp/test_step4_credentials_entered.png')
                log('📸 /tmp/test_step4_credentials_entered.png')
                
                # 로그인 버튼 클릭
                log('📍 [5] 로그인 버튼 클릭...')
                
                login_btn_selectors = [
                    'button:contains("로그인")',
                    'button[type="submit"]',
                    'input[type="submit"]',
                    '[class*="login"][class*="btn"]',
                    'button[class*="submit"]',
                ]
                
                login_clicked = False
                for sel in login_btn_selectors:
                    try:
                        sb.uc_click(sel, reconnect_time=3)
                        log(f'✅ 로그인 버튼 클릭: {sel}')
                        login_clicked = True
                        break
                    except Exception as e:
                        log(f'  {sel} 실패: {str(e)[:30]}')
                        continue
                
                if not login_clicked:
                    # JS 클릭 시도
                    result = sb.execute_script("""
                        var btns = document.querySelectorAll('button');
                        for (var btn of btns) {
                            if (btn.textContent.includes('로그인')) {
                                btn.click();
                                return 'clicked: ' + btn.textContent.trim();
                            }
                        }
                        var submits = document.querySelectorAll('input[type="submit"], button[type="submit"]');
                        if (submits.length > 0) {
                            submits[0].click();
                            return 'clicked submit';
                        }
                        return 'not found';
                    """)
                    log(f'JS 로그인 버튼 클릭: {result}')
                
                # 로그인 완료 대기
                log('📍 [6] 로그인 완료 대기...')
                time.sleep(5)
                
                current_url = sb.get_current_url()
                log(f'📍 현재 URL: {current_url}')
                
                # 스크린샷 5
                sb.save_screenshot('/tmp/test_step5_after_login.png')
                log('📸 /tmp/test_step5_after_login.png')
                
                if 'login' not in current_url.lower() and 'auth' not in current_url.lower():
                    log('✅ 로그인 성공!')
                else:
                    log('⚠️ 아직 로그인 페이지에 있음')
                    
                    # 에러 메시지 확인
                    error_text = sb.execute_script("""
                        var errors = document.querySelectorAll('[class*="error"], [class*="alert"], [class*="message"]');
                        var result = [];
                        for (var e of errors) {
                            if (e.textContent.trim()) result.push(e.textContent.trim());
                        }
                        return result.join(' | ');
                    """)
                    if error_text:
                        log(f'❌ 에러 메시지: {error_text[:200]}')
            
            else:
                log('ℹ️ 로그인 페이지 아님')
            
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
