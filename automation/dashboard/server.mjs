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
const productsPath = path.join(dataDir, 'products.json');
const mappingPath = path.join(dataDir, 'mapping.json');
const auditLogPath = path.join(dataDir, 'audit.jsonl');

const CARRIER_LABEL = {
  cj: 'CJ대한통운',
  hanjin: '한진택배',
};

// SmartStore bulk shipping upload usually expects these exact strings.
const DEFAULT_DELIVERY_METHOD = '택배,등기,소포';

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
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
  // Admin pages
  // -------------------------
  if (url.pathname === '/admin' || url.pathname === '/admin/') {
    return serveStatic(res, '/admin/index.html');
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

  if (url.pathname === '/api/admin/vendors' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const name = String(body?.name || '').trim();
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');

    if (!name || !username || password.length < 4) return sendJson(res, 400, { error: 'bad_input' });

    const data = loadVendors();
    if ((data.vendors || []).some((v) => v.username === username)) return sendJson(res, 409, { error: 'username_exists' });

    const pw = hashPassword(password);
    const vendor = { id: `vendor_${crypto.randomUUID()}`, name, username, password: pw };
    data.vendors = (data.vendors || []).concat(vendor);
    saveJson(vendorsPath, data);

    return sendJson(res, 200, { ok: true, vendor: { id: vendor.id, name: vendor.name, username: vendor.username } });
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

  if (url.pathname === '/api/admin/mapping' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const vendorId = String(body?.vendorId || '');
    const productNos = Array.isArray(body?.productNos) ? body.productNos.map(String) : [];

    if (!vendorId) return sendJson(res, 400, { error: 'bad_input' });

    const m = loadMapping();
    m.mapping = (m.mapping || []).filter((x) => x.vendorId !== vendorId);
    for (const pn of productNos) {
      if (!pn) continue;
      m.mapping.push({ vendorId, productNo: pn });
    }
    saveMapping(m);
    return sendJson(res, 200, { ok: true, count: productNos.length });
  }

  // -------------------------
  // Admin: SmartStore order XLSX import (multipart)
  // -------------------------
  if (url.pathname === '/api/admin/orders_xlsx_import' && req.method === 'POST') {
    const ct = String(req.headers['content-type'] || '');
    const m = ct.match(/boundary=(?:(?:\"([^\"]+)\")|([^;]+))/i);
    const boundary = m ? (m[1] || m[2]) : null;
    if (!boundary) return sendJson(res, 400, { error: 'missing_boundary' });

    async function readMultipart(boundaryStr, maxBytes = 30 * 1024 * 1024) {
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
        parts.push({
          name: nameMatch ? nameMatch[1] : null,
          filename: fileMatch ? fileMatch[1] : null,
          headers,
          data: body,
        });

        start = next;
      }
      return parts;
    }

    try {
      const parts = await readMultipart(boundary);
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
    const products = loadProducts();
    const list = products.products || [];
    if (!vendorId || list.length === 0) return sendJson(res, 400, { error: 'need_vendor_and_products' });
    const pick = list[Math.floor(Math.random() * list.length)];

    const orders = loadOrders();
    const now = new Date().toISOString();
    const id = String(Date.now());
    orders.orders = (orders.orders || []).concat({
      id,
      productOrderNo: id,
      orderNo: String(Date.now()),
      productNo: pick.productNo,
      productName: pick.productName,
      optionInfo: '',
      qty: 1,
      recipientName: '홍길동',
      recipientPhone: '01012341234',
      recipientAddress: '서울시 강남구 ...',
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

    const orders = loadOrders();
    const all = (orders.orders || []).filter((o) => {
      const tn = String(o.trackingNumber || '').trim();
      const carrier = String(o.carrier || '').trim();
      return tn.length > 0 && carrier.length > 0;
    });

    const start = chunk * size;
    const rows = all.slice(start, start + size);

    const sheetRows = [
      ['상품주문번호', '배송방법', '택배사', '송장번호'],
      ...rows.map((o) => {
        const carrierKey = String(o.carrier || '').trim();
        const carrierLabel = CARRIER_LABEL[carrierKey] || carrierKey; // fallback
        return [String(o.productOrderNo || o.id || ''), deliveryMethod, carrierLabel, String(o.trackingNumber || '')];
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
    const body = await readJsonBody(req);
    const username = String(body?.username || '').trim();
    const password = String(body?.password || '');

    const vendor = getVendorByUsername(username);
    if (!vendor || !verifyPassword(password, vendor.password)) {
      auditLog({ actorType: 'vendor', actorId: username || null, action: 'VENDOR_LOGIN_FAILED', ip: getClientIp(req) });
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

    const data = loadOrders();
    const orders = (data.orders || []).filter((o) => o.vendorId === vendor.id);

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
