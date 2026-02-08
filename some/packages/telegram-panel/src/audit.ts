import fs from 'node:fs';
import path from 'node:path';

export type AuditRecord = {
  at: string; // ISO
  kind: 'COMMAND' | 'STATE_SAVED';
  text?: string;
  statePath?: string;
  note?: string;
};

export function appendAudit(auditPath: string, rec: AuditRecord) {
  fs.mkdirSync(path.dirname(auditPath), { recursive: true });
  fs.appendFileSync(auditPath, JSON.stringify(rec) + '\n');
}
