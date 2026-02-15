// ops/worker.mjs
// Minimal worker: pick 1 todo per owner and emit TASK lines to ops/handoff.jsonl
// The main agent will read ops/handoff.jsonl and dispatch via sessions_send.

import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(process.cwd());
const backlogPath = path.join(root, 'ops', 'backlog.json');
const handoffPath = path.join(root, 'ops', 'handoff.jsonl');

function readJson(p, fallback) {
  try {
    if (!fs.existsSync(p)) return fallback;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(p, data) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

function appendJsonl(p, obj) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.appendFileSync(p, JSON.stringify(obj) + '\n', 'utf8');
}

function nowIso() {
  return new Date().toISOString();
}

const backlog = readJson(backlogPath, { version: 1, items: [] });
backlog.updatedAt = nowIso();

const owners = ['dev', 'qa', 'designer'];
const picked = [];
for (const owner of owners) {
  const item = (backlog.items || []).find((x) => x.owner === owner && x.status === 'todo');
  if (!item) continue;
  item.status = 'queued';
  item.queuedAt = nowIso();
  picked.push(item);
}

for (const item of picked) {
  appendJsonl(handoffPath, {
    type: 'TASK',
    to: item.owner,
    id: item.id,
    title: item.title,
    goal: item.title,
    definitionOfDone: item.definitionOfDone || [],
    priority: item.priority || 'P2',
    createdAt: nowIso(),
  });
}

writeJson(backlogPath, backlog);

console.log(JSON.stringify({ ok: true, picked: picked.map((x) => x.id) }));
