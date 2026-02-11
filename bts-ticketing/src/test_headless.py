#!/usr/bin/env python3
"""headless 테스트"""

import os
import time
from dotenv import load_dotenv

load_dotenv('.env.local')
load_dotenv('../.env.local')

CONCERT_URL = os.getenv('CONCERT_URL', 'https://tickets.interpark.com/goods/26004867')

def log(msg):
    from datetime import datetime
    print(f'[{datetime.now().strftime("%H:%M:%S")}] {msg}', flush=True)

def test():
    from seleniumbase import SB
    
    log(f'URL: {CONCERT_URL}')
    
    # headless 모드
    with SB(uc=True, headless=True, incognito=True, locale_code='ko') as sb:
        log('페이지 열기 시작...')
        
        sb.open(CONCERT_URL)
        time.sleep(2)
        
        log(f'URL: {sb.get_current_url()}')
        
        try:
            title = sb.get_title()
            log(f'제목: {title}')
        except Exception as e:
            log(f'제목 가져오기 실패: {e}')
        
        # 페이지 소스 확인
        source = sb.get_page_source()
        log(f'페이지 길이: {len(source)}')
        
        if len(source) > 100:
            log(f'페이지 시작: {source[:500]}')
        
        # 스크린샷
        sb.save_screenshot('/tmp/headless_test.png')
        log('스크린샷: /tmp/headless_test.png')
        
        # 예매하기 버튼 찾기
        try:
            booking_js = sb.execute_script("""
                var all = document.querySelectorAll('a, button');
                var result = [];
                for (var elem of all) {
                    var text = (elem.textContent || '').trim();
                    if (text.includes('예매') || text.includes('booking')) {
                        result.push({
                            tag: elem.tagName,
                            text: text.substring(0, 50),
                            href: elem.href || ''
                        });
                    }
                }
                return result;
            """)
            log(f'예매 버튼들: {booking_js}')
        except Exception as e:
            log(f'JS 실행 실패: {e}')

if __name__ == '__main__':
    test()
