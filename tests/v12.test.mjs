import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp,rm,readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { analysisKey,extendStudySchema,sceneSchema,scenePrompt } from '../lib/v12.mjs';
import '../public/model.js';
import '../public/math.js';
import { fixture } from './fixture.mjs';
const M=globalThis.ExamkokModel,MathView=globalThis.ExamkokMath;
test('V11 migration preserves unknown state and subject/unit/material filtering',()=>{
 const legacy={exam:{x:1},ai:{legacy:true},materials:[{id:'old'}],studyItems:[{id:'a',files:['book.pdf'],analysis:{classification:{subject:'공통수학2',sub_subject:'좌표',title:'거리'}}}]};
 const before=JSON.stringify(legacy);const s=M.normalize(structuredClone(legacy));assert.equal(s.schemaVersion,12);assert.deepEqual(s.exam,legacy.exam);assert.deepEqual(s.materials,legacy.materials);assert.equal(JSON.stringify(legacy),before);
 assert.equal(M.filter(s.studyItems,{subject:'수학',unit:'좌표',material:'book.pdf',search:'거리'}).length,1);assert.equal(M.filter(s.studyItems,{subject:'영어'}).length,0);
});
test('rooms cannot collide across subjects, materials, problems or punctuation',()=>{
 const keys=[M.room('수학','subject'),M.room('영어','subject'),M.room('수학','material','a'),M.room('수학','material','b'),M.room('수학','material','a','p1'),M.room('수학','material','a','p2'),M.room('수학','material','a:p1')];assert.equal(new Set(keys).size,keys.length);
});
test('cache includes original bytes, analysis options and model',()=>{
 const files=[{originalname:'q.png',mimetype:'image/png',buffer:Buffer.from('image')}];const k=analysisKey(files,{subject:'수학',studentInput:'1',model:'same'});assert.equal(k,analysisKey(files,{subject:'수학',studentInput:'1',model:'same'}));assert.notEqual(k,analysisKey(files,{subject:'영어',studentInput:'1',model:'same'}));assert.notEqual(k,analysisKey([{...files[0],buffer:Buffer.from('changed')}],{subject:'수학',studentInput:'1',model:'same'}));
});
test('all strict schema properties are required and unknown coordinates use null',()=>{
 const schema=extendStudySchema({type:'object',additionalProperties:false,required:['classification'],properties:{classification:{type:'object',additionalProperties:false,required:['subject'],properties:{subject:{type:'string'}}}}});
 function check(s){if(s.type==='object'){assert.equal(s.additionalProperties,false);assert.deepEqual([...s.required].sort(),Object.keys(s.properties).sort());Object.values(s.properties).forEach(check);}if(s.items)check(s.items);}check(schema);assert.deepEqual(schema.properties.unreadable_coordinates.items.properties.x.type,['number','null']);assert.match(scenePrompt,/공식이 성립하는 이유/);assert.match(scenePrompt,/확인 필요/);
});
test('SVG supports vertical lines, zero coefficients, polygons and escaped labels',()=>{
 const s={...fixture.math_scene,lines:[{label:'vertical',a:1,b:0,c:-1}],curves:[{label:'zero',a:0,b:1,c:0}],circles:[{x:0,y:0,r:1,label:'circle'}],polygons:[{label:'triangle',vertices:[{x:0,y:0},{x:1,y:0},{x:0,y:1}]}],points:[{x:1,y:1,label:'<script>alert(1)</script>'}]};const svg=MathView.render(s);assert.match(svg,/<polygon/);assert.match(svg,/<circle/);assert.match(svg,/vertical/);assert.doesNotMatch(svg,/<script>/);assert.doesNotMatch(svg,/NaN|Infinity/);assert.match(MathView.render({...s,x_max:s.x_min}),/보류/);assert.match(MathView.render({...s,status:'none'}),/확인된/);
});
test('HTTP regression: auth, state, originals, cache, scoped tutor and rate limits',{timeout:30000},async()=>{
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');const dir=await mkdtemp(path.join(os.tmpdir(),'examkok-v12-test-'));const port=36000+Math.floor(Math.random()*10000);
 const proc=spawn(process.execPath,['--import','./tests/mock-openai.mjs','server.mjs'],{cwd:root,env:{...process.env,PORT:String(port),DATA_DIR:dir,NODE_ENV:'development',SESSION_SECRET:'test-session-secret',OPENAI_API_KEY:'test-only-placeholder',SUPABASE_URL:'',SUPABASE_PUBLISHABLE_KEY:'',SUPABASE_ANON_KEY:'',SUPABASE_SECRET_KEY:'',SUPABASE_SERVICE_ROLE_KEY:''},stdio:['ignore','pipe','pipe']});
 let log='',errors='';proc.stdout.on('data',x=>log+=x);proc.stderr.on('data',x=>errors+=x);
 const base=`http://127.0.0.1:${port}`;let cookie='';
 async function req(url,method='GET',body,usingCookie=cookie){const r=await fetch(base+url,{method,headers:{...(usingCookie?{Cookie:usingCookie}:{}),...(body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{})},body:body?(body instanceof FormData?body:JSON.stringify(body)):undefined});return r;}
 try{
  let ready=false;for(let i=0;i<100;i++){try{const r=await fetch(base+'/api/health');if(r.ok){assert.equal((await r.json()).version,'12');ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,100));}assert.ok(ready,errors);
  assert.equal((await req('/api/state')).status,401);
  const registration=await req('/api/auth/register','POST',{email:'student@example.test',password:'test-password',name:'테스트'});assert.equal(registration.status,200);cookie=registration.headers.get('set-cookie').split(';')[0];
  const legacy={studyItems:[{id:'v11',files:['old.pdf'],analysis:{classification:{subject:'영어',title:'이전 자료'}}}],wrong:[],exam:{preserved:true},tutorThreads:{}};
  assert.equal((await req('/api/state','PUT',{state:legacy})).status,200);
  const form=memo=>{const fd=new FormData();fd.append('files',new Blob(['test-image'],{type:'image/png'}),'test.png');fd.append('subject','수학');fd.append('memo',memo||'');return fd;};
  const results=await Promise.all([req('/api/study/analyze','POST',form('TEST_DELAY')),req('/api/study/analyze','POST',form('TEST_DELAY'))]);const a=await results[0].json(),b=await results[1].json();assert.equal(results[0].status,200);assert.equal(a.studyId,b.studyId);assert.equal(a.result.classification.subject,'수학');
  const count=()=>log.split('MOCK:file').length-1;assert.equal(count(),1);
  const cached=await (await req('/api/study/analyze','POST',form('TEST_DELAY'))).json();assert.equal(cached.cached,true);assert.equal(count(),1);
  let s=(await (await req('/api/state')).json()).state;assert.equal(s.studyItems.length,2);assert.equal(s.exam.preserved,true);assert.equal(s.wrong.length,1);
  const url=`/api/study/${a.studyId}/original/0`;assert.equal(await (await req(url)).text(),'test-image');assert.equal((await req(url,'GET',null,'')).status,401);
  const room=M.room('수학','material',a.studyId,'p1');s.tutorThreads={[room]:[{role:'user',text:'기울기의 뜻은?'},{role:'assistant',text:'y 변화량 / x 변화량'}],[M.room('영어','subject')]:[{role:'user',text:'ENGLISH_ROOM_SENTINEL'}]};await req('/api/state','PUT',{state:s});
  const tutorBody={subject:'수학',scope:'material',studyId:a.studyId,problemId:'p1',question:'왜 나누나요?'};
  const tr=await req('/api/study/tutor','POST',tutorBody);assert.equal(tr.status,200);assert.match((await tr.json()).answer,/기울기/);
  const again=await (await req('/api/study/tutor','POST',tutorBody)).json();assert.equal(again.cached,true);
  const latest=log.split('\n').filter(x=>x.startsWith('MOCK:response:')).at(-1);assert.doesNotMatch(latest,/ENGLISH_ROOM_SENTINEL/);assert.match(latest,/y 변화량/);
  assert.equal((await req('/api/study/tutor','POST',{...tutorBody,subject:'영어'})).status,400);
  assert.equal((await req('/api/study/tutor','POST',{...tutorBody,problemId:'unknown'})).status,400);
  const limited=await req('/api/study/analyze','POST',form('TEST_RATE_LIMIT'));assert.equal(limited.status,429);assert.equal(limited.headers.get('retry-after'),'2');
  s=(await (await req('/api/state')).json()).state;assert.equal(s.studyItems.length,2);
  await req('/api/auth/logout','POST');assert.equal((await req('/api/state','GET',null,'examkok_session=invalid')).status,401);
  const login=await req('/api/auth/login','POST',{email:'student@example.test',password:'test-password'});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];assert.equal((await (await req('/api/state')).json()).state.tutorThreads[room].length,2);
  const other=await req('/api/auth/register','POST',{email:'other@example.test',password:'test-password'});const otherCookie=other.headers.get('set-cookie').split(';')[0];assert.equal((await req(url,'GET',null,otherCookie)).status,404);
  await req('/api/materials/delete-originals','POST',{originals:a.originals});assert.equal((await req(url)).status,404);
 }finally{proc.kill();await new Promise(resolve=>{if(proc.exitCode!==null)resolve();else proc.once('exit',resolve);});await rm(dir,{recursive:true,force:true});}
});
