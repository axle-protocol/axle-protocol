# Korean Stock Alert 🇰🇷📈

프리미엄 한국 주식 모니터링 및 알림 스킬입니다. KOSPI/KOSDAQ 실시간 주가 조회, 목표가 알림, 포트폴리오 추적 기능을 제공합니다.

## 🚀 빠른 시작

### 1. 설치
```bash
cd /Users/hyunwoo/.openclaw/workspace/skills/korean-stock-alert
./scripts/install.sh
```

### 2. 기본 사용법
```bash
# 삼성전자 주가 조회
python3 scripts/stock.py --code 005930

# 종목명으로 조회 (예: 네이버)
python3 scripts/stock.py --name "NAVER"

# 시장 지수 요약
python3 scripts/stock.py --market-summary

# KOSPI 상위 종목
python3 scripts/stock.py --top-stocks kospi

# KOSDAQ 상위 종목  
python3 scripts/stock.py --top-stocks kosdaq
```

## 📊 주요 기능

### ✅ 실시간 주가 조회
- 종목코드 또는 종목명으로 검색
- 현재가, 등락률, 거래량 정보
- 52주 최고/최저가
- 시가총액

### 🎯 목표가 알림
- 상승/하락 목표가 설정
- 실시간 가격 모니터링
- 알림 조건 도달시 알림

### 📈 시장 분석
- KOSPI/KOSDAQ 지수 현황
- 상위 거래량 종목
- 상승률/하락률 상위 종목

### 💼 포트폴리오 관리
- 관심종목 리스트
- 보유종목 수익률 계산
- 포트폴리오 현황 대시보드

## 📁 파일 구조

```
korean-stock-alert/
├── SKILL.md                # 스킬 설명서
├── README.md              # 사용 가이드
├── portfolio.json         # 포트폴리오 설정
├── scripts/
│   ├── stock.py          # 메인 스크립트
│   └── install.sh        # 설치 스크립트
└── references/
    └── carriers.md       # 주요 종목코드 목록
```

## 🔧 기술적 세부사항

### 데이터 소스
- **네이버 금융** (finance.naver.com)
- 실시간 시세 정보
- 한국거래소(KRX) 공식 데이터

### 사용 기술
- **Python 3.9+**
- **requests** - HTTP 요청
- **BeautifulSoup4** - HTML 파싱
- **lxml** - XML/HTML 처리

### API 응답 형식
```json
{
  "code": "005930",
  "name": "삼성전자", 
  "current_price": "150,400",
  "change": "10,100",
  "change_rate": "7.2%",
  "volume": "160,500",
  "market_cap": "900조원",
  "high_52w": "180,000",
  "low_52w": "120,000",
  "timestamp": "2026-02-02 21:36:18",
  "market": "KOSPI"
}
```

## 📋 지원 종목

### KOSPI (한국종합주가지수)
- 삼성전자, SK하이닉스, LG화학
- NAVER, 카카오, 현대차, 기아
- KB금융, 신한지주, POSCO홀딩스
- 총 800+ 종목

### KOSDAQ (코스닥)
- 에코프로, 에코프로비엠
- 펄어비스, 위메이드, 크래프톤
- 엔씨소프트, 넷마블
- 총 1,500+ 종목

상세한 종목코드 목록은 `references/carriers.md`를 참고하세요.

## ⚠️ 주의사항

1. **실시간 데이터**: 20분 지연될 수 있습니다
2. **사용 제한**: 과도한 요청시 IP 차단 가능
3. **투자 판단**: 본 데이터는 참고용이며 투자 책임은 본인에게 있습니다

## 🔄 업데이트 로그

- **v1.0.0** (2026-02-02): 초기 릴리스
  - 실시간 주가 조회 기능
  - 시장 지수 요약
  - 주요 종목코드 데이터베이스

## 📞 지원

문제가 발생하거나 기능 요청이 있으시면:
1. 스킬 폴더에서 로그 확인
2. 네트워크 연결 상태 확인  
3. Python 패키지 재설치

---

**⚡ Korean Stock Alert - 똑똑한 주식 투자의 시작! 📊🚀**