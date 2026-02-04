# Korean Exchange APIs Reference

한국 주요 암호화폐 거래소 API 문서 요약

## 업비트 (Upbit) API

### 기본 정보
- Base URL: `https://api.upbit.com`
- API 키 불필요 (공개 데이터)
- Rate Limit: 초당 10회, 분당 600회

### 주요 엔드포인트

#### 1. 시세 조회
```
GET /v1/ticker?markets={market-codes}
```

**예시:**
```
https://api.upbit.com/v1/ticker?markets=KRW-BTC,KRW-ETH,KRW-XRP
```

**응답 형식:**
```json
[
  {
    "market": "KRW-BTC",
    "trade_date": "20240101",
    "trade_time": "120000",
    "trade_date_kst": "20240101",
    "trade_time_kst": "210000",
    "trade_timestamp": 1704110400000,
    "opening_price": 58000000.0,
    "high_price": 59000000.0,
    "low_price": 57000000.0,
    "trade_price": 58500000.0,
    "prev_closing_price": 58000000.0,
    "change": "RISE",
    "change_price": 500000.0,
    "change_rate": 0.00862069,
    "signed_change_price": 500000.0,
    "signed_change_rate": 0.00862069,
    "trade_volume": 0.12345678,
    "acc_trade_price": 12345678900.0,
    "acc_trade_price_24h": 98765432100.0,
    "acc_trade_volume": 1234.56789,
    "acc_trade_volume_24h": 9876.54321,
    "highest_52_week_price": 75000000.0,
    "highest_52_week_date": "2023-12-01",
    "lowest_52_week_price": 25000000.0,
    "lowest_52_week_date": "2023-03-15",
    "timestamp": 1704110400000
  }
]
```

#### 2. 마켓 코드 조회
```
GET /v1/market/all?isDetails=true
```

**응답:**
```json
[
  {
    "market": "KRW-BTC",
    "korean_name": "비트코인",
    "english_name": "Bitcoin",
    "market_warning": "NONE"
  }
]
```

#### 3. 캔들 차트
```
GET /v1/candles/days?market={market}&count={count}
GET /v1/candles/minutes/{unit}?market={market}&count={count}
```

## 빗썸 (Bithumb) API

### 기본 정보
- Base URL: `https://api.bithumb.com`
- API 키 불필요 (공개 데이터)
- Rate Limit: 초당 20회

### 주요 엔드포인트

#### 1. 전체 시세 조회
```
GET /public/ticker/ALL_KRW
```

**응답 형식:**
```json
{
  "status": "0000",
  "data": {
    "BTC": {
      "opening_price": "58000000",
      "closing_price": "58500000",
      "min_price": "57000000",
      "max_price": "59000000",
      "units_traded": "1234.5678",
      "acc_trade_value": "98765432100",
      "prev_closing_price": "58000000",
      "units_traded_24H": "9876.5432",
      "acc_trade_value_24H": "567890123400",
      "fluctate_24H": "500000",
      "fluctate_rate_24H": "0.86",
      "date": "1704110400000"
    },
    "ETH": {
      // ... similar structure
    },
    "date": "1704110400535"
  }
}
```

#### 2. 특정 코인 시세
```
GET /public/ticker/{currency}_KRW
```

**예시:**
```
https://api.bithumb.com/public/ticker/BTC_KRW
```

#### 3. 호가 정보
```
GET /public/orderbook/{currency}_KRW
```

**응답:**
```json
{
  "status": "0000",
  "data": {
    "timestamp": "1704110400000",
    "order_currency": "BTC",
    "payment_currency": "KRW",
    "bids": [
      {
        "quantity": "1.2345",
        "price": "58400000"
      }
    ],
    "asks": [
      {
        "quantity": "0.9876",
        "price": "58500000"
      }
    ]
  }
}
```

## 바이낸스 (Binance) API

### 기본 정보
- Base URL: `https://api.binance.com`
- API 키 불필요 (공개 데이터)
- Rate Limit: 분당 1200회

### 주요 엔드포인트

#### 1. 24시간 가격 통계
```
GET /api/v3/ticker/24hr?symbol={symbol}
```

**예시:**
```
https://api.binance.com/api/v3/ticker/24hr?symbol=BTCUSDT
```

**응답:**
```json
{
  "symbol": "BTCUSDT",
  "priceChange": "250.00",
  "priceChangePercent": "0.862",
  "weightedAvgPrice": "43750.50",
  "prevClosePrice": "43500.00",
  "lastPrice": "43750.00",
  "lastQty": "0.12345",
  "bidPrice": "43749.00",
  "askPrice": "43751.00",
  "openPrice": "43500.00",
  "highPrice": "44000.00",
  "lowPrice": "43200.00",
  "volume": "1234.56789",
  "quoteVolume": "54000000.12",
  "openTime": 1704024000000,
  "closeTime": 1704110400000,
  "firstId": 3200000000,
  "lastId": 3200001000,
  "count": 1001
}
```

#### 2. 현재 가격
```
GET /api/v3/ticker/price?symbol={symbol}
```

## 환율 API (김치 프리미엄 계산용)

### 한국은행 API
```
GET https://www.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey={key}&searchdate={date}&data=AP01
```

### 대안: 실시간 환율 API
```
GET https://api.exchangerate-api.com/v4/latest/USD
```

## 공통 주의사항

1. **Rate Limiting**: 각 거래소별 호출 제한 준수
2. **Error Handling**: 네트워크 오류, API 장애 대응
3. **Data Validation**: 응답 데이터 검증 필수
4. **Timeout**: 적절한 타임아웃 설정 (5-10초)
5. **Retry Logic**: 실패시 재시도 로직 구현

## 김치 프리미엄 계산 공식

```
김치프리미엄 = ((한국가격 / 환율) - 해외가격) / 해외가격 * 100
```

**예시:**
- 업비트 BTC: 58,500,000 KRW
- 바이낸스 BTC: $43,750 USDT
- USD/KRW 환율: 1,330
- 계산: ((58,500,000 / 1,330) - 43,750) / 43,750 * 100 = 0.47%

## API 응답 상태 코드

### 업비트
- 정상: HTTP 200
- 오류: HTTP 400, 429, 500

### 빗썸
- 정상: status "0000"
- 오류: status "5xxx" (각종 에러 코드)

### 바이낸스
- 정상: HTTP 200
- 오류: HTTP 400, 418 (Rate limit), 429, 5xx