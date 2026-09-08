/**
 * js/pdf-generator.js
 * 공식 서명부 A4 문서 렌더링 및 PDF 다운로드 모듈
 * (v6: 연수 묶음 내 개별 세션별 PDF 생성 지원)
 */

const PdfGenerator = {
  escape(value) { return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); },
  safeSignature(value) { return /^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(value || '') ? value : ''; },
  getStatusDisplay(att) {
    if (att.status === '출장') return { text: '출장', isSpecial: true };
    if (att.status === '연가') return { text: '연가', isSpecial: true };
    if (att.status === '공가') return { text: '공가', isSpecial: true };
    if (att.status === '병가') return { text: '병가', isSpecial: true };
    if (att.status === '조퇴') return { text: '조퇴', isSpecial: true };
    if (att.status && att.status !== '출석' && att.status !== '서명완료') {
      return { text: att.status, isSpecial: true };
    }
    if (att.isSigned && att.signatureData) {
      return { text: '서명완료', isSpecial: false };
    }
    return { text: '미서명', isSpecial: false };
  },

  renderPreviewDocument(session, attendees, selectedSession) {
    const container = document.getElementById('pdf-preview-area') || document.getElementById('print-document');
    if (!container) return;

    const activeSession = selectedSession && typeof selectedSession === 'object' ? selectedSession : null;
    const displayTitle = (activeSession && activeSession.title) || selectedSession || session.title || (session.sessions && session.sessions[0] ? session.sessions[0].title : '연수 및 교육 참석자 서명부');

    const sortedAttendees = [...attendees].sort((a, b) => {
      if (a.department === b.department) return a.name.localeCompare(b.name, 'ko');
      return a.department.localeCompare(b.department, 'ko');
    });

    let approvalBoxHtml = '';
    if (session.showApprovalBox && Array.isArray(session.approvalStages) && session.approvalStages.length > 0) {
      const thStages = session.approvalStages.map(stage => `<th>${this.escape(stage.trim())}</th>`).join('');
      const tdSpaces = session.approvalStages.map(() => `<td class="sign-space"></td>`).join('');
      approvalBoxHtml = `
        <table class="approval-box">
          <tr>
            <th rowspan="2" style="width: 20px; background-color: #f3f4f6;">결<br>재</th>
            ${thStages}
          </tr>
          <tr>${tdSpaces}</tr>
        </table>
      `;
    }

    let tableRowsHtml = '';
    sortedAttendees.forEach((att, idx) => {
      const statusInfo = this.getStatusDisplay(att);
      let signCellContent = '';

      if (!statusInfo.isSpecial && att.isSigned && this.safeSignature(att.signatureData)) {
        signCellContent = `<img src="${this.safeSignature(att.signatureData)}" alt="${this.escape(att.name)} 서명" />`;
      }
      const noteText = this.noteText(att);

      tableRowsHtml += `
        <tr>
          <td style="width: 45px;">${idx + 1}</td>
          <td style="width: 120px;">${this.escape(att.department || '-')}</td>
          <td style="width: 85px;">${this.escape(att.position || '-')}</td>
          <td style="width: 95px; font-weight: 600;">${this.escape(att.name)}</td>
          <td class="signature-cell" style="width: 140px;">${signCellContent}</td>
          <td style="width: 80px; font-size: 11px; color: #4b5563;">${this.escape(noteText)}</td>
        </tr>
      `;
    });

    if (sortedAttendees.length === 0) {
      tableRowsHtml = `<tr><td colspan="6" style="padding: 30px; color: #9ca3af;">등록된 참석자 명단이 없습니다.</td></tr>`;
    }

    const verifierDept = session.verifierDept || session.organizer || '해당 부서';
    const verifierName = session.verifierName || '담당자';
    const verifierText = `확인자 : ${verifierDept} ${verifierName} (인)`;
    const dateStr = (activeSession && activeSession.date) || session.date || (session.sessions && session.sessions[0] ? session.sessions[0].date : new Date().toLocaleDateString('ko-KR'));

    container.innerHTML = `
      <div class="a4-preview-paper" id="a4-target-paper">
        <div style="display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 2px solid #111827; padding-bottom: 12px; margin-bottom: 14px;">
          <div>
            <h1 style="font-size: 22px; font-weight: 700; color: #111827; margin: 0; letter-spacing: -0.5px;">${this.escape(displayTitle)}</h1>
          </div>
          <div>${approvalBoxHtml}</div>
        </div>

        <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 4px; padding: 10px 14px; margin-bottom: 14px; font-size: 12px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px;">
          <div><strong>• 일 시 :</strong> ${this.escape(dateStr)}</div>
          <div><strong>• 장 소 :</strong> ${this.escape(session.location || '지정 연수실')}</div>
          <div><strong>• 주 관 :</strong> ${this.escape(session.organizer || '담당 부서')}</div>
        </div>

        <table class="doc-table">
          <thead>
            <tr><th>연번</th><th>소속 (부서)</th><th>직급</th><th>성명</th><th>서명</th><th>비고</th></tr>
          </thead>
          <tbody>${tableRowsHtml}</tbody>
        </table>

        <div style="margin-top: 30px; text-align: center; font-size: 12px; color: #374151;">
          <p style="margin-bottom: 10px;">위와 같이 연수(교육)에 참석하였음을 확인합니다.</p>
          <p style="font-weight: 600; font-size: 13px; margin-bottom: 20px;">
            ${new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric' })}
          </p>
          <p style="font-weight: 700; font-size: 14px; letter-spacing: 0.5px;">${this.escape(verifierText)}</p>
        </div>
      </div>
    `;
  },

  async downloadPdf(fileName = '연수_출석_서명부.pdf') {
    const targetElement = document.getElementById('a4-target-paper');
    if (!targetElement) { alert('출력할 서명부 내용이 없습니다.'); return; }

    if (!window.html2canvas || !window.jspdf) {
      throw new Error('PDF 생성 라이브러리가 로드되지 않았습니다. 인터넷 연결을 확인하거나 브라우저 인쇄를 사용하세요.');
    }

    const downloadBtn = document.getElementById('btn-download-pdf');
    const originalText = downloadBtn ? downloadBtn.innerHTML : '';
    if (downloadBtn) { downloadBtn.disabled = true; downloadBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-2"></i>PDF 생성 중...'; }

    try {
      const canvas = await window.html2canvas(targetElement, { scale: 2, useCORS: true, logging: false, backgroundColor: '#ffffff' });
      const imgData = canvas.toDataURL('image/jpeg', 0.95);
      const { jsPDF } = window.jspdf;
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = pdf.internal.pageSize.getHeight();
      const imgWidth = pdfWidth;
      const imgHeight = (canvas.height * pdfWidth) / canvas.width;
      let heightLeft = imgHeight;
      let position = 0;
      pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
      heightLeft -= pdfHeight;
      while (heightLeft > 0) {
        position = heightLeft - imgHeight;
        pdf.addPage();
        pdf.addImage(imgData, 'JPEG', 0, position, imgWidth, imgHeight);
        heightLeft -= pdfHeight;
      }
      pdf.save(fileName);
    } catch (err) {
      console.error('PDF Generation Error:', err);
      throw new Error('PDF 생성 중 오류가 발생했습니다. 브라우저 인쇄를 사용하거나 다시 시도하세요.');
    } finally {
      if (downloadBtn) { downloadBtn.disabled = false; downloadBtn.innerHTML = originalText; }
    }
  },

  async downloadAllSessionPdfs(bundle) {
    if (!bundle || !bundle.sessions || bundle.sessions.length === 0) {
      alert('연수 목록이 없습니다.');
      return;
    }

    const downloadBtn = document.getElementById('btn-download-pdf');
    const originalText = downloadBtn ? downloadBtn.innerHTML : '';

    try {
    for (let i = 0; i < bundle.sessions.length; i++) {
      const sess = bundle.sessions[i];
      if (downloadBtn) {
        downloadBtn.disabled = true;
        downloadBtn.innerHTML = `<i class="fas fa-spinner fa-spin mr-2"></i>${i + 1}/${bundle.sessions.length} PDF 생성 중...`;
      }
      this.renderPreviewDocument(bundle, bundle.attendees, sess);
      await new Promise(r => setTimeout(r, 300));
      const titleSafe = sess.title.replace(/[^\w가-힣]/g, '_');
      await this.downloadPdf(`${titleSafe}_출석서명부.pdf`);
      await new Promise(r => setTimeout(r, 500));
    }

    } finally {
      if (downloadBtn) { downloadBtn.disabled = false; downloadBtn.innerHTML = originalText; }
    }
    alert(`총 ${bundle.sessions.length}개 연수의 PDF가 생성되었습니다.`);
  },

  noteText(att) {
    const info=this.getStatusDisplay(att),note=String(att.note||'');
    return info.isSpecial ? (note.startsWith(info.text)?note:info.text+(note?': '+note:'')) : (note||(att.isDirectAdded?'현장추가':''));
  },
  buildExcelWorkbook(session, attendees) {
    if (!window.ExcelJS) throw new Error('Excel 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인하세요.');
    const workbook=new window.ExcelJS.Workbook(),sheet=workbook.addWorksheet('출석서명부');
    sheet.columns=[{width:7},{width:20},{width:14},{width:15},{width:25},{width:28}];
    sheet.mergeCells('A1:F1');sheet.getCell('A1').value=String(session.name||session.title||'출석서명부');
    sheet.getCell('A1').font={name:'맑은 고딕',size:16,bold:true};sheet.getRow(1).height=28;
    sheet.mergeCells('A2:F2');sheet.getCell('A2').value=(session.sessions||[]).map(s=>[s.date,s.title].filter(Boolean).join(' ')).join(' / ');
    sheet.getRow(2).height=32;sheet.addRow(['연번','소속 (부서)','직급','성명','서명','비고']);
    attendees.forEach((a,index)=>{
      const row=sheet.addRow([index+1,String(a.department||''),String(a.position||''),String(a.name||''),'',this.noteText(a)]);
      row.height=42;
      if(!this.getStatusDisplay(a).isSpecial && a.isSigned && this.safeSignature(a.signatureData)){
        const id=workbook.addImage({base64:a.signatureData,extension:'png'});
        sheet.addImage(id,{tl:{col:4.1,row:row.number-0.9},br:{col:4.9,row:row.number-0.1},editAs:'oneCell'});
      }
    });
    sheet.eachRow(row=>row.eachCell({includeEmpty:true},cell=>{
      cell.alignment={vertical:'middle',horizontal:'center',wrapText:true};
      if(row.number>2){cell.font={name:'맑은 고딕',size:11,bold:row.number===3};
        cell.border={top:{style:'thin'},bottom:{style:'thin'},left:{style:'thin'},right:{style:'thin'}};}
    }));
    sheet.pageSetup={paperSize:9,orientation:'portrait',fitToPage:true,fitToWidth:1,fitToHeight:0,printTitlesRow:'1:3'};
    return workbook;
  },
  async exportToExcel(session, attendees, fileName = '연수_출석명단.xlsx') {
    const bytes=await this.buildExcelWorkbook(session,attendees).xlsx.writeBuffer();
    const url=URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));
    const link=document.createElement('a');link.href=url;link.download=fileName;
    document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),10000);
  }
};
window.PdfGenerator = PdfGenerator;

