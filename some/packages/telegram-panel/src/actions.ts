export type PanelAction =
  | { type: 'AUTOPILOT_START'; minutes: 10 | 30 | 60 }
  | { type: 'EXTEND_10M' }
  | { type: 'PAUSE' }
  | { type: 'STOP' };

export const ACTION_LABELS_KO: Record<PanelAction['type'], string> = {
  AUTOPILOT_START: '자율주행 시작',
  EXTEND_10M: '+10분 연장',
  PAUSE: '일시정지',
  STOP: '정지'
};
