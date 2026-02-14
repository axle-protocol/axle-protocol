(function () {
  'use strict';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  async function jget(url) {
    const r = await fetch(url);
    return r.json();
  }

  async function jpost(url, body) {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    return r.json();
  }

  // -------------------------
  // Tabs
  // -------------------------
  const tabs = ['generator', 'queue', 'guide'];

  function showTab(name) {
    tabs.forEach((t) => {
      const el = $(`#tab-${t}`);
      const btn = $(`.tab-btn[data-tab="${t}"]`);
      if (t === name) {
        el.classList.remove('hidden');
        btn.classList.add('bg-zinc-800', 'text-zinc-100');
        btn.classList.remove('text-zinc-500');
      } else {
        el.classList.add('hidden');
        btn.classList.remove('bg-zinc-800', 'text-zinc-100');
        btn.classList.add('text-zinc-500');
      }
    });
    if (name === 'guide') loadGuide();
    if (name === 'queue') loadQueue();
  }

  $$('.tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });

  // -------------------------
  // Brand Guide
  // -------------------------
  async function loadGuide() {
    try {
      const guide = await jget('/api/admin/ig/guide');
      $('#guideEditor').value = JSON.stringify(guide, null, 2);
    } catch (e) {
      $('#guideMsg').textContent = 'Load failed: ' + e.message;
    }
  }

  $('#saveGuide').addEventListener('click', async () => {
    const raw = $('#guideEditor').value;
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      $('#guideMsg').textContent = 'JSON 파싱 오류: ' + e.message;
      $('#guideMsg').className = 'mt-2 text-xs text-red-400';
      return;
    }
    const r = await jpost('/api/admin/ig/guide', parsed);
    $('#guideMsg').textContent = r.ok ? '저장 완료!' : '오류: ' + (r.error || '');
    $('#guideMsg').className = r.ok ? 'mt-2 text-xs text-emerald-400' : 'mt-2 text-xs text-red-400';
  });

  // -------------------------
  // Draft Generator
  // -------------------------
  let _currentPost = null;

  $('#generateBtn').addEventListener('click', async () => {
    const productName = $('#productName').value.trim();
    const keyBenefit = $('#keyBenefit').value.trim();
    if (!productName || !keyBenefit) {
      $('#genMsg').textContent = '상품명과 핵심 장점은 필수입니다.';
      $('#genMsg').className = 'mt-2 text-xs text-red-400';
      return;
    }
    $('#generateBtn').disabled = true;
    $('#generateBtn').textContent = '생성 중...';
    $('#genMsg').textContent = '';

    const payload = {
      productName,
      keyBenefit,
      price: $('#price').value || undefined,
      targetAudience: $('#targetAudience').value.trim() || undefined,
      notes: $('#notes').value.trim() || undefined,
      tone: $('#tone').value || undefined,
    };

    try {
      const r = await jpost('/api/admin/ig/posts', payload);
      if (r.ok && r.post) {
        $('#genMsg').textContent = `${r.post.variants.length}개 변형 생성 완료!`;
        $('#genMsg').className = 'mt-2 text-xs text-emerald-400';
        renderVariants(r.post);
      } else {
        $('#genMsg').textContent = '오류: ' + (r.error || JSON.stringify(r));
        $('#genMsg').className = 'mt-2 text-xs text-red-400';
      }
    } catch (e) {
      $('#genMsg').textContent = '요청 실패: ' + e.message;
      $('#genMsg').className = 'mt-2 text-xs text-red-400';
    } finally {
      $('#generateBtn').disabled = false;
      $('#generateBtn').textContent = '초안 생성 (5개 변형)';
    }
  });

  function renderVariants(post) {
    _currentPost = post;
    const container = $('#variants');
    container.innerHTML = '';

    if (!post.variants || post.variants.length === 0) {
      container.innerHTML = '<div class="text-sm text-zinc-500">변형이 없습니다.</div>';
      return;
    }

    post.variants.forEach((v, idx) => {
      const valid = v.validation?.valid;
      const errors = v.validation?.errors || [];
      const card = document.createElement('div');
      card.className = 'rounded-xl border bg-zinc-900/40 p-4 ' + (valid ? 'border-zinc-800' : 'border-red-800/50');

      const statusBadge = valid
        ? '<span class="text-xs bg-emerald-400/20 text-emerald-300 px-2 py-0.5 rounded-full">PASS</span>'
        : '<span class="text-xs bg-red-400/20 text-red-300 px-2 py-0.5 rounded-full">FAIL</span>';
      const ctaBadge = `<span class="text-xs bg-blue-400/20 text-blue-300 px-2 py-0.5 rounded-full">CTA ${escapeHtml(v.ctaType)}</span>`;
      const clusterBadge = `<span class="text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full">${escapeHtml(v.clusterName)}</span>`;

      let errorsHtml = '';
      if (errors.length > 0) {
        errorsHtml = '<div class="mt-2 text-xs text-red-400">' + errors.map((e) => `<div>· ${escapeHtml(e)}</div>`).join('') + '</div>';
      }

      card.innerHTML = `
        <div class="flex items-center gap-2 mb-2 flex-wrap">
          ${clusterBadge} ${ctaBadge} ${statusBadge}
        </div>
        <pre class="caption-text text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed mb-2">${escapeHtml(v.caption)}</pre>
        <div class="hashtag-text text-xs text-blue-400 break-all mb-2">${escapeHtml(v.hashtags)}</div>
        ${errorsHtml}
        <div class="flex gap-2 mt-3 flex-wrap">
          <button class="copy-caption rounded-lg bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700" data-idx="${idx}">캡션 복사</button>
          <button class="copy-tags rounded-lg bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700" data-idx="${idx}">해시태그 복사</button>
          <button class="copy-all rounded-lg bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700" data-idx="${idx}">전체 복사</button>
          ${valid && post.status === 'draft' ? `<button class="approve-btn rounded-lg bg-emerald-400 text-zinc-950 px-3 py-1.5 text-xs font-semibold hover:bg-emerald-300" data-post-id="${post.id}" data-variant-id="${v.id}">승인 &amp; 스케줄</button>` : ''}
        </div>
      `;

      container.appendChild(card);
    });

    // Copy caption
    container.querySelectorAll('.copy-caption').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = _currentPost.variants[Number(btn.dataset.idx)];
        navigator.clipboard.writeText(v.caption).then(() => {
          btn.textContent = '복사됨!';
          setTimeout(() => (btn.textContent = '캡션 복사'), 1500);
        });
      });
    });

    // Copy hashtags
    container.querySelectorAll('.copy-tags').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = _currentPost.variants[Number(btn.dataset.idx)];
        navigator.clipboard.writeText(v.hashtags).then(() => {
          btn.textContent = '복사됨!';
          setTimeout(() => (btn.textContent = '해시태그 복사'), 1500);
        });
      });
    });

    // Copy all (caption + hashtags)
    container.querySelectorAll('.copy-all').forEach((btn) => {
      btn.addEventListener('click', () => {
        const v = _currentPost.variants[Number(btn.dataset.idx)];
        navigator.clipboard.writeText(v.caption + '\n\n' + v.hashtags).then(() => {
          btn.textContent = '복사됨!';
          setTimeout(() => (btn.textContent = '전체 복사'), 1500);
        });
      });
    });

    // Approve
    container.querySelectorAll('.approve-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '승인 중...';
        try {
          const r = await jpost(`/api/admin/ig/posts/${btn.dataset.postId}/approve`, {
            variantId: btn.dataset.variantId,
          });
          if (r.ok) {
            btn.textContent = '승인 완료!';
            btn.className = 'rounded-lg bg-zinc-700 text-zinc-400 px-3 py-1.5 text-xs cursor-default';
            container.querySelectorAll(`.approve-btn[data-post-id="${btn.dataset.postId}"]`).forEach((b) => {
              if (b !== btn) b.remove();
            });
            _currentPost = r.post;
          } else {
            btn.textContent = '오류: ' + (r.error || '');
            btn.disabled = false;
          }
        } catch (e) {
          btn.textContent = '실패';
          btn.disabled = false;
        }
      });
    });
  }

  // -------------------------
  // Queue
  // -------------------------
  async function loadQueue() {
    const status = $('#statusFilter').value;
    const url = '/api/admin/ig/posts' + (status ? `?status=${status}` : '');
    try {
      const r = await jget(url);
      renderQueue(r.posts || []);
    } catch (e) {
      $('#queueList').innerHTML = `<div class="text-sm text-red-400">로드 실패: ${escapeHtml(e.message)}</div>`;
    }
  }

  $('#statusFilter').addEventListener('change', loadQueue);
  $('#refreshQueue').addEventListener('click', loadQueue);

  function renderQueue(posts) {
    const container = $('#queueList');
    const empty = $('#queueEmpty');

    if (posts.length === 0) {
      container.innerHTML = '';
      empty.classList.remove('hidden');
      return;
    }
    empty.classList.add('hidden');
    container.innerHTML = '';

    for (const p of posts) {
      const card = document.createElement('div');
      card.className = 'rounded-xl border border-zinc-800 bg-zinc-900/60 p-4';

      const statusColors = { draft: 'bg-zinc-600', approved: 'bg-emerald-600', sent: 'bg-blue-600', canceled: 'bg-red-600/60' };
      const statusLabels = { draft: '초안', approved: '승인됨', sent: '발송완료', canceled: '취소' };
      const statusColor = statusColors[p.status] || 'bg-zinc-600';
      const statusLabel = statusLabels[p.status] || p.status;

      const approvedVariant = p.approvedVariantId ? (p.variants || []).find((v) => v.id === p.approvedVariantId) : null;
      const previewCaption = approvedVariant ? approvedVariant.caption : p.variants?.[0]?.caption || '';
      const preview = previewCaption.length > 100 ? previewCaption.slice(0, 100) + '...' : previewCaption;

      const kstOpts = { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' };
      const scheduledStr = p.scheduledAt ? new Date(p.scheduledAt).toLocaleString('ko-KR', kstOpts) : '-';
      const createdStr = new Date(p.createdAt).toLocaleString('ko-KR', kstOpts);

      let actionsHtml = '';

      if (p.status === 'approved') {
        actionsHtml = `
          <div class="flex gap-2 flex-wrap items-center mt-3">
            <input type="datetime-local" class="reschedule-input rounded-lg bg-zinc-950 border border-zinc-800 px-2 py-1 text-xs" data-id="${p.id}" />
            <button class="reschedule-btn rounded-lg bg-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-600" data-id="${p.id}">일정 변경</button>
            <button class="mark-sent-btn rounded-lg bg-blue-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-blue-500" data-id="${p.id}">발송 완료</button>
            <button class="cancel-btn rounded-lg bg-red-500/20 text-red-300 px-3 py-1.5 text-xs hover:bg-red-500/30" data-id="${p.id}">취소</button>
          </div>`;
      }
      if (p.status === 'draft') {
        actionsHtml = `
          <div class="flex gap-2 flex-wrap items-center mt-3">
            <span class="text-xs text-zinc-500">"초안 생성" 탭에서 변형 선택 후 승인</span>
            <button class="cancel-btn rounded-lg bg-red-500/20 text-red-300 px-3 py-1.5 text-xs hover:bg-red-500/30" data-id="${p.id}">삭제</button>
          </div>`;
      }

      card.innerHTML = `
        <div class="flex items-center gap-2 mb-2 flex-wrap">
          <span class="text-xs text-white px-2 py-0.5 rounded-full ${statusColor}">${escapeHtml(statusLabel)}</span>
          ${p.ctaType ? `<span class="text-xs bg-blue-400/20 text-blue-300 px-2 py-0.5 rounded-full">CTA ${escapeHtml(p.ctaType)}</span>` : ''}
          ${p.slot ? `<span class="text-xs bg-zinc-700 text-zinc-300 px-2 py-0.5 rounded-full">${escapeHtml(p.slot)}</span>` : ''}
        </div>
        <div class="text-sm font-medium text-zinc-200 mb-1">${escapeHtml(p.productName)}</div>
        <div class="text-xs text-zinc-400 mb-1 whitespace-pre-wrap">${escapeHtml(preview)}</div>
        <div class="text-xs text-zinc-600">
          예정: ${escapeHtml(scheduledStr)} · 생성: ${escapeHtml(createdStr)}
          ${p.variants ? ` · 변형 ${p.variants.length}개` : ''}
        </div>
        ${actionsHtml}
      `;
      container.appendChild(card);
    }

    // Mark sent
    container.querySelectorAll('.mark-sent-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        btn.disabled = true;
        btn.textContent = '처리 중...';
        const r = await jpost(`/api/admin/ig/posts/${btn.dataset.id}/mark_sent`, {});
        if (r.ok) loadQueue();
        else { alert('오류: ' + (r.error || '')); btn.disabled = false; btn.textContent = '발송 완료'; }
      });
    });

    // Cancel
    container.querySelectorAll('.cancel-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('정말 취소/삭제하시겠습니까?')) return;
        btn.disabled = true;
        const r = await jpost(`/api/admin/ig/posts/${btn.dataset.id}/cancel`, {});
        if (r.ok) loadQueue();
        else { alert('오류: ' + (r.error || '')); btn.disabled = false; }
      });
    });

    // Reschedule
    container.querySelectorAll('.reschedule-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const input = container.querySelector(`.reschedule-input[data-id="${btn.dataset.id}"]`);
        if (!input?.value) { alert('날짜/시간을 선택해주세요.'); return; }
        btn.disabled = true;
        btn.textContent = '변경 중...';
        const r = await jpost(`/api/admin/ig/posts/${btn.dataset.id}/reschedule`, {
          scheduledAt: new Date(input.value).toISOString(),
        });
        if (r.ok) loadQueue();
        else { alert('오류: ' + (r.error || '')); btn.disabled = false; btn.textContent = '일정 변경'; }
      });
    });
  }

  // -------------------------
  // Init
  // -------------------------
  showTab('generator');
})();
