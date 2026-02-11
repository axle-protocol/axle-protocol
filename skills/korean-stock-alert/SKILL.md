---
name: korean-stock-alert
author: han
description: Monitor Korean stock market (KOSPI/KOSDAQ) with real-time price alerts, portfolio tracking, and daily market summaries. Use when checking Korean stock prices, setting price alerts for Korean stocks, or getting daily Korean market briefings. Supports all KRX-listed stocks.
---

# Korean Stock Alert Skill

한국 주식 시장 모니터링과 알림을 위한 프리미엄 스킬입니다.

## 기능

### 1. 실시간 주식 가격 조회
- KOSPI/KOSDAQ 모든 상장 종목 지원
- 현재가, 등락률, 거래량 등 주요 정보 제공
- 종목코드 또는 종목명으로 검색 가능

### 2. 목표가 알림
- 특정 가격 도달 시 알림 기능
- 상승/하락 목표가 설정 가능
- 포트폴리오 기반 알림 관리

### 3. 일일 시장 요약
- KOSPI/KOSDAQ 지수 동향
- 상승률/하락률 상위 종목
- 거래량 급증 종목 분석

### 4. 관심종목 포트폴리오 추적
- 개인별 관심종목 관리
- 수익률 계산 및 손익 현황
- 포트폴리오 분석 리포트

## 사용법

### 기본 가격 조회
```
삼성전자 주가 알려줘
005930 현재가 확인해줘
```

### 포트폴리오 관리
```
관심종목에 카카오 추가해줘
내 포트폴리오 현황 보여줘
```

### 시장 분석
```
오늘 코스피 상황 알려줘
거래량 급증 종목 찾아줘
```

## 데이터 소스

- 네이버 금융 API
- 실시간 시세 정보
- KRX 공식 데이터

## 파일 구조

- `scripts/stock.py` - 주식 데이터 조회 메인 스크립트
- `scripts/install.sh` - 필요한 패키지 설치
- `references/carriers.md` - 주요 종목 코드 목록

## 설치 및 설정

스킬을 처음 사용할 때 필요한 패키지를 자동으로 설치합니다:

```bash
./scripts/install.sh
```

## 지원 종목

한국거래소(KRX)에 상장된 모든 주식을 지원합니다:
- KOSPI 시장
- KOSDAQ 시장
- KONEX 시장

주요 종목 코드는 `references/carriers.md`를 참조하세요.