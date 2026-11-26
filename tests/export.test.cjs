const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const crypto=require('node:crypto');
test('Excel roundtrip embeds PNG and leaves absence signature blank, including formula-like names',async()=>{
  const response=await fetch('https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js');
  assert.equal(response.ok,true);
  const code=await response.text();
  assert.equal(crypto.createHash('sha384').update(code).digest('base64'),'Pqp51FUN2/qzfxZxBCtF0stpc9ONI6MYZpVqmo8m20SoaQCzf+arZvACkLkirlPz');
  const module={exports:{}};
  const context=vm.createContext({module,exports:module.exports,require,Buffer,setTimeout,clearTimeout,setImmediate,clearImmediate,console,TextEncoder,TextDecoder,Uint8Array,ArrayBuffer});
  vm.runInContext(code,context);
  const ExcelJS=module.exports;context.window={ExcelJS};
  vm.runInContext(fs.readFileSync('js/pdf-generator.js','utf8'),context);
  const png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
  const workbook=context.window.PdfGenerator.buildExcelWorkbook({name:'가상 검증'},[
    {name:'=1+1',isSigned:true,status:'출석',signatureData:png},
    {name:'가상출장',isSigned:true,status:'출장',note:'교육청',signatureData:png}
  ]);
  const bytes=await workbook.xlsx.writeBuffer(),loaded=new ExcelJS.Workbook();await loaded.xlsx.load(bytes);
  const sheet=loaded.getWorksheet('출석서명부');
  assert.equal(sheet.getImages().length,1);assert.equal(loaded.getImage(sheet.getImages()[0].imageId).extension,'png');
  assert.equal(sheet.getCell('D4').value,'=1+1');assert.equal(sheet.getCell('D4').formula,undefined);
  assert.ok(!sheet.getCell('E5').value);assert.equal(sheet.getCell('F5').value,'출장: 교육청');
  assert.equal(sheet.getImages()[0].range.tl.nativeRow,3);
});
test('downloadable basic roster template has the requested columns and numbered blank rows',async()=>{
  const response=await fetch('https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js'),code=await response.text();
  const context=vm.createContext({console,Uint8Array,ArrayBuffer,TextDecoder,TextEncoder});vm.runInContext(code,context);
  const workbook=context.XLSX.read(fs.readFileSync('outputs/basic-roster-template.xlsx'),{type:'buffer'});
  const rows=context.XLSX.utils.sheet_to_json(workbook.Sheets['기본명단'],{header:1});
  assert.deepEqual(Array.from(rows[0]),['연번','소속','직급','성명']);
  assert.equal(rows[1][0],1);assert.equal(rows[1][3],'');
  workbook.Sheets['기본명단'].B2.v='교무부';workbook.Sheets['기본명단'].C2.v='교사';workbook.Sheets['기본명단'].D2.v='가상인물';
  const bytes=context.XLSX.write(workbook,{type:'array',bookType:'xlsx'});context.window={XLSX:context.XLSX};
  vm.runInContext(fs.readFileSync('js/pdf-parser.js','utf8'),context);
  const uploadBuffer=await new Blob([Buffer.from(bytes)]).arrayBuffer();
  const parsed=await context.window.ListParser.parseExcel({arrayBuffer:async()=>uploadBuffer});
  assert.equal(parsed.length,1);assert.deepEqual([parsed[0].department,parsed[0].position,parsed[0].name],['교무부','교사','가상인물']);
  const multi=context.XLSX.utils.book_new();
  context.XLSX.utils.book_append_sheet(multi,context.XLSX.utils.aoa_to_sheet([['안내문']]),'안내');
  context.XLSX.utils.book_append_sheet(multi,context.XLSX.utils.aoa_to_sheet([
    ['위원회 명단'],[],[],[],[],[],['순 번','소 속','직 책','성 명'],
    [2,'위원회','위원','가위원'],[1,'위원회','위원장','하위원장'],[3,'위원회','위원','나위원']
  ]),'명단');
  const multiBytes=context.XLSX.write(multi,{type:'array',bookType:'xlsx'});
  const multiPeople=await context.window.ListParser.parseExcel({arrayBuffer:async()=>new Blob([Buffer.from(multiBytes)]).arrayBuffer()});
  assert.deepEqual(Array.from(multiPeople,p=>p.name),['하위원장','가위원','나위원']);
  assert.equal(multiPeople[0].position,'위원장');
});
test('adaptive PDF contains no blank rows, preserves order and labels meetings',()=>{
  const target={innerHTML:''},context=vm.createContext({console,Date,window:{},document:{getElementById:()=>target}});
  vm.runInContext(fs.readFileSync('js/pdf-generator.js','utf8'),context);
  const generator=context.window.PdfGenerator;
  for(const count of [0,1,7,25,26,49,50,51,75,100,101,200]){
    const people=Array.from({length:count},(_,i)=>({id:'a'+i,name:i===0?'하위원장':'가위원'+i,department:'위원회'}));
    generator.renderPreviewDocument({sessions:[{id:'meeting',title:'운영위원회',eventType:'회의',date:'2026-11-26'}]},people);
    assert.equal((target.innerHTML.match(/class="attendance-row"/g)||[]).length,count);
    assert.equal((target.innerHTML.match(/class="attendance-page"/g)||[]).length,Math.max(1,Math.ceil(count/50)));
    assert.match(target.innerHTML,/위와 같이 회의에 참석/);
    if(count>1)assert.ok(target.innerHTML.indexOf('하위원장')<target.innerHTML.indexOf('가위원1'));
    if(count<=25)assert.match(target.innerHTML,/single-column/);
    assert.doesNotMatch(target.innerHTML,/<td class="col-number"><\/td>/);
  }
});
test('PDF preview uses two 25-row columns, keeps 100 people to two pages, and separates sessions',()=>{
  const target={innerHTML:''},context=vm.createContext({console,Date,window:{},document:{getElementById:id=>id==='pdf-preview-area'?target:null}});
  vm.runInContext(fs.readFileSync('js/pdf-generator.js','utf8'),context);
  const people=Array.from({length:100},(_,i)=>({id:'a'+i,department:'부서'+(i%5),name:'참석자'+String(i+1).padStart(3,'0'),position:'교사',isSigned:false,status:'미서명'}));
  const bundle={name:'9월 연수 그룹',sessions:[{id:'s1',title:'청렴 연수',date:'2026-09-11'},{id:'s2',title:'안전 연수',date:'2026-09-12'}]};
  context.window.PdfGenerator.renderPreviewDocument(bundle,people);
  assert.equal((target.innerHTML.match(/class="attendance-page"/g)||[]).length,4);
  assert.equal((target.innerHTML.match(/class="attendance-table"/g)||[]).length,8);
  assert.equal((target.innerHTML.match(/class="attendance-row"/g)||[]).length,200);
  assert.equal((target.innerHTML.match(/청렴 연수/g)||[]).length,2);assert.equal((target.innerHTML.match(/안전 연수/g)||[]).length,2);
  assert.match(target.innerHTML,/2026-09-11/);assert.match(target.innerHTML,/2026-09-12/);
  const footers=target.innerHTML.match(/<footer class="attendance-footer">.*?<\/footer>/g);
  assert.equal(footers.length,4);
  for(const footer of footers){
    assert.equal((footer.match(/<span>/g)||[]).length,1);
    assert.match(footer,/확인자:/);
    assert.doesNotMatch(footer,/\d{4}|출력일/);
  }
  assert.match(target.innerHTML,/<th class="col-number">연번<\/th><th class="col-dept">부서<\/th><th class="col-name">성명<\/th><th class="col-sign">서명<\/th>/);
  assert.doesNotMatch(target.innerHTML,/>직급</);
  assert.match(target.innerHTML,/<th class="col-note">비고<\/th>/);
  const absence=context.window.PdfGenerator.columnHtml([{name:'홍길동',department:'교무부',status:'출장',note:'교육청 회의',isSigned:false}],1);
  assert.match(absence,/<td class="col-sign"><\/td><td class="col-note"><div[^>]*>출장: 교육청 회의<\/div>/);
});
