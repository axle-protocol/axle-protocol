export type SomeConnectionState = 'CONNECTED' | 'RETRYING' | 'DISCONNECTED';

export type SomeRunState =
  | { kind: 'TRAINING'; approvals: number; required: number }
  | { kind: 'UNLOCKED'; approvals: number; required: number }
  | { kind: 'AUTOPILOT_ON'; endsAtMs: number }
  | { kind: 'PAUSED' };

export type SomeEventBase = {
  atMs: number;
};

export type SomeEvent =
  | (SomeEventBase & { type: 'STATUS'; connection: SomeConnectionState; runState: SomeRunState })
  | (SomeEventBase & { type: 'IN'; from: string; text: string; summary?: string })
  | (SomeEventBase & { type: 'OUT'; to: string; text: string; rationale?: string })
  | (SomeEventBase & { type: 'BLOCKED'; reason: string; details?: string })
  | (SomeEventBase & { type: 'ERROR'; message: string; stack?: string });

export function nowMs() {
  return Date.now();
}
