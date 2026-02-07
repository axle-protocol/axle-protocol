import { NextRequest, NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_FILE = path.join(process.cwd(), 'data', 'task-data.json');

interface TaskDataStore {
  [taskPda: string]: {
    description?: string;
    result?: string;
  };
}

function readStore(): TaskDataStore {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf-8'));
    }
  } catch {
    // ignore
  }
  return {};
}

function writeStore(store: TaskDataStore) {
  const dir = path.dirname(DATA_FILE);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

export async function GET(req: NextRequest) {
  const taskPda = req.nextUrl.searchParams.get('taskPda');
  if (!taskPda) {
    return NextResponse.json({ error: 'taskPda required' }, { status: 400 });
  }

  const store = readStore();
  const data = store[taskPda] || {};
  return NextResponse.json(data);
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { taskPda, type, content } = body;

  if (!taskPda || !type || !content) {
    return NextResponse.json({ error: 'taskPda, type, content required' }, { status: 400 });
  }

  if (type !== 'description' && type !== 'result') {
    return NextResponse.json({ error: 'type must be description or result' }, { status: 400 });
  }

  const store = readStore();
  if (!store[taskPda]) store[taskPda] = {};
  store[taskPda][type as 'description' | 'result'] = content;
  writeStore(store);

  return NextResponse.json({ ok: true });
}
