/**
 * engine.ts — SOME 메인 루프 (오케스트레이터)
 * 
 * 역할:
 * 1. KakaoTalk 새 메시지 감지
 * 2. LLM으로 답장 생성
 * 3. 상태에 따라 승인 요청 또는 자동 전송
 * 4. 이벤트 로깅
 */

import type { SomeSession } from './stateMachine.js';
import { push, tick, approveOne } from './stateMachine.js';
import { nowMs } from './events.js';
import type { KakaoAdapter, KakaoIncoming, KakaoOutgoing } from './kakaoAdapter.js';

export type EngineConfig = {
  pollIntervalMs: number;    // 메시지 체크 주기 (default: 5000)
  maxHistoryLen: number;     // 보관할 최대 메시지 수 (default: 100)
  whitelistChats: string[];  // 허용된 채팅방 이름
};

export type EngineCallbacks = {
  onNewMessage: (msg: KakaoIncoming) => Promise<void>;
  onReplyGenerated: (reply: ReplyResult) => Promise<void>;
  onApprovalNeeded: (reply: ReplyResult) => Promise<void>;
  onReplySent: (reply: ReplyResult) => Promise<void>;
  onError: (error: Error) => Promise<void>;
};

export type ReplyResult = {
  incoming: KakaoIncoming;
  candidates: string[];
  bestReply: string;
  rationale: string;
  shouldBlock: boolean;
  blockReason: string;
};

export type EngineState = {
  running: boolean;
  lastPollMs: number;
  messageHistory: KakaoIncoming[];
  pendingApprovals: ReplyResult[];
};

/**
 * 엔진 생성
 */
export function createEngine(
  sess: SomeSession,
  adapter: KakaoAdapter,
  config: EngineConfig,
  callbacks: EngineCallbacks
): Engine {
  return new Engine(sess, adapter, config, callbacks);
}

export class Engine {
  private state: EngineState;
  private loopHandle: NodeJS.Timeout | null = null;

  constructor(
    private sess: SomeSession,
    private adapter: KakaoAdapter,
    private config: EngineConfig,
    private callbacks: EngineCallbacks
  ) {
    this.state = {
      running: false,
      lastPollMs: 0,
      messageHistory: [],
      pendingApprovals: []
    };
  }

  /**
   * 엔진 시작
   */
  start() {
    if (this.state.running) return;
    
    this.state.running = true;
    this.loop();
    
    push(this.sess, {
      type: 'LOG',
      atMs: nowMs(),
      message: 'Engine started'
    });
  }

  /**
   * 엔진 정지
   */
  stop() {
    this.state.running = false;
    if (this.loopHandle) {
      clearTimeout(this.loopHandle);
      this.loopHandle = null;
    }
    
    push(this.sess, {
      type: 'LOG',
      atMs: nowMs(),
      message: 'Engine stopped'
    });
  }

  /**
   * 승인 처리 (텔레그램에서 호출)
   */
  async approve(replyIndex: number = 0) {
    const pending = this.state.pendingApprovals.shift();
    if (!pending) return;

    // 상태 머신 승인 카운트 증가
    approveOne(this.sess);

    // 답장 전송
    const replyText = replyIndex < pending.candidates.length 
      ? pending.candidates[replyIndex] 
      : pending.bestReply;

    try {
      await this.adapter.send({
        chatName: pending.incoming.from, // TODO: chatName 매핑 필요
        text: replyText
      });
      
      await this.callbacks.onReplySent({ ...pending, bestReply: replyText });
      
      push(this.sess, {
        type: 'REPLY_SENT',
        atMs: nowMs(),
        to: pending.incoming.from,
        text: replyText
      });
    } catch (err) {
      await this.callbacks.onError(err as Error);
    }
  }

  /**
   * 거부 처리
   */
  reject() {
    const pending = this.state.pendingApprovals.shift();
    if (!pending) return;

    push(this.sess, {
      type: 'LOG',
      atMs: nowMs(),
      message: `Reply rejected for ${pending.incoming.from}`
    });
  }

  /**
   * 대기 중인 승인 요청 수
   */
  getPendingCount(): number {
    return this.state.pendingApprovals.length;
  }

  /**
   * 메인 루프
   */
  private async loop() {
    if (!this.state.running) return;

    try {
      // 1. autopilot 시간 체크
      tick(this.sess);

      // 2. 새 메시지 폴링
      const messages = await this.adapter.observe();
      
      // 3. 화이트리스트 필터
      const filtered = messages.filter(m => 
        this.config.whitelistChats.includes(m.chatName)
      );

      // 4. 새 메시지 처리
      for (const msg of filtered) {
        // 중복 체크 (같은 시간 + 같은 텍스트)
        const isDupe = this.state.messageHistory.some(h => 
          h.atMs === msg.atMs && h.text === msg.text && h.from === msg.from
        );
        if (isDupe) continue;

        // 히스토리에 추가
        this.state.messageHistory.push(msg);
        if (this.state.messageHistory.length > this.config.maxHistoryLen) {
          this.state.messageHistory.shift();
        }

        await this.callbacks.onNewMessage(msg);

        push(this.sess, {
          type: 'MSG_RECEIVED',
          atMs: nowMs(),
          from: msg.from,
          text: msg.text
        });

        // TODO: 여기서 generateReply() 호출
        // 지금은 콜백으로 위임
      }

      this.state.lastPollMs = nowMs();
    } catch (err) {
      await this.callbacks.onError(err as Error);
    }

    // 다음 루프 스케줄
    this.loopHandle = setTimeout(() => this.loop(), this.config.pollIntervalMs);
  }
}
