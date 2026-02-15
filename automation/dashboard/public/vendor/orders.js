function escapeHtml(s) {
  return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;');
}
function normalizeTracking(raw) { return String(raw||'').replace(/[\s-]/g,'').trim(); }
function validateTracking(carrier, tracking) {
  const t = normalizeTracking(tracking);
  if (!t) return { ok: false, reason: '송장번호를 입력해주세요' };
  if (!/^\d+$/.test(t)) return { ok: false, reason: '숫자만 입력 가능합니다' };
  if (['cj','hanjin','lotte','post','logen','kyungdong'].includes(carrier)) {
    if (t.length < 10 || t.length > 14) return { ok: false, reason: '10~14자리 숫자를 입력해주세요' };
  }
  return { ok: true, value: t };
}

async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}
async function postJson(path, body) {
  const res = await fetch(path, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

const CARRIERS = [
  { value: 'cj', label: 'CJ대한통운' },
  { value: 'hanjin', label: '한진택배' },
  { value: 'lotte', label: '롯데택배' },
  { value: 'post', label: '우체국택배' },
  { value: 'logen', label: '로젠택배' },
  { value: 'kyungdong', label: '경동택배' },
  { value: 'etc', label: '기타(직접입력)' },
];

let allOrders = [];

function orderCard(o) {
  const carrier = o.carrier || 'hanjin';
  const tracking = o.trackingNumber || '';
  const isHold = o.status === 'hold';
  const pending = !String(tracking).trim() && !isHold;

  const productName = (o.productName || '').trim();
  const optionInfo = (o.optionInfo || '').trim();
  const qty = Number(o.qty ?? 0);
  const productOrderNo = String(o.productOrderNo || o.id || '');
  const recipientName = (o.recipientName || '').trim() || '-';
  const recipientPhone = (o.recipientPhone || '').trim() || '-';
  const recipientAddress = (o.recipientAddress || '').trim() || '-';

  const borderClass = isHold ? 'border-red-400/60 bg-red-400/5' : pending ? 'border-amber-400/60 bg-amber-400/5' : 'border-zinc-800';
  const statusBadge = isHold
    ? `<span class="text-xs bg-red-500/20 text-red-300 px-2 py-0.5 rounded-full">보류: ${escapeHtml(o.holdReason || '품절')}</span>`
    : pending
      ? '<span class="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full">송장 미입력</span>'
      : '<span class="text-xs bg-emerald-500/20 text-emerald-300 px-2 py-0.5 rounded-full">발송완료</span>';

  const carrierOptions = CARRIERS.map(c => `<option value="${c.value}" ${carrier===c.value?'selected':''}>${c.label}</option>`).join('');

  return `
  <div class="rounded-lg border ${borderClass} p-3" data-id="${escapeHtml(o.id)}">
    <div class="flex items-center justify-between">
      <div class="text-base font-semibold">${escapeHtml(productName || '-')}</div>
      ${statusBadge}
    </div>
    <div class="text-sm text-zinc-300 mt-1">수량 <span class="font-semibold">${qty}</span>${optionInfo ? ' · '+escapeHtml(optionInfo) : ''}</div>

    <div class="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/30 p-3">
      <div class="text-xs text-zinc-500">배송정보</div>
      <div class="mt-1 text-lg font-semibold" data-recipient>${escapeHtml(recipientName)}</div>
      <div class="mt-1 text-base font-semibold" data-phone>${escapeHtml(recipientPhone)}</div>
      <div class="mt-2 text-sm text-zinc-100 break-words" data-address>${escapeHtml(recipientAddress)}</div>
      <div class="mt-2 text-xs text-zinc-500">주문번호: <span class="font-mono" data-pon>${escapeHtml(productOrderNo)}</span></div>

      <div class="mt-2 grid grid-cols-4 gap-1">
        <button class="rounded bg-zinc-800 px-2 py-1.5 text-xs" data-copy="name">이름</button>
        <button class="rounded bg-zinc-800 px-2 py-1.5 text-xs" data-copy="phone">전화</button>
        <button class="rounded bg-zinc-800 px-2 py-1.5 text-xs" data-copy="address">주소</button>
        <button class="rounded bg-zinc-800 px-2 py-1.5 text-xs" data-copy="pon">주문번호</button>
      </div>
      <div class="mt-1 text-xs text-zinc-400" data-copy-msg></div>
    </div>

    ${isHold ? '' : `
    <div class="mt-3 grid grid-cols-2 gap-2">
      <select class="rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm" data-carrier>${carrierOptions}</select>
      <input class="rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm" data-tracking value="${escapeHtml(tracking)}" placeholder="송장번호" inputmode="numeric" />
    </div>
    <div class="mt-2 flex gap-2">
      <button class="flex-1 rounded-lg bg-emerald-400 text-zinc-950 py-2 text-sm font-semibold" data-save>${pending ? '송장 저장' : '송장 수정'}</button>
      ${pending ? '<button class="rounded-lg bg-red-500/20 text-red-300 border border-red-500/30 px-3 py-2 text-sm" data-hold>품절/불가</button>' : ''}
    </div>
    `}
    <div class="mt-2 text-xs" data-msg></div>
  </div>`;
}

function filterOrders(orders) {
  const q = (document.getElementById('searchInput')?.value || '').toLowerCase().trim();
  const dateFilter = document.getElementById('dateFilter')?.value || 'all';
  const now = new Date();
  const todayStr = now.toISOString().slice(0,10);
  const weekAgo = new Date(now - 7*24*60*60*1000).toISOString();

  return orders.filter(o => {
    if (q && !(o.productName||'').toLowerCase().includes(q) && !(o.recipientName||'').toLowerCase().includes(q)) return false;
    if (dateFilter === 'today' && !(o.createdAt||'').startsWith(todayStr)) return false;
    if (dateFilter === 'week' && (o.createdAt||'') < weekAgo) return false;
    return true;
  });
}

async function render() {
  try {
    const me = await getJson('/api/vendor/me');
    document.getElementById('me').textContent = `${me.vendor.name} (${me.vendor.username})`;

    const list = await getJson('/api/vendor/orders');
    allOrders = list.orders || [];
  } catch(e) {
    document.getElementById('orders').innerHTML = '<div class="text-sm text-red-300">로드 실패: '+escapeHtml(e.message)+'</div>';
    return;
  }

  renderOrders();
}

function renderOrders() {
  const orders = filterOrders(allOrders);
  const wrap = document.getElementById('orders');

  const isPending = o => !String(o.trackingNumber||'').trim() && o.status !== 'hold';
  const isHold = o => o.status === 'hold';
  const isShipped = o => !!String(o.trackingNumber||'').trim();

  document.getElementById('pendingCount').textContent = allOrders.filter(isPending).length;
  document.getElementById('shippedCount').textContent = allOrders.filter(isShipped).length;
  document.getElementById('holdCount').textContent = allOrders.filter(isHold).length;

  if (!orders.length) {
    wrap.innerHTML = '<div class="text-sm text-zinc-500 text-center py-4">주문 없음</div>';
    return;
  }

  // Sort: pending first, then hold, then shipped
  orders.sort((a,b) => {
    const pa = isPending(a)?0 : isHold(a)?1 : 2;
    const pb = isPending(b)?0 : isHold(b)?1 : 2;
    if (pa !== pb) return pa - pb;
    return (b.createdAt||'').localeCompare(a.createdAt||'');
  });

  wrap.innerHTML = orders.map(orderCard).join('');
  bindEvents(wrap);
}

function bindEvents(wrap) {
  // Copy buttons
  wrap.querySelectorAll('[data-copy]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-id]');
      const kind = btn.dataset.copy;
      const msg = card.querySelector('[data-copy-msg]');
      const selectors = { phone:'[data-phone]', address:'[data-address]', name:'[data-recipient]', pon:'[data-pon]' };
      const val = card.querySelector(selectors[kind])?.textContent || '';
      try {
        await (navigator.clipboard?.writeText(val) || Promise.reject());
        msg.textContent = '복사됨';
        msg.className = 'mt-1 text-xs text-emerald-300';
      } catch {
        // fallback
        const ta = document.createElement('textarea');
        ta.value = val; document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
        msg.textContent = '복사됨';
        msg.className = 'mt-1 text-xs text-emerald-300';
      }
    });
  });

  // Save tracking
  wrap.querySelectorAll('[data-save]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-id]');
      const id = card.dataset.id;
      const carrier = card.querySelector('[data-carrier]').value;
      const raw = card.querySelector('[data-tracking]').value;
      const v = validateTracking(carrier, raw);
      const msg = card.querySelector('[data-msg]');

      if (!v.ok) { msg.className='mt-2 text-xs text-red-300'; msg.textContent=v.reason; return; }

      btn.disabled = true;
      try {
        await postJson(`/api/vendor/orders/${encodeURIComponent(id)}/tracking`, { carrier, number: v.value });
        msg.className = 'mt-2 text-xs text-emerald-300';
        msg.textContent = '저장 완료';
        setTimeout(() => render(), 500);
      } catch(e) {
        msg.className = 'mt-2 text-xs text-red-300';
        msg.textContent = e.message;
      } finally { btn.disabled = false; }
    });
  });

  // Hold (품절/불가)
  wrap.querySelectorAll('[data-hold]').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (!confirm('이 주문을 품절/불가 처리하시겠습니까?')) return;
      const card = btn.closest('[data-id]');
      const id = card.dataset.id;
      const msg = card.querySelector('[data-msg]');
      try {
        await postJson(`/api/vendor/orders/${encodeURIComponent(id)}/hold`, { reason: 'vendor_unavailable' });
        msg.className = 'mt-2 text-xs text-red-300';
        msg.textContent = '품절 처리됨';
        setTimeout(() => render(), 500);
      } catch(e) {
        msg.className = 'mt-2 text-xs text-red-300';
        msg.textContent = e.message;
      }
    });
  });
}

render();

// Event listeners
document.getElementById('refreshBtn').addEventListener('click', () => render());
document.getElementById('exportBtn').addEventListener('click', () => window.location.href='/api/vendor/orders.xlsx');
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await postJson('/api/vendor/logout', {});
  location.href = '/vendor/login';
});
document.getElementById('searchInput').addEventListener('input', () => renderOrders());
document.getElementById('dateFilter').addEventListener('change', () => renderOrders());
