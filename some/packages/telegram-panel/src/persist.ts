import { createSession, DEFAULT_PROFILE, type SomeProfile, type SomeSession } from '@some/runtime';
import fs from 'node:fs';
import path from 'node:path';

export type AvatarPartner = {
  key: string; // internal id, e.g. mm1
  displayName: string; // UI label, e.g. 먀먀묭
};

export type AvatarRules = {
  // 1-6 생활/속도
  workHoursSlow: boolean; // 1
  workHoursShortReplies: boolean; // 2
  workHoursDisappearThenBatch: boolean; // 3
  eveningFasterAndLonger: boolean; // 4
  lateNightMorePlayful: boolean; // 5
  noAutopilotDuringCommuteOrWorkout: boolean; // 6

  // 7-9 행동
  sendBusyNotice: boolean; // 7
  respondFastWhenPartnerHurt: boolean; // 8
  respondWithQuestions: boolean; // 9

  // 10-15 갈등/약속/리액션
  calmShortInConflict: boolean; // 10
  dodgeAmbiguousWithJoke: boolean; // 11
  leadPlanningFirst: boolean; // 12
  useNicknamesOften: boolean; // 13
  useReactionsOften: boolean; // 14
  avoidReadIgnore: boolean; // 15
};

export type AvatarPolicy = {
  autopilotWindow: { startHour: number; endHour: number }; // 0-24
  bannedTopics: string[];
  delayMaxMinutes: number;
  minReplyAllowsShort: boolean; // "ㅇㅋ/ㅇㅇ" OK
  crisisRequiresApproval: boolean;
};

export type AvatarProfile = {
  partner: AvatarPartner;
  rules: AvatarRules;
  policy: AvatarPolicy;
};

export type PanelPersisted = {
  version: 1;
  session: SomeSession;
  profile: SomeProfile;
  avatar?: AvatarProfile;
  // last event index that was already printed/sent
  cursor: number;
};

export const DEFAULT_AVATAR: AvatarProfile = {
  partner: { key: 'default', displayName: '기본' },
  rules: {
    workHoursSlow: true,
    workHoursShortReplies: true,
    workHoursDisappearThenBatch: true,
    eveningFasterAndLonger: true,
    lateNightMorePlayful: true,
    noAutopilotDuringCommuteOrWorkout: true,
    sendBusyNotice: true,
    respondFastWhenPartnerHurt: true,
    respondWithQuestions: true,
    calmShortInConflict: false,
    dodgeAmbiguousWithJoke: true,
    leadPlanningFirst: false,
    useNicknamesOften: true,
    useReactionsOften: true,
    avoidReadIgnore: true
  },
  policy: {
    autopilotWindow: { startHour: 19, endHour: 24 },
    bannedTopics: ['돈', '만남 압박', '성적 뉘앙스'],
    delayMaxMinutes: 15,
    minReplyAllowsShort: true,
    crisisRequiresApproval: true
  }
};

export function loadOrInit(statePath: string, init?: { approvalRequired?: number }): PanelPersisted {
  try {
    const raw = fs.readFileSync(statePath, 'utf-8');
    const parsed = JSON.parse(raw) as PanelPersisted;
    if (parsed?.version === 1 && parsed.session) return parsed;
  } catch {
    // ignore
  }

  const session = createSession({ approvalRequired: init?.approvalRequired ?? 20 });
  const persisted: PanelPersisted = {
    version: 1,
    session,
    profile: DEFAULT_PROFILE,
    avatar: DEFAULT_AVATAR,
    cursor: 0
  };
  save(statePath, persisted);
  return persisted;
}

export function save(statePath: string, st: PanelPersisted) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(st, null, 2));
}
