// Shared helpers: theme, nav, API, auth
const S = window.SITE;

(function applyTheme() {
  const r = document.documentElement.style;
  for (const [k, v] of Object.entries(S.theme)) if (typeof v === "string") r.setProperty("--" + k, v);
  if (S.theme.fontUrl) {
    const l = document.createElement("link"); l.rel = "stylesheet"; l.href = S.theme.fontUrl; document.head.appendChild(l);
  }
  document.title = document.title.replace("{name}", S.name);
  document.addEventListener("DOMContentLoaded", () => {
    if (S.theme.grid) document.body.classList.add("grid");
    if (S.theme.backgroundGlow) document.body.insertAdjacentHTML("afterbegin", '<div class="glow a"></div><div class="glow b"></div>');
    document.querySelectorAll("[data-site]").forEach((el) => (el.textContent = S[el.dataset.site]));
    renderNav();
  });
})();

const auth = {
  get token() { return localStorage.getItem("fh_token"); },
  get user() { try { return JSON.parse(localStorage.getItem("fh_user")); } catch { return null; } },
  save(t, u) { localStorage.setItem("fh_token", t); localStorage.setItem("fh_user", JSON.stringify(u)); },
  logout() { localStorage.removeItem("fh_token"); localStorage.removeItem("fh_user"); location.href = "/"; },
};

async function api(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (auth.token) headers.authorization = "Bearer " + auth.token;
  if (opts.json) { headers["content-type"] = "application/json"; opts.body = JSON.stringify(opts.json); }
  const res = await fetch("/api/" + path, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && auth.token && !path.startsWith("login")) auth.logout();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

async function renderNav() {
  const nav = document.querySelector("nav");
  if (!nav) return;
  const u = auth.user;
  let isAdmin = false;
  if (u) try { const me = await api("me"); isAdmin = me.isAdmin; auth.save(auth.token, me.user); } catch {}
  const logo = S.logoUrl ? `<img src="${S.logoUrl}" alt="">` : `<span>${S.logoEmoji}</span>`;
  const links = S.nav
    .filter((l) => (!l.auth || u) && (!l.admin || isAdmin))
    .map((l) => `<a href="${l.href}" class="${location.pathname === l.href ? "active" : ""}">${l.label}</a>`).join("");
  const right = u
    ? `${roleBadge(auth.user.role)} <a href="#" onclick="auth.logout()">Log out</a>`
    : `<a href="/login.html">Log in</a><a class="btn primary sm" href="/register.html">Sign up</a>`;
  nav.innerHTML = `<a class="brand" href="/">${logo}${S.name}</a><div class="links">${links}${right}</div>`;
  const f = document.querySelector("footer"); if (f) f.textContent = S.footer;
}

function roleBadge(role) {
  const c = S.roleColors[role] || S.theme.muted;
  return `<span class="badge" style="color:${c}">${esc(role)}</span>`;
}
function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function fmtSize(b) { const u = ["B", "KB", "MB", "GB"]; let i = 0; while (b >= 1024 && i < 3) { b /= 1024; i++; } return b.toFixed(i ? 1 : 0) + " " + u[i]; }
function toast(t) {
  let el = document.querySelector(".toast");
  if (!el) { el = document.createElement("div"); el.className = "toast"; document.body.appendChild(el); }
  el.textContent = t; el.classList.add("show"); clearTimeout(el._t); el._t = setTimeout(() => el.classList.remove("show"), 2200);
}
function requireLogin() { if (!auth.token) location.href = "/login.html"; }
