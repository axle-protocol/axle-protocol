import http from 'node:http';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  readFileSync,
  existsSync,
  statSync,
  createReadStream,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  renameSync,
  appendFileSync,
  readdirSync,
  unlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as XLSX from 'xlsx';
import { chromium } from 'playwright';
import archiver from 'archiver';

// Naver Commerce API (conditional — only loads if env vars present)
let naverCommerce = null;
if (process.env.NAVER_CLIENT_ID && process.env.NAVER_CLIENT_SECRET) {
  try {
    naverCommerce = await import('./lib/naver-commerce.mjs');
    console.log('[dashboard] Naver Commerce API module loaded');
  } catch (e) {
    console.warn('[dashboard] Naver Commerce API module failed to load:', e.message);
    console.warn('[dashboard] Run: npm install bcryptjs');
  }
}

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

function ensureDir(p) {
  mkdirSync(p, { recursive: true });
}

function cleanupOldBackups(dirPath, maxDays) {
  if (!existsSync(dirPath)) return;
  const now = Date.now();
  const maxAgeMs = maxDays * 24 * 60 * 60 * 1000;
  let names = [];
  try {
    names = readdirSync(dirPath);
  } catch {
    return;
  }
  for (const name of names) {
    const p = path.join(dirPath, name);
    try {
      const st = statSync(p);
      if (now - st.mtimeMs > maxAgeMs) unlinkSync(p);
    } catch {
      // ignore
    }
  }
}

function safeWriteJson(filePath, data, { backupDays = 7 } = {}) {
  ensureDataDir();

  const dir = path.dirname(filePath);
  const backupsDir = path.join(dir, 'backups');
  ensureDir(backupsDir);

  if (existsSync(filePath)) {
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const backupPath = path.join(backupsDir, `${path.basename(filePath)}.${ts}.bak`);
    try {
      copyFileSync(filePath, backupPath);
      cleanupOldBackups(backupsDir, backupDays);
    } catch {
      // ignore backup failure (but continue to write)
    }
  }

  const tmpPath = `${filePath}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  renameSync(tmpPath, filePath);
}

function saveJson(filePath, data) {
  safeWriteJson(filePath, data);
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

async function readMultipart(req, boundaryStr, maxBytes = 30 * 1024 * 1024) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += b.length;
    if (size > maxBytes) throw new Error('multipart_too_large');
    chunks.push(b);
  }
  const buf = Buffer.concat(chunks);
  const boundaryBuf = Buffer.from(`--${boundaryStr}`);
  const parts = [];
  let start = buf.indexOf(boundaryBuf);
  while (start !== -1) {
    start += boundaryBuf.length;
    // end?
    if (buf.slice(start, start + 2).toString('utf8') === '--') break;
    // skip leading CRLF
    if (buf.slice(start, start + 2).toString('utf8') === '\r\n') start += 2;
    const headerEnd = buf.indexOf(Buffer.from('\r\n\r\n'), start);
    if (headerEnd === -1) break;
    const headerText = buf.slice(start, headerEnd).toString('utf8');
    const bodyStart = headerEnd + 4;
    let next = buf.indexOf(boundaryBuf, bodyStart);
    if (next === -1) break;
    // body ends with CRLF right before boundary
    let bodyEnd = next - 2;
    if (bodyEnd < bodyStart) bodyEnd = bodyStart;
    const body = buf.slice(bodyStart, bodyEnd);

    const headers = {};
    for (const line of headerText.split('\r\n')) {
      const idx = line.indexOf(':');
      if (idx === -1) continue;
      headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    }
    const cd = headers['content-disposition'] || '';
    const nameMatch = cd.match(/name="([^"]+)"/);
    const fileMatch = cd.match(/filename="([^"]*)"/);
    const ctMatch = headerText.match(/Content-Type:\s*([^\r\n]+)/i);
    const contentType = ctMatch ? ctMatch[1].trim() : '';
    parts.push({
      name: nameMatch ? nameMatch[1] : null,
      filename: fileMatch ? fileMatch[1] : null,
      contentType,
      headers,
      data: body,
    });

    start = next;
  }
  return parts;
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
const ownerSessionsPath = path.join(dataDir, 'owner_sessions.json');
const ordersPath = path.join(dataDir, 'orders.json');
const productsPath = path.join(dataDir, 'products.json');
const scriptsDir = path.join(__dirname, 'scripts');
const mappingPath = path.join(dataDir, 'mapping.json');
const auditLogPath = path.join(dataDir, 'audit.jsonl');
const igGuidePath = path.join(dataDir, 'ig_brand_guide.json');
const igPostsPath = path.join(dataDir, 'ig_posts.json');
const roadmapPath = path.join(dataDir, 'roadmap.json');

const CARRIER_LABEL = {
  cj: 'CJ대한통운',
  hanjin: '한진택배',
  lotte: '롯데택배',
  post: '우체국택배',
  logen: '로젠택배',
  kyungdong: '경동택배',
};

// -------------------------
// TRUST_PROXY — only trust x-forwarded-proto/x-forwarded-for behind a reverse proxy
// -------------------------
const TRUST_PROXY = process.env.TRUST_PROXY === 'true' || process.env.TRUST_PROXY === '1';

// -------------------------
// Order State Machine (P0-3)
// -------------------------
const ORDER_TRANSITIONS = {
  // fromStatus → [allowed next statuses]
  new:       ['assigned', 'hold', 'shipped', 'cancelled'],
  assigned:  ['shipped', 'hold', 'cancelled'],
  shipped:   ['exported'],
  hold:      ['assigned', 'new', 'cancelled'],
  exported:  ['confirmed'],
  confirmed: [],
  cancelled: [],
};

function getOrderStatus(order) {
  return order.status || 'new';
}

/**
 * Validate + apply order status transition.
 * Returns { ok, error?, prev, next } — does NOT save to disk (caller saves).
 */
function transitionOrder(order, toStatus, { actor, reason, ip } = {}) {
  const from = getOrderStatus(order);
  const allowed = ORDER_TRANSITIONS[from];
  if (!allowed) {
    return { ok: false, error: `unknown_status: ${from}`, prev: from, next: toStatus };
  }
  if (!allowed.includes(toStatus)) {
    return { ok: false, error: `invalid_transition: ${from} → ${toStatus}`, prev: from, next: toStatus };
  }
  const now = new Date().toISOString();
  const prevStatus = from;
  order.status = toStatus;
  order.updatedAt = now;
  // Append transition to order history
  if (!Array.isArray(order._history)) order._history = [];
  order._history.push({ from: prevStatus, to: toStatus, at: now, actor: actor || null, reason: reason || null });
  return { ok: true, prev: prevStatus, next: toStatus };
}

// --- Rate Limiting ---
const loginAttempts = new Map(); // ip -> { count, lockedUntil }
const RATE_LIMIT_MAX = 5;
const RATE_LIMIT_WINDOW = 5 * 60 * 1000; // 5min
const RATE_LIMIT_LOCKOUT = 15 * 60 * 1000; // 15min

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = loginAttempts.get(ip);
  if (!entry) return true;
  if (entry.lockedUntil && now < entry.lockedUntil) return false;
  if (entry.lockedUntil && now >= entry.lockedUntil) { loginAttempts.delete(ip); return true; }
  if (now - entry.firstAttempt > RATE_LIMIT_WINDOW) { loginAttempts.delete(ip); return true; }
  return entry.count < RATE_LIMIT_MAX;
}

function recordLoginAttempt(ip, success) {
  if (success) { loginAttempts.delete(ip); return; }
  const now = Date.now();
  const entry = loginAttempts.get(ip) || { count: 0, firstAttempt: now };
  entry.count++;
  if (entry.count >= RATE_LIMIT_MAX) entry.lockedUntil = now + RATE_LIMIT_LOCKOUT;
  loginAttempts.set(ip, entry);
}

// --- XSS Prevention ---
function escapeHtml(str) {
  if (typeof str !== 'string') return str;
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// Privacy masking helpers
function maskPhone(phone) {
  if (!phone || phone.length < 4) return phone;
  return phone.slice(0, -4) + '****';
}
function maskAddress(addr) {
  if (!addr) return addr;
  // Keep city/district, mask rest
  const parts = addr.split(' ');
  if (parts.length <= 2) return addr;
  return parts.slice(0, 2).join(' ') + ' ***';
}

// SmartStore bulk shipping upload usually expects these exact strings.
const DEFAULT_DELIVERY_METHOD = '택배,등기,소포';

function getClientIp(req) {
  if (TRUST_PROXY) {
    const xff = req.headers['x-forwarded-for'];
    if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  }
  return req.socket?.remoteAddress || null;
}

function isHttpsRequest(req) {
  if (TRUST_PROXY) return String(req.headers['x-forwarded-proto'] || '').includes('https');
  return false; // direct connection — never mark secure unless behind trusted proxy
}

function loadRoadmap() {
  ensureDataDir();
  return loadJson(roadmapPath, { items: [] });
}

function saveRoadmap(db) {
  saveJson(roadmapPath, db);
}

function auditLog(entry) {
  ensureDataDir();
  const record = {
    id: crypto.randomUUID(),
    ts: new Date().toISOString(),
    ...entry,
  };
  try {
    appendFileSync(auditLogPath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // best-effort; ignore
  }
}

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

function loadProducts() {
  return loadJson(productsPath, { products: [] });
}

function saveProducts(data) {
  saveJson(productsPath, data);
}

function loadMapping() {
  return loadJson(mappingPath, { mapping: [] });
}

function saveMapping(data) {
  saveJson(mappingPath, data);
}

// -------------------------
// Naver carrier code mapping (module scope — used by doNaverShipBatch + endpoints)
// -------------------------
const NAVER_LIVE = (process.env.NAVER_LIVE || 'false') === 'true';

const NAVER_CARRIER_MAP = {
  cj: 'CJGLS',
  hanjin: 'HANJIN',
  lotte: 'LOTTE',
  post: 'EPOST',
  logen: 'LOGEN',
  kyungdong: 'KYUNGDONG',
};

// -------------------------
// Shared Naver functions (extracted from endpoint handlers)
// -------------------------

/**
 * Sync orders from Naver Commerce API.
 * @param {string} from - start date (YYYY-MM-DD)
 * @param {string} to - end date (YYYY-MM-DD)
 * @returns {{ imported, updated, total, from, to }}
 */
async function doNaverSync(from, to) {
  if (!naverCommerce) throw new Error('naver_api_not_configured');

  const result = await naverCommerce.fetchOrders(from, to);
  const productOrderIds = (result?.lastChangeStatuses || []).map((s) => s.productOrderId);

  if (productOrderIds.length === 0) {
    return { imported: 0, updated: 0, total: 0, from, to };
  }

  const mapping = loadMapping();
  const productToVendor = new Map((mapping.mapping || []).map((m2) => [String(m2.productNo), String(m2.vendorId)]));
  const orders = loadOrders();
  const byPon = new Map((orders.orders || []).map((o) => [String(o.productOrderNo), o]));
  const now = new Date().toISOString();
  let imported = 0;
  let updated = 0;

  for (const poId of productOrderIds) {
    try {
      const detail = await naverCommerce.getOrderDetail(poId);
      const po = detail?.productOrder || detail;
      const productNo = String(po.productNo || po.productId || '');
      const vendorId = productToVendor.get(productNo) || null;

      const row = {
        id: String(po.productOrderId || poId),
        productOrderNo: String(po.productOrderId || poId),
        orderNo: String(po.orderId || ''),
        productNo,
        productName: po.productName || '',
        optionInfo: po.optionManageCode || po.optionContent || '',
        qty: Number(po.quantity || 1),
        recipientName: po.shippingAddress?.name || '',
        recipientPhone: po.shippingAddress?.tel1 || po.shippingAddress?.tel2 || null,
        recipientAddress: [po.shippingAddress?.baseAddress, po.shippingAddress?.detailAddress].filter(Boolean).join(' ') || null,
        vendorId,
        status: vendorId ? 'assigned' : 'new',
        carrier: null,
        trackingNumber: '',
        createdAt: po.orderDate || now,
        updatedAt: now,
        naverStatus: po.productOrderStatus || null,
        _naverRaw: { claimType: po.claimType || null, claimStatus: po.claimStatus || null },
      };

      if (byPon.has(row.productOrderNo)) {
        const existing = byPon.get(row.productOrderNo);
        existing.naverStatus = row.naverStatus;
        existing._naverRaw = row._naverRaw;
        existing.updatedAt = now;
        if (!existing.vendorId && vendorId) {
          existing.vendorId = vendorId;
          if (getOrderStatus(existing) === 'new') transitionOrder(existing, 'assigned', { actor: 'system:naver_sync', reason: 'auto_assign' });
        }
        updated++;
      } else {
        orders.orders.push(row);
        byPon.set(row.productOrderNo, row);
        imported++;
      }
    } catch (e) {
      console.error(`[naver-sync] Failed to fetch detail for ${poId}:`, e.message);
    }
  }

  saveOrders(orders);
  return { imported, updated, total: productOrderIds.length, from, to };
}

/**
 * Ship a batch of orders via Naver Commerce API.
 * @param {string[]} orderIds
 * @returns {{ success, failed, skipped, results }}
 */
async function doNaverShipBatch(orderIds) {
  if (!naverCommerce) throw new Error('naver_api_not_configured');

  const db = loadOrders();
  const results = [];
  let success = 0;
  let failed = 0;
  let skipped = 0;

  for (const orderId of orderIds) {
    const order = (db.orders || []).find((o) => o.id === orderId);
    if (!order) { results.push({ orderId, ok: false, error: 'not_found' }); failed++; continue; }

    if (order.naverShippedAt) {
      results.push({ orderId, ok: true, skipped: true, reason: 'already_shipped' });
      skipped++;
      continue;
    }

    const tn = String(order.trackingNumber || order.tracking?.number || '').trim();
    const carrier = String(order.carrier || order.tracking?.carrier || '').trim();
    if (!tn) { results.push({ orderId, ok: false, error: 'no_tracking_number' }); failed++; continue; }

    const naverCarrier = NAVER_CARRIER_MAP[carrier];
    if (!naverCarrier) { results.push({ orderId, ok: false, error: `unknown_carrier: ${carrier}` }); failed++; continue; }

    if (!NAVER_LIVE) {
      // Dry-run: no state change, no API call, log only
      results.push({ orderId, ok: true, dryRun: true });
      auditLog({ actorType: 'system', action: 'NAVER_SHIP_DRY_RUN', orderId, carrier: naverCarrier, trackingNumber: tn });
      success++;
      continue;
    }

    const tr = transitionOrder(order, 'exported', { actor: 'system:naver_ship', reason: 'naver_ship' });
    if (!tr.ok) { results.push({ orderId, ok: false, error: tr.error }); failed++; continue; }

    const shipAttemptId = crypto.randomUUID();
    order._shipAttempt = { id: shipAttemptId, startedAt: new Date().toISOString(), carrier: naverCarrier, trackingNumber: tn };

    try {
      await naverCommerce.shipOrder(order.productOrderNo, naverCarrier, tn);
      order.naverStatus = 'DISPATCHED';
      order.naverShippedAt = new Date().toISOString();
      order.exportedAt = new Date().toISOString();
      order._shipAttempt.status = 'success';
      results.push({ orderId, ok: true });
      success++;
    } catch (e) {
      order.status = tr.prev;
      if (Array.isArray(order._history) && order._history.length > 0) order._history.pop();
      order._shipAttempt.status = 'failed';
      order._shipAttempt.error = e.message;
      order._shipAttempt.failedAt = new Date().toISOString();
      results.push({ orderId, ok: false, error: e.message });
      failed++;
    }
  }

  saveOrders(db);
  return { success, failed, skipped, results, dryRun: !NAVER_LIVE };
}

/**
 * Confirm a batch of orders via Naver Commerce API.
 * @param {string[]} orderIds
 * @returns {{ success, failed, results }}
 */
async function doNaverConfirmBatch(orderIds) {
  if (!naverCommerce) throw new Error('naver_api_not_configured');

  const db = loadOrders();
  const results = [];
  let success = 0;
  let failed = 0;

  for (const orderId of orderIds) {
    const order = (db.orders || []).find((o) => o.id === orderId);
    if (!order) { results.push({ orderId, ok: false, error: 'not_found' }); failed++; continue; }

    if (order.naverConfirmedAt) {
      results.push({ orderId, ok: true, skipped: true, reason: 'already_confirmed' });
      success++;
      continue;
    }

    if (!NAVER_LIVE) {
      results.push({ orderId, ok: true, dryRun: true });
      auditLog({ actorType: 'system', action: 'NAVER_CONFIRM_DRY_RUN', orderId });
      success++;
      continue;
    }

    try {
      await naverCommerce.confirmOrder(order.productOrderNo);
      order.naverStatus = 'PAYED';
      order.naverConfirmedAt = new Date().toISOString();
      const tr = transitionOrder(order, 'confirmed', { actor: 'system:naver_confirm', reason: 'naver_confirm' });
      if (!tr.ok) {
        results.push({ orderId, ok: false, error: `confirm_api_ok_but_transition_failed: ${tr.error}` });
        failed++;
        continue;
      }
      results.push({ orderId, ok: true });
      success++;
    } catch (e) {
      results.push({ orderId, ok: false, error: e.message });
      failed++;
    }
  }

  saveOrders(db);
  return { success, failed, results, dryRun: !NAVER_LIVE };
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
    approved: ['running', 'failed'],
    running: ['success', 'failed', 'needs_auth'],
    failed: ['pending', 'held'],
    needs_auth: ['pending', 'held'],
    held: ['pending'],
    success: [],
  };
  return (allowed[from] || []).includes(to);
}

// -------------------------
// Instagram semi-automation
// -------------------------

function loadIgGuide() {
  const guide = loadJson(igGuidePath, null);
  if (guide) return guide;
  const def = getDefaultIgGuide();
  saveJson(igGuidePath, def);
  return def;
}

function saveIgGuide(data) {
  saveJson(igGuidePath, data);
}

function loadIgPosts() {
  return loadJson(igPostsPath, { posts: [] });
}

function saveIgPosts(data) {
  saveJson(igPostsPath, data);
}

function getDefaultIgGuide() {
  return {
    tone: {
      general: '자연스럽고 친근하면서도 고급스러운 톤. 과장 없이 진심을 담아서.',
      clusters: [
        { id: 'empathy', name: '공감+찐후기형(담백)', description: '실제 사용 경험 담백 공유. 공감 포인트 중심.', exampleTone: '솔직히 처음엔 반신반의했는데… 쓰면 쓸수록 달라지더라고요.' },
        { id: 'info', name: '정보형(똑똑한 소비)', description: '성분/가성비/비교 정보 중심. 이성적 어필.', exampleTone: '성분표 하나하나 비교해봤어요. 이 가격에 이 조합은 드물어요.' },
        { id: 'luxury', name: '럭셔리 감성형(짧고 세련)', description: '짧은 문장, 감각적 표현, 여백의 미.', exampleTone: '손끝에 닿는 순간, 다른 걸 알아요.' },
      ],
    },
    bannedPhrases: ['과장', '최저가', '무조건', '대박', '1등', '미쳤다', '역대급', '개이득', '떡상', 'ㄹㅇ', '겁나', '존맛'],
    emojiLimit: 5,
    lineRules: { maxLines: 20, maxCharsPerLine: 50, totalMaxChars: 700 },
    hashtagRules: {
      min: 12,
      max: 18,
      mix: {
        broad: { min: 3, max: 5, examples: ['뷰티', '메이크업', '스킨케어', '코스메틱', '데일리뷰티', '뷰티추천', '화장품'] },
        niche: { min: 4, max: 7, examples: ['촉촉립밤', '데일리립', '글로우피부', '수분크림추천', '쿠션추천', '톤업크림', '파데추천', '립추천'] },
        brand: { min: 2, max: 3, examples: ['디올', '디올뷰티', 'Dior'] },
        cta: { min: 1, max: 2, examples: ['공동구매', '공구오픈', '한정수량'] },
      },
    },
    ctaPolicy: {
      description: '하루 4포스트 중 C타입 3회 + A타입 1회',
      typeC: { text: '자세한 건 프로필 링크에서 확인하세요 :)', frequency: 3 },
      typeA: { text: "궁금하신 분은 댓글에 '공구' 남겨주세요!", frequency: 1 },
    },
    requiredBlocks: ['hook', 'body', 'cta'],
    wordingGuidance: {
      do: ['자연스러운 후기체', '궁금증 유발', '감성적 표현', '구체적 사용감'],
      dont: ['과장 광고체', '노골적 판매', '싸다/저렴 대신 가성비/합리적'],
    },
    scheduleSlots: ['10:30', '14:00', '18:30', '22:30'],
  };
}

const IG_CAPTION_TEMPLATES = {
  empathy: [
    {
      hook: '솔직히 {product} 처음 써봤을 때\n큰 기대 없었거든요',
      body: '근데 {benefit}\n이게 진짜 체감되는 순간이 오더라고요\n\n{detail}\n\n매일 쓰게 되는 건 이유가 있나 봐요',
    },
    {
      hook: '{product} 한 달 써본 솔직 후기',
      body: '결론부터 말하면, 재구매 확정이에요\n\n{benefit}\n이게 진짜 큰 차이를 만들어요\n\n{detail}\n\n주변에서 뭐 바꿨냐고 물어볼 정도',
    },
    {
      hook: '요즘 매일 손이 가는 {product}',
      body: '{benefit}\n이게 이렇게 다를 줄 몰랐어요\n\n{detail}\n\n써본 사람만 아는 그 느낌 있잖아요',
    },
    {
      hook: '이건 진짜 말해야 할 것 같아서',
      body: '{product} 쓰기 시작하고 달라진 점\n\n{benefit}\n{detail}\n\n진심이에요',
    },
  ],
  info: [
    {
      hook: '{product} 성분 꼼꼼히 따져본 사람?',
      body: '{benefit}\n직접 비교해보면 확실히 느껴져요\n\n{detail}\n\n가성비까지 생각하면 이만한 선택지 드물어요',
    },
    {
      hook: '{product} 고민 중이라면 잠깐',
      body: '{benefit} 기준으로\n여러 제품 비교해봤는데요\n\n{detail}\n\n합리적인 소비 원하시는 분께 추천드려요',
    },
    {
      hook: '알고 쓰면 달라요\n{product} 제대로 알아보기',
      body: '{benefit}\n\n{detail}\n\n꼼꼼하게 따지는 분들이라면 공감하실 거예요',
    },
    {
      hook: '요즘 뷰티 커뮤니티에서 핫한 이유',
      body: '{product}\n\n{benefit}\n{detail}\n\n실사용 데이터로 검증된 만족도예요',
    },
  ],
  luxury: [
    {
      hook: '{product}.',
      body: '{benefit}\n\n그런 건\n써보면 알게 돼요.\n\n{detail}',
    },
    {
      hook: '어떤 건 설명이 필요 없어요',
      body: '{product}\n\n{benefit}\n\n{detail}\n\n그냥, 좋은 거예요.',
    },
    {
      hook: '하나만 고른다면',
      body: '망설임 없이 {product}\n\n{benefit}\n\n{detail}',
    },
    {
      hook: '오늘의 선택',
      body: '{product}\n\n{benefit}\n{detail}\n\n좋은 건 오래 기억에 남으니까요.',
    },
  ],
};

function igHashSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pickFromArray(arr, count, seed) {
  const shuffled = [...arr].sort((a, b) => ((igHashSeed(a) + seed) % 100) - ((igHashSeed(b) + seed) % 100));
  return shuffled.slice(0, Math.min(count, shuffled.length));
}

function generateIgHashtags(guide, productName, seed) {
  const rules = guide.hashtagRules || {};
  const mix = rules.mix || {};

  const broad = pickFromArray(
    mix.broad?.examples || [],
    (mix.broad?.min || 3) + (seed % ((mix.broad?.max || 5) - (mix.broad?.min || 3) + 1)),
    seed,
  );
  const niche = pickFromArray(
    mix.niche?.examples || [],
    (mix.niche?.min || 4) + (seed % ((mix.niche?.max || 7) - (mix.niche?.min || 4) + 1)),
    seed + 1,
  );
  const brand = pickFromArray(
    mix.brand?.examples || [],
    (mix.brand?.min || 2) + (seed % ((mix.brand?.max || 3) - (mix.brand?.min || 2) + 1)),
    seed + 2,
  );
  const cta = pickFromArray(
    mix.cta?.examples || [],
    (mix.cta?.min || 1) + (seed % ((mix.cta?.max || 2) - (mix.cta?.min || 1) + 1)),
    seed + 3,
  );

  const htMin = rules.min || 12;
  const htMax = rules.max || 18;

  const productTag = productName.replace(/\s+/g, '');
  const pool = [...new Set([
    ...(mix.broad?.examples || []),
    ...(mix.niche?.examples || []),
    ...(mix.brand?.examples || []),
    ...(mix.cta?.examples || []),
  ])];

  const all = [...broad, ...niche, ...brand, ...cta];
  if (productTag && !all.includes(productTag)) all.push(productTag);

  // Ensure we always meet htMin, otherwise approval can get blocked.
  // (Defaults add up to 11 including productTag: 3+4+2+1 + productTag)
  let guard = 0;
  while (all.length < htMin && guard++ < 50) {
    const pick = pool[(seed + guard * 7) % Math.max(pool.length, 1)];
    if (!pick) break;
    if (!all.includes(pick)) all.push(pick);
  }

  // Enforce htMax (dedupe already done by includes)
  const trimmed = all.slice(0, htMax);
  return trimmed.map((t) => `#${t}`);
}

// --- Caption Block Combinator ---

const TONE_MAP = { 'friendly-info': 'empathy', 'secret-deal': 'info', 'lux-minimal': 'luxury' };

function loadCaptionBlocks() {
  const p = path.join(dataDir, 'ig_caption_blocks.json');
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return null; }
}

function filterBlocksByTone(blocks, category, tone) {
  const list = blocks[category] || [];
  return list.filter((b) => b.tone.includes(tone));
}

function captionTrigrams(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const set = new Set();
  for (let i = 0; i <= clean.length - 3; i++) set.add(clean.slice(i, i + 3));
  return set;
}

function trigramSimilarity(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

function isTooSimilar(caption, recentCaptions, threshold = 0.4) {
  const tg = captionTrigrams(caption);
  for (const rc of recentCaptions) {
    if (trigramSimilarity(tg, captionTrigrams(rc)) >= threshold) return true;
  }
  return false;
}

function getRecentCaptions(posts, limit = 30) {
  return (posts || [])
    .filter((p) => p.status !== 'canceled' && p.approvedVariantId)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, limit)
    .map((p) => {
      const v = (p.variants || []).find((vv) => vv.id === p.approvedVariantId);
      return v ? v.caption : '';
    })
    .filter(Boolean);
}

function generateIgDrafts(params, guide) {
  const { productName, keyBenefit, price, targetAudience, notes, tone } = params;
  const blocks = loadCaptionBlocks();

  // Fallback to legacy template-based generation if blocks file missing
  if (!blocks) return generateIgDraftsLegacy(params, guide);

  const detailParts = [];
  if (price) detailParts.push(`${Number(price).toLocaleString()}원대 가격도 합리적이에요`);
  if (targetAudience) detailParts.push(`${targetAudience}에게 특히 잘 맞아요`);
  if (notes) detailParts.push(notes);
  const detail = detailParts.join('\n') || `${productName}의 매력은 직접 느껴보세요`;
  const priceText = price ? `${Number(price).toLocaleString()}원` : '특별가';

  const replacePlaceholders = (text) =>
    text.replace(/\{product\}/g, productName)
      .replace(/\{benefit\}/g, keyBenefit)
      .replace(/\{detail\}/g, detail)
      .replace(/\{price\}/g, priceText)
      .replace(/\{targetAudience\}/g, targetAudience || '');

  const clusters = ['empathy', 'info', 'luxury'];
  let distribution;
  if (tone && clusters.includes(tone)) {
    distribution = [tone, tone, ...clusters.filter((c) => c !== tone)];
  } else {
    distribution = ['empathy', 'info', 'luxury', 'empathy', 'info'];
  }

  const seed = igHashSeed(productName + new Date().toISOString().slice(0, 10));
  const existingData = loadIgPosts();
  const recentCaptions = getRecentCaptions(existingData.posts);
  const variants = [];

  for (let i = 0; i < distribution.length; i++) {
    const clusterTone = distribution[i];

    const hooks = filterBlocksByTone(blocks, 'hook', clusterTone);
    const benefits = filterBlocksByTone(blocks, 'benefit', clusterTone);
    const proofs = filterBlocksByTone(blocks, 'proof', clusterTone);
    const offers = filterBlocksByTone(blocks, 'offer', clusterTone);
    const ctas = filterBlocksByTone(blocks, 'cta', clusterTone);

    if (hooks.length === 0 || benefits.length === 0) continue;

    // Try up to 5 times to avoid similarity with recent captions
    let caption = '';
    let chosenCta = null;
    for (let attempt = 0; attempt < 5; attempt++) {
      const s = seed + i * 7 + attempt * 13;
      const hook = hooks[s % hooks.length];
      const benefit = benefits[(s + 3) % benefits.length];
      const proof = proofs.length > 0 ? proofs[(s + 5) % proofs.length] : null;
      const offer = offers.length > 0 ? offers[(s + 7) % offers.length] : null;
      chosenCta = ctas.length > 0 ? ctas[(s + 11) % ctas.length] : null;

      let parts = [hook.text, benefit.text];
      if (proof) parts.push(proof.text);
      if (offer && price) parts.push(offer.text);
      if (chosenCta) parts.push(chosenCta.text);
      else {
        const ctaType = i === seed % distribution.length ? 'A' : 'C';
        parts.push(ctaType === 'A' ? (guide.ctaPolicy?.typeA?.text || "댓글에 '공구' 남겨주세요!") : (guide.ctaPolicy?.typeC?.text || '프로필 링크에서 확인하세요 :)'));
      }

      caption = replacePlaceholders(parts.join('\n\n'));
      if (!isTooSimilar(caption, recentCaptions)) break;
    }

    const ctaType = chosenCta?.ctaType || (i === seed % distribution.length ? 'A' : 'C');
    const hashtags = generateIgHashtags(guide, productName, seed + i);
    const variant = {
      id: `var_${crypto.randomUUID()}`,
      cluster: clusterTone,
      clusterName: (guide.tone?.clusters || []).find((c) => c.id === clusterTone)?.name || clusterTone,
      caption: sanitizeIgCaption(caption, guide),
      hashtags: hashtags.join(' '),
      ctaType,
      validation: null,
    };
    variant.validation = validateIgDraft(variant, guide);
    variants.push(variant);
  }
  return variants;
}

// Legacy fallback when ig_caption_blocks.json is missing
function generateIgDraftsLegacy(params, guide) {
  const { productName, keyBenefit, price, targetAudience, notes, tone } = params;
  const detailParts = [];
  if (price) detailParts.push(`${Number(price).toLocaleString()}원대 가격도 합리적이에요`);
  if (targetAudience) detailParts.push(`${targetAudience}에게 특히 잘 맞아요`);
  if (notes) detailParts.push(notes);
  const detail = detailParts.join('\n') || `${productName}의 매력은 직접 느껴보세요`;

  const clusters = ['empathy', 'info', 'luxury'];
  let distribution;
  if (tone && clusters.includes(tone)) {
    distribution = [tone, tone, ...clusters.filter((c) => c !== tone)];
  } else {
    distribution = ['empathy', 'info', 'luxury', 'empathy', 'info'];
  }

  const seed = igHashSeed(productName + new Date().toISOString().slice(0, 10));
  const variants = [];

  for (let i = 0; i < distribution.length; i++) {
    const cluster = distribution[i];
    const templates = IG_CAPTION_TEMPLATES[cluster] || [];
    if (templates.length === 0) continue;
    const tpl = templates[(seed + i) % templates.length];
    let caption = tpl.hook.replace(/{product}/g, productName).replace(/{benefit}/g, keyBenefit);
    caption += '\n\n';
    caption += tpl.body.replace(/{product}/g, productName).replace(/{benefit}/g, keyBenefit).replace(/{detail}/g, detail);

    const ctaType = i === seed % distribution.length ? 'A' : 'C';
    const ctaText = ctaType === 'A' ? (guide.ctaPolicy?.typeA?.text || "댓글에 '공구' 남겨주세요!") : (guide.ctaPolicy?.typeC?.text || '프로필 링크에서 확인하세요 :)');
    caption += '\n\n' + ctaText;

    const hashtags = generateIgHashtags(guide, productName, seed + i);
    const variant = {
      id: `var_${crypto.randomUUID()}`,
      cluster,
      clusterName: (guide.tone?.clusters || []).find((c) => c.id === cluster)?.name || cluster,
      caption: sanitizeIgCaption(caption, guide),
      hashtags: hashtags.join(' '),
      ctaType,
      validation: null,
    };
    variant.validation = validateIgDraft(variant, guide);
    variants.push(variant);
  }
  return variants;
}

function sanitizeIgCaption(caption, guide) {
  let out = caption || '';
  for (const phrase of guide.bannedPhrases || []) {
    if (!phrase) continue;
    // Remove banned phrases (keep meaning; avoid blocking approval).
    out = out.split(phrase).join('');
  }
  // Normalize excessive whitespace
  out = out.replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return out;
}

function parsePriceNumber(raw) {
  if (raw === null || raw === undefined || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  // Numeric-only policy: allow digits only (string)
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function validateIgDraft(variant, guide) {
  const errors = [];
  const caption = variant.caption || '';

  for (const phrase of guide.bannedPhrases || []) {
    if (caption.includes(phrase)) {
      errors.push(`금지어 포함: "${phrase}"`);
    }
  }

  const emojiRe = /[\p{Emoji_Presentation}\p{Extended_Pictographic}]/gu;
  const emojiCount = (caption.match(emojiRe) || []).length;
  if (emojiCount > (guide.emojiLimit || 5)) {
    errors.push(`이모지 ${emojiCount}개 (제한: ${guide.emojiLimit || 5}개)`);
  }

  const hashtags = (variant.hashtags || '').split(/\s+/).filter((h) => h.startsWith('#'));
  const htMin = guide.hashtagRules?.min || 12;
  const htMax = guide.hashtagRules?.max || 18;
  if (hashtags.length < htMin) errors.push(`해시태그 ${hashtags.length}개 (최소 ${htMin}개)`);
  if (hashtags.length > htMax) errors.push(`해시태그 ${hashtags.length}개 (최대 ${htMax}개)`);

  const lines = caption.split('\n').filter((l) => l.trim());
  if (lines.length < 3) errors.push('캡션이 너무 짧습니다 (hook+body+CTA 필요)');

  const ctaKw = ['프로필 링크', '댓글', '공구', 'DM', '링크'];
  if (!ctaKw.some((kw) => caption.includes(kw))) errors.push('CTA 문구가 없습니다');

  const lr = guide.lineRules || {};
  if (lr.maxLines && caption.split('\n').length > lr.maxLines) errors.push(`줄 수 초과 (${lr.maxLines}줄 제한)`);
  if (lr.totalMaxChars && caption.length > lr.totalMaxChars) errors.push(`글자 수 초과 (${lr.totalMaxChars}자 제한)`);

  return { valid: errors.length === 0, errors };
}

function findNextIgSlot(posts, guide) {
  const slots = guide.scheduleSlots || ['10:30', '14:00', '18:30', '22:30'];
  const kstOff = 9 * 60 * 60 * 1000;
  const now = new Date();
  const kstNow = new Date(now.getTime() + kstOff);

  const scheduled = new Set();
  for (const p of posts) {
    if ((p.status === 'approved' || p.status === 'sent') && p.scheduledAt) {
      const d = new Date(new Date(p.scheduledAt).getTime() + kstOff);
      const ds = d.toISOString().slice(0, 10);
      const ts = `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
      scheduled.add(`${ds}T${ts}`);
    }
  }

  for (let day = 0; day <= 14; day++) {
    const date = new Date(kstNow.getTime() + day * 86400000);
    const ds = date.toISOString().slice(0, 10);
    for (const slot of slots) {
      if (scheduled.has(`${ds}T${slot}`)) continue;
      if (day === 0) {
        const [h, m] = slot.split(':').map(Number);
        const sm = h * 60 + m;
        const nm = kstNow.getUTCHours() * 60 + kstNow.getUTCMinutes();
        if (sm <= nm) continue;
      }
      const [h, m] = slot.split(':').map(Number);
      const sa = new Date(`${ds}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00+09:00`);
      return { slot, date: ds, scheduledAt: sa.toISOString() };
    }
  }
  return null;
}

// -------------------------
// Card Image Generation (Playwright)
// -------------------------

let _browser = null;

async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  try {
    if (_browser) {
      try { await _browser.close(); } catch {}
    }
  } catch {}
  _browser = await chromium.launch({
    headless: true,
    args: ['--disable-dev-shm-usage'],
  });
  return _browser;
}

function loadIgLayouts() {
  const p = path.join(dataDir, 'ig_layouts.json');
  if (!existsSync(p)) return { layouts: [] };
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return { layouts: [] }; }
}

const IG_PAGE_SEQUENCE = ['hook', 'why', 'detail', 'offer', 'cta'];

const IG_SLIDE_TYPES = [
  { type: 'cover', label: '표지 (상품+가격)', required: false },
  { type: 'why', label: '장점 (Benefits)', required: false },
  { type: 'options', label: '옵션/구성표', required: false },
  { type: 'trust', label: '후기/신뢰', required: false },
  { type: 'logistics', label: '배송/교환/반품', required: false },
  { type: 'howto', label: '주문 방법', required: false },
  { type: 'cta', label: 'CTA (마감)', required: false },
];
const IG_DEFAULT_SLIDES = ['cover', 'why', 'options', 'trust', 'logistics', 'howto', 'cta'];
const IG_VALID_TYPES = new Set([...IG_DEFAULT_SLIDES, 'hook', 'detail', 'offer']);

const PAGE_CHAR_LIMITS = {
  HOOK_TEXT: 40, // was 80, now H1 56px = shorter
  COVER_HEADLINE: 40, // was 80
  SUB_TEXT: 40, // was 60
  COVER_SUB: 40, // was 60
  ITEM_1: 30, // was 50, now H2 36px
  ITEM_2: 30,
  ITEM_3: 30,
  DETAIL_TEXT: 120, // was 150
  DETAIL_LEFT: 60, // was 80
  DETAIL_RIGHT: 60, // was 80
  OFFER_TEXT: 80, // was 100
  ORIGINAL_PRICE: 15, // was 20
  DEAL_PRICE: 10, // was 15
  DISCOUNT_RATE: 8, // was 10
  DEADLINE_INFO: 40, // was 60
  CTA_TEXT: 40, // was 80, now 48px font
  CTA_SUB: 30, // was 40
  CTA_MAIN: 12, // was 30, button text
  CTA_SUB_ACTION: 20, // was 30
  OPTION_1_NAME: 20, // was 30
  OPTION_1_PRICE: 12, // was 15
  OPTION_2_NAME: 20,
  OPTION_2_PRICE: 12,
  OPTION_3_NAME: 20,
  OPTION_3_PRICE: 12,
  TRUST_HEADLINE: 20, // was 30
  TRUST_STAT: 20, // was 30
  REVIEW_1: 40, // was 60
  REVIEW_2: 40, // was 60
  SHIPPING_INFO: 30, // was 40
  RETURN_INFO: 30,
  EXCHANGE_INFO: 30,
  LOGISTICS_NOTE: 30, // was 40
  STEP_1: 20, // was 40, shorter for flow cards
  STEP_2: 20,
  STEP_3: 20,
  HOWTO_NOTE: 30, // was 40
  PRODUCT_IMAGE_URL: 999,
};

function truncateText(t, max) {
  if (!t || t.length <= max) return t;
  return t.slice(0, max - 1) + '…';
}

function applyCharLimits(pages) {
  for (const page of pages) {
    for (const [key, val] of Object.entries(page)) {
      if (key === 'type' || typeof val !== 'string') continue;
      const limit = PAGE_CHAR_LIMITS[key];
      if (limit) page[key] = truncateText(val, limit);
    }
  }
  return pages;
}

function parseVariantToPages(variant, post, pageCount, slides) {
  const caption = variant?.caption || '';
  const blocks = caption.split(/\n\n+/).filter((b) => b.trim());
  const product = post.productName || '';
  const benefit = post.keyBenefit || '';
  const priceNum = typeof post.price === 'number' ? post.price : Number(post.price);
  const hasPrice = Number.isFinite(priceNum) && priceNum > 0;
  const price = hasPrice ? `${Math.round(priceNum).toLocaleString()}원` : '';
  const priceOriginal = hasPrice ? `정가 ${Math.round(priceNum * 1.3).toLocaleString()}원` : '';
  const discountRate = hasPrice ? `${Math.round((1 - 1 / 1.3) * 100)}% OFF` : '';

  // Build structured detail text
  const detailParts = [];
  if (post.targetAudience) detailParts.push(`${post.targetAudience}에게 특히 잘 맞아요`);
  if (post.notes) detailParts.push(post.notes);
  const detailText = detailParts.join('\n') || `${product}의 매력은 직접 느껴보세요`;

  // Intelligent benefit splitting for WHY page (3 items)
  let benefitItems = benefit.split(/[,、·\n]/).map((s) => s.trim()).filter((s) => s.length > 2);
  if (benefitItems.length < 2) benefitItems = benefit.split(/\s(?=와|과|및|그리고)/).map((s) => s.trim()).filter(Boolean);
  const item1 = benefitItems[0] || benefit;
  const item2 = benefitItems[1] || (post.targetAudience ? `${post.targetAudience} 맞춤` : '매일 사용하기 좋은 제품');
  const item3 = benefitItems[2] || (post.notes || '검증된 품질과 합리적 가격');

  // Extract hook — first caption block is the hook, second is benefit/body
  const hookText = blocks[0] || product;
  const ctaBlock = blocks[blocks.length - 1] || '프로필 링크에서 확인하세요';
  const offerCandidate = blocks.length >= 3 ? blocks[blocks.length - 2] : '';
  const isOfferBlock = /원|공구|특가|가격|한정/.test(offerCandidate);
  const offerText = isOfferBlock ? offerCandidate : (price ? `지금 공구가 ${price}` : '지금 특별한 가격으로');

  // Options data (from post or defaults) — supports both array [{name,price}] and object {name1,price1} formats
  const rawOpts = post.options || {};
  const optsArr = Array.isArray(rawOpts) ? rawOpts : [];
  const opt1Name = optsArr[0]?.name || rawOpts.name1 || '기본 구성';
  const opt1Price = optsArr[0]?.price || rawOpts.price1 || price || '-';
  const opt2Name = optsArr[1]?.name || rawOpts.name2 || '세트 구성';
  const opt2Price = optsArr[1]?.price || rawOpts.price2 || '-';
  const opt3Name = optsArr[2]?.name || rawOpts.name3 || '프리미엄 구성';
  const opt3Price = optsArr[2]?.price || rawOpts.price3 || '-';

  // Trust data
  const trustHeadline = post.trustHeadline || '실제 구매 후기';
  const review1 = post.reviews?.[0] || post.review1 || '정말 만족스럽습니다!';
  const review2 = post.reviews?.[1] || post.review2 || '재구매 의사 있어요.';
  const trustStat = post.trustStat || '만족도 98%';

  // Logistics data
  const shippingInfo = post.shipping || '주문 후 2-3일 이내 출고';
  const returnInfo = post.returnPolicy || '수령 후 7일 이내 가능';
  const exchangeInfo = post.exchange || '동일 조건 교환 가능';
  const logisticsNote = post.logisticsNote || '';

  // Howto data
  const steps = post.howtoSteps || [];
  const step1 = steps[0] || '프로필 링크 클릭';
  const step2 = steps[1] || '옵션 선택 후 주문';
  const step3 = steps[2] || '입금 확인 후 발송';
  const howtoNote = post.howtoNote || '';

  // Deadline
  const deadlineInfo = post.deadline || '';

  // Determine page sequence
  let sequence;
  if (slides && Array.isArray(slides) && slides.length >= 3) {
    sequence = slides;
  } else if (pageCount <= 5) {
    // Legacy 5-page mode
    if (pageCount <= 3) sequence = ['hook', 'why', 'cta'];
    else if (pageCount === 4) sequence = ['hook', 'why', 'offer', 'cta'];
    else sequence = ['hook', 'why', 'detail', 'offer', 'cta'];
  } else {
    sequence = IG_DEFAULT_SLIDES;
  }

  const pages = [];
  for (const type of sequence) {
    const data = { type };
    switch (type) {
      case 'hook':
        data.HOOK_TEXT = hookText;
        data.SUB_TEXT = benefit.length > 30 ? benefit.slice(0, 30) + '...' : benefit;
        break;
      case 'cover':
        data.COVER_HEADLINE = hookText;
        data.COVER_SUB = benefit.length > 50 ? benefit.slice(0, 50) + '...' : benefit;
        data.DEAL_PRICE = price || '특별가';
        break;
      case 'why':
        data.ITEM_1 = item1;
        data.ITEM_2 = item2;
        data.ITEM_3 = item3;
        data.SUB_TEXT = benefit;
        break;
      case 'options':
        data.OPTION_1_NAME = opt1Name;
        data.OPTION_1_PRICE = opt1Price;
        data.OPTION_2_NAME = opt2Name;
        data.OPTION_2_PRICE = opt2Price;
        data.OPTION_3_NAME = opt3Name;
        data.OPTION_3_PRICE = opt3Price;
        break;
      case 'trust':
        data.TRUST_HEADLINE = trustHeadline;
        data.REVIEW_1 = review1;
        data.REVIEW_2 = review2;
        data.TRUST_STAT = trustStat;
        break;
      case 'detail':
        data.DETAIL_TEXT = detailText;
        data.DETAIL_LEFT = benefit;
        data.DETAIL_RIGHT = detailText;
        break;
      case 'offer':
        data.OFFER_TEXT = offerText;
        data.ORIGINAL_PRICE = priceOriginal;
        data.DEAL_PRICE = price || '특별가';
        data.DISCOUNT_RATE = discountRate;
        data.DEADLINE_INFO = deadlineInfo;
        break;
      case 'logistics':
        data.SHIPPING_INFO = shippingInfo;
        data.RETURN_INFO = returnInfo;
        data.EXCHANGE_INFO = exchangeInfo;
        data.LOGISTICS_NOTE = logisticsNote;
        break;
      case 'howto':
        data.STEP_1 = step1;
        data.STEP_2 = step2;
        data.STEP_3 = step3;
        data.HOWTO_NOTE = howtoNote;
        break;
      case 'cta':
        data.CTA_TEXT = ctaBlock;
        data.CTA_SUB = product;
        data.CTA_MAIN = '프로필 링크 클릭';
        data.CTA_SUB_ACTION = '댓글로 문의하기';
        break;
    }
    pages.push(data);
  }
  return applyCharLimits(pages);
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || '';

async function generateAiBackground(palette, productName, outDir) {
  if (!OPENAI_API_KEY) return null;
  try {
    const prompt = `Minimal luxury beauty product background, soft ${palette.bg} tones, subtle fabric or marble texture, very blurred, no text, no objects, studio lighting, editorial skincare photography mood, warm ivory beige palette`;
    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'dall-e-3', prompt, n: 1, size: '1024x1024', response_format: 'b64_json' }),
    });
    if (!resp.ok) { console.error('[ig-bg] OpenAI error:', resp.status); return null; }
    const data = await resp.json();
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) return null;
    const bgPath = path.join(outDir, '_ai_background.png');
    writeFileSync(bgPath, Buffer.from(b64, 'base64'));
    return bgPath;
  } catch (err) {
    console.error('[ig-bg] AI background failed:', err.message);
    return null;
  }
}

function resolveBackground(palette, aiBgPath) {
  if (aiBgPath) {
    // CSS uses file:// path for local Playwright render
    const fileUrl = `file://${aiBgPath}`;
    return `url('${fileUrl}') center/cover no-repeat, linear-gradient(160deg, ${palette.bg} 0%, ${palette.accent}15 100%)`;
  }
  // Enhanced gradient fallback with subtle texture feel
  return `linear-gradient(160deg, ${palette.bg} 0%, ${palette.bg}EE 30%, ${palette.accent}12 70%, ${palette.bg}DD 100%)`;
}

async function generateCardImages(post, variant, options = {}) {
  const { layoutId, pageCount = 5, slides } = options;
  const layoutsData = loadIgLayouts();
  const layout = layoutsData.layouts.find((l) => l.id === layoutId) || layoutsData.layouts[0];
  if (!layout) throw new Error('No layouts available');

  const palette = layout.palette;
  const outDir = path.join(dataDir, 'ig_assets', post.id);
  mkdirSync(outDir, { recursive: true });

  // Optional product hero image (uploaded by owner) — embed as data URI (more reliable than file:// in setContent)
  const productCandidates = ['product.png', 'product.jpg', 'product.jpeg', 'product.webp'];
  let productImagePath = '';
  for (const fn of productCandidates) {
    const p = path.join(outDir, fn);
    if (existsSync(p)) { productImagePath = p; break; }
  }
  let productImageBg = 'none';
  if (productImagePath) {
    const ext = path.extname(productImagePath).toLowerCase();
    const mime = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    const b64 = readFileSync(productImagePath).toString('base64');
    productImageBg = `url('data:${mime};base64,${b64}')`;
  }

  const aiBgPath = await generateAiBackground(palette, post.productName, outDir);
  const background = resolveBackground(palette, aiBgPath);
  const pages = parseVariantToPages(variant, post, pageCount, slides);
  const templateDir = path.join(__dirname, 'public', 'admin', 'ig-templates');

  async function runOnce() {
    const browser = await getBrowser();
    const context = await browser.newContext({ viewport: { width: 1080, height: 1350 } });
    const cards = [];

    try {
      for (let i = 0; i < pages.length; i++) {
      const pg = pages[i];
      const layoutVariant = layout.pages[pg.type] || 'centered-big';
      const tplFile = path.join(templateDir, `card-${pg.type}-${layoutVariant}.html`);

      // Fallback to first available template for that page type if specific one missing
      let html;
      if (existsSync(tplFile)) {
        html = readFileSync(tplFile, 'utf8');
      } else {
        const fallbackFiles = readdirSync(templateDir).filter((f) => f.startsWith(`card-${pg.type}-`));
        if (fallbackFiles.length === 0) continue;
        html = readFileSync(path.join(templateDir, fallbackFiles[0]), 'utf8');
      }

      // Replace color/background placeholders
      html = html.replace(/\{\{BACKGROUND\}\}/g, background)
        .replace(/\{\{COLOR_BG\}\}/g, palette.bg)
        .replace(/\{\{COLOR_TEXT\}\}/g, palette.text)
        .replace(/\{\{COLOR_ACCENT\}\}/g, palette.accent)
        .replace(/\{\{COLOR_HIGHLIGHT\}\}/g, palette.highlight)
        .replace(/\{\{PRODUCT_IMAGE_BG\}\}/g, productImageBg)
        .replace(/\{\{PRODUCT_IMAGE_URL\}\}/g, productImageBg);

      // Replace content placeholders
      for (const [key, val] of Object.entries(pg)) {
        if (key === 'type') continue;
        html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), String(val));
      }

        const page = await context.newPage();
        await page.setContent(html, { waitUntil: 'networkidle' });
        const filename = `card-${i + 1}-${pg.type}.png`;
        const outPath = path.join(outDir, filename);
        await page.screenshot({ path: outPath, type: 'png' });
        await page.close();
        cards.push({ index: i, type: pg.type, filename, path: outPath });
      }
    } finally {
      await context.close();
    }

    return { cards, layoutId: layout.id, layoutName: layout.name, outDir };
  }

  try {
    return await runOnce();
  } catch (err) {
    const msg = String(err?.message || err);
    // Sometimes Playwright crashes/gets closed; retry once with a fresh browser.
    if (msg.includes('Target page, context or browser has been closed') || msg.includes('browser has been closed')) {
      console.error('[ig] generateCardImages: browser closed, retrying once');
      _browser = null;
      return await runOnce();
    }
    console.error('[ig] generateCardImages failed:', msg);
    throw err;
  }
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
  '.webp': 'image/webp',
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

function loadOwnerSessions() {
  ensureDataDir();
  return loadJson(ownerSessionsPath, { sessions: [] });
}

function saveOwnerSessions(db) {
  saveJson(ownerSessionsPath, db);
}

function getOwnerFromSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.owner_session;
  if (!token) return null;
  const db = loadOwnerSessions();
  const now = Date.now();
  const s = (db.sessions || []).find((x) => x.token === token);
  if (!s) return null;
  if (s.expiresAt && now > new Date(s.expiresAt).getTime()) return null;
  return { username: OWNER_USERNAME, token };
}

function checkOwnerAuth(req) {
  if (checkOwnerBasicAuth(req)) return true;
  return !!getOwnerFromSession(req);
}

function shouldRequireOwnerAuth(url) {
  // Vendor portal uses its own session auth.
  if (url.pathname.startsWith('/vendor')) return false;
  if (url.pathname.startsWith('/api/vendor')) return false;

  // Agent APIs use X-Agent-Key auth.
  if (url.pathname.startsWith('/api/agent/')) return false;

  // Owner session bootstrap endpoints/pages
  if (url.pathname === '/admin/login') return false;
  if (url.pathname === '/api/owner/login') return false;

  // Everything else is owner dashboard for now.
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  // --- CSRF: Origin check for state-changing methods ---
  if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method)) {
    const origin = req.headers.origin || '';
    const host = req.headers.host || '';
    const isDev = !process.env.NODE_ENV || process.env.NODE_ENV === 'development';
    const isLocalOrigin = isDev && (origin.includes('localhost') || origin.includes('127.0.0.1'));
    if (origin && !isLocalOrigin && !origin.includes(host.split(':')[0])) {
      return sendJson(res, 403, { error: 'csrf_origin_mismatch' });
    }
  }

  // Owner auth for non-vendor routes (basic OR cookie session)
  if (shouldRequireOwnerAuth(url)) {
    if (!checkOwnerAuth(req)) return unauthorizedBasic(res);
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
  // Owner login (cookie-based; avoids BasicAuth-in-URL fetch restrictions)
  // -------------------------
  if (url.pathname === '/admin/login') {
    return serveStatic(res, '/admin/login.html');
  }

  if (url.pathname === '/api/owner/logout' && req.method === 'POST') {
    const cookies = parseCookies(req);
    const token = cookies.owner_session;
    if (token) {
      const db = loadOwnerSessions();
      db.sessions = (db.sessions || []).filter((s) => s.token !== token);
      saveOwnerSessions(db);
    }
    setCookie(res, 'owner_session', '', { path: '/', httpOnly: true, sameSite: 'Strict', maxAge: 0 });
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/owner/login' && req.method === 'POST') {
    const clientIp = getClientIp(req);
    if (!checkRateLimit(clientIp)) {
      return sendJson(res, 429, { error: 'too_many_attempts', message: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해주세요.' });
    }
    const body = await readJsonBody(req);
    const user = String(body?.username || OWNER_USERNAME);
    const pass = String(body?.password || '');
    if (user !== OWNER_USERNAME || pass !== OWNER_PASSWORD) {
      recordLoginAttempt(clientIp, false);
      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'OWNER_LOGIN_FAILED', ip: clientIp });
      return sendJson(res, 401, { ok: false, error: 'bad_credentials' });
    }
    recordLoginAttempt(clientIp, true);

    const token = crypto.randomUUID();
    const db = loadOwnerSessions();
    const now = new Date().toISOString();
    const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(); // 24h
    // prune expired sessions
    db.sessions = (db.sessions || []).filter((s) => !s.expiresAt || Date.now() <= new Date(s.expiresAt).getTime());
    db.sessions.push({ token, createdAt: now, expiresAt });
    if (db.sessions.length > 200) db.sessions = db.sessions.slice(db.sessions.length - 200);
    saveOwnerSessions(db);

    setCookie(res, 'owner_session', token, { httpOnly: true, sameSite: 'Strict', path: '/', secure: isHttpsRequest(req), maxAge: 60 * 60 * 24 });

    auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'OWNER_LOGGED_IN', ip: getClientIp(req) });
    return sendJson(res, 200, { ok: true });
  }

  // -------------------------
  // Admin pages
  // -------------------------
  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    return serveStatic(res, '/admin/index.html');
  }

  if (url.pathname === '/admin/instagram' || url.pathname === '/admin/instagram/') {
    return serveStatic(res, '/admin/instagram.html');
  }

  if (url.pathname === '/admin/orders' || url.pathname === '/admin/orders/') {
    return serveStatic(res, '/admin/orders.html');
  }

  if (url.pathname === '/admin/vendors' || url.pathname === '/admin/vendors/') {
    return serveStatic(res, '/admin/vendors.html');
  }

  // -------------------------
  // Owner-only roadmap (private task list)
  // -------------------------
  if (url.pathname === '/api/admin/roadmap' && req.method === 'GET') {
    const db = loadRoadmap();
    return sendJson(res, 200, { ok: true, items: db.items || [] });
  }

  if (url.pathname === '/api/admin/roadmap' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const action = String(body?.action || '');
    const db = loadRoadmap();
    db.items = Array.isArray(db.items) ? db.items : [];
    const now = new Date().toISOString();

    if (action === 'add') {
      const text = String(body?.text || '').trim();
      if (!text) return sendJson(res, 400, { ok: false, error: 'missing_text' });
      const item = { id: crypto.randomUUID(), text, done: false, createdAt: now, updatedAt: now };
      db.items.push(item);
      saveRoadmap(db);
      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'ROADMAP_ADD', ip: getClientIp(req), meta: { id: item.id } });
      return sendJson(res, 200, { ok: true, item });
    }

    if (action === 'toggle') {
      const id = String(body?.id || '');
      if (!id) return sendJson(res, 400, { ok: false, error: 'missing_id' });
      db.items = db.items.map((it) => (it.id === id ? { ...it, done: !it.done, updatedAt: now } : it));
      saveRoadmap(db);
      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'ROADMAP_TOGGLE', ip: getClientIp(req), meta: { id } });
      return sendJson(res, 200, { ok: true });
    }

    if (action === 'remove') {
      const id = String(body?.id || '');
      if (!id) return sendJson(res, 400, { ok: false, error: 'missing_id' });
      db.items = db.items.filter((it) => it.id !== id);
      saveRoadmap(db);
      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'ROADMAP_REMOVE', ip: getClientIp(req), meta: { id } });
      return sendJson(res, 200, { ok: true });
    }

    return sendJson(res, 400, { ok: false, error: 'bad_action' });
  }

  // -------------------------
  // Admin: IG product image upload (for HOOK hero)
  // -------------------------
  if (url.pathname?.startsWith('/api/admin/ig/posts/') && url.pathname.endsWith('/product_image') && req.method === 'POST') {
    const parts = url.pathname.split('/').filter(Boolean); // api admin ig posts :id product_image
    const postId = parts[4];

    const ct = String(req.headers['content-type'] || '');
    const m = ct.match(/boundary=(?:(?:\"([^\"]+)\")|([^;]+))/i);
    const boundary = m ? (m[1] || m[2]) : null;
    if (!boundary) return sendJson(res, 400, { ok: false, error: 'missing_boundary' });

    try {
      const mp = await readMultipart(req, boundary, 15 * 1024 * 1024);
      const filePart = mp.find((p) => p.name === 'file');
      if (!filePart || !filePart.data || filePart.data.length === 0) return sendJson(res, 400, { ok: false, error: 'missing_file' });

      const posts = loadIgPosts();
      const idx = (posts.posts || []).findIndex((p) => p.id === postId);
      if (idx === -1) return sendJson(res, 404, { ok: false, error: 'not_found' });

      const outDir = path.join(dataDir, 'ig_assets', postId);
      mkdirSync(outDir, { recursive: true });

      const origName = String(filePart.filename || '').toLowerCase();
      const ext = origName.match(/\.(webp|png|jpe?g)$/)?.[0] || '';
      const allowedMimes = new Set(['image/jpeg', 'image/png', 'image/webp']);
      if (!ext && !allowedMimes.has(filePart.contentType)) {
        return sendJson(res, 400, { ok: false, error: 'invalid_format', detail: '지원하지 않는 이미지 형식입니다. JPG, PNG, WebP 파일만 업로드 가능합니다.' });
      }
      const finalExt = ext || { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[filePart.contentType] || '.jpg';
      let outName = `product${finalExt}`;
      // cleanup old variants
      for (const fn of ['product.webp','product.png','product.jpg','product.jpeg']) {
        try { if (existsSync(path.join(outDir, fn))) unlinkSync(path.join(outDir, fn)); } catch {}
      }
      const outPath = path.join(outDir, outName);
      writeFileSync(outPath, filePart.data);

      // webp sometimes fails to render as file:// background-image in headless screenshot; convert to png for stability
      if (finalExt === '.webp') {
        try {
          const pngPath = path.join(outDir, 'product.png');
          const py = `from PIL import Image\nimg=Image.open(r'''${outPath}''')\nimg.save(r'''${pngPath}''', format='PNG')\nprint('ok')`;
          const conv = spawnSync('python3', ['-c', py], { encoding: 'utf8' });
          if (conv.status === 0 && existsSync(pngPath)) {
            try { unlinkSync(outPath); } catch {}
            outName = 'product.png';
          }
        } catch {}
      }

      posts.posts[idx].assets = posts.posts[idx].assets || {};
      posts.posts[idx].assets.productImage = { filename: outName, uploadedAt: new Date().toISOString() };
      posts.posts[idx].updatedAt = new Date().toISOString();
      saveIgPosts(posts);

      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'IG_PRODUCT_IMAGE_UPLOADED', postId, ip: getClientIp(req) });
      return sendJson(res, 200, { ok: true });
    } catch (e) {
      return sendJson(res, 500, { ok: false, error: 'upload_failed', detail: String(e?.message || e) });
    }
  }

  if (url.pathname?.startsWith('/api/admin/ig/posts/') && url.pathname.includes('/product_image') && req.method === 'GET') {
    const parts = url.pathname.split('/').filter(Boolean); // api admin ig posts :id product_image
    const postId = parts[4];
    const dir = path.join(dataDir, 'ig_assets', postId);
    const candidates = ['product.webp', 'product.png', 'product.jpg', 'product.jpeg'];
    let imgPath = '';
    for (const fn of candidates) {
      const p = path.join(dir, fn);
      if (existsSync(p)) { imgPath = p; break; }
    }
    if (!imgPath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('not found');
    }
    return serveFile(res, imgPath);
  }

  // -------------------------
  // Admin APIs
  // -------------------------
  if (url.pathname === '/api/admin/state' && req.method === 'GET') {
    const vendors = loadVendors();
    const products = loadProducts();
    const mapping = loadMapping();
    return sendJson(res, 200, {
      vendors: (vendors.vendors || []).map((v) => ({ id: v.id, name: v.name, username: v.username })),
      products: products.products || [],
      mapping: mapping.mapping || [],
    });
  }

  if (url.pathname === '/api/admin/vendors' && req.method === 'GET') {
    const data = loadVendors();
    const vendors = (data.vendors || []).map((v) => ({ id: v.id, name: v.name, username: v.username, active: v.active !== false, createdAt: v.createdAt }));
    return sendJson(res, 200, { vendors });
  }

  if (url.pathname === '/api/admin/vendors' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const name = String(body?.name || '').trim();
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');

    if (!name || !username || password.length < 4) return sendJson(res, 400, { error: 'bad_input' });

    const data = loadVendors();
    if ((data.vendors || []).some((v) => v.username === username)) return sendJson(res, 409, { error: 'username_exists' });

    const pw = hashPassword(password);
    const vendor = { id: `vendor_${crypto.randomUUID()}`, name, username, password: pw, active: true, createdAt: new Date().toISOString() };
    data.vendors = (data.vendors || []).concat(vendor);
    saveJson(vendorsPath, data);

    auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'VENDOR_CREATED', ip: getClientIp(req), meta: { vendorId: vendor.id, name, username } });
    return sendJson(res, 200, { ok: true, vendor: { id: vendor.id, name: vendor.name, username: vendor.username } });
  }

  if (url.pathname === '/api/admin/products' && req.method === 'GET') {
    const data = loadProducts();
    return sendJson(res, 200, { products: data.products || [] });
  }

  if (url.pathname === '/api/admin/products_csv' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const csvText = String(body?.csv || '');
    if (!csvText) return sendJson(res, 400, { error: 'no_csv' });

    const lines = csvText.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) return sendJson(res, 400, { error: 'csv_too_small' });

    // naive CSV parse: split by comma, handle quoted commas minimally
    function parseLine(line) {
      const out = [];
      let cur = '';
      let q = false;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          if (q && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            q = !q;
          }
          continue;
        }
        if (ch === ',' && !q) {
          out.push(cur);
          cur = '';
          continue;
        }
        cur += ch;
      }
      out.push(cur);
      return out;
    }

    const header = parseLine(lines[0]).map((h) => String(h).replace(/^\uFEFF/, '').trim());
    const idxProductNo = header.findIndex((h) => h === '상품번호(스마트스토어)' || h === '상품번호');
    const idxName = header.findIndex((h) => h === '상품명');

    if (idxProductNo === -1 || idxName === -1) {
      return sendJson(res, 400, { error: 'missing_required_columns', required: ['상품번호(스마트스토어)', '상품명'] });
    }

    const products = [];
    for (const line of lines.slice(1)) {
      const cols = parseLine(line);
      const productNo = String(cols[idxProductNo] || '').trim();
      const productName = String(cols[idxName] || '').trim();
      if (!productNo || !productName) continue;
      products.push({ productNo, productName });
    }

    const existing = loadProducts();
    const map = new Map((existing.products || []).map((p) => [p.productNo, p]));
    for (const p of products) map.set(p.productNo, p);
    existing.products = Array.from(map.values());
    saveProducts(existing);

    return sendJson(res, 200, { ok: true, count: products.length, total: existing.products.length });
  }

  if (url.pathname === '/api/admin/mapping' && req.method === 'GET') {
    const vendorFilter = url.searchParams.get('vendorId');
    const m = loadMapping();
    let list = m.mapping || [];
    if (vendorFilter) list = list.filter((x) => x.vendorId === vendorFilter);
    return sendJson(res, 200, { mapping: list });
  }

  if (url.pathname === '/api/admin/mapping' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const vendorId = String(body?.vendorId || '');
    const productNos = Array.isArray(body?.productNos) ? body.productNos.map(String) : [];

    if (!vendorId) return sendJson(res, 400, { error: 'bad_input' });

    const m = loadMapping();
    // Check for conflicts: productNo already mapped to a DIFFERENT vendor
    const otherMappings = (m.mapping || []).filter((x) => x.vendorId !== vendorId);
    const otherMap = new Map(otherMappings.map((x) => [x.productNo, x.vendorId]));
    const conflicts = [];
    for (const pn of productNos) {
      if (otherMap.has(pn)) {
        const conflictVendorId = otherMap.get(pn);
        const vendors = loadVendors();
        const cv = (vendors.vendors || []).find((v) => v.id === conflictVendorId);
        conflicts.push({ productNo: pn, existingVendor: cv?.name || conflictVendorId });
      }
    }
    // If conflicts and not force, reject
    if (conflicts.length > 0 && !body?.force) {
      return sendJson(res, 409, { error: 'mapping_conflict', conflicts, message: '다른 거래처에 이미 매핑된 상품이 있습니다. force:true로 덮어쓰기 가능합니다.' });
    }
    // If force, remove conflicting mappings from other vendors
    if (conflicts.length > 0 && body?.force) {
      const conflictPNs = new Set(conflicts.map((c) => c.productNo));
      m.mapping = (m.mapping || []).filter((x) => !(x.vendorId !== vendorId && conflictPNs.has(x.productNo)));
    }

    m.mapping = (m.mapping || []).filter((x) => x.vendorId !== vendorId);
    for (const pn of productNos) {
      if (!pn) continue;
      m.mapping.push({ vendorId, productNo: pn });
    }
    saveMapping(m);
    auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'MAPPING_UPDATED', ip: getClientIp(req), meta: { vendorId, count: productNos.length, conflicts: conflicts.length } });
    return sendJson(res, 200, { ok: true, count: productNos.length });
  }

  if (url.pathname === '/api/admin/orders_stats' && req.method === 'GET') {
    const orders = loadOrders();
    const list = orders.orders || [];
    const unassigned = list.filter((o) => !o.vendorId);
    return sendJson(res, 200, { ok: true, total: list.length, unassigned: unassigned.length });
  }

  if (url.pathname === '/api/admin/orders_unassigned' && req.method === 'GET') {
    const orders = loadOrders();
    const list = (orders.orders || []).filter((o) => !o.vendorId);
    return sendJson(res, 200, { ok: true, orders: list, count: list.length });
  }

  if (url.pathname === '/api/admin/orders_assign' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const vendorId = String(body?.vendorId || '').trim();
    const orderIds = Array.isArray(body?.orderIds) ? body.orderIds.map(String) : [];
    if (!vendorId || orderIds.length === 0) return sendJson(res, 400, { error: 'bad_input' });

    const orders = loadOrders();
    const set = new Set(orderIds);
    let updated = 0;
    const now = new Date().toISOString();

    orders.orders = (orders.orders || []).map((o) => {
      const id = String(o.id || o.productOrderNo || '');
      if (set.has(id)) {
        updated++;
        const cur = getOrderStatus(o);
        if (cur === 'new' || !o.vendorId) {
          transitionOrder(o, 'assigned', { actor: `owner:${OWNER_USERNAME}`, reason: 'admin_assign' });
        }
        o.vendorId = vendorId;
        o.updatedAt = now;
        return o;
      }
      return o;
    });

    saveOrders(orders);
    auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'ADMIN_ORDERS_ASSIGNED', ip: getClientIp(req), meta: { vendorId, updated } });
    return sendJson(res, 200, { ok: true, updated });
  }

  // -------------------------
  // Admin: SmartStore order XLSX import (multipart)
  // -------------------------
  if (url.pathname === '/api/admin/orders_xlsx_import' && req.method === 'POST') {
    const ct = String(req.headers['content-type'] || '');
    const m = ct.match(/boundary=(?:(?:\"([^\"]+)\")|([^;]+))/i);
    const boundary = m ? (m[1] || m[2]) : null;
    if (!boundary) return sendJson(res, 400, { error: 'missing_boundary' });

    try {
      const parts = await readMultipart(req, boundary);
      const pwPart = parts.find((p) => p.name === 'password');
      const filePart = parts.find((p) => p.name === 'file');
      const password = pwPart ? pwPart.data.toString('utf8').trim() : '';
      if (!password) return sendJson(res, 400, { error: 'missing_password' });
      if (!filePart || !filePart.data || filePart.data.length === 0) return sendJson(res, 400, { error: 'missing_file' });

      const uploadsDir = path.join(dataDir, 'uploads');
      ensureDir(uploadsDir);
      const tmpName = `smartstore.${Date.now()}.${crypto.randomUUID()}.xlsx`;
      const tmpPath = path.join(uploadsDir, tmpName);
      writeFileSync(tmpPath, filePart.data);

      const scriptPath = path.join(__dirname, 'scripts', 'parse_smartstore_orders.py');
      const run = spawnSync('python3', [scriptPath], {
        env: {
          ...process.env,
          SMARTSTORE_XLSX_PASSWORD: password,
          SMARTSTORE_XLSX_PATH: tmpPath,
        },
        encoding: 'utf8',
        maxBuffer: 20 * 1024 * 1024,
      });

      if (run.status !== 0) {
        auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'ADMIN_ORDERS_IMPORT_FAILED', ip: getClientIp(req), meta: { code: run.status, stderr: (run.stderr || '').slice(0, 2000) } });
        return sendJson(res, 500, { error: 'parse_failed', stderr: (run.stderr || '').slice(0, 2000) });
      }

      const parsed = safeJsonParse(run.stdout || '', null);
      if (!parsed || !Array.isArray(parsed.items)) return sendJson(res, 500, { error: 'bad_parse_output' });

      const mapping = loadMapping();
      const productToVendor = new Map((mapping.mapping || []).map((m2) => [String(m2.productNo), String(m2.vendorId)]));

      const orders = loadOrders();
      const byId = new Map((orders.orders || []).map((o) => [String(o.id), o]));
      let imported = 0;
      let assigned = 0;
      let unassigned = 0;
      const now = new Date().toISOString();

      for (const it of parsed.items) {
        const id = String(it.product_order_no);
        const productNo = String(it.product_no || '');
        const vendorId = productToVendor.get(productNo) || null;
        if (vendorId) assigned++; else unassigned++;

        const row = {
          id,
          productOrderNo: id,
          orderNo: String(it.order_no || ''),
          productNo,
          productName: it.product_name || '',
          optionInfo: it.option_info || '',
          qty: Number(it.qty || 0),
          recipientName: it.recipient_name || '',
          recipientPhone: it.recipient_phone || null,
          recipientAddress: it.recipient_address || null,
          vendorId,
          status: vendorId ? 'assigned' : 'new',
          carrier: null,
          trackingNumber: '',
          createdAt: byId.has(id) ? byId.get(id).createdAt : now,
          updatedAt: now,
          _raw: {
            orderedAt: it.ordered_at || null,
            orderStatus: it.order_status || null,
            shippingAttr: it.shipping_attr || null,
            claimStatus: it.claim_status || null,
            buyerName: it.buyer_name || null,
            buyerId: it.buyer_id || null,
          },
        };

        if (byId.has(id)) {
          // overwrite mutable fields; keep tracking info if already entered
          const prev = byId.get(id);
          row.carrier = prev.carrier || row.carrier;
          row.trackingNumber = prev.trackingNumber || row.trackingNumber;
        }

        byId.set(id, row);
        imported++;
      }

      orders.orders = Array.from(byId.values());
      saveOrders(orders);

      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'ADMIN_ORDERS_IMPORTED', ip: getClientIp(req), meta: { imported, assigned, unassigned } });
      return sendJson(res, 200, { ok: true, imported, assigned, unassigned, totalAfter: orders.orders.length });
    } catch (e) {
      return sendJson(res, 500, { error: 'import_exception', message: String(e?.message || e) });
    }
  }

  if (url.pathname === '/api/admin/seed_order' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const vendorId = String(body?.vendorId || '');
    if (!vendorId) return sendJson(res, 400, { error: 'need_vendorId' });

    // products.csv 미업로드 상태에서도 UI 확인/테스트 가능하게 기본 더미 제공
    const products = loadProducts();
    const list = products.products || [];
    const pick = list.length
      ? list[Math.floor(Math.random() * list.length)]
      : { productNo: 'MOCK-001', productName: '테스트상품(더미)' };

    const orders = loadOrders();
    const now = new Date().toISOString();
    const id = String(Date.now());
    orders.orders = (orders.orders || []).concat({
      id,
      productOrderNo: id,
      orderNo: String(Date.now()),
      productNo: pick.productNo,
      productName: pick.productName,
      optionInfo: '옵션: 기본',
      qty: 1,
      recipientName: '홍길동',
      recipientPhone: '01012341234',
      recipientAddress: '서울시 강남구 테헤란로 123, 101동 1004호',
      vendorId,
      carrier: 'hanjin',
      trackingNumber: '123456789012',
      createdAt: now,
      updatedAt: now,
    });
    saveOrders(orders);

    return sendJson(res, 200, { ok: true, orderId: id });
  }

  // -------------------------
  // Admin: SmartStore bulk shipping upload Excel (4 columns)
  // -------------------------
  if (url.pathname === '/api/admin/shipping_export.xlsx' && req.method === 'GET') {
    const qs = url.searchParams;
    const chunk = Math.max(0, Number(qs.get('chunk') || 0) || 0);
    const size = Math.min(5000, Math.max(1, Number(qs.get('size') || 2000) || 2000));
    const deliveryMethod = String(qs.get('method') || DEFAULT_DELIVERY_METHOD);
    const includeExported = qs.get('includeExported') === 'true';

    const orders = loadOrders();
    const all = (orders.orders || []).filter((o) => {
      const tn = String(o.trackingNumber || o.tracking?.number || '').trim();
      const carrier = String(o.carrier || o.tracking?.carrier || '').trim();
      if (tn.length === 0 || carrier.length === 0) return false;
      // Exclude hold/cancelled orders
      if (o.status === 'hold' || o.status === 'cancelled') return false;
      // Exclude already exported unless explicitly requested
      if (!includeExported && o.exportedAt) return false;
      return true;
    });

    // Mark exported orders with timestamp
    const now = new Date().toISOString();
    const start = chunk * size;
    const rows = all.slice(start, start + size);
    const exportedIds = new Set(rows.map((o) => o.id || o.productOrderNo));
    orders.orders = (orders.orders || []).map((o) => {
      const id = o.id || o.productOrderNo;
      if (exportedIds.has(id)) return { ...o, exportedAt: now, status: o.status || 'exported' };
      return o;
    });
    saveOrders(orders);

    const sheetRows = [
      ['상품주문번호', '배송방법', '택배사', '송장번호'],
      ...rows.map((o) => {
        const carrierKey = String(o.carrier || o.tracking?.carrier || '').trim();
        const carrierLabel = CARRIER_LABEL[carrierKey] || carrierKey;
        const tn = String(o.trackingNumber || o.tracking?.number || '');
        return [String(o.productOrderNo || o.id || ''), deliveryMethod, carrierLabel, tn];
      }),
    ];

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(sheetRows);
    XLSX.utils.book_append_sheet(wb, ws, '발송처리');

    const out = XLSX.write(wb, { bookType: 'xlsx', type: 'buffer' });

    auditLog({
      actorType: 'owner',
      actorId: OWNER_USERNAME,
      action: 'ADMIN_SHIPPING_EXPORT',
      ip: getClientIp(req),
      meta: { totalEligible: all.length, chunk, size, exported: rows.length },
    });

    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="shipping_export.chunk${chunk}.xlsx"`,
    });
    return res.end(out);
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
    const clientIp = getClientIp(req);
    if (!checkRateLimit(clientIp)) {
      return sendJson(res, 429, { error: 'too_many_attempts', message: '로그인 시도가 너무 많습니다. 15분 후 다시 시도해주세요.' });
    }
    const body = await readJsonBody(req);
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');

    const vendor = getVendorByUsername(username);
    if (!vendor || !verifyPassword(password, vendor.password)) {
      recordLoginAttempt(clientIp, false);
      auditLog({ actorType: 'vendor', actorId: username || null, action: 'VENDOR_LOGIN_FAILED', ip: clientIp });
      return sendJson(res, 401, { error: 'bad_credentials' });
    }
    // Check if vendor is deactivated
    if (vendor.active === false) {
      return sendJson(res, 403, { error: 'vendor_deactivated', message: '비활성화된 계정입니다.' });
    }
    recordLoginAttempt(clientIp, true);

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
      sameSite: 'Strict',
      path: '/',
      secure: isHttpsRequest(req),
      maxAge: 60 * 60 * 24 * 14,
    });

    auditLog({ actorType: 'vendor', actorId: vendor.id, action: 'VENDOR_LOGIN', ip: getClientIp(req) });

    return sendJson(res, 200, { ok: true, vendor: { id: vendor.id, name: vendor.name, username: vendor.username } });
  }

  if (url.pathname === '/api/vendor/logout' && req.method === 'POST') {
    const vendor = getVendorFromSession(req);
    const cookies = parseCookies(req);
    const token = cookies.vendor_session;
    if (token) {
      const sessions = loadVendorSessions();
      sessions.sessions = (sessions.sessions || []).filter((s) => s.token !== token);
      saveVendorSessions(sessions);
    }
    auditLog({ actorType: 'vendor', actorId: vendor?.id || null, action: 'VENDOR_LOGOUT', ip: getClientIp(req) });
    setCookie(res, 'vendor_session', '', { path: '/', httpOnly: true, sameSite: 'Lax', maxAge: 0 });
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/vendor/orders' && req.method === 'GET') {
    const vendor = requireVendor(req, res);
    if (!vendor) return;
    const mask = url.searchParams.get('mask') === '1';

    const data = loadOrders();
    let orders = (data.orders || []).filter((o) => o.vendorId === vendor.id);

    // normalize for vendor UI compatibility (legacy fields)
    orders = orders.map((o) => {
      const carrier = o.carrier || o.tracking?.carrier || null;
      const trackingNumber = o.trackingNumber || o.tracking?.number || '';
      const out = { ...o, carrier, trackingNumber };
      if (mask) {
        out.recipientPhone = maskPhone(out.recipientPhone);
        out.recipientAddress = maskAddress(out.recipientAddress);
      }
      return out;
    });

    // newest first (by createdAt if present)
    orders.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));

    auditLog({ actorType: 'vendor', actorId: vendor.id, action: 'VIEW_ORDERS', count: orders.length, ip: getClientIp(req) });

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

    auditLog({ actorType: 'vendor', actorId: vendor.id, action: 'DOWNLOAD_VENDOR_ORDERS_XLSX', ip: getClientIp(req) });

    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="orders-${vendor.username}.xlsx"`,
    });
    return res.end(out.stdout);
  }

  if (url.pathname === '/api/vendor/orders/bulk_tracking' && req.method === 'POST') {
    const vendor = requireVendor(req, res);
    if (!vendor) return;
    const body = await readJsonBody(req);
    const items = body?.items;
    if (!Array.isArray(items) || items.length === 0) return sendJson(res, 400, { error: 'items required (array of {orderId, carrier, number})' });
    if (items.length > 200) return sendJson(res, 400, { error: 'max 200 items per request' });

    const db = loadOrders();
    const results = [];
    let success = 0;
    let failed = 0;

    for (const it of items) {
      const oid = String(it.orderId || '');
      const carrier = String(it.carrier || 'etc');
      const number = it.number;
      const vt = validateTracking({ carrier, number });

      if (!vt.ok) { results.push({ orderId: oid, ok: false, error: vt.error }); failed++; continue; }

      const idx = (db.orders || []).findIndex((o) => o.id === oid && o.vendorId === vendor.id);
      if (idx === -1) { results.push({ orderId: oid, ok: false, error: 'not_found' }); failed++; continue; }

      const tr = transitionOrder(db.orders[idx], 'shipped', { actor: `vendor:${vendor.id}`, reason: 'bulk_tracking' });
      if (!tr.ok) { results.push({ orderId: oid, ok: false, error: tr.error }); failed++; continue; }
      const now = new Date().toISOString();
      db.orders[idx].tracking = { carrier, number: vt.number, updatedAt: now };
      db.orders[idx].carrier = carrier;
      db.orders[idx].trackingNumber = vt.number;
      results.push({ orderId: oid, ok: true });
      success++;
    }

    saveOrders(db);
    auditLog({ actorType: 'vendor', actorId: vendor.id, action: 'BULK_TRACKING', success, failed, ip: getClientIp(req) });
    return sendJson(res, 200, { ok: true, success, failed, results });
  }

  if (url.pathname?.startsWith('/api/vendor/orders/') && req.method === 'POST') {
    const vendor = requireVendor(req, res);
    if (!vendor) return;

    const parts = url.pathname.split('/').filter(Boolean); // api vendor orders :id ...
    const orderId = parts[3];
    const action = parts[4];

    // Hold action
    if (action === 'hold') {
      const body = await readJsonBody(req);
      const reason = String(body?.reason || 'vendor_unavailable');
      const db = loadOrders();
      const idx = (db.orders || []).findIndex((o) => o.id === orderId && o.vendorId === vendor.id);
      if (idx === -1) return sendJson(res, 404, { error: 'not_found' });
      const tr = transitionOrder(db.orders[idx], 'hold', { actor: `vendor:${vendor.id}`, reason });
      if (!tr.ok) return sendJson(res, 409, { error: tr.error, prev: tr.prev, next: tr.next });
      db.orders[idx].holdReason = reason;
      db.orders[idx].holdAt = new Date().toISOString();
      saveOrders(db);
      auditLog({ actorType: 'vendor', actorId: vendor.id, action: 'ORDER_HOLD', orderId, reason, ip: getClientIp(req) });
      return sendJson(res, 200, { ok: true, order: db.orders[idx] });
    }

    if (action !== 'tracking') return sendJson(res, 404, { error: 'not_found' });

    const body = await readJsonBody(req);
    const carrier = String(body?.carrier || 'etc');
    const number = body?.number;

    const v = validateTracking({ carrier, number });
    if (!v.ok) return sendJson(res, 400, { error: v.error });

    const db = loadOrders();
    const idx = (db.orders || []).findIndex((o) => o.id === orderId && o.vendorId === vendor.id);
    if (idx === -1) return sendJson(res, 404, { error: 'not_found' });

    const tr = transitionOrder(db.orders[idx], 'shipped', { actor: `vendor:${vendor.id}`, reason: 'input_tracking' });
    if (!tr.ok) return sendJson(res, 409, { error: tr.error, prev: tr.prev, next: tr.next });

    const now = new Date().toISOString();
    db.orders[idx].tracking = {
      carrier,
      number: v.number,
      updatedAt: now,
    };
    // legacy top-level fields (used by vendor UI + shipping export)
    db.orders[idx].carrier = carrier;
    db.orders[idx].trackingNumber = v.number;

    saveOrders(db);
    auditLog({ actorType: 'vendor', actorId: vendor.id, action: 'INPUT_TRACKING', orderId, carrier, ip: getClientIp(req) });
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

    auditLog({ actorType: 'vendor', actorId: vendor.id, action: 'DOWNLOAD_VENDOR_ORDERS_XLSX_ALT', ip: getClientIp(req) });

    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename="orders-${vendor.id}.xlsx"`,
    });
    return res.end(buf);
  }

  // -------------------------
  // Admin: Vendor CRUD (update, deactivate, reset password)
  // -------------------------
  if (url.pathname?.match(/^\/api\/admin\/vendors\/[^/]+$/) && req.method === 'PUT') {
    const vendorId = url.pathname.split('/').pop();
    const body = await readJsonBody(req);
    const data = loadVendors();
    const idx = (data.vendors || []).findIndex((v) => v.id === vendorId);
    if (idx === -1) return sendJson(res, 404, { error: 'vendor_not_found' });

    if (body?.name) data.vendors[idx].name = String(body.name).trim();
    if (body?.username) {
      const newUsername = String(body.username).trim();
      if ((data.vendors || []).some((v, i) => i !== idx && v.username === newUsername)) return sendJson(res, 409, { error: 'username_exists' });
      data.vendors[idx].username = newUsername;
    }
    if (body?.active !== undefined) {
      data.vendors[idx].active = !!body.active;
      // If deactivating, kill all sessions
      if (!body.active) {
        const sessions = loadVendorSessions();
        sessions.sessions = (sessions.sessions || []).filter((s) => s.vendorId !== vendorId);
        saveVendorSessions(sessions);
      }
    }
    data.vendors[idx].updatedAt = new Date().toISOString();
    saveJson(vendorsPath, data);
    auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'VENDOR_UPDATED', ip: getClientIp(req), meta: { vendorId, changes: Object.keys(body || {}) } });
    return sendJson(res, 200, { ok: true, vendor: { id: data.vendors[idx].id, name: data.vendors[idx].name, username: data.vendors[idx].username, active: data.vendors[idx].active } });
  }

  if (url.pathname?.match(/^\/api\/admin\/vendors\/[^/]+\/reset_password$/) && req.method === 'POST') {
    const vendorId = url.pathname.split('/').slice(-2, -1)[0];
    const data = loadVendors();
    const idx = (data.vendors || []).findIndex((v) => v.id === vendorId);
    if (idx === -1) return sendJson(res, 404, { error: 'vendor_not_found' });

    // Generate temp password
    const tempPw = crypto.randomBytes(4).toString('hex'); // 8 chars
    data.vendors[idx].password = hashPassword(tempPw);
    data.vendors[idx].updatedAt = new Date().toISOString();
    saveJson(vendorsPath, data);

    // Kill all sessions for this vendor
    const sessions = loadVendorSessions();
    sessions.sessions = (sessions.sessions || []).filter((s) => s.vendorId !== vendorId);
    saveVendorSessions(sessions);

    auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'VENDOR_PASSWORD_RESET', ip: getClientIp(req), meta: { vendorId } });
    return sendJson(res, 200, { ok: true, tempPassword: tempPw });
  }

  // -------------------------
  // Vendor: Change own password
  // -------------------------
  if (url.pathname === '/api/vendor/change_password' && req.method === 'POST') {
    const vendor = requireVendor(req, res);
    if (!vendor) return;
    const body = await readJsonBody(req);
    const currentPw = String(body?.currentPassword || '');
    const newPw = String(body?.newPassword || '');
    if (newPw.length < 4) return sendJson(res, 400, { error: 'password_too_short', message: '비밀번호는 4자 이상이어야 합니다.' });

    const data = loadVendors();
    const idx = (data.vendors || []).findIndex((v) => v.id === vendor.id);
    if (idx === -1) return sendJson(res, 404, { error: 'vendor_not_found' });
    if (!verifyPassword(currentPw, data.vendors[idx].password)) return sendJson(res, 401, { error: 'wrong_password' });

    data.vendors[idx].password = hashPassword(newPw);
    data.vendors[idx].updatedAt = new Date().toISOString();
    saveJson(vendorsPath, data);
    auditLog({ actorType: 'vendor', actorId: vendor.id, action: 'VENDOR_PASSWORD_CHANGED', ip: getClientIp(req) });
    return sendJson(res, 200, { ok: true });
  }

  // -------------------------
  // Vendor: Mark order as hold (품절/불가)
  // -------------------------
  // -------------------------
  // Agent APIs (for OpenClaw integration)
  // -------------------------
  const AGENT_KEY = process.env.AGENT_API_KEY || 'openclaw-agent-key';

  function checkAgentAuth(req) {
    const key = req.headers['x-agent-key'];
    return key === AGENT_KEY;
  }

  if (url.pathname === '/api/agent/new_orders' && req.method === 'GET') {
    if (!checkAgentAuth(req)) return sendJson(res, 401, { error: 'agent_unauthorized' });
    const orders = loadOrders();
    const pending = (orders.orders || []).filter((o) => !o.vendorId || getOrderStatus(o) === 'new');
    return sendJson(res, 200, { orders: pending, count: pending.length });
  }

  if (url.pathname === '/api/agent/pending_tracking' && req.method === 'GET') {
    if (!checkAgentAuth(req)) return sendJson(res, 401, { error: 'agent_unauthorized' });
    const orders = loadOrders();
    const pending = (orders.orders || []).filter((o) => {
      if (!o.vendorId) return false;
      const tn = String(o.trackingNumber || o.tracking?.number || '').trim();
      return tn.length === 0 && o.status !== 'hold' && o.status !== 'cancelled';
    });
    return sendJson(res, 200, { orders: pending, count: pending.length });
  }

  if (url.pathname === '/api/agent/holds' && req.method === 'GET') {
    if (!checkAgentAuth(req)) return sendJson(res, 401, { error: 'agent_unauthorized' });
    const orders = loadOrders();
    const holds = (orders.orders || []).filter((o) => o.status === 'hold');
    return sendJson(res, 200, { orders: holds, count: holds.length });
  }

  if (url.pathname === '/api/agent/daily_summary' && req.method === 'GET') {
    if (!checkAgentAuth(req)) return sendJson(res, 401, { error: 'agent_unauthorized' });
    const orders = loadOrders();
    const all = orders.orders || [];
    const today = new Date().toISOString().slice(0, 10);
    const todayOrders = all.filter((o) => (o.createdAt || '').startsWith(today));
    const noTracking = all.filter((o) => o.vendorId && !o.trackingNumber && !o.tracking?.number && o.status !== 'hold');
    const holds = all.filter((o) => o.status === 'hold');
    const shipped = all.filter((o) => o.status === 'shipped');
    const exported = all.filter((o) => o.exportedAt);
    return sendJson(res, 200, {
      date: today,
      total: all.length,
      todayNew: todayOrders.length,
      awaitingTracking: noTracking.length,
      holds: holds.length,
      shipped: shipped.length,
      exported: exported.length,
    });
  }

  if (url.pathname === '/api/agent/dispatch_ready' && req.method === 'POST') {
    if (!checkAgentAuth(req)) return sendJson(res, 401, { error: 'agent_unauthorized' });
    const orders = loadOrders();
    const ready = (orders.orders || []).filter((o) => {
      const tn = String(o.trackingNumber || o.tracking?.number || '').trim();
      const carrier = String(o.carrier || o.tracking?.carrier || '').trim();
      return tn.length > 0 && carrier.length > 0 && !o.exportedAt && o.status !== 'hold' && o.status !== 'cancelled';
    });
    auditLog({ actorType: 'agent', action: 'DISPATCH_READY_CHECK', count: ready.length });
    return sendJson(res, 200, { ready: ready.length, orders: ready.map((o) => ({ id: o.id, productOrderNo: o.productOrderNo, carrier: o.carrier, trackingNumber: o.trackingNumber })) });
  }

  if (url.pathname === '/api/agent/alert' && req.method === 'POST') {
    if (!checkAgentAuth(req)) return sendJson(res, 401, { error: 'agent_unauthorized' });
    const body = await readJsonBody(req);
    const alertType = String(body?.type || 'info');
    const message = String(body?.message || '');
    auditLog({ actorType: 'agent', action: 'ALERT', alertType, message });
    return sendJson(res, 200, { ok: true, logged: true });
  }

  if (url.pathname === '/api/agent/request_ship' && req.method === 'POST') {
    if (!checkAgentAuth(req)) return sendJson(res, 401, { error: 'agent_unauthorized' });
    const orders = loadOrders();
    const queue = loadQueue();

    // Collect already-queued order IDs
    const activeStates = new Set(['pending', 'approved', 'running']);
    const queuedOrderIds = new Set();
    for (const item of queue.items || []) {
      if (item.type === 'smartstore_ship_batch' && activeStates.has(item.state)) {
        for (const oid of (item.payload?.orderIds || [])) queuedOrderIds.add(oid);
      }
    }

    const ready = (orders.orders || []).filter((o) => {
      if (queuedOrderIds.has(o.id)) return false;
      const tn = String(o.trackingNumber || o.tracking?.number || '').trim();
      const carrier = String(o.carrier || o.tracking?.carrier || '').trim();
      return tn.length > 0 && carrier.length > 0 && !o.exportedAt && o.status !== 'hold' && o.status !== 'cancelled';
    });

    if (ready.length === 0) return sendJson(res, 200, { ok: true, created: false, message: 'no dispatch_ready orders' });

    const batchId = `ship-batch-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    queue.items.push({
      id: batchId,
      type: 'smartstore_ship_batch',
      state: 'pending',
      source: 'agent',
      payload: { action: 'ship', orderIds: ready.map((o) => o.id), orderCount: ready.length, summary: `${ready.length}건 발송처리 (agent)` },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    saveQueue(queue);
    auditLog({ actorType: 'agent', action: 'REQUEST_SHIP', batchId, orderCount: ready.length });
    return sendJson(res, 200, { ok: true, created: true, batchId, orderCount: ready.length });
  }

  if (url.pathname === '/api/agent/request_confirm' && req.method === 'POST') {
    if (!checkAgentAuth(req)) return sendJson(res, 401, { error: 'agent_unauthorized' });
    const orders = loadOrders();
    const queue = loadQueue();

    const activeStates = new Set(['pending', 'approved', 'running']);
    const queuedOrderIds = new Set();
    for (const item of queue.items || []) {
      if (item.type === 'smartstore_confirm_batch' && activeStates.has(item.state)) {
        for (const oid of (item.payload?.orderIds || [])) queuedOrderIds.add(oid);
      }
    }

    const ready = (orders.orders || []).filter((o) => {
      if (queuedOrderIds.has(o.id)) return false;
      return o.status === 'exported' && o.naverShippedAt && !o.naverConfirmedAt;
    });

    if (ready.length === 0) return sendJson(res, 200, { ok: true, created: false, message: 'no confirm_ready orders' });

    const batchId = `confirm-batch-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    queue.items.push({
      id: batchId,
      type: 'smartstore_confirm_batch',
      state: 'pending',
      source: 'agent',
      payload: { action: 'confirm', orderIds: ready.map((o) => o.id), orderCount: ready.length, summary: `${ready.length}건 구매확인 (agent)` },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    saveQueue(queue);
    auditLog({ actorType: 'agent', action: 'REQUEST_CONFIRM', batchId, orderCount: ready.length });
    return sendJson(res, 200, { ok: true, created: true, batchId, orderCount: ready.length });
  }

  if (url.pathname === '/api/agent/automation_status' && req.method === 'GET') {
    if (!checkAgentAuth(req)) return sendJson(res, 401, { error: 'agent_unauthorized' });
    const queue = loadQueue();
    const pendingBatches = (queue.items || []).filter((it) =>
      (it.type === 'smartstore_ship_batch' || it.type === 'smartstore_confirm_batch') && it.state === 'pending'
    ).length;
    return sendJson(res, 200, {
      automationEnabled,
      naverLive: NAVER_LIVE,
      lastSyncAt,
      lastSyncResult,
      pendingBatches,
    });
  }

  // -------------------------
  // Admin: Orders list with status filter
  // -------------------------
  if (url.pathname === '/api/admin/orders' && req.method === 'GET') {
    const statusFilter = url.searchParams.get('status');
    const vendorFilter = url.searchParams.get('vendorId');
    const search = (url.searchParams.get('q') || '').toLowerCase();
    const page = Math.max(1, Number(url.searchParams.get('page') || 1));
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const orders = loadOrders();
    let list = orders.orders || [];
    if (statusFilter) list = list.filter((o) => o.status === statusFilter);
    if (vendorFilter) list = list.filter((o) => o.vendorId === vendorFilter);
    if (search) list = list.filter((o) => (o.productName || '').toLowerCase().includes(search) || (o.recipientName || '').toLowerCase().includes(search) || (o.productOrderNo || '').includes(search));
    list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const total = list.length;
    const totalPages = Math.ceil(total / limit);
    const offset = (page - 1) * limit;
    const paged = list.slice(offset, offset + limit);
    return sendJson(res, 200, { orders: paged, total, page, totalPages, limit });
  }

  // Admin: Resolve hold
  if (url.pathname?.match(/^\/api\/admin\/orders\/[^/]+\/resolve$/) && req.method === 'POST') {
    const orderId = url.pathname.split('/').slice(-2, -1)[0];
    const body = await readJsonBody(req);
    const newStatus = String(body?.status || 'assigned');
    const db = loadOrders();
    const idx = (db.orders || []).findIndex((o) => o.id === orderId);
    if (idx === -1) return sendJson(res, 404, { error: 'not_found' });
    const tr = transitionOrder(db.orders[idx], newStatus, { actor: `owner:${OWNER_USERNAME}`, reason: body?.reason || 'resolve_hold' });
    if (!tr.ok) return sendJson(res, 409, { error: tr.error, prev: tr.prev, next: tr.next });
    db.orders[idx].holdReason = null;
    db.orders[idx].holdAt = null;
    saveOrders(db);
    auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'ORDER_HOLD_RESOLVED', orderId, newStatus, ip: getClientIp(req) });
    return sendJson(res, 200, { ok: true });
  }

  // -------------------------
  // Phase 2B: Settlement (정산) API
  // -------------------------
  if (url.pathname === '/api/admin/settlement' && req.method === 'GET') {
    const orders = loadOrders();
    const vendors = loadVendors();
    const products = loadProducts();
    const vendorFilter = url.searchParams.get('vendorId');
    const from = url.searchParams.get('from') || '';
    const to = url.searchParams.get('to') || '';

    let list = orders.orders || [];
    if (vendorFilter) list = list.filter((o) => o.vendorId === vendorFilter);
    if (from) list = list.filter((o) => (o.createdAt || '') >= from);
    if (to) list = list.filter((o) => (o.createdAt || '') <= to + 'T23:59:59Z');

    const productMap = new Map((products.products || []).map((p) => [p.productNo, p]));
    const vendorMap = new Map((vendors.vendors || []).map((v) => [v.id, v]));

    // Aggregate per vendor
    const byVendor = {};
    for (const o of list) {
      const vid = o.vendorId || 'unassigned';
      if (!byVendor[vid]) byVendor[vid] = { vendorId: vid, vendorName: '', totalOrders: 0, totalQty: 0, totalAmount: 0, shipped: 0, hold: 0, pending: 0 };
      const v = vendorMap.get(vid);
      if (v) byVendor[vid].vendorName = v.name;
      byVendor[vid].totalOrders++;
      byVendor[vid].totalQty += Number(o.qty || 0);
      const prod = productMap.get(o.productNo);
      if (prod) byVendor[vid].totalAmount += Number(prod.price || 0) * Number(o.qty || 0);
      const tn = String(o.trackingNumber || o.tracking?.number || '').trim();
      if (o.status === 'hold') byVendor[vid].hold++;
      else if (tn) byVendor[vid].shipped++;
      else byVendor[vid].pending++;
    }

    const summary = Object.values(byVendor).sort((a, b) => b.totalAmount - a.totalAmount);
    const grandTotal = summary.reduce((s, v) => ({ orders: s.orders + v.totalOrders, qty: s.qty + v.totalQty, amount: s.amount + v.totalAmount }), { orders: 0, qty: 0, amount: 0 });

    return sendJson(res, 200, { vendors: summary, grandTotal, period: { from: from || 'all', to: to || 'all' } });
  }

  // -------------------------
  // Phase 2B: Bulk tracking upload (벌크 송장)
  // -------------------------
  // -------------------------
  // Phase 2B: Combined shipping grouping (합배송)
  // -------------------------
  if (url.pathname === '/api/admin/combined_shipping' && req.method === 'GET') {
    const orders = loadOrders();
    const list = (orders.orders || []).filter((o) => {
      const tn = String(o.trackingNumber || o.tracking?.number || '').trim();
      return tn && o.status !== 'hold' && o.status !== 'cancelled';
    });

    const groups = {};
    for (const o of list) {
      const key = `${(o.recipientName || '').trim()}|${(o.recipientAddress || '').trim()}`;
      if (!groups[key]) groups[key] = { recipientName: o.recipientName, recipientAddress: o.recipientAddress, orders: [] };
      groups[key].orders.push({ id: o.id, productOrderNo: o.productOrderNo, productName: o.productName, qty: o.qty, carrier: o.carrier, trackingNumber: o.trackingNumber });
    }

    const combined = Object.values(groups).filter((g) => g.orders.length > 1).sort((a, b) => b.orders.length - a.orders.length);
    return sendJson(res, 200, { groups: combined, count: combined.length });
  }

  // -------------------------
  // Phase 4: Naver Commerce API endpoints (thin wrappers → doNaver* functions)
  // -------------------------

  if (url.pathname === '/api/admin/naver/status' && req.method === 'GET') {
    return sendJson(res, 200, {
      enabled: !!naverCommerce,
      clientId: process.env.NAVER_CLIENT_ID ? process.env.NAVER_CLIENT_ID.slice(0, 8) + '...' : null,
    });
  }

  if (url.pathname === '/api/admin/naver/sync_orders' && req.method === 'POST') {
    if (!naverCommerce) return sendJson(res, 400, { error: 'naver_api_not_configured', detail: 'Set NAVER_CLIENT_ID and NAVER_CLIENT_SECRET' });
    const body = await readJsonBody(req);
    const from = body?.from || new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const to = body?.to || new Date().toISOString().slice(0, 10);
    try {
      const r = await doNaverSync(from, to);
      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'NAVER_ORDER_SYNC', imported: r.imported, updated: r.updated, from, to, ip: getClientIp(req) });
      return sendJson(res, 200, { ok: true, ...r });
    } catch (e) {
      return sendJson(res, 500, { error: 'naver_sync_failed', detail: e.message });
    }
  }

  if (url.pathname === '/api/admin/naver/ship' && req.method === 'POST') {
    if (!naverCommerce) return sendJson(res, 400, { error: 'naver_api_not_configured' });
    const body = await readJsonBody(req);
    const orderIds = body?.orderIds;
    if (!Array.isArray(orderIds) || orderIds.length === 0) return sendJson(res, 400, { error: 'orderIds required' });
    if (orderIds.length > 50) return sendJson(res, 400, { error: 'max 50 orders per request' });
    try {
      const r = await doNaverShipBatch(orderIds);
      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'NAVER_SHIP', success: r.success, failed: r.failed, skipped: r.skipped, ip: getClientIp(req) });
      return sendJson(res, 200, { ok: true, ...r });
    } catch (e) {
      return sendJson(res, 500, { error: 'naver_ship_failed', detail: e.message });
    }
  }

  if (url.pathname === '/api/admin/naver/confirm' && req.method === 'POST') {
    if (!naverCommerce) return sendJson(res, 400, { error: 'naver_api_not_configured' });
    const body = await readJsonBody(req);
    const orderIds = body?.orderIds;
    if (!Array.isArray(orderIds) || orderIds.length === 0) return sendJson(res, 400, { error: 'orderIds required' });
    try {
      const r = await doNaverConfirmBatch(orderIds);
      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'NAVER_CONFIRM', success: r.success, failed: r.failed, ip: getClientIp(req) });
      return sendJson(res, 200, { ok: true, ...r });
    } catch (e) {
      return sendJson(res, 500, { error: 'naver_confirm_failed', detail: e.message });
    }
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

  // -------------------------
  // Instagram APIs (owner auth via shouldRequireOwnerAuth)
  // -------------------------

  if (url.pathname === '/api/admin/ig/guide' && req.method === 'GET') {
    return sendJson(res, 200, loadIgGuide());
  }

  if (url.pathname === '/api/admin/ig/guide' && req.method === 'POST') {
    const body = await readJsonBody(req);
    if (!body) return sendJson(res, 400, { error: 'bad_input' });
    saveIgGuide(body);
    auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'IG_GUIDE_UPDATED', ip: getClientIp(req) });
    return sendJson(res, 200, { ok: true });
  }

  if (url.pathname === '/api/admin/ig/posts' && req.method === 'GET') {
    const data = loadIgPosts();
    const status = url.searchParams.get('status');
    let posts = data.posts || [];
    if (status) posts = posts.filter((p) => p.status === status);
    posts.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return sendJson(res, 200, { posts });
  }

  if (url.pathname === '/api/admin/ig/posts' && req.method === 'POST') {
    const body = await readJsonBody(req);
    if (!body?.productName || !body?.keyBenefit) return sendJson(res, 400, { error: 'productName and keyBenefit required' });

    // price policy: numeric-only (e.g., 48000)
    const priceNum = parsePriceNumber(body?.price);
    if (body?.price !== undefined && body?.price !== null && body?.price !== '' && priceNum === null) {
      return sendJson(res, 400, { error: 'invalid_price_format', detail: 'price는 숫자만 입력하세요 (예: 48000)' });
    }

    const guide = loadIgGuide();
    const draftParams = { ...body, price: priceNum };
    const variants = generateIgDrafts(draftParams, guide);
    const post = {
      id: `ig_${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      productName: body.productName,
      keyBenefit: body.keyBenefit,
      price: priceNum,
      targetAudience: body.targetAudience || null,
      notes: body.notes || null,
      options: body.options || null,
      reviews: body.reviews || null,
      review1: body.review1 || null,
      review2: body.review2 || null,
      trustHeadline: body.trustHeadline || null,
      trustStat: body.trustStat || null,
      shipping: body.shipping || null,
      returnPolicy: body.returnPolicy || null,
      exchange: body.exchange || null,
      logisticsNote: body.logisticsNote || null,
      howtoSteps: body.howtoSteps || null,
      howtoNote: body.howtoNote || null,
      deadline: body.deadline || null,
      variants,
      status: 'draft',
      approvedVariantId: null,
      scheduledAt: null,
      slot: null,
      ctaType: null,
      reminderSent: false,
      sentAt: null,
      canceledAt: null,
    };
    const data = loadIgPosts();
    data.posts = (data.posts || []).concat(post);
    saveIgPosts(data);
    auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'IG_DRAFT_CREATED', postId: post.id, productName: body.productName, variantCount: variants.length, ip: getClientIp(req) });
    for (const v of variants) {
      if (!v.validation?.valid) {
        auditLog({ actorType: 'system', action: 'IG_DRAFT_VALIDATION_FAILED', postId: post.id, variantId: v.id, errors: v.validation.errors, ip: getClientIp(req) });
      }
    }
    return sendJson(res, 200, { ok: true, post });
  }

  if (url.pathname === '/api/admin/ig/posts_due' && req.method === 'GET') {
    const nowParam = url.searchParams.get('now');
    const now = nowParam ? new Date(nowParam) : new Date();
    const data = loadIgPosts();
    const due = (data.posts || []).filter((p) => p.status === 'approved' && !p.reminderSent && p.scheduledAt && new Date(p.scheduledAt) <= now);
    return sendJson(res, 200, { posts: due, count: due.length });
  }

  if (url.pathname?.startsWith('/api/admin/ig/posts/') && req.method === 'POST') {
    const parts = url.pathname.split('/').filter(Boolean);
    const postId = parts[4];
    const action = parts[5];
    if (!postId || !action) return sendJson(res, 404, { error: 'not_found' });

    const data = loadIgPosts();
    const idx = (data.posts || []).findIndex((p) => p.id === postId);
    if (idx === -1) return sendJson(res, 404, { error: 'post_not_found' });

    const post = data.posts[idx];
    const body = await readJsonBody(req);
    const now = new Date().toISOString();

    if (action === 'approve') {
      if (post.status !== 'draft') return sendJson(res, 409, { error: 'can_only_approve_drafts' });
      let variantId = body?.variantId;
      if (!variantId) {
        // Auto-pick a valid variant (policy B)
        const picked = (post.variants || []).find((v) => v.validation?.valid);
        if (!picked) return sendJson(res, 409, { error: 'no_valid_variants', detail: '승인 가능한 draft가 없습니다(금지어/해시태그 규칙 확인 필요)' });
        variantId = picked.id;
      }
      let variant = (post.variants || []).find((v) => v.id === variantId);
      if (!variant) return sendJson(res, 404, { error: 'variant_not_found' });
      if (!variant.validation?.valid) {
        // Fall back to first valid variant instead of blocking approval
        const picked = (post.variants || []).find((v) => v.validation?.valid);
        if (!picked) return sendJson(res, 409, { error: 'variant_has_validation_errors', errors: variant.validation?.errors });
        variant = picked;
        variantId = picked.id;
      }

      const guide = loadIgGuide();
      let scheduledAt = body?.scheduledAt;
      let slot = body?.slot;
      if (!scheduledAt) {
        const ns = findNextIgSlot(data.posts || [], guide);
        if (!ns) return sendJson(res, 409, { error: 'no_available_slots' });
        scheduledAt = ns.scheduledAt;
        slot = ns.slot;
      }

      post.status = 'approved';
      post.approvedVariantId = variantId;
      post.scheduledAt = scheduledAt;
      post.slot = slot || null;
      post.ctaType = variant.ctaType;
      post.approvedAt = now;
      data.posts[idx] = post;
      saveIgPosts(data);
      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'IG_APPROVED', postId: post.id, variantId, scheduledAt, ip: getClientIp(req) });
      return sendJson(res, 200, { ok: true, post });
    }

    if (action === 'reschedule') {
      if (post.status !== 'approved') return sendJson(res, 409, { error: 'can_only_reschedule_approved' });
      const scheduledAt = body?.scheduledAt;
      if (!scheduledAt) return sendJson(res, 400, { error: 'scheduledAt required' });
      post.scheduledAt = scheduledAt;
      post.slot = body?.slot || null;
      data.posts[idx] = post;
      saveIgPosts(data);
      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'IG_RESCHEDULED', postId: post.id, scheduledAt, ip: getClientIp(req) });
      return sendJson(res, 200, { ok: true, post });
    }

    if (action === 'mark_sent') {
      if (post.status !== 'approved') return sendJson(res, 409, { error: 'can_only_mark_sent_approved' });
      post.status = 'sent';
      post.sentAt = now;
      data.posts[idx] = post;
      saveIgPosts(data);
      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'IG_MARK_SENT', postId: post.id, ip: getClientIp(req) });
      return sendJson(res, 200, { ok: true, post });
    }

    if (action === 'cancel') {
      if (post.status === 'sent') return sendJson(res, 409, { error: 'cannot_cancel_sent' });
      post.status = 'canceled';
      post.canceledAt = now;
      data.posts[idx] = post;
      saveIgPosts(data);
      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'IG_CANCELED', postId: post.id, ip: getClientIp(req) });
      return sendJson(res, 200, { ok: true, post });
    }

    if (action === 'generate_images') {
      if (!post.approvedVariantId) return sendJson(res, 409, { error: 'must_approve_variant_first' });
      if (post.imageStatus === 'generating' && !body?.regenerate) return sendJson(res, 409, { error: 'already_generating' });

      const variant = (post.variants || []).find((v) => v.id === post.approvedVariantId);
      if (!variant) return sendJson(res, 404, { error: 'approved_variant_not_found' });

      const layoutId = body?.layoutId || null;
      let slides = null;
      if (Array.isArray(body?.slides) && body.slides.length >= 3) {
        slides = body.slides.filter((s) => IG_VALID_TYPES.has(s)).slice(0, 7);
        if (slides.length < 3) return sendJson(res, 400, { error: 'invalid_slides', detail: '유효한 슬라이드가 3개 이상 필요합니다.' });
      }
      const pageCount = slides ? slides.length : Math.min(Math.max(body?.pageCount || 5, 3), 7);

      post.imageStatus = 'generating';
      post.imageError = null;
      data.posts[idx] = post;
      saveIgPosts(data);
      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'IG_IMAGES_GENERATE_REQUESTED', postId: post.id, layoutId, pageCount, slides, ip: getClientIp(req) });

      try {
        const result = await generateCardImages(post, variant, { layoutId, pageCount, slides });
        post.assets = { cards: result.cards.map((c) => ({ index: c.index, type: c.type, filename: c.filename })), generatedAt: new Date().toISOString(), layoutId: result.layoutId, layoutName: result.layoutName, slides: slides || (result.cards.map((c) => c.type)) };
        post.imageStatus = 'ready';
        post.imageError = null;
        const data2 = loadIgPosts();
        const idx2 = (data2.posts || []).findIndex((p) => p.id === postId);
        if (idx2 !== -1) { data2.posts[idx2] = post; saveIgPosts(data2); }
        auditLog({ actorType: 'system', action: 'IG_IMAGES_GENERATED', postId: post.id, cardCount: result.cards.length, layoutId: result.layoutId, ip: getClientIp(req) });
        return sendJson(res, 200, { ok: true, post });
      } catch (err) {
        post.imageStatus = 'failed';
        post.imageError = err.message;
        const data2 = loadIgPosts();
        const idx2 = (data2.posts || []).findIndex((p) => p.id === postId);
        if (idx2 !== -1) { data2.posts[idx2] = post; saveIgPosts(data2); }
        auditLog({ actorType: 'system', action: 'IG_IMAGES_GENERATE_FAILED', postId: post.id, error: err.message, ip: getClientIp(req) });
        return sendJson(res, 500, { ok: false, error: 'image_generation_failed', detail: err.message });
      }
    }

    return sendJson(res, 400, { error: 'unknown_action' });
  }

  // IG card image preview (individual card)
  const cardMatch = url.pathname.match(/^\/api\/admin\/ig\/posts\/([^/]+)\/card\/(\d+)$/);
  if (cardMatch && req.method === 'GET') {
    const postId = cardMatch[1];
    const cardIndex = Number(cardMatch[2]);
    const data = loadIgPosts();
    const post = (data.posts || []).find((p) => p.id === postId);
    if (!post) return sendJson(res, 404, { error: 'post_not_found' });
    if (!post.assets?.cards) return sendJson(res, 404, { error: 'no_images' });
    const card = post.assets.cards.find((c) => c.index === cardIndex);
    if (!card) return sendJson(res, 404, { error: 'card_not_found' });
    const imgPath = path.join(dataDir, 'ig_assets', postId, card.filename);
    if (!existsSync(imgPath)) return sendJson(res, 404, { error: 'image_file_missing' });
    const stat = statSync(imgPath);
    res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': stat.size, 'Cache-Control': 'public, max-age=300' });
    createReadStream(imgPath).pipe(res);
    return;
  }

  // IG posting package ZIP download
  const zipMatch = url.pathname.match(/^\/api\/admin\/ig\/posts\/([^/]+)\/package\.zip$/);
  if (zipMatch && req.method === 'GET') {
    const postId = zipMatch[1];
    const data = loadIgPosts();
    const post = (data.posts || []).find((p) => p.id === postId);
    if (!post) return sendJson(res, 404, { error: 'post_not_found' });
    if (post.imageStatus !== 'ready' || !post.assets?.cards) return sendJson(res, 409, { error: 'images_not_ready' });
    const variant = (post.variants || []).find((v) => v.id === post.approvedVariantId);
    if (!variant) return sendJson(res, 404, { error: 'variant_not_found' });

    const assetsDir = path.join(dataDir, 'ig_assets', postId);
    const safeName = post.productName.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 30) || 'ig_post';
    const encodedName = encodeURIComponent(post.productName + '_package.zip');
    res.writeHead(200, {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${safeName}_package.zip"; filename*=UTF-8''${encodedName}`,
    });

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.pipe(res);

    for (const card of post.assets.cards) {
      const fp = path.join(assetsDir, card.filename);
      if (existsSync(fp)) archive.file(fp, { name: card.filename });
    }

    archive.append(variant.caption, { name: 'caption.txt' });
    archive.append(variant.hashtags, { name: 'hashtags.txt' });
    archive.append(JSON.stringify({
      postId: post.id,
      productName: post.productName,
      keyBenefit: post.keyBenefit,
      tone: variant.cluster,
      ctaType: variant.ctaType,
      scheduledAt: post.scheduledAt,
      generatedAt: post.assets.generatedAt,
      layoutId: post.assets.layoutId,
      layoutName: post.assets.layoutName,
      cardCount: post.assets.cards.length,
    }, null, 2), { name: 'meta.json' });

    archive.finalize();
    auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'IG_PACKAGE_DOWNLOADED', postId: post.id, ip: getClientIp(req) });
    return;
  }

  // IG slide types list
  if (url.pathname === '/api/admin/ig/slide_types' && req.method === 'GET') {
    return sendJson(res, 200, { slideTypes: IG_SLIDE_TYPES, defaults: IG_DEFAULT_SLIDES });
  }

  // IG layouts list
  if (url.pathname === '/api/admin/ig/layouts' && req.method === 'GET') {
    return sendJson(res, 200, loadIgLayouts());
  }

  // -------------------------
  // Ops dashboard (developer-only)
  // -------------------------
  if ((url.pathname === '/agents' || url.pathname === '/__ops') && req.method === 'GET') {
    // /__ops kept as backward-compatible alias
    return serveStatic(res, '/__ops.html');
  }

  if (url.pathname === '/api/ops/dashboard' && req.method === 'GET') {
    // Owner BasicAuth still applies (we do not exempt this path).
    const base = path.join(__dirname, '..', '..'); // workspace root
    const statusDir = path.join(base, 'ops', 'status');
    const handoffPath = path.join(base, 'ops', 'handoff.jsonl');

    const readText = (p) => {
      try { return existsSync(p) ? readFileSync(p, 'utf8') : ''; } catch { return ''; }
    };

    const dev = readText(path.join(statusDir, 'dev.md'));
    const qa = readText(path.join(statusDir, 'qa.md'));
    const ig = readText(path.join(statusDir, 'ig.md'));

    const lines = readText(handoffPath).split(/\n+/).map((l) => l.trim()).filter(Boolean);
    const recent = lines.slice(-30).map((l) => {
      try { return JSON.parse(l); } catch { return { raw: l }; }
    });

    return sendJson(res, 200, {
      ok: true,
      updatedAt: new Date().toISOString(),
      status: { dev, qa, ig },
      handoff: recent,
    });
  }

  // -------------------------
  // Automation: status + toggle endpoints
  // -------------------------

  if (url.pathname === '/api/admin/automation/status' && req.method === 'GET') {
    const queue = loadQueue();
    const pendingBatches = (queue.items || []).filter((it) =>
      (it.type === 'smartstore_ship_batch' || it.type === 'smartstore_confirm_batch') && it.state === 'pending'
    ).length;
    const approvedBatches = (queue.items || []).filter((it) =>
      (it.type === 'smartstore_ship_batch' || it.type === 'smartstore_confirm_batch') && it.state === 'approved'
    ).length;
    return sendJson(res, 200, {
      automationEnabled,
      naverLive: NAVER_LIVE,
      syncIntervalMin: AUTO_SYNC_INTERVAL_MIN,
      executeIntervalSec: AUTO_EXECUTE_INTERVAL_SEC,
      lastSyncAt,
      lastSyncResult,
      pendingBatches,
      approvedBatches,
    });
  }

  if (url.pathname === '/api/admin/automation/toggle' && req.method === 'POST') {
    const body = await readJsonBody(req);
    if (typeof body?.enabled !== 'boolean') return sendJson(res, 400, { error: 'enabled (boolean) required' });
    automationEnabled = body.enabled;
    auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'AUTOMATION_TOGGLE', enabled: automationEnabled, ip: getClientIp(req) });
    console.log(`[automation] toggled: ${automationEnabled ? 'ON' : 'OFF'}`);
    return sendJson(res, 200, { ok: true, automationEnabled });
  }

  // static (owner UI + vendor static assets)
  return serveStatic(res, url.pathname);
});

// -------------------------
// Automation state + schedulers
// -------------------------
const AUTO_SYNC_INTERVAL_MIN = Math.max(1, Number(process.env.AUTO_SYNC_INTERVAL_MIN || 30));
const AUTO_EXECUTE_INTERVAL_SEC = Math.max(10, Number(process.env.AUTO_EXECUTE_INTERVAL_SEC || 60));
let automationEnabled = (process.env.AUTO_SYNC_ENABLED || 'false') === 'true';
let lastSyncAt = null;
let lastSyncResult = null;

/**
 * Auto-sync orders from Naver (safe, no approval needed).
 */
async function autoSyncOrders() {
  if (!automationEnabled) return;
  if (!naverCommerce) return;
  const from = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const to = new Date().toISOString().slice(0, 10);
  try {
    const r = await doNaverSync(from, to);
    lastSyncAt = new Date().toISOString();
    lastSyncResult = { ...r, status: 'success' };
    auditLog({ actorType: 'system', action: 'AUTO_SYNC', imported: r.imported, updated: r.updated, from, to });
    console.log(`[auto-sync] imported=${r.imported} updated=${r.updated}`);
    // After sync, auto-create batches for approval
    try { autoCreateBatches(); } catch (batchErr) { console.error('[auto-batch] failed:', batchErr.message); }
  } catch (e) {
    lastSyncAt = new Date().toISOString();
    lastSyncResult = { status: 'failed', error: e.message };
    console.error('[auto-sync] failed:', e.message);
  }
}

/**
 * Auto-create ship/confirm batch queue items from ready orders.
 * Skips orders already in pending/approved/running queue items.
 */
function autoCreateBatches() {
  const orders = loadOrders();
  const queue = loadQueue();
  const allOrders = orders.orders || [];

  // Collect order IDs already in active queue items
  const activeStates = new Set(['pending', 'approved', 'running']);
  const queuedOrderIds = new Set();
  for (const item of queue.items || []) {
    if ((item.type === 'smartstore_ship_batch' || item.type === 'smartstore_confirm_batch') && activeStates.has(item.state)) {
      for (const oid of (item.payload?.orderIds || [])) queuedOrderIds.add(oid);
    }
  }

  // Ship batch: orders with tracking + carrier, not yet exported, not hold/cancelled
  const shipReady = allOrders.filter((o) => {
    if (queuedOrderIds.has(o.id)) return false;
    const tn = String(o.trackingNumber || o.tracking?.number || '').trim();
    const carrier = String(o.carrier || o.tracking?.carrier || '').trim();
    return tn.length > 0 && carrier.length > 0 && !o.exportedAt && o.status !== 'hold' && o.status !== 'cancelled';
  });

  if (shipReady.length > 0) {
    const batchId = `ship-batch-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    queue.items.push({
      id: batchId,
      type: 'smartstore_ship_batch',
      state: 'pending',
      source: 'scheduler',
      payload: {
        action: 'ship',
        orderIds: shipReady.map((o) => o.id),
        orderCount: shipReady.length,
        summary: `${shipReady.length}건 발송처리 대기`,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    console.log(`[auto-batch] created ship batch: ${batchId} (${shipReady.length} orders)`);
  }

  // Confirm batch: exported orders (shipped to Naver, not yet confirmed)
  const confirmReady = allOrders.filter((o) => {
    if (queuedOrderIds.has(o.id)) return false;
    return o.status === 'exported' && o.naverShippedAt && !o.naverConfirmedAt;
  });

  if (confirmReady.length > 0) {
    const batchId = `confirm-batch-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    queue.items.push({
      id: batchId,
      type: 'smartstore_confirm_batch',
      state: 'pending',
      source: 'scheduler',
      payload: {
        action: 'confirm',
        orderIds: confirmReady.map((o) => o.id),
        orderCount: confirmReady.length,
        summary: `${confirmReady.length}건 구매확인 대기`,
      },
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });
    console.log(`[auto-batch] created confirm batch: ${batchId} (${confirmReady.length} orders)`);
  }

  if (shipReady.length > 0 || confirmReady.length > 0) {
    saveQueue(queue);
  }
}

/**
 * Auto-execute approved ship/confirm batches (runs every AUTO_EXECUTE_INTERVAL_SEC).
 */
let _autoExecuteRunning = false;
async function autoExecuteApproved() {
  if (!automationEnabled) return;
  if (_autoExecuteRunning) return;
  _autoExecuteRunning = true;
  try { await _doAutoExecute(); } finally { _autoExecuteRunning = false; }
}
async function _doAutoExecute() {
  const queue = loadQueue();
  const approvedItems = (queue.items || []).filter((it) =>
    (it.type === 'smartstore_ship_batch' || it.type === 'smartstore_confirm_batch') && it.state === 'approved'
  );

  for (const item of approvedItems) {
    const orderIds = item.payload?.orderIds || [];
    if (orderIds.length === 0) {
      item.state = 'failed';
      item.error_message = 'empty orderIds';
      item.updated_at = new Date().toISOString();
      continue;
    }

    // Transition to running
    item.state = 'running';
    item.updated_at = new Date().toISOString();
    saveQueue(queue);

    try {
      let result;
      if (item.type === 'smartstore_ship_batch') {
        result = await doNaverShipBatch(orderIds);
      } else {
        result = await doNaverConfirmBatch(orderIds);
      }

      item.state = 'success';
      item.result = result;
      item.updated_at = new Date().toISOString();
      auditLog({ actorType: 'system', action: `AUTO_EXECUTE_${item.type.toUpperCase()}`, batchId: item.id, success: result.success, failed: result.failed });
      console.log(`[auto-execute] ${item.type} ${item.id}: success=${result.success} failed=${result.failed}`);
    } catch (e) {
      item.state = 'failed';
      item.error_message = e.message;
      item.updated_at = new Date().toISOString();
      auditLog({ actorType: 'system', action: `AUTO_EXECUTE_FAILED`, batchId: item.id, error: e.message });
      console.error(`[auto-execute] ${item.type} ${item.id}: failed — ${e.message}`);
    }
  }

  if (approvedItems.length > 0) {
    saveQueue(queue);
  }
}

server.listen(PORT, () => {
  console.log(`[dashboard] running on http://localhost:${PORT}`);
  console.log(`[dashboard] owner basic auth user=${OWNER_USERNAME} (password via DASHBOARD_PASSWORD)`);
  console.log('[dashboard] vendor portal: /vendor/login (session cookie)');
  console.log(`[automation] enabled=${automationEnabled} naverLive=${NAVER_LIVE} sync_interval=${AUTO_SYNC_INTERVAL_MIN}min execute_interval=${AUTO_EXECUTE_INTERVAL_SEC}sec`);
});

// Scheduler: auto-sync orders from Naver
setInterval(() => { autoSyncOrders().catch((e) => console.error('[auto-sync] unhandled:', e.message)); }, AUTO_SYNC_INTERVAL_MIN * 60 * 1000);

// Scheduler: auto-execute approved batches
setInterval(() => { autoExecuteApproved().catch((e) => console.error('[auto-execute] unhandled:', e.message)); }, AUTO_EXECUTE_INTERVAL_SEC * 1000);

// Periodic: rate limit map cleanup (every 30 minutes)
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of loginAttempts) {
    if (entry.lockedUntil && now >= entry.lockedUntil) loginAttempts.delete(ip);
    else if (now - entry.firstAttempt > RATE_LIMIT_WINDOW * 2) loginAttempts.delete(ip);
  }
}, 30 * 60 * 1000);

// Periodic: cleanup old upload files (every 6 hours)
const UPLOAD_MAX_AGE_DAYS = 7;
setInterval(() => {
  const uploadsDir = path.join(dataDir, 'uploads');
  if (!existsSync(uploadsDir)) return;
  const now = Date.now();
  const maxAgeMs = UPLOAD_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
  try {
    for (const name of readdirSync(uploadsDir)) {
      const p = path.join(uploadsDir, name);
      try {
        const st = statSync(p);
        if (now - st.mtimeMs > maxAgeMs) { unlinkSync(p); }
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}, 6 * 60 * 60 * 1000);

// Also run cleanup on startup
try {
  cleanupOldBackups(path.join(dataDir, 'backups'), 30);
  cleanupOldBackups(path.join(dataDir, 'uploads'), UPLOAD_MAX_AGE_DAYS);
} catch { /* ignore */ }
