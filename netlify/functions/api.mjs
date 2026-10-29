import { getStore } from "@netlify/blobs";
import crypto from "node:crypto";
import { unzipSync } from "fflate";
import userRoles from "../../user.json";
import CFG from "../../server.config.json";

export const config = { path: ["/api/*", "/f/*"] };

const store = (name) => getStore({ name, consistency: "strong" });
const SECRET = () => process.env.JWT_SECRET || "CHANGE_ME_SET_JWT_SECRET_ENV";

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });
const err = (msg, status = 400) => json({ error: msg }, status);

// ---------- auth helpers ----------
const b64 = (s) => Buffer.from(s).toString("base64url");
function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", SECRET()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verify(token) {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const good = crypto.createHmac("sha256", SECRET()).update(body).digest("base64url");
  if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
  const p = JSON.parse(Buffer.from(body, "base64url").toString());
  return p.exp > Date.now() ? p : null;
}
const hashPw = (pw, salt = crypto.randomBytes(16).toString("hex")) =>
  `${salt}:${crypto.scryptSync(pw, salt, 64).toString("hex")}`;
function checkPw(pw, stored) {
  const [salt, h] = stored.split(":");
  const test = crypto.scryptSync(pw, salt, 64);
  return crypto.timingSafeEqual(test, Buffer.from(h, "hex"));
}
const roleOf = (u) => userRoles[u.username] || u.role || CFG.defaultRole;
const roleInfo = (r) => CFG.roles[r] || CFG.roles[CFG.defaultRole];
const level = (r) => roleInfo(r).level;

async function currentUser(req) {
  const t = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
  const p = verify(t);
  if (!p) return null;
  const u = await store("users").get(p.u.toLowerCase(), { type: "json" });
  if (!u || u.banned) return null;
  return { ...u, role: roleOf(u) };
}
const publicUser = (u) => ({ username: u.username, role: roleOf(u), created: u.created, banned: !!u.banned });

// ---------- discord ----------
const COLORS = { register: 0x22c55e, login: 0x3b82f6, loginFailed: 0xef4444, upload: 0xa855f7, delete: 0xf97316, adminAction: 0xeab308, unzip: 0x06b6d4 };
async function log(event, title, fields = {}, req) {
  const url = process.env.DISCORD_WEBHOOK_URL;
  if (!url || !CFG.discord?.enabled || !CFG.discord.events?.[event]) return;
  const f = Object.entries(fields).map(([name, value]) => ({ name, value: String(value).slice(0, 1000) || "-", inline: true }));
  if (req) f.push({ name: "IP", value: req.headers.get("x-nf-client-connection-ip") || "unknown", inline: true });
  try {
    await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        username: CFG.discord.username || undefined,
        avatar_url: CFG.discord.avatarUrl || undefined,
        embeds: [{ title, color: COLORS[event], fields: f, timestamp: new Date().toISOString() }],
      }),
    });
  } catch {}
}

// ---------- files helpers ----------
async function allMeta() {
  const s = store("meta");
  const { blobs } = await s.list();
  const out = await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })));
  return out.filter(Boolean).sort((a, b) => b.created - a.created);
}
const ext = (n) => (n.includes(".") ? n.split(".").pop().toLowerCase() : "");

// ---------- router ----------
export default async (req) => {
  const url = new URL(req.url);
  const parts = url.pathname.split("/").filter(Boolean);
  const M = req.method;

  try {
    // Public file serving: /f/:id
    if (parts[0] === "f" && parts[1]) {
      const id = parts[1];
      const meta = await store("meta").get(id, { type: "json" });
      if (!meta) return new Response("File not found", { status: 404 });
      const data = await store("files").get(id, { type: "arrayBuffer" });
      if (!data) return new Response("File not found", { status: 404 });
      const dl = url.searchParams.has("download");
      return new Response(data, {
        headers: {
          "content-type": meta.type || "application/octet-stream",
          "content-disposition": `${dl ? "attachment" : "inline"}; filename="${encodeURIComponent(meta.name)}"`,
          "cache-control": "public, max-age=3600",
        },
      });
    }

    const route = parts.slice(1).join("/"); // after "api"

    if (route === "config" && M === "GET") {
      return json({
        allowRegistration: CFG.allowRegistration,
        adminPageRole: CFG.adminPageRole,
        roles: CFG.roles,
        allowedExtensions: CFG.allowedExtensions,
        blockedExtensions: CFG.blockedExtensions,
        minPasswordLength: CFG.minPasswordLength,
      });
    }

    if (route === "register" && M === "POST") {
      if (!CFG.allowRegistration) return err("Registration is disabled", 403);
      const { username = "", password = "" } = await req.json();
      if (!new RegExp(CFG.usernamePattern).test(username)) return err("Invalid username");
      if (password.length < CFG.minPasswordLength) return err(`Password must be at least ${CFG.minPasswordLength} characters`);
      const key = username.toLowerCase();
      if (CFG.defaultAdmin?.enabled && key === CFG.defaultAdmin.username.toLowerCase()) return err("Username taken", 409);
      if (await store("users").get(key)) return err("Username taken", 409);
      const u = { username, pw: hashPw(password), role: CFG.defaultRole, created: Date.now() };
      await store("users").setJSON(key, u);
      await log("register", "🆕 New registration", { User: username, Role: roleOf(u) }, req);
      return json({ token: sign({ u: username, exp: Date.now() + CFG.tokenLifetimeHours * 3600e3 }), user: publicUser(u) });
    }

    if (route === "login" && M === "POST") {
      const { username = "", password = "" } = await req.json();
      const DA = CFG.defaultAdmin;
      if (DA?.enabled && username.toLowerCase() === DA.username.toLowerCase() && password === (process.env.ADMIN_PASSWORD || DA.password)) {
        const k = DA.username.toLowerCase();
        let a = await store("users").get(k, { type: "json" });
        if (!a) { a = { username: DA.username, pw: hashPw(password), role: "admin", created: Date.now() }; }
        a.role = "admin"; a.banned = false; a.pw = hashPw(password);
        await store("users").setJSON(k, a);
        await log("login", "🔑 Admin login", { User: a.username }, req);
        return json({ token: sign({ u: a.username, exp: Date.now() + CFG.tokenLifetimeHours * 3600e3 }), user: publicUser(a) });
      }
      const u = await store("users").get(username.toLowerCase(), { type: "json" });
      if (!u || !checkPw(password, u.pw)) {
        await log("loginFailed", "⛔ Failed login", { User: username }, req);
        return err("Wrong username or password", 401);
      }
      if (u.banned) return err("This account is banned", 403);
      await log("login", "🔑 Login", { User: u.username, Role: roleOf(u) }, req);
      return json({ token: sign({ u: u.username, exp: Date.now() + CFG.tokenLifetimeHours * 3600e3 }), user: publicUser(u) });
    }

    const me = await currentUser(req);
    if (!me) return err("Not signed in", 401);

    if (route === "me") return json({ user: publicUser(me), limits: roleInfo(me.role), isAdmin: level(me.role) >= level(CFG.adminPageRole) });

    if (route === "files" && M === "GET") {
      const mine = (await allMeta()).filter((m) => m.owner === me.username);
      return json({ files: mine });
    }

    if (route === "upload" && M === "POST") {
      const form = await req.formData();
      const file = form.get("file");
      if (!file || typeof file === "string") return err("No file");
      const lim = roleInfo(me.role);
      const e = ext(file.name);
      if (CFG.allowedExtensions.length && !CFG.allowedExtensions.includes(e)) return err(`.${e} files are not allowed`);
      if (CFG.blockedExtensions.includes(e)) return err(`.${e} files are blocked`);
      if (file.size > lim.maxFileSizeMB * 1024 * 1024) return err(`Max file size for your role is ${lim.maxFileSizeMB} MB`);
      const mine = (await allMeta()).filter((m) => m.owner === me.username);
      if (mine.length >= lim.maxFiles) return err(`File limit reached (${lim.maxFiles})`);
      const id = crypto.randomBytes(5).toString("hex") + (e ? "." + e : "");
      await store("files").set(id, await file.arrayBuffer());
      const meta = { id, name: file.name, size: file.size, type: file.type, owner: me.username, created: Date.now() };
      await store("meta").setJSON(id, meta);
      await log("upload", "📤 File uploaded", { User: me.username, File: file.name, Size: `${(file.size / 1024).toFixed(1)} KB`, Link: `${url.origin}/f/${id}` }, req);
      return json({ file: meta, url: `${url.origin}/f/${id}` });
    }

    if (parts[1] === "files" && parts[2] && parts[3] === "unzip" && M === "POST") {
      if (!CFG.unzip?.enabled) return err("Unzip is disabled", 403);
      const id = parts[2];
      const meta = await store("meta").get(id, { type: "json" });
      if (!meta) return err("Not found", 404);
      if (meta.owner !== me.username) return err("Forbidden", 403);
      if (ext(meta.name) !== "zip") return err("Not a .zip file");
      const buf = new Uint8Array(await store("files").get(id, { type: "arrayBuffer" }));
      let entries;
      try { entries = unzipSync(buf); } catch { return err("Could not read this zip (corrupt or encrypted)"); }
      const lim = roleInfo(me.role);
      const names = Object.keys(entries).filter((n) => !n.endsWith("/") && !n.startsWith("__MACOSX/"));
      if (names.length > CFG.unzip.maxEntries) return err(`Zip has too many files (max ${CFG.unzip.maxEntries})`);
      const total = names.reduce((a, n) => a + entries[n].length, 0);
      if (total > CFG.unzip.maxTotalMB * 1024 * 1024) return err(`Unzipped size too big (max ${CFG.unzip.maxTotalMB} MB)`);
      const count = (await allMeta()).filter((m) => m.owner === me.username).length;
      const added = [], skipped = [];
      for (const full of names) {
        const name = full.split("/").pop();
        const e = ext(name);
        const bad = CFG.blockedExtensions.includes(e) || (CFG.allowedExtensions.length && !CFG.allowedExtensions.includes(e)) || ext(full.replace(/\.[^.]*$/, "")) && CFG.blockedExtensions.includes(ext(full.replace(/\.[^.]*$/, "")));
        if (bad) { skipped.push({ name: full, reason: "blocked type" }); continue; }
        if (entries[full].length > lim.maxFileSizeMB * 1024 * 1024) { skipped.push({ name: full, reason: "too large" }); continue; }
        if (count + added.length >= lim.maxFiles) { skipped.push({ name: full, reason: "file limit" }); continue; }
        const nid = crypto.randomBytes(5).toString("hex") + (e ? "." + e : "");
        await store("files").set(nid, entries[full]);
        const m = { id: nid, name, size: entries[full].length, type: "", owner: me.username, created: Date.now(), from: meta.name };
        await store("meta").setJSON(nid, m);
        added.push(m);
      }
      await log("unzip", "📦 Zip extracted", { User: me.username, Zip: meta.name, Extracted: added.length, Blocked: skipped.length }, req);
      return json({ added, skipped });
    }

    if (parts[1] === "files" && parts[2] && M === "DELETE") {
      const id = parts[2];
      const meta = await store("meta").get(id, { type: "json" });
      if (!meta) return err("Not found", 404);
      const canAny = level(me.role) >= level(CFG.adminPageRole) || (CFG.moderatorCanDeleteAnyFile && level(me.role) >= level("moderator"));
      if (meta.owner !== me.username && !canAny) return err("Forbidden", 403);
      await store("files").delete(id);
      await store("meta").delete(id);
      await log("delete", "🗑️ File deleted", { By: me.username, Owner: meta.owner, File: meta.name }, req);
      return json({ ok: true });
    }

    // ---------- admin ----------
    if (parts[1] === "admin") {
      if (level(me.role) < level(CFG.adminPageRole)) return err("Admins only", 403);
      const sub = parts[2];
      if (sub === "overview" && M === "GET") {
        const s = store("users");
        const { blobs } = await s.list();
        const users = (await Promise.all(blobs.map((b) => s.get(b.key, { type: "json" })))).filter(Boolean).map(publicUser);
        const files = await allMeta();
        return json({ users, files, totalSize: files.reduce((a, f) => a + f.size, 0) });
      }
      if (sub === "users" && parts[3] && M === "PATCH") {
        const key = parts[3].toLowerCase();
        const u = await store("users").get(key, { type: "json" });
        if (!u) return err("Not found", 404);
        const body = await req.json();
        if (body.role && CFG.roles[body.role]) u.role = body.role;
        if (typeof body.banned === "boolean") u.banned = body.banned;
        await store("users").setJSON(key, u);
        await log("adminAction", "🛡️ Admin updated user", { Admin: me.username, Target: u.username, Changes: JSON.stringify(body) }, req);
        return json({ user: publicUser(u), note: userRoles[u.username] ? "user.json overrides this user's role" : undefined });
      }
      if (sub === "users" && parts[3] && M === "DELETE") {
        const key = parts[3].toLowerCase();
        await store("users").delete(key);
        await log("adminAction", "🛡️ Admin deleted user", { Admin: me.username, Target: parts[3] }, req);
        return json({ ok: true });
      }
    }

    return err("Not found", 404);
  } catch (e) {
    console.error(e);
    return err("Server error: " + e.message, 500);
  }
};
