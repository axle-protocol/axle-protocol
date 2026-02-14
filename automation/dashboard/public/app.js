async function refresh() {
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

document.getElementById('refresh')?.addEventListener('click', refresh);
refresh();
