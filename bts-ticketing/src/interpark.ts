/**
 * BTS 광화문 티켓팅 매크로 - OpenClaw 버전
 * 
 * 인터파크(NOL) 예매 플로우 (2026년 기준):
 * 1. 공연 페이지 접속 (tickets.interpark.com/goods/{id})
 * 2. 예매하기 클릭 → 로그인 페이지로 리다이렉트
 * 3. NOL 통합 로그인 (accounts.yanolja.com)
 * 4. 로그인 완료 → 예매 페이지로 복귀
 * 5. 대기열 통과 (티켓 오픈 시)
 * 6. 좌석 선택 (연석 지원)
 * 7. 결제 진행
 * 
 * 핵심 변경사항 (2026):
 * - 인터파크 → NOL 인터파크 리브랜딩
 * - 로그인: iframe → 별도 페이지 (accounts.yanolja.com)
 * - 대기열 시스템 강화
 */

export interface TicketingConfig {
  // 로그인 정보
  userId: string;
  userPwd: string;
  
  // 공연 정보
  concertUrl: string;  // https://tickets.interpark.com/goods/{goodsCode}
  goodsCode: string;   // 공연 코드 (예: 26001600)
  
  // 좌석 우선순위
  seatPriority: string[];  // ['VIP석', '일반석']
  seatCount: number;       // 연석 개수 (1-4)
  
  // 날짜/회차
  targetDate: string;     // YYYY-MM-DD
  targetRound: number;    // 1, 2, 3...
  
  // 결제 정보
  birthDate: string;      // YYMMDD
  paymentMethod: PaymentMethod;
  
  // 타이밍
  startTime: Date;        // 티켓 오픈 시간
  
  // 알림
  telegramNotify: boolean;
}

export type PaymentMethod = 
  | 'kakaopay'
  | 'naverpay'
  | 'card'
  | 'bank';

// 예매 단계
export type BookingStep = 
  | 'init'
  | 'login'
  | 'navigate'
  | 'waiting'      // 대기열
  | 'captcha'
  | 'date_select'
  | 'round_select'
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
  queuePosition?: number;
  retryCount: number;
}

// ============================================================
// 셀렉터 정의 (2026년 NOL 인터파크 기준)
// ============================================================

export const SELECTORS = {
  // === 메인 페이지 ===
  LOGIN_BUTTON: 'button:has-text("로그인")',
  MY_RESERVATION: 'button:has-text("내 예약")',
  
  // === 공연 상세 페이지 ===
  CONCERT_TITLE: 'h2[class*="title"]',
  BOOKING_BUTTON: 'a:has-text("예매하기")',
  BOOKING_BUTTON_FOREIGN: 'a:has-text("BOOKING")',
  
  // 날짜 선택
  CALENDAR_PREV: 'listitem:has-text("‹")',
  CALENDAR_NEXT: 'listitem:has-text("›")',
  CALENDAR_DATE: (day: number) => `listitem:has-text("${day}")`,
  
  // 회차 선택
  ROUND_BUTTON: (round: number) => `button:has-text("${round}회")`,
  
  // 팝업 닫기
  POPUP_CLOSE: 'button:has-text("닫기")',
  POPUP_CHECKBOX: 'checkbox:has-text("하루동안 보지 않기")',
  
  // === NOL 로그인 페이지 (accounts.yanolja.com) ===
  LOGIN_KAKAO: 'button:has-text("카카오로 시작하기")',
  LOGIN_NAVER: 'button:has-text("네이버로 시작하기")',
  LOGIN_GOOGLE: 'button:has-text("구글로 시작하기")',
  LOGIN_APPLE: 'button:has-text("애플로 시작하기")',
  LOGIN_EMAIL: 'a:has-text("이메일로 시작하기")',
  LOGIN_LEGACY: 'button:has-text("기존 인터파크 계정 로그인")',
  
  // 기존 인터파크 로그인 폼
  LOGIN_ID_INPUT: 'textbox[placeholder="아이디"]',
  LOGIN_PW_INPUT: 'textbox[placeholder="비밀번호"]',
  LOGIN_SUBMIT: 'button:has-text("로그인")',
  LOGIN_KEEP: 'checkbox:has-text("로그인 상태 유지")',
  
  // === 대기열 ===
  QUEUE_POSITION: '[class*="queue-position"]',
  QUEUE_WAIT_TIME: '[class*="wait-time"]',
  
  // === 좌석 선택 ===
  // 좌석 선택 iframe
  SEAT_IFRAME: 'iframe[id="ifrmSeat"]',
  SEAT_DETAIL_IFRAME: 'iframe[id="ifrmSeatDetail"]',
  
  // 좌석 등급 선택
  SEAT_GRADE_VIP: 'button:has-text("VIP석")',
  SEAT_GRADE_REGULAR: 'button:has-text("일반석")',
  SEAT_GRADE_R: 'button:has-text("R석")',
  SEAT_GRADE_S: 'button:has-text("S석")',
  
  // 좌석
  SEAT_AVAILABLE: '[class*="seat"][class*="available"]',
  SEAT_SELECTED: '[class*="seat"][class*="selected"]',
  SEAT_SOLDOUT: '[class*="seat"][class*="soldout"]',
  
  // 다음 단계
  NEXT_STEP: 'button:has-text("다음단계")',
  CONFIRM_SEAT: 'button:has-text("선택완료")',
  
  // === 결제 ===
  BOOKING_STEP_IFRAME: 'iframe[id="ifrmBookStep"]',
  
  // 가격 선택
  PRICE_SELECT: 'select[id*="Price"]',
  
  // 예매자 정보
  BIRTH_DATE_INPUT: 'input[id="YYMMDD"]',
  
  // 결제 수단
  PAYMENT_KAKAOPAY: 'button:has-text("카카오페이")',
  PAYMENT_NAVERPAY: 'button:has-text("네이버페이")',
  PAYMENT_CARD: 'input[id*="Payment_22004"]',
  PAYMENT_BANK: 'input[id*="Payment_22003"]',
  
  // 약관 동의
  AGREE_ALL: 'checkbox[id="checkAll"]',
  
  // 최종 결제
  FINAL_PAYMENT: 'button:has-text("결제하기")',
  
  // === 에러 메시지 ===
  ERROR_SEAT_TAKEN: ':has-text("이미 선점")',
  ERROR_TIMEOUT: ':has-text("시간 초과")',
  ERROR_SOLDOUT: ':has-text("매진")',
  ERROR_NETWORK: ':has-text("네트워크")',
};

// 기존 XPath (호환성 유지용 - deprecated)
export const XPATH = {
  // @deprecated - 새 SELECTORS 사용 권장
  LOGIN_BUTTON: '//*[@id="__next"]/div/header/div/div[1]/div/div[1]/a',
  LOGIN_IFRAME: "//div[@class='leftLoginBox']/iframe[@title='login']",
  USER_ID: '//*[@id="userId"]',
  USER_PWD: '//*[@id="userPwd"]',
  BOOKING_BUTTON: '//*[@id="productSide"]/div/div[2]/a[1]',
  CAPTCHA_IMAGE: '//*[@id="imgCaptcha"]',
  CAPTCHA_INPUT: '//*[@id="txtCaptcha"]',
  CAPTCHA_CONFIRM: '//*[@id="divRecaptcha"]/div[1]/div[4]/a[2]',
  CAPTCHA_REFRESH: '//*[@id="divRecaptcha"]/div[1]/div[1]/a[1]',
  SEAT_IFRAME: '//*[@id="ifrmSeat"]',
  SEAT_DETAIL_IFRAME: '//*[@id="ifrmSeatDetail"]',
  SEATS: '//*[@id="Seats"]',
  NEXT_STEP: '//*[@id="NextStepImage"]',
  BOOKING_STEP_IFRAME: '//*[@id="ifrmBookStep"]',
  PRICE_SELECT: '//*[@id="PriceRow001"]/td[3]/select',
  BIRTH_DATE: '//*[@id="YYMMDD"]',
  PAYMENT_CARD: '//*[@id="Payment_22004"]/td/input',
  AGREE_ALL: '//*[@id="checkAll"]',
  FINAL_BUTTON: '//*[@id="LargeNextBtnImage"]',
};

// ============================================================
// OpenClaw 기반 티켓팅 함수들
// ============================================================

/**
 * 티켓팅 시작
 */
export async function startTicketing(config: TicketingConfig): Promise<BookingState> {
  console.log('🎫 BTS 티켓팅 시작');
  console.log(`공연: ${config.concertUrl}`);
  console.log(`오픈 시간: ${config.startTime.toLocaleString()}`);
  console.log(`좌석 우선순위: ${config.seatPriority.join(' > ')}`);
  console.log(`연석: ${config.seatCount}매`);
  
  const state: BookingState = {
    step: 'init',
    startedAt: new Date(),
    lastAction: 'initialized',
    retryCount: 0,
  };
  
  // OpenClaw browser tool 사용:
  // 1. browser.open(config.concertUrl)
  // 2. browser.snapshot() → 페이지 분석
  // 3. 로그인 상태 확인
  // 4. 예매 진행
  
  return state;
}

/**
 * NOL 통합 로그인
 * 
 * 플로우:
 * 1. 예매하기 클릭 시 accounts.yanolja.com으로 리다이렉트
 * 2. "기존 인터파크 계정 로그인" 클릭
 * 3. ID/PW 입력
 * 4. 로그인 완료 후 원래 페이지로 복귀
 */
export async function login(userId: string, userPwd: string): Promise<boolean> {
  console.log('🔐 NOL 로그인 시작...');
  
  // OpenClaw 명령어:
  // 1. browser.snapshot() - 로그인 페이지 확인
  // 2. browser.act({ kind: 'click', selector: SELECTORS.LOGIN_LEGACY })
  // 3. browser.act({ kind: 'type', selector: SELECTORS.LOGIN_ID_INPUT, text: userId })
  // 4. browser.act({ kind: 'type', selector: SELECTORS.LOGIN_PW_INPUT, text: userPwd })
  // 5. browser.act({ kind: 'click', selector: SELECTORS.LOGIN_SUBMIT })
  
  return true;
}

/**
 * 날짜/회차 선택
 */
export async function selectDateAndRound(date: string, round: number): Promise<boolean> {
  console.log(`📅 날짜 선택: ${date}, 회차: ${round}`);
  
  // OpenClaw 명령어:
  // 1. 캘린더에서 날짜 클릭
  // 2. 회차 버튼 클릭
  
  return true;
}

/**
 * 좌석 선택 (연석 지원)
 * 
 * 전략:
 * 1. 우선순위 등급부터 시도
 * 2. 빈 좌석 중 연속된 좌석 찾기
 * 3. 연석이 없으면 개별 좌석 선택
 */
export async function selectSeats(
  priority: string[], 
  count: number
): Promise<string[] | null> {
  console.log(`💺 좌석 선택 중... (${count}석)`);
  
  // 연석 로직:
  // 1. 같은 열에서 연속된 빈 좌석 찾기
  // 2. count만큼 선택
  // 3. 실패 시 다음 등급으로
  
  return null;
}

/**
 * 결제 처리
 */
export async function processPayment(
  birthDate: string, 
  method: PaymentMethod
): Promise<boolean> {
  console.log(`💳 결제 처리 중... (${method})`);
  
  // OpenClaw 명령어:
  // 1. 생년월일 입력
  // 2. 결제 수단 선택
  // 3. 약관 동의
  // 4. 결제 버튼 클릭
  
  return true;
}

// ============================================================
// 에러 처리 및 복구
// ============================================================

export interface ErrorHandler {
  type: 'seat_taken' | 'timeout' | 'network' | 'captcha' | 'unknown';
  retry: boolean;
  maxRetries: number;
  action: () => Promise<void>;
}

export const ERROR_HANDLERS: Record<string, ErrorHandler> = {
  seat_taken: {
    type: 'seat_taken',
    retry: true,
    maxRetries: 5,
    action: async () => {
      console.log('⚠️ 좌석이 선점됨 - 다른 좌석 시도');
      // 다른 좌석 선택 로직
    },
  },
  timeout: {
    type: 'timeout',
    retry: true,
    maxRetries: 3,
    action: async () => {
      console.log('⚠️ 시간 초과 - 재시도');
      // 페이지 새로고침 후 재시도
    },
  },
  network: {
    type: 'network',
    retry: true,
    maxRetries: 10,
    action: async () => {
      console.log('⚠️ 네트워크 오류 - 대기 후 재시도');
      await new Promise(resolve => setTimeout(resolve, 1000));
    },
  },
};

/**
 * 에러 감지 및 처리
 */
export async function handleError(
  errorText: string, 
  state: BookingState
): Promise<BookingState> {
  if (errorText.includes('선점') || errorText.includes('taken')) {
    state.error = 'seat_taken';
    state.retryCount++;
    console.log(`🔄 좌석 선점됨 - 재시도 ${state.retryCount}`);
  } else if (errorText.includes('시간') || errorText.includes('timeout')) {
    state.error = 'timeout';
    state.retryCount++;
    console.log(`🔄 시간 초과 - 재시도 ${state.retryCount}`);
  } else if (errorText.includes('네트워크') || errorText.includes('network')) {
    state.error = 'network';
    state.retryCount++;
    console.log(`🔄 네트워크 오류 - 재시도 ${state.retryCount}`);
  }
  
  return state;
}

// ============================================================
// 유틸리티
// ============================================================

/**
 * 대기열 위치 파싱
 */
export function parseQueuePosition(text: string): number | null {
  const match = text.match(/(\d+)/);
  return match ? parseInt(match[1], 10) : null;
}

/**
 * 오픈 시간까지 대기
 */
export async function waitUntilOpen(openTime: Date): Promise<void> {
  const now = new Date();
  const diff = openTime.getTime() - now.getTime();
  
  if (diff > 0) {
    console.log(`⏰ 오픈까지 ${Math.ceil(diff / 1000)}초 대기...`);
    
    // 5초 전부터 새로고침 시작
    const refreshAt = diff - 5000;
    if (refreshAt > 0) {
      await new Promise(resolve => setTimeout(resolve, refreshAt));
    }
    
    console.log('🚀 오픈 임박! 새로고침 시작');
  }
}

/**
 * 텔레그램 알림
 */
export async function notifyTelegram(message: string): Promise<void> {
  console.log(`📱 [Telegram] ${message}`);
  // OpenClaw message tool 사용:
  // await message.send({ target: 'Han', message: message });
}
