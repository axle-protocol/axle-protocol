# Korean Delivery Tracker

한국 주요 택배사의 배송 추적을 위한 OpenClaw 스킬입니다.

## 빠른 시작

```bash
# CJ대한통운 택배 추적
./scripts/track.sh cj 123456789012

# 택배사 자동 감지
./scripts/track.sh auto 123456789012
```

## 설치

1. OpenClaw workspace에 스킬 복사
2. 실행 권한 부여: `chmod +x scripts/track.sh`
3. 의존성 확인: `curl`, `jq` (brew로 설치 가능)

## 지원 택배사

- **CJ대한통운** - 한국 최대 물류회사
- **한진택배** - 전국 배송 네트워크
- **롯데택배** - 롯데 계열 택배서비스  
- **우체국택배** - 한국우정사업본부
- **로젠택배** - 전문 택배서비스

## 기능

✅ **실시간 추적** - 각 택배사 최신 정보  
✅ **자동 감지** - 운송장 번호로 택배사 자동 판별  
✅ **한글 지원** - 완전한 한국어 인터페이스  
✅ **캐싱** - 중복 요청 방지 및 속도 향상  
✅ **오류 처리** - 친화적인 오류 메시지  
✅ **디버그 모드** - 개발 및 문제 해결 지원  

## API 지원

- **스마트택배 API** - `SWEETTRACKER_API_KEY` 환경변수 설정 시 사용
- **웹 스크래핑** - API 미지원 시 각 택배사 웹사이트 직접 조회

## 사용 예시

```bash
# 기본 사용법
./scripts/track.sh cj 123456789012

# 디버그 모드
DEBUG=1 ./scripts/track.sh hanjin 9876543210

# 자동 감지
./scripts/track.sh auto 123456789012

# 환경변수 설정
export SWEETTRACKER_API_KEY="your_api_key"
./scripts/track.sh cj 123456789012
```

## OpenClaw 통합

이 스킬은 OpenClaw Assistant와 자동으로 통합됩니다:

```
사용자: "내 CJ택배 123456789012 어디까지 왔어?"
Assistant: 한국 택배 추적기를 사용하여 배송 상태를 확인합니다...
```

## 문제 해결

**"Package not found"** → 운송장 번호 재확인  
**"Network error"** → 인터넷 연결 확인  
**"Missing dependencies"** → `brew install curl jq`

## 라이선스

MIT License - OpenClaw 생태계의 일부로 자유롭게 사용 가능