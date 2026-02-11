#!/usr/bin/env python3
"""간단한 페이지 로드 테스트"""

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
    
    with SB(uc=True, headless=False, incognito=True, locale_code='ko') as sb:
        log('페이지 열기 시작...')
        
        # 일반 open 사용 (reconnect 없이)
        sb.open(CONCERT_URL)
        
        log('페이지 열림!')
        log(f'제목: {sb.get_title()}')
        
        # 스크린샷
        sb.save_screenshot('/tmp/quick_test.png')
        log('스크린샷: /tmp/quick_test.png')
        
        # 대기
        time.sleep(10)

if __name__ == '__main__':
    test()
