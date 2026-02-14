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

function renderVendors(){
  const sel = $('vendorSelect');
  sel.innerHTML = '';
  for(const v of state.vendors){
    const opt = document.createElement('option');
    opt.value = v.id;
    opt.textContent = `${v.username} · ${v.name}`;
    sel.appendChild(opt);
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

async function refreshAll(){
  const j = await jget('/api/admin/state');
  state = j;
  renderVendors();
  renderItems();
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
