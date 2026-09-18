/** Official A4 attendance sheets: 25 rows x 2 columns, 50 people per page. */
const PdfGenerator = {
  ROWS_PER_COLUMN:25, PEOPLE_PER_PAGE:50,
  escape(value) { return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  safeSignature(value) { return /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value || '') ? value : ''; },
  getStatusDisplay(att) {
    const special=['출장','연가','공가','병가','조퇴','기타 불참'];
    if(special.includes(att.status))return {text:att.status,isSpecial:true};
    if(att.status && !['출석','서명완료','미서명'].includes(att.status))return {text:att.status,isSpecial:true};
    if(att.isSigned && att.signatureData)return {text:'서명완료',isSpecial:false};
    return {text:'미서명',isSpecial:false};
  },
  noteText(att) {
    const info=this.getStatusDisplay(att),note=String(att.note||'');
    return info.isSpecial ? (note.startsWith(info.text)?note:info.text+(note?': '+note:'')) : (note||(att.isDirectAdded?'현장추가':''));
  },
  effectiveSession(bundle,session) {
    const s=session||{};
    return {id:s.id||'',title:s.title||bundle.title||bundle.name||'연수 및 교육 참석자 서명부',date:s.date||bundle.date||'',
      location:s.location ?? bundle.location ?? '',organizer:s.organizer ?? bundle.organizer ?? '',
      verifierDept:s.verifierDept ?? bundle.verifierDept ?? '',verifierName:s.verifierName ?? bundle.verifierName ?? '',
      showApprovalBox:s.showApprovalBox ?? bundle.showApprovalBox ?? false,
      approvalStages:Array.isArray(s.approvalStages)?s.approvalStages:(Array.isArray(bundle.approvalStages)?bundle.approvalStages:[])};
  },
  sorted(attendees) {
    return [...(attendees||[])].sort((a,b)=>a.department===b.department?a.name.localeCompare(b.name,'ko'):a.department.localeCompare(b.department,'ko'));
  },
  approvalHtml(session) {
    if(!session.showApprovalBox||!session.approvalStages.length)return '';
    const heads=session.approvalStages.map(s=>`<th>${this.escape(s)}</th>`).join(''),cells=session.approvalStages.map(()=>'<td></td>').join('');
    return `<table class="approval-box"><tr><th rowspan="2" class="approval-label">결<br>재</th>${heads}</tr><tr>${cells}</tr></table>`;
  },
  signatureHtml(att) {
    if(!att)return '';
    const status=this.getStatusDisplay(att),signature=this.safeSignature(att.signatureData);
    if(status.isSpecial)return '';
    return att.isSigned&&signature?`<img src="${signature}" alt="${this.escape(att.name)} 서명">`:'';
  },
  nameHtml(att) {
    if(!att)return '';
    return `<span>${this.escape(att.name)}</span>`;
  },
  columnHtml(rows,startNumber) {
    let body='';
    for(let i=0;i<this.ROWS_PER_COLUMN;i++){
      const att=rows[i],number=att?startNumber+i:'';
      body+=`<tr class="attendance-row"><td class="col-number">${number}</td><td class="col-dept">${att?this.escape(att.department||'-'):''}</td><td class="col-name">${this.nameHtml(att)}</td><td class="col-sign">${this.signatureHtml(att)}</td><td class="col-note"><div title="${att?this.escape(this.noteText(att)):''}">${att?this.escape(this.noteText(att)):''}</div></td></tr>`;
    }
    return `<table class="attendance-table"><thead><tr><th class="col-number">연번</th><th class="col-dept">부서</th><th class="col-name">성명</th><th class="col-sign">서명</th><th class="col-note">비고</th></tr></thead><tbody>${body}</tbody></table>`;
  },
  pageHtml(bundle,session,people,pageIndex,totalPages) {
    const start=pageIndex*this.PEOPLE_PER_PAGE,pagePeople=people.slice(start,start+this.PEOPLE_PER_PAGE);
    const left=pagePeople.slice(0,this.ROWS_PER_COLUMN),right=pagePeople.slice(this.ROWS_PER_COLUMN);
    const verifier=[session.verifierDept||session.organizer||'해당 부서',session.verifierName||'담당자'].filter(Boolean).join(' ');
    const issued=new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric'});
    return `<section class="attendance-page" data-session-id="${this.escape(session.id)}" data-page="${pageIndex+1}">
      <header class="attendance-header"><div class="attendance-heading"><h1>${this.escape(session.title)}</h1><p>${this.escape(bundle.name||'연수 그룹')}</p></div>${this.approvalHtml(session)}</header>
      <div class="attendance-meta"><span><strong>일시</strong> ${this.escape(session.date||'-')}</span><span><strong>장소</strong> ${this.escape(session.location||'-')}</span><span><strong>주관</strong> ${this.escape(session.organizer||'-')}</span><span class="page-count">${pageIndex+1} / ${totalPages}</span></div>
      <div class="attendance-columns">${this.columnHtml(left,start+1)}${this.columnHtml(right,start+this.ROWS_PER_COLUMN+1)}</div>
      <footer class="attendance-footer"><span>위와 같이 연수(교육)에 참석하였음을 확인합니다.</span><span>${issued}</span><strong>확인자: ${this.escape(verifier)} (인)</strong></footer>
    </section>`;
  },
  renderPreviewDocument(bundle,attendees,selectedSession) {
    const container=document.getElementById('pdf-preview-area')||document.getElementById('print-document');
    if(!container)return;
    const sessions=selectedSession?[selectedSession]:(Array.isArray(bundle.sessions)&&bundle.sessions.length?bundle.sessions:[bundle]);
    const people=this.sorted(attendees),parts=[];
    for(const raw of sessions){const session=this.effectiveSession(bundle,raw),pages=Math.max(1,Math.ceil(people.length/this.PEOPLE_PER_PAGE));for(let p=0;p<pages;p++)parts.push(this.pageHtml(bundle,session,people,p,pages));}
    container.innerHTML=parts.join('');
  },
  async downloadPdf(fileName='연수_출석_서명부.pdf') {
    const pages=[...document.querySelectorAll('#pdf-preview-area .attendance-page')];
    if(!pages.length){alert('출력할 서명부 내용이 없습니다.');return;}
    if(!window.html2canvas||!window.jspdf)throw new Error('PDF 생성 라이브러리가 로드되지 않았습니다. 인터넷 연결을 확인하거나 브라우저 인쇄를 사용하세요.');
    const button=document.getElementById('btn-download-pdf'),original=button?button.innerHTML:'';if(button)button.disabled=true;
    try{
      const {jsPDF}=window.jspdf,pdf=new jsPDF('p','mm','a4');
      for(let i=0;i<pages.length;i++){
        if(button)button.innerHTML=`<i class="fas fa-spinner fa-spin mr-2"></i>${i+1}/${pages.length} 페이지 생성 중...`;
        const canvas=await window.html2canvas(pages[i],{scale:2,useCORS:true,logging:false,backgroundColor:'#ffffff',width:pages[i].scrollWidth,height:pages[i].scrollHeight});
        if(i)pdf.addPage('a4','p');pdf.addImage(canvas.toDataURL('image/jpeg',.94),'JPEG',0,0,210,297,undefined,'FAST');
      }
      pdf.save(fileName);
    }catch(error){console.error('PDF Generation Error:',error);throw new Error('PDF 생성 중 오류가 발생했습니다. 브라우저 인쇄를 사용하거나 다시 시도하세요.');}
    finally{if(button){button.disabled=false;button.innerHTML=original;}}
  },
  async downloadAllSessionPdfs(bundle) {
    if(!bundle?.sessions?.length){alert('연수 목록이 없습니다.');return;}
    this.renderPreviewDocument(bundle,bundle.attendees);await new Promise(r=>setTimeout(r,250));
    const safe=String(bundle.name||'연수').replace(/[^\w가-힣]/g,'_');await this.downloadPdf(`${safe}_전체_출석서명부.pdf`);
  },
  buildExcelWorkbook(session,attendees) {
    if(!window.ExcelJS)throw new Error('Excel 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
    const workbook=new window.ExcelJS.Workbook(),sheet=workbook.addWorksheet('출석서명부');sheet.columns=[{width:7},{width:20},{width:14},{width:15},{width:25},{width:28}];
    sheet.mergeCells('A1:F1');sheet.getCell('A1').value=String(session.name||session.title||'출석서명부');sheet.getCell('A1').font={name:'맑은 고딕',size:16,bold:true};sheet.getRow(1).height=28;
    sheet.mergeCells('A2:F2');sheet.getCell('A2').value=(session.sessions||[]).map(s=>[s.date,s.title].filter(Boolean).join(' ')).join(' / ');sheet.getRow(2).height=32;sheet.addRow(['연번','소속 (부서)','직급','성명','서명','비고']);
    attendees.forEach((a,index)=>{const row=sheet.addRow([index+1,String(a.department||''),String(a.position||''),String(a.name||''),'',this.noteText(a)]);row.height=42;if(!this.getStatusDisplay(a).isSpecial&&a.isSigned&&this.safeSignature(a.signatureData)){const id=workbook.addImage({base64:a.signatureData,extension:'png'});sheet.addImage(id,{tl:{col:4.1,row:row.number-.9},br:{col:4.9,row:row.number-.1},editAs:'oneCell'});}});
    sheet.eachRow(row=>row.eachCell({includeEmpty:true},cell=>{cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};if(row.number>2){cell.font={name:'맑은 고딕',size:11,bold:row.number===3};cell.border={top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}};}}));
    sheet.pageSetup={paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:3'};return workbook;
  },
  async exportToExcel(session,attendees,fileName='연수_출석명단.xlsx') {
    const bytes=await this.buildExcelWorkbook(session,attendees).xlsx.writeBuffer(),url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const link=document.createElement('a');link.href=url;link.download=fileName;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
};
window.PdfGenerator=PdfGenerator;
