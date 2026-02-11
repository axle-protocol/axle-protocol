#!/usr/bin/env python3
"""
BTS 광화문 티켓팅 매크로 - Nodriver 버전 (2026 최신)

Nodriver = undetected-chromedriver 후속작
- 더 빠르고 안정적
- Turnstile CAPTCHA 우회 가능
- CDP 직접 사용 (Selenium 없음)

Usage:
    python main_nodriver.py --test      # 테스트 모드
    python main_nodriver.py --live      # 실전 모드 (2/23 오후 8시)
"""

import nodriver as nd
import asyncio
import random
import argparse
from datetime import datetime
from zoneinfo import ZoneInfo
import aiohttp
import os
import traceback
import time
import io

# ============ 설정 ============
CONFIG = {
    # 로그인 (환경변수에서 읽기)
    'USER_ID': os.getenv('INTERPARK_ID', ''),
    'USER_PWD': os.getenv('INTERPARK_PWD', ''),
    
    # 공연 URL (BTS 광화문)
    'CONCERT_URL': 'https://tickets.interpark.com/goods/XXXXXXX',  # TODO: 실제 URL
    
    # 티켓 오픈 시간 (KST)
    'OPEN_TIME': datetime(2026, 2, 23, 20, 0, 0, tzinfo=ZoneInfo('Asia/Seoul')),
    
    # 좌석 우선순위
    'SEAT_PRIORITY': ['VIP', 'R석', 'S석', 'A석'],
    
    # 결제 정보
    'BIRTH_DATE': '',  # YYMMDD
    
    # 텔레그램 알림
    'TELEGRAM_BOT_TOKEN': os.getenv('TELEGRAM_BOT_TOKEN', ''),
    'TELEGRAM_CHAT_ID': os.getenv('TELEGRAM_CHAT_ID', ''),
}

# ============ 유틸리티 ============

def validate_config():
    """설정 검증"""
    required = ['USER_ID', 'USER_PWD']
    for key in required:
        if not CONFIG[key]:
            raise ValueError(f"필수 설정 누락: {key} (환경변수 INTERPARK_ID, INTERPARK_PWD 확인)")
    print("✅ 설정 검증 완료")

# 전역 aiohttp 세션 (재사용)
_http_session: aiohttp.ClientSession = None

async def get_http_session() -> aiohttp.ClientSession:
    """HTTP 세션 싱글톤"""
    global _http_session
    if _http_session is None or _http_session.closed:
        _http_session = aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=10))
    return _http_session

async def send_telegram(message: str):
    """텔레그램 알림 (비동기, 세션 재사용)"""
    if not CONFIG['TELEGRAM_BOT_TOKEN']:
        print(f"[알림] {message}")
        return
    
    url = f"https://api.telegram.org/bot{CONFIG['TELEGRAM_BOT_TOKEN']}/sendMessage"
    data = {
        'chat_id': CONFIG['TELEGRAM_CHAT_ID'],
        'text': f"🎫 BTS 티켓팅\n{message}",
    }
    try:
        session = await get_http_session()
        async with session.post(url, data=data) as resp:
            if resp.status != 200:
                print(f"[경고] 텔레그램 전송 실패: HTTP {resp.status}")
    except Exception as e:
        print(f"[오류] 텔레그램 전송 실패: {e}")

async def human_delay(min_sec=0.5, max_sec=2.0):
    """인간처럼 랜덤 대기"""
    await asyncio.sleep(random.uniform(min_sec, max_sec))

async def human_type(element, text):
    """인간처럼 타이핑"""
    for char in text:
        await element.send_keys(char)
        await asyncio.sleep(random.uniform(0.05, 0.15))

# ============ 메인 로직 ============

async def run_ticketing(is_live: bool):
    print("🎫 BTS 광화문 티켓팅 시작 (Nodriver)")
    print(f"오픈 시간: {CONFIG['OPEN_TIME']}")
    print(f"현재 시간: {datetime.now(ZoneInfo('Asia/Seoul'))}")
    print("-" * 50)
    
    # 브라우저 시작
    browser = await nd.start(
        headless=False,
        browser_args=[
            '--window-size=1920,1080',
            '--lang=ko-KR',
            '--no-sandbox',
            '--disable-dev-shm-usage',
        ]
    )
    
    try:
        # 1. 인터파크 접속
        print("[1/6] 인터파크 접속...")
        page = await browser.get('https://tickets.interpark.com/')
        await human_delay(1, 2)
        
        # 2. 로그인
        print("[2/6] 로그인...")
        login_btn = await page.find('로그인', timeout=10)
        if login_btn:
            await login_btn.click()
            await human_delay()
            
            # iframe 처리 (Nodriver는 자동으로 iframe 접근)
            user_id = await page.find('input#userId', timeout=10)
            if user_id:
                await human_type(user_id, CONFIG['USER_ID'])
                await human_delay(0.3, 0.5)
                
                user_pwd = await page.find('input#userPwd')
                if not user_pwd:
                    print("❌ 비밀번호 입력 필드를 찾을 수 없음")
                    return
                await human_type(user_pwd, CONFIG['USER_PWD'])
                await human_delay(0.3, 0.5)
                
                await user_pwd.send_keys('\n')  # Enter
                await human_delay(2, 3)
                
                # 로그인 성공 확인 (조건문 방식)
                logout_btn = await page.find('로그아웃', timeout=5)
                if logout_btn:
                    print("✅ 로그인 성공 확인됨 (로그아웃 버튼 발견)")
                else:
                    login_check = await page.find('로그인', timeout=2)
                    if login_check:
                        print("❌ 로그인 실패: 로그인 버튼이 여전히 존재")
                        await send_telegram("❌ 로그인 실패!")
                        return
                    else:
                        print("✅ 로그인 완료 (추정)")
        else:
            print("❌ 로그인 버튼을 찾을 수 없음")
            return
        
        print("✅ 로그인 완료")
        
        # 3. 공연 페이지 이동
        print("[3/6] 공연 페이지 이동...")
        await page.get(CONFIG['CONCERT_URL'])
        await human_delay(1, 2)
        
        # 4. 오픈 대기 (실전 모드만)
        if is_live:
            print("[4/6] 오픈 대기...")
            while datetime.now(ZoneInfo('Asia/Seoul')) < CONFIG['OPEN_TIME']:
                remaining = (CONFIG['OPEN_TIME'] - datetime.now(ZoneInfo('Asia/Seoul'))).total_seconds()
                if remaining > 60:
                    print(f"⏳ 오픈까지 {int(remaining)}초...")
                    await asyncio.sleep(30)
                    await page.reload()
                elif remaining > 5:
                    print(f"⏳ {int(remaining)}초...")
                    await asyncio.sleep(1)
                else:
                    await asyncio.sleep(0.1)
            print("🚀 오픈!")
        
        # 5. 예매 버튼 클릭
        print("[5/6] 예매 버튼 클릭...")
        booking_success = False
        for attempt in range(10):
            try:
                # 다중 셀렉터 시도
                booking_btn = await page.find('예매하기', timeout=2)
                if not booking_btn:
                    booking_btn = await page.find('button.booking', timeout=1)
                if not booking_btn:
                    booking_btn = await page.find('[class*="booking"]', timeout=1)
                if booking_btn:
                    await booking_btn.click()
                    print(f"✅ 예매 버튼 클릭 성공 (시도 {attempt + 1})")
                    booking_success = True
                    break
            except Exception as e:
                print(f"[시도 {attempt + 1}] 예매 버튼 찾기 실패: {e}")
                await page.reload()
                # Exponential backoff: 0.5s, 1s, 2s, 4s... (최대 5초)
                backoff = min(0.5 * (2 ** attempt), 5)
                await asyncio.sleep(backoff)
        
        if not booking_success:
            await send_telegram("❌ 예매 버튼 10회 시도 실패!")
            print("❌ 예매 버튼을 찾지 못했습니다")
            return
        
        await human_delay(2, 3)
        
        # 6. 좌석 선택
        print("[6/6] 좌석 선택...")
        await send_telegram("⚠️ 예매창 열림! CAPTCHA 확인하세요!")
        
        # 좌석 등급별 시도 (SEAT_PRIORITY 사용)
        seat_found = False
        max_attempts = 50
        
        for attempt in range(max_attempts):
            # 우선순위별 좌석 등급 시도
            for seat_grade in CONFIG['SEAT_PRIORITY']:
                try:
                    # 다중 셀렉터 시도
                    seat = await page.find(f'text={seat_grade}', timeout=1)
                    if not seat:
                        seat = await page.find(f'[data-grade="{seat_grade}"]', timeout=1)
                    if not seat:
                        seat = await page.find(f'.seat-{seat_grade.lower()}', timeout=1)
                    
                    if seat:
                        await seat.click()
                        await send_telegram(f"🎉 {seat_grade} 좌석 선택!")
                        print(f"✅ {seat_grade} 좌석 선택 완료!")
                        seat_found = True
                        break
                except Exception as e:
                    continue
            
            if seat_found:
                break
            
            print(f"시도 {attempt + 1}/{max_attempts}: 좌석 찾는 중...")
            
            # 새로고침 시도 (exponential backoff)
            try:
                refresh = await page.find('새로고침', timeout=1)
                if refresh:
                    await refresh.click()
            except Exception:
                pass
            # Human-like delay with backoff (1-3초)
            await human_delay(1, min(3, 1 + attempt * 0.1))
        
        if not seat_found:
            await send_telegram("⚠️ 자동 좌석 선택 실패 - 수동으로 선택하세요!")
            print("⚠️ 자동 좌석 선택 실패")
        
        # 결제는 수동
        await send_telegram("💳 결제 화면에서 직접 결제하세요!")
        print("\n" + "=" * 50)
        print("🎉 좌석 선택 완료! 결제를 진행하세요!")
        print("=" * 50)
        
        # 결제 완료 대기 (30분 타임아웃)
        print("💡 결제 완료 후 Ctrl+C로 종료하세요... (30분 후 자동 종료)")
        deadline = time.time() + 1800  # 30분
        while time.time() < deadline:
            await asyncio.sleep(60)
            remaining = int((deadline - time.time()) / 60)
            print(f"⏳ 남은 대기 시간: {remaining}분")
        
        await send_telegram("⏰ 30분 타임아웃 - 자동 종료")
        print("⏰ 30분 타임아웃 - 자동 종료")
        
    except (KeyboardInterrupt, asyncio.CancelledError):
        print("\n⛔ 사용자가 중단함 (Ctrl+C)")
        try:
            await send_telegram("⛔ 사용자가 중단함")
        except Exception:
            pass
    except Exception as e:
        # 비밀번호 마스킹
        error_msg = str(e)
        if CONFIG['USER_PWD'] and CONFIG['USER_PWD'] in error_msg:
            error_msg = error_msg.replace(CONFIG['USER_PWD'], '****')
        
        # send_telegram 실패해도 원본 에러 보존
        try:
            await send_telegram(f"❌ 오류: {error_msg}")
        except Exception:
            pass
        
        print(f"오류: {error_msg}")
        # traceback도 마스킹 (credential 보호)
        tb_buffer = io.StringIO()
        traceback.print_exc(file=tb_buffer)
        tb_str = tb_buffer.getvalue()
        if CONFIG['USER_PWD'] and CONFIG['USER_PWD'] in tb_str:
            tb_str = tb_str.replace(CONFIG['USER_PWD'], '****')
        print(tb_str)
    
    finally:
        # 브라우저 종료 (nodriver는 동기식 stop)
        try:
            if browser:
                browser.stop()
                print("🔒 브라우저 종료됨")
        except Exception as cleanup_err:
            print(f"[경고] 브라우저 종료 중 오류: {cleanup_err}")
        
        # HTTP 세션 종료
        global _http_session
        if _http_session and not _http_session.closed:
            await _http_session.close()
            print("🔒 HTTP 세션 종료됨")

# ============ 진입점 ============

def main():
    parser = argparse.ArgumentParser(description='BTS 티켓팅 (Nodriver)')
    parser.add_argument('--test', action='store_true', help='테스트 모드')
    parser.add_argument('--live', action='store_true', help='실전 모드')
    args = parser.parse_args()
    
    if not args.test and not args.live:
        print("사용법: python main_nodriver.py --test 또는 --live")
        return
    
    # 설정 검증
    try:
        validate_config()
    except ValueError as e:
        print(f"❌ {e}")
        return
    
    nd.loop().run_until_complete(run_ticketing(is_live=args.live))

if __name__ == '__main__':
    main()
