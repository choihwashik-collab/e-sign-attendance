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
});
