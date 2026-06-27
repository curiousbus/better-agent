// A self-contained admin page served at "/". Vanilla JS calls the /admin API
// with a JWT kept in localStorage. Intentionally dependency-free.
export const ADMIN_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>authz</title>
<style>
  :root { font-family: ui-sans-serif, system-ui, sans-serif; color: #111; }
  body { margin: 0; background: #fafafa; }
  main { max-width: 760px; margin: 40px auto; padding: 0 16px; }
  h1 { font-size: 18px; }
  input { padding: 8px; border: 1px solid #d4d4d4; border-radius: 6px; font: inherit; }
  button { padding: 8px 12px; border: 1px solid #111; background: #111; color: #fff; border-radius: 6px; cursor: pointer; font: inherit; }
  button.ghost { background: #fff; color: #111; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
  th, td { text-align: left; padding: 8px; border-bottom: 1px solid #eee; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; }
  .row { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; }
  .muted { color: #888; }
  .err { color: #c00; }
</style>
</head>
<body>
<main id="app"></main>
<script>
const api = (path, opts = {}) => {
  const t = localStorage.getItem("authz_token");
  return fetch("/admin" + path, {
    ...opts,
    headers: { "content-type": "application/json", ...(t ? { authorization: "Bearer " + t } : {}), ...(opts.headers || {}) },
  });
};
const app = document.getElementById("app");
function loginView(msg) {
  app.innerHTML = '<h1>authz admin</h1>' + (msg ? '<p class="err">' + msg + '</p>' : '') +
    '<div class="row"><input id="email" placeholder="email" /><input id="pw" type="password" placeholder="password" /><button id="login">Sign in</button></div>';
  document.getElementById("login").onclick = async () => {
    const r = await fetch("/admin/login", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: document.getElementById("email").value, password: document.getElementById("pw").value }) });
    if (!r.ok) { loginView("Invalid credentials"); return; }
    const { token } = await r.json();
    localStorage.setItem("authz_token", token);
    codesView();
  };
}
async function codesView() {
  const r = await api("/codes");
  if (r.status === 401) { localStorage.removeItem("authz_token"); loginView(); return; }
  const codes = await r.json();
  const rows = codes.map((c) =>
    '<tr><td><code>' + c.code + '</code></td><td>' + (c.label || '') + '</td><td>' + (c.source || '') +
    '</td><td>' + (c.active ? (c.redemptions + '/' + c.maxRedemptions) : '<span class="muted">revoked</span>') +
    '</td><td>' + (c.active ? '<button class="ghost" data-id="' + c.id + '">Revoke</button>' : '') + '</td></tr>').join("");
  app.innerHTML = '<div class="row" style="justify-content:space-between"><h1>Invite codes</h1><button id="out" class="ghost">Sign out</button></div>' +
    '<div class="row"><input id="label" placeholder="label" /><input id="source" placeholder="source" /><button id="create">Create code</button></div>' +
    '<table><thead><tr><th>Code</th><th>Label</th><th>Source</th><th>Used</th><th></th></tr></thead><tbody>' + rows + '</tbody></table>';
  document.getElementById("out").onclick = () => { localStorage.removeItem("authz_token"); loginView(); };
  document.getElementById("create").onclick = async () => {
    await api("/codes", { method: "POST", body: JSON.stringify({ label: document.getElementById("label").value, source: document.getElementById("source").value }) });
    codesView();
  };
  for (const b of document.querySelectorAll("button[data-id]")) {
    b.onclick = async () => { await api("/codes/" + b.dataset.id + "/revoke", { method: "POST" }); codesView(); };
  }
}
if (localStorage.getItem("authz_token")) { codesView(); } else { loginView(); }
</script>
</body>
</html>`;
