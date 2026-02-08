import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Step 4: minimal always-on helper
// - prevent sleep (macOS: caffeinate)
// - run a command, restart on crash
// - write periodic health log

type Config = {
  statePath: string;
  logDir: string;
  // command to run (default: telegram-panel handle loop is external; here we just keep system awake)
  run?: { cmd: string; args?: string[] };
  restartDelayMs: number;
  healthEveryMs: number;
};

function loadConfig(): Config {
  const statePath = process.env.SOME_PANEL_STATE ?? '.state/telegram-panel.json';
  const logDir = process.env.SOME_LOG_DIR ?? '.state/logs';
  return {
    statePath,
    logDir,
    restartDelayMs: Number(process.env.SOME_RESTART_DELAY_MS ?? 2000),
    healthEveryMs: Number(process.env.SOME_HEALTH_EVERY_MS ?? 30_000),
    run: process.env.SOME_RUN_CMD
      ? { cmd: process.env.SOME_RUN_CMD, args: process.env.SOME_RUN_ARGS?.split(' ').filter(Boolean) }
      : undefined
  };
}

function ts() {
  return new Date().toISOString();
}

function append(logFile: string, line: string) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.appendFileSync(logFile, line + '\n');
}

function startCaffeinate(logFile: string) {
  if (process.platform !== 'darwin') return null;
  const child = spawn('caffeinate', ['-dimsu'], { stdio: 'ignore' });
  append(logFile, `[${ts()}] caffeinate started pid=${child.pid}`);
  return child;
}

function startWorker(run: { cmd: string; args?: string[] }, logFile: string) {
  const child = spawn(run.cmd, run.args ?? [], { stdio: 'pipe' });
  append(logFile, `[${ts()}] worker started: ${run.cmd} ${(run.args ?? []).join(' ')} pid=${child.pid}`);
  child.stdout.on('data', (b) => append(logFile, b.toString('utf-8').trimEnd()));
  child.stderr.on('data', (b) => append(logFile, `[stderr] ${b.toString('utf-8').trimEnd()}`));
  return child;
}

async function main() {
  const cfg = loadConfig();
  const logFile = path.join(cfg.logDir, 'desktop-helper.log');

  append(logFile, `[${ts()}] desktop-helper boot`);
  append(logFile, `[${ts()}] statePath=${cfg.statePath}`);

  const caffeinate = startCaffeinate(logFile);

  let worker: ReturnType<typeof startWorker> | null = null;
  const start = () => {
    if (!cfg.run) return;
    worker = startWorker(cfg.run, logFile);
    worker.on('exit', (code, signal) => {
      append(logFile, `[${ts()}] worker exit code=${code} signal=${signal}`);
      setTimeout(() => {
        append(logFile, `[${ts()}] worker restarting...`);
        start();
      }, cfg.restartDelayMs);
    });
  };

  start();

  setInterval(() => {
    append(logFile, `[${ts()}] health ok worker=${worker?.pid ?? 'none'}`);
  }, cfg.healthEveryMs);

  const shutdown = () => {
    append(logFile, `[${ts()}] shutdown`);
    try {
      worker?.kill('SIGTERM');
    } catch {}
    try {
      caffeinate?.kill('SIGTERM');
    } catch {}
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
