async function api(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json();
}

document.getElementById('loginBtn').addEventListener('click', async () => {
  const username = document.getElementById('username').value.trim();
  const password = document.getElementById('password').value;
  const err = document.getElementById('err');
  err.textContent = '';
  try {
    await api('/api/vendor/login', { username, password });
    location.href = '/vendor/orders';
  } catch (e) {
    err.textContent = String(e);
  }
});
