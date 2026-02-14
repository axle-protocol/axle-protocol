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
  const pending = !String(tracking || '').trim();

  const productName = (o.productName || o.product_name || '').trim();
  const optionInfo = (o.optionInfo || o.option_info || '').trim();
  const qty = Number(o.qty ?? o.quantity ?? 0);
  const productOrderNo = String(o.productOrderNo || o.product_order_no || o.id || '').trim();

  const recipientName = (o.recipientName || o.recipient_name || '').trim() || '-';
  const recipientPhone = (o.recipientPhone || o.recipient_phone || '').trim() || '-';
  const recipientAddress = (o.recipientAddress || o.recipient_address || '').trim() || '-';

  return `
  <div class="rounded-lg border ${pending ? 'border-amber-400/60 bg-amber-400/5' : 'border-zinc-800'} p-3" data-id="${escapeHtml(o.id)}">
    <div class="text-base font-semibold">${escapeHtml(productName || '-')}</div>
    <div class="text-sm text-zinc-300 mt-1">수량 <span class="font-semibold">${escapeHtml(qty || 0)}</span></div>
    <div class="text-xs text-zinc-500 mt-1">옵션: ${escapeHtml(optionInfo || '-') }</div>

    <div class="mt-3 rounded-lg border border-zinc-800 bg-zinc-950/30 p-3">
      <div class="text-xs text-zinc-500">배송정보 (마스킹 없음)</div>
      <div class="mt-1 text-lg font-semibold tracking-tight" data-recipient>${escapeHtml(recipientName)}</div>
      <div class="mt-1 text-base font-semibold" data-phone>${escapeHtml(recipientPhone)}</div>
      <div class="mt-2 text-sm text-zinc-100 break-words whitespace-pre-wrap" data-address>${escapeHtml(recipientAddress)}</div>

      <div class="mt-2 text-xs text-zinc-500">상품주문번호</div>
      <div class="text-sm font-mono text-zinc-200" data-pon>${escapeHtml(productOrderNo || '-')}</div>

      <div class="mt-3 flex gap-2">
        <button class="flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm" data-copy="phone">전화 복사</button>
        <button class="flex-1 rounded-lg bg-zinc-800 px-3 py-2 text-sm" data-copy="address">주소 복사</button>
      </div>
      <div class="mt-2 text-xs text-zinc-400" data-copy-msg></div>
    </div>

    <div class="mt-3 grid grid-cols-2 gap-2">
      <select class="rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm" data-carrier>
        <option value="hanjin" ${carrier === 'hanjin' ? 'selected' : ''}>한진</option>
        <option value="cj" ${carrier === 'cj' ? 'selected' : ''}>CJ대한통운</option>
      </select>
      <input class="rounded-lg bg-zinc-950 border border-zinc-800 px-3 py-2 text-sm" data-tracking value="${escapeHtml(tracking)}" placeholder="송장번호" />
    </div>
    <button class="mt-2 w-full rounded-lg bg-emerald-400 text-zinc-950 py-2 text-sm font-semibold" data-save>${pending ? '송장 저장(미처리)' : '송장 수정 저장'}</button>
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
    document.getElementById('pendingCount').textContent = '0';
    wrap.innerHTML = '<div class="text-sm text-zinc-500">주문 없음</div>';
    return;
  }

  const isPending = (o) => !String(o.trackingNumber || '').trim();
  const pending = orders.filter(isPending);
  document.getElementById('pendingCount').textContent = String(pending.length);

  // 미처리 먼저, 그 다음 최신순
  orders.sort((a, b) => {
    const ap = isPending(a) ? 0 : 1;
    const bp = isPending(b) ? 0 : 1;
    if (ap !== bp) return ap - bp;
    return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
  });

  wrap.innerHTML = orders.map(orderCard).join('');

  async function copyText(text){
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }

  wrap.querySelectorAll('[data-copy]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('[data-id]');
      const kind = btn.getAttribute('data-copy');
      const msg = card.querySelector('[data-copy-msg]');
      const val = kind === 'phone'
        ? card.querySelector('[data-phone]')?.textContent
        : card.querySelector('[data-address]')?.textContent;
      try {
        await copyText(String(val || ''));
        msg.textContent = '복사됨';
        msg.className = 'mt-2 text-xs text-emerald-300';
      } catch (e) {
        msg.textContent = '복사 실패';
        msg.className = 'mt-2 text-xs text-red-300';
      }
    });
  });

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
