import { nowMs, type SomeConnectionState, type SomeEvent, type SomeRunState } from './events.js';

export type SomeConfig = {
  approvalRequired: number; // default 20
  maxAutopilotMinutes: number; // default 120
};

export type SomeSession = {
  connection: SomeConnectionState;
  runState: SomeRunState;
  events: SomeEvent[];
  config: SomeConfig;
};

export type AutopilotRequest = {
  minutes: number;
};

export function createSession(config?: Partial<SomeConfig>): SomeSession {
  const merged: SomeConfig = {
    approvalRequired: config?.approvalRequired ?? 20,
    maxAutopilotMinutes: config?.maxAutopilotMinutes ?? 120
  };

  const sess: SomeSession = {
    connection: 'CONNECTED',
    runState: { kind: 'TRAINING', approvals: 0, required: merged.approvalRequired },
    events: [],
    config: merged
  };

  push(sess, {
    type: 'STATUS',
    atMs: nowMs(),
    connection: sess.connection,
    runState: sess.runState
  });

  return sess;
}

export function push(sess: SomeSession, ev: SomeEvent) {
  sess.events.push(ev);
}

export function approveOne(sess: SomeSession) {
  if (sess.runState.kind !== 'TRAINING') return;

  const approvals = sess.runState.approvals + 1;

  if (approvals >= sess.runState.required) {
    sess.runState = { kind: 'UNLOCKED', approvals, required: sess.runState.required };
  } else {
    sess.runState = { kind: 'TRAINING', approvals, required: sess.runState.required };
  }

  push(sess, {
    type: 'STATUS',
    atMs: nowMs(),
    connection: sess.connection,
    runState: sess.runState
  });
}

export function startAutopilot(sess: SomeSession, req: AutopilotRequest) {
  if (sess.runState.kind !== 'UNLOCKED') {
    push(sess, {
      type: 'BLOCKED',
      atMs: nowMs(),
      reason: 'Autopilot 잠금 상태',
      details: `승인 ${sess.config.approvalRequired}회를 먼저 완료해야 합니다.`
    });
    return;
  }

  const minutes = Math.max(1, Math.min(req.minutes, sess.config.maxAutopilotMinutes));
  const endsAtMs = nowMs() + minutes * 60_000;

  sess.runState = { kind: 'AUTOPILOT_ON', endsAtMs };

  push(sess, {
    type: 'STATUS',
    atMs: nowMs(),
    connection: sess.connection,
    runState: sess.runState
  });
}

export function pause(sess: SomeSession) {
  sess.runState = { kind: 'PAUSED' };

  push(sess, {
    type: 'STATUS',
    atMs: nowMs(),
    connection: sess.connection,
    runState: sess.runState
  });
}

export function stop(sess: SomeSession) {
  // stop returns to UNLOCKED if they had it; otherwise TRAINING
  if (sess.runState.kind === 'AUTOPILOT_ON' || sess.runState.kind === 'PAUSED') {
    sess.runState = {
      kind: 'UNLOCKED',
      approvals: sess.config.approvalRequired,
      required: sess.config.approvalRequired
    };
  }

  push(sess, {
    type: 'STATUS',
    atMs: nowMs(),
    connection: sess.connection,
    runState: sess.runState
  });
}

export function extend(sess: SomeSession, minutes: number) {
  if (sess.runState.kind !== 'AUTOPILOT_ON') {
    push(sess, {
      type: 'BLOCKED',
      atMs: nowMs(),
      reason: '연장 불가',
      details: '자율주행이 켜져 있을 때만 연장할 수 있습니다.'
    });
    return;
  }

  const addMs = Math.max(1, Math.floor(minutes)) * 60_000;
  const hardCapEndsAtMs = nowMs() + sess.config.maxAutopilotMinutes * 60_000;
  const nextEndsAtMs = Math.min(sess.runState.endsAtMs + addMs, hardCapEndsAtMs);

  sess.runState = { kind: 'AUTOPILOT_ON', endsAtMs: nextEndsAtMs };

  push(sess, {
    type: 'STATUS',
    atMs: nowMs(),
    connection: sess.connection,
    runState: sess.runState
  });
}

export function tick(sess: SomeSession) {
  if (sess.runState.kind === 'AUTOPILOT_ON' && nowMs() >= sess.runState.endsAtMs) {
    stop(sess);
  }
}
