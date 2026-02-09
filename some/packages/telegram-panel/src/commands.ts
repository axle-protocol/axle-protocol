import { approveOne, extend, pause, startAutopilot, stop, tick, type SomeSession } from '@some/runtime';

export type ParsedCommand =
  | { kind: 'HELP' }
  | { kind: 'RESET' }
  | { kind: 'STATUS' }
  | { kind: 'APPROVE' }
  | { kind: 'APPROVE5' }
  | { kind: 'APPROVE10' }
  | { kind: 'START'; minutes: 10 | 30 | 60 }
  | { kind: 'EXTEND_10' }
  | { kind: 'PAUSE' }
  | { kind: 'STOP' }
  | { kind: 'TICK' }
  | { kind: 'SET_PRESET'; preset: 'default' | 'warm' | 'cool' | 'empathic' }
  | { kind: 'SET_LENGTH'; length: 'S' | 'M' | 'L' }
  | { kind: 'SET_LAUGH'; laugh: 'off' | 'low' | 'high' }
  | { kind: 'SET_EMOJI'; emoji: 'off' | 'low' | 'high' }
  | { kind: 'SET_PARTNER'; key: string; displayName?: string };

export function parseCommand(text: string): ParsedCommand | null {
  const t = text.trim().toLowerCase();
  if (!t.startsWith('some')) return null;
  const rest = t.replace(/^some\s*/, '');
  if (rest === '' || rest === 'help') return { kind: 'HELP' };
  if (rest === 'reset') return { kind: 'RESET' };
  if (rest === 'status') return { kind: 'STATUS' };
  if (rest === 'approve') return { kind: 'APPROVE' };
  if (rest === 'approve5') return { kind: 'APPROVE5' } as any;
  if (rest === 'approve10') return { kind: 'APPROVE10' } as any;
  if (rest.startsWith('preset ')) {
    const p = rest.replace(/^preset\s+/, '') as any;
    if (p === 'default' || p === 'warm' || p === 'cool' || p === 'empathic') return { kind: 'SET_PRESET', preset: p };
  }
  if (rest.startsWith('length ')) {
    const v = rest.replace(/^length\s+/, '').toUpperCase();
    if (v === 'S' || v === 'M' || v === 'L') return { kind: 'SET_LENGTH', length: v as any };
  }
  if (rest.startsWith('laugh ')) {
    const v = rest.replace(/^laugh\s+/, '') as any;
    if (v === 'off' || v === 'low' || v === 'high') return { kind: 'SET_LAUGH', laugh: v };
  }
  if (rest.startsWith('emoji ')) {
    const v = rest.replace(/^emoji\s+/, '') as any;
    if (v === 'off' || v === 'low' || v === 'high') return { kind: 'SET_EMOJI', emoji: v };
  }
  if (rest.startsWith('partner ')) {
    const v = rest.replace(/^partner\s+/, '').trim();
    if (!v) return { kind: 'HELP' };
    // allow: some partner mm1 / some partner mm1|먀먀묭
    const parts = v.split('|');
    return { kind: 'SET_PARTNER', key: parts[0]!, displayName: parts[1] };
  }
  if (rest === 'pause') return { kind: 'PAUSE' };
  if (rest === 'stop') return { kind: 'STOP' };
  if (rest === 'tick') return { kind: 'TICK' };
  if (rest === '+10' || rest === 'extend' || rest === 'extend10') return { kind: 'EXTEND_10' };
  if (rest === '10' || rest === 'start10') return { kind: 'START', minutes: 10 };
  if (rest === '30' || rest === 'start30') return { kind: 'START', minutes: 30 };
  if (rest === '60' || rest === 'start60') return { kind: 'START', minutes: 60 };
  return { kind: 'HELP' };
}

export function applyCommand(sess: SomeSession, cmd: ParsedCommand) {
  switch (cmd.kind) {
    case 'APPROVE':
      approveOne(sess);
      return;
    case 'APPROVE5':
      for (let i = 0; i < 5; i++) approveOne(sess);
      return;
    case 'APPROVE10':
      for (let i = 0; i < 10; i++) approveOne(sess);
      return;
    case 'START':
      startAutopilot(sess, { minutes: cmd.minutes });
      return;
    case 'EXTEND_10':
      extend(sess, 10);
      return;
    case 'PAUSE':
      pause(sess);
      return;
    case 'STOP':
      stop(sess);
      return;
    case 'TICK':
      tick(sess);
      return;
    case 'STATUS':
    case 'HELP':
    case 'RESET':
    case 'SET_PRESET':
    case 'SET_LENGTH':
    case 'SET_LAUGH':
    case 'SET_EMOJI':
    case 'SET_PARTNER':
      return;
  }
}

export function helpKo() {
  return [
    'SOME 패널 명령어:',
    '',
    '[Autopilot]',
    '- some status  (상태 보기)',
    '- some approve (훈련 승인 +1)',
    '- some 10 | some 30 | some 60  (자율주행 시작)',
    '- some +10     (+10분 연장)',
    '- some pause   (일시정지)',
    '- some stop    (정지/해제)',
    '- some tick    (시간 경과 처리 시뮬)',
    '- some reset   (세션 초기화)',
    '',
    '[Partner]',
    '- some partner <code>  (상대 코드 선택, 예: some partner mm1)',
    '- some partner mm1|먀먀묭  (표시 이름까지 지정)',
    '',
    '[Style Mode]',
    '- some preset default|warm|cool|empathic',
    '- some length S|M|L',
    '- some laugh off|low|high',
    '- some emoji off|low|high'
  ].join('\n');
}
