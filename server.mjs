import "dotenv/config";
import express from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { createClient } from "@supabase/supabase-js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024, files: 10 } });
const DATA_DIR = path.join(__dirname, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const UPLOAD_DIR = path.join(DATA_DIR, "uploads");
const STORAGE_BUCKET = String(process.env.SUPABASE_BUCKET || "examkok-materials").trim();
fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(UPLOAD_DIR, { recursive: true });
if (!fs.existsSync(DB_FILE)) fs.writeFileSync(DB_FILE, JSON.stringify({ users: {} }, null, 2));

const SUPABASE_URL = String(process.env.SUPABASE_URL || "").trim();
const SUPABASE_PUBLISHABLE_KEY = String(process.env.SUPABASE_PUBLISHABLE_KEY || process.env.SUPABASE_ANON_KEY || "").trim();
const SUPABASE_SECRET_KEY = String(process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "").trim();
const cloudEnabled = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY && SUPABASE_SECRET_KEY);
if (process.env.NODE_ENV === "production" && !cloudEnabled) {
  console.error("Supabase configuration is required in production (SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, SUPABASE_SECRET_KEY).");
  process.exit(1);
}
const supabaseAdmin = cloudEnabled ? createClient(SUPABASE_URL, SUPABASE_SECRET_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const supabaseAuth = cloudEnabled ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false, autoRefreshToken: false } }) : null;
const SESSION_SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV === "production" ? "" : "examkok-dev-only-secret");
if (process.env.NODE_ENV === "production" && !SESSION_SECRET) {
  console.error("SESSION_SECRET is required in production.");
  process.exit(1);
}

app.use(express.json({ limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

function readDb(){ try { return JSON.parse(fs.readFileSync(DB_FILE, "utf8")); } catch { return { users: {} }; } }
function writeDb(db){ fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2)); }
function hashPassword(password, salt=crypto.randomBytes(16).toString("hex")){
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored){
  const [salt, hash] = String(stored||"").split(":");
  if(!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64);
  const target = Buffer.from(hash, "hex");
  return target.length === test.length && crypto.timingSafeEqual(target, test);
}
function parseCookies(req){
  return Object.fromEntries(String(req.headers.cookie||"").split(";").map(x=>x.trim()).filter(Boolean).map(x=>{const i=x.indexOf("="); return [decodeURIComponent(x.slice(0,i)), decodeURIComponent(x.slice(i+1))]}));
}
function b64url(value){ return Buffer.from(value).toString("base64url"); }
function sign(value){ return crypto.createHmac("sha256", SESSION_SECRET).update(value).digest("base64url"); }
function makeSession(user){
  const payload = b64url(JSON.stringify({ uid:user.uid, email:user.email, name:user.name || "학생", exp:Date.now()+30*24*60*60*1000 }));
  return `${payload}.${sign(payload)}`;
}
function readSession(req){
  const raw = parseCookies(req).examkok_session;
  if(!raw) return null;
  const [payload, sig] = raw.split(".");
  if(!payload || !sig) return null;
  const expected = sign(payload);
  const a=Buffer.from(sig), b=Buffer.from(expected);
  if(a.length!==b.length || !crypto.timingSafeEqual(a,b)) return null;
  try { const data=JSON.parse(Buffer.from(payload,"base64url").toString("utf8")); if(!data.exp || data.exp<Date.now()) return null; return data; } catch { return null; }
}
function setSession(res,user){
  const cookie = makeSession(user);
  res.setHeader("Set-Cookie",`examkok_session=${encodeURIComponent(cookie)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.NODE_ENV==='production'?'; Secure':''}`);
}
function clearSession(res){ res.setHeader("Set-Cookie",`examkok_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${process.env.NODE_ENV==='production'?'; Secure':''}`); }
function auth(req,res,next){ const s=readSession(req); if(!s) return res.status(401).json({error:"로그인이 필요합니다."}); req.user=s; next(); }
function emptyState(){ return { exam:{}, materials:[], wrong:[], ai:null, analyses:[], stats:{attempts:0,correct:0,bySubject:{}} }; }

async function getState(user){
  if(cloudEnabled){
    const { data, error } = await supabaseAdmin.from("student_states").select("state").eq("user_id",user.uid).maybeSingle();
    if(error) throw error;
    return data?.state || emptyState();
  }
  const db=readDb(); return db.users[user.email]?.state || emptyState();
}
async function putState(user,state){
  if(cloudEnabled){
    const { error } = await supabaseAdmin.from("student_states").upsert({ user_id:user.uid, state:state || {}, updated_at:new Date().toISOString() },{onConflict:"user_id"});
    if(error) throw error; return;
  }
  const db=readDb(); const u=db.users[user.email]; if(!u) throw new Error("사용자를 찾을 수 없습니다."); u.state=state || {}; u.updatedAt=new Date().toISOString(); writeDb(db);
}

app.post('/api/auth/register',async(req,res)=>{
  try{
    const email=String(req.body?.email||'').trim().toLowerCase(); const password=String(req.body?.password||''); const name=String(req.body?.name||'학생').trim() || '학생';
    if(!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({error:'이메일 형식을 확인해주세요.'});
    if(password.length<6) return res.status(400).json({error:'비밀번호는 6자 이상이어야 합니다.'});
    if(cloudEnabled){
      const { data, error } = await supabaseAdmin.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{name}});
      if(error) return res.status(error.message?.toLowerCase().includes('registered')?409:400).json({error:error.message || '회원가입에 실패했습니다.'});
      const user={uid:data.user.id,email,name}; await putState(user,emptyState()); setSession(res,user); return res.json({ok:true,user:{email,name}});
    }
    const db=readDb(); if(db.users[email]) return res.status(409).json({error:'이미 가입된 이메일입니다.'});
    const uid=crypto.randomUUID(); db.users[email]={uid,name,password:hashPassword(password),state:emptyState(),createdAt:new Date().toISOString()}; writeDb(db); const user={uid,email,name}; setSession(res,user); res.json({ok:true,user:{email,name}});
  }catch(e){res.status(500).json({error:e.message||'회원가입 중 오류가 발생했습니다.'});}
});
app.post('/api/auth/login',async(req,res)=>{
  try{
    const email=String(req.body?.email||'').trim().toLowerCase(); const password=String(req.body?.password||'');
    if(cloudEnabled){
      const { data, error } = await supabaseAuth.auth.signInWithPassword({email,password});
      if(error || !data.user) return res.status(401).json({error:'이메일 또는 비밀번호가 맞지 않습니다.'});
      const name=String(data.user.user_metadata?.name||'학생'); const user={uid:data.user.id,email:data.user.email||email,name}; setSession(res,user); return res.json({ok:true,user:{email:user.email,name}});
    }
    const db=readDb(); const u=db.users[email]; if(!u || !verifyPassword(password,u.password)) return res.status(401).json({error:'이메일 또는 비밀번호가 맞지 않습니다.'});
    const user={uid:u.uid||email,email,name:u.name||'학생'}; setSession(res,user); res.json({ok:true,user:{email,name:user.name}});
  }catch(e){res.status(500).json({error:e.message||'로그인 중 오류가 발생했습니다.'});}
});
app.post('/api/auth/logout',(_req,res)=>{clearSession(res);res.json({ok:true});});
app.get('/api/auth/me',auth,(req,res)=>res.json({user:{email:req.user.email,name:req.user.name}}));
app.get('/api/state',auth,async(req,res)=>{try{res.json({state:await getState(req.user)});}catch(e){res.status(500).json({error:e.message||'학습 데이터를 불러오지 못했습니다.'});}});
app.put('/api/state',auth,async(req,res)=>{try{await putState(req.user,req.body?.state||{});res.json({ok:true});}catch(e){res.status(500).json({error:e.message||'학습 데이터를 저장하지 못했습니다.'});}});


function safeName(name){ return String(name||"file").replace(/[^a-zA-Z0-9._가-힣-]+/g,"_").slice(-120); }
async function saveOriginalFiles(user, files){
  const saved=[];
  if(cloudEnabled){
    try {
      const { data: buckets } = await supabaseAdmin.storage.listBuckets();
      if(!buckets?.some(b=>b.name===STORAGE_BUCKET)) await supabaseAdmin.storage.createBucket(STORAGE_BUCKET,{public:false,fileSizeLimit:26214400});
    } catch {}
    for(const file of files){
      const key=`${user.uid}/${Date.now()}-${crypto.randomUUID()}-${safeName(file.originalname)}`;
      const { error }=await supabaseAdmin.storage.from(STORAGE_BUCKET).upload(key,file.buffer,{contentType:file.mimetype||"application/octet-stream",upsert:false});
      if(error) throw error;
      saved.push({name:file.originalname,size:file.size,type:file.mimetype||"",storage:"supabase",key});
    }
    return saved;
  }
  const dir=path.join(UPLOAD_DIR,user.uid); fs.mkdirSync(dir,{recursive:true});
  for(const file of files){
    const fname=`${Date.now()}-${crypto.randomUUID()}-${safeName(file.originalname)}`;
    fs.writeFileSync(path.join(dir,fname),file.buffer);
    saved.push({name:file.originalname,size:file.size,type:file.mimetype||"",storage:"local",key:`${user.uid}/${fname}`});
  }
  return saved;
}

function requireKey(req, res, next) { if (!process.env.OPENAI_API_KEY) return res.status(503).json({ error: "OPENAI_API_KEY가 서버에 설정되지 않았습니다." }); next(); }
async function uploadToOpenAI(file) {
  const form = new FormData(); form.append("purpose", "user_data"); form.append("file", new Blob([file.buffer], { type: file.mimetype || "application/octet-stream" }), file.originalname);
  const r = await fetch("https://api.openai.com/v1/files", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form }); const data = await r.json(); if (!r.ok) throw new Error(data?.error?.message || "파일 업로드 실패"); return data;
}
async function deleteOpenAIFile(id) { try { await fetch(`https://api.openai.com/v1/files/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` } }); } catch {} }
function parseJsonText(text) { const cleaned = String(text || "").trim().replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```$/i, "").trim(); return JSON.parse(cleaned); }
app.get("/api/health", (_req, res) => res.json({ ok: true, ai: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || "gpt-6-luna", auth:true, storage:cloudEnabled?"supabase":"local", originals:cloudEnabled?`supabase:${STORAGE_BUCKET}`:"local-files", version:"0.9.1" }));
app.post("/api/analyze", auth, requireKey, upload.array("files", 10), async (req, res) => {
  const files = req.files || []; if (!files.length) return res.status(400).json({ error: "분석할 사진/PDF/문서를 1개 이상 선택해주세요." });
  const { subject = "통합과학", materialType = "학교 프린트", memo = "", examRange = "" } = req.body || {}; const uploaded = []; let originals=[];
  try {
    originals = await saveOriginalFiles(req.user, files);
    for (const file of files) uploaded.push(await uploadToOpenAI(file));
    const prompt = `당신은 한국 고등학교 1학년 시험 대비 학습 코치입니다.\n과목: ${subject}\n자료 종류: ${materialType}\n시험 범위: ${examRange || "미입력"}\n사용자 메모: ${memo || "없음"}\n\n첨부 자료를 근거로 시험 대비 내용을 분석하세요. 추정으로 학교 고유 출제경향을 만들지 말고, 첨부 자료에서 확인되는 내용만 근거로 중요도를 정하세요.\n반드시 아래 JSON 형식만 반환하세요.\n{\n  "summary": "핵심 요약 3~6문장",\n  "topics": [{"title":"핵심 개념","importance":5,"reason":"자료 근거"}],\n  "quiz": [{"q":"객관식 문제","options":["보기1","보기2","보기3","보기4"],"answer":0,"explanation":"해설"}],\n  "flashcards": [{"front":"10초 암기 질문","back":"정답"}]\n}\n조건: topics 3~8개, quiz 5~10개, flashcards 5~12개. answer는 0부터 시작하는 보기 인덱스.`;
    const content = [{ type: "input_text", text: prompt }]; for (const f of uploaded) content.push({ type: "input_file", file_id: f.id });
    const rr = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-6-luna", input: [{ role: "user", content }] }) });
    const response = await rr.json(); if (!rr.ok) throw new Error(response?.error?.message || "AI 분석 실패");
    let outputText = ""; for (const item of response.output || []) for (const c of item.content || []) if (c.type === "output_text") outputText += c.text || "";
    const result=parseJsonText(outputText); res.json({ ok: true, result, originals, analysis:{id:crypto.randomUUID(),subject,materialType,memo,examRange,createdAt:new Date().toISOString(),fileCount:files.length,summary:result.summary||""} });
  } catch (e) { res.status(500).json({ error: e.message || "분석 중 오류가 발생했습니다." }); }
  finally { await Promise.all(uploaded.map(f => deleteOpenAIFile(f.id))); }
});
app.use((err, _req, res, _next) => { if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "파일 1개 크기는 최대 25MB입니다." }); if (err?.code === "LIMIT_FILE_COUNT") return res.status(413).json({ error: "한 번에 최대 10개 파일까지 분석할 수 있습니다." }); console.error(err); res.status(500).json({ error: "서버에서 처리 중 오류가 발생했습니다." }); });
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, "0.0.0.0", () => console.log(`Alexpapa 시험콕 V9.1: http://0.0.0.0:${port} | storage=${cloudEnabled?'supabase':'local'}`));
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
