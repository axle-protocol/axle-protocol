function $(id){return document.getElementById(id)}

async function jget(url){
  const res = await fetch(url, { cache: 'no-store' });
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}
async function jpost(url, body){
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body||{}) });
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

let state = { vendors: [], products: [], mapping: [] };
let unassigned = [];

function renderVendors(){
  const sel = $('vendorSelect');
  sel.innerHTML = '';
  const sel2 = $('assignVendor');
  if (sel2) sel2.innerHTML = '';

  for(const v of state.vendors){
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = `${v.username} · ${v.name}`;
    sel.appendChild(opt);

    if (sel2) {
      const opt2 = document.createElement('option');
      opt2.value = v.id;
      opt2.textContent = `${v.username} · ${v.name}`;
      sel2.appendChild(opt2);
    }
  }
}

function renderItems(){
  const wrap = $('items');
  const q = ($('q').value||'').toLowerCase().trim();
  const vendorId = $('vendorSelect').value;

  const mapped = new Set(state.mapping.filter(m=>m.vendorId===vendorId).map(m=>m.productNo));
  const items = state.products.filter(p => !q || String(p.productName||'').toLowerCase().includes(q));

  wrap.innerHTML = '';
  if(!items.length){
    wrap.innerHTML = '<div class="p-3 text-sm text-zinc-500">상품 없음</div>';
    return;
  }

  for(const p of items.slice(0, 500)){
    const row = document.createElement('label');
    row.className = 'flex items-center gap-3 p-2 border-b border-zinc-900';
    row.innerHTML = `
      <input type="checkbox" data-product="${p.productNo}" ${mapped.has(p.productNo)?'checked':''} />
      <div class="text-sm">
        <div class="text-zinc-100">${p.productName}</div>
        <div class="text-xs text-zinc-500">${p.productNo}</div>
      </div>
    `;
    wrap.appendChild(row);
  }
}

function renderUnassigned(){
  const wrap = $('unassigned');
  if(!wrap) return;
  wrap.innerHTML = '';
  if(!unassigned.length){
    wrap.innerHTML = '<div class="p-3 text-sm text-zinc-500">미분류 주문 없음</div>';
    return;
  }
  for(const o of unassigned.slice(0, 300)){
    const row = document.createElement('label');
    row.className = 'flex items-center gap-3 p-2 border-b border-zinc-900';
    row.innerHTML = `
      <input type="checkbox" data-order="${o.id}" />
      <div class="text-sm">
        <div class="text-zinc-100">${(o.productName||'').slice(0,60)} <span class="text-xs text-zinc-500">x${o.qty||''}</span></div>
        <div class="text-xs text-zinc-500">상품주문번호: ${o.productOrderNo||o.id} · 상품번호: ${o.productNo||''}</div>
      </div>
    `;
    wrap.appendChild(row);
  }
}

async function refreshUnassigned(){
  try{
    const r = await jget('/api/admin/orders_unassigned');
    unassigned = r.orders || [];
    $('assignMsg').textContent = `미분류 ${unassigned.length}건`;
    renderUnassigned();
  }catch(e){
    $('assignMsg').textContent = String(e);
  }
}

function renderStats(stats){
  const el = $('stats');
  if(!el) return;
  const v = state.vendors?.length || 0;
  const p = state.products?.length || 0;
  const m = state.mapping?.length || 0;
  const total = stats?.total ?? '-';
  const un = stats?.unassigned ?? '-';
  el.textContent = `사장님 ${v}명 · 상품 ${p}개 · 매핑 ${m}개 · 주문 ${total}건 · 미분류 ${un}건`;
}

async function refreshAll(){
  const j = await jget('/api/admin/state');
  state = j;
  renderVendors();
  renderItems();
  await refreshUnassigned();
  try{
    const s = await jget('/api/admin/orders_stats');
    renderStats(s);
  }catch{
    renderStats(null);
  }
}

$('createVendor').addEventListener('click', async ()=>{
  $('vendorMsg').textContent='';
  try{
    const name = $('vName').value.trim();
    const username = $('vUsername').value.trim();
    const password = $('vPassword').value;
    const r = await jpost('/api/admin/vendors', { name, username, password });
    $('vendorMsg').textContent = `생성됨: ${r.vendor.username}`;
    await refreshAll();
  }catch(e){
    $('vendorMsg').textContent = String(e);
  }
});

$('uploadProducts').addEventListener('click', async ()=>{
  $('productMsg').textContent='';
  const f = $('csv').files?.[0];
  if(!f){ $('productMsg').textContent='CSV를 선택해줘'; return; }

  const text = await f.text();
  try{
    const r = await jpost('/api/admin/products_csv', { csv: text });
    $('productMsg').textContent = `업로드 OK: ${r.count}개`;
    await refreshAll();
  }catch(e){
    $('productMsg').textContent = String(e);
  }
});

$('refresh').addEventListener('click', refreshAll);
$('q').addEventListener('input', ()=>{ window.clearTimeout(window.__t); window.__t=setTimeout(renderItems, 200); });
$('vendorSelect').addEventListener('change', renderItems);

$('saveMapping').addEventListener('click', async ()=>{
  $('mapMsg').textContent='';
  const vendorId = $('vendorSelect').value;
  const checked = Array.from(document.querySelectorAll('#items input[type=checkbox]:checked')).map(x=>x.getAttribute('data-product'));
  try{
    const r = await jpost('/api/admin/mapping', { vendorId, productNos: checked });
    $('mapMsg').textContent = `저장 OK: ${r.count}개`;
    await refreshAll();
  }catch(e){
    $('mapMsg').textContent = String(e);
  }
});

async function uploadMultipart(url, { file, password }){
  const fd = new FormData();
  fd.append('password', password || '');
  fd.append('file', file);
  const res = await fetch(url, { method: 'POST', body: fd });
  if(!res.ok) throw new Error(await res.text());
  return res.json();
}

$('importOrders').addEventListener('click', async ()=>{
  $('importMsg').textContent='';
  const f = $('orderXlsx').files?.[0];
  const pw = $('orderPw').value;
  if(!f){ $('importMsg').textContent='xlsx를 선택해줘'; return; }
  if(!pw){ $('importMsg').textContent='암호를 입력해줘'; return; }
  $('importMsg').textContent='업로드/파싱 중…';
  try{
    const r = await uploadMultipart('/api/admin/orders_xlsx_import', { file: f, password: pw });
    $('importMsg').textContent = `OK: ${r.imported}건 (총 ${r.totalAfter}건) · 자동배정 ${r.assigned} · 미분류 ${r.unassigned}`;
  }catch(e){
    $('importMsg').textContent = String(e);
  }
});

$('downloadShipping')?.addEventListener('click', async ()=>{
  $('shipMsg').textContent='';
  const chunk = ($('shipChunk').value||'').trim();
  const size = ($('shipSize').value||'').trim();
  const qs = new URLSearchParams();
  if(chunk) qs.set('chunk', chunk);
  if(size) qs.set('size', size);
  const url = '/api/admin/shipping_export.xlsx' + (qs.toString()?`?${qs.toString()}`:'');
  $('shipMsg').textContent='다운로드 시작…';
  window.location.href = url;
});

$('refreshUnassigned')?.addEventListener('click', refreshUnassigned);

$('assignOrders')?.addEventListener('click', async ()=>{
  $('assignMsg').textContent='';
  const vendorId = $('assignVendor')?.value;
  const checked = Array.from(document.querySelectorAll('#unassigned input[type=checkbox]:checked')).map(x=>x.getAttribute('data-order'));
  if(!vendorId){ $('assignMsg').textContent='vendor 선택 필요'; return; }
  if(!checked.length){ $('assignMsg').textContent='선택된 주문 없음'; return; }
  try{
    const r = await jpost('/api/admin/orders_assign', { vendorId, orderIds: checked });
    $('assignMsg').textContent = `지정 OK: ${r.updated}건`;
    await refreshUnassigned();
  }catch(e){
    $('assignMsg').textContent = String(e);
  }
});

$('seedOrder').addEventListener('click', async ()=>{
  $('seedMsg').textContent='';
  const vendorId = $('vendorSelect').value;
  try{
    const r = await jpost('/api/admin/seed_order', { vendorId });
    $('seedMsg').textContent = `샘플 주문 생성됨: ${r.orderId}`;
  }catch(e){
    $('seedMsg').textContent = String(e);
  }
});

refreshAll();
