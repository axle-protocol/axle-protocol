import http from 'node:http';
import crypto from 'node:crypto';
import {
  readFileSync,
  existsSync,
  statSync,
  createReadStream,
  writeFileSync,
  mkdirSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3030);

// OWNER (existing) Basic Auth for / (dashboard) + /api/queue*.
const OWNER_PASSWORD = process.env.DASHBOARD_PASSWORD;
const OWNER_USERNAME = process.env.DASHBOARD_USERNAME || 'han';

if (!OWNER_PASSWORD) {
  console.error('[dashboard] DASHBOARD_PASSWORD is required (owner basic auth)');
  process.exit(1);
}

const publicDir = path.join(__dirname, 'public');
const dataDir = path.join(__dirname, 'data');

function ensureDataDir() {
  mkdirSync(dataDir, { recursive: true });
}

function safeJsonParse(str, fallback) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

function loadJson(filePath, fallback) {
  ensureDataDir();
  if (!existsSync(filePath)) return fallback;
  return safeJsonParse(readFileSync(filePath, 'utf8'), fallback);
}

function saveJson(filePath, data) {
  ensureDataDir();
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function readJsonBody(req) {
  return new Promise((resolve) => {
    let buf = '';
    req.on('data', (chunk) => {
      buf += chunk;
      if (buf.length > 2_000_000) buf = buf.slice(0, 2_000_000); // hard limit 2MB
    });
    req.on('end', () => {
      if (!buf) return resolve(null);
      resolve(safeJsonParse(buf, null));
    });
  });
}

function sendJson(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(obj));
}

function unauthorizedBasic(res) {
  res.writeHead(401, {
    'WWW-Authenticate': 'Basic realm="automation-dashboard"',
    'Content-Type': 'text/plain; charset=utf-8',
  });
  res.end('Unauthorized');
}

function checkOwnerBasicAuth(req) {
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
  return user === OWNER_USERNAME && pass === OWNER_PASSWORD;
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  const out = {};
  header.split(';').forEach((part) => {
    const p = part.trim();
    if (!p) return;
    const idx = p.indexOf('=');
    if (idx === -1) return;
    const k = p.slice(0, idx).trim();
    const v = p.slice(idx + 1).trim();
    out[k] = decodeURIComponent(v);
  });
  return out;
}

function setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.path) parts.push(`Path=${opts.path}`);
  if (opts.httpOnly) parts.push('HttpOnly');
  if (opts.sameSite) parts.push(`SameSite=${opts.sameSite}`);
  if (opts.secure) parts.push('Secure');
  const prev = res.getHeader('Set-Cookie');
  const next = prev ? (Array.isArray(prev) ? prev.concat(parts.join('; ')) : [prev, parts.join('; ')]) : parts.join('; ');
  res.setHeader('Set-Cookie', next);
}

// -------------------------
// Vendor auth (JSON storage)
// -------------------------

const vendorsPath = path.join(dataDir, 'vendors.json');
const vendorSessionsPath = path.join(dataDir, 'vendor_sessions.json');
const ordersPath = path.join(dataDir, 'orders.json');

function pbkdf2Hash(password, saltHex) {
  const salt = Buffer.from(saltHex, 'hex');
  const dk = crypto.pbkdf2Sync(password, salt, 120_000, 32, 'sha256');
  return dk.toString('hex');
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = pbkdf2Hash(password, salt);
  return { salt, hash, algo: 'pbkdf2_sha256', iter: 120_000 };
}

function verifyPassword(password, record) {
  if (!record?.salt || !record?.hash) return false;
  const got = pbkdf2Hash(password, record.salt);
  try {
    return crypto.timingSafeEqual(Buffer.from(got, 'hex'), Buffer.from(record.hash, 'hex'));
  } catch {
    return false;
  }
}

function loadVendors() {
  return loadJson(vendorsPath, { vendors: [] });
}

function loadVendorSessions() {
  return loadJson(vendorSessionsPath, { sessions: [] });
}

function saveVendorSessions(data) {
  saveJson(vendorSessionsPath, data);
}

function getVendorByUsername(username) {
  const data = loadVendors();
  return (data.vendors || []).find((v) => v.username === username) || null;
}

function getVendorFromSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.vendor_session;
  if (!token) return null;

  const sessions = loadVendorSessions();
  const now = Date.now();
  const s = (sessions.sessions || []).find((x) => x.token === token);
  if (!s) return null;
  if (s.expiresAt && now > new Date(s.expiresAt).getTime()) return null;

  const vendors = loadVendors();
  const v = (vendors.vendors || []).find((vv) => vv.id === s.vendorId);
  if (!v) return null;
  return { id: v.id, name: v.name, username: v.username };
}

function requireVendor(req, res) {
  const v = getVendorFromSession(req);
  if (!v) {
    sendJson(res, 401, { error: 'vendor_unauthorized' });
    return null;
  }
  return v;
}

function normalizeTrackingNumber(input) {
  const raw = String(input || '');
  const norm = raw.replace(/[^0-9a-zA-Z]/g, '').toUpperCase();
  return norm;
}

function validateTracking({ carrier, number }) {
  const allowedCarriers = ['cj', 'hanjin', 'lotte', 'epost', 'logen', 'etc'];
  if (!allowedCarriers.includes(carrier)) return { ok: false, error: 'bad_carrier' };
  const norm = normalizeTrackingNumber(number);
  if (!norm) return { ok: false, error: 'empty_tracking_number' };
  if (norm.length < 8 || norm.length > 30) return { ok: false, error: 'bad_tracking_length' };
  return { ok: true, number: norm };
}

function loadOrders() {
  return loadJson(ordersPath, { orders: [] });
}

function saveOrders(data) {
  saveJson(ordersPath, data);
}

// -------------------------
// Existing queue (owner)
// -------------------------

const queuePath = path.join(dataDir, 'queue.json');

function loadQueue() {
  return loadJson(queuePath, { items: [] });
}

function saveQueue(data) {
  saveJson(queuePath, data);
}

function validateTransition(from, to) {
  const allowed = {
    draft: ['pending', 'held'],
    pending: ['approved', 'held'],
    approved: ['running'],
    running: ['success', 'failed', 'needs_auth'],
    failed: ['pending', 'held'],
    needs_auth: ['pending', 'held'],
    held: ['pending'],
    success: [],
  };
  return (allowed[from] || []).includes(to);
}

// -------------------------
// Static serving
// -------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

function serveFile(res, filePath) {
  const ext = path.extname(filePath);
  const type = MIME[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type });
  createReadStream(filePath).pipe(res);
}

function serveStatic(res, urlPathname) {
  let rel = urlPathname;
  if (rel === '/') rel = '/index.html';
  const safe = path.normalize(rel).replace(/^\.\.(\/|\\)/, '');
  const full = path.join(publicDir, safe);

  if (!full.startsWith(publicDir)) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Bad request');
    return true;
  }

  if (!existsSync(full) || !statSync(full).isFile()) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
    return true;
  }

  serveFile(res, full);
  return true;
}

function shouldRequireOwnerAuth(url) {
  // Vendor portal uses its own session auth.
  if (url.pathname.startsWith('/vendor')) return false;
  if (url.pathname.startsWith('/api/vendor')) return false;
  // Everything else is owner dashboard for now.
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // Owner auth (basic) for non-vendor routes
  if (shouldRequireOwnerAuth(url)) {
    if (!checkOwnerBasicAuth(req)) return unauthorizedBasic(res);
  }

  // -------------------------
  // Health
  // -------------------------
  if (url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, ts: new Date().toISOString() });
  }

  // -------------------------
  // Vendor pages
  // -------------------------
  if (url.pathname === '/vendor' || url.pathname === '/vendor/') {
    const v = getVendorFromSession(req);
    res.writeHead(302, { Location: v ? '/vendor/orders' : '/vendor/login' });
    return res.end();
  }

  if (url.pathname === '/vendor/login') {
    return serveStatic(res, '/vendor/login.html');
  }

  if (url.pathname === '/vendor/orders') {
    // gate by session
    const v = getVendorFromSession(req);
    if (!v) {
      res.writeHead(302, { Location: '/vendor/login' });
      return res.end();
    }
    return serveStatic(res, '/vendor/orders.html');
  }

  // -------------------------
  // Vendor APIs
  // -------------------------
  if (url.pathname === '/api/vendor/me' && req.method === 'GET') {
    const v = getVendorFromSession(req);
    if (!v) return sendJson(res, 401, { error: 'vendor_unauthorized' });
    return sendJson(res, 200, { vendor: v });
  }

  if (url.pathname === '/api/vendor/login' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');

    const vendor = getVendorByUsername(username);
    if (!vendor || !verifyPassword(password, vendor.password)) {
      return sendJson(res, 401, { error: 'bad_credentials' });
    }

    const token = crypto.randomUUID();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString(); // 14 days
    const sessions = loadVendorSessions();

    // prune old sessions
    const now = Date.now();
    sessions.sessions = (sessions.sessions || []).filter((s) => !s.expiresAt || now <= new Date(s.expiresAt).getTime());
    sessions.sessions.push({ token, vendorId: vendor.id, createdAt: new Date().toISOString(), expiresAt });
    saveVendorSessions(sessions);

    setCookie(res, 'vendor_session', token, {
      httpOnly: true,
      sameSite: 'Lax',
      path: '/',
      secure: false,
      maxAge: 60 * 60 * 24 * 14,
    });

    return sendJson(res, 200, { ok: true, vendor: { id: vendor.id, name: vendor.name, username: vendor.username } });
  }

  if (url.pathname === '/api/vendor/logout' && req.method === 'POST') {
    const cookies = parseCookies(req);
    const token = cookies.vendor_session;
    if (token) {
      const sessions = loadVendorSessions();
      sessions.sessions = (sessions.sessions || []).filter((s) => s.token !== token);
      saveVendorSessions(sessions);
    }
    setCookie(res, 'vendor_session', '', { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 0 });
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/vendor/orders' && req.method === 'GET') {
    const vendor = requireVendor(req, res);
    if (!vendor) return;

    const data = loadOrders();
    const orders = (data.orders || []).filter((o) => o.vendorId === vendor.id);

    // newest first (by createdAt if present)
    orders.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    return sendJson(res, 200, { vendor, orders });
  }

  if (url.pathname === '/api/vendor/orders.xlsx' && req.method === 'GET') {
    const vendor = requireVendor(req, res);
    if (!vendor) return;

    const py = path.join(scriptsDir, 'export_vendor_orders_xlsx.py');
    const out = spawnSync('python3', [py], {
      env: {
        ...process.env,
        ORDERS_JSON_PATH: ordersPath,
        VENDOR_ID: vendor.id,
      },
      maxBuffer: 20 * 1024 * 1024,
    });

    if (out.status !== 0) {
      return sendJson(res, 500, { error: 'export_failed', stderr: String(out.stderr || '') });
    }

    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="orders-${vendor.username}.xlsx"`,
    });
    return res.end(out.stdout);
  }

  if (url.pathname?.startsWith('/api/vendor/orders/') && req.method === 'POST') {
    const vendor = requireVendor(req, res);
    if (!vendor) return;

    const parts = url.pathname.split('/').filter(Boolean); // api vendor orders :id ...
    const orderId = parts[3];
    const action = parts[4];

    if (action !== 'tracking') return sendJson(res, 404, { error: 'not_found' });

    const body = await readJsonBody(req);
    const carrier = String(body?.carrier || 'etc');
    const number = body?.number;

    const v = validateTracking({ carrier, number });
    if (!v.ok) return sendJson(res, 400, { error: v.error });

    const db = loadOrders();
    const idx = (db.orders || []).findIndex((o) => o.id === orderId && o.vendorId === vendor.id);
    if (idx === -1) return sendJson(res, 404, { error: 'not_found' });

    const now = new Date().toISOString();
    db.orders[idx].tracking = {
      carrier,
      number: v.number,
      updatedAt: now,
    };
    db.orders[idx].status = 'shipped';
    db.orders[idx].updatedAt = now;

    saveOrders(db);
    return sendJson(res, 200, { ok: true, order: db.orders[idx] });
  }

  if (url.pathname === '/api/vendor/orders/export.xlsx' && req.method === 'GET') {
    const vendor = requireVendor(req, res);
    if (!vendor) return;

    const data = loadOrders();
    const orders = (data.orders || []).filter((o) => o.vendorId === vendor.id);

    const rows = orders.map((o) => ({
      orderId: o.id,
      createdAt: o.createdAt,
      buyerName: o.buyer?.name || '',
      recipientName: o.recipient?.name || '',
      phone: o.recipient?.phone || '',
      address1: o.recipient?.address1 || '',
      address2: o.recipient?.address2 || '',
      zipcode: o.recipient?.zipcode || '',
      items: Array.isArray(o.items) ? o.items.map((it) => `${it.name} x${it.qty}`).join(' / ') : '',
      status: o.status || '',
      trackingCarrier: o.tracking?.carrier || '',
      trackingNumber: o.tracking?.number || '',
    }));

    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'orders');

    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="orders-${vendor.id}.xlsx"`,
    });
    return res.end(buf);
  }

  // -------------------------
  // Owner queue APIs (existing)
  // -------------------------
  if (url.pathname === '/api/queue' && req.method === 'GET') {
    const type = url.searchParams.get('type');
    const state = url.searchParams.get('state');
    const q = url.searchParams.get('q');

    const data = loadQueue();
    let items = data.items || [];

    if (type) items = items.filter((it) => it.type === type);
    if (state) items = items.filter((it) => it.state === state);
    if (q) {
      const qq = q.toLowerCase();
      items = items.filter((it) => JSON.stringify(it).toLowerCase().includes(qq));
    }

    // needs_auth first, then priority desc, then created desc
    items.sort((a, b) => {
      if (a.state === 'needs_auth' && b.state !== 'needs_auth') return -1;
      if (b.state === 'needs_auth' && a.state !== 'needs_auth') return 1;
      if ((b.priority || 0) !== (a.priority || 0)) return (b.priority || 0) - (a.priority || 0);
      return String(b.created_at || '').localeCompare(String(a.created_at || ''));
    });

    return sendJson(res, 200, { items });
  }

  if (url.pathname?.startsWith('/api/queue/') && req.method === 'POST') {
    const parts = url.pathname.split('/').filter(Boolean); // api, queue, :id, action
    const id = parts[2];
    const action = parts[3];

    const body = await readJsonBody(req);
    const actor = body?.actor || 'owner';

    const data = loadQueue();
    const idx = (data.items || []).findIndex((it) => it.id === id);
    if (idx === -1) return sendJson(res, 404, { error: 'not_found' });

    const item = data.items[idx];

    let nextState;
    if (action === 'approve') nextState = 'approved';
    else if (action === 'hold') nextState = 'held';
    else if (action === 'retry') nextState = 'pending';
    else if (action === 'auth_done') nextState = 'pending';
    else return sendJson(res, 400, { error: 'bad_action' });

    const ok = validateTransition(item.state, nextState);
    if (!ok) return sendJson(res, 409, { error: 'invalid_transition', from: item.state, to: nextState });

    const now = new Date().toISOString();
    item.state = nextState;
    item.updated_at = now;

    if (nextState === 'approved') {
      item.approved_at = now;
      item.approved_by = actor;
    }
    if (action === 'retry') {
      item.retry_count = Math.max(0, Number(item.retry_count || 0) + 1);
    }

    item.execution_log = Array.isArray(item.execution_log) ? item.execution_log : [];
    item.execution_log.push({
      ts: now,
      step: 'state_change',
      status: 'ok',
      message: `${actor}: ${item.state}`,
      action,
    });

    data.items[idx] = item;
    saveQueue(data);

    return sendJson(res, 200, { ok: true, item });
  }

  // static (owner UI + vendor static assets)
  return serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`[dashboard] running on http://localhost:${PORT}`);
  console.log(`[dashboard] owner basic auth user=${OWNER_USERNAME} (password via DASHBOARD_PASSWORD)`);
  console.log('[dashboard] vendor portal: /vendor/login (session cookie)');
});
