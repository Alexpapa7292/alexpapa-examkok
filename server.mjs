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

function parseRetrySeconds(message="") {
  const m=String(message).match(/try again in\s*(?:(\d+)h)?(?:(\d+)m)?([\d.]+)s/i);
  if(!m) return null;
  return (Number(m[1]||0)*3600)+(Number(m[2]||0)*60)+Math.ceil(Number(m[3]||0));
}
function aiHttpError(message, status=500) {
  const e=new Error(message||"AI 분석 실패"); e.status=status; e.retryAfterSeconds=parseRetrySeconds(message); return e;
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
    if (!rr.ok) throw aiHttpError(response?.error?.message || "AI 분석 실패", rr.status);
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
    if (e?.name === "AbortError") throw new Error("AI 분석이 180초를 초과했습니다. 잠시 후 다시 시도해주세요.");
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

const lessonSchema = {
  type: "object", additionalProperties: false,
  required: ["summary","overview","easy_lessons","coverage_note"],
  properties: {
    summary:{type:"string"},
    overview:{type:"array",items:{type:"string"}},
    easy_lessons:{type:"array",items:{type:"object",additionalProperties:false,required:["title","why","easy_explanation","steps","example","terms","check","answer"],properties:{
      title:{type:"string"},why:{type:"string"},easy_explanation:{type:"string"},steps:{type:"array",items:{type:"string"}},example:{type:"string"},
      terms:{type:"array",items:{type:"object",additionalProperties:false,required:["term","meaning"],properties:{term:{type:"string"},meaning:{type:"string"}}}},check:{type:"string"},answer:{type:"string"}
    }}},
    coverage_note:{type:"string"}
  }
};
const conceptSchema = {
  type:"object",additionalProperties:false,required:["topics","comparisons","traps"],properties:{
    topics:{type:"array",items:{type:"object",additionalProperties:false,required:["title","importance","definition","principle","exam_point","common_trap","source_basis"],properties:{title:{type:"string"},importance:{type:"integer"},definition:{type:"string"},principle:{type:"string"},exam_point:{type:"string"},common_trap:{type:"string"},source_basis:{type:"string"}}}},
    comparisons:{type:"array",items:{type:"object",additionalProperties:false,required:["title","items"],properties:{title:{type:"string"},items:{type:"array",items:{type:"object",additionalProperties:false,required:["name","points"],properties:{name:{type:"string"},points:{type:"array",items:{type:"string"}}}}}}}},
    traps:{type:"array",items:{type:"object",additionalProperties:false,required:["title","explanation"],properties:{title:{type:"string"},explanation:{type:"string"}}}}
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

const sourceDigestSchema = {
  type:"object", additionalProperties:false, required:["source_title","source_kind","scope_match","sections","key_facts","teacher_emphasis","questions","limitations"], properties:{
    source_title:{type:"string"}, source_kind:{type:"string"}, scope_match:{type:"string"},
    sections:{type:"array",items:{type:"object",additionalProperties:false,required:["title","summary"],properties:{title:{type:"string"},summary:{type:"string"}}}},
    key_facts:{type:"array",items:{type:"string"}},
    teacher_emphasis:{type:"array",items:{type:"string"}},
    questions:{type:"array",items:{type:"object",additionalProperties:false,required:["number","focus"],properties:{number:{type:"string"},focus:{type:"string"}}}},
    limitations:{type:"string"}
  }
};

const CONFIRMED_REFERENCE_MATERIALS={
  "공통수학2": [
    "마더텅 기출문제집 원본 확인. 시험범위는 p4 평면좌표부터 p165 집합, 그리고 p304~p321. 확인된 초반 내용에는 평면좌표, 두 점 사이의 거리, 선분의 내분, 삼각형의 무게중심 문제 등이 포함된다."
  ],
  "통합사회2": [
    "지리 1차 수업자료 확인: 세계 주요 종교의 분포와 특징, 문화권, 세계화와 지역화 관련 내용.",
    "3단원 수업노트1 확인: 시장경제와 지속가능발전, 자본주의의 의미와 특징, 상업 자본주의·산업 자본주의·수정 자본주의·신자유주의, 경제 체제 비교.",
    "3단원 수업노트2 확인: 경제 체제에 따른 다양한 삶의 방식, 전통·계획·시장·혼합 경제 체제, 효율성과 형평성.",
    "수업노트3 확인: 합리적 선택과 경제 주체의 역할, 생산·분배·소비, 희소성, 편익·기회비용·매몰비용, 가계·기업·정부의 역할, 시장 실패."
  ],
  "통합과학2": [
    "하남고 지구과학 프린트 확인: 지질 시대의 환경과 생물. 화석의 생성, 시상 화석과 표준 화석, 지질 시대의 구분, 선캄브리아·고생대 등 환경과 생물 변화.",
    "하남고 지구과학 프린트 확인: 지구 환경 변화와 인간 생활. 지구 복사 평형과 온실 효과, 지구 열수지, 지구 온난화, 대기 대순환과 해수 표층 순환, 엘니뇨와 사막화."
  ]
};
function confirmedReferenceText(subject){return (CONFIRMED_REFERENCE_MATERIALS[subject]||[]).map((x,i)=>`${i+1}. ${x}`).join("\n");}

app.get("/api/health", (_req, res) => res.json({ ok: true, ai: Boolean(process.env.OPENAI_API_KEY), model: process.env.OPENAI_MODEL || "gpt-6-luna", auth:true, storage:cloudEnabled?"supabase":"local", originals:cloudEnabled?`supabase:${STORAGE_BUCKET}`:"local-files", version:"10.1" }));

app.post("/api/analyze", auth, requireKey, upload.array("files", 10), async (req, res) => {
  const files = req.files || [];
  const { subject = "통합과학", materialType = "학교 프린트", memo = "", examRange = "", textbookInfo = "" } = req.body || {};
  const confirmedReference = confirmedReferenceText(subject);
  const uploaded = [];
  let originals=[];
  const started = Date.now();
  try {
    if (files.length) originals = await saveOriginalFiles(req.user, files);
    for (const file of files) uploaded.push(await uploadToOpenAI(file));
    const model = process.env.OPENAI_MODEL || "gpt-6-luna";
    const fileContent = uploaded.map(f => ({ type: "input_file", file_id: f.id }));

    let sourceDigest = null;
    if (files.length) {
      const digestPrompt = `한국 고등학교 시험공부용 원자료를 읽고, 이후 과외노트 생성에 필요한 사실만 압축 추출하세요.
과목: ${subject}
자료 종류: ${materialType}
시험 범위: ${examRange || "미입력"}
사용자 메모: ${memo || "없음"}

중요:
- 첨부파일을 읽는 호출은 이번 1회뿐이므로 범위 안 핵심 사실과 단원 구조를 빠뜨리지 마세요.
- 전국연합학력평가/모의고사이면 시험범위에 지정된 문항 번호를 우선 식별하고, 각 문항의 핵심 독해·문법·개념 포인트를 questions에 기록하세요.
- 선생님 필기, 빈칸, 별표, 반복, 정답 표시 등 강조 흔적이 보이면 teacher_emphasis에 기록하세요.
- 파일에서 확인되지 않는 내용은 만들지 마세요.
- 이후 단계가 이 요약만 보고도 충분히 과외노트를 만들 수 있도록 구체적으로 작성하되 장황한 원문 복사는 피하세요.`;
      sourceDigest = await createStructuredResponse({model,content:[{type:"input_text",text:digestPrompt},...fileContent],schemaName:"examkok_source_digest",schema:sourceDigestSchema,maxOutputTokens:3600});
    }
    const digestText = sourceDigest ? JSON.stringify(sourceDigest) : "첨부 원본 없음";

    const sharedRules = `당신은 한국 고등학교 1학년 학생에게 과목을 처음부터 이해시키는 친절하고 꼼꼼한 1:1 과외 선생님입니다.
과목: ${subject}
자료 종류: ${materialType}
시험 범위: ${examRange || "미입력"}
확인된 교과서 정보: ${textbookInfo || "미등록"}
확인된 학교자료 참고정보: ${confirmedReference || "미등록"}
첨부 원자료 1차 압축노트: ${digestText}
첨부자료 상태: ${files.length ? `첨부 ${files.length}개 읽기 완료` : "첨부 없음 - 시험범위와 교과 일반지식 기반으로 설명"}
사용자 메모: ${memo || "없음"}

공통 원칙:
- 첨부자료가 있으면 첨부자료를 최우선 근거로 사용합니다.
- 부교재·프린트·수업노트 원본이 없으면 구체적인 문장·문제·표·그림을 추정하지 않습니다.
- 전국연합학력평가는 별도 범위로 인식하되 시험지 원문이 없으면 실제 지문/문항을 본 것처럼 만들지 않습니다.
- 어려운 용어는 바로 쉬운 말로 풀이하고, 정의만 적지 말고 왜 그런지와 과정·결과·예시를 연결합니다.
- 과학: 현상→원인→과정→결과→예시 / 수학: 개념→공식 이유→풀이 순서→대표예제→실수 / 영어: 뜻→단어→문법→자연스러운 해석→시험포인트 / 역사·사회: 배경·원인→전개→결과→의미→비교 순서를 기본으로 합니다.
- 학생이 원자료를 다시 펼치지 않아도 흐름이 잡힐 정도로 충분히 설명하되, 근거 없는 내용은 추가하지 않습니다.`;

    const lessonPrompt = sharedRules + `\n\n[1차: 이해 중심 심화 설명]\n짧은 요약문으로 끝내지 마세요. summary 7~10문장, overview 7~10개, easy_lessons 6~9개를 작성하세요. easy_lessons마다 쉬운 설명은 최소 4~7문장으로 하고, 반드시 왜 배우는지·과정/원리·대표 예시·용어 풀이·이해확인 질문을 포함하세요. 시험범위가 넓으면 큰 단원을 빠뜨리지 말고 고르게 다루세요. coverage_note에는 첨부 유무와 근거의 한계를 명확히 적으세요.`;
    let lessons;
    try {
      lessons = await createStructuredResponse({model,content:[{type:"input_text",text:lessonPrompt}],schemaName:"examkok_lessons",schema:lessonSchema,maxOutputTokens:7600});
    } catch(e) {
      const msg=String(e?.message||"");
      if(!/max_output_tokens|완성되기 전에 중단|출력 길이/i.test(msg)) throw e;
      lessons = await createStructuredResponse({model,content:[{type:"input_text",text:sharedRules+`\n\n[1차 재시도]\nsummary 6문장, overview 6개, easy_lessons 정확히 5개. 각 쉬운 설명은 3~5문장으로 핵심을 빠짐없이 설명하세요.`}],schemaName:"examkok_lessons_compact",schema:lessonSchema,maxOutputTokens:6500});
    }

    const conceptPrompt = sharedRules + `\n\n[2차: 시험 핵심 심화 정리]\n시험 대비용으로 topics 8~12개, comparisons 2~4개, traps 4~7개를 작성하세요. 각 topic은 정의만 한 줄 쓰지 말고 원리/흐름을 3~6문장으로 설명하세요. exam_point는 실제 시험에서 무엇을 구분하고 어떤 식으로 묻기 쉬운지 구체적으로 쓰세요. 반드시 외워야 하거나 출제 가능성이 높은 내용은 importance 5로 표시하세요. common_trap에는 학생이 흔히 틀리는 구분을 구체적으로 적으세요.`;
    let concepts;
    try {
      concepts = await createStructuredResponse({model,content:[{type:"input_text",text:conceptPrompt}],schemaName:"examkok_concepts",schema:conceptSchema,maxOutputTokens:7200});
    } catch(e) {
      const msg=String(e?.message||"");
      if(!/max_output_tokens|완성되기 전에 중단|출력 길이/i.test(msg)) throw e;
      concepts = await createStructuredResponse({model,content:[{type:"input_text",text:sharedRules+`\n\n[2차 재시도]\ntopics 정확히 7개, comparisons 최대 2개, traps 4개. 각 항목은 짧지만 시험에 필요한 원리와 구분을 반드시 포함하세요.`}],schemaName:"examkok_concepts_compact",schema:conceptSchema,maxOutputTokens:6000});
    }
    const teaching={...lessons,...concepts};

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

    let practice={written:[],quiz:[],flashcards:[]};
    try {
      practice = await createStructuredResponse({
        model,
        content: [{ type: "input_text", text: practicePrompt }],
        schemaName: "examkok_practice",
        schema: practiceSchema,
        maxOutputTokens: 4200
      });
    } catch (practiceError) {
      console.warn(`[analyze] practice generation skipped subject=${subject}:`, practiceError?.message||practiceError);
      teaching.coverage_note = `${teaching.coverage_note||''} 문제/암기카드 생성은 출력 한도 또는 시간 문제로 생략되었습니다. 핵심 설명은 정상 저장되었습니다.`.trim();
    }

    const result = { ...teaching, ...practice, source_digest: sourceDigest };
    console.log(`[analyze] ok subject=${subject} files=${files.length} ms=${Date.now()-started}`);
    res.json({ ok: true, result, originals, analysis:{id:crypto.randomUUID(),subject,materialType,memo,examRange,textbookInfo,createdAt:new Date().toISOString(),fileCount:files.length,summary:result.summary||""} });
  } catch (e) {
    console.error(`[analyze] failed subject=${subject} files=${files.length} ms=${Date.now()-started}`, e);
    if (Number(e?.status) === 429 || /rate limit|TPM|tokens per min/i.test(String(e?.message||""))) {
      return res.status(429).json({ error:"OpenAI 사용량 한도에 도달했습니다. 앱 고장이 아닙니다. 한도가 회복된 뒤 다시 분석해주세요.", detail:e.message||"", retryAfterSeconds:e.retryAfterSeconds||null });
    }
    res.status(Number(e?.status)>=400&&Number(e?.status)<600?Number(e.status):500).json({ error: e.message || "분석 중 오류가 발생했습니다." });
  } finally {
    await Promise.all(uploaded.map(f => deleteOpenAIFile(f.id)));
  }
});
app.use((err, _req, res, _next) => { if (err?.code === "LIMIT_FILE_SIZE") return res.status(413).json({ error: "파일 1개 크기는 최대 25MB입니다." }); if (err?.code === "LIMIT_FILE_COUNT") return res.status(413).json({ error: "한 번에 최대 10개 파일까지 분석할 수 있습니다." }); console.error(err); res.status(500).json({ error: "서버에서 처리 중 오류가 발생했습니다." }); });
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, "0.0.0.0", () => console.log(`Alexpapa 시험콕 V10.1: http://0.0.0.0:${port} | storage=${cloudEnabled?'supabase':'local'}`));
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
