#!/usr/bin/env python3
"""
BTS 티켓팅 매크로 - SeleniumBase UC Mode
검증된 봇탐지 우회 방식
"""

import os
import time
import sys
from datetime import datetime
from dotenv import load_dotenv

# 환경변수 로드
load_dotenv('.env.local')
load_dotenv('../.env.local')

# 설정
USER_ID = os.getenv('INTERPARK_ID', '')
USER_PW = os.getenv('INTERPARK_PWD', '')
CONCERT_URL = os.getenv('CONCERT_URL', '')

def log(msg):
    """타임스탬프 로깅"""
    now = datetime.now().strftime('%H:%M:%S.%f')[:-3]
    print(f'[{now}] {msg}')

def run_ticketing(target_url=None, target_hour=20, target_minute=0, headless=False):
    """티켓팅 실행"""
    from seleniumbase import SB
    
    url = target_url or CONCERT_URL
    if not url:
        log('❌ CONCERT_URL 설정 필요!')
        return False
    
    log(f'🎯 타겟: {url}')
    log(f'⏰ 예매 시작 시간: {target_hour:02d}:{target_minute:02d}')
    
    with SB(uc=True, headless=headless, incognito=True) as sb:
        try:
            # === 1단계: 로그인 ===
            log('📍 [1/5] 공연 페이지 접속...')
            sb.uc_open_with_reconnect(url, reconnect_time=4)
            time.sleep(1)
            
            # 예매하기 클릭 → 로그인 페이지
            log('📍 [2/5] 예매하기 클릭...')
            sb.click_link('예매하기')
            time.sleep(2)
            
            # 이메일 로그인
            log('📍 [3/5] 이메일 로그인...')
            try:
                sb.click_link('이메일로 시작하기')
                time.sleep(2)
            except:
                # 이미 이메일 페이지일 수 있음
                pass
            
            # Turnstile 처리
            log('🔒 Turnstile 처리...')
            try:
                sb.uc_gui_handle_captcha()
            except:
                pass
            time.sleep(1)
            
            # 로그인 정보 입력
            log(f'📝 로그인: {USER_ID[:5]}***')
            sb.type('#email', USER_ID)
            sb.type('#password', USER_PW)
            sb.uc_click('button:contains("로그인")', reconnect_time=3)
            time.sleep(3)
            
            log('✅ 로그인 완료!')
            
            # === 2단계: 예매 대기 ===
            log('📍 [4/5] 예매 대기...')
            
            # 대기 루프
            while True:
                now = datetime.now()
                target_time = now.replace(hour=target_hour, minute=target_minute, second=0, microsecond=0)
                
                if now >= target_time:
                    break
                
                remaining = (target_time - now).total_seconds()
                if remaining > 60:
                    log(f'⏳ {int(remaining//60)}분 {int(remaining%60)}초 남음...')
                    time.sleep(30)
                elif remaining > 10:
                    log(f'⏳ {int(remaining)}초 남음...')
                    time.sleep(5)
                else:
                    log(f'⏳ {remaining:.1f}초!')
                    time.sleep(0.5)
            
            # === 3단계: 예매 시도 ===
            log('📍 [5/5] 예매 시작!')
            
            # 페이지 새로고침
            sb.refresh()
            time.sleep(0.5)
            
            # 예매하기 버튼 연타
            for attempt in range(10):
                try:
                    sb.click_link('예매하기')
                    log(f'🔘 예매 버튼 클릭 #{attempt+1}')
                    time.sleep(0.3)
                    
                    # URL 변경 확인
                    current_url = sb.get_current_url()
                    if 'book' in current_url.lower() or 'seat' in current_url.lower():
                        log('✅ 예매 페이지 진입!')
                        break
                except:
                    pass
            
            # === 4단계: 좌석 선택 ===
            log('🪑 좌석 선택 페이지...')
            time.sleep(2)
            
            # 취소/환불 안내 모달 닫기
            log('📋 모달 처리...')
            try:
                # "확인하고 예매하기" 버튼 클릭
                confirm_btn = sb.find_element('button:contains("확인하고 예매하기")')
                if confirm_btn:
                    confirm_btn.click()
                    log('✅ 모달 확인 클릭')
                    time.sleep(1)
            except:
                try:
                    # X 버튼으로 닫기
                    close_btn = sb.find_element('[class*="close"], [aria-label*="close"], button:contains("×")')
                    if close_btn:
                        close_btn.click()
                        log('✅ 모달 X 클릭')
                        time.sleep(1)
                except:
                    log('⚠️ 모달 없거나 이미 닫힘')
            
            # 좌석 클릭 시도 (다양한 셀렉터)
            log('🔍 좌석 탐색...')
            seat_selectors = [
                # SVG 기반 좌석
                "circle[class*='seat']",
                "rect[class*='seat']",
                "[class*='seat'][class*='available']",
                "[class*='seat']:not([class*='sold']):not([class*='disabled'])",
                # 스탠딩 구역
                "[class*='standing']",
                "[class*='area']:not([class*='sold'])",
                # 일반 좌석
                "div[class*='seat']",
                "span[class*='seat']",
                # 클릭 가능한 요소
                "[data-seat]",
                "[data-available='true']"
            ]
            
            seat_clicked = False
            for sel in seat_selectors:
                try:
                    seats = sb.find_elements(sel)
                    available_seats = [s for s in seats if s.is_displayed()]
                    if available_seats:
                        log(f'✅ 좌석 발견! ({len(available_seats)}개) - {sel}')
                        available_seats[0].click()
                        log('🪑 첫 번째 좌석 클릭!')
                        seat_clicked = True
                        time.sleep(1)
                        break
                except Exception as e:
                    continue
            
            if not seat_clicked:
                # 좌석 맵 영역 클릭 시도 (좌표 기반)
                log('📍 좌표 기반 좌석 클릭 시도...')
                try:
                    # 좌석 맵 영역 찾기
                    seat_map = sb.find_element('[class*="seat-map"], [class*="seatMap"], svg, canvas')
                    if seat_map:
                        # 중앙 근처 클릭
                        sb.execute_script("arguments[0].click();", seat_map)
                        log('🪑 좌석 맵 클릭!')
                        time.sleep(1)
                except:
                    log('⚠️ 좌석 선택 실패 - 수동 선택 필요')
            
            # 선택 완료 버튼
            log('🔘 선택 완료 버튼...')
            try:
                complete_btn = sb.find_element('button:contains("선택 완료"), button:contains("다음"), [class*="complete"]')
                if complete_btn:
                    complete_btn.click()
                    log('✅ 선택 완료 클릭!')
                    time.sleep(2)
            except:
                log('⚠️ 선택 완료 버튼 대기 중')
            
            # 스크린샷 저장
            sb.save_screenshot('/tmp/ticketing_result.png')
            log('📸 /tmp/ticketing_result.png')
            
            return True
            
        except Exception as e:
            log(f'❌ 에러: {e}')
            sb.save_screenshot('/tmp/ticketing_error.png')
            return False

def main():
    import argparse
    parser = argparse.ArgumentParser(description='BTS 티켓팅 매크로')
    parser.add_argument('--url', help='공연 URL')
    parser.add_argument('--hour', type=int, default=20, help='예매 시작 시간 (시)')
    parser.add_argument('--minute', type=int, default=0, help='예매 시작 시간 (분)')
    parser.add_argument('--headless', action='store_true', help='헤드리스 모드')
    parser.add_argument('--test', action='store_true', help='즉시 테스트 (대기 없음)')
    
    args = parser.parse_args()
    
    if args.test:
        # 즉시 실행 (대기 없음)
        now = datetime.now()
        args.hour = now.hour
        args.minute = now.minute
    
    success = run_ticketing(
        target_url=args.url,
        target_hour=args.hour,
        target_minute=args.minute,
        headless=args.headless
    )
    
    sys.exit(0 if success else 1)

if __name__ == '__main__':
    main()
