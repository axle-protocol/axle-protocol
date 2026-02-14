import http from 'node:http';
import crypto from 'node:crypto';
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
const igGuidePath = path.join(dataDir, 'ig_brand_guide.json');
const igPostsPath = path.join(dataDir, 'ig_posts.json');

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

function generateIgDrafts(params, guide) {
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

  if (url.pathname === '/admin/instagram' || url.pathname === '/admin/instagram/') {
    return serveStatic(res, '/admin/instagram.html');
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
      trackingNumber: '',
      createdAt: now,
      updatedAt: now,
    });
    saveOrders(orders);

    return sendJson(res, 200, { ok: true, orderId: id });
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

    return sendJson(res, 400, { error: 'unknown_action' });
  }

  // static (owner UI + vendor static assets)
  return serveStatic(res, url.pathname);
});

server.listen(PORT, () => {
  console.log(`[dashboard] running on http://localhost:${PORT}`);
  console.log(`[dashboard] owner basic auth user=${OWNER_USERNAME} (password via DASHBOARD_PASSWORD)`);
  console.log('[dashboard] vendor portal: /vendor/login (session cookie)');
});
