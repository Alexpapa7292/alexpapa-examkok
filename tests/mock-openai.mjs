// TEST ONLY: intercept provider requests. Never imported by npm start.
import { fixture } from './fixture.mjs';
const originalFetch=globalThis.fetch;
globalThis.fetch=async(url,options={})=>{
  const address=String(url);
  if(!address.startsWith('https://api.openai.com/'))return originalFetch(url,options);
  const json=(value,status=200)=>new Response(JSON.stringify(value),{status,headers:{'Content-Type':'application/json'}});
  if(address.endsWith('/files')&&options.method==='POST'){console.log('MOCK:file');return json({id:'file-test'});}
  if(address.includes('/files/')&&options.method==='DELETE')return json({deleted:true});
  if(address.endsWith('/responses')){
    const body=JSON.parse(options.body),text=body.input[0].content[0].text;
    console.log('MOCK:response:'+JSON.stringify({structured:!!body.text,text}));
    if(text.includes('TEST_RATE_LIMIT'))return json({error:{message:'Rate limit. Please try again in 2s.'}},429);
    if(text.includes('TEST_DELAY'))await new Promise(resolve=>setTimeout(resolve,400));
    if(body.text){
      const schema=body.text.format.schema;
      function defaults(s){if(s.type==='object')return Object.fromEntries(Object.entries(s.properties).map(([k,v])=>[k,defaults(v)]));if(s.type==='array')return [];if(s.enum)return s.enum[0];if(s.type==='number'||s.type==='integer')return 0;if(Array.isArray(s.type))return null;return '';}
      const result=body.text.format.name==='examkok_math_tutor_v12'?{answer:'검증용 AI 응답: 기울기는 y의 변화량을 x의 변화량으로 나눈 비율입니다.',math_scene:fixture.math_scene}:body.text.format.name==='examkok_math_visual_v12'?{math_scene:fixture.math_scene,limitations:''}:{...defaults(schema),...fixture};
      return json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(result)}]}]});
    }
    return json({output:[{content:[{type:'output_text',text:'검증용 AI 응답: 기울기는 y의 변화량을 x의 변화량으로 나눈 비율입니다.'}]}]});
  }
  throw new Error('Unexpected mocked API URL');
};
