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
};

// SmartStore bulk shipping upload usually expects these exact strings.
const DEFAULT_DELIVERY_METHOD = '택배,등기,소포';

function getClientIp(req) {
  const xff = req.headers['x-forwarded-for'];
  if (typeof xff === 'string' && xff.trim()) return xff.split(',')[0].trim();
  return req.socket?.remoteAddress || null;
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
      body: '{product} 쓰기 시작하고 달라진 점\n\n{benefit}\n{detail}\n\n과장 아니고 진심이에요',
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
  const broad = pickFromArray(mix.broad?.examples || [], (mix.broad?.min || 3) + (seed % ((mix.broad?.max || 5) - (mix.broad?.min || 3) + 1)), seed);
  const niche = pickFromArray(mix.niche?.examples || [], (mix.niche?.min || 4) + (seed % ((mix.niche?.max || 7) - (mix.niche?.min || 4) + 1)), seed + 1);
  const brand = pickFromArray(mix.brand?.examples || [], (mix.brand?.min || 2) + (seed % ((mix.brand?.max || 3) - (mix.brand?.min || 2) + 1)), seed + 2);
  const cta = pickFromArray(mix.cta?.examples || [], (mix.cta?.min || 1) + (seed % ((mix.cta?.max || 2) - (mix.cta?.min || 1) + 1)), seed + 3);
  const productTag = productName.replace(/\s+/g, '');
  const all = [...broad, ...niche, ...brand, ...cta];
  if (!all.includes(productTag)) all.push(productTag);
  return all.map((t) => `#${t}`);
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
      caption,
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
      caption,
      hashtags: hashtags.join(' '),
      ctaType,
      validation: null,
    };
    variant.validation = validateIgDraft(variant, guide);
    variants.push(variant);
  }
  return variants;
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

function parseVariantToPages(variant, post, pageCount) {
  const caption = variant?.caption || '';
  const blocks = caption.split(/\n\n+/).filter((b) => b.trim());
  const product = post.productName || '';
  const benefit = post.keyBenefit || '';
  const price = post.price ? `${Number(post.price).toLocaleString()}원` : '';
  const priceOriginal = post.price ? `정가 ${Number(Math.round(post.price * 1.3)).toLocaleString()}원` : '';

  // Build structured detail text
  const detailParts = [];
  if (post.targetAudience) detailParts.push(`${post.targetAudience}에게 특히 잘 맞아요`);
  if (post.notes) detailParts.push(post.notes);
  const detailText = detailParts.join('\n') || `${product}의 매력은 직접 느껴보세요`;

  // Intelligent benefit splitting for WHY page (3 items)
  // Try splitting by comma, period, or newline; fallback to benefit + detail fragments
  let benefitItems = benefit.split(/[,、·\n]/).map((s) => s.trim()).filter((s) => s.length > 2);
  if (benefitItems.length < 2) benefitItems = benefit.split(/\s(?=와|과|및|그리고)/).map((s) => s.trim()).filter(Boolean);
  const item1 = benefitItems[0] || benefit;
  const item2 = benefitItems[1] || (post.targetAudience ? `${post.targetAudience} 맞춤` : '매일 사용하기 좋은 제품');
  const item3 = benefitItems[2] || (post.notes || '검증된 품질과 합리적 가격');

  // Extract hook — first caption block is the hook, second is benefit/body
  const hookText = blocks[0] || product;
  // CTA is the last block
  const ctaBlock = blocks[blocks.length - 1] || '프로필 링크에서 확인하세요';
  // Offer block is second-to-last if it contains price/공구 keywords
  const offerCandidate = blocks.length >= 3 ? blocks[blocks.length - 2] : '';
  const isOfferBlock = /원|공구|특가|가격|한정/.test(offerCandidate);
  const offerText = isOfferBlock ? offerCandidate : (price ? `지금 공구가 ${price}` : '지금 특별한 가격으로');

  // Determine pages based on count
  let sequence;
  if (pageCount <= 3) sequence = ['hook', 'why', 'cta'];
  else if (pageCount === 4) sequence = ['hook', 'why', 'offer', 'cta'];
  else sequence = ['hook', 'why', 'detail', 'offer', 'cta'];

  const pages = [];
  for (const type of sequence) {
    const data = { type };
    switch (type) {
      case 'hook':
        data.HOOK_TEXT = hookText;
        data.SUB_TEXT = benefit.length > 30 ? benefit.slice(0, 30) + '...' : benefit;
        break;
      case 'why':
        data.ITEM_1 = item1;
        data.ITEM_2 = item2;
        data.ITEM_3 = item3;
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
        break;
      case 'cta':
        data.CTA_TEXT = ctaBlock;
        data.CTA_SUB = product;
        break;
    }
    pages.push(data);
  }
  return pages;
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
  const { layoutId, pageCount = 5 } = options;
  const layoutsData = loadIgLayouts();
  const layout = layoutsData.layouts.find((l) => l.id === layoutId) || layoutsData.layouts[0];
  if (!layout) throw new Error('No layouts available');

  const palette = layout.palette;
  const outDir = path.join(dataDir, 'ig_assets', post.id);
  mkdirSync(outDir, { recursive: true });

  // Optional product hero image (uploaded by owner)
  const productCandidates = ['product.webp', 'product.png', 'product.jpg', 'product.jpeg'];
  let productImagePath = '';
  for (const fn of productCandidates) {
    const p = path.join(outDir, fn);
    if (existsSync(p)) { productImagePath = p; break; }
  }
  const productImageUrl = productImagePath ? `file://${productImagePath}` : '';

  const aiBgPath = await generateAiBackground(palette, post.productName, outDir);
  const background = resolveBackground(palette, aiBgPath);
  const pages = parseVariantToPages(variant, post, pageCount);
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
        .replace(/\{\{PRODUCT_IMAGE_URL\}\}/g, productImageUrl);

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
  const s = (db.sessions || []).find((x) => x.token === token);
  if (!s) return null;
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

  // Owner session bootstrap endpoints/pages
  if (url.pathname === '/admin/login') return false;
  if (url.pathname === '/api/owner/login') return false;

  // Everything else is owner dashboard for now.
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

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

  if (url.pathname === '/api/owner/login' && req.method === 'POST') {
    const body = await readJsonBody(req);
    const user = String(body?.username || OWNER_USERNAME);
    const pass = String(body?.password || '');
    if (user !== OWNER_USERNAME || pass !== OWNER_PASSWORD) {
      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'OWNER_LOGIN_FAILED', ip: getClientIp(req) });
      return sendJson(res, 401, { ok: false, error: 'bad_credentials' });
    }

    const token = crypto.randomUUID();
    const db = loadOwnerSessions();
    const now = new Date().toISOString();
    db.sessions = (db.sessions || []).concat({ token, createdAt: now, lastSeenAt: now });
    // keep last 200 sessions
    if (db.sessions.length > 200) db.sessions = db.sessions.slice(db.sessions.length - 200);
    saveOwnerSessions(db);

    const isHttps = String(req.headers['x-forwarded-proto'] || '').includes('https');
    setCookie(res, 'owner_session', token, { httpOnly: true, sameSite: 'Lax', path: '/', secure: isHttps, maxAge: 60 * 60 * 24 * 30 });

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
      const ext = (origName.match(/\.(webp|png|jpe?g)$/)?.[0]) || '.jpg';
      const outName = `product${ext}`;
      // cleanup old variants
      for (const fn of ['product.webp','product.png','product.jpg','product.jpeg']) {
        try { if (existsSync(path.join(outDir, fn))) unlinkSync(path.join(outDir, fn)); } catch {}
      }
      const outPath = path.join(outDir, outName);
      writeFileSync(outPath, filePart.data);

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
        return { ...o, vendorId, updatedAt: now };
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

    const orders = loadOrders();
    const all = (orders.orders || []).filter((o) => {
      const tn = String(o.trackingNumber || o.tracking?.number || '').trim();
      const carrier = String(o.carrier || o.tracking?.carrier || '').trim();
      return tn.length > 0 && carrier.length > 0;
    });

    const start = chunk * size;
    const rows = all.slice(start, start + size);

    const sheetRows = [
      ['상품주문번호', '배송방법', '택배사', '송장번호'],
      ...rows.map((o) => {
        const carrierKey = String(o.carrier || o.tracking?.carrier || '').trim();
        const carrierLabel = CARRIER_LABEL[carrierKey] || carrierKey; // fallback
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
    let orders = (data.orders || []).filter((o) => o.vendorId === vendor.id);

    // normalize for vendor UI compatibility (legacy fields)
    orders = orders.map((o) => {
      const carrier = o.carrier || o.tracking?.carrier || null;
      const trackingNumber = o.trackingNumber || o.tracking?.number || '';
      return { ...o, carrier, trackingNumber };
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
    // legacy top-level fields (used by vendor UI + shipping export)
    db.orders[idx].carrier = carrier;
    db.orders[idx].trackingNumber = v.number;

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
    const guide = loadIgGuide();
    const variants = generateIgDrafts(body, guide);
    const post = {
      id: `ig_${crypto.randomUUID()}`,
      createdAt: new Date().toISOString(),
      productName: body.productName,
      keyBenefit: body.keyBenefit,
      price: body.price || null,
      targetAudience: body.targetAudience || null,
      notes: body.notes || null,
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
      const variantId = body?.variantId;
      if (!variantId) return sendJson(res, 400, { error: 'variantId required' });
      const variant = (post.variants || []).find((v) => v.id === variantId);
      if (!variant) return sendJson(res, 404, { error: 'variant_not_found' });
      if (!variant.validation?.valid) return sendJson(res, 409, { error: 'variant_has_validation_errors', errors: variant.validation?.errors });

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
      const pageCount = Math.min(Math.max(body?.pageCount || 5, 3), 5);

      post.imageStatus = 'generating';
      post.imageError = null;
      data.posts[idx] = post;
      saveIgPosts(data);
      auditLog({ actorType: 'owner', actorId: OWNER_USERNAME, action: 'IG_IMAGES_GENERATE_REQUESTED', postId: post.id, layoutId, pageCount, ip: getClientIp(req) });

      try {
        const result = await generateCardImages(post, variant, { layoutId, pageCount });
        post.assets = { cards: result.cards.map((c) => ({ index: c.index, type: c.type, filename: c.filename })), generatedAt: new Date().toISOString(), layoutId: result.layoutId, layoutName: result.layoutName };
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

  // IG layouts list
  if (url.pathname === '/api/admin/ig/layouts' && req.method === 'GET') {
    return sendJson(res, 200, loadIgLayouts());
  }

  // static (owner UI + vendor static assets)
  return serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`[dashboard] running on http://localhost:${PORT}`);
  console.log(`[dashboard] owner basic auth user=${OWNER_USERNAME} (password via DASHBOARD_PASSWORD)`);
  console.log('[dashboard] vendor portal: /vendor/login (session cookie)');
});
