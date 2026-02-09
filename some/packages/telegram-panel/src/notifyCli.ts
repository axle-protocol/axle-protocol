import fs from 'node:fs';
import path from 'node:path';
import { fmtEvent } from './ko.js';
import type { SomeEvent } from '@some/runtime';

const statePath = process.env.SOME_PANEL_STATE || '.state/telegram-panel.json';
const cursorPath = process.env.SOME_NOTIFY_CURSOR || '.state/notify-cursor.json';

function loadCursor(): number {
  try {
    const raw = fs.readFileSync(cursorPath, 'utf-8');
    const j = JSON.parse(raw);
    if (typeof j?.cursor === 'number') return j.cursor;
  } catch {}
  return 0;
}

function saveCursor(cursor: number) {
  fs.mkdirSync(path.dirname(cursorPath), { recursive: true });
  fs.writeFileSync(cursorPath, JSON.stringify({ cursor }, null, 2));
}

function loadEvents(): SomeEvent[] {
  const raw = fs.readFileSync(statePath, 'utf-8');
  const st = JSON.parse(raw);
  return st?.session?.events ?? [];
}

function isImportant(ev: SomeEvent): boolean {
  if (ev.type === 'ERROR') return true;
  if (ev.type === 'BLOCKED') return true;
  if (ev.type === 'STATUS') {
    // only notify on state transitions, not every status spam.
    // We'll include AUTOPILOT_ON and UNLOCKED and PAUSED.
    const k = ev.runState.kind;
    return k === 'AUTOPILOT_ON' || k === 'UNLOCKED' || k === 'PAUSED';
  }
  return false;
}

function main() {
  const cursor = loadCursor();
  const events = loadEvents();
  if (events.length <= cursor) {
    return; // nothing new
  }

  const newEvents = events.slice(cursor);
  const important = newEvents.filter(isImportant);

  // advance cursor regardless to avoid repeats
  saveCursor(events.length);

  if (!important.length) return;

  // print up to last 3 important events
  const tail = important.slice(-3).map(fmtEvent).join('\n');
  process.stdout.write(tail);
}

main();
