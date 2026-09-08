const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
const root=require('node:path').resolve(__dirname,'..');
const source=f=>fs.readFileSync(require('node:path').join(root,f),'utf8');
const clone=o=>JSON.parse(JSON.stringify(o));
const KEY='a'.repeat(64);
const PNG='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';

function server() {
  const props=new Map([['ADMIN_KEY',KEY]]),cache=new Map(),sheets=[];
  let nextId=1;
  class Range {
    constructor(sheet,r,c,n=1,m=1){Object.assign(this,{sheet,r,c,n,m});}
    getValues(){return Array.from({length:this.n},(_,i)=>Array.from({length:this.m},(_,j)=>this.sheet.rows[this.r+i-1]?.[this.c+j-1]??''));}
    getValue(){return this.getValues()[0][0];}
    setValues(rows){rows.forEach((row,i)=>{this.sheet.rows[this.r+i-1]??=[];row.forEach((v,j)=>this.sheet.rows[this.r+i-1][this.c+j-1]=v);});return this;}
    clearContent(){return this.setValues(Array.from({length:this.n},()=>Array(this.m).fill('')));}
    setFontWeight(){return this;} setBackground(){return this;}
    createTextFinder(text){const range=this;return {matchEntireCell(){return this;},findNext(){const index=range.getValues().findIndex(row=>String(row[0])===text);return index<0?null:{getRow:()=>range.r+index};}};}
  }
  class Sheet {
    constructor(name){this.name=name;this.id=nextId++;this.rows=[];}
    getRange(...args){return new Range(this,...args);}
    getLastRow(){let i=this.rows.length;while(i&&this.rows[i-1].every(v=>v===''))i--;return i;}
    getDataRange(){return this.getRange(1,1,this.getLastRow(),11);}
    getSheetId(){return this.id;} getName(){return this.name;}
    setFrozenRows(){} hideColumns(){} hideSheet(){}
    deleteRow(row){this.rows.splice(row-1,1);}
  }
  sheets.push(new Sheet('Sheet1'));
  const ss={getSheetByName:n=>sheets.find(s=>s.name===n),getSheetById:id=>sheets.find(s=>s.id===id),
    insertSheet:n=>{const s=new Sheet(n);sheets.push(s);return s;},getSheets:()=>sheets,
    deleteSheet:s=>sheets.splice(sheets.indexOf(s),1)};
  const context={console,Date,JSON,PropertiesService:{getScriptProperties:()=>({
    getProperty:k=>props.get(k)||null,setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)
  })},CacheService:{getScriptCache:()=>({get:k=>cache.get(k)||null,put:(k,v)=>cache.set(k,v),putAll:o=>Object.entries(o).forEach(([k,v])=>cache.set(k,v))})},
  SpreadsheetApp:{getActiveSpreadsheet:()=>ss},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  Utilities:{getUuid:()=>crypto.randomUUID(),DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
    computeDigest:(_,s)=>Array.from(crypto.createHash('sha256').update(s).digest())},
  ContentService:{MimeType:{JSON:'json',JAVASCRIPT:'js'},createTextOutput:body=>({body,setMimeType(type){this.type=type;return this;}})}};
  vm.createContext(context);vm.runInContext(source('google-apps-script/Code.gs'),context);
  function request(payload){
    const p={requestId:crypto.randomBytes(32).toString('hex'),...payload};
    context.doPost({postData:{contents:JSON.stringify(p)}});
    const meta=JSON.parse(context.doGet({parameter:{action:'receipt',requestId:p.requestId}}).body);
    if(!meta.ready)return meta;
    return JSON.parse(Array.from({length:meta.parts},(_,i)=>JSON.parse(context.doGet({parameter:{action:'receipt',requestId:p.requestId,part:String(i)}}).body).part).join(''));
  }
  return {context,request,props,cache,ss};
}
function bundle(){return {id:'bundle_test',name:'교육',sessions:[{id:'session_1',title:'연수',date:'2026-09-04'}],
  attendees:[{id:'att_1',name:'테스트',department:'교무부',status:'미서명',note:'private absence note'}]};}
function prepare(){
  const s=server();const created=s.request({action:'initBundle',bundle:bundle(),adminKey:KEY});assert.equal(created.success,true);
  const share=s.request({action:'shareBundle',bundleId:'bundle_test',adminKey:KEY});assert.equal(share.success,true);
  return {...s,created,token:share.token};
}
test('source syntax and no inline executable markup',()=>{
  for(const f of fs.readdirSync(root+'/js').filter(f=>f.endsWith('.js')))new vm.Script(source('js/'+f));
  new vm.Script(source('google-apps-script/Code.gs'));
  const html=source('index.html');
  assert.doesNotMatch(html,/\son(?:click|change|load|error)=/i);
  assert.doesNotMatch(html,/<script\s*>/i);
  assert.match(html,/Content-Security-Policy/);
  assert.doesNotMatch(html,/pdf.js\/3\.11|xlsx@0\.18|jspdf\/2\.5/);
});
test('anonymous legacy read and write routes fail closed',()=>{
  const s=server();
  for(const action of ['listBundles','getBundle','getStatus'])assert.equal(JSON.parse(s.context.doGet({parameter:{action,bundleId:'bundle_test'}}).body).success,false);
  for(const action of ['initBundle','deleteBundle','submitAttendee','login'])assert.equal(s.request({action,bundle:bundle(),bundleId:'bundle_test'}).success,false);
  assert.equal(s.ss.getSheets().length,1);
});
test('administrator key must be configured, strong and match',()=>{
  const s=server();assert.equal(s.request({action:'login',adminKey:KEY}).success,true);
  assert.equal(s.request({action:'login',adminKey:'2026'}).success,false);
  s.props.set('ADMIN_KEY','short');
  assert.equal(s.request({action:'login',adminKey:'short'}).success,false);
});
test('participant sees only current bundle roster, not signatures or private notes',()=>{
  const s=prepare();
  assert.equal(s.request({action:'submitSignature',bundleId:'bundle_test',token:s.token,attendeeId:'att_1',signatureData:PNG}).success,true);
  const data=s.request({action:'getBundle',bundleId:'bundle_test',token:s.token});
  assert.equal(data.bundle.attendees[0].isSigned,true);
  assert.equal(data.bundle.attendees[0].signatureData,undefined);
  assert.equal(data.bundle.attendees[0].note,undefined);
  for(const action of ['listBundles','deleteBundle','initBundle','submitAttendee','shareBundle']) {
    assert.equal(s.request({action,bundleId:'bundle_test',token:s.token,bundle:bundle()}).success,false,action);
  }
  assert.equal(s.request({action:'getBundle',bundleId:'another_bundle',token:s.token}).success,false);
});
test('invitation expiry, rotation and closing all revoke access',()=>{
  const s=prepare();
  const renewed=s.request({action:'shareBundle',bundleId:'bundle_test',adminKey:KEY});
  assert.notEqual(renewed.token,s.token);
  assert.equal(s.request({action:'getBundle',bundleId:'bundle_test',token:s.token}).success,false);
  const c=s.context.control_('bundle_test');c.expiresAt=Date.now()-1;s.context.setControl_('bundle_test',c);
  assert.equal(s.request({action:'getBundle',bundleId:'bundle_test',token:renewed.token}).success,false);
  const next=s.request({action:'shareBundle',bundleId:'bundle_test',adminKey:KEY});
  assert.equal(s.request({action:'closeSharing',bundleId:'bundle_test',adminKey:KEY}).success,true);
  assert.equal(s.request({action:'getBundle',bundleId:'bundle_test',token:next.token}).success,false);
});
test('stale roster writes fail; fresh edits preserve existing signatures',()=>{
  const s=prepare(),old=clone(s.created.bundle);
  assert.equal(s.request({action:'submitSignature',bundleId:'bundle_test',token:s.token,attendeeId:'att_1',signatureData:PNG}).success,true);
  const stale=s.request({action:'initBundle',bundle:old,expectedRevision:old.revision,adminKey:KEY});
  assert.equal(stale.success,false);assert.match(stale.message,/다른 기기/);
  const fresh=s.request({action:'getBundle',bundleId:'bundle_test',adminKey:KEY}).bundle;
  fresh.attendees[0].signatureData=null;fresh.attendees[0].status='미서명';fresh.location='새 장소';
  const edited=s.request({action:'initBundle',bundle:fresh,expectedRevision:fresh.revision,adminKey:KEY});
  assert.equal(edited.success,true);assert.equal(edited.bundle.attendees[0].signatureData,PNG);assert.equal(edited.bundle.location,'새 장소');
});
test('duplicate retry and fresh re-sign succeed; stale overwrite/unknown identity fails',()=>{
  const s=prepare(),p={action:'submitSignature',bundleId:'bundle_test',token:s.token,attendeeId:'att_1',signatureData:PNG};
  const a=s.request(p),b=s.request(p);assert.equal(a.success,true);assert.equal(a.signedAt,b.signedAt);
  assert.equal(s.request({...p,signatureData:PNG.replace('AAAANS','AAABNS')}).success,false);
  const corrected=s.request({...p,signatureData:PNG.replace('AAAANS','AAABNS'),expectedSignedAt:a.signedAt});
  assert.equal(corrected.success,true);assert.notEqual(corrected.signedAt,a.signedAt);
  assert.equal(s.request({...p,attendeeId:'att_fake'}).success,false);
  assert.equal(s.request({...p,signatureData:'https://example.com/signature.png'}).success,false);
  assert.equal(s.request({...p,signatureData:'data:image/png;base64,'+'A'.repeat(17000)}).success,false);
});

test('participant reason clears signature and allows later fresh signing',()=>{
  const s=prepare(),p={bundleId:'bundle_test',token:s.token,attendeeId:'att_1'};
  const sign=s.request({...p,action:'submitSignature',signatureData:PNG});
  const reason=s.request({...p,action:'submitReason',status:'출장',note:'교육청',expectedSignedAt:sign.signedAt});
  assert.equal(reason.success,true);
  const a=s.request({action:'getBundle',bundleId:'bundle_test',adminKey:KEY}).bundle.attendees[0];
  assert.equal(a.signatureData,null);assert.equal(a.isSigned,false);assert.equal(a.note,'출장: 교육청');
  assert.equal(s.request({...p,action:'submitSignature',signatureData:PNG,expectedSignedAt:sign.signedAt}).success,false);
  assert.equal(s.request({...p,action:'submitSignature',signatureData:PNG,expectedSignedAt:reason.signedAt}).success,true);
});

test('basic rosters are admin-only, revision checked and contain no attendance',()=>{
  const s=prepare(),roster={id:'roster_test',name:'기본명단1',attendees:[{name:'가상인물',department:'부서',signatureData:PNG,status:'출석'}]};
  for(const action of ['listRosters','saveRoster','deleteRoster'])assert.equal(s.request({action,roster,bundleId:'bundle_test',token:s.token}).success,false);
  const saved=s.request({action:'saveRoster',roster,adminKey:KEY});assert.equal(saved.success,true);
  assert.deepEqual(Object.keys(saved.roster.attendees[0]).sort(),['department','name','position']);
  assert.equal(s.request({action:'saveRoster',roster,adminKey:KEY}).success,false);
  const edited=s.request({action:'saveRoster',roster:{...saved.roster,name:'수정명단'},expectedRevision:1,adminKey:KEY});assert.equal(edited.success,true);
  assert.equal(s.request({action:'listRosters',adminKey:KEY}).rosters[0].name,'수정명단');
  assert.equal(s.request({action:'deleteRoster',rosterId:roster.id,expectedRevision:1,adminKey:KEY}).success,false);
  assert.equal(s.request({action:'deleteRoster',rosterId:roster.id,expectedRevision:2,adminKey:KEY}).success,true);
});
test('QR issuance never rewrites roster or increments revision',()=>{
  const s=prepare(),before=s.request({action:'getBundle',bundleId:'bundle_test',adminKey:KEY}).bundle;
  s.request({action:'shareBundle',bundleId:'bundle_test',adminKey:KEY});
  const after=s.request({action:'getBundle',bundleId:'bundle_test',adminKey:KEY}).bundle;
  assert.deepEqual(after,before);
});
test('delete is authenticated, version checked, and cannot be resurrected by signature',()=>{
  const s=prepare();
  assert.equal(s.request({action:'deleteBundle',bundleId:'bundle_test',expectedRevision:0,adminKey:KEY}).success,false);
  assert.equal(s.request({action:'deleteBundle',bundleId:'bundle_test',expectedRevision:1,adminKey:KEY}).success,true);
  assert.equal(s.request({action:'submitSignature',bundleId:'bundle_test',token:s.token,attendeeId:'att_1',signatureData:PNG}).success,false);
});
test('sheet formula input is escaped and JSONP callbacks are strictly validated',()=>{
  const s=server(),b=bundle();b.attendees[0].name='=1+1';
  assert.equal(s.request({action:'initBundle',bundle:b,adminKey:KEY}).success,true);
  const sheet=s.ss.getSheets().find(s=>s.name!=='Sheet1'&&s.name!=='_eSignBundles');
  assert.equal(sheet.rows[1][3],"'=1+1");
  const invalid=s.context.jsonResponse({success:true},'alert(1)//');assert.equal(invalid.type,'json');
  const valid=s.context.jsonResponse({value:'</script>'},'gas_cb_'+'a'.repeat(32));assert.equal(valid.type,'js');assert.doesNotMatch(valid.body,/<\/script>/);
});
test('same receipt request ID does not repeat mutations',()=>{
  const s=server(),p={action:'initBundle',bundle:bundle(),adminKey:KEY,requestId:'b'.repeat(64)};
  const first=s.request(p),again=s.request(p);assert.equal(first.bundle.revision,1);assert.deepEqual(again,first);
});

function client() {
  const elements=new Map(),storage=new Map(),intervals=[];
  const element=()=>({textContent:'',innerHTML:'',value:'',style:{},children:[],classList:{add(){},remove(){},toggle(){}},
    appendChild(child){this.children.push(child);},replaceChildren(){this.children=[];},addEventListener(){},querySelectorAll(){return[];},remove(){}});
  for(const m of source('index.html').matchAll(/id="([^"]+)"/g))elements.set(m[1],element());
  const context={console,URL,URLSearchParams,crypto:crypto.webcrypto,Uint8Array,AbortController,JSON,Date,
    window:{addEventListener(){}},document:{hidden:false,addEventListener(){},getElementById:id=>elements.get(id)||null,
      createElement:element,querySelectorAll:()=>[],querySelector:()=>null,body:element()},
    localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},
    location:new URL('https://example.test/index.html'),history:{replaceState(){}},
    setTimeout:()=>1,clearTimeout(){},setInterval:fn=>{intervals.push(fn);return 1;},clearInterval(){},confirm:()=>true};
  vm.createContext(context);
  for(const f of ['js/gas-sync.js','js/pdf-generator.js','js/app.js'])vm.runInContext(source(f),context);
  return {context,elements,storage,intervals,app:context.window.App,gas:context.window.GasSync,run:s=>vm.runInContext(s,context)};
}
test('blank server means disconnected; arbitrary/shared query URLs rejected',async()=>{
  const c=client();await c.gas.initialize();assert.equal(c.gas.getScriptUrl(),'');
  for(const url of ['https://evil.example/exec','https://script.google.com.evil.example/macros/s/a/exec','https://script.google.com/macros/s/a/exec?x=1','javascript:alert(1)'])assert.throws(()=>c.gas.setScriptUrl(url));
  c.gas.setScriptUrl('https://script.google.com/macros/s/test/exec');c.gas.adminKey=KEY;c.gas.setScriptUrl('');assert.equal(c.gas.getScriptUrl(),'');assert.equal(c.gas.adminKey,'');
});
test('transport reads server acknowledgement, not opaque success; key never enters query',async()=>{
  const c=client();c.gas.setScriptUrl('https://script.google.com/macros/s/test/exec');c.gas.adminKey=KEY;
  let sent;
  c.context.fetch=async(url,p)=>{sent=JSON.parse(p.body);assert.equal(p.mode,'no-cors');return {type:'opaque'};};
  c.gas._jsonpRequest=async(url,params)=>{
    assert.equal(params.adminKey,undefined);assert.equal(params.token,undefined);
    return params.part===undefined?{ready:true,parts:1}:{part:JSON.stringify({success:false,message:'server rejected'})};
  };
  await assert.rejects(()=>c.gas._post({action:'login'}),/server rejected/);
  assert.equal(sent.adminKey,KEY);
});
test('no automatic remote writes at startup, and local data stays untouched',async()=>{
  const c=client();c.storage.set('eSign_bundles','[{"id":"old"}]');
  c.gas.fetchBundles=()=>{throw Error('Unexpected remote fetch');};
  await c.app.init();assert.equal(c.storage.get('eSign_bundles'),'[{"id":"old"}]');
});
test('home selection starts polling; editing and signing pause refresh',async()=>{
  const c=client();c.gas.fetchBundle=async()=>bundle();
  await c.app.selectBundle('bundle_test');assert.equal(c.intervals.length,1);
  let fetched=0;c.app.syncFromGoogleSheet=async()=>fetched++;
  c.app.settingsDirty=true;c.intervals[0]();assert.equal(fetched,0);
  c.app.settingsDirty=false;c.run("AppState.selectedAttendeeForSign={id:'att_1'}");c.intervals[0]();assert.equal(fetched,0);
});
test('unsigned sick leave is not counted as signed',()=>{
  const c=client();c.run("AppState.currentBundle={attendees:[{id:'att',name:'Test',department:'Test',isSigned:false,status:'병가'}]};App.renderAdminOverview()");
  assert.equal(c.elements.get('stat-signed-count').textContent,'0명');assert.equal(c.elements.get('stat-sign-rate').textContent,'0%');
});
test('untrusted name HTML is escaped in participant and PDF templates',()=>{
  const c=client();
  c.run("AppState.currentBundle={attendees:[{id:'att',name:'<img src=x onerror=alert(1)>',department:'Test',isSigned:false}]};App.renderParticipantNameList()");
  const html=c.elements.get('participant-name-list').children[0].innerHTML;
  assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);
  const pdf=c.context.window.PdfGenerator;pdf.renderPreviewDocument({sessions:[{title:'<script>x</script>',date:'today'}]},[{name:'<b>test</b>',department:'<i>dept</i>',isSigned:true,signatureData:'x" onerror="alert(1)'}]);
  assert.doesNotMatch(c.elements.get('pdf-preview-area').innerHTML,/<b>test|<script>x|src="x"/);
});
test('failed signature save does not claim completion or discard canvas',async()=>{
  const c=client();c.run("AppState.currentBundle={id:'bundle_test',attendees:[{id:'att_1',name:'Test'}]};AppState.bundles=[AppState.currentBundle];AppState.selectedAttendeeForSign=AppState.currentBundle.attendees[0]");
  c.context.PNG=PNG;c.run("AppState.signaturePad={isEmpty:()=>false,toCompactDataURL:()=>PNG,clear:()=>{throw Error('must not clear')}}");
  c.gas.submitSignature=async()=>{throw Error('offline');};
  await assert.rejects(()=>c.app.handleSignatureSubmit(),/offline/);
  assert.equal(c.run('AppState.currentBundle.attendees[0].isSigned'),undefined);
  assert.equal(c.run('AppState.selectedAttendeeForSign.id'),'att_1');
});
test('failed metadata save does not mutate local state',async()=>{
  const c=client();c.context.B=bundle();c.run('AppState.isAdminAuthenticated=true;AppState.currentBundle=B;AppState.bundles=[B]');
  c.gas.syncBundle=async()=>{throw Error('conflict');};
  await assert.rejects(()=>c.app.editBundle(b=>b.name='overwrite'),/conflict/);
  assert.equal(c.run('AppState.currentBundle.name'),'교육');
});
test('local quota error is surfaced rather than silently reporting success',()=>{
  const c=client();c.app.localMode=true;c.context.localStorage.setItem=()=>{throw Error('quota exceeded');};
  assert.throws(()=>c.app.acceptBundle(bundle()),/quota exceeded/);
  assert.equal(c.run('AppState.bundles.length'),0);
});

