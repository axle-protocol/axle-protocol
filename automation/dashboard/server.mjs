import http from 'node:http';
import { readFileSync, existsSync, statSync, createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3030);
const PASSWORD = process.env.DASHBOARD_PASSWORD;
const USERNAME = process.env.DASHBOARD_USERNAME || 'han';

if (!PASSWORD) {
  console.error('[dashboard] DASHBOARD_PASSWORD is required');
  process.exit(1);
}

function unauthorized(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="automation-dashboard"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('Unauthorized');
}

function checkAuth(req, res) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Basic ')) return false;
  const base64 = header.slice('Basic '.length);
  let decoded = '';
  try {
    decoded = Buffer.from(base64, 'base64').toString('utf8');
  } catch {
    return false;
  }
  const idx = decoded.indexOf(':');
  if (idx === -1) return false;
  const user = decoded.slice(0, idx);
  const pass = decoded.slice(idx + 1);
  return user === USERNAME && pass === PASSWORD;
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  createReadStream(filePath).pipe(res);
}

const publicDir = path.join(__dirname, 'public');

const server = http.createServer((req, res) => {
  // Auth first
  if (!checkAuth(req, res)) return unauthorized(res);

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // API (placeholder)
  if (url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
  }

  // Static
  let rel = url.pathname;
  if (rel === '/') rel = '/index.html';
  const safe = path.normalize(rel).replace(/^\.\.(\/|\\)/, '');
  const full = path.join(publicDir, safe);

  if (!full.startsWith(publicDir)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Bad request');
  }

  if (!existsSync(full) || !statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }

  return serveFile(res, full);
});

server.listen(PORT, () => {
  console.log(`[dashboard] running on http://localhost:${PORT}`);
  console.log(`[dashboard] auth user=${USERNAME} (password via DASHBOARD_PASSWORD)`);
});
