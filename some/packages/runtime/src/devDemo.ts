import { approveOne, createSession, startAutopilot, tick } from './stateMachine.js';

const s = createSession({ approvalRequired: 3 });

// 2 approvals -> still TRAINING
approveOne(s);
approveOne(s);

// blocked (not unlocked yet)
startAutopilot(s, { minutes: 10 });

// third approval -> UNLOCKED
approveOne(s);

// start autopilot 1 min
startAutopilot(s, { minutes: 1 });

console.log(s.events.map((e) => e.type + (e.type === 'STATUS' ? ':' + e.runState.kind : '')));

// fast-forward tick
if (s.runState.kind === 'AUTOPILOT_ON') s.runState.endsAtMs = Date.now() - 1;

tick(s);
console.log('final', s.runState);
