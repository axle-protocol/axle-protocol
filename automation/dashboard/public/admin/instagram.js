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

    // Collect optional 7-page detail fields
    const optionsObj = {};
    const o1n = $('#opt1Name')?.value?.trim(); if (o1n) optionsObj.name1 = o1n;
    const o1p = $('#opt1Price')?.value?.trim(); if (o1p) optionsObj.price1 = o1p;
    const o2n = $('#opt2Name')?.value?.trim(); if (o2n) optionsObj.name2 = o2n;
    const o2p = $('#opt2Price')?.value?.trim(); if (o2p) optionsObj.price2 = o2p;
    const o3n = $('#opt3Name')?.value?.trim(); if (o3n) optionsObj.name3 = o3n;
    const o3p = $('#opt3Price')?.value?.trim(); if (o3p) optionsObj.price3 = o3p;

    const payload = {
      productName,
      keyBenefit,
      price: $('#price').value || undefined,
      targetAudience: $('#targetAudience').value.trim() || undefined,
      notes: $('#notes').value.trim() || undefined,
      tone: $('#tone').value || undefined,
      options: Object.keys(optionsObj).length ? optionsObj : undefined,
      shipping: $('#shippingInfo')?.value?.trim() || undefined,
      returnPolicy: $('#returnInfo')?.value?.trim() || undefined,
      exchange: $('#exchangeInfo')?.value?.trim() || undefined,
      review1: $('#review1')?.value?.trim() || undefined,
      review2: $('#review2')?.value?.trim() || undefined,
      trustStat: $('#trustStat')?.value?.trim() || undefined,
      deadline: $('#deadline')?.value?.trim() || undefined,
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

  function imageStatusBadge(p) {
    const s = p.imageStatus || 'none';
    const map = {
      none: { color: 'bg-zinc-700 text-zinc-400', label: '이미지 없음' },
      generating: { color: 'bg-amber-500/20 text-amber-300', label: '생성 중...' },
      ready: { color: 'bg-emerald-500/20 text-emerald-300', label: '이미지 준비됨' },
      failed: { color: 'bg-red-500/20 text-red-300', label: '생성 실패' },
    };
    const m = map[s] || map.none;
    return `<span class="text-xs px-2 py-0.5 rounded-full ${m.color}">${m.label}</span>`;
  }

  function cardPreviewHtml(p) {
    if (!p.assets?.cards?.length) return '';
    const thumbs = p.assets.cards.map((c) =>
      `<a href="/api/admin/ig/posts/${p.id}/card/${c.index}" target="_blank" class="flex-shrink-0">
        <img src="/api/admin/ig/posts/${p.id}/card/${c.index}" alt="${escapeHtml(c.type)}"
          class="rounded-lg border border-zinc-700 h-28 w-auto object-cover hover:opacity-80 transition-opacity" />
      </a>`
    ).join('');
    return `<div class="flex gap-2 overflow-x-auto mt-2 pb-1">${thumbs}</div>`;
  }

  function imageActionsHtml(p) {
    const parts = [];
    if (p.status === 'approved' || p.status === 'sent') {
      const imgStatus = p.imageStatus || 'none';

      // Product image upload (HOOK hero)
      const hasProd = !!p.assets?.productImage;
      const prodBadge = hasProd
        ? `<span class="text-xs px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-300">업로드됨</span>`
        : `<span class="text-xs px-2 py-0.5 rounded-full bg-zinc-700 text-zinc-300">없음</span>`;
      const uploadedAt = hasProd ? (p.assets.productImage.uploadedAt || '') : '';

      parts.push(`
        <div class="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/10 p-2">
          <div class="flex items-center justify-between gap-2">
            <div class="text-xs text-zinc-500">상품 이미지(1페이지)</div>
            ${prodBadge}
          </div>
          ${uploadedAt ? `<div class="mt-1 text-[11px] text-zinc-500">업로드 시각: ${escapeHtml(uploadedAt)}</div>` : ''}
          <div class="mt-2 flex gap-2 items-center flex-wrap">
            <input type="file" accept="image/*" class="prod-img-file text-xs" data-prod-file="${p.id}" />
            <button class="prod-img-upload rounded-lg bg-zinc-800 px-3 py-1.5 text-xs hover:bg-zinc-700" data-prod-upload="${p.id}">업로드</button>
            <a class="text-xs text-zinc-400 underline" href="/api/admin/ig/posts/${p.id}/product_image" target="_blank">현재 이미지 보기</a>
          </div>
          <div class="mt-1 text-xs text-zinc-500">팁: 업로드 후 ‘카드 이미지 생성/재생성’하면 1페이지에 삽입됩니다.</div>
        </div>
      `);

      // Slide picker
      const savedSlides = p.assets?.slides || ['cover','why','options','trust','logistics','howto','cta'];
      const allSlideTypes = [
        { type: 'cover', label: '표지' }, { type: 'why', label: '장점' },
        { type: 'options', label: '옵션표' }, { type: 'trust', label: '후기/신뢰' },
        { type: 'logistics', label: '배송/교환' }, { type: 'howto', label: '주문방법' },
        { type: 'cta', label: 'CTA(마감)' },
      ];
      const slideRows = savedSlides.map((s, i) => {
        const info = allSlideTypes.find((t) => t.type === s) || { type: s, label: s };
        return `<div class="slide-row flex items-center gap-1 py-0.5" data-slide-type="${info.type}">
          <input type="checkbox" class="slide-check" data-slide="${info.type}" checked />
          <span class="text-xs text-zinc-300 flex-1">${escapeHtml(info.label)}</span>
          <button class="slide-up text-xs text-zinc-500 hover:text-zinc-300 px-1" data-idx="${i}"${i === 0 ? ' disabled' : ''}>▲</button>
          <button class="slide-down text-xs text-zinc-500 hover:text-zinc-300 px-1" data-idx="${i}"${i === savedSlides.length - 1 ? ' disabled' : ''}>▼</button>
        </div>`;
      }).join('');
      // Also add unchecked slides not in savedSlides
      const extraSlides = allSlideTypes.filter((t) => !savedSlides.includes(t.type)).map((info) =>
        `<div class="slide-row flex items-center gap-1 py-0.5" data-slide-type="${info.type}">
          <input type="checkbox" class="slide-check" data-slide="${info.type}" />
          <span class="text-xs text-zinc-300 flex-1">${escapeHtml(info.label)}</span>
        </div>`
      ).join('');

      parts.push(`
        <div class="mt-2 rounded-lg border border-zinc-800 bg-zinc-950/10 p-2 slide-picker" data-post-id="${p.id}">
          <div class="text-xs text-zinc-500 mb-1">슬라이드 선택/정렬 (3~7장)</div>
          <div class="slide-list">${slideRows}${extraSlides}</div>
          <div class="mt-1 text-[11px] text-zinc-600 slide-count-msg"></div>
        </div>
      `);

      if (imgStatus === 'none' || imgStatus === 'failed') {
        parts.push(`<button class="gen-img-btn rounded-lg bg-violet-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-violet-500" data-id="${p.id}">카드 이미지 생성</button>`);
      }
      if (imgStatus === 'ready') {
        parts.push(`<a href="/api/admin/ig/posts/${p.id}/package.zip" class="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-emerald-500 inline-block no-underline">ZIP 다운로드</a>`);
        parts.push(`<button class="gen-img-btn rounded-lg bg-zinc-700 text-zinc-300 px-3 py-1.5 text-xs hover:bg-zinc-600" data-id="${p.id}" data-regen="1">재생성</button>`);
      }
      if (imgStatus === 'failed' && p.imageError) {
        parts.push(`<span class="text-xs text-red-400">오류: ${escapeHtml(p.imageError)}</span>`);
      }
    }
    return parts.length ? `<div class="flex gap-2 flex-wrap items-center mt-2">${parts.join('')}</div>` : '';
  }

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
          ${imageStatusBadge(p)}
        </div>
        <div class="text-sm font-medium text-zinc-200 mb-1">${escapeHtml(p.productName)}</div>
        <div class="text-xs text-zinc-400 mb-1 whitespace-pre-wrap">${escapeHtml(preview)}</div>
        ${cardPreviewHtml(p)}
        <div class="text-xs text-zinc-600 mt-1">
          예정: ${escapeHtml(scheduledStr)} · 생성: ${escapeHtml(createdStr)}
          ${p.variants ? ` · 변형 ${p.variants.length}개` : ''}
        </div>
        ${imageActionsHtml(p)}
        ${actionsHtml}
      `;
      container.appendChild(card);
    }

    // Upload product image
    container.querySelectorAll('.prod-img-upload').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const postId = btn.getAttribute('data-prod-upload');
        const input = container.querySelector(`input[data-prod-file="${postId}"]`);
        const f = input?.files?.[0];
        if (!f) { alert('이미지 파일을 선택해주세요.'); return; }
        btn.disabled = true;
        btn.textContent = '업로드 중...';
        try {
          const fd = new FormData();
          fd.append('file', f);
          const res = await fetch(`/api/admin/ig/posts/${encodeURIComponent(postId)}/product_image`, { method: 'POST', body: fd });
          const j = await res.json().catch(() => ({}));
          if (!res.ok || !j.ok) throw new Error(j.detail || j.error || res.status);
          // 재렌더되면 버튼 텍스트는 원래대로 돌아가므로, 성공은 alert + 배지로 표시
          await loadQueue();
          alert('업로드 완료');
          btn.disabled = false;
          btn.textContent = '업로드';
        } catch (e) {
          alert('업로드 실패: ' + e.message);
          btn.disabled = false;
          btn.textContent = '업로드';
        }
      });
    });

    // Slide picker: reorder and count validation
    container.querySelectorAll('.slide-picker').forEach((picker) => {
      const list = picker.querySelector('.slide-list');
      const msg = picker.querySelector('.slide-count-msg');
      function updateSlideCount() {
        const checked = list.querySelectorAll('.slide-check:checked').length;
        if (msg) msg.textContent = checked < 3 ? '최소 3장을 선택해주세요.' : `${checked}장 선택됨`;
        if (msg) msg.className = 'mt-1 text-[11px] ' + (checked < 3 ? 'text-red-400' : 'text-zinc-600');
        // Disable gen buttons if < 3
        const postId = picker.dataset.postId;
        container.querySelectorAll(`.gen-img-btn[data-id="${postId}"]`).forEach((b) => {
          b.disabled = checked < 3;
          if (checked < 3) b.title = '최소 3장 선택 필요';
          else b.title = '';
        });
      }
      list.querySelectorAll('.slide-check').forEach((cb) => cb.addEventListener('change', updateSlideCount));
      list.querySelectorAll('.slide-up').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = btn.closest('.slide-row');
          const prev = row.previousElementSibling;
          if (prev) list.insertBefore(row, prev);
        });
      });
      list.querySelectorAll('.slide-down').forEach((btn) => {
        btn.addEventListener('click', () => {
          const row = btn.closest('.slide-row');
          const next = row.nextElementSibling;
          if (next) list.insertBefore(next, row);
        });
      });
      updateSlideCount();
    });

    // Generate images (sync — shows loading state)
    container.querySelectorAll('.gen-img-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const regen = btn.dataset.regen === '1';
        // Read slide selection from picker
        const picker = container.querySelector(`.slide-picker[data-post-id="${btn.dataset.id}"]`);
        let slides = null;
        if (picker) {
          const checked = Array.from(picker.querySelectorAll('.slide-row')).filter((r) => r.querySelector('.slide-check:checked')).map((r) => r.dataset.slideType);
          if (checked.length >= 3) slides = checked;
        }
        btn.disabled = true;
        btn.textContent = '이미지 생성 중...';
        btn.className = 'rounded-lg bg-zinc-700 text-amber-300 px-3 py-1.5 text-xs animate-pulse cursor-wait';
        try {
          const body = { regenerate: regen };
          if (slides) body.slides = slides;
          const r = await jpost(`/api/admin/ig/posts/${btn.dataset.id}/generate_images`, body);
          if (r.ok) {
            loadQueue();
          } else {
            alert('이미지 생성 오류: ' + (r.error || '') + (r.detail ? `\n${r.detail}` : ''));
            btn.disabled = false;
            btn.textContent = regen ? '재생성' : '카드 이미지 생성';
            btn.className = 'gen-img-btn rounded-lg bg-violet-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-violet-500';
          }
        } catch (e) {
          alert('요청 실패: ' + e.message);
          btn.disabled = false;
          btn.textContent = regen ? '재생성' : '카드 이미지 생성';
          btn.className = 'gen-img-btn rounded-lg bg-violet-600 text-white px-3 py-1.5 text-xs font-semibold hover:bg-violet-500';
        }
      });
    });

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
