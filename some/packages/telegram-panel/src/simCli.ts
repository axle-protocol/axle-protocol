import { approveOne, createSession, extend, pause, startAutopilot, stop, tick } from '@some/runtime';
import { fmtEvent } from './ko.js';

// Minimal sim: no real telegram yet. Just prints what the panel would show.

const sess = createSession({ approvalRequired: 3 });

function printNewEvents(fromIdx: number) {
  for (let i = fromIdx; i < sess.events.length; i++) {
    console.log(fmtEvent(sess.events[i]));
  }
  return sess.events.length;
}

let idx = 0;
idx = printNewEvents(idx);

console.log('\n[SIM] 승인 2회 (훈련 중)');
approveOne(sess);
approveOne(sess);
idx = printNewEvents(idx);

console.log('\n[SIM] 자율주행 30분 시도(잠금)');
startAutopilot(sess, { minutes: 30 });
idx = printNewEvents(idx);

console.log('\n[SIM] 승인 1회 더 (Unlock)');
approveOne(sess);
idx = printNewEvents(idx);

console.log('\n[SIM] 자율주행 10분 시작');
startAutopilot(sess, { minutes: 10 });
idx = printNewEvents(idx);

console.log('\n[SIM] 일시정지');
pause(sess);
idx = printNewEvents(idx);

console.log('\n[SIM] 정지(Unlock로 복귀)');
stop(sess);
idx = printNewEvents(idx);

console.log('\n[SIM] +10분 연장');
extend(sess, 10);
idx = printNewEvents(idx);

console.log('\n[SIM] tick(시간 종료 처리)');
tick(sess);
idx = printNewEvents(idx);
