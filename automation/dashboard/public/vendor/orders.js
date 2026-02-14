function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeTracking(raw) {
  return String(raw || '').replace(/[\s-]/g, '').trim();
}

function validateTracking(carrier, tracking) {
  const t = normalizeTracking(tracking);
  if (!t) return { ok: false, reason: 'empty' };
  if (!/^\d+$/.test(t)) return { ok: false, reason: 'digits_only' };
  if (carrier === 'cj' || carrier === 'hanjin') {
    if (t.length < 10 || t.length > 12) return { ok: false, reason: 'len_10_12' };
  }
  return { ok: true, value: t };
}

async function getJson(path) {
  const res = await fetch(path);
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

async function postJson(path, body) {
  const res = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function orderCard(o) {
  const carrier = o.carrier || 'hanjin';
  const tracking = o.trackingNumber || '';

  return `
  <div class="rounded-lg border border-zinc-800 p-3" data-id="${escapeHtml(o.id)}">
    <div class="text-sm font-medium">${escapeHtml(o.productName || '-')}</div>
    <div class="text-xs text-zinc-400 mt-1">옵션: ${escapeHtml(o.optionInfo || '-') } · 수량: ${escapeHtml(o.qty || 0)}</div>

    <div class="mt-2 text-xs text-zinc-200">
      <div><span class="text-zinc-500">수취인</span> ${escapeHtml(o.recipientName || '-') } · ${escapeHtml(o.recipientPhone || '-') }</div>
      <div class="mt-1"><span class="text-zinc-500">주소</span> ${escapeHtml(o.recipientAddress || '-') }</div>
      <div class="mt-1"><span class="text-zinc-500">상품주문번호</span> ${escapeHtml(o.productOrderNo)}</div>
    </div>

    <div class="mt-3 grid grid-cols-2 gap-2">
      <select class="rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm" data-carrier>
        <option value="hanjin" ${carrier === 'hanjin' ? 'selected' : ''}>한진</option>
        <option value="cj" ${carrier === 'cj' ? 'selected' : ''}>CJ대한통운</option>
      </select>
      <input class="rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm" data-tracking value="${escapeHtml(tracking)}" placeholder="송장번호" />
    </div>
    <button class="mt-2 w-full rounded-lg bg-emerald-400 text-zinc-950 py-2 text-sm font-semibold" data-save>저장</button>
    <div class="mt-2 text-xs" data-msg></div>
  </div>`;
}

async function render() {
  const me = await getJson('/api/vendor/me');
  document.getElementById('me').textContent = `${me.vendor.username} · ${me.vendor.name}`;

  const list = await getJson('/api/vendor/orders');
  const wrap = document.getElementById('orders');
  const orders = list.orders || [];
  if (!orders.length) {
    wrap.innerHTML = '<div class="text-sm text-zinc-500">주문 없음</div>';
    return;
  }

  wrap.innerHTML = orders.map(orderCard).join('');

  wrap.querySelectorAll('[data-save]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-id]');
      const id = card.getAttribute('data-id');
      const carrier = card.querySelector('[data-carrier]').value;
      const raw = card.querySelector('[data-tracking]').value;
      const v = validateTracking(carrier, raw);
      const msg = card.querySelector('[data-msg]');

      if (!v.ok) {
        msg.className = 'mt-2 text-xs text-red-300';
        msg.textContent = `형식 오류: ${v.reason}`;
        return;
      }

      btn.disabled = true;
      try {
        await postJson(`/api/vendor/orders/${encodeURIComponent(id)}/tracking`, { carrier, number: v.value });
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

render();

document.getElementById('refreshBtn').addEventListener('click', () => location.reload());
document.getElementById('exportBtn').addEventListener('click', () => (window.location.href = '/api/vendor/orders.xlsx'));
document.getElementById('logoutBtn').addEventListener('click', async () => {
  await postJson('/api/vendor/logout', {});
  location.href = '/vendor/login';
});
