/* Shared, non-destructive V11 -> V12 normalization. */
(function(){
const subject=s=>({'진로·선택':'진로/선택','공통수학1':'수학','공통수학2':'수학','통합사회1':'사회','통합사회2':'사회','통합과학1':'과학','통합과학2':'과학'})[s]||s||'기타';
const info=item=>{const c=item?.analysis?.classification||{};return {subject:subject(item.subject||c.subject),unit:item.unit||c.unit||c.sub_subject||'미분류',material:item.materialName||c.source_title||(item.files||[]).join(', ')||c.title||'이름 없는 자료',title:c.title||'공부노트'};};
const room=(s,scope,id='',problem='')=>JSON.stringify([subject(s),scope,scope==='subject'?'':String(id),scope==='subject'?'':String(problem)]);
const isMath=s=>/^(공통)?수학|^미적분|^기하$|^대수$|^확률과통계$/.test(String(s||'').replace(/\s/g,''));
function normalize(s={}){s.studyItems=Array.isArray(s.studyItems)?s.studyItems:[];s.wrong=Array.isArray(s.wrong)?s.wrong:[];s.customSubjects=Array.isArray(s.customSubjects)?s.customSubjects:[];s.stats=s.stats||{};s.tutorThreads=s.tutorThreads&&typeof s.tutorThreads==='object'?s.tutorThreads:{};s.schemaVersion=12;return s;}
const filter=(items,{subject:s='',unit='',material='',search=''}={})=>items.filter(item=>{const i=info(item);return (!s||i.subject===subject(s))&&(!unit||i.unit===unit)&&(!material||i.material===material)&&(!search||[i.title,i.unit,i.material,...(item.analysis?.problems||[]).map(p=>p.statement)].join(' ').toLowerCase().includes(search.toLowerCase()));});
globalThis.ExamkokModel={subject,info,room,normalize,filter,isMath};
})();
