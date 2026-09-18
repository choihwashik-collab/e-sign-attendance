import { chromium } from 'playwright';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const output=path.join(root,'output','pdf','attendance-layout-100-people-two-sessions.pdf');
await mkdir(path.dirname(output),{recursive:true});
const css=await readFile(path.join(root,'css','style.css'),'utf8');
const browser=await chromium.launch({headless:true,executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'});
const page=await browser.newPage({viewport:{width:1200,height:900}});
await page.setContent(`<style>${css}</style><main><section id="view-admin"><div class="bg-white"><div class="p-4"><div id="tab-pane-document"><div class="pdf-paper-shell"><div id="pdf-preview-area"></div></div></div></div></div></section></main>`);
await page.addScriptTag({path:path.join(root,'js','pdf-generator.js')});
await page.evaluate(()=>{
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const attendees=Array.from({length:100},(_,i)=>({id:'att_'+i,department:['교무부','연구부','생활부','행정실'][i%4],name:'참석자 '+String(i+1).padStart(3,'0'),isSigned:i%3!==0,status:i===7?'출장':'출석',note:i===7?'교육청 회의':'',signatureData:i%3!==0?png:null}));
  const bundle={name:'2026년 9월 교직원 연수',sessions:[
    {id:'s1',title:'청렴 및 행동강령 연수',date:'2026-09-11',location:'시청각실',organizer:'교무기획부',verifierDept:'교무기획부',verifierName:'부장 홍길동'},
    {id:'s2',title:'학교 안전교육 연수',date:'2026-09-18',location:'강당',organizer:'생활안전부',verifierDept:'생활안전부',verifierName:'부장 김하늘'}]};
  window.PdfGenerator.renderPreviewDocument(bundle,attendees);
});
await page.emulateMedia({media:'print'});
await page.pdf({path:output,width:'210mm',height:'297mm',margin:{top:'0',right:'0',bottom:'0',left:'0'},printBackground:true,preferCSSPageSize:true});
await browser.close();
process.stdout.write(output);
