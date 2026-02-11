/**
 * BTS 광화문 티켓팅 매크로 - OpenClaw 버전
 * 
 * 인터파크(NOL) 예매 플로우:
 * 1. 로그인 (iframe 내부)
 * 2. 공연 페이지 접속
 * 3. 예매하기 클릭 → 새 탭 열림
 * 4. CAPTCHA 입력 (부정예매 방지)
 * 5. 좌석 선택 (iframe: ifrmSeat → ifrmSeatDetail)
 * 6. 결제 (iframe: ifrmBookStep)
 * 
 * 핵심 도전:
 * - 다중 iframe 네비게이션
 * - CAPTCHA 처리 (OCR or 수동)
 * - 감지 우회 (selenium-stealth)
 */

export interface TicketingConfig {
  // 로그인 정보
  userId: string;
  userPwd: string;
  
  // 공연 정보
  concertUrl: string;  // BTS 광화문 공연 URL
  
  // 좌석 우선순위
  seatPriority: string[];  // ['VIP', 'R석', 'S석']
  
  // 결제 정보
  birthDate: string;  // YYMMDD
  paymentMethod: 'card' | 'bank';
  
  // 타이밍
  startTime: Date;  // 티켓 오픈 시간
  
  // 알림
  telegramNotify: boolean;
}

// 예매 단계
export type BookingStep = 
  | 'init'
  | 'login'
  | 'navigate'
  | 'waiting'      // 오픈 대기
  | 'captcha'
  | 'seat_select'
  | 'payment'
  | 'complete'
  | 'failed';

// 예매 상태
export interface BookingState {
  step: BookingStep;
  startedAt: Date;
  lastAction: string;
  error?: string;
  seatInfo?: string;
}

/**
 * OpenClaw 브라우저 기반 티켓팅
 * 
 * 일반 Selenium 대비 장점:
 * 1. AI가 페이지 상태 분석
 * 2. 예외 상황 자동 대응
 * 3. 자연스러운 행동 패턴
 * 4. 텔레그램 즉시 알림
 */
export async function startTicketing(config: TicketingConfig): Promise<void> {
  console.log('🎫 BTS 티켓팅 시작');
  console.log(`공연: ${config.concertUrl}`);
  console.log(`오픈 시간: ${config.startTime.toLocaleString()}`);
  
  // TODO: OpenClaw browser tool 연동
  // 1. browser.open(config.concertUrl)
  // 2. browser.snapshot() → 페이지 분석
  // 3. browser.act() → 클릭/입력
}

/**
 * 인터파크 로그인
 * 
 * 주의: iframe 내부에 로그인 폼 있음
 * XPath: //div[@class='leftLoginBox']/iframe[@title='login']
 */
export async function login(userId: string, userPwd: string): Promise<boolean> {
  // 1. 로그인 버튼 클릭
  // 2. iframe으로 전환
  // 3. ID/PW 입력
  // 4. Enter
  
  console.log('🔐 로그인 중...');
  return true;
}

/**
 * CAPTCHA 처리
 * 
 * 옵션:
 * 1. OCR (easyocr) - 자동이지만 정확도 낮음
 * 2. 2Captcha API - 유료지만 정확
 * 3. 수동 입력 - Han에게 알림
 */
export async function handleCaptcha(): Promise<boolean> {
  // 1. CAPTCHA 이미지 캡처
  // 2. OCR 시도
  // 3. 실패 시 Han에게 텔레그램 알림
  
  console.log('🔍 CAPTCHA 처리 중...');
  return true;
}

/**
 * 좌석 선택
 * 
 * iframe 구조:
 * - ifrmSeat: 좌석 영역 전체
 * - ifrmSeatDetail: 개별 좌석
 * 
 * 전략:
 * 1. 우선순위 구역부터 시도
 * 2. 잔여석 있으면 즉시 선택
 * 3. 없으면 새로고침 반복
 */
export async function selectSeat(priority: string[]): Promise<string | null> {
  console.log('💺 좌석 선택 중...');
  
  // 1. 구역 선택
  // 2. 잔여석 확인
  // 3. 클릭
  
  return null;
}

/**
 * 결제 처리
 * 
 * iframe: ifrmBookStep
 * 
 * 단계:
 * 1. 가격 선택
 * 2. 예매자 정보 확인 (생년월일)
 * 3. 결제 방식 선택
 * 4. 약관 동의
 * 5. 결제 버튼
 */
export async function processPayment(birthDate: string): Promise<boolean> {
  console.log('💳 결제 처리 중...');
  return true;
}

// XPath 상수
export const XPATH = {
  // 로그인
  LOGIN_BUTTON: '//*[@id="__next"]/div/header/div/div[1]/div/div[1]/a',
  LOGIN_IFRAME: "//div[@class='leftLoginBox']/iframe[@title='login']",
  USER_ID: '//*[@id="userId"]',
  USER_PWD: '//*[@id="userPwd"]',
  
  // 예매
  BOOKING_BUTTON: '//*[@id="productSide"]/div/div[2]/a[1]',
  
  // CAPTCHA
  CAPTCHA_IMAGE: '//*[@id="imgCaptcha"]',
  CAPTCHA_INPUT: '//*[@id="txtCaptcha"]',
  CAPTCHA_CONFIRM: '//*[@id="divRecaptcha"]/div[1]/div[4]/a[2]',
  CAPTCHA_REFRESH: '//*[@id="divRecaptcha"]/div[1]/div[1]/a[1]',
  
  // 좌석
  SEAT_IFRAME: '//*[@id="ifrmSeat"]',
  SEAT_DETAIL_IFRAME: '//*[@id="ifrmSeatDetail"]',
  SEATS: '//*[@id="Seats"]',
  NEXT_STEP: '//*[@id="NextStepImage"]',
  
  // 결제
  BOOKING_STEP_IFRAME: '//*[@id="ifrmBookStep"]',
  PRICE_SELECT: '//*[@id="PriceRow001"]/td[3]/select',
  BIRTH_DATE: '//*[@id="YYMMDD"]',
  PAYMENT_CARD: '//*[@id="Payment_22004"]/td/input',
  AGREE_ALL: '//*[@id="checkAll"]',
  FINAL_BUTTON: '//*[@id="LargeNextBtnImage"]',
};
