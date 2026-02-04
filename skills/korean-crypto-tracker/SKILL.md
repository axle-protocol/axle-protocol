---
name: korean-crypto-tracker
description: Track cryptocurrency prices on Korean exchanges (Upbit, Bithumb) with real-time quotes, Kimchi premium calculation (Korea vs global price gap), volume spike detection, and price alerts. Use when checking Korean crypto prices, monitoring Kimchi premium, or tracking Korean exchange market data.
---

# Korean Crypto Tracker

한국 암호화폐 거래소(업비트, 빗썸)의 실시간 시세를 추적하고 김치 프리미엄을 계산하는 고급 도구입니다.

## 주요 기능

### 1. 실시간 시세 조회
- 업비트(Upbit) 실시간 가격
- 빗썸(Bithumb) 실시간 가격
- 주요 암호화폐 현재가, 변동률, 거래량

### 2. 김치 프리미엄 계산
- 한국 거래소 vs 해외 거래소(Binance) 가격차
- 프리미엄/디스카운트 비율 계산
- 차익거래 기회 식별

### 3. 거래량 급등 탐지
- 24시간 거래량 변화율 모니터링
- 급등 종목 자동 탐지
- 시장 관심 종목 추천

### 4. 가격 알림
- 목표 가격 도달시 알림
- 김치 프리미엄 임계값 알림
- 거래량 급등 알림

### 5. 시장 요약
- 일일 시장 현황 요약
- 주요 지표 및 트렌드 분석
- TOP 가격 상승/하락 종목

## 사용법

### 기본 명령어

```bash
# 실시간 시세 조회
python scripts/crypto.py --prices

# 김치 프리미엄 계산
python scripts/crypto.py --kimchi-premium

# 거래량 급등 종목
python scripts/crypto.py --volume-surge

# 일일 시장 요약
python scripts/crypto.py --market-summary

# 특정 코인 상세 정보
python scripts/crypto.py --coin BTC

# 가격 알림 설정
python scripts/crypto.py --alert BTC 100000000 --exchange upbit
```

### 김치 프리미엄 모니터링

```bash
# 모든 주요 코인의 김치 프리미엄
python scripts/crypto.py --kimchi-premium --all

# 특정 코인의 김치 프리미엄
python scripts/crypto.py --kimchi-premium --coin BTC

# 프리미엄 임계값 이상인 코인만
python scripts/crypto.py --kimchi-premium --threshold 5
```

## 설치

```bash
cd scripts
chmod +x install.sh
./install.sh
```

## API 정보

- **업비트 API**: https://docs.upbit.com/docs
- **빗썸 API**: https://apidocs.bithumb.com/
- **바이낸스 API**: https://binance-docs.github.io/apidocs/

모든 API는 공개 데이터를 사용하므로 API 키가 필요하지 않습니다.

## 출력 형식

### JSON 형식
```bash
python scripts/crypto.py --prices --format json
```

### 테이블 형식 (기본)
```bash
python scripts/crypto.py --prices --format table
```

### 요약 형식
```bash
python scripts/crypto.py --market-summary --format summary
```

## 지원 거래소

- **업비트(Upbit)**: KRW 마켓
- **빗썸(Bithumb)**: KRW 마켓
- **바이낸스(Binance)**: USDT 마켓 (김치 프리미엄 계산용)

## 주의사항

- 실시간 데이터는 각 거래소의 API 응답 시간에 따라 지연될 수 있습니다
- 김치 프리미엄 계산시 환율 변동이 반영됩니다
- API 호출 제한을 고려하여 적절한 간격으로 요청하세요