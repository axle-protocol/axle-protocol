function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeTracking(raw) {
  if (!raw) return '';
  return String(raw).replace(/[\s-]/g, '').trim();
}

function validTracking(carrier, tracking) {
  const t = normalizeTracking(tracking);
  if (!t) return { ok: false, reason: 'empty' };
  if (!/^\d+$/.test(t)) return { ok: false, reason: 'digits_only' };

  // MVP: CJ/Hanjin 10~12
  if (carrier === 'CJ' || carrier === 'HANJIN') {
    if (t.length < 10 || t.length > 12) return { ok: false, reason: 'len_10_12' };
  }
  return { ok: true };
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  return res;
}

async function whoami() {
  const res = await api('/api/vendor/me');
  return res.json();
}

async function login(vendorId, password) {
  const res = await api('/api/vendor/login', {
    method: 'POST',
    body: JSON.stringify({ vendorId, password }),
  });
  return res.json();
}

async function logout() {
  await api('/api/vendor/logout', { method: 'POST', body: '{}' });
}

async function listOrders() {
  const res = await api('/api/vendor/orders');
  return res.json();
}

async function setTracking(productOrderNo, carrier, tracking) {
  const res = await api(`/api/vendor/orders/${encodeURIComponent(productOrderNo)}/tracking`, {
    method: 'POST',
    body: JSON.stringify({ carrier, tracking }),
  });
  return res.json();
}

function orderCard(o) {
  const tracking = o.tracking_number ? escapeHtml(o.tracking_number) : '';
  const carrier = o.carrier || 'HANJIN';

  return `
  <div class="rounded-lg border border-zinc-800 p-3">
    <div class="text-sm font-medium">${escapeHtml(o.product_name || '(상품명 없음)')}</div>
    <div class="text-xs text-zinc-400 mt-1">옵션: ${escapeHtml(o.option_info || '-') } · 수량: ${escapeHtml(o.qty || 0)}</div>

    <div class="mt-2 text-xs text-zinc-300">
      <div><span class="text-zinc-500">수취인</span> ${escapeHtml(o.recipient_name || '-') } · ${escapeHtml(o.recipient_phone || '-') }</div>
      <div class="mt-1"><span class="text-zinc-500">주소</span> ${escapeHtml(o.recipient_address || '-') }</div>
      <div class="mt-1"><span class="text-zinc-500">상품주문번호</span> ${escapeHtml(o.product_order_no)}</div>
    </div>

    <div class="mt-3 grid grid-cols-2 gap-2">
      <select data-carrier class="rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm">
        <option value="HANJIN" ${carrier === 'HANJIN' ? 'selected' : ''}>한진</option>
        <option value="CJ" ${carrier === 'CJ' ? 'selected' : ''}>CJ대한통운</option>
      </select>
      <input data-tracking value="${tracking}" placeholder="송장번호" class="rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm" />
    </div>
    <button data-save class="mt-2 w-full rounded-lg bg-emerald-400 text-zinc-950 py-2 text-sm font-semibold">저장</button>
    <div data-msg class="mt-2 text-xs"></div>
  </div>`;
}

async function renderOrders() {
  const wrap = document.getElementById('orders');
  wrap.innerHTML = '<div class="text-sm text-zinc-500">불러오는 중…</div>';
  const j = await listOrders();
  const items = j.orders || [];

  if (!items.length) {
    wrap.innerHTML = '<div class="text-sm text-zinc-500">주문 없음</div>';
    return;
  }

  wrap.innerHTML = items.map(orderCard).join('');

  wrap.querySelectorAll('button[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('div.rounded-lg');
      const productOrderNo = card.querySelector('div.mt-2 div.mt-1:last-child')?.textContent || '';
      const carrier = card.querySelector('select[data-carrier]').value;
      const raw = card.querySelector('input[data-tracking]').value;
      const tracking = normalizeTracking(raw);
      const msg = card.querySelector('[data-msg]');

      const v = validTracking(carrier, tracking);
      if (!v.ok) {
        msg.className = 'mt-2 text-xs text-red-300';
        msg.textContent = `형식 오류: ${v.reason}`;
        return;
      }

      btn.disabled = true;
      try {
        await setTracking(extractProductOrderNo(card), carrier, tracking);
        msg.className = 'mt-2 text-xs text-emerald-300';
        msg.textContent = '저장됨';
      } catch (e) {
        msg.className = 'mt-2 text-xs text-red-300';
        msg.textContent = String(e);
      } finally {
        btn.disabled = false;
      }
    });
  });
}

function extractProductOrderNo(card) {
  // use hidden structure: find line containing '상품주문번호'
  const lines = card.querySelectorAll('div.mt-2 div');
  for (const ln of lines) {
    if (ln.textContent.includes('상품주문번호')) {
      return ln.textContent.split('상품주문번호').pop().trim();
    }
  }
  return '';
}

async function boot() {
  const loginSec = document.getElementById('login');
  const appSec = document.getElementById('app');

  async function showLogin() {
    loginSec.classList.remove('hidden');
    appSec.classList.add('hidden');
  }

  async function showApp(me) {
    document.getElementById('me').textContent = `${me.vendorId} · ${me.name}`;
    loginSec.classList.add('hidden');
    appSec.classList.remove('hidden');
    await renderOrders();
  }

  try {
    const me = await whoami();
    await showApp(me);
  } catch {
    await showLogin();
  }

  document.getElementById('loginBtn').addEventListener('click', async () => {
    const vendorId = document.getElementById('vendorId').value.trim();
    const password = document.getElementById('password').value;
    const err = document.getElementById('loginErr');
    err.textContent = '';
    try {
      const me = await login(vendorId, password);
      await showApp(me);
    } catch (e) {
      err.textContent = String(e);
    }
  });

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    await logout();
    location.reload();
  });

  document.getElementById('refreshBtn').addEventListener('click', async () => {
    await renderOrders();
  });

  document.getElementById('exportBtn').addEventListener('click', async () => {
    window.location.href = '/api/vendor/orders.xlsx';
  });
}

boot();
