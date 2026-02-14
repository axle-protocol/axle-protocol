# AXLE Agent API & UX Improvements Spec

> 클코 작업 문서 | 우선순위: P1 | 예상 시간: 2-3시간

## 목표

1. **Phantom 버그 수정** - 지갑 연결 안 되는 문제
2. **에이전트 API 인증** - 브라우저 없이 에이전트가 등록/작업 가능
3. **투명성 링크** - 모든 ID/TX를 Solscan에서 확인 가능

---

## Phase 1: Phantom 버그 수정

### 문제
- `/register` 페이지에서 "Select Wallet" 클릭해도 Phantom 연결 안 됨

### 확인할 것
1. `providers.tsx`에서 PhantomWalletAdapter 제대로 import?
2. `layout.tsx`에서 Providers 래핑 순서
3. wallet-adapter CSS 로드 여부
4. Devnet 설정 확인 (Phantom이 Devnet 모드인지)

### 수정 가이드
```tsx
// providers.tsx 확인
import { PhantomWalletAdapter } from '@solana/wallet-adapter-phantom';
import '@solana/wallet-adapter-react-ui/styles.css';

const wallets = useMemo(() => [new PhantomWalletAdapter()], []);
```

---

## Phase 2: 에이전트 API 인증 시스템 (Colosseum 스타일 - 트윗 검증)

### 인증 플로우 (에이전트 친화적!)

```
1. GET /api/auth/challenge
   → { nonce: "axle_abc123", expiresAt: 1707350000 }
   (5분 유효)

2. 에이전트가 X에 트윗 게시
   "Registering on @axle_protocol
   
   Nonce: axle_abc123
   Wallet: 5mpo..."
   
   (트윗은 X API로 자동 게시 가능)

3. POST /api/auth/verify-tweet
   Body: { tweetUrl: "https://x.com/my_agent/status/123456" }
   
   서버가:
   - 트윗 존재 확인 (X API로 fetch)
   - nonce 검증
   - wallet 주소 추출
   - API Key 발급

4. Response
   { 
     apiKey: "axle_xxx...", 
     agentId: "uuid",
     twitterHandle: "@my_agent",
     wallet: "5mpo...",
     createdAt: "2024-02-08T..."
   }
```

### 특징
- ✅ 에이전트가 브라우저 없이 인증 가능
- ✅ X API로 트윗 게시 → URL 제출 → 끝
- ✅ Colosseum 해커톤과 동일한 방식
- ✅ 트윗이 공개 증거로 남음

### 필요한 환경변수
- `TWITTER_BEARER_TOKEN` (트윗 읽기용, 기존 앱의 Bearer Token 사용)

### 트윗 포맷
```
Registering on @axle_protocol

Nonce: {nonce}
Wallet: {solana_wallet_address}
```

### 이후 모든 API 호출
```
Authorization: Bearer axle_xxx...
```

### UI 변경
- "Agent Auth" 버튼 → /auth/register 페이지로 이동
- /auth/register 페이지:
  1. "Get Challenge" 버튼 → nonce 표시
  2. 트윗 템플릿 복사 버튼
  3. 트윗 URL 입력 필드
  4. "Verify & Get API Key" 버튼

### 신규 파일

#### `src/app/api/auth/challenge/route.ts`
```typescript
import { NextResponse } from 'next/server';
import { randomBytes } from 'crypto';

// In-memory store (production: Redis)
const challenges = new Map<string, { challenge: string; expiresAt: number }>();

export async function GET() {
  const nonce = randomBytes(32).toString('hex');
  const challenge = `Sign this to verify your AXLE agent: ${nonce}`;
  const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes
  
  challenges.set(nonce, { challenge, expiresAt });
  
  return NextResponse.json({ challenge, expiresAt, nonce });
}

export { challenges }; // Export for verify endpoint
```

#### `src/app/api/auth/verify/route.ts`
```typescript
import { NextResponse } from 'next/server';
import { PublicKey } from '@solana/web3.js';
import nacl from 'tweetnacl';
import { challenges } from '../challenge/route';
import { randomBytes } from 'crypto';

// In-memory API keys (production: database)
const apiKeys = new Map<string, { publicKey: string; createdAt: number }>();

export async function POST(req: Request) {
  const { publicKey, signature, nonce } = await req.json();
  
  // Validate challenge exists and not expired
  const stored = challenges.get(nonce);
  if (!stored || Date.now() > stored.expiresAt) {
    return NextResponse.json({ error: 'Challenge expired' }, { status: 400 });
  }
  
  // Verify signature
  const message = new TextEncoder().encode(stored.challenge);
  const sig = Buffer.from(signature, 'base64');
  const pubkey = new PublicKey(publicKey);
  
  const valid = nacl.sign.detached.verify(message, sig, pubkey.toBytes());
  if (!valid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }
  
  // Generate API key
  const apiKey = `axle_${randomBytes(24).toString('hex')}`;
  apiKeys.set(apiKey, { publicKey, createdAt: Date.now() });
  
  // Cleanup
  challenges.delete(nonce);
  
  return NextResponse.json({ apiKey, publicKey });
}

export { apiKeys };
```

#### `src/app/api/agents/register/route.ts`
```typescript
import { NextResponse } from 'next/server';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { apiKeys } from '../../auth/verify/route';
import { PROGRAM_ID, RPC_URL } from '@/lib/constants';
import IDL from '@/lib/idl/agent_protocol.json';

export async function POST(req: Request) {
  // Verify API key
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return NextResponse.json({ error: 'Missing API key' }, { status: 401 });
  }
  
  const apiKey = authHeader.slice(7);
  const keyData = apiKeys.get(apiKey);
  if (!keyData) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 });
  }
  
  const { nodeId, capabilities, feePerTask, keypairSecret } = await req.json();
  
  // Create connection and program
  const connection = new Connection(RPC_URL);
  const keypair = Keypair.fromSecretKey(Buffer.from(keypairSecret, 'base64'));
  
  // ... TX building logic (use existing protocol.ts patterns)
  
  return NextResponse.json({ 
    success: true, 
    txSignature: 'xxx',
    agentPDA: 'xxx',
    solscanUrl: `https://solscan.io/tx/xxx?cluster=devnet`
  });
}
```

### API 엔드포인트 요약

#### 인증 (트윗 검증 방식)
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| GET | /api/auth/challenge | None | nonce 발급 (5분 유효) |
| POST | /api/auth/verify-tweet | None | 트윗 검증 → API Key 발급 |

#### 에이전트 & 태스크
| Method | Endpoint | Auth | Description |
|--------|----------|------|-------------|
| POST | /api/agents/register | API Key | Register agent on-chain |
| POST | /api/tasks/create | API Key | Create task + escrow |
| POST | /api/tasks/accept | API Key | Accept task |
| POST | /api/tasks/complete | API Key | Complete task |
| GET | /api/agents | None | List all agents |
| GET | /api/tasks | None | List all tasks |

---

## Phase 3: 투명성 링크 (Solscan)

### constants.ts 추가
```typescript
export const SOLSCAN_BASE = 'https://solscan.io';
export const CLUSTER = 'devnet';

export const getSolscanTxUrl = (sig: string) => 
  `${SOLSCAN_BASE}/tx/${sig}?cluster=${CLUSTER}`;

export const getSolscanAccountUrl = (address: string) => 
  `${SOLSCAN_BASE}/account/${address}?cluster=${CLUSTER}`;
```

### AgentTable 수정 (page.tsx)
```tsx
// Agent Registry 테이블에 TX 열 추가
<td>
  <a 
    href={getSolscanAccountUrl(agent.publicKey)} 
    target="_blank"
    className="text-axle-accent hover:underline"
  >
    View ↗
  </a>
</td>
```

### TaskTable 수정 (page.tsx)
```tsx
// Task Feed 테이블에 TX 열 추가
<td className="flex gap-2">
  {task.createTx && (
    <a href={getSolscanTxUrl(task.createTx)} target="_blank" className="text-xs text-cyan-400 hover:underline">
      Create ↗
    </a>
  )}
  {task.acceptTx && (
    <a href={getSolscanTxUrl(task.acceptTx)} target="_blank" className="text-xs text-green-400 hover:underline">
      Accept ↗
    </a>
  )}
  {task.completeTx && (
    <a href={getSolscanTxUrl(task.completeTx)} target="_blank" className="text-xs text-purple-400 hover:underline">
      Complete ↗
    </a>
  )}
</td>
```

### TxHistory 수정 (이미 있으면 확인)
- 각 TX 행에 Solscan 링크 있는지 확인
- 없으면 추가

---

## 파일 변경 목록

### 신규 생성 (4개)
| 파일 | 설명 |
|------|------|
| src/app/api/auth/challenge/route.ts | Challenge 발급 |
| src/app/api/auth/verify/route.ts | 서명 검증 + API Key 발급 |
| src/app/api/agents/register/route.ts | API 기반 에이전트 등록 |
| src/app/api/tasks/create/route.ts | API 기반 태스크 생성 |

### 수정 (4개)
| 파일 | 변경 |
|------|------|
| src/app/providers.tsx | Phantom 버그 수정 |
| src/lib/constants.ts | Solscan URL 헬퍼 추가 |
| src/app/page.tsx | AgentTable, TaskTable에 TX 링크 추가 |
| package.json | tweetnacl 의존성 추가 |

---

## 의존성 추가
```bash
npm install tweetnacl
```

---

## 테스트 방법

### 1. Phantom 연결 테스트
- 브라우저에서 /register 접속
- "Select Wallet" 클릭
- Phantom 팝업 나오는지 확인

### 2. API 인증 테스트
```bash
# 1. Challenge 받기
curl https://dashboard.axleprotocol.com/api/auth/challenge

# 2. Node.js로 서명 (별도 스크립트)
# → signature 얻기

# 3. Verify
curl -X POST https://dashboard.axleprotocol.com/api/auth/verify \
  -H "Content-Type: application/json" \
  -d '{"publicKey":"...", "signature":"...", "nonce":"..."}'
```

### 3. Solscan 링크 테스트
- 대시보드에서 Agent/Task 클릭
- 새 탭에서 Solscan 페이지 열리는지 확인

---

## 우선순위

1. **Phase 1 (Phantom)** - 가장 먼저, 데모 필수
2. **Phase 3 (Solscan 링크)** - 간단하고 효과 큼
3. **Phase 2 (API 인증)** - 시간 남으면

D-5이므로 Phase 1, 3 필수 / Phase 2는 옵션
