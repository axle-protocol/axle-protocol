function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function fmtTs(ts) {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
}

function cardTitle(item) {
  if (item.type === 'instagram_post_draft') return '📸 인스타 게시물 초안';
  if (item.type === 'smartstore_orders_export') return '📦 스마트스토어 · 주문 엑셀';
  if (item.type === 'smartstore_invoice_batch') return '🧾 스마트스토어 · 송장 입력';
  if (item.type === 'instagram_dm_draft') return '💬 인스타 DM 초안';
  if (item.type === 'instagram_comment_draft') return '🗨️ 인스타 댓글 초안';
  if (item.type === 'smartstore_ship_batch') return '🚚 스마트스토어 · 발송처리';
  if (item.type === 'smartstore_confirm_batch') return '✅ 스마트스토어 · 구매확인';
  return item.type;
}

function cardSubtitle(item) {
  const p = item.payload || {};
  switch (item.type) {
    case 'instagram_post_draft':
      return `@${p.account_username || 'unknown'} · ${p.scheduled_time ? `📅 ${fmtTs(p.scheduled_time)}` : '즉시/미정'}${p.ai_generated ? ' · 🤖 AI' : ''}`;
    case 'smartstore_orders_export':
      return `${p.store_name || '스토어'} · ${p.order_status_filter || ''} · ${p.date_range_start || ''}~${p.date_range_end || ''}`;
    case 'smartstore_invoice_batch':
      return `${p.store_name || '스토어'} · ${p.carrier_name || ''} ${p.invoice_count || ''}건${p.dry_run ? ' · ⚠️ dry_run' : ''}`;
    case 'instagram_dm_draft':
      return `→ @${p.recipient_username || 'unknown'}${p.ai_generated ? ' · 🤖 AI' : ''}`;
    case 'instagram_comment_draft':
      return `@${p.target_username || 'unknown'}${p.ai_generated ? ' · 🤖 AI' : ''}`;
    case 'smartstore_ship_batch':
      return `${p.orderCount || 0}건 발송 · ${item.source === 'scheduler' ? '🤖 자동' : '수동'}`;
    case 'smartstore_confirm_batch':
      return `${p.orderCount || 0}건 확인 · ${item.source === 'scheduler' ? '🤖 자동' : '수동'}`;
    default:
      return '';
  }
}

function cardPreview(item) {
  const p = item.payload || {};

  if (item.type === 'smartstore_ship_batch' || item.type === 'smartstore_confirm_batch') {
    const ids = p.orderIds || [];
    const preview = ids.slice(0, 5).join(', ');
    const more = ids.length > 5 ? ` ... +${ids.length - 5}건` : '';
    return escapeHtml(`${p.summary || ''}\n주문: ${preview}${more}`);
  }

  const text =
    item.type === 'instagram_post_draft'
      ? p.caption
      : item.type === 'instagram_dm_draft'
        ? p.message_text
        : item.type === 'instagram_comment_draft'
          ? p.comment_text
          : '';

  if (!text) return '';
  const lines = String(text).split('\n').slice(0, 3).join('\n');
  return escapeHtml(lines);
}

async function post(action, id) {
  const res = await fetch(`/api/queue/${encodeURIComponent(id)}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ actor: 'owner' }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t);
  }
  return res.json();
}

function render(items) {
  const el = document.getElementById('queue');
  const counts = document.getElementById('counts');
  const pending = items.filter((x) => x.state === 'pending').length;
  const needsAuth = items.filter((x) => x.state === 'needs_auth').length;
  counts.textContent = `pending ${pending} · needs_auth ${needsAuth}`;

  el.innerHTML = '';
  if (!items.length) {
    el.innerHTML = `<div class="text-sm text-zinc-500">큐가 비어있음</div>`;
    return;
  }

  for (const item of items) {
    const isAuth = item.state === 'needs_auth';
    const border = isAuth ? 'border-red-700/70' : 'border-zinc-800';
    const bg = isAuth ? 'bg-red-950/20' : 'bg-zinc-950/0';

    const preview = cardPreview(item);

    const actions =
      item.state === 'pending'
        ? `
          <div class="mt-3 flex gap-2">
            <button data-act="approve" data-id="${escapeHtml(item.id)}" class="flex-1 rounded-lg bg-emerald-400 text-zinc-950 py-2 text-sm font-semibold">승인</button>
            <button data-act="hold" data-id="${escapeHtml(item.id)}" class="flex-1 rounded-lg bg-zinc-800 py-2 text-sm font-medium">보류</button>
          </div>
        `
        : item.state === 'needs_auth'
          ? `
          <div class="mt-3 flex gap-2">
            <button data-act="auth_done" data-id="${escapeHtml(item.id)}" class="flex-1 rounded-lg bg-red-400 text-zinc-950 py-2 text-sm font-semibold">인증 완료(수동)</button>
            <button data-act="hold" data-id="${escapeHtml(item.id)}" class="flex-1 rounded-lg bg-zinc-800 py-2 text-sm font-medium">보류</button>
          </div>
        `
          : `
          <div class="mt-3 text-xs text-zinc-500">state: ${escapeHtml(item.state)} · updated: ${escapeHtml(fmtTs(item.updated_at))}</div>
        `;

    const node = document.createElement('div');
    node.className = `rounded-lg border ${border} ${bg} p-3`;
    node.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div>
          <div class="text-sm font-medium">${escapeHtml(cardTitle(item))}</div>
          <div class="text-xs text-zinc-400 mt-1">${escapeHtml(cardSubtitle(item))}</div>
        </div>
        <div class="text-xs ${isAuth ? 'text-red-300' : 'text-zinc-400'}">${escapeHtml(item.state)}</div>
      </div>
      ${preview ? `<pre class="mt-2 whitespace-pre-wrap text-xs text-zinc-200">${preview}</pre>` : ''}
      ${actions}
    `;

    el.appendChild(node);
  }

  el.querySelectorAll('button[data-act]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const act = btn.getAttribute('data-act');
      const id = btn.getAttribute('data-id');
      btn.disabled = true;
      try {
        await post(act, id);
        await refreshAll();
      } catch (e) {
        alert(String(e));
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function refreshHealth() {
  const el = document.getElementById('health');
  try {
    const res = await fetch('/api/health', { cache: 'no-store' });
    const j = await res.json();
    el.textContent = j.ok ? `OK · ${new Date(j.ts).toLocaleString()}` : 'NOT OK';
    el.className = 'text-lg font-medium text-emerald-300';
  } catch (e) {
    el.textContent = '연결 실패';
    el.className = 'text-lg font-medium text-red-300';
  }
}

async function refreshQueue() {
  const q = document.getElementById('search')?.value?.trim();
  const url = q ? `/api/queue?q=${encodeURIComponent(q)}` : '/api/queue';
  const res = await fetch(url, { cache: 'no-store' });
  const j = await res.json();
  render(j.items || []);
}

async function roadmapPost(action, payload) {
  const res = await fetch('/api/admin/roadmap', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

function renderRoadmap(items) {
  const el = document.getElementById('roadmap');
  if (!el) return;

  const sorted = [...(items || [])].sort((a, b) => {
    const ad = a.done ? 1 : 0;
    const bd = b.done ? 1 : 0;
    if (ad !== bd) return ad - bd;
    return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  });

  if (!sorted.length) {
    el.innerHTML = '<div class="text-sm text-zinc-500">할 일 없음</div>';
    return;
  }

  el.innerHTML = '';
  for (const it of sorted) {
    const row = document.createElement('div');
    row.className = 'flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-950/10 px-3 py-2';
    row.innerHTML = `
      <label class="flex items-center gap-2 text-sm ${it.done ? 'text-zinc-500 line-through' : 'text-zinc-200'}">
        <input type="checkbox" data-roadmap-toggle="${escapeHtml(it.id)}" ${it.done ? 'checked' : ''} />
        <span>${escapeHtml(it.text)}</span>
      </label>
      <button class="text-xs text-zinc-400 underline" data-roadmap-remove="${escapeHtml(it.id)}">삭제</button>
    `;
    el.appendChild(row);
  }

  el.querySelectorAll('input[data-roadmap-toggle]').forEach((cb) => {
    cb.addEventListener('change', async () => {
      const id = cb.getAttribute('data-roadmap-toggle');
      cb.disabled = true;
      try {
        await roadmapPost('toggle', { id });
        await refreshRoadmap();
      } catch (e) {
        alert(String(e));
      } finally {
        cb.disabled = false;
      }
    });
  });

  el.querySelectorAll('button[data-roadmap-remove]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.getAttribute('data-roadmap-remove');
      if (!confirm('삭제할까?')) return;
      btn.disabled = true;
      try {
        await roadmapPost('remove', { id });
        await refreshRoadmap();
      } catch (e) {
        alert(String(e));
      } finally {
        btn.disabled = false;
      }
    });
  });
}

async function refreshRoadmap() {
  const el = document.getElementById('roadmap');
  if (!el) return;
  const res = await fetch('/api/admin/roadmap', { cache: 'no-store' });
  const j = await res.json();
  renderRoadmap(j.items || []);
}

async function refreshAll() {
  await refreshHealth();
  await refreshQueue();
  await refreshRoadmap();
}

document.getElementById('refresh')?.addEventListener('click', refreshAll);
document.getElementById('search')?.addEventListener('input', () => {
  window.clearTimeout(window.__qTimer);
  window.__qTimer = window.setTimeout(refreshQueue, 250);
});

document.getElementById('roadmapAdd')?.addEventListener('click', async () => {
  const input = document.getElementById('roadmapText');
  const text = input?.value?.trim();
  if (!text) return;
  try {
    await roadmapPost('add', { text });
    input.value = '';
    await refreshRoadmap();
  } catch (e) {
    alert(String(e));
  }
});

document.getElementById('roadmapText')?.addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    document.getElementById('roadmapAdd')?.click();
  }
});

refreshAll();
