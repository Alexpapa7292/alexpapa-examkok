/* V12 study navigation; V11 auth and subject lesson renderers stay compatible. */
const M=ExamkokModel;
let activeSubject='수학',tutorScope='material',activeProblem='';
let saveQueue=Promise.resolve(),saveRevision=0;
const tutorPending=new Map(),cooldowns=new Map(),tutorDrafts=new Map();let renderedRoomKey='';
const mathVisualPending=new Set();
const getInfo=M.info;
const byRecent=items=>[...items].sort((a,b)=>new Date(b.lastStudiedAt||b.createdAt)-new Date(a.lastStudiedAt||a.createdAt));
function normalize(){state=M.normalize(state);}
function toast(message){$('toast').textContent=message;$('toast').classList.remove('hidden');clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').classList.add('hidden'),5000);}
async function api(url,options={}){const r=await fetch(url,{credentials:'same-origin',...options});const data=await r.json();if(!r.ok){const e=new Error(data.error||'요청을 처리하지 못했습니다.');e.status=r.status;e.retryAfterSeconds=data.retryAfterSeconds;throw e;}return data;}
function persist(){
  normalize();const revision=++saveRevision,snapshot=JSON.stringify({state});$('saveState').textContent='저장 중';
  const task=saveQueue.catch(()=>{}).then(()=>api('/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:snapshot}));
  saveQueue=task;task.then(()=>{if(revision===saveRevision)$('saveState').textContent='자동저장';},e=>{$('saveState').textContent='저장 실패 · 재시도';toast('저장하지 못했습니다. '+e.message);});return task;
}
$('saveState').onclick=()=>persist().catch(()=>{});
async function boot(){
  try{const md=await api('/api/auth/me');$('userEmail').textContent=md.user?.email||'';const sd=await api('/api/state');state=sd.state||{};normalize();activeSubject=M.subject(state.lastSubject||'수학');currentItem=state.studyItems.find(x=>String(x.id)===String(state.lastStudyId))||byRecent(state.studyItems)[0]||null;renderAll();}
  catch(e){if(e.status===401)$('auth').classList.remove('hidden');else{toast('학습 기록을 불러오지 못했습니다. 새로고침해 다시 시도해주세요.');$('saveState').textContent='불러오기 실패';}}
}
function go(name){
  if(!$(name))return;
  document.querySelectorAll('.screen').forEach(x=>x.classList.toggle('on',x.id===name));
  document.querySelectorAll('.nav button').forEach(x=>x.classList.toggle('on',x.dataset.screen===name||(name==='workspace'&&x.dataset.screen==='notes')||(name==='hub'&&x.dataset.screen==='home')));
  const titles={home:['오늘의 공부','나의 과목, 나의 속도로.'],capture:['찍어공부','사진이나 파일을 올리면 과목에 맞춰 공부노트를 만듭니다.'],hub:[activeSubject+' 학습 허브','기록을 찾아, 공부를 이어가세요.'],notes:['공부노트','과목 → 단원 → 자료 순서로 찾아보세요.'],workspace:['공부노트','원본과 개념을 함께 보고, 이해될 때까지 질문하세요.'],wrong:['오답노트','틀린 이유를 이해하고 다시 풀어보세요.'],library:['내 자료함','저장된 분석을 다시 열어 공부하세요.']};
  [$('pageTitle').textContent,$('pageSub').textContent]=titles[name];
  if(name==='workspace')renderWorkspace();if(name==='hub')renderHub();if(name==='notes')filterNotes();if(name==='wrong')renderWrong();if(name==='library')renderLibrary();if(name==='capture')updateCaptureFields();
  window.scrollTo({top:0,behavior:'smooth'});
}
function renderAll(){renderSubjects();renderRecent();renderMetrics();fillSubjectSelect();filterNotes();renderLibrary();renderWrong();if($('hub').classList.contains('on'))renderHub();}
function allSubjects(){return [...new Set([...SUBJECTS,...state.customSubjects,...state.studyItems.map(x=>getInfo(x).subject),...state.wrong.map(x=>M.subject(x.subject))])];}
function renderSubjects(){
  $('subjectGrid').innerHTML=allSubjects().map(s=>{const items=M.filter(state.studyItems,{subject:s});return `<button class="subject" data-action="subject" data-subject="${esc(s)}"><div class="subject-icon">${iconFor(s)}</div><b>${esc(s)}</b><span>${items.length?items.length+'개의 공부 기록':'첫 공부를 시작해요'}</span><i>↗</i></button>`;}).join('')+'<button class="subject add-subject" onclick="addSubject()"><div>＋</div><b>과목 추가</b></button>';
}
function addSubject(){const n=prompt('추가할 과목 이름');if(!n?.trim())return;const name=M.subject(n.trim().slice(0,50));if(!allSubjects().includes(name))state.customSubjects.push(name);persist().catch(()=>{});renderAll();}
function openSubject(s){activeSubject=M.subject(s);activeProblem='';currentItem=byRecent(M.filter(state.studyItems,{subject:activeSubject}))[0]||null;state.lastSubject=activeSubject;tutorScope='subject';go('hub');persist().catch(()=>{});}
function itemRow(item){const i=getInfo(item);return `<div class="library-item"><div><div class="row-label">${esc(i.subject)} · ${esc(i.unit)}</div><b>${esc(i.title)}</b><div class="meta">${esc(i.material)} · ${new Date(item.lastStudiedAt||item.createdAt).toLocaleDateString('ko-KR')}</div></div><button class="ghost" data-action="item" data-id="${esc(item.id)}">공부하기 ↗</button></div>`;}
function renderRecent(){const items=byRecent(state.studyItems).slice(0,6);$('recentList').innerHTML=items.length?items.map(itemRow).join(''):'<div class="empty">아직 공부 기록이 없어요. 사진 한 장으로 시작해 보세요.</div>';}
function renderHub(){
  const items=M.filter(state.studyItems,{subject:activeSubject}),recent=byRecent(items),latest=recent[0];
  const wrong=state.wrong.filter(w=>M.subject(w.subject)===activeSubject);
  const units=[...new Set(items.map(i=>getInfo(i).unit))];
  $('hubBody').innerHTML=`<div class="card hub-hero"><div><div class="eyebrow">MY SUBJECT NOTEBOOK</div><h1>${iconFor(activeSubject)} ${esc(activeSubject)}</h1><p>${items.length}개 자료 · ${units.length}개 단원 · 오답 ${wrong.length}개</p></div><button class="primary" data-action="capture-subject">＋ 새로 찍어서 공부</button></div><div class="grid2 hub-grid"><div class="card"><div class="section-title">이어서 공부하기</div>${latest?`<div class="resume"><span class="tag">${esc(getInfo(latest).unit)}</span><h2>${esc(getInfo(latest).title)}</h2><p>${esc(getInfo(latest).material)}</p><button class="primary" data-action="item" data-id="${esc(latest.id)}">보던 노트 이어서 →</button></div>`:'<div class="empty">이 과목의 첫 자료를 올려주세요.</div>'}</div><div class="hub-shortcuts"><button class="card" data-action="hub-notes"><b>📖 과목별 공부노트</b><span>단원과 자료로 찾아보기 →</span></button><button class="card" data-action="hub-wrong"><b>↺ 오답 다시 보기 <small>${wrong.length}</small></b><span>틀린 이유와 교정 포인트 →</span></button><button class="card" onclick="openTutor('subject')"><b>✦ ${esc(activeSubject)} AI 튜터</b><span>과목 전체 질문 이어가기 →</span></button><button class="card" data-action="hub-practice"><b>✎ 유사문제</b><span>저장된 문제로 난이도별 복습 →</span></button></div></div><div class="grid2 hub-grid"><div class="card"><div class="section-title">최근 공부 이력</div><div class="recent">${recent.slice(0,6).map(itemRow).join('')||'<div class="empty">공부 기록이 없습니다.</div>'}</div></div><div class="card"><div class="section-title">최근 자료</div><div class="recent">${[...items].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,5).map(itemRow).join('')||'<div class="empty">저장된 자료가 없습니다.</div>'}</div></div></div>`;
}
function fillSelect(id,values,label,preferred){const sel=$(id),old=preferred??sel.value;sel.innerHTML=`<option value="">${esc(label)}</option>`+[...new Set(values)].map(v=>`<option value="${esc(v)}">${esc(v)}</option>`).join('');if([...sel.options].some(o=>o.value===old))sel.value=old;}
function filterNotes(changed){
  fillSelect('noteSubject',allSubjects(),'전체 과목');
  if(changed==='subject'){$('noteUnit').value='';$('noteMaterial').value='';}
  const bySubject=M.filter(state.studyItems,{subject:$('noteSubject').value});
  fillSelect('noteUnit',bySubject.map(i=>getInfo(i).unit),'전체 단원');
  if(changed==='unit')$('noteMaterial').value='';
  const byUnit=M.filter(bySubject,{unit:$('noteUnit').value});fillSelect('noteMaterial',byUnit.map(i=>getInfo(i).material),'전체 자료');renderNotes();
}
function renderNotes(){const items=M.filter(byRecent(state.studyItems),{subject:$('noteSubject').value,unit:$('noteUnit').value,material:$('noteMaterial').value,search:$('noteSearch').value});$('noteResults').innerHTML=items.map(itemRow).join('')||'<div class="empty">선택한 조건에 맞는 노트가 없습니다.</div>';}
function renderWrong(){
  fillSelect('wrongSubject',allSubjects(),'전체 과목');fillSelect('wrongType',state.wrong.map(w=>w.errorType||'기타'),'전체 오류 유형');
  const a=state.wrong.filter(w=>(!$('wrongSubject').value||M.subject(w.subject)===$('wrongSubject').value)&&(!$('wrongType').value||(w.errorType||'기타')===$('wrongType').value));
  $('wrongList').innerHTML=a.map(w=>`<div class="wrong-card"><div class="row-label">${esc(M.subject(w.subject))} · ${esc(w.errorType||'오답')}</div><b>${esc(w.title||'오답노트')}</b><div class="reason">${esc(w.reason||'')}</div><div class="rule">다시 풀 때: ${esc(w.rule||w.fix||'')}</div><button class="ghost" data-action="item" data-id="${esc(w.id)}">관련 노트 보기</button></div>`).join('')||'<div class="empty">선택한 과목에 저장된 오답이 없습니다.</div>';
}
function renderLibrary(){fillSelect('librarySubject',allSubjects(),'전체 과목');const a=M.filter(state.studyItems,{subject:$('librarySubject').value});$('libraryList').innerHTML=a.map(x=>`<div class="library-entry">${itemRow(x)}<button class="ghost danger" data-action="delete" data-id="${esc(x.id)}">삭제</button></div>`).join('')||'<div class="empty">자료가 없습니다.</div>';}
function openItem(id){
  const item=state.studyItems.find(x=>String(x.id)===String(id));if(!item){toast('관련 자료가 없거나 삭제되었습니다.');return;}
  currentItem=item;activeSubject=getInfo(item).subject;activeProblem='';tutorScope='material';currentSection='overview';item.lastStudiedAt=new Date().toISOString();state.lastStudyId=item.id;state.lastSubject=activeSubject;go('workspace');renderRecent();persist().catch(()=>{});
}
function openTutor(scope='subject'){if(currentItem&&getInfo(currentItem).subject!==activeSubject)currentItem=null;tutorScope=scope;activeProblem='';go('workspace');document.querySelector('.tutor-card').scrollIntoView({behavior:'smooth',block:'nearest'});$('chatInput').focus();}
function updateCaptureFields(){
  const subject=$('subjectSelect').value,type=$('materialType').value,mode=$('modeSelect').value;
  const english=(subject==='영어'&&type==='독해 지문')||mode==='영어 해석 분석';
  const problem=type==='문제·풀이'||mode==='문제 풀이/오답';
  const visible=english||(problem&&['수학','국어','자동'].includes(subject));
  $('studentField').classList.toggle('hidden',!visible);
  $('studentLabel').textContent=english?'내 해석 (선택)':subject==='국어'?'내가 고른 답 / 생각 (선택)':'내 풀이 / 답 (선택)';
  $('studentInput').placeholder=english?'사진에 해석이 없을 때만 입력해도 됩니다.':'사진 속 답과 풀이를 먼저 읽습니다. 추가할 내용이 있을 때만 입력하세요.';
}
$('subjectSelect').addEventListener('change',updateCaptureFields);$('modeSelect').addEventListener('change',updateCaptureFields);
function filesChanged(list){selectedFiles=[...list];$('fileList').innerHTML=selectedFiles.map(f=>`<div class="file-row">${esc(f.name)} · ${(f.size/1024/1024).toFixed(1)}MB</div>`).join('');}
$('cameraInput').addEventListener('change',e=>filesChanged(e.target.files));$('fileInput').addEventListener('change',e=>filesChanged(e.target.files));
async function analyzeUpload(){
  if(!selectedFiles.length||selectedFiles.length>10||selectedFiles.some(f=>f.size>25*1024*1024)){toast('25MB 이하 자료를 1~10개 선택해주세요.');return;}
  if(Date.now()<(cooldowns.get('analysis')||0)){toast('사용량 한도 대기 중입니다. 잠시 뒤 다시 시도해주세요.');return;}
  $('analyzeBtn').disabled=true;$('captureError').classList.add('hidden');setProgress(12,'자료를 확인하고 있습니다…');
  const fd=new FormData();selectedFiles.forEach(f=>fd.append('files',f));
  fd.append('subject',$('subjectSelect').value);fd.append('mode',$('modeSelect').value);fd.append('materialType',$('materialType').value);fd.append('unit',$('unitInput').value.trim());
  fd.append('studentInput',$('captureOptions').open&&!$('studentField').classList.contains('hidden')?$('studentInput').value:'');
  fd.append('memo',$('captureOptions').open?[$('analysisFocus').value,$('analysisMemo').value].filter(Boolean).join('\n'):'');
  const timer=setTimeout(()=>setProgress(45,'자료의 내용과 근거를 확인하고 있습니다…'),2500),timer2=setTimeout(()=>setProgress(72,'개념·원리와 공부노트를 정리하고 있습니다…'),9000);
  try{
    await saveQueue.catch(()=>{});const d=await api('/api/study/analyze',{method:'POST',body:fd});
    const item=d.item||{id:d.studyId,createdAt:new Date().toISOString(),files:selectedFiles.map(f=>f.name),originals:d.originals||[],analysis:d.result};
    const idx=state.studyItems.findIndex(i=>i.id===item.id);if(idx>=0)state.studyItems[idx]=item;else state.studyItems.unshift(item);
    const w=item.analysis?.wrong_note;if(w?.status==='wrong'&&!state.wrong.some(i=>i.id===item.id))state.wrong.unshift({id:item.id,subject:item.analysis.classification.subject,title:item.analysis.classification.title,reason:w.why,fix:w.fix,rule:w.one_line_rule,errorType:w.error_type,createdAt:item.createdAt});
    currentItem=item;activeSubject=getInfo(item).subject;currentSection='overview';activeProblem='';tutorScope='material';state.lastStudyId=item.id;state.lastSubject=activeSubject;
    await persist();setProgress(100,d.cached?'저장된 분석을 다시 열었습니다.':'공부노트 저장 완료');renderAll();go('workspace');
    selectedFiles=[];$('fileList').innerHTML='';$('cameraInput').value='';$('fileInput').value='';$('studentInput').value='';$('analysisMemo').value='';$('unitInput').value='';$('analysisFocus').value='';$('captureOptions').open=false;
    toast(d.cached?'같은 자료의 저장된 분석을 재사용했습니다.':'공부노트가 준비되었습니다.');
  }catch(e){if(e.status===429)cooldowns.set('analysis',Date.now()+(e.retryAfterSeconds||60)*1000);$('captureError').textContent=e.message;$('captureError').classList.remove('hidden');setProgress(0,'처리하지 못했습니다.');}
  finally{clearTimeout(timer);clearTimeout(timer2);$('analyzeBtn').disabled=false;}
}
function originalView(item){
  return `<div class="originals">${(item.originals||[]).map((o,i)=>{const url=`/api/study/${encodeURIComponent(item.id)}/original/${i}`;return `<div class="original-card"><div class="row-label">원본 · ${esc(o.name)}</div>${/^image\/(png|jpeg|gif|webp)$/.test(o.type)?`<a href="${url}" target="_blank" rel="noopener"><img src="${url}" alt="${esc(o.name)}" loading="lazy" /></a>`:o.type==='application/pdf'?`<iframe src="${url}" title="${esc(o.name)}"></iframe><a href="${url}" target="_blank" rel="noopener">PDF 원본 열기 ↗</a>`:`<a href="${url}" target="_blank" rel="noopener">원본 파일 열기 ↗</a>`}</div>`;}).join('')||'<div class="notice">이전 노트에 원본 파일 정보가 없습니다.</div>'}</div>`;
}
function evidenceView(a){return `<details class="evidence"><summary>설명 근거와 확인이 필요한 부분</summary>${(a.evidence||[]).map(e=>`<div class="note-box"><b>${esc(e.claim)}</b><p>${esc(e.source_basis)}</p><span class="tag">${e.confidence==='confirmed'?'자료에서 확인':'확인 필요'}</span></div>`).join('')||'<div class="notice">이전 분석에는 개별 근거 정보가 없습니다. 원본과 함께 확인하세요.</div>'}${a.limitations?`<div class="notice">${esc(a.limitations)}</div>`:''}</details>`;}
function quizView(a){return (a.quiz||[]).length?`<div class="note-box memory"><h3>개념을 이해했는지 확인하기</h3>${a.quiz.map(q=>`<p>${esc(q.q)}</p><details><summary>생각한 뒤 정답 확인</summary><p>${esc(q.answer)}</p><p>${esc(q.explanation)}</p></details>`).join('')}</div>`:'';}
function practiceView(a){return `<div id="practiceBlock"><div class="section-title">난이도별 유사문제</div><div class="sub">AI가 새로 만든 연습문제입니다. 원본에서 발췌한 문제가 아닙니다.</div><div class="practice-grid">${(a.math_similar||[]).map(q=>`<div class="practice"><div class="diff">${esc(q.difficulty)}</div><p>${esc(q.question)}</p><details><summary>힌트</summary><p>${esc(q.hint)}</p></details><details><summary>정답</summary><p>${esc(q.answer)}</p></details></div>`).join('')||'<div class="empty">저장된 유사문제가 없습니다. 튜터에게 연습문제를 요청할 수 있습니다.</div>'}</div></div>`;}
function mathNotebook(a){
  const i=getInfo(currentItem),scene=ExamkokMath.selectScene(a);
  return `<div class="eyebrow">MATH NOTEBOOK</div><h2>${esc(i.title)}</h2><div class="tags"><span class="tag">${esc(i.subject)}</span><span class="tag">${esc(i.unit)}</span><span class="tag">${esc(i.material)}</span></div><p class="lead">${esc(a.overview||'')}</p><div class="math-compare"><div><div class="section-title">원본 문제</div>${originalView(currentItem)}</div><div><div class="section-title">AI 재구성 그래프 · 도형</div><div class="sub">확인된 좌표와 조건을 바탕으로 재구성한 그림</div>${ExamkokMath.render(scene)}${(a.unreadable_coordinates||[]).map(p=>`<div class="notice">확인 필요 · ${esc(p.label)}: ${esc(p.reason)}</div>`).join('')}</div></div><div class="section-title">핵심 개념과 원리 · 왜 이렇게 풀까요?</div>${list(a.lesson_sections,'concept')}${list(a.key_points,'key')}<div class="section-title">단계별 풀이</div><div class="steps">${(a.math_steps||[]).map((s,n)=>`<details class="step" open><summary><span>${n+1}</span>${esc(s.title)}${s.problem_id?` <small>${esc(s.problem_id)}</small>`:''}</summary><p>${esc(s.explanation)}</p>${s.formula?`<div class="formula">${esc(s.formula)}</div>`:''}<div class="sub">근거: ${esc(s.source_basis)}</div></details>`).join('')||'<div class="notice">이전 분석에는 단계별 풀이가 없습니다. 개념노트를 참고하거나 현재 자료 튜터에게 풀이 원리를 질문하세요.</div>'}</div><div class="section-title">오답과 교정</div>${renderWrongSummary(a.wrong_note)}${a.wrong_note?.why?`<div class="note-box">${esc(a.wrong_note.why)}</div>`:''}${quizView(a)}${practiceView(a)}${evidenceView(a)}`;
}
function renderWorkspace(){
  $('workspaceCrumb').textContent=currentItem?`${activeSubject} / ${getInfo(currentItem).unit} / ${getInfo(currentItem).material}`:activeSubject+' / 전체 질문';
  if(!currentItem){$('lessonNav').innerHTML='';$('paper').innerHTML=`<div class="eyebrow">SUBJECT TUTOR</div><h2>${iconFor(activeSubject)} ${esc(activeSubject)} 전체 질문</h2><p class="lead">개념과 원리를 편하게 물어보세요.<br>자료를 열면 해당 자료와 문제의 대화를 따로 이어갈 수 있어요.</p><button class="primary" data-action="capture-subject">새 자료로 공부하기</button>`;}
  else{const a=currentItem.analysis||{},defs=sectionDefs(a);if(!defs.some(d=>d[0]===currentSection))currentSection='overview';$('lessonNav').innerHTML=defs.map(([k,l])=>`<button class="${k===currentSection?'on':''}" data-action="section" data-section="${esc(k)}">${esc(l)}</button>`).join('');
    const math=M.isMath(getInfo(currentItem).subject);
    $('paper').innerHTML=math?mathNotebook(a):renderSection(a,currentSection)+quizView(a)+evidenceView(a)+`<details><summary>원본 자료 보기</summary>${originalView(currentItem)}</details>`;
    if(math){
      const panel=document.querySelector('.math-compare>div:last-child');
      if(!ExamkokMath.hasGeometry(ExamkokMath.selectScene(a))){
        const checked=currentItem.mathVisualStatus==='checked-no-geometry';
        const box=document.createElement('div');box.className='notice math-repair';
        const note=document.createElement('p');note.textContent=checked?(currentItem.mathVisualNote||'원본에서 그릴 수 있는 좌표·도형 정보를 확인하지 못했습니다.'):'저장된 분석에 그래프가 없습니다. 원본에서 그래프 정보만 확인해 보완할 수 있습니다.';box.appendChild(note);
        if(!checked){const button=document.createElement('button');button.className='primary';button.textContent=mathVisualPending.has(currentItem.id)?'그래프를 확인하고 있습니다…':'원본으로 그래프 만들기';button.disabled=mathVisualPending.has(currentItem.id);button.onclick=()=>buildMathVisual(currentItem.id);box.appendChild(button);}
        panel.appendChild(box);
      }
    }
  }
  renderChat();
  if(currentItem&&M.isMath(getInfo(currentItem).subject)&&currentSection==='practice')$('practiceBlock')?.scrollIntoView({behavior:'smooth',block:'start'});
  if(currentItem&&M.isMath(getInfo(currentItem).subject)&&currentSection==='math')document.querySelector('.math-compare')?.scrollIntoView({behavior:'smooth',block:'start'});
}
async function buildMathVisual(id){
  if(mathVisualPending.has(id))return;const key='visual:'+id;
  if(Date.now()<(cooldowns.get(key)||0)){toast('사용량 한도 대기 중입니다. 잠시 뒤 다시 시도해주세요.');return;}
  mathVisualPending.add(id);renderWorkspace();
  try{
    await persist();const d=await api(`/api/study/${encodeURIComponent(id)}/math-visual`,{method:'POST'});
    const target=state.studyItems.find(x=>x.id===id);if(!target)return;
    target.analysis.math_scene=d.scene;target.mathVisualStatus=d.visualStatus;target.mathVisualNote=d.note||'';await persist();
    toast(ExamkokMath.hasGeometry(d.scene)?'그래프를 보완하고 저장했습니다.':'확인 가능한 좌표·도형 정보가 없어 그래프를 만들지 않았습니다.');
  }catch(e){if(e.status===429)cooldowns.set(key,Date.now()+(e.retryAfterSeconds||60)*1000);toast(e.message);}
  finally{mathVisualPending.delete(id);if(currentItem?.id===id)renderWorkspace();}
}
function showSection(s){currentSection=s;renderWorkspace();}
function roomKey(){return M.room(activeSubject,tutorScope,currentItem?.id,activeProblem);}
function setTutorScope(scope){tutorScope=currentItem?scope:'subject';activeProblem='';renderChat();}
function selectProblem(id){activeProblem=id;tutorScope='material';renderChat();}
function renderChat(){
  if(!currentItem)tutorScope='subject';
  $('subjectRoomBtn').classList.toggle('on',tutorScope==='subject');$('materialRoomBtn').classList.toggle('on',tutorScope==='material');$('materialRoomBtn').disabled=!currentItem;
  const ps=currentItem?.analysis?.problems||[];
  $('problemSelect').innerHTML='<option value="">자료 전체 질문</option>'+ps.map(p=>`<option value="${esc(p.id)}">${esc(p.label||p.id)}</option>`).join('');$('problemSelect').value=activeProblem;$('problemSelect').classList.toggle('hidden',!ps.length||tutorScope==='subject');
  $('tutorRoomLabel').textContent=activeSubject+' · '+(tutorScope==='subject'?'과목 전체':activeProblem?'문제 '+(ps.find(p=>p.id===activeProblem)?.label||activeProblem):getInfo(currentItem).title);
  const key=roomKey(),messages=state.tutorThreads[key]||[];
  if(key!==renderedRoomKey){if(renderedRoomKey)tutorDrafts.set(renderedRoomKey,$('chatInput').value);$('chatInput').value=tutorDrafts.get(key)||'';renderedRoomKey=key;}
  $('chat').innerHTML='';
  if(!messages.length)addBubble(tutorScope==='subject'?`${activeSubject}의 개념과 원리를 물어보세요. 이 과목의 대화는 별도로 저장됩니다.`:'현재 자료의 개념·원리와 풀이를 물어보세요. 확인된 근거가 부족하면 확인 필요로 안내합니다.','ai');
  for(const m of messages){addBubble(m.text,m.role==='user'?'me':'ai');if(m.role==='assistant'&&m.scene){const visual=document.createElement('div');visual.className='chat-visual';visual.innerHTML='<div class="row-label">AI 재구성 · 답변의 근거 조건</div>'+ExamkokMath.render(m.scene);$('chat').appendChild(visual);}}
  $('graphTutorBtn').classList.toggle('hidden',!M.isMath(activeSubject));
  if(tutorPending.has(key))addBubble('근거를 확인하며 설명하고 있습니다…','ai','typing');
  document.querySelector('.chat-input button').disabled=tutorPending.has(key);
  $('chat').scrollTop=$('chat').scrollHeight;
}
async function sendTutor(visual=false){
  const q=$('chatInput').value.trim(),key=roomKey();if(!q||tutorPending.has(key))return;
  if(Date.now()<(cooldowns.get(key)||0)){toast('사용량 한도 대기 중입니다. 잠시 뒤 질문해주세요.');return;}
  const subject=activeSubject,scope=tutorScope,studyId=scope==='material'?currentItem?.id:'',problemId=scope==='material'?activeProblem:'';
  const thread=state.tutorThreads[key]||(state.tutorThreads[key]=[]);thread.push({role:'user',text:q,createdAt:new Date().toISOString()});$('chatInput').value='';tutorPending.set(key,true);renderChat();
  try{
    await persist();const d=await api('/api/study/tutor',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({question:q,subject,scope,studyId,problemId,visual})});
    if(state.tutorThreads[key]===thread){thread.push({role:'assistant',text:d.answer,...(d.scene?{scene:d.scene}:{}),createdAt:new Date().toISOString()});if(thread.length>200)thread.splice(0,thread.length-200);await persist();}
  }catch(e){if(e.status===429)cooldowns.set(key,Date.now()+(e.retryAfterSeconds||60)*1000);if(state.tutorThreads[key]===thread){thread.push({role:'assistant',text:e.message,error:true,createdAt:new Date().toISOString()});persist().catch(()=>{});}}
  finally{tutorPending.delete(key);if(roomKey()===key)renderChat();}
}
function askGraph(){if(!$('chatInput').value.trim())$('chatInput').value=currentItem&&tutorScope==='material'?'현재 문제를 그래프나 도형으로 보여주고, 왜 그렇게 풀리는지 개념과 원리를 설명해줘.':'그래프로 이해하고 싶은 식이나 문제 조건을 적지 않았습니다. 먼저 필요한 조건을 물어봐줘.';sendTutor(true);}
function editMetadata(){
  if(!currentItem)return;const i=getInfo(currentItem);const unit=prompt('단원 이름 (직접 지정)',i.unit);if(unit===null)return;const material=prompt('자료 이름 (직접 지정)',i.material);if(material===null)return;const subject=prompt('과목 이름 (직접 지정)',i.subject);if(subject===null)return;
  currentItem.unit=unit.trim()||'미분류';currentItem.materialName=material.trim()||'이름 없는 자료';currentItem.subject=M.subject(subject.trim()||i.subject);
  // A reclassified material retains its original room; no old conversation is assigned to a new subject.
  activeSubject=currentItem.subject;activeProblem='';for(const w of state.wrong)if(w.id===currentItem.id)w.subject=activeSubject;state.lastSubject=activeSubject;persist().catch(()=>{});renderAll();renderWorkspace();
}
async function deleteItem(id){
  if(!confirm('이 자료와 연결된 노트·문제별 대화를 삭제할까요?'))return;
  const item=state.studyItems.find(i=>String(i.id)===String(id));if(!item)return;
  try{if(item.originals?.length)await api('/api/materials/delete-originals',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({originals:item.originals})});
    state.studyItems=state.studyItems.filter(i=>String(i.id)!==String(id));state.wrong=state.wrong.filter(w=>String(w.id)!==String(id));
    for(const key of Object.keys(state.tutorThreads)){try{if(JSON.parse(key)[2]===String(id))delete state.tutorThreads[key];}catch{}}
    if(currentItem?.id===item.id)currentItem=null;await persist();renderAll();toast('자료를 삭제했습니다.');
  }catch(e){toast('삭제하지 못했습니다. '+e.message);}
}
document.addEventListener('click',e=>{
  const b=e.target.closest('[data-action]');if(!b)return;
  const {action,id,subject,section}=b.dataset;
  if(action==='subject')openSubject(subject);if(action==='item')openItem(id);if(action==='delete')deleteItem(id);if(action==='section')showSection(section);
  if(action==='capture-subject'){go('capture');$('subjectSelect').value=activeSubject;updateCaptureFields();}
  if(action==='hub-notes'){go('notes');$('noteSubject').value=activeSubject;filterNotes('subject');}
  if(action==='hub-wrong'){go('wrong');$('wrongSubject').value=activeSubject;renderWrong();}
  if(action==='hub-practice'){const item=byRecent(M.filter(state.studyItems,{subject:activeSubject})).find(i=>(i.analysis?.math_similar||[]).length);if(item){openItem(item.id);showSection('practice');}else{openTutor('subject');$('chatInput').value='이 과목의 핵심 개념으로 연습문제를 만들어줘. 새로 만든 문제라고 표시하고 풀이 원리도 설명해줘.';}}
});
window.addEventListener('unhandledrejection',e=>{toast('처리 중 문제가 발생했습니다. '+(e.reason?.message||''));});
if('serviceWorker' in navigator)navigator.serviceWorker.register('/sw.js').catch(()=>{});
boot();
