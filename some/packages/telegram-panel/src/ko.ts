import type { SomeEvent, SomeRunState } from '@some/runtime';

export function fmtRunState(rs: SomeRunState): string {
  switch (rs.kind) {
    case 'TRAINING':
      return `훈련 모드 (승인 ${rs.approvals}/${rs.required})`;
    case 'UNLOCKED':
      return `준비 완료 (Autopilot 사용 가능)`;
    case 'AUTOPILOT_ON': {
      const leftSec = Math.max(0, Math.floor((rs.endsAtMs - Date.now()) / 1000));
      const m = Math.floor(leftSec / 60);
      const s = leftSec % 60;
      return `자율주행 ON (남은시간 ${m}분 ${s}초)`;
    }
    case 'PAUSED':
      return `일시정지`; 
  }
}

export function fmtEvent(ev: SomeEvent): string {
  const t = new Date(ev.atMs).toLocaleTimeString('ko-KR', { hour12: false });
  switch (ev.type) {
    case 'STATUS':
      return `🟢 [${t}] 상태: ${fmtRunState(ev.runState)}`;
    case 'IN':
      return `📩 [${t}] 상대(${ev.from}): ${ev.text}` + (ev.summary ? `\n요약: ${ev.summary}` : '');
    case 'OUT':
      return `📤 [${t}] 전송(${ev.to}): ${ev.text}` + (ev.rationale ? `\n이유: ${ev.rationale}` : '');
    case 'BLOCKED':
      return `⛔ [${t}] 차단: ${ev.reason}` + (ev.details ? `\n세부: ${ev.details}` : '');
    case 'ERROR':
      return `🔴 [${t}] 에러: ${ev.message}`;
  }
}
