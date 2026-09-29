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
app.get("/api/health", (_req, res) => res.json({ ok: true, ai: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || "gpt-6-luna", auth:true, storage:cloudEnabled?"supabase":"local", originals:cloudEnabled?`supabase:${STORAGE_BUCKET}`:"local-files", version:"0.9.4" }));
app.post("/api/analyze", auth, requireKey, upload.array("files", 10), async (req, res) => {
  const files = req.files || []; if (!files.length) return res.status(400).json({ error: "분석할 사진/PDF/문서를 1개 이상 선택해주세요." });
  const { subject = "통합과학", materialType = "학교 프린트", memo = "", examRange = "" } = req.body || {}; const uploaded = []; let originals=[];
  try {
    originals = await saveOriginalFiles(req.user, files);
    for (const file of files) uploaded.push(await uploadToOpenAI(file));
    const prompt = `당신은 한국 고등학교 1학년 학생에게 과목을 처음부터 이해시키는 친절하고 매우 꼼꼼한 1:1 과외 선생님입니다.
과목: ${subject}
자료 종류: ${materialType}
시험 범위: ${examRange || "미입력"}
사용자 메모: ${memo || "없음"}

가장 중요한 목표는 문제를 빨리 만드는 것이 아니라, 학생이 교과서와 첨부자료의 내용을 처음부터 끝까지 이해하도록 쉽게 설명하는 것입니다. 첨부된 교과서, 학교 프린트, 수업 필기, 사진, PDF, 문서에 나온 내용을 빠뜨리지 말고 학습 순서대로 재구성하세요.

설명 원칙:
1) 먼저 전체 흐름을 잡아주세요. '이 단원에서 무엇을 배우는지 → 왜 배우는지 → 앞뒤 개념이 어떻게 연결되는지' 순서로 설명합니다.
2) 어려운 용어가 나오면 바로 쉬운 한국어로 뜻을 풀고, 가능한 경우 일상적인 예시나 비유를 붙입니다. 단, 비유가 실제 개념과 다른 부분은 분명히 구분합니다.
3) 단순 정의 암기보다 '왜 그런지', '어떤 과정으로 그렇게 되는지', '그래서 무엇이 달라지는지'를 설명합니다.
4) 교과서/첨부자료의 소제목, 문단, 표, 그림 설명, 공식, 사례, 선생님 표시 내용이 확인되면 빠뜨리지 말고 easy_lessons에 포함합니다.
5) 학생이 혼자 읽어도 이해되도록 문장을 짧고 자연스럽게 쓰고, 한 문단에 너무 많은 정보를 몰아넣지 마세요.
6) 과목별 설명 방식도 바꾸세요.
   - 과학: 현상 → 원인 → 과정 → 결과 → 실제 예
   - 수학: 개념 뜻 → 공식이 왜 나오는지 → 풀이 순서 → 대표 예제 → 실수 포인트
   - 영어: 문장 뜻 → 핵심 단어 → 문법 구조 → 자연스러운 해석 → 시험 포인트
   - 국어: 글/작품의 흐름 → 핵심 문장 → 표현/문법 → 주제 → 문제 포인트
   - 역사/사회: 시간·원인 → 사건/개념 → 결과 → 서로의 관계 → 비교
7) 첨부자료에 없는 학교 고유 출제경향, 선생님 의도, 사실을 추측하지 마세요. 필요한 경우 '자료에서 직접 확인되지 않음'이라고 적습니다.
8) 학생이 '이 설명만 읽어도 원자료의 핵심 내용을 이해할 수 있다'고 느낄 정도로 충분히 자세히 설명합니다.
9) 시험 대비는 이해 설명 뒤에 배치합니다. 이해 → 핵심정리 → 암기 → 문제 순서입니다.
10) JSON 이외의 문장은 절대 출력하지 마세요.

반드시 아래 JSON 구조로 반환하세요.
{
  "summary": "이 자료/단원의 전체 내용을 학생 눈높이에서 10~18문장으로 연결해 설명한 전체 설명",
  "overview": ["전체 흐름을 잡는 쉬운 문장 1", "쉬운 문장 2"],
  "easy_lessons": [
    {
      "title":"교과서/자료의 소단원 또는 설명 주제",
      "why":"이 내용을 배우는 이유 또는 앞뒤 개념과의 연결",
      "easy_explanation":"학생에게 말하듯 아주 쉽게 풀어쓴 충분한 설명. 필요하면 여러 문장 사용",
      "steps":["과정/순서 1","과정/순서 2"],
      "example":"이해를 돕는 교과서 속 사례 또는 안전한 일상 예시",
      "terms":[{"term":"어려운 용어","meaning":"쉬운 뜻"}],
      "check":"이 내용을 이해했는지 스스로 확인할 짧은 질문",
      "answer":"확인 질문의 짧은 답"
    }
  ],
  "topics": [
    {
      "title":"핵심 개념명",
      "importance":5,
      "definition":"정의 또는 무엇인지 쉽게 2~5문장",
      "principle":"왜/어떻게 그런지 원리·과정·인과관계 3~7문장",
      "exam_point":"시험에서 구분하거나 설명해야 할 포인트",
      "common_trap":"학생이 자주 헷갈리는 부분과 정확한 구분",
      "source_basis":"첨부자료에서 이 개념이 중요하다고 판단한 근거"
    }
  ],
  "comparisons": [
    {"title":"비교 주제","items":[{"name":"개념 A","points":["특징1","특징2"]},{"name":"개념 B","points":["특징1","특징2"]}]}
  ],
  "traps": [{"title":"헷갈리는 포인트","explanation":"무엇이 어떻게 다른지 쉬운 말로 설명"}],
  "written": [{"q":"서술형 예상 질문","model_answer":"고1 학생이 실제 시험에 쓸 수 있는 모범답안","scoring_points":["채점포인트1","채점포인트2"]}],
  "quiz": [{"q":"객관식 문제","options":["보기1","보기2","보기3","보기4"],"answer":0,"explanation":"정답 이유와 오답이 틀린 이유를 학생 눈높이로 설명"}],
  "flashcards": [{"front":"10초 암기 질문","back":"짧고 정확한 정답"}],
  "coverage_note":"자료가 흐리거나 일부 내용을 읽지 못했을 때만 한계 설명, 아니면 빈 문자열"
}

분량 기준:
- overview 8~15개
- easy_lessons: 첨부자료의 주요 소단원/문단 흐름을 빠뜨리지 않도록 6~20개. 자료가 길면 20개까지 충분히 사용
- topics 8~18개(자료가 짧으면 최소 5개)
- comparisons 0~6개, traps 4~12개, written 4~8개, quiz 8~12개, flashcards 8~15개
- importance는 1~5, answer는 0부터 시작하는 보기 인덱스
- 자료가 교과서라면 시험 범위 안의 내용을 가능한 한 전체적으로 설명하고, 프린트/필기/기타 첨부자료도 동일한 수준으로 쉽게 설명하세요.`;
    const content = [{ type: "input_text", text: prompt }]; for (const f of uploaded) content.push({ type: "input_file", file_id: f.id });
    const rr = await fetch("https://api.openai.com/v1/responses", { method: "POST", headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ model: process.env.OPENAI_MODEL || "gpt-6-luna", max_output_tokens: 9000, input: [{ role: "user", content }] }) });
    const response = await rr.json(); if (!rr.ok) throw new Error(response?.error?.message || "AI 분석 실패");
    let outputText = ""; for (const item of response.output || []) for (const c of item.content || []) if (c.type === "output_text") outputText += c.text || "";
    const result=parseJsonText(outputText); res.json({ ok: true, result, originals, analysis:{id:crypto.randomUUID(),subject,materialType,memo,examRange,createdAt:new Date().toISOString(),fileCount:files.length,summary:result.summary||""} });
  } catch (e) { res.status(500).json({ error: e.message || "분석 중 오류가 발생했습니다." }); }
  finally { await Promise.all(uploaded.map(f => deleteOpenAIFile(f.id))); }
});
app.use((err, _req, res, _next) => { if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "파일 1개 크기는 최대 25MB입니다." }); if (err?.code === "LIMIT_FILE_COUNT") return res.status(413).json({ error: "한 번에 최대 10개 파일까지 분석할 수 있습니다." }); console.error(err); res.status(500).json({ error: "서버에서 처리 중 오류가 발생했습니다." }); });
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, "0.0.0.0", () => console.log(`Alexpapa 시험콕 V9.5.1: http://0.0.0.0:${port} | storage=${cloudEnabled?'supabase':'local'}`));
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
