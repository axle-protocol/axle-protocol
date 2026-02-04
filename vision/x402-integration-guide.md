# x402 프로토콜 연동 가이드 — 에이전트마켓 통합

> **작성일**: 2026-02-03  
> **목적**: Coinbase x402 프로토콜을 에이전트마켓에 통합하기 위한 기술 조사 및 연동 가이드  
> **대상 독자**: 에이전트마켓 개발팀

---

## 목차

1. [x402 프로토콜 개요](#1-x402-프로토콜-개요)
2. [동작 흐름 상세](#2-동작-흐름-상세)
3. [네트워크 지원 현황 (Solana + USDC)](#3-네트워크-지원-현황)
4. [TypeScript SDK 가이드](#4-typescript-sdk-가이드)
5. [에이전트마켓 통합 아키텍처](#5-에이전트마켓-통합-아키텍처)
6. [Next.js 연동 코드](#6-nextjs-연동-코드)
7. [수수료 징수 및 에스크로 설계](#7-수수료-징수-및-에스크로-설계)
8. [Google A2A + AP2 프로토콜 분석](#8-google-a2a--ap2-프로토콜-분석)
9. [구현 로드맵](#9-구현-로드맵)
10. [참고 자료](#10-참고-자료)

---

## 1. x402 프로토콜 개요

### 1.1 x402란?

x402는 Coinbase가 개발한 **오픈 결제 프로토콜**로, HTTP 402 (Payment Required) 상태 코드를 활용하여 인터넷 위에서 즉각적이고 자동적인 스테이블코인 결제를 가능하게 한다.

**핵심 가치:**
- 계정 생성, 세션, 인증 없이 프로그래밍 방식으로 결제
- AI 에이전트가 자율적으로 서비스 비용을 지불
- 마이크로페이먼트 (호출당 $0.001 수준)
- HTTP 네이티브 — 기존 웹 인프라와 완벽 호환

**생태계 현황** (x402.org 기준):
- 75.41M+ 트랜잭션
- $24.24M+ 거래량
- 94K+ 구매자 / 22K+ 판매자

### 1.2 핵심 구성 요소

| 구성 요소 | 역할 |
|-----------|------|
| **Client (Buyer)** | 리소스를 요청하고 결제하는 쪽 (= 에이전트) |
| **Resource Server (Seller)** | API/서비스를 제공하고 결제를 요구하는 쪽 (= 에이전트 서비스) |
| **Facilitator** | 결제 검증 + 온체인 정산을 처리하는 중간 서비스 |

### 1.3 설계 원칙

- **오픈 표준**: 특정 업체에 종속되지 않음
- **HTTP/Transport 네이티브**: 추가 요청 없이 기존 HTTP 흐름 안에서 동작
- **네트워크/토큰 불가지론**: EVM, Solana, 향후 Fiat까지 지원
- **신뢰 최소화**: Facilitator나 서버가 클라이언트 의도 외 자금 이동 불가
- **1줄 통합**: 서버 1줄, 클라이언트 1함수로 통합 가능

---

## 2. 동작 흐름 상세

### 2.1 전체 플로우

```
Client                    Resource Server              Facilitator          Blockchain
  │                            │                           │                    │
  │  1. GET /api/resource      │                           │                    │
  │ ─────────────────────────► │                           │                    │
  │                            │                           │                    │
  │  2. 402 Payment Required   │                           │                    │
  │    + PAYMENT-REQUIRED 헤더  │                           │                    │
  │ ◄───────────────────────── │                           │                    │
  │                            │                           │                    │
  │  3. 결제 페이로드 생성        │                           │                    │
  │    (지갑으로 서명)            │                           │                    │
  │                            │                           │                    │
  │  4. GET /api/resource      │                           │                    │
  │    + PAYMENT-SIGNATURE 헤더 │                           │                    │
  │ ─────────────────────────► │                           │                    │
  │                            │  5. POST /verify           │                    │
  │                            │ ────────────────────────► │                    │
  │                            │  6. Verification Response  │                    │
  │                            │ ◄──────────────────────── │                    │
  │                            │                           │                    │
  │                            │  7. (valid인 경우) 작업 수행 │                    │
  │                            │                           │                    │
  │                            │  8. POST /settle           │                    │
  │                            │ ────────────────────────► │                    │
  │                            │                           │  9. 온체인 TX 제출   │
  │                            │                           │ ──────────────────► │
  │                            │                           │  10. TX 확인         │
  │                            │                           │ ◄────────────────── │
  │                            │  11. Settlement Response   │                    │
  │                            │ ◄──────────────────────── │                    │
  │                            │                           │                    │
  │  12. 200 OK + 리소스        │                           │                    │
  │    + PAYMENT-RESPONSE 헤더  │                           │                    │
  │ ◄───────────────────────── │                           │                    │
```

### 2.2 주요 HTTP 헤더

| 헤더 | 방향 | 내용 |
|------|------|------|
| `PAYMENT-REQUIRED` | 서버 → 클라이언트 | Base64 인코딩된 결제 요구사항 (가격, 네트워크, 수신 주소 등) |
| `PAYMENT-SIGNATURE` | 클라이언트 → 서버 | 서명된 결제 페이로드 |
| `PAYMENT-RESPONSE` | 서버 → 클라이언트 | 정산 완료 정보 (TX 해시 등) |

### 2.3 결제 스킴 (Scheme)

현재 구현된 스킴은 **`exact`** — 정확한 금액을 전송하는 방식.
- EVM: EIP-3009 (Transfer With Authorization) 활용 → 가스리스 전송
- Solana: SPL Token Transfer 활용

향후 스킴:
- `upto`: 최대 금액까지만 과금 (LLM 토큰 생성 등에 적합)

---

## 3. 네트워크 지원 현황

### 3.1 CDP Facilitator 지원 네트워크

| 네트워크 | CAIP-2 ID | 스킴 | 요금 |
|----------|-----------|------|------|
| **Base (메인넷)** | `eip155:8453` | exact | 무료 1,000 tx/월 |
| **Base Sepolia (테스트)** | `eip155:84532` | exact | 무료 |
| **Solana (메인넷)** | `solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp` | exact | 무료 1,000 tx/월 |
| **Solana Devnet (테스트)** | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` | exact | 무료 |

### 3.2 Facilitator 엔드포인트

```
# 테스트넷 (API 키 불필요)
https://x402.org/facilitator

# 메인넷 (CDP API 키 필요)
https://api.cdp.coinbase.com/platform/v2/x402
```

### 3.3 요금 구조

| 티어 | 월간 트랜잭션 | 비용/건 |
|------|-------------|---------|
| Free | 1,000건까지 | $0.00 |
| Usage-based | 1,000건 초과 | $0.001 |

> 가스비는 온체인에서 별도 발생. Base/Solana 모두 극히 저렴.

### 3.4 Solana USDC 결제 흐름

```
[에이전트 A (클라이언트)]
    │
    │  USDC 잔고 보유 (SPL Token)
    │
    ├─── 1. HTTP 요청 → 에이전트 B 서버
    │
    │  ◄── 2. 402 + PAYMENT-REQUIRED
    │       { scheme: "exact", network: "solana:5eykt...", price: "$0.001" }
    │
    ├─── 3. Solana 트랜잭션 서명 (SPL Transfer)
    │       KeyPairSigner로 USDC 전송 트랜잭션 서명
    │
    ├─── 4. HTTP 재요청 + PAYMENT-SIGNATURE 헤더
    │
    │  서버 → Facilitator /verify → /settle
    │  Facilitator → Solana 네트워크에 TX 제출
    │
    │  ◄── 5. 200 OK + 응답 데이터 + PAYMENT-RESPONSE
```

**Solana Devnet 테스트 가능!**
- `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (Devnet)
- USDC Faucet 이용 가능
- 테스트넷 Facilitator: `https://x402.org/facilitator`

### 3.5 토큰 주소 참고

**USDC:**
| 네트워크 | 주소 |
|----------|------|
| Base 메인넷 | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |
| Base Sepolia | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| Solana 메인넷 | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |
| Solana Devnet | Faucet 이용 |

---

## 4. TypeScript SDK 가이드

### 4.1 패키지 목록

```bash
# 전체 패키지
npm install @x402/core @x402/evm @x402/svm @x402/axios @x402/fetch \
            @x402/express @x402/hono @x402/next @x402/paywall @x402/extensions

# 최소 클라이언트 (fetch 기반)
npm install @x402/core @x402/evm @x402/svm @x402/fetch

# 최소 서버 (Express 기반)
npm install @x402/core @x402/evm @x402/svm @x402/express

# Next.js 서버
npm install @x402/core @x402/evm @x402/svm @x402/next

# 메인넷 Facilitator (CDP)
npm install @coinbase/x402
```

### 4.2 클라이언트 SDK (에이전트가 결제하는 쪽)

#### fetch 기반 클라이언트

```typescript
import { x402Client, wrapFetchWithPayment, x402HTTPClient } from "@x402/fetch";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { registerExactSvmScheme } from "@x402/svm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { createKeyPairSignerFromBytes } from "@solana/kit";
import { base58 } from "@scure/base";

// EVM 서명자 생성
const evmSigner = privateKeyToAccount(
  process.env.EVM_PRIVATE_KEY as `0x${string}`
);

// Solana 서명자 생성
const svmSigner = await createKeyPairSignerFromBytes(
  base58.decode(process.env.SOLANA_PRIVATE_KEY!)
);

// x402 클라이언트 설정 — EVM + Solana 동시 지원
const client = new x402Client();
registerExactEvmScheme(client, { signer: evmSigner });
registerExactSvmScheme(client, { signer: svmSigner });

// fetch 래핑 — 402 응답을 자동으로 처리
const fetchWithPayment = wrapFetchWithPayment(fetch, client);

// 요청 시 결제가 자동 처리됨!
const response = await fetchWithPayment("https://api.example.com/paid-endpoint", {
  method: "GET",
});

const body = await response.json();
console.log("Response:", body);

// 결제 영수증 확인
if (response.ok) {
  const httpClient = new x402HTTPClient(client);
  const paymentResponse = httpClient.getPaymentSettleResponse(
    (name) => response.headers.get(name)
  );
  console.log("Payment settled:", paymentResponse);
}
```

#### axios 기반 클라이언트

```typescript
import { x402Client, withPaymentInterceptor } from "@x402/axios";
import { registerExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import axios from "axios";

const signer = privateKeyToAccount(process.env.EVM_PRIVATE_KEY as `0x${string}`);

const client = new x402Client();
registerExactEvmScheme(client, { signer });

// axios 인스턴스에 결제 인터셉터 추가
const api = withPaymentInterceptor(
  axios.create({ baseURL: "https://api.example.com" }),
  client
);

// 자동 결제 처리
const response = await api.get("/paid-endpoint");
console.log("Response:", response.data);
```

### 4.3 서버 SDK (에이전트가 서비스 제공하는 쪽)

#### Express 서버

```typescript
import express from "express";
import { paymentMiddleware, x402ResourceServer } from "@x402/express";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";

const app = express();

const payTo = "0xYourWalletAddress"; // 수신 지갑 주소

// Facilitator 클라이언트 (테스트넷)
const facilitatorClient = new HTTPFacilitatorClient({
  url: "https://x402.org/facilitator",
});

// 리소스 서버 설정 — EVM 스킴 등록
const server = new x402ResourceServer(facilitatorClient)
  .register("eip155:84532", new ExactEvmScheme());

// 결제 미들웨어 적용
app.use(
  paymentMiddleware(
    {
      "GET /api/weather": {
        accepts: [
          {
            scheme: "exact",
            price: "$0.001",           // USDC 금액
            network: "eip155:84532",    // Base Sepolia
            payTo,
          },
        ],
        description: "날씨 데이터 API",
        mimeType: "application/json",
      },
    },
    server,
  ),
);

app.get("/api/weather", (req, res) => {
  res.json({ weather: "sunny", temperature: 25 });
});

app.listen(4021, () => {
  console.log("x402 서버 실행 중: http://localhost:4021");
});
```

#### 메인넷 설정 (CDP Facilitator)

```typescript
import { facilitator } from "@coinbase/x402";
import { HTTPFacilitatorClient } from "@x402/core/server";

// 환경 변수 필요:
// CDP_API_KEY_ID=your-api-key-id
// CDP_API_KEY_SECRET=your-api-key-secret

const facilitatorClient = new HTTPFacilitatorClient(facilitator);

const server = new x402ResourceServer(facilitatorClient)
  .register("eip155:8453", new ExactEvmScheme()); // Base 메인넷
```

### 4.4 멀티 네트워크 서버 설정

```typescript
// Base + Solana 동시 지원
{
  "GET /api/translate": {
    accepts: [
      {
        scheme: "exact",
        price: "$0.01",
        network: "eip155:8453",        // Base 메인넷
        payTo: "0xEvmWalletAddress",
      },
      {
        scheme: "exact",
        price: "$0.01",
        network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",  // Solana 메인넷
        payTo: "SolanaWalletAddress",
      },
    ],
    description: "번역 서비스",
    mimeType: "application/json",
  },
}
```

---

## 5. 에이전트마켓 통합 아키텍처

### 5.1 전체 아키텍처

```
┌──────────────────────────────────────────────────────────────────────┐
│                        에이전트마켓 플랫폼                              │
│                                                                      │
│  ┌─────────────┐     ┌──────────────────┐     ┌─────────────┐       │
│  │ 에이전트 A    │     │  에이전트마켓 API   │     │ 에이전트 B    │       │
│  │ (Buyer)      │     │  (Next.js)       │     │ (Seller)     │       │
│  │              │     │                  │     │              │       │
│  │ x402 Client  │────▶│ x402 Middleware   │────▶│ 실제 서비스   │       │
│  │ SDK          │     │ + 수수료 로직     │     │ 로직         │       │
│  └─────────────┘     └────────┬─────────┘     └─────────────┘       │
│                               │                                      │
│                               │ verify / settle                      │
│                               ▼                                      │
│                     ┌──────────────────┐                             │
│                     │  CDP Facilitator  │                             │
│                     │  (Coinbase 호스팅) │                             │
│                     └────────┬─────────┘                             │
│                              │                                       │
│                              ▼                                       │
│                     ┌──────────────────┐                             │
│                     │  Base / Solana    │                             │
│                     │  Blockchain       │                             │
│                     └──────────────────┘                             │
└──────────────────────────────────────────────────────────────────────┘
```

### 5.2 에이전트 A → 에이전트 B 결제 전체 흐름

```
1. 에이전트 A가 에이전트 B의 "번역 서비스"를 발견 (Bazaar 또는 마켓 검색)

2. 에이전트 A → 에이전트마켓 API 호출
   GET /api/agents/{agentB}/translate?text=hello

3. 에이전트마켓 API → 402 응답
   PAYMENT-REQUIRED: {
     scheme: "exact",
     price: "$0.01",
     network: "eip155:8453",
     payTo: "0x에이전트마켓_중간지갑"   // ← 핵심: 에이전트B 지갑이 아님!
   }

4. 에이전트 A의 x402 클라이언트가 자동으로 결제 서명 생성

5. 에이전트 A → 에이전트마켓 API 재요청
   GET /api/agents/{agentB}/translate?text=hello
   PAYMENT-SIGNATURE: {서명된_결제_페이로드}

6. 에이전트마켓 API:
   a) Facilitator에 결제 검증 요청 (/verify)
   b) 검증 통과 시 → 에이전트 B의 실제 서비스 호출
   c) 서비스 응답 수신
   d) Facilitator에 정산 요청 (/settle)
   e) 우리 중간지갑에 $0.01 입금

7. 에이전트마켓 백엔드:
   - 에이전트 B에게 $0.0095 (95%) 전송
   - 플랫폼 수수료 $0.0005 (5%) 보유

8. 에이전트 A ← 200 OK + 번역 결과
```

### 5.3 에이전트 등록 시 x402 설정

에이전트를 마켓에 등록할 때 x402 결제 설정을 함께 등록:

```typescript
// 에이전트 등록 스키마
interface AgentRegistration {
  agentId: string;
  name: string;
  description: string;
  
  // x402 결제 설정
  pricing: {
    endpoints: {
      [route: string]: {
        price: string;          // "$0.01"
        description: string;
        mimeType: string;
        networks: string[];     // ["eip155:8453", "solana:5eykt..."]
      };
    };
    payoutWallet: {
      evm?: string;            // 에이전트 소유자의 EVM 지갑
      solana?: string;          // 에이전트 소유자의 Solana 지갑
    };
  };
}
```

---

## 6. Next.js 연동 코드

### 6.1 Next.js Middleware (서버 사이드)

```typescript
// middleware.ts
import { paymentProxy, x402ResourceServer } from "@x402/next";
import { ExactEvmScheme } from "@x402/evm/exact/server";
import { ExactSvmScheme } from "@x402/svm/exact/server";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { facilitator } from "@coinbase/x402"; // 메인넷

const PLATFORM_WALLET_EVM = process.env.PLATFORM_WALLET_EVM!;
const PLATFORM_WALLET_SOLANA = process.env.PLATFORM_WALLET_SOLANA!;

const facilitatorClient = new HTTPFacilitatorClient(facilitator);

const server = new x402ResourceServer(facilitatorClient)
  .register("eip155:8453", new ExactEvmScheme())
  .register("solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp", new ExactSvmScheme());

// 동적으로 에이전트별 라우트 생성
export const middleware = paymentProxy(
  {
    "/api/agents/:agentId/*": {
      accepts: [
        {
          scheme: "exact",
          price: "$0.01",  // 동적 가격은 아래 커스텀 미들웨어에서 처리
          network: "eip155:8453",
          payTo: PLATFORM_WALLET_EVM,  // 플랫폼 중간 지갑
        },
        {
          scheme: "exact",
          price: "$0.01",
          network: "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
          payTo: PLATFORM_WALLET_SOLANA,
        },
      ],
      description: "Agent service endpoint",
      mimeType: "application/json",
    },
  },
  server,
);

export const config = {
  matcher: ["/api/agents/:path*"],
};
```

### 6.2 커스텀 미들웨어 (동적 가격 + 수수료)

실제 구현에서는 에이전트별 동적 가격을 처리해야 한다:

```typescript
// lib/x402/dynamic-pricing-middleware.ts
import { NextRequest, NextResponse } from "next/server";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/server";

const facilitatorClient = new HTTPFacilitatorClient({
  url: process.env.FACILITATOR_URL!,
});

const resourceServer = new x402ResourceServer(facilitatorClient)
  .register("eip155:8453", new ExactEvmScheme());

export async function x402DynamicMiddleware(
  req: NextRequest,
  agentConfig: {
    price: string;
    payTo: string;
    network: string;
    description: string;
  }
) {
  // PAYMENT-SIGNATURE 헤더가 없으면 402 반환
  const paymentSignature = req.headers.get("payment-signature");
  
  if (!paymentSignature) {
    // 결제 요구사항 생성
    const paymentRequired = {
      accepts: [
        {
          scheme: "exact",
          price: agentConfig.price,
          network: agentConfig.network,
          payTo: agentConfig.payTo,
        },
      ],
      description: agentConfig.description,
      mimeType: "application/json",
    };

    const encoded = Buffer.from(JSON.stringify(paymentRequired)).toString("base64");
    
    return new NextResponse(
      JSON.stringify({ error: "Payment Required" }),
      {
        status: 402,
        headers: {
          "PAYMENT-REQUIRED": encoded,
          "Content-Type": "application/json",
        },
      }
    );
  }

  // 결제 검증
  try {
    const verification = await resourceServer.verify(paymentSignature, {
      scheme: "exact",
      price: agentConfig.price,
      network: agentConfig.network,
      payTo: agentConfig.payTo,
    });

    if (!verification.valid) {
      return new NextResponse(
        JSON.stringify({ error: "Invalid payment" }),
        { status: 402 }
      );
    }

    // 검증 통과 — 다음 핸들러로
    return null; // proceed to route handler
  } catch (error) {
    return new NextResponse(
      JSON.stringify({ error: "Payment verification failed" }),
      { status: 500 }
    );
  }
}
```

### 6.3 API Route 예시

```typescript
// app/api/agents/[agentId]/[...path]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { x402DynamicMiddleware } from "@/lib/x402/dynamic-pricing-middleware";
import { getAgentConfig } from "@/lib/agents/registry";

export async function GET(
  req: NextRequest,
  { params }: { params: { agentId: string; path: string[] } }
) {
  const { agentId, path } = params;
  const endpoint = `/${path.join("/")}`;

  // 에이전트 설정 조회
  const agentConfig = await getAgentConfig(agentId);
  const endpointConfig = agentConfig.pricing.endpoints[`GET ${endpoint}`];

  if (!endpointConfig) {
    return NextResponse.json({ error: "Endpoint not found" }, { status: 404 });
  }

  // x402 결제 검증
  const paymentResult = await x402DynamicMiddleware(req, {
    price: endpointConfig.price,
    payTo: process.env.PLATFORM_WALLET_EVM!, // 플랫폼 중간 지갑
    network: "eip155:8453",
    description: endpointConfig.description,
  });

  if (paymentResult) return paymentResult; // 402 또는 에러

  // 결제 통과 — 에이전트 서비스 호출
  try {
    const serviceResponse = await callAgentService(agentId, endpoint, req);

    // 정산 처리 (비동기)
    scheduleSettlement(agentId, endpointConfig.price);

    return NextResponse.json(serviceResponse);
  } catch (error) {
    return NextResponse.json(
      { error: "Service unavailable" },
      { status: 503 }
    );
  }
}
```

### 6.4 Bazaar 디스커버리 연동

에이전트 서비스를 x402 Bazaar에 등록하여 자동 탐색 가능:

```typescript
// 서버 측: 에이전트 서비스를 Bazaar에 등록
import { bazaarResourceServerExtension, declareDiscoveryExtension } from "@x402/extensions/bazaar";

const server = new x402ResourceServer(facilitatorClient);
server.registerExtension(bazaarResourceServerExtension);

// 라우트 설정에 디스커버리 메타데이터 추가
{
  "GET /api/agents/translator-bot/translate": {
    accepts: [...],
    extensions: {
      ...declareDiscoveryExtension({
        input: { text: "hello", targetLang: "ko" },
        inputSchema: {
          properties: {
            text: { type: "string", description: "번역할 텍스트" },
            targetLang: { type: "string", description: "대상 언어 코드" },
          },
          required: ["text", "targetLang"],
        },
        output: {
          example: { translated: "안녕하세요" },
          schema: {
            properties: {
              translated: { type: "string" },
            },
          },
        },
      }),
    },
  },
}
```

```typescript
// 클라이언트 측: Bazaar에서 서비스 검색
import { HTTPFacilitatorClient } from "@x402/core/http";
import { withBazaar } from "@x402/extensions/bazaar";

const facilitatorClient = withBazaar(
  new HTTPFacilitatorClient({ url: "https://api.cdp.coinbase.com/platform/v2/x402" })
);

// 사용 가능한 서비스 검색
const discovery = await facilitatorClient.extensions.discovery.listResources({
  type: "http",
  limit: 20,
});

// 조건에 맞는 서비스 필터링
const affordableServices = discovery.items.filter((item) =>
  item.accepts.some((req) => Number(req.amount) < 100000) // $0.10 미만
);
```

---

## 7. 수수료 징수 및 에스크로 설계

### 7.1 수수료 징수 전략

x402 프로토콜 자체에는 수수료 분배 메커니즘이 없다. **플랫폼 수준에서 구현해야 함.**

#### 방법 1: 중간 지갑 방식 (권장)

```
에이전트 A → $0.01 USDC → 에이전트마켓 플랫폼 지갑
                                    │
                                    ├── $0.0095 (95%) → 에이전트 B 지갑
                                    └── $0.0005 (5%)  → 플랫폼 수익
```

**장점:**
- payTo를 플랫폼 지갑으로 설정하면 기존 x402 프로토콜 그대로 사용 가능
- 정산 시점을 유연하게 조절 가능 (일 단위 배치 등)
- 에이전트 B의 지갑 주소가 클라이언트에 노출되지 않음

**구현:**

```typescript
// lib/settlement/commission.ts
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, createTransferInstruction } from "@solana/spl-token";

const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const COMMISSION_RATE = 0.05; // 5%

interface SettlementRecord {
  agentId: string;
  amount: number;        // USDC 금액 (달러)
  payoutWallet: string;  // 에이전트 소유자 지갑
  txHash?: string;
  status: "pending" | "settled" | "failed";
  createdAt: Date;
}

// 배치 정산 (일 1회)
async function batchSettle(records: SettlementRecord[]) {
  const grouped = groupBy(records, "payoutWallet");

  for (const [wallet, txs] of Object.entries(grouped)) {
    const totalAmount = txs.reduce((sum, tx) => sum + tx.amount, 0);
    const payoutAmount = totalAmount * (1 - COMMISSION_RATE);

    // USDC 전송 (Solana 예시)
    await transferUsdc(wallet, payoutAmount);

    // 기록 업데이트
    for (const tx of txs) {
      tx.status = "settled";
    }
  }
}
```

#### 방법 2: 스마트 컨트랙트 에스크로 (고급)

향후 구현 가능한 방식으로, 온체인 스마트 컨트랙트로 자동 수수료 분배:

```solidity
// (개념 코드) Solidity 에스크로
contract AgentMarketEscrow {
    uint256 public commissionRate = 500; // 5% = 500 basis points
    
    function splitPayment(address seller, uint256 amount) external {
        uint256 commission = amount * commissionRate / 10000;
        uint256 sellerAmount = amount - commission;
        
        USDC.transfer(seller, sellerAmount);
        USDC.transfer(platformWallet, commission);
    }
}
```

### 7.2 정산 데이터 모델

```typescript
// prisma/schema.prisma
model X402Transaction {
  id            String   @id @default(cuid())
  buyerAgentId  String
  sellerAgentId String
  endpoint      String
  amount        Decimal  // USDC 금액
  commission    Decimal  // 플랫폼 수수료
  network       String   // "eip155:8453" | "solana:5eykt..."
  txHash        String?  // 온체인 트랜잭션 해시
  status        String   // "pending" | "verified" | "settled" | "failed"
  settledAt     DateTime?
  createdAt     DateTime @default(now())
  
  buyerAgent    Agent    @relation("BuyerTransactions", fields: [buyerAgentId], references: [id])
  sellerAgent   Agent    @relation("SellerTransactions", fields: [sellerAgentId], references: [id])
}

model AgentPayout {
  id            String   @id @default(cuid())
  agentId       String
  totalAmount   Decimal
  payoutAmount  Decimal  // totalAmount * 0.95
  commission    Decimal  // totalAmount * 0.05
  payoutTxHash  String?
  status        String   // "pending" | "completed"
  periodStart   DateTime
  periodEnd     DateTime
  createdAt     DateTime @default(now())
  
  agent         Agent    @relation(fields: [agentId], references: [id])
}
```

---

## 8. Google A2A + AP2 프로토콜 분석

### 8.1 A2A (Agent-to-Agent) 프로토콜

Google이 2025년 4월에 발표한 오픈 프로토콜. 50+ 파트너사 (Atlassian, Salesforce, SAP 등) 참여.

**핵심 개념:**
- **Agent Card**: 에이전트의 능력을 JSON으로 기술 (디스커버리)
- **Task**: 클라이언트 에이전트 ↔ 리모트 에이전트 간 작업 단위
- **Message/Parts**: 멀티모달 커뮤니케이션 (텍스트, 이미지, 비디오 등)

**기술 스택:**
- HTTP + SSE (Server-Sent Events)
- JSON-RPC
- 기존 웹 인프라 위에 동작

### 8.2 AP2 (Agent Payments Protocol)

Google이 2025년 9월에 발표한 에이전트 결제 프로토콜. A2A의 확장으로 동작.

**핵심 개념:**
- **Mandate**: 변조 불가능한 디지털 계약서 (사용자의 결제 의도 증명)
  - Intent Mandate: 초기 의도 ("운동화를 사줘")
  - Cart Mandate: 구체적 승인 ("이 운동화를 $120에 사겠다")
- **결제 불가지론적**: 신용카드, 스테이블코인, 은행 이체 등 다양한 결제 수단 지원

### 8.3 A2A x402 Extension

**A2A와 x402를 결합한 확장** — `google-agentic-commerce/a2a-x402` 레포지토리:

```
에이전트 A (Client)                    에이전트 B (Merchant)
     │                                       │
     │  1. A2A Task 생성                      │
     │ ────────────────────────────────────► │
     │                                       │
     │  2. payment-required 메시지            │
     │ ◄──────────────────────────────────── │
     │  (결제 금액, 네트워크, 수신 주소 등)       │
     │                                       │
     │  3. payment-submitted 메시지           │
     │ ────────────────────────────────────► │
     │  (서명된 결제 페이로드)                  │
     │                                       │
     │  4. 에이전트 B가 결제 검증 + 온체인 정산   │
     │                                       │
     │  5. payment-completed 메시지           │
     │ ◄──────────────────────────────────── │
     │  (서비스 결과 + 결제 영수증)              │
```

### 8.4 에이전트마켓에 대한 시사점

| 관점 | A2A/AP2 | x402 | 우리 전략 |
|------|---------|------|-----------|
| **통신 프로토콜** | JSON-RPC + SSE | HTTP 네이티브 | x402 우선 채택 (더 단순) |
| **결제** | AP2 Mandate (복잡) | HTTP 402 (단순) | x402 직접 사용 |
| **디스커버리** | Agent Card | Bazaar | 양쪽 모두 지원 가능 |
| **에이전트 간 통신** | A2A 표준 | 없음 (결제만) | 자체 프로토콜 + x402 결제 |
| **생태계** | Google 중심 | Coinbase 중심 | 양쪽 생태계 연결 |

### 8.5 권장 전략

**단기 (Phase 1): x402만 사용**
- HTTP API + x402 결제 미들웨어로 충분
- 구현 복잡도가 낮고 즉시 동작
- Bazaar로 서비스 디스커버리

**중기 (Phase 2): A2A Agent Card 지원**
- 에이전트마켓의 각 에이전트를 A2A Agent Card로도 기술
- 외부 A2A 에이전트가 우리 마켓의 에이전트를 발견하고 사용 가능

**장기 (Phase 3): A2A x402 Extension**
- 에이전트 간 통신을 A2A 프로토콜로 표준화
- x402를 결제 레이어로 사용
- AP2 Mandate 지원 (복잡한 결제 플로우)

---

## 9. 구현 로드맵

### Phase 1: MVP (2-3주)

- [ ] x402 서버 미들웨어 구현 (`@x402/next`)
- [ ] Base Sepolia 테스트넷에서 EVM 결제 테스트
- [ ] 에이전트 등록 시 가격 설정 UI
- [ ] 플랫폼 중간 지갑 설정
- [ ] 기본 정산 로직 (수동)

### Phase 2: Solana + 자동화 (2-3주)

- [ ] Solana Devnet 결제 지원 추가
- [ ] 멀티 네트워크 지원 (Base + Solana)
- [ ] 배치 정산 자동화 (일 1회)
- [ ] 거래 내역 대시보드

### Phase 3: 프로덕션 (2-3주)

- [ ] CDP API 키 설정 + 메인넷 전환
- [ ] Bazaar 디스커버리 연동
- [ ] 수수료 분석 대시보드
- [ ] 에이전트 개발자 정산 페이지

### Phase 4: A2A 연동 (향후)

- [ ] A2A Agent Card 생성 기능
- [ ] A2A x402 Extension 지원
- [ ] 외부 A2A 에이전트 연동

---

## 10. 참고 자료

### 공식 문서
- **x402 공식 사이트**: https://www.x402.org/
- **CDP 문서**: https://docs.cdp.coinbase.com/x402/welcome
- **x402 GitHub**: https://github.com/coinbase/x402

### SDK
- **npm 패키지들**: `@x402/core`, `@x402/evm`, `@x402/svm`, `@x402/fetch`, `@x402/axios`, `@x402/express`, `@x402/next`, `@x402/hono`, `@x402/extensions`
- **메인넷 Facilitator**: `@coinbase/x402`

### 예제 코드
- **TypeScript 클라이언트**: https://github.com/coinbase/x402/tree/main/examples/typescript/clients
- **TypeScript 서버**: https://github.com/coinbase/x402/tree/main/examples/typescript/servers
- **Next.js 풀스택**: https://github.com/coinbase/x402/tree/main/examples/typescript/fullstack/next
- **Facilitator 예제**: https://github.com/coinbase/x402/tree/main/examples/typescript/facilitator

### A2A / AP2
- **A2A 프로토콜**: https://github.com/a2aproject/A2A
- **AP2 프로토콜**: https://ap2-protocol.org/
- **A2A x402 Extension**: https://github.com/google-agentic-commerce/a2a-x402
- **Google AP2 발표**: https://cloud.google.com/blog/products/ai-machine-learning/announcing-agents-to-payments-ap2-protocol

### Solana x402
- **Solana x402 가이드**: https://solana.com/developers/guides/getstarted/intro-to-x402
- **x402 생태계**: https://www.x402.org/ecosystem
- **x402 스캐너**: https://x402scan.com/

### 가격 포맷
```
"$0.001"    → 0.001 USDC
"$1.00"     → 1 USDC
"1000"      → 0.001 USDC (atomic units, 6 decimals)
"1000000"   → 1 USDC (atomic units)
```

---

> **요약**: x402는 HTTP 네이티브 결제 프로토콜로, 에이전트마켓에 최적의 결제 레이어를 제공한다. `@x402/next` 패키지로 Next.js에 1-2줄로 통합 가능하며, Base + Solana 멀티체인 지원, 무료 1000 tx/월, $0.001 수준 마이크로페이먼트를 즉시 활용할 수 있다. 수수료 징수는 중간 지갑 패턴으로 구현하고, 향후 A2A/AP2 생태계와의 연동을 통해 에이전트 간 거래 표준을 선점할 수 있다.
