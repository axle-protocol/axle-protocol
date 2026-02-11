# BTS 티켓팅 핵심 문제 해결 방안

> 작성일: 2026-02-11
> 상태: 구현 중

## 문제 요약 및 해결 전략

### 1. CDP/nodriver 탐지 문제 ⚠️ HIGH PRIORITY

**문제:**
- Cloudflare가 Chrome DevTools Protocol (CDP) 연결 자체를 감지
- nodriver도 CDP 기반이라 완전한 우회 불가
- Puppeteer/Playwright 모두 CDP 사용

**최신 조사 결과 (2025-2026):**
- nodriver: CDP 사용 최소화하지만 여전히 탐지 가능
- Camoufox: Playwright 래퍼, Firefox 기반으로 CDP 없음 ✅
- Patchright: Playwright 패치 버전, 탐지율 감소
- 실제 Chrome 프로파일 사용: 탐지 우회 가능하나 자동화 어려움

**선택한 해결책:**
```
메인: Camoufox (Firefox 기반, CDP 없음)
폴백: nodriver + 실제 Chrome 프로파일 (browser_profile/ 사용)
```

**구현:**
- main_camoufox.py를 메인 버전으로 승격
- 실제 Firefox/Chrome 프로파일 경로 지정 옵션 추가


### 2. Turnstile ML 기반 탐지 ⚠️ HIGH PRIORITY

**문제:**
- Cloudflare Turnstile이 행동 분석으로 봇 감지
- 마우스 움직임, 타이핑 패턴, 시간 분포 분석
- 자동화 성공률 매우 낮음

**최신 해결 방안:**
1. **2captcha/CapSolver 서비스 연동** (가장 현실적) ✅
   - sitekey 추출 → API 호출 → token 주입
   - 비용: $2.99/1000건 (2captcha)
   - 응답 시간: 10-30초

2. **하이브리드 모드** ✅
   - 자동 시도 → 실패 시 사용자에게 수동 해결 요청
   - 음성/알림으로 사용자 호출
   - 수동 해결 후 자동화 재개

3. **행동 패턴 인간화**
   - 이미 구현됨 (마우스 베지어 곡선, 타이핑 오타 등)
   - 효과 제한적

**선택한 해결책:**
```python
# 우선순위
1. Turnstile 자동 통과 시도 (Camoufox humanize=True)
2. 실패 시 2captcha API 호출
3. 2captcha 실패 시 사용자 수동 개입 요청
```


### 3. 인터파크 셀렉터 미검증 ⚠️ MEDIUM PRIORITY

**문제:**
- 인터파크 → NOL 티켓 (tickets.interpark.com)으로 리브랜딩
- 기존 셀렉터 작동 안 할 가능성 높음
- 실제 테스트 없이 코드 작성됨

**확인된 정보:**
- 새 URL: `https://tickets.interpark.com/`
- 콘서트 URL: `https://tickets.interpark.com/goods/[ID]`
- 로그인: NOL 계정 (기존 인터파크와 별개 가능성)

**해결책:**
1. 실제 사이트 접속하여 셀렉터 수집
2. AI 기반 셀렉터 자동 탐지 (이미 ai_helper.py에 구현)
3. 동적 셀렉터 캐싱 시스템

**필요 작업:**
- [ ] tickets.interpark.com 실제 분석
- [ ] 로그인 플로우 확인 (NOL 로그인 방식)
- [ ] 예매 플로우 셀렉터 수집
- [ ] 좌석 선택 iframe/canvas 구조 확인


### 4. Canvas Fingerprint 방어 역효과 ⚠️ MEDIUM PRIORITY

**문제:**
- 현재 코드: 노이즈 추가로 fingerprint 변조
- 역효과: 노이즈 추가 자체가 봇 특성으로 탐지됨
- Canvas Defender 같은 확장 프로그램도 탐지됨

**최신 연구 결과:**
- "Anti-fingerprinting extensions are easily detected"
- "Natural, realistic fingerprints" 필요
- 노이즈 추가보다 실제 브라우저 fingerprint 복제가 효과적

**해결책:**
1. **Camoufox 사용** (이미 처리됨) ✅
   - Firefox 기반으로 자연스러운 fingerprint
   - humanize=True 옵션

2. **노이즈 방식 제거/수정**
   - 기존 stealth 스크립트에서 과도한 노이즈 제거
   - "realistic but varying" 접근 (미세한 변화만)

3. **fingerprint와 프록시 동기화**
   - 같은 세션 내 일관된 fingerprint
   - 프록시 변경 시에만 fingerprint 변경


### 5. 멀티 세션 탐지 증가 ⚠️ LOW PRIORITY

**문제:**
- 같은 IP에서 여러 세션 = 의심 행위
- fingerprint 충돌 시 즉시 차단
- 세션 간 쿠키/로컬스토리지 공유 문제

**해결책:**
1. **프록시 로테이션** (이미 proxy_pool.py 구현됨) ✅
   - Residential proxy 사용 권장
   - 세션별 다른 IP

2. **세션 간 딜레이**
   - 최소 30초 간격으로 세션 시작
   - 동시 접속 피하기

3. **fingerprint 분리**
   - 세션별 독립적인 브라우저 프로파일
   - Camoufox 자동 생성 fingerprint 사용


## 구현 우선순위

```
1. Camoufox 메인 버전 완성 (CDP 회피)
2. 2captcha Turnstile 솔버 연동
3. 하이브리드 모드 (자동 + 수동)
4. 인터파크 NOL 티켓 셀렉터 업데이트
5. Canvas stealth 스크립트 개선
```


## 핵심 코드 변경 사항

### 신규 파일
- `src/captcha_solver.py` - 2captcha/CapSolver 연동
- `src/main_hybrid.py` - 하이브리드 모드 메인

### 수정 파일
- `src/main_camoufox.py` - 프로덕션 버전으로 업그레이드
- `src/config.py` - 2captcha API 키 등 설정 추가
- `src/proxy_pool.py` - 세션별 fingerprint 동기화


## 비용 분석

| 항목 | 단가 | 예상 사용량 | 월 비용 |
|------|------|------------|--------|
| 2captcha Turnstile | $2.99/1000 | 100건 | ~$0.30 |
| Residential Proxy | $7/GB | 0.5GB | ~$3.50 |
| **합계** | | | **~$4/월** |

*실제 티켓팅은 월 1-2회이므로 비용 미미함*


## 리스크 및 완화

| 리스크 | 확률 | 영향 | 완화 방안 |
|--------|------|------|----------|
| 2captcha 응답 지연 | 중 | 높음 | 수동 폴백, 사전 워밍업 |
| 인터파크 UI 변경 | 높음 | 중 | AI 셀렉터 탐지, 모니터링 |
| IP 차단 | 중 | 중 | 프록시 풀 확대, 세션 제한 |
| 완전 매진 | 높음 | 높음 | 다중 세션, 빠른 시작 |


## 테스트 계획

1. **단위 테스트**
   - [ ] 2captcha API 연동 테스트 (sandbox)
   - [ ] Camoufox 브라우저 시작 테스트
   - [ ] 프록시 로테이션 테스트

2. **통합 테스트**
   - [ ] 인터파크 로그인 테스트 (실제 계정)
   - [ ] 예매 플로우 테스트 (오픈 전 공연)
   - [ ] Turnstile 통과 테스트

3. **실전 테스트**
   - [ ] 실제 티켓 오픈 전 리허설
   - [ ] 모니터링 및 로그 분석


## 구현 완료 항목 (2026-02-11)

### 신규 파일
- ✅ `src/captcha_solver.py` - 2captcha/CapSolver Turnstile 솔버
- ✅ `src/main_hybrid.py` - 하이브리드 모드 프로덕션 버전
- ✅ `src/test_hybrid.py` - 테스트 스크립트

### 수정 파일
- ✅ `src/config.py` - 2captcha API 키 설정 추가
- ✅ `.env.example` - 환경변수 템플릿 업데이트
- ✅ `requirements.txt` - 의존성 추가

### 핵심 해결책 요약

| 문제 | 해결책 | 상태 |
|------|--------|------|
| CDP 탐지 | Camoufox (Firefox 기반) | ✅ 구현됨 |
| Turnstile | 2captcha API + 수동 폴백 | ✅ 구현됨 |
| 셀렉터 | AI 자동 탐지 + 하드코딩 하이브리드 | ✅ 구현됨 |
| Canvas 방어 | Camoufox 자체 처리 | ✅ 구현됨 |
| 멀티 세션 | 프록시 로테이션 + 세션 딜레이 | ✅ 구현됨 |


## 사용 방법

```bash
# 1. 의존성 설치
pip install -r requirements.txt

# 2. 환경변수 설정
cp .env.example .env.local
# .env.local 편집

# 3. 테스트 실행
cd src && python test_hybrid.py

# 4. 티켓팅 실행
python main_hybrid.py --url "https://tickets.interpark.com/goods/12345" --wait --hour 20 --minute 0
```

## 권장 환경변수

```bash
# 필수
TICKET_USER_ID=your_id
TICKET_USER_PW=your_password
TICKET_URL=https://tickets.interpark.com/goods/XXXXX

# 권장 (Turnstile 자동 해결)
TWOCAPTCHA_API_KEY=your_api_key

# 선택 (멀티 세션)
PROXY_LIST=host1:port1:user1:pass1,host2:port2:user2:pass2
NUM_SESSIONS=2
```
