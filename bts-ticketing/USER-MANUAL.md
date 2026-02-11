# BTS 광화문 티켓팅 매크로 - 사용자 매뉴얼 📖

> **목표**: 2026년 2월 23일 오후 8시, BTS 광화문 공연 티켓 확보  
> **대상**: 비개발자도 따라할 수 있게  
> **예상 소요 시간**: 설치 30분, 설정 10분

---

## 📋 목차

1. [사전 준비](#1-사전-준비)
2. [설치하기](#2-설치하기)
3. [설정하기](#3-설정하기)
4. [테스트하기](#4-테스트하기)
5. [D-Day 체크리스트](#5-d-day-체크리스트)
6. [트러블슈팅](#6-트러블슈팅)

---

## 1. 사전 준비

### 1.1 필요한 계정

#### 인터파크 계정 (필수)
- 이미 있으면 OK
- 없으면: https://www.interpark.com → 회원가입
- **팁**: 계정 2~3개 만들어두면 성공률 UP

#### 2Captcha 계정 (권장)
CAPTCHA(보안문자)를 자동으로 풀어주는 서비스

**가입 방법:**
1. https://2captcha.com 접속
2. 오른쪽 상단 `Sign Up` 클릭
3. 이메일, 비밀번호 입력 → 가입
4. 이메일 인증 완료

**충전 방법:**
1. 로그인 후 `Add funds` 클릭
2. 금액 선택 (추천: $10 = 약 ₩14,000)
3. 결제 방법 선택:
   - 신용카드/체크카드 (Visa, Mastercard) — 해외결제 가능한 카드
   - PayPal
   - 암호화폐
4. 결제 완료

**API 키 확인:**
1. 로그인 후 대시보드 접속
2. `API Key` 항목에서 복사
3. 형식 예시: `1abc2def3ghi4jkl5mno6pqr7stu8vwx`

### 1.2 필요한 프로그램

| 프로그램 | 용도 | 설치 확인 방법 |
|----------|------|--------------|
| Python 3.10+ | 매크로 실행 | 터미널에서 `python3 --version` |
| Chrome | 브라우저 자동화 | 앱 목록에서 확인 |
| Git | 코드 다운로드 | 터미널에서 `git --version` |

#### Python 설치 (없을 경우)
1. https://www.python.org/downloads/ 접속
2. `Download Python 3.12.x` 클릭
3. 다운로드된 파일 실행
4. **중요**: 설치 화면에서 `Add Python to PATH` 체크 ✅
5. `Install Now` 클릭

---

## 2. 설치하기

### 2.1 터미널 열기

**Mac:**
- `Command(⌘) + Space` → "터미널" 입력 → Enter

**Windows:**
- `Windows + R` → "cmd" 입력 → Enter

### 2.2 프로젝트 폴더로 이동

```bash
cd ~/.openclaw/workspace/bts-ticketing
```

### 2.3 가상환경 만들기

가상환경은 이 프로젝트만을 위한 독립된 Python 공간입니다.

```bash
# 가상환경 생성
python3 -m venv venv

# 가상환경 활성화 (Mac/Linux)
source venv/bin/activate

# 가상환경 활성화 (Windows)
venv\Scripts\activate
```

활성화되면 터미널 앞에 `(venv)`가 표시됩니다:
```
(venv) ~ $
```

### 2.4 필요한 패키지 설치

```bash
pip install -r requirements.txt
```

또는 직접 설치:
```bash
pip install nodriver requests 2captcha-python
```

### 2.5 설치 확인

```bash
python3 -c "import nodriver; print('✅ 설치 성공!')"
```

"✅ 설치 성공!"이 출력되면 OK

---

## 3. 설정하기

### 3.1 환경변수 설정

민감한 정보(ID, 비밀번호, API 키)는 코드에 직접 넣지 않고 환경변수로 설정합니다.

**.env 파일 생성:**

```bash
# 프로젝트 폴더에서
touch .env
```

**.env 파일 내용 작성:**

```bash
# 텍스트 편집기로 열기
open .env  # Mac
```

아래 내용을 복사하고 본인 정보로 수정:

```
# 인터파크 로그인 정보
INTERPARK_ID=내아이디
INTERPARK_PWD=내비밀번호

# 2Captcha API 키 (2captcha.com에서 확인)
TWOCAPTCHA_API_KEY=1abc2def3ghi4jkl5mno6pqr7stu8vwx

# 텔레그램 알림 (선택사항)
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
```

**환경변수 적용:**

```bash
# Mac/Linux
export $(cat .env | xargs)

# 또는 직접 입력
export INTERPARK_ID="내아이디"
export INTERPARK_PWD="내비밀번호"
```

### 3.2 공연 URL 설정

공연 티켓 URL이 공개되면 `src/main_nodriver.py` 파일에서 수정:

```python
# 현재 (TODO 상태)
'CONCERT_URL': 'https://tickets.interpark.com/goods/XXXXXXX',

# 수정 후 (실제 URL로 변경)
'CONCERT_URL': 'https://tickets.interpark.com/goods/실제공연코드',
```

**URL 찾는 방법:**
1. 인터파크 티켓 사이트 접속
2. "BTS 광화문" 검색
3. 공연 상세 페이지 URL 복사

### 3.3 좌석 우선순위 설정 (선택)

원하는 좌석 등급 순서 변경:

```python
'SEAT_PRIORITY': ['VIP', 'R석', 'S석', 'A석'],
```

---

## 4. 테스트하기

### 4.1 테스트 모드 실행

**실제 BTS 공연 전에 반드시 다른 공연으로 테스트하세요!**

1. 다른 공연 URL로 변경 (아무 공연이나 OK)
2. 테스트 모드 실행:

```bash
cd ~/.openclaw/workspace/bts-ticketing
source venv/bin/activate  # 가상환경 활성화
python3 src/main_nodriver.py --test
```

### 4.2 테스트 체크리스트

- [ ] 브라우저가 자동으로 열리는가?
- [ ] 인터파크 로그인이 되는가?
- [ ] 공연 페이지로 이동하는가?
- [ ] 예매 버튼이 클릭되는가?
- [ ] CAPTCHA가 나오면 알림이 오는가?

### 4.3 흔한 테스트 문제

**"ModuleNotFoundError: No module named 'nodriver'"**
→ 가상환경 활성화 확인: `source venv/bin/activate`

**브라우저가 안 열림**
→ Chrome이 설치되어 있는지 확인

**로그인 실패**
→ ID/PW 오타 확인, 환경변수 설정 확인

---

## 5. D-Day 체크리스트

### 📅 D-1 (2월 22일)

- [ ] 인터파크 계정 로그인 되는지 확인
- [ ] 결제수단 미리 등록 (신용카드, 카카오페이 등)
- [ ] 2Captcha 잔액 확인 ($5 이상)
- [ ] 테스트 모드로 최종 리허설
- [ ] Mac mini 전원 켜두기
- [ ] 인터넷 속도 테스트 (네이버에서 "속도 테스트" 검색)

### 📅 D-Day (2월 23일)

**오후 6시**
- [ ] Mac mini 상태 확인
- [ ] 터미널 열기
- [ ] 프로젝트 폴더로 이동
- [ ] 가상환경 활성화

**오후 7시**
- [ ] 브라우저 미리 실행:
```bash
python3 src/main_nodriver.py --live
```
- [ ] 로그인 완료 확인
- [ ] 공연 페이지 대기 중 확인

**오후 7시 50분**
- [ ] 화면 앞에 대기
- [ ] CAPTCHA 입력 준비 (키보드 준비)
- [ ] 텔레그램 알림 확인 가능한 상태

**오후 8시 정각**
- 🚀 자동으로 티켓팅 시작됨
- ⚠️ CAPTCHA 알림 오면 빠르게 입력!
- 💳 좌석 선택 성공하면 결제는 직접!

### 💳 결제 시 주의사항

결제는 **보안상 자동화하지 않습니다.** 직접 결제해주세요.

1. 좌석 선택 성공 알림 오면
2. 결제 화면에서 결제수단 선택
3. 결제 진행 (카드, 카카오페이 등)
4. 예매 완료 확인

---

## 6. 트러블슈팅

### 🔴 자주 발생하는 문제

#### "Chrome을 찾을 수 없습니다"

**원인**: Chrome이 설치되지 않았거나 경로가 다름

**해결**:
1. Chrome 설치 확인
2. 설치되어 있다면:
```bash
# Mac에서 Chrome 경로 확인
ls /Applications/Google\ Chrome.app
```

#### "로그인 실패"

**원인**: ID/PW 오류 또는 환경변수 미설정

**해결**:
1. 환경변수 확인:
```bash
echo $INTERPARK_ID
echo $INTERPARK_PWD
```
2. 빈 값이면 다시 설정:
```bash
export INTERPARK_ID="내아이디"
export INTERPARK_PWD="내비밀번호"
```

#### "예매 버튼을 찾을 수 없습니다"

**원인**: 공연 URL이 잘못되었거나, 페이지 구조가 변경됨

**해결**:
1. URL 확인 — 공연 상세 페이지 URL이 맞는지
2. 직접 브라우저로 접속해서 예매 버튼 위치 확인

#### "CAPTCHA 해결 실패"

**원인**: 2Captcha 잔액 부족 또는 API 키 오류

**해결**:
1. https://2captcha.com 로그인
2. 잔액 확인 (Balance)
3. API 키 재확인

#### "좌석을 찾을 수 없습니다" (매진)

**원인**: 실제로 매진됨 😢

**해결**:
- 취켓팅 모드로 전환 (계속 새로고침하며 취소표 대기)
- 수동으로 다른 회차 시도

### 🟡 성능 최적화 팁

1. **인터넷**: 유선 LAN 연결 (Wi-Fi보다 안정적)
2. **위치**: 서울에서 실행 (서버와 가까움)
3. **시간 동기화**: Mac의 시간이 정확한지 확인
   - 시스템 환경설정 → 날짜 및 시간 → 자동으로 설정 ✅
4. **다른 앱 종료**: 리소스 확보

### 🔵 비상 상황 대응

**매크로가 멈춤**
1. 터미널에서 `Ctrl + C`로 중단
2. 다시 실행:
```bash
python3 src/main_nodriver.py --live
```

**브라우저가 닫힘**
1. 터미널 확인 (에러 메시지)
2. 다시 실행

**CAPTCHA가 계속 나옴**
1. 수동으로 입력 (30초 내)
2. 안 풀리면 새로고침 후 재시도

---

## 📞 긴급 연락

문제 발생 시 Clo에게 텔레그램으로 연락하세요.
가능한 정보를 함께 보내주세요:
- 에러 메시지 스크린샷
- 어떤 단계에서 멈췄는지
- 언제 발생했는지

---

## 📝 명령어 모음 (치트시트)

```bash
# 프로젝트 폴더로 이동
cd ~/.openclaw/workspace/bts-ticketing

# 가상환경 활성화
source venv/bin/activate

# 테스트 모드 (연습용)
python3 src/main_nodriver.py --test

# 실전 모드 (D-Day)
python3 src/main_nodriver.py --live

# 환경변수 설정
export INTERPARK_ID="아이디"
export INTERPARK_PWD="비밀번호"

# 설치 확인
pip list | grep nodriver
```

---

**행운을 빕니다! 🎫💜**

*Last updated: 2026-02-10*
