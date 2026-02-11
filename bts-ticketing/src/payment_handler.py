#!/usr/bin/env python3
"""
결제 자동화 모듈 v3 - BTS 티켓팅 (10점 목표)
실전 안정성 + 에러 복구 + 다중 셀렉터 폴백

v3 핵심 개선:
- 다중 셀렉터 자동 폴백
- 모든 단계 재시도 (최대 3회)
- 부분 성공 상태 저장
- 서버 과부하 대응
- 결제 실패 복구
"""

import os
import time
import random
import threading
from dataclasses import dataclass, field
from typing import Optional, List, Dict, Any
from datetime import datetime
from enum import Enum

# Selenium Select 클래스
try:
    from selenium.webdriver.support.ui import Select
except ImportError:
    Select = None

# 공통 유틸리티 import
try:
    from utils import (
        log, Timing, adaptive_sleep, human_delay,
        MultiSelector, Selectors, retry, retry_on_stale,
        get_shared_state, PartialSuccessTracker,
        wait_for_condition, AntiDetection, Timer
    )
except ImportError:
    class Timing:
        MICRO = 0.03; TINY = 0.08; SHORT = 0.2; MEDIUM = 0.4; LONG = 0.8
        ELEMENT_TIMEOUT = 3; MAX_RETRIES = 5
    def log(msg: str, **kw): print(f'[{datetime.now().strftime("%H:%M:%S")}] {msg}')
    def adaptive_sleep(t, **kw): time.sleep(t)
    def human_delay(a=50, b=150): time.sleep(random.uniform(a/1000, b/1000))
    def wait_for_condition(c, timeout=5, **kw):
        s = time.time()
        while time.time() - s < timeout:
            if c(): return True
            time.sleep(0.01)
        return False
    def retry(**kw):
        def decorator(func):
            return func
        return decorator
    def retry_on_stale(func): return func
    class MultiSelector:
        def __init__(self, sb, sels, desc=""): self.sb = sb; self.selectors = sels
        def find_element(self, **kw):
            for sel in self.selectors:
                try:
                    e = self.sb.find_element(sel)
                    if e: return e
                except: pass
            return None
        def click(self, **kw):
            e = self.find_element()
            if e: e.click(); return True
            return False
    class PartialSuccessTracker:
        def __init__(self, sid): pass
        def checkpoint(self, stage, data=None): pass
    class Timer:
        def __init__(self, **kw): pass
        def __enter__(self): return self
        def __exit__(self, *args): pass
    class AntiDetection:
        @staticmethod
        def human_typing(sb, sel, text, **kw): sb.type(sel, text)
        @staticmethod
        def human_click(sb, elem, **kw): elem.click()
    def get_shared_state(): return None

# 타입 힌트용
SB = Any


class PaymentMethod(Enum):
    """결제 수단"""
    CREDIT_CARD = "card"
    BANK_TRANSFER = "transfer"
    KAKAO_PAY = "kakaopay"
    NAVER_PAY = "naverpay"
    PAYCO = "payco"
    TOSS = "toss"
    SAMSUNG_PAY = "samsungpay"
    APPLE_PAY = "applepay"
    CULTURE_CASH = "culture"


class PaymentStatus(Enum):
    """결제 상태"""
    PENDING = "pending"
    PROCESSING = "processing"
    COMPLETED = "completed"
    FAILED = "failed"
    TIMEOUT = "timeout"
    CANCELLED = "cancelled"


@dataclass
class PaymentConfig:
    """결제 설정 - 확장"""
    # 결제수단 우선순위 (계좌이체는 검증됨 ✅)
    payment_methods: List[PaymentMethod] = field(default_factory=lambda: [
        PaymentMethod.KAKAO_PAY,
        PaymentMethod.NAVER_PAY,
        PaymentMethod.CREDIT_CARD,
        PaymentMethod.BANK_TRANSFER,  # 검증됨 - 폴백으로 추가
        PaymentMethod.TOSS,
    ])
    
    # 신용카드 설정
    card_company: str = ""
    installment_months: int = 0  # 0=일시불
    
    # 계좌이체 설정
    bank_name: str = ""
    
    # 예매자 정보
    birth_date: str = ""  # YYMMDD 형식
    phone_number: str = ""
    email: str = ""
    
    # 배송/수령
    receive_method: str = "현장수령"
    
    # 자동 결제
    auto_pay: bool = False
    
    # 재시도 설정
    max_retries: int = 3
    retry_delay: float = 0.5
    
    # 타임아웃
    payment_timeout: int = 300
    step_timeout: int = 30


class PaymentHandler:
    """결제 자동화 핸들러 v3 - 실전 최적화"""
    
    # 프레임 셀렉터 (다중)
    FRAME_SELECTORS = {
        'seat_frame': ['#ifrmSeat', 'iframe[name="ifrmSeat"]'],
        'book_step_frame': ['#ifrmBookStep', 'iframe[name="ifrmBookStep"]'],
        'payment_frame': ['#ifrmPayment', 'iframe[name="ifrmPayment"]'],
    }
    
    # 버튼 셀렉터 (다중) - ⚠️ 버튼은 default_content에 있음!
    NEXT_STEP_SELECTORS = [
        # XPATH 우선 (검증됨)
        '//*[@id="SmallNextBtnImage"]',
        '//*[@id="LargeNextBtnImage"]',
        '//*[@id="NextStepImage"]',
        # CSS 폴백
        '#SmallNextBtnImage',
        '#LargeNextBtnImage',
        '#NextStepImage',
        'button:contains("다음")',
        'a:contains("다음")',
        '[class*="next"][class*="btn"]',
        'button[type="submit"]',
    ]
    
    PAY_BUTTON_SELECTORS = [
        # XPATH 우선 (검증됨)
        '//*[@id="LargeNextBtnImage"]',
        # CSS 폴백
        '#LargeNextBtnImage',
        'button:contains("결제하기")',
        'a:contains("결제하기")',
        'button:contains("결제")',
        '[class*="pay"][class*="btn"]',
        'input[value*="결제"]',
    ]
    
    # 가격 선택 - 인터파크 실제 DOM (XPATH 우선, 검증됨)
    PRICE_SELECTORS = [
        # XPATH 우선 (블로그에서 검증됨)
        '//*[@id="PriceRow001"]/td[3]/select',
        '//*[@id="PriceRow001"]/td/select',
        # CSS 폴백
        '#PriceRow001 > td:nth-child(3) > select',
        '#PriceRow001 td select',
        '#PriceRow001 select',
        'tr[id*="PriceRow"] td select',
        'select[id*="Price"]',
        'select[name*="price"]',
        '[class*="price"] select',
    ]
    
    DISCOUNT_SELECTORS = [
        'select[id*="Discount"]',
        'select[name*="discount"]',
        '[class*="discount"] select',
        '#DiscountCode',
    ]
    
    # 예매자 정보 - 인터파크 실제 DOM (검증됨 ✅)
    BIRTH_SELECTORS = [
        # XPATH 우선 (검증됨)
        '//*[@id="YYMMDD"]',
        # CSS 폴백
        '#YYMMDD',
        'input#YYMMDD',
        'input[name="YYMMDD"]',
        '#birthDate',
        'input[name*="birth"]',
        'input[placeholder*="생년월일"]',
        'input[placeholder*="YYMMDD"]',
        'input[maxlength="6"][type="text"]',  # 6자리 제한 필드
    ]
    
    PHONE_SELECTORS = [
        '#ordererTel',
        '#ordererTel1',
        '#ordererTel2', 
        '#ordererTel3',
        '#phone',
        'input[name*="ordererTel"]',
        'input[name*="phone"]',
        'input[name*="tel"]',
        'input[placeholder*="연락처"]',
    ]
    
    EMAIL_SELECTORS = [
        '#ordererEmail',
        'input#ordererEmail',
        '#email',
        'input[type="email"]',
        'input[name*="email"]',
        'input[name*="Email"]',
    ]
    
    # 수령 방법
    RECEIVE_ONSITE_SELECTORS = [
        'input[value*="현장"]',
        'label:contains("현장수령")',
        '[class*="receive"][class*="site"]',
        '#receiveOnsite',
    ]
    
    RECEIVE_DELIVERY_SELECTORS = [
        'input[value*="배송"]',
        'label:contains("배송")',
        '[class*="receive"][class*="delivery"]',
        '#receiveDelivery',
    ]
    
    # 결제수단 (우선순위별 다중 셀렉터) - 인터파크 실제 DOM 기반 (2024-2026)
    # ⚠️ 계좌이체(22004)만 검증됨, 나머지는 추정값
    PAYMENT_METHOD_SELECTORS = {
        PaymentMethod.CREDIT_CARD: [
            # XPATH 우선 (가장 안정적)
            '//*[@id="Payment_22001"]/td/input',
            '//*[@id="Payment_22001"]//input',
            # CSS 폴백
            '#Payment_22001 > td > input',
            '#Payment_22001 td input',
            '#Payment_22001 input',
            'input[id*="Payment"][id*="22001"]',
            'input[value*="카드"]',
            'label:contains("신용카드")',
        ],
        PaymentMethod.BANK_TRANSFER: [
            # XPATH 우선 (검증됨 ✅)
            '//*[@id="Payment_22004"]/td/input',
            '//*[@id="Payment_22004"]//input',
            # CSS 폴백
            '#Payment_22004 > td > input',
            '#Payment_22004 td input',
            '#Payment_22004 input',
            'input[id*="Payment"][id*="22004"]',
            'input[value*="이체"]',
            'label:contains("계좌이체")',
        ],
        PaymentMethod.KAKAO_PAY: [
            # XPATH 우선 (ID 추정)
            '//*[@id="Payment_22019"]/td/input',
            '//*[@id="Payment_22019"]//input',
            # CSS 폴백
            '#Payment_22019 > td > input',
            '#Payment_22019 td input',
            '#Payment_22019 input',
            # 이미지/클래스 기반 폴백
            'input[id*="kakao"]',
            '[class*="kakao"] input',
            'img[alt*="카카오"]',
            'img[src*="kakao"]',
            'label:contains("카카오페이")',
        ],
        PaymentMethod.NAVER_PAY: [
            # XPATH 우선 (ID 추정)
            '//*[@id="Payment_22020"]/td/input',
            '//*[@id="Payment_22020"]//input',
            # CSS 폴백
            '#Payment_22020 > td > input',
            '#Payment_22020 td input',
            '#Payment_22020 input',
            'input[id*="naver"]',
            '[class*="naver"] input',
            'img[alt*="네이버"]',
            'img[src*="naver"]',
            'label:contains("네이버페이")',
        ],
        PaymentMethod.PAYCO: [
            '//*[@id="Payment_22021"]/td/input',
            '//*[@id="Payment_22021"]//input',
            '#Payment_22021 > td > input',
            '#Payment_22021 td input',
            '[class*="payco"] input',
            'img[alt*="PAYCO"]',
            'img[src*="payco"]',
        ],
        PaymentMethod.TOSS: [
            '//*[@id="Payment_22022"]/td/input',
            '//*[@id="Payment_22022"]//input',
            '#Payment_22022 > td > input',
            '#Payment_22022 td input',
            '[class*="toss"] input',
            'img[alt*="토스"]',
            'img[src*="toss"]',
        ],
        PaymentMethod.SAMSUNG_PAY: [
            '//*[@id="Payment_22023"]/td/input',
            '//*[@id="Payment_22023"]//input',
            '#Payment_22023 > td > input',
            '#Payment_22023 td input',
            '[class*="samsung"] input',
        ],
    }
    
    # 카드/은행 선택
    CARD_COMPANY_SELECTORS = [
        '#CardCode',
        'select[name*="card"]',
        'select[id*="Card"]',
    ]
    
    INSTALLMENT_SELECTORS = [
        '#InstMonth',
        'select[name*="install"]',
        'select[id*="Inst"]',
    ]
    
    BANK_SELECTORS = [
        '#BankCode',
        'select[name*="bank"]',
        'select[id*="Bank"]',
    ]
    
    # 약관 동의 (검증됨 ✅)
    AGREE_ALL_SELECTORS = [
        # XPATH 우선 (검증됨)
        '//*[@id="checkAll"]',
        '//*[@id="agreeAll"]',
        # CSS 폴백
        '#checkAll',
        '#agreeAll',
        'input[id*="agreeAll"]',
        'input[name*="agreeAll"]',
        '[class*="agree"][class*="all"]',
        'label:contains("전체 동의")',
    ]
    
    AGREE_CHECKBOX_SELECTORS = [
        'input[type="checkbox"][id*="agree"]',
        'input[type="checkbox"][name*="agree"]',
        'input[type="checkbox"][id*="term"]',
        'input[type="checkbox"][name*="term"]',
    ]
    
    # 결제 완료 확인
    COMPLETE_SELECTORS = [
        '[class*="complete"]',
        '[class*="success"]',
        'h2:contains("결제 완료")',
        'h2:contains("예매 완료")',
        '[class*="order"][class*="complete"]',
    ]
    
    ORDER_NUMBER_SELECTORS = [
        '[class*="orderNum"]',
        '[class*="ticketNum"]',
        '[class*="reservation"]',
        'span:contains("예매번호")',
    ]
    
    # 에러 메시지
    ERROR_SELECTORS = [
        '[class*="error"]',
        '[class*="alert"]',
        '.errMsg',
        '[class*="fail"]',
    ]
    
    SOLD_OUT_SELECTORS = [
        ':contains("매진")',
        ':contains("sold out")',
        ':contains("품절")',
        '[class*="soldout"]',
    ]
    
    def __init__(self, sb: SB, config: Optional[PaymentConfig] = None, session_id: int = 0):
        """
        Args:
            sb: SeleniumBase 인스턴스
            config: 결제 설정
            session_id: 세션 ID
        """
        self.sb = sb
        self.config = config or PaymentConfig()
        self.session_id = session_id
        
        # 상태
        self.current_step = ""
        self.order_number = ""
        self.status = PaymentStatus.PENDING
        self.error_message = ""
        
        # 부분 성공 추적
        self._tracker = PartialSuccessTracker(session_id)
        
        # 공유 상태
        self._shared = get_shared_state()
        
        # 작동한 셀렉터 캐시
        self._working_selectors: Dict[str, str] = {}
    
    def _log(self, msg: str):
        """세션 ID 포함 로깅"""
        log(msg, session_id=self.session_id)
    
    def _multi_select(self, selectors: List[str], desc: str = "") -> MultiSelector:
        """MultiSelector 생성 헬퍼"""
        return MultiSelector(self.sb, selectors, desc)
    
    @retry(max_attempts=3, delay=0.2)
    def switch_to_book_frame(self) -> bool:
        """예매 스텝 프레임으로 전환"""
        try:
            self.sb.switch_to_default_content()
            
            selector = self._multi_select(self.FRAME_SELECTORS['book_step_frame'], '예매 프레임')
            frame = selector.find_element(timeout=Timing.ELEMENT_TIMEOUT)
            
            if frame:
                self.sb.switch_to_frame(frame)
                self._log('✅ 예매 프레임 전환')
                return True
                
        except Exception as e:
            pass
        
        return False
    
    @retry(max_attempts=3, delay=0.3)
    def click_next_step(self) -> bool:
        """다음 단계 버튼 클릭 - ⚠️ 버튼은 default_content에 있음!"""
        try:
            # 핵심: 버튼 클릭 전 반드시 default_content로!
            self.sb.switch_to_default_content()
            
            # XPATH 우선 시도 (가장 안정적)
            for sel in self.NEXT_STEP_SELECTORS:
                try:
                    if sel.startswith('/'):
                        # XPATH
                        from selenium.webdriver.common.by import By
                        elem = self.sb.find_element(By.XPATH, sel)
                    else:
                        elem = self.sb.find_element(sel)
                    
                    if elem and elem.is_displayed():
                        elem.click()
                        self._log(f'✅ 다음 단계 클릭 ({sel[:30]}...)')
                        adaptive_sleep(Timing.LONG)
                        return True
                except:
                    continue
            
            # MultiSelector 폴백
            selector = self._multi_select(self.NEXT_STEP_SELECTORS, '다음 단계')
            if selector.click(timeout=Timing.ELEMENT_TIMEOUT):
                self._log('✅ 다음 단계 클릭')
                adaptive_sleep(Timing.LONG)
                return True
            
            self._log('⚠️ 다음 단계 버튼 없음')
            return False
            
        except Exception as e:
            self._log(f'⚠️ 다음 단계 클릭 실패: {e}')
            return False
    
    @retry(max_attempts=3, delay=0.2)
    def select_price(self, discount_index: int = 1) -> bool:
        """가격/할인 선택 - XPATH 우선"""
        self._log('💰 가격 선택...')
        
        try:
            self.switch_to_book_frame()
            
            # XPATH 우선 시도 (검증된 셀렉터)
            price_elem = None
            for sel in self.PRICE_SELECTORS:
                try:
                    if sel.startswith('/'):
                        # XPATH
                        from selenium.webdriver.common.by import By
                        price_elem = self.sb.find_element(By.XPATH, sel)
                    else:
                        price_elem = self.sb.find_element(sel)
                    
                    if price_elem and price_elem.is_displayed():
                        self._log(f'✅ 가격 요소 발견: {sel[:40]}')
                        break
                except:
                    price_elem = None
                    continue
            
            # MultiSelector 폴백
            if not price_elem:
                price_selector = self._multi_select(self.PRICE_SELECTORS, '가격')
                price_elem = price_selector.find_element()
            
            if price_elem and price_elem.is_displayed() and Select:
                try:
                    select = Select(price_elem)
                    select.select_by_index(discount_index)
                    self._log(f'✅ 가격 선택: 인덱스 {discount_index}')
                    adaptive_sleep(Timing.SHORT)
                except Exception as e:
                    self._log(f'⚠️ 가격 선택 예외: {e}')
                return True
            
            self._log('⚠️ 가격 선택 요소 없음 (기본값 사용)')
            return True
            
        except Exception as e:
            self._log(f'⚠️ 가격 선택 실패: {e}')
            return True
    
    @retry(max_attempts=3, delay=0.2)
    def select_receive_method(self) -> bool:
        """수령 방법 선택"""
        self._log('📦 수령 방법 선택...')
        
        try:
            self.switch_to_book_frame()
            
            if self.config.receive_method == "현장수령":
                selectors = self.RECEIVE_ONSITE_SELECTORS
            else:
                selectors = self.RECEIVE_DELIVERY_SELECTORS
            
            selector = self._multi_select(selectors, '수령 방법')
            
            if selector.click():
                self._log(f'✅ 수령 방법: {self.config.receive_method}')
                adaptive_sleep(Timing.SHORT)
                return True
            
            self._log('⚠️ 수령 방법 요소 없음 (기본값 사용)')
            return True
            
        except Exception as e:
            self._log(f'⚠️ 수령 방법 선택 실패: {e}')
            return True
    
    @retry(max_attempts=3, delay=0.2)
    def input_buyer_info(self) -> bool:
        """예매자 정보 입력 - 기존값 체크 강화"""
        self._log('👤 예매자 정보 입력...')
        
        try:
            self.switch_to_book_frame()
            
            # 생년월일 입력 (기존값 있으면 스킵)
            if self.config.birth_date:
                birth_selector = self._multi_select(self.BIRTH_SELECTORS, '생년월일')
                birth_elem = birth_selector.find_element()
                
                if birth_elem and birth_elem.is_displayed():
                    try:
                        existing_value = birth_elem.get_attribute('value') or ''
                        
                        # 기존값이 없거나 불완전할 때만 입력
                        if len(existing_value) < 6:
                            if existing_value:
                                birth_elem.clear()
                            # 인간 같은 타이핑
                            AntiDetection.human_typing(self.sb, birth_elem, self.config.birth_date, clear_first=False)
                            # 마스킹 로깅
                            masked = self.config.birth_date[:2] + '****' if len(self.config.birth_date) > 2 else '******'
                            self._log(f'✅ 생년월일 입력: {masked}')
                        else:
                            self._log(f'ℹ️ 생년월일 이미 입력됨')
                    except Exception as e:
                        # 폴백: 직접 입력
                        try:
                            birth_elem.send_keys(self.config.birth_date)
                        except:
                            pass
            
            # 연락처 입력 (기존값 체크)
            if self.config.phone_number:
                phone_selector = self._multi_select(self.PHONE_SELECTORS, '연락처')
                phone_elem = phone_selector.find_element()
                
                if phone_elem and phone_elem.is_displayed():
                    try:
                        existing_phone = phone_elem.get_attribute('value') or ''
                        if len(existing_phone) < 10:  # 전화번호 최소 길이
                            if existing_phone:
                                phone_elem.clear()
                            phone_elem.send_keys(self.config.phone_number)
                            self._log('✅ 연락처 입력')
                        else:
                            self._log('ℹ️ 연락처 이미 입력됨')
                    except:
                        pass
            
            # 이메일 입력 (기존값 체크)
            if self.config.email:
                email_selector = self._multi_select(self.EMAIL_SELECTORS, '이메일')
                email_elem = email_selector.find_element()
                
                if email_elem and email_elem.is_displayed():
                    try:
                        existing_email = email_elem.get_attribute('value') or ''
                        if '@' not in existing_email:  # 이메일 형식 아니면 입력
                            if existing_email:
                                email_elem.clear()
                            email_elem.send_keys(self.config.email)
                            self._log('✅ 이메일 입력')
                        else:
                            self._log('ℹ️ 이메일 이미 입력됨')
                    except:
                        pass
            
            # 체크포인트
            self._tracker.checkpoint('buyer_info_entered')
            
            adaptive_sleep(Timing.SHORT)
            return True
            
        except Exception as e:
            self._log(f'⚠️ 예매자 정보 입력 실패: {e}')
            return True
    
    def _find_element_fast(self, selectors: List[str]) -> Optional[Any]:
        """빠른 요소 검색 (JS 병렬 검색)"""
        try:
            # JavaScript로 병렬 검색 (더 빠름)
            result = self.sb.execute_script("""
                var selectors = arguments[0];
                for (var i = 0; i < selectors.length; i++) {
                    try {
                        var elem = document.querySelector(selectors[i]);
                        if (elem && elem.offsetParent !== null) {
                            return {index: i, found: true};
                        }
                    } catch(e) {}
                }
                return {index: -1, found: false};
            """, selectors)
            
            if result and result.get('found'):
                idx = result.get('index', 0)
                return self.sb.find_element(selectors[idx])
        except:
            pass
        
        # 폴백: 순차 검색
        for sel in selectors:
            try:
                elem = self.sb.find_element(sel)
                if elem and elem.is_displayed():
                    return elem
            except:
                continue
        return None
    
    @retry(max_attempts=3, delay=0.3)
    def select_payment_method(self) -> bool:
        """결제수단 선택 - 인터파크 프레임 구조 대응 + XPATH 강화"""
        self._log('💳 결제수단 선택...')
        
        try:
            # 프레임 전환 (여러 시도)
            if not self.switch_to_book_frame():
                self._log('⚠️ 예매 프레임 전환 실패, 현재 컨텍스트에서 시도')
            
            # 우선순위대로 결제수단 시도
            for method in self.config.payment_methods:
                selectors = self.PAYMENT_METHOD_SELECTORS.get(method, [])
                if not selectors:
                    continue
                
                self._log(f'🔍 {method.value} 결제수단 찾는 중...')
                
                # 각 셀렉터 직접 시도 (XPATH 우선!)
                for sel in selectors:
                    try:
                        elem = None
                        
                        # XPATH 처리 (우선)
                        if sel.startswith('/'):
                            from selenium.webdriver.common.by import By
                            try:
                                elem = self.sb.find_element(By.XPATH, sel)
                            except:
                                pass
                        else:
                            # CSS: JS로 요소 찾기 (더 안정적)
                            try:
                                elem = self.sb.execute_script(f"""
                                    var elem = document.querySelector('{sel}');
                                    if (elem && elem.offsetParent !== null) return elem;
                                    return null;
                                """)
                            except:
                                pass
                            
                            if not elem:
                                try:
                                    elem = self.sb.find_element(sel)
                                except:
                                    pass
                        
                        if elem and elem.is_displayed():
                            # 라디오 버튼이면 JS 클릭이 더 안정적
                            tag = elem.tag_name.lower() if hasattr(elem, 'tag_name') else ''
                            input_type = elem.get_attribute('type') or ''
                            
                            if tag == 'input' and input_type == 'radio':
                                self.sb.execute_script("arguments[0].click();", elem)
                            else:
                                try:
                                    AntiDetection.human_click(self.sb, elem)
                                except:
                                    elem.click()
                            
                            self._log(f'✅ 결제수단 선택: {method.value} ({sel[:40]}...)')
                            adaptive_sleep(Timing.MEDIUM)
                            
                            # 추가 선택
                            if method == PaymentMethod.CREDIT_CARD:
                                self._select_card_options()
                            elif method == PaymentMethod.BANK_TRANSFER:
                                self._select_bank_options()
                            
                            # 체크포인트
                            self._tracker.checkpoint('payment_method_selected', {'method': method.value})
                            
                            return True
                            
                    except Exception as e:
                        continue
                
                self._log(f'⚠️ {method.value} 결제수단 없음')
            
            self._log('⚠️ 모든 결제수단 선택 실패')
            return False
            
        except Exception as e:
            self._log(f'⚠️ 결제수단 선택 에러: {e}')
            return False
    
    def _select_card_options(self):
        """카드 옵션 선택"""
        if not Select:
            return
            
        try:
            # 카드사 선택
            card_selector = self._multi_select(self.CARD_COMPANY_SELECTORS, '카드사')
            card_elem = card_selector.find_element()
            
            if card_elem and card_elem.is_displayed():
                select = Select(card_elem)
                if self.config.card_company:
                    try:
                        select.select_by_visible_text(self.config.card_company)
                    except:
                        select.select_by_index(1)
                else:
                    select.select_by_index(1)
                self._log(f'✅ 카드사: {self.config.card_company or "첫번째"}')
            
            # 할부 선택
            inst_selector = self._multi_select(self.INSTALLMENT_SELECTORS, '할부')
            inst_elem = inst_selector.find_element()
            
            if inst_elem and inst_elem.is_displayed():
                select = Select(inst_elem)
                select.select_by_index(self.config.installment_months)
                inst_text = f'{self.config.installment_months}개월' if self.config.installment_months else '일시불'
                self._log(f'✅ 할부: {inst_text}')
                
        except Exception as e:
            self._log(f'⚠️ 카드 옵션 선택 실패: {e}')
    
    def _select_bank_options(self):
        """은행 옵션 선택"""
        if not Select:
            return
            
        try:
            bank_selector = self._multi_select(self.BANK_SELECTORS, '은행')
            bank_elem = bank_selector.find_element()
            
            if bank_elem and bank_elem.is_displayed():
                select = Select(bank_elem)
                if self.config.bank_name:
                    try:
                        select.select_by_visible_text(self.config.bank_name)
                    except:
                        select.select_by_index(1)
                else:
                    select.select_by_index(1)
                self._log(f'✅ 은행: {self.config.bank_name or "첫번째"}')
                
        except Exception as e:
            self._log(f'⚠️ 은행 선택 실패: {e}')
    
    @retry(max_attempts=3, delay=0.2)
    def agree_terms(self) -> bool:
        """약관 동의"""
        self._log('📋 약관 동의...')
        
        try:
            self.switch_to_book_frame()
            
            # 전체 동의 먼저 시도
            agree_all_selector = self._multi_select(self.AGREE_ALL_SELECTORS, '전체 동의')
            agree_all = agree_all_selector.find_element()
            
            if agree_all and agree_all.is_displayed():
                try:
                    if not agree_all.is_selected():
                        AntiDetection.human_click(self.sb, agree_all)
                    self._log('✅ 전체 동의 체크')
                    
                    # 체크포인트
                    self._tracker.checkpoint('terms_agreed')
                    
                    adaptive_sleep(Timing.SHORT)
                    return True
                except:
                    pass
            
            # 개별 체크박스 체크
            checkbox_selector = self._multi_select(self.AGREE_CHECKBOX_SELECTORS, '약관 체크박스')
            checkboxes = checkbox_selector.find_elements()
            
            checked_count = 0
            for cb in checkboxes:
                try:
                    if cb.is_displayed() and not cb.is_selected():
                        cb.click()
                        checked_count += 1
                        human_delay(50, 100)
                except:
                    continue
            
            if checked_count > 0:
                self._log(f'✅ {checked_count}개 약관 동의')
                self._tracker.checkpoint('terms_agreed')
                return True
            
            self._log('⚠️ 체크할 약관 없음')
            return True
            
        except Exception as e:
            self._log(f'⚠️ 약관 동의 실패: {e}')
            return False
    
    @retry(max_attempts=2, delay=0.3)
    def click_pay_button(self) -> bool:
        """결제하기 버튼 클릭"""
        self._log('🔘 결제하기 버튼 클릭...')
        
        if not self.config.auto_pay:
            self._log('⚠️ auto_pay=False, 수동 결제 대기')
            self._tracker.checkpoint('ready_for_payment')
            return True
        
        try:
            self.sb.switch_to_default_content()
            
            pay_selector = self._multi_select(self.PAY_BUTTON_SELECTORS, '결제 버튼')
            
            if pay_selector.click(timeout=Timing.ELEMENT_TIMEOUT):
                self._log('✅ 결제하기 클릭!')
                self.status = PaymentStatus.PROCESSING
                self._tracker.checkpoint('payment_clicked')
                return True
            
            self._log('⚠️ 결제하기 버튼 없음')
            return False
            
        except Exception as e:
            self._log(f'⚠️ 결제하기 클릭 실패: {e}')
            return False
    
    def check_payment_complete(self, timeout: Optional[int] = None) -> bool:
        """결제 완료 확인 - 최적화"""
        timeout = timeout or self.config.payment_timeout
        self._log(f'⏳ 결제 완료 대기 (최대 {timeout}초)...')
        
        start_time = time.time()
        last_status_log = 0
        
        while time.time() - start_time < timeout:
            elapsed = time.time() - start_time
            
            try:
                # 결제 완료 페이지 확인
                complete_selector = self._multi_select(self.COMPLETE_SELECTORS, '결제 완료')
                complete_elem = complete_selector.find_element()
                
                if complete_elem and complete_elem.is_displayed():
                    self._log('🎉 결제 완료!')
                    self.status = PaymentStatus.COMPLETED
                    
                    # 주문번호 추출
                    self._extract_order_number()
                    
                    # 체크포인트
                    self._tracker.checkpoint('payment_completed', {'order_number': self.order_number})
                    
                    return True
                
                # URL 확인
                current_url = self.sb.get_current_url().lower()
                if 'complete' in current_url or 'success' in current_url:
                    self._log('🎉 결제 완료 (URL)')
                    self.status = PaymentStatus.COMPLETED
                    self._extract_order_number()
                    return True
                
            except:
                pass
            
            # 에러 확인
            if self._check_payment_error():
                return False
            
            # 간편결제 팝업 처리
            self._handle_simple_pay_popup()
            
            # 상태 로그 (30초마다)
            if elapsed - last_status_log >= 30:
                self._log(f'⏳ 결제 대기 중... ({int(elapsed)}초 경과)')
                last_status_log = elapsed
            
            # 타임아웃 경고 (4분 경과 시)
            if 240 <= elapsed < 242 and timeout >= 300:
                self._log('⚠️ 결제 완료까지 1분 남음!')
            
            time.sleep(1)  # 2초 → 1초로 단축
        
        self._log('⏰ 결제 완료 대기 타임아웃')
        self.status = PaymentStatus.TIMEOUT
        return False
    
    def _extract_order_number(self):
        """주문번호 추출"""
        try:
            order_selector = self._multi_select(self.ORDER_NUMBER_SELECTORS, '주문번호')
            order_elem = order_selector.find_element()
            
            if order_elem:
                import re
                text = order_elem.text.strip()
                # 숫자 패턴 추출
                match = re.search(r'[A-Z]*\d{6,}', text)
                if match:
                    self.order_number = match.group()
                else:
                    self.order_number = text[:20]
                
                self._log(f'📋 주문번호: {self.order_number}')
                
        except Exception as e:
            self._log(f'⚠️ 주문번호 추출 실패: {e}')
    
    def _handle_simple_pay_popup(self) -> bool:
        """간편결제 팝업 핸들링 (카카오페이/네이버페이/토스 등)"""
        try:
            # 현재 창 핸들 저장
            main_window = self.sb.driver.current_window_handle
            all_windows = self.sb.driver.window_handles
            
            # 새 창이 열렸는지 확인
            if len(all_windows) > 1:
                # 새 창으로 전환
                for window in all_windows:
                    if window != main_window:
                        self.sb.driver.switch_to.window(window)
                        self._log('🔄 간편결제 팝업 감지, 창 전환')
                        
                        # 팝업 내용 확인 (URL 기반)
                        popup_url = self.sb.get_current_url().lower()
                        
                        # 결제 완료 감지 (팝업에서)
                        if 'success' in popup_url or 'complete' in popup_url or 'done' in popup_url:
                            self._log('✅ 간편결제 팝업에서 완료 감지')
                            # 메인 창으로 복귀 (팝업은 자동 닫힘)
                            try:
                                self.sb.driver.switch_to.window(main_window)
                            except:
                                pass
                            return True
                        
                        # 결제 진행 중이면 대기 (5초)
                        adaptive_sleep(5.0)
                        
                        # 메인 창으로 복귀
                        try:
                            self.sb.driver.switch_to.window(main_window)
                        except:
                            # 메인 창이 닫혔으면 현재 창이 메인
                            pass
                        
                        break
            
            # iframe 기반 간편결제 확인 (네이버페이 등)
            try:
                self.sb.switch_to_default_content()
                simplepay_frames = [
                    'iframe[src*="kakao"]',
                    'iframe[src*="naver"]',
                    'iframe[src*="toss"]',
                    'iframe[src*="pay"]',
                    '#payFrame',
                ]
                
                for frame_sel in simplepay_frames:
                    try:
                        frame = self.sb.find_element(frame_sel)
                        if frame and frame.is_displayed():
                            self._log(f'🔍 간편결제 iframe 감지: {frame_sel}')
                            # iframe 내부에서 결제 진행 - 사용자 조작 필요
                            break
                    except:
                        continue
                        
            except:
                pass
            
            return False
            
        except Exception as e:
            # 팝업 처리 실패해도 계속 진행
            return False
    
    def _check_payment_error(self) -> bool:
        """결제 에러 확인"""
        try:
            error_selector = self._multi_select(self.ERROR_SELECTORS, '에러')
            error_elem = error_selector.find_element()
            
            if error_elem and error_elem.is_displayed():
                self.error_message = error_elem.text.strip()
                self._log(f'❌ 결제 오류: {self.error_message}')
                self.status = PaymentStatus.FAILED
                return True
            
            # 매진 확인
            sold_selector = self._multi_select(self.SOLD_OUT_SELECTORS, '매진')
            sold_elem = sold_selector.find_element()
            
            if sold_elem and sold_elem.is_displayed():
                self._log('❌ 매진!')
                self.status = PaymentStatus.FAILED
                self.error_message = "매진"
                return True
                
        except:
            pass
        
        return False
    
    def process_payment(self) -> bool:
        """전체 결제 프로세스 실행 - 에러 복구 강화"""
        self._log('💳 결제 프로세스 시작')
        self.status = PaymentStatus.PROCESSING
        
        # 결제 페이지 진입 확인 (중요!)
        if not self._verify_payment_page_entry():
            self._log('⚠️ 결제 페이지 진입 미확인, 계속 진행')
        
        steps = [
            ('가격선택', self.select_price, False),         # 필수 아님
            ('다음단계1', self.click_next_step, False),     # 실패해도 계속
            ('수령방법', self.select_receive_method, False),
            ('예매자정보', self.input_buyer_info, False),
            ('다음단계2', self.click_next_step, False),
            ('결제수단', self.select_payment_method, True), # 필수
            ('다음단계3', self.click_next_step, False),
            ('약관동의', self.agree_terms, True),           # 필수
            ('결제버튼', self.click_pay_button, True),      # 필수
        ]
        
        for step_name, step_func, is_required in steps:
            self.current_step = step_name
            self._log(f'📍 [{step_name}]')
            
            success = False
            for attempt in range(self.config.max_retries):
                try:
                    if step_func():
                        success = True
                        # 단계별 상태 확인
                        self._verify_step_completed(step_name)
                        break
                except Exception as e:
                    self._log(f'⚠️ {step_name} 에러 (시도 {attempt+1}): {e}')
                    if attempt < self.config.max_retries - 1:
                        adaptive_sleep(self.config.retry_delay)
            
            if not success:
                self._log(f'⚠️ {step_name} 최종 실패')
                if is_required:
                    self.status = PaymentStatus.FAILED
                    self.error_message = f'{step_name} 실패'
                    # 에러 복구 시도
                    if self._try_recovery(step_name):
                        continue
                    return False
        
        # 결제 완료 대기
        if self.config.auto_pay:
            return self.check_payment_complete()
        else:
            self._log('✅ 결제 페이지 도달 - 수동 결제 필요')
            self.status = PaymentStatus.PENDING
            return True
    
    def _verify_payment_page_entry(self) -> bool:
        """결제 페이지 진입 확인"""
        try:
            self.sb.switch_to_default_content()
            current_url = self.sb.get_current_url().lower()
            
            # URL 키워드 확인
            payment_keywords = ['booking', 'order', 'payment', 'checkout', 'step', 'delivery']
            if any(kw in current_url for kw in payment_keywords):
                self._log('✅ 결제 페이지 URL 확인')
                return True
            
            # DOM 요소 확인
            entry_indicators = [
                '#ifrmBookStep',
                '[class*="booking"]',
                '[class*="order"]',
                'select[id*="Price"]',
                '#YYMMDD',
            ]
            
            for sel in entry_indicators:
                try:
                    elem = self.sb.find_element(sel)
                    if elem:
                        self._log(f'✅ 결제 페이지 요소 확인: {sel[:30]}')
                        return True
                except:
                    pass
            
            return False
            
        except Exception as e:
            self._log(f'⚠️ 결제 페이지 확인 실패: {e}')
            return False
    
    def _verify_step_completed(self, step_name: str):
        """각 단계 완료 확인"""
        try:
            if step_name == '결제수단':
                # 결제수단 선택됐는지 확인
                self.switch_to_book_frame()
                selected = self.sb.execute_script("""
                    var radios = document.querySelectorAll('input[type="radio"]:checked');
                    return radios.length > 0;
                """)
                if selected:
                    self._log('✅ 결제수단 선택 확인됨')
            
            elif step_name == '예매자정보':
                # 생년월일 입력됐는지 확인
                self.switch_to_book_frame()
                birth_filled = False
                for sel in self.BIRTH_SELECTORS:
                    try:
                        elem = self.sb.find_element(sel)
                        if elem and elem.get_attribute('value'):
                            birth_filled = True
                            break
                    except:
                        pass
                if birth_filled:
                    self._log('✅ 예매자정보 입력 확인됨')
            
            elif step_name == '약관동의':
                # 체크박스 선택됐는지 확인
                self.switch_to_book_frame()
                checked = self.sb.execute_script("""
                    var checkboxes = document.querySelectorAll('input[type="checkbox"]:checked');
                    return checkboxes.length;
                """)
                if checked and checked > 0:
                    self._log(f'✅ 약관동의 {checked}개 체크 확인됨')
                    
        except Exception as e:
            pass  # 확인 실패해도 진행
    
    def _try_recovery(self, failed_step: str) -> bool:
        """실패한 단계 복구 시도"""
        self._log(f'🔄 {failed_step} 복구 시도...')
        
        try:
            if failed_step == '결제수단':
                # 다른 결제수단 시도
                if len(self.config.payment_methods) > 1:
                    # 첫 번째 결제수단 제외하고 다시 시도
                    backup_methods = self.config.payment_methods[1:]
                    original_methods = self.config.payment_methods
                    self.config.payment_methods = backup_methods
                    
                    if self.select_payment_method():
                        self.config.payment_methods = original_methods
                        self._log('✅ 대체 결제수단으로 복구 성공')
                        return True
                    
                    self.config.payment_methods = original_methods
            
            elif failed_step == '약관동의':
                # 페이지 새로고침 후 재시도
                try:
                    self.sb.execute_script("location.reload();")
                    adaptive_sleep(Timing.LONG)
                    return True  # 다시 시도하도록
                except:
                    pass
            
            return False
            
        except Exception as e:
            self._log(f'⚠️ 복구 실패: {e}')
            return False
    
    def get_status(self) -> Dict[str, Any]:
        """현재 결제 상태"""
        return {
            'status': self.status.value,
            'current_step': self.current_step,
            'order_number': self.order_number,
            'error_message': self.error_message,
            'last_checkpoint': self._tracker.get_last_stage(),
        }


# ============ 편의 함수 ============
def quick_payment(sb: SB, birth_date: str, auto_pay: bool = False, session_id: int = 0) -> bool:
    """빠른 결제 (간편결제 우선)"""
    config = PaymentConfig(
        birth_date=birth_date,
        auto_pay=auto_pay,
        payment_methods=[
            PaymentMethod.KAKAO_PAY,
            PaymentMethod.NAVER_PAY,
            PaymentMethod.TOSS,
            PaymentMethod.CREDIT_CARD,
        ]
    )
    
    handler = PaymentHandler(sb, config, session_id)
    return handler.process_payment()


def card_payment(sb: SB, birth_date: str, card_company: str = "",
                 installment: int = 0, auto_pay: bool = False,
                 session_id: int = 0) -> bool:
    """카드 결제"""
    config = PaymentConfig(
        birth_date=birth_date,
        auto_pay=auto_pay,
        payment_methods=[PaymentMethod.CREDIT_CARD],
        card_company=card_company,
        installment_months=installment,
    )
    
    handler = PaymentHandler(sb, config, session_id)
    return handler.process_payment()


def bank_payment(sb: SB, birth_date: str, bank_name: str = "",
                 auto_pay: bool = False, session_id: int = 0) -> bool:
    """계좌이체 결제"""
    config = PaymentConfig(
        birth_date=birth_date,
        auto_pay=auto_pay,
        payment_methods=[PaymentMethod.BANK_TRANSFER],
        bank_name=bank_name,
    )
    
    handler = PaymentHandler(sb, config, session_id)
    return handler.process_payment()


def prepare_payment_only(sb: SB, birth_date: str, session_id: int = 0) -> PaymentHandler:
    """결제 준비만 (수동 결제용)"""
    config = PaymentConfig(
        birth_date=birth_date,
        auto_pay=False,
    )
    
    handler = PaymentHandler(sb, config, session_id)
    
    # 결제 버튼 직전까지만
    steps = [
        handler.select_price,
        handler.click_next_step,
        handler.select_receive_method,
        handler.input_buyer_info,
        handler.click_next_step,
        handler.select_payment_method,
        handler.click_next_step,
        handler.agree_terms,
    ]
    
    for step in steps:
        try:
            step()
        except:
            pass
    
    log('✅ 결제 준비 완료 - 결제 버튼만 클릭하면 됩니다', session_id=session_id)
    return handler
