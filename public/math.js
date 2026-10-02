(function(){
const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]);
const valid=(...n)=>n.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e10);
function legacyScene(g={}){
  const scene={status:g.kind&&g.kind!=='none'?'confirmed':'none',title:g.title,source_basis:'V11 저장 결과',uncertainty:'V11 분석 결과를 재사용합니다. 수치가 원본과 일치하는지 확인하세요.',x_min:g.x_min,x_max:g.x_max,y_min:g.y_min,y_max:g.y_max,points:[],lines:[],curves:[],circles:[],polygons:[],segments:[],annotations:[]};
  if(g.kind==='line')scene.lines=[{a:g.a,b:-1,c:g.b,label:'직선'}];
  if(g.kind==='quadratic')scene.curves=[{a:g.a,b:g.b,c:g.c,label:'이차함수'}];
  if(g.kind==='circle')scene.circles=[{x:g.h,y:g.k,r:g.r,label:'원'}];return scene;
}
function hasGeometry(scene){
  if(!scene||scene.status==='none')return false;
  if(!valid(scene.x_min,scene.x_max,scene.y_min,scene.y_max)||scene.x_max<=scene.x_min||scene.y_max<=scene.y_min)return false;
  return (scene.points||[]).some(p=>valid(p.x,p.y))||(scene.lines||[]).some(l=>valid(l.a,l.b,l.c)&&(l.a!==0||l.b!==0))||(scene.curves||[]).some(c=>valid(c.a,c.b,c.c))||(scene.circles||[]).some(c=>valid(c.x,c.y,c.r)&&c.r>0)||(scene.polygons||[]).some(p=>p.vertices?.length>=3&&p.vertices.every(v=>valid(v.x,v.y)))||(scene.segments||[]).some(s=>valid(s.x1,s.y1,s.x2,s.y2));
}
function selectScene(analysis={}){
  if(hasGeometry(analysis.math_scene))return analysis.math_scene;
  const legacy=legacyScene(analysis.math_visual);return hasGeometry(legacy)?legacy:analysis.math_scene||legacy;
}
function render(scene){
  if(!scene||scene.status==='none')return '<div class="notice">확인된 좌표·도형 정보가 없습니다. 원본을 보며 개념과 풀이를 공부하세요.</div>';
  let xmin=scene.x_min,xmax=scene.x_max,ymin=scene.y_min,ymax=scene.y_max;
  if(!valid(xmin,xmax,ymin,ymax)||xmax<=xmin||ymax<=ymin)return '<div class="notice">좌표 범위를 확인할 수 없어 그림 재구성을 보류했습니다.</div>';
  // Equal unit scales preserve angles, distances and circle shapes.
  const W=700,H=440,p=44,scale=Math.min((W-2*p)/(xmax-xmin),(H-2*p)/(ymax-ymin));
  const ox=(W-(xmax-xmin)*scale)/2,oy=(H-(ymax-ymin)*scale)/2;
  const sx=x=>ox+(x-xmin)*scale,sy=y=>H-oy-(y-ymin)*scale;
  const text=(x,y,s)=>`<text x="${x}" y="${y}" fill="#34445b" font-size="13">${escape(s)}</text>`;
  const line=(x1,y1,x2,y2,color='#5769d5',width=2.5)=>`<line x1="${sx(x1)}" y1="${sy(y1)}" x2="${sx(x2)}" y2="${sy(y2)}" stroke="${color}" stroke-width="${width}"/>`;
  let grid='',body='',labels='';
  const step=10**Math.floor(Math.log10(Math.max(xmax-xmin,ymax-ymin)/12));
  const tick=step*(Math.max(xmax-xmin,ymax-ymin)/step>30?5:Math.max(xmax-xmin,ymax-ymin)/step>16?2:1);
  for(let x=Math.ceil(xmin/tick)*tick,n=0;x<=xmax&&n<80;x+=tick,n++){grid+=line(x,ymin,x,ymax,'#edf0f4',1);if(ymin<=0&&ymax>=0)labels+=text(sx(x)+3,sy(0)+17,Number(x.toPrecision(5)));}
  for(let y=Math.ceil(ymin/tick)*tick,n=0;y<=ymax&&n<80;y+=tick,n++){grid+=line(xmin,y,xmax,y,'#edf0f4',1);if(xmin<=0&&xmax>=0&&Math.abs(y)>tick/100)labels+=text(sx(0)+5,sy(y)-4,Number(y.toPrecision(5)));}
  if(ymin<=0&&ymax>=0)grid+=line(xmin,0,xmax,0,'#a2aebe',1.5);
  if(xmin<=0&&xmax>=0)grid+=line(0,ymin,0,ymax,'#a2aebe',1.5);
  if(ymin<=0&&ymax>=0)labels+=text(sx(xmax)-8,sy(0)-8,'x');
  if(xmin<=0&&xmax>=0)labels+=text(sx(0)+8,sy(ymax)+12,'y');
  for(const l of (scene.lines||[]).slice(0,40)){
    if(!valid(l.a,l.b,l.c)||(l.a===0&&l.b===0))continue;
    let ends=[];
    if(l.b!==0){for(const x of [xmin,xmax]){const y=-(l.a*x+l.c)/l.b;if(y>=ymin&&y<=ymax)ends.push([x,y]);}}
    if(l.a!==0){for(const y of [ymin,ymax]){const x=-(l.b*y+l.c)/l.a;if(x>=xmin&&x<=xmax)ends.push([x,y]);}}
    ends=ends.filter((a,i)=>!ends.slice(0,i).some(b=>Math.hypot(a[0]-b[0],a[1]-b[1])<1e-9));
    if(ends.length>=2){body+=line(...ends[0],...ends[1]);labels+=text(sx(ends[0][0])+6,sy(ends[0][1])-6,l.label);}
  }
  for(const c of (scene.curves||[]).slice(0,20)){
    if(!valid(c.a,c.b,c.c))continue;let d='',pen=false;
    for(let i=0;i<=400;i++){const x=xmin+(xmax-xmin)*i/400,y=c.a*x*x+c.b*x+c.c;if(Number.isFinite(y)&&y>=ymin&&y<=ymax){d+=`${pen?'L':'M'}${sx(x).toFixed(2)},${sy(y).toFixed(2)} `;pen=true;}else pen=false;}
    body+=`<path d="${d}" fill="none" stroke="#6e5bce" stroke-width="3"/>`;
  }
  for(const c of (scene.circles||[]).slice(0,20))if(valid(c.x,c.y,c.r)&&c.r>0){body+=`<circle cx="${sx(c.x)}" cy="${sy(c.y)}" r="${c.r*scale}" fill="none" stroke="#3e8e88" stroke-width="2.5"/>`;labels+=text(sx(c.x)+7,sy(c.y)-7,c.label);}
  for(const poly of (scene.polygons||[]).slice(0,20)){const v=(poly.vertices||[]).slice(0,100);if(v.length>=3&&v.every(p=>valid(p.x,p.y))){body+=`<polygon points="${v.map(p=>`${sx(p.x)},${sy(p.y)}`).join(' ')}" fill="#5e74c919" stroke="#5769d5" stroke-width="2.5"/>`;labels+=text(sx(v[0].x)+8,sy(v[0].y)+18,poly.label);}}
  for(const s of (scene.segments||[]).slice(0,80))if(valid(s.x1,s.y1,s.x2,s.y2)){body+=line(s.x1,s.y1,s.x2,s.y2,'#cf8d47');labels+=text(sx((s.x1+s.x2)/2)+4,sy((s.y1+s.y2)/2)-5,s.label);}
  for(const pt of (scene.points||[]).slice(0,80))if(valid(pt.x,pt.y)){body+=`<circle cx="${sx(pt.x)}" cy="${sy(pt.y)}" r="4.5" fill="#cd5964"/>`;labels+=text(sx(pt.x)+8,sy(pt.y)-8,`${pt.label} (${pt.x}, ${pt.y})`);}
  for(const a of (scene.annotations||[]).slice(0,40))if(valid(a.x,a.y))labels+=text(sx(a.x),sy(a.y),a.text);
  return `<svg class="graph" viewBox="0 0 ${W} ${H}" role="img" aria-label="${escape(scene.title||'AI 재구성 그래프·도형')}"><title>${escape(scene.title||'AI 재구성 그래프·도형')}</title><defs><clipPath id="sceneClip"><rect x="${ox}" y="${oy}" width="${(xmax-xmin)*scale}" height="${(ymax-ymin)*scale}"/></clipPath></defs>${grid}<g clip-path="url(#sceneClip)">${body}</g>${labels}</svg><div class="sub">${escape(scene.source_basis||'')}${scene.status==='partial'?' · 일부 정보만 확인됨':''}</div>${scene.uncertainty?`<div class="notice">확인 필요: ${escape(scene.uncertainty)}</div>`:''}`;
}
globalThis.ExamkokMath={render,legacyScene,hasGeometry,selectScene};
})();
