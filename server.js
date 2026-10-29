import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, "public");
const DATA = path.join(__dirname, "data");
const FILES = path.join(DATA, "files");
const DB = path.join(DATA, "db.json");
const CFG = JSON.parse(fs.readFileSync(path.join(__dirname, "server.config.json"), "utf8"));
const ROLE_OVERRIDES = JSON.parse(fs.readFileSync(path.join(__dirname, "user.json"), "utf8"));
fs.mkdirSync(FILES, { recursive: true });

const defaultDb = () => ({ users: {}, files: {} });
function readDb() {
  try { return JSON.parse(fs.readFileSync(DB, "utf8")); }
  catch { const d = defaultDb(); fs.writeFileSync(DB, JSON.stringify(d, null, 2)); return d; }
}
function writeDb(db) { fs.writeFileSync(DB, JSON.stringify(db, null, 2)); }
let db = readDb();
const b64 = (v) => Buffer.from(v).toString("base64url");
const secret = () => process.env.JWT_SECRET || "local-only-change-this-secret-before-deploying";
function hashPw(password, salt = crypto.randomBytes(16).toString("hex")) {
  return `${salt}:${crypto.scryptSync(password, salt, 64).toString("hex")}`;
}
function checkPw(password, stored) {
  if (!stored || typeof stored !== "string" || !stored.includes(":")) return false;
  const [salt, hash] = stored.split(":");
  const test = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, "hex");
  return expected.length === test.length && crypto.timingSafeEqual(test, expected);
}
function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const sig = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
function verify(token) {
  try {
    const [body, sig] = (token || "").split(".");
    if (!body || !sig) return null;
    const good = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
    if (sig.length !== good.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(good))) return null;
    const p = JSON.parse(Buffer.from(body, "base64url").toString());
    return p.exp > Date.now() ? p : null;
  } catch { return null; }
}
const roleOf = (u) => ROLE_OVERRIDES[u.username] || u.role || CFG.defaultRole;
const roleInfo = (r) => CFG.roles[r] || CFG.roles[CFG.defaultRole];
const level = (r) => roleInfo(r).level;
const pubUser = (u) => ({ username: u.username, role: roleOf(u), created: u.created, banned: !!u.banned, bio: u.bio || "", displayName: u.displayName || u.username });
function json(res, data, status=200) { res.status(status).json(data); }
function err(res, message, status=400) { return json(res, { error: message }, status); }
function getUser(req) {
  const p = verify((req.headers.authorization || "").replace(/^Bearer /, ""));
  if (!p) return null;
  const u = db.users[p.u.toLowerCase()];
  return u && !u.banned ? { ...u, role: roleOf(u) } : null;
}
function requireUser(req,res,next) {
  const u = getUser(req);
  if (!u) return err(res, "Not signed in", 401);
  req.user = u; next();
}
function isAdmin(u) { return level(u.role) >= level(CFG.adminPageRole); }
const storage = multer({ dest: FILES, limits: { fileSize: Math.max(...Object.values(CFG.roles).map(r=>r.maxFileSizeMB))*1024*1024 } });

app.use(express.json({ limit: "1mb" }));
app.use(express.static(PUBLIC));
app.get("/api/config", (req,res) => json(res, {
  allowRegistration: CFG.allowRegistration, adminPageRole: CFG.adminPageRole, roles: CFG.roles,
  allowedExtensions: CFG.allowedExtensions, blockedExtensions: CFG.blockedExtensions,
  minPasswordLength: CFG.minPasswordLength
}));
app.post("/api/register", (req,res) => {
  if (!CFG.allowRegistration) return err(res, "Registration is disabled", 403);
  const { username="", password="" } = req.body || {};
  if (!new RegExp(CFG.usernamePattern).test(username)) return err(res, "Username must be 3–20 letters, numbers, or underscores.");
  if (password.length < CFG.minPasswordLength) return err(res, `Password must be at least ${CFG.minPasswordLength} characters`);
  const key = username.toLowerCase();
  if (db.users[key]) return err(res, "Username taken", 409);
  const u = { username, pw: hashPw(password), role: CFG.defaultRole, created: Date.now(), displayName: username, bio: "" };
  db.users[key] = u; writeDb(db);
  return json(res, { token: sign({u: username, exp: Date.now()+CFG.tokenLifetimeHours*3600e3}), user: pubUser(u) });
});
app.post("/api/login", (req,res) => {
  const { username="", password="" } = req.body || {};
  const u = db.users[String(username).toLowerCase()];
  if (!u || !checkPw(password,u.pw)) return err(res, "Wrong username or password", 401);
  if (u.banned) return err(res, "This account is banned", 403);
  return json(res, { token: sign({u:u.username, exp:Date.now()+CFG.tokenLifetimeHours*3600e3}), user:pubUser(u) });
});
app.get("/api/me", requireUser, (req,res) => json(res, { user:pubUser(req.user), limits:roleInfo(req.user.role), isAdmin:isAdmin(req.user) }));
app.get("/api/profile", requireUser, (req,res) => json(res, { user:pubUser(req.user) }));
app.patch("/api/profile", requireUser, (req,res) => {
  const u = db.users[req.user.username.toLowerCase()];
  const { displayName, bio, currentPassword, newPassword } = req.body || {};
  if (typeof displayName === "string") u.displayName = displayName.trim().slice(0,60) || u.username;
  if (typeof bio === "string") u.bio = bio.trim().slice(0,300);
  if (newPassword) {
    if (!checkPw(currentPassword, u.pw)) return err(res, "Current password is incorrect", 403);
    if (newPassword.length < CFG.minPasswordLength) return err(res, `New password must be at least ${CFG.minPasswordLength} characters`);
    u.pw = hashPw(newPassword);
  }
  writeDb(db); return json(res, { user:pubUser(u), message:"Profile saved" });
});
app.get("/api/files", requireUser, (req,res) => {
  const files = Object.values(db.files).filter(f=>f.owner===req.user.username).sort((a,b)=>b.created-a.created);
  json(res,{files});
});
app.post("/api/upload", requireUser, (req,res) => {
  storage.single("file")(req,res,(e)=>{
    if (e) return err(res, e.code === "LIMIT_FILE_SIZE" ? "File exceeds the maximum upload size" : "Upload failed", 413);
    const file=req.file;
    if (!file) return err(res,"No file");
    const lim=roleInfo(req.user.role);
    const ext=path.extname(file.originalname).slice(1).toLowerCase();
    if (CFG.allowedExtensions.length && !CFG.allowedExtensions.includes(ext)) { fs.unlinkSync(file.path); return err(res, `.${ext} files are not allowed`); }
    if (CFG.blockedExtensions.includes(ext)) { fs.unlinkSync(file.path); return err(res, `.${ext} files are blocked`); }
    const mine=Object.values(db.files).filter(f=>f.owner===req.user.username);
    if (file.size > lim.maxFileSizeMB*1024*1024) { fs.unlinkSync(file.path); return err(res,`Max file size for your role is ${lim.maxFileSizeMB} MB`,413); }
    if (mine.length>=lim.maxFiles) { fs.unlinkSync(file.path); return err(res,`File limit reached (${lim.maxFiles})`,403); }
    const id=crypto.randomBytes(5).toString("hex")+(ext?"."+ext:"");
    fs.renameSync(file.path,path.join(FILES,id));
    const meta={id,name:file.originalname,size:file.size,type:file.mimetype,owner:req.user.username,created:Date.now()};
    db.files[id]=meta; writeDb(db);
    json(res,{file:meta,url:`${req.protocol}://${req.get("host")}/f/${id}`});
  });
});
app.get("/f/:id", (req,res) => {
  const f=db.files[req.params.id]; if(!f) return res.status(404).send("File not found");
  const p=path.join(FILES,req.params.id); if(!fs.existsSync(p)) return res.status(404).send("File not found");
  res.setHeader("Content-Type",f.type||"application/octet-stream");
  res.setHeader("Content-Disposition",`${req.query.download!==undefined?"attachment":"inline"}; filename*=UTF-8''${encodeURIComponent(f.name)}`);
  fs.createReadStream(p).pipe(res);
});
app.delete("/api/files/:id",requireUser,(req,res)=>{
  const f=db.files[req.params.id]; if(!f) return err(res,"Not found",404);
  const canAny=isAdmin(req.user)||(CFG.moderatorCanDeleteAnyFile&&level(req.user.role)>=level("moderator"));
  if(f.owner!==req.user.username&&!canAny) return err(res,"Forbidden",403);
  try{fs.unlinkSync(path.join(FILES,f.id));}catch{}
  delete db.files[f.id];writeDb(db);json(res,{ok:true});
});
app.get("/api/admin/overview",requireUser,(req,res)=>{
  if(!isAdmin(req.user)) return err(res,"Admins only",403);
  const users=Object.values(db.users).map(pubUser);
  const files=Object.values(db.files).sort((a,b)=>b.created-a.created);
  json(res,{users,files,totalSize:files.reduce((a,f)=>a+f.size,0)});
});
app.patch("/api/admin/users/:username",requireUser,(req,res)=>{
  if(!isAdmin(req.user)) return err(res,"Admins only",403);
  const u=db.users[req.params.username.toLowerCase()]; if(!u) return err(res,"Not found",404);
  const {role,banned}=req.body||{};
  if(role&&CFG.roles[role])u.role=role;
  if(typeof banned==="boolean")u.banned=banned;
  writeDb(db);json(res,{user:pubUser(u),note:ROLE_OVERRIDES[u.username]?"user.json overrides this user's role":undefined});
});
app.delete("/api/admin/users/:username",requireUser,(req,res)=>{
  if(!isAdmin(req.user)) return err(res,"Admins only",403);
  const key=req.params.username.toLowerCase(); if(!db.users[key])return err(res,"Not found",404);
  if(key===req.user.username.toLowerCase())return err(res,"You cannot delete your own account",403);
  delete db.users[key];writeDb(db);json(res,{ok:true});
});
app.get("/api/health",(req,res)=>json(res,{ok:true}));
app.get("*",(req,res,next)=>{
  const candidate=path.join(PUBLIC,req.path.replace(/^\/+/,""));
  if(req.path==="/"||!path.extname(req.path)) return res.sendFile(path.join(PUBLIC,"index.html"));
  next();
});
app.use((req,res)=>res.status(404).sendFile(path.join(PUBLIC,"404.html")));
function ensureOwner() {
  const key="admin";
  if (!db.users[key]) {
    db.users[key]={username:"admin",pw:hashPw("ChangeMe123!"),role:"admin",created:Date.now(),displayName:"Site Owner",bio:"Owner of Nebula File Host"};
    writeDb(db);
    console.log("Created owner account: username=admin, password=ChangeMe123! (change it after logging in)");
  }
}
ensureOwner();
app.listen(PORT,()=>console.log(`Nebula File Host running at http://localhost:${PORT}`));
