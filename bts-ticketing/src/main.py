#!/usr/bin/env python3
"""
BTS 광화문 티켓팅 매크로 - OpenClaw Enhanced
2026-02-23 오후 8시 티켓 오픈 대비

Usage:
    python main.py --test      # 테스트 모드 (다른 공연)
    python main.py --live      # 실전 모드 (BTS 광화문)
"""

import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.support.ui import Select
import time
import random
import argparse
import logging
from datetime import datetime
import requests
import os

# 로깅 설정
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(message)s',
    datefmt='%H:%M:%S'
)
logger = logging.getLogger(__name__)

# ============ 설정 ============
CONFIG = {
    # 로그인 (환경변수에서 읽기)
    'USER_ID': os.getenv('INTERPARK_ID', ''),
    'USER_PWD': os.getenv('INTERPARK_PWD', ''),
    
    # 공연 URL (BTS 광화문)
    'CONCERT_URL': 'https://tickets.interpark.com/goods/XXXXXXX',  # TODO: 실제 URL
    
    # 티켓 오픈 시간
    'OPEN_TIME': datetime(2026, 2, 23, 20, 0, 0),
    
    # 좌석 우선순위
    'SEAT_PRIORITY': ['VIP', 'R석', 'S석', 'A석'],
    
    # 결제 정보
    'BIRTH_DATE': '',  # YYMMDD
    
    # 텔레그램 알림
    'TELEGRAM_BOT_TOKEN': os.getenv('TELEGRAM_BOT_TOKEN', ''),
    'TELEGRAM_CHAT_ID': os.getenv('TELEGRAM_CHAT_ID', ''),
    
    # 감지 우회
    'RANDOM_DELAY_MIN': 0.5,
    'RANDOM_DELAY_MAX': 2.0,
    'HUMAN_LIKE_TYPING': True,
}

# ============ 유틸리티 ============

def send_telegram(message: str):
    """텔레그램 알림 전송"""
    if not CONFIG['TELEGRAM_BOT_TOKEN']:
        print(f"[알림] {message}")
        return
    
    url = f"https://api.telegram.org/bot{CONFIG['TELEGRAM_BOT_TOKEN']}/sendMessage"
    data = {
        'chat_id': CONFIG['TELEGRAM_CHAT_ID'],
        'text': f"🎫 BTS 티켓팅\n{message}",
        'parse_mode': 'HTML'
    }
    try:
        resp = requests.post(url, data=data, timeout=5)
        if resp.status_code != 200:
            logger.warning(f"텔레그램 전송 실패: HTTP {resp.status_code}")
    except requests.RequestException as e:
        logger.error(f"텔레그램 전송 오류: {e}")

def human_delay(min_sec=None, max_sec=None):
    """인간처럼 랜덤 대기"""
    min_s = min_sec or CONFIG['RANDOM_DELAY_MIN']
    max_s = max_sec or CONFIG['RANDOM_DELAY_MAX']
    time.sleep(random.uniform(min_s, max_s))

def human_type(element, text):
    """인간처럼 타이핑"""
    if CONFIG['HUMAN_LIKE_TYPING']:
        for char in text:
            element.send_keys(char)
            time.sleep(random.uniform(0.05, 0.15))
    else:
        element.send_keys(text)

# ============ 브라우저 초기화 ============

def init_driver():
    """undetected-chromedriver 초기화"""
    options = uc.ChromeOptions()
    
    # 창 크기 (일반적인 해상도)
    options.add_argument('--window-size=1920,1080')
    
    # Mac용 설정
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    
    # GPU 활성화 (감지 우회)
    options.add_argument('--enable-gpu')
    options.add_argument('--enable-webgl')
    
    driver = uc.Chrome(options=options)
    driver.implicitly_wait(5)
    
    return driver

# ============ 로그인 ============

def login(driver) -> bool:
    """인터파크 로그인

    Returns:
        True: 로그인 성공, False: 로그인 실패
    """
    logger.info("[1/6] 로그인 중...")

    if not CONFIG['USER_ID'] or not CONFIG['USER_PWD']:
        logger.error("로그인 정보가 설정되지 않았습니다 (INTERPARK_ID, INTERPARK_PWD)")
        return False

    driver.get('https://tickets.interpark.com/')
    human_delay()

    # 로그인 버튼 클릭 (폴백 셀렉터 포함)
    login_btn = None
    for selector in [
        (By.LINK_TEXT, '로그인'),
        (By.CSS_SELECTOR, 'a[href*="login"], .login-btn, .btn-login'),
        (By.XPATH, "//a[contains(text(), '로그인')]"),
    ]:
        try:
            login_btn = driver.find_element(*selector)
            break
        except Exception:
            continue

    if not login_btn:
        logger.error("로그인 버튼을 찾을 수 없습니다")
        return False

    login_btn.click()
    human_delay()

    # iframe으로 전환 (폴백 셀렉터 포함)
    login_iframe = None
    for selector in [
        (By.XPATH, "//div[@class='leftLoginBox']/iframe[@title='login']"),
        (By.CSS_SELECTOR, "iframe[title='login'], iframe[src*='login']"),
        (By.TAG_NAME, 'iframe'),
    ]:
        try:
            login_iframe = driver.find_element(*selector)
            break
        except Exception:
            continue

    if not login_iframe:
        logger.error("로그인 iframe을 찾을 수 없습니다")
        return False

    driver.switch_to.frame(login_iframe)

    # ID 입력 (폴백 셀렉터 포함)
    user_id = None
    for selector in [
        (By.ID, 'userId'),
        (By.CSS_SELECTOR, "input[name='userId'], input[type='text'][placeholder*='아이디']"),
    ]:
        try:
            user_id = driver.find_element(*selector)
            break
        except Exception:
            continue

    if not user_id:
        logger.error("아이디 입력 필드를 찾을 수 없습니다")
        driver.switch_to.default_content()
        return False

    human_type(user_id, CONFIG['USER_ID'])
    human_delay(0.3, 0.5)

    # PW 입력 (폴백 셀렉터 포함)
    user_pwd = None
    for selector in [
        (By.ID, 'userPwd'),
        (By.CSS_SELECTOR, "input[name='userPwd'], input[type='password']"),
    ]:
        try:
            user_pwd = driver.find_element(*selector)
            break
        except Exception:
            continue

    if not user_pwd:
        logger.error("비밀번호 입력 필드를 찾을 수 없습니다")
        driver.switch_to.default_content()
        return False

    human_type(user_pwd, CONFIG['USER_PWD'])
    human_delay(0.3, 0.5)

    # 로그인
    user_pwd.send_keys(Keys.ENTER)

    # 메인 프레임 복귀
    driver.switch_to.default_content()
    human_delay(1, 2)

    # 로그인 성공 확인: 로그인 버튼이 사라졌거나 '로그아웃'이 보이면 성공
    try:
        driver.find_element(By.LINK_TEXT, '로그아웃')
        logger.info("로그인 성공 확인됨 (로그아웃 버튼 발견)")
        return True
    except Exception:
        pass

    # 로그인 버튼이 여전히 있으면 실패
    try:
        driver.find_element(By.LINK_TEXT, '로그인')
        logger.error("로그인 실패: 로그인 버튼이 여전히 존재합니다")
        return False
    except Exception:
        # 로그인 버튼이 없으면 성공으로 간주
        logger.info("로그인 완료 (추정)")
        return True

# ============ 공연 페이지 이동 ============

def navigate_to_concert(driver):
    """공연 페이지로 이동"""
    print("[2/6] 공연 페이지 이동...")
    
    driver.get(CONFIG['CONCERT_URL'])
    human_delay(1, 2)
    
    print("✅ 공연 페이지 도착")
    return True

# ============ 오픈 대기 ============

def wait_for_open(driver):
    """티켓 오픈 시간까지 대기"""
    print("[3/6] 오픈 대기 중...")
    
    while datetime.now() < CONFIG['OPEN_TIME']:
        remaining = (CONFIG['OPEN_TIME'] - datetime.now()).total_seconds()
        
        if remaining > 60:
            print(f"⏳ 오픈까지 {int(remaining)}초 남음...")
            time.sleep(30)
            driver.refresh()  # 주기적 새로고침
        elif remaining > 5:
            print(f"⏳ 오픈까지 {int(remaining)}초...")
            time.sleep(1)
        else:
            print("🚀 준비!")
            time.sleep(0.1)
    
    print("✅ 오픈 시간!")
    return True

# ============ 예매 버튼 클릭 ============

def click_booking(driver) -> bool:
    """예매하기 버튼 클릭

    Returns:
        True: 예매 창 열림, False: 실패
    """
    logger.info("[4/6] 예매 버튼 클릭...")

    # 예매하기 버튼 (여러 셀렉터 + 여러 번 시도)
    booking_selectors = [
        (By.XPATH, '//*[@id="productSide"]/div/div[2]/a[1]'),
        (By.CSS_SELECTOR, 'a.btn_book, .side-box a[href*="book"], .btn-booking'),
        (By.XPATH, "//a[contains(text(), '예매하기') or contains(text(), '예매')]"),
        (By.CSS_SELECTOR, '#productSide a'),
    ]

    clicked = False
    for attempt in range(10):
        for selector in booking_selectors:
            try:
                booking_btn = WebDriverWait(driver, 2).until(
                    EC.element_to_be_clickable(selector)
                )
                booking_btn.click()
                clicked = True
                break
            except Exception as e:
                logger.debug(f"셀렉터 {selector} 실패: {e}")
                continue

        if clicked:
            break

        logger.info(f"예매 버튼 시도 {attempt + 1}/10 실패, 새로고침...")
        driver.refresh()
        human_delay(0.5, 1)

    if not clicked:
        logger.error("예매 버튼을 찾을 수 없습니다 (10회 시도 실패)")
        return False

    # 새 탭으로 전환
    human_delay(1, 2)
    initial_handles = len(driver.window_handles)
    if initial_handles > 1:
        driver.switch_to.window(driver.window_handles[-1])
        logger.info("예매 창 열림")
        return True
    else:
        logger.warning("새 탭이 열리지 않았습니다. 현재 탭에서 계속 진행합니다.")
        return True

# ============ CAPTCHA 처리 ============

def handle_captcha(driver) -> bool:
    """CAPTCHA 처리 (수동 입력)

    Returns:
        True: CAPTCHA 처리 완료 (또는 없음), False: iframe 전환 실패
    """
    logger.info("[5/6] CAPTCHA 대기...")

    # 좌석 iframe으로 전환 (폴백 셀렉터)
    iframe = None
    for selector in [
        (By.ID, 'ifrmSeat'),
        (By.CSS_SELECTOR, "iframe[name='ifrmSeat'], iframe[src*='seat']"),
    ]:
        try:
            iframe = driver.find_element(*selector)
            break
        except Exception:
            continue

    if not iframe:
        logger.error("좌석 iframe을 찾을 수 없습니다")
        return False

    driver.switch_to.frame(iframe)

    # CAPTCHA 확인
    try:
        captcha = driver.find_element(By.ID, 'imgCaptcha')
        if captcha.is_displayed():
            send_telegram("CAPTCHA 입력 필요!\n화면을 확인하고 직접 입력해주세요.")
            logger.warning("CAPTCHA 감지됨! 30초 내에 입력해주세요...")
            time.sleep(30)
    except Exception:
        logger.info("CAPTCHA 없음 - 계속 진행")

    driver.switch_to.default_content()
    logger.info("CAPTCHA 처리 완료")
    return True

# ============ 좌석 선택 ============

def select_seat(driver) -> bool:
    """좌석 선택

    Returns:
        True: 좌석 선택 성공, False: 매진 또는 실패
    """
    logger.info("[6/6] 좌석 선택 중...")

    # iframe 전환 (폴백 셀렉터)
    iframe = None
    for selector in [
        (By.ID, 'ifrmSeat'),
        (By.CSS_SELECTOR, "iframe[name='ifrmSeat'], iframe[src*='seat']"),
    ]:
        try:
            iframe = driver.find_element(*selector)
            break
        except Exception:
            continue

    if not iframe:
        logger.error("좌석 iframe을 찾을 수 없습니다")
        return False

    driver.switch_to.frame(iframe)

    max_attempts = 100
    for attempt in range(max_attempts):
        try:
            # 세부 구역 선택 (폴백 셀렉터)
            grade_clicked = False
            for selector in [
                (By.XPATH, '//*[@id="GradeDetail"]/div/ul/li[1]/a'),
                (By.CSS_SELECTOR, '#GradeDetail li:first-child a, #GradeDetail li a'),
                (By.XPATH, "//div[@id='GradeDetail']//a"),
            ]:
                try:
                    driver.find_element(*selector).click()
                    grade_clicked = True
                    break
                except Exception:
                    continue

            if not grade_clicked:
                logger.debug(f"시도 {attempt + 1}: 구역 셀렉터 실패")

            human_delay(0.3, 0.5)

            # 좌석 상세 iframe (폴백 셀렉터)
            seat_iframe = None
            for selector in [
                (By.ID, 'ifrmSeatDetail'),
                (By.CSS_SELECTOR, "iframe[name='ifrmSeatDetail'], iframe[src*='seatDetail']"),
            ]:
                try:
                    seat_iframe = driver.find_element(*selector)
                    break
                except Exception:
                    continue

            if seat_iframe:
                driver.switch_to.frame(seat_iframe)

            # 좌석 클릭 (폴백 셀렉터)
            seat_clicked = False
            for selector in [
                (By.ID, 'Seats'),
                (By.CSS_SELECTOR, '#Seats, .seat-map, svg[id*="seat"]'),
            ]:
                try:
                    seats = driver.find_element(*selector)
                    seats.click()
                    seat_clicked = True
                    break
                except Exception:
                    continue

            if not seat_clicked:
                raise Exception("좌석 요소를 찾을 수 없음")

            send_telegram("좌석 선택 성공!")
            logger.info("좌석 선택 완료!")

            # 다음 단계 버튼
            driver.switch_to.default_content()
            driver.switch_to.frame(driver.find_element(By.ID, 'ifrmSeat'))

            next_clicked = False
            for selector in [
                (By.ID, 'NextStepImage'),
                (By.CSS_SELECTOR, '#NextStepImage, img[id*="NextStep"], a[id*="NextStep"]'),
                (By.XPATH, "//img[contains(@id, 'NextStep')] | //a[contains(text(), '다음')]"),
            ]:
                try:
                    driver.find_element(*selector).click()
                    next_clicked = True
                    break
                except Exception:
                    continue

            if not next_clicked:
                logger.warning("다음 단계 버튼을 찾을 수 없습니다")

            return True

        except Exception as e:
            logger.debug(f"시도 {attempt + 1}/{max_attempts}: {e}")
            driver.switch_to.default_content()

            # iframe 재전환
            try:
                driver.switch_to.frame(driver.find_element(By.ID, 'ifrmSeat'))
            except Exception as iframe_err:
                logger.error(f"iframe 재전환 실패: {iframe_err}")
                break

            # 새로고침 버튼 (폴백 셀렉터)
            for selector in [
                (By.XPATH, '/html/body/form[1]/div/div[1]/div[3]/div/p/a/img'),
                (By.CSS_SELECTOR, 'a[href*="refresh"] img, .btn-refresh, a.refresh'),
                (By.XPATH, "//a[contains(@onclick, 'refresh') or contains(@href, 'refresh')]"),
            ]:
                try:
                    driver.find_element(*selector).click()
                    break
                except Exception:
                    continue

            human_delay(0.5, 1)

    send_telegram("좌석 선택 실패 (매진)")
    logger.warning("좌석 선택 실패: 100회 시도 후 매진")
    return False

# ============ 메인 ============

def validate_config():
    """설정 검증"""
    required = ['USER_ID', 'USER_PWD']
    for key in required:
        if not CONFIG[key]:
            raise ValueError(f"필수 설정 누락: {key} (환경변수 INTERPARK_ID, INTERPARK_PWD 확인)")
    print("✅ 설정 검증 완료")

def main():
    parser = argparse.ArgumentParser(description='BTS 티켓팅 매크로')
    parser.add_argument('--test', action='store_true', help='테스트 모드')
    parser.add_argument('--live', action='store_true', help='실전 모드')
    args = parser.parse_args()
    
    if not args.test and not args.live:
        print("사용법: python main.py --test 또는 --live")
        return
    
    # 설정 검증
    try:
        validate_config()
    except ValueError as e:
        print(f"❌ {e}")
        return
    
    print("🎫 BTS 광화문 티켓팅 매크로 시작")
    print(f"오픈 시간: {CONFIG['OPEN_TIME']}")
    print(f"현재 시간: {datetime.now()}")
    print("-" * 50)
    
    driver = None
    try:
        driver = init_driver()
        
        login(driver)
        navigate_to_concert(driver)
        
        if args.live:
            wait_for_open(driver)
        
        click_booking(driver)
        handle_captcha(driver)
        
        if select_seat(driver):
            send_telegram("🎉 티켓팅 성공! 결제를 진행하세요!")
            print("\n" + "=" * 50)
            print("🎉 성공! 결제 화면에서 직접 결제해주세요!")
            print("=" * 50)
            
            # 결제는 수동으로 (보안상)
            input("결제 완료 후 Enter를 눌러주세요...")
        else:
            print("\n❌ 티켓팅 실패")
    
    except Exception as e:
        send_telegram(f"❌ 오류 발생: {str(e)}")
        print(f"오류: {e}")
    
    finally:
        if driver:
            input("브라우저를 닫으려면 Enter...")
            driver.quit()

if __name__ == '__main__':
    main()
