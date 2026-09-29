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
app.post('/api/materials/delete-originals',auth,async(req,res)=>{try{const originals=Array.isArray(req.body?.originals)?req.body.originals:[];for(const o of originals){const key=String(o?.key||'');if(!key||!key.startsWith(req.user.uid+'/'))continue;if(o.storage==='supabase'&&cloudEnabled){const {error}=await supabaseAdmin.storage.from(STORAGE_BUCKET).remove([key]);if(error)throw error;}else if(o.storage==='local'){const full=path.join(UPLOAD_DIR,key);if(full.startsWith(path.join(UPLOAD_DIR,req.user.uid))&&fs.existsSync(full))fs.unlinkSync(full);}}res.json({ok:true});}catch(e){console.error('delete originals failed',e);res.status(500).json({error:e.message||'원본 자료 삭제 중 오류가 발생했습니다.'});}});


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
function extractOutputText(response) {
  let outputText = "";
  for (const item of response.output || []) {
    for (const c of item.content || []) {
      if (c.type === "output_text") outputText += c.text || "";
    }
  }
  return outputText.trim();
}

async function createStructuredResponse({ model, content, schemaName, schema, maxOutputTokens = 7000 }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 105000);
  try {
    const rr = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_output_tokens: maxOutputTokens,
        input: [{ role: "user", content }],
        text: {
          format: {
            type: "json_schema",
            name: schemaName,
            strict: true,
            schema
          }
        }
      })
    });
    const response = await rr.json();
    if (!rr.ok) throw new Error(response?.error?.message || "AI 분석 실패");
    if (response.status === "incomplete") {
      throw new Error(`AI 응답이 완성되기 전에 중단되었습니다. ${response?.incomplete_details?.reason || "출력 길이 초과 가능성"}`);
    }
    const outputText = extractOutputText(response);
    if (!outputText) throw new Error("AI가 빈 분석 결과를 반환했습니다.");
    try {
      return JSON.parse(outputText);
    } catch (e) {
      console.error("Structured output parse failure", { schemaName, length: outputText.length, preview: outputText.slice(-500) });
      throw new Error(`AI 결과 형식을 읽지 못했습니다. (${e.message})`);
    }
  } catch (e) {
    if (e?.name === "AbortError") throw new Error("AI 분석이 105초를 초과했습니다. 잠시 후 다시 시도해주세요.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const teachingSchema = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "overview", "easy_lessons", "topics", "comparisons", "traps", "coverage_note"],
  properties: {
    summary: { type: "string" },
    overview: { type: "array", items: { type: "string" } },
    easy_lessons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "why", "easy_explanation", "steps", "example", "terms", "check", "answer"],
        properties: {
          title: { type: "string" }, why: { type: "string" }, easy_explanation: { type: "string" },
          steps: { type: "array", items: { type: "string" } }, example: { type: "string" },
          terms: { type: "array", items: { type: "object", additionalProperties: false, required: ["term", "meaning"], properties: { term: { type: "string" }, meaning: { type: "string" } } } },
          check: { type: "string" }, answer: { type: "string" }
        }
      }
    },
    topics: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "importance", "definition", "principle", "exam_point", "common_trap", "source_basis"],
        properties: {
          title: { type: "string" }, importance: { type: "integer" }, definition: { type: "string" }, principle: { type: "string" },
          exam_point: { type: "string" }, common_trap: { type: "string" }, source_basis: { type: "string" }
        }
      }
    },
    comparisons: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "items"],
        properties: {
          title: { type: "string" },
          items: { type: "array", items: { type: "object", additionalProperties: false, required: ["name", "points"], properties: { name: { type: "string" }, points: { type: "array", items: { type: "string" } } } } }
        }
      }
    },
    traps: { type: "array", items: { type: "object", additionalProperties: false, required: ["title", "explanation"], properties: { title: { type: "string" }, explanation: { type: "string" } } } },
    coverage_note: { type: "string" }
  }
};

const practiceSchema = {
  type: "object",
  additionalProperties: false,
  required: ["written", "quiz", "flashcards"],
  properties: {
    written: { type: "array", items: { type: "object", additionalProperties: false, required: ["q", "model_answer", "scoring_points"], properties: { q: { type: "string" }, model_answer: { type: "string" }, scoring_points: { type: "array", items: { type: "string" } } } } },
    quiz: { type: "array", items: { type: "object", additionalProperties: false, required: ["q", "options", "answer", "explanation"], properties: { q: { type: "string" }, options: { type: "array", items: { type: "string" } }, answer: { type: "integer" }, explanation: { type: "string" } } } },
    flashcards: { type: "array", items: { type: "object", additionalProperties: false, required: ["front", "back"], properties: { front: { type: "string" }, back: { type: "string" } } } }
  }
};

app.get("/api/health", (_req, res) => res.json({ ok: true, ai: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || "gpt-6-luna", auth:true, storage:cloudEnabled?"supabase":"local", originals:cloudEnabled?`supabase:${STORAGE_BUCKET}`:"local-files", version:"0.9.7" }));

app.post("/api/analyze", auth, requireKey, upload.array("files", 10), async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ error: "분석할 사진/PDF/문서를 1개 이상 선택해주세요." });
  const { subject = "통합과학", materialType = "학교 프린트", memo = "", examRange = "" } = req.body || {};
  const uploaded = [];
  let originals=[];
  const started = Date.now();
  try {
    originals = await saveOriginalFiles(req.user, files);
    for (const file of files) uploaded.push(await uploadToOpenAI(file));
    const model = process.env.OPENAI_MODEL || "gpt-6-luna";
    const fileContent = uploaded.map(f => ({ type: "input_file", file_id: f.id }));

    const teachingPrompt = `당신은 한국 고등학교 1학년 학생에게 과목을 처음부터 이해시키는 친절하고 꼼꼼한 1:1 과외 선생님입니다.
과목: ${subject}\n자료 종류: ${materialType}\n시험 범위: ${examRange || "미입력"}\n사용자 메모: ${memo || "없음"}

최우선 목표는 학생이 첨부된 교과서/학교 프린트/필기/사진/PDF의 내용을 처음부터 끝까지 쉽게 이해하는 것입니다.
- 자료의 흐름 순서대로 설명하세요.
- 어려운 용어는 바로 쉬운 말로 풀이하세요.
- 정의만 말하지 말고 왜 그런지, 과정이 무엇인지, 결과가 무엇인지 설명하세요.
- 표/그림/공식/사례/강조표시가 읽히면 설명에 반영하세요.
- 자료에 없는 사실이나 선생님 의도는 추측하지 마세요.
- 과학은 현상→원인→과정→결과→예시, 수학은 개념→공식 이유→풀이 순서→예제→실수, 영어는 뜻→단어→문법→해석→시험포인트, 역사/사회는 원인→사건→결과→관계→비교 순서를 기본으로 하세요.
- summary는 8~12문장, overview 6~10개, easy_lessons 5~12개, topics 6~12개, traps 3~8개 정도로 충분하지만 불필요하게 장황하지 않게 작성하세요.
- easy_lessons의 easy_explanation은 학생이 원자료를 다시 보지 않아도 핵심 흐름을 이해할 정도로 구체적으로 작성하세요.`;

    const teaching = await createStructuredResponse({
      model,
      content: [{ type: "input_text", text: teachingPrompt }, ...fileContent],
      schemaName: "examkok_teaching",
      schema: teachingSchema,
      maxOutputTokens: 6500
    });

    const compactContext = JSON.stringify({
      subject,
      summary: teaching.summary,
      overview: teaching.overview,
      topics: teaching.topics.map(t => ({ title:t.title, definition:t.definition, principle:t.principle, exam_point:t.exam_point, common_trap:t.common_trap }))
    });
    const practicePrompt = `아래는 첨부 학습자료를 바탕으로 만든 핵심 설명입니다. 이 내용에만 근거해서 시험 대비 문제와 암기카드를 만드세요. 자료에 없는 사실은 추가하지 마세요.
${compactContext}

요구사항:
- written 3~5개: 고1 시험에 쓸 수 있는 서술형 질문, 모범답안, 채점포인트
- quiz 6~8개: 보기 4개, answer는 0~3 정수, 해설에는 정답 이유와 대표 오답 이유
- flashcards 8~12개: 10초 안에 확인할 수 있는 짧고 정확한 문답`;

    const practice = await createStructuredResponse({
      model,
      content: [{ type: "input_text", text: practicePrompt }],
      schemaName: "examkok_practice",
      schema: practiceSchema,
      maxOutputTokens: 4500
    });

    const result = { ...teaching, ...practice };
    console.log(`[analyze] ok subject=${subject} files=${files.length} ms=${Date.now()-started}`);
    res.json({ ok: true, result, originals, analysis:{id:crypto.randomUUID(),subject,materialType,memo,examRange,createdAt:new Date().toISOString(),fileCount:files.length,summary:result.summary||""} });
  } catch (e) {
    console.error(`[analyze] failed subject=${subject} files=${files.length} ms=${Date.now()-started}`, e);
    res.status(500).json({ error: e.message || "분석 중 오류가 발생했습니다." });
  } finally {
    await Promise.all(uploaded.map(f => deleteOpenAIFile(f.id)));
  }
});
app.use((err, _req, res, _next) => { if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "파일 1개 크기는 최대 25MB입니다." }); if (err?.code === "LIMIT_FILE_COUNT") return res.status(413).json({ error: "한 번에 최대 10개 파일까지 분석할 수 있습니다." }); console.error(err); res.status(500).json({ error: "서버에서 처리 중 오류가 발생했습니다." }); });
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, "0.0.0.0", () => console.log(`Alexpapa 시험콕 V9.7: http://0.0.0.0:${port} | storage=${cloudEnabled?'supabase':'local'}`));
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
