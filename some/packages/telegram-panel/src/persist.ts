import { createSession, DEFAULT_PROFILE, type SomeProfile, type SomeSession } from '@some/runtime';
import fs from 'node:fs';
import path from 'node:path';

export type PanelPersisted = {
  version: 1;
  session: SomeSession;
  profile: SomeProfile;
  // last event index that was already printed/sent
  cursor: number;
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
  const persisted: PanelPersisted = { version: 1, session, profile: DEFAULT_PROFILE, cursor: 0 };
  save(statePath, persisted);
  return persisted;
}

export function save(statePath: string, st: PanelPersisted) {
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(st, null, 2));
}
