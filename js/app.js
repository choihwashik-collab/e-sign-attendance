/**
 * js/app.js
 * 전자 서명 웹 애플리케이션 메인 컨트롤러 (사용자 수정사항 반영)
 */

const AppState = {
  session: {
    id: 'session_' + Math.random().toString(36).substr(2, 9),
    title: '2026년도 직무 역량강화 연수',
    date: new Date().toISOString().split('T')[0],
    location: '본관 대강당',
    organizer: '교육연수팀',
    verifierDept: '교육연수팀',
    verifierName: '김철수',
    showApprovalBox: false,
    approvalStages: ['담당', '확인', '부서장']
  },
  attendees: [],
  selectedDepartment: 'ALL',
  searchQuery: '',
  showUnsignedOnly: false,
  selectedAttendeeForSign: null,
  selectedAttendeeForAbsent: null,
  signaturePad: null,
  currentView: 'participant' // 'participant' | 'admin'
};

// 초기 기본 샘플 명단
const DEFAULT_ATTENDEES = [
  { id: 'att_1', department: '기획예산팀', name: '김철수', position: '팀장', isSigned: false, status: '미서명', signatureData: null, note: '' },
  { id: 'att_2', department: '기획예산팀', name: '이영희', position: '대리', isSigned: false, status: '미서명', signatureData: null, note: '' },
  { id: 'att_3', department: '교육연구부', name: '박민수', position: '부장', isSigned: false, status: '미서명', signatureData: null, note: '' },
  { id: 'att_4', department: '교육연구부', name: '정다은', position: '연구원', isSigned: false, status: '미서명', signatureData: null, note: '' },
  { id: 'att_5', department: '행정지원과', name: '홍길동', position: '주무관', isSigned: false, status: '미서명', signatureData: null, note: '' },
  { id: 'att_6', department: '행정지원과', name: '최지우', position: '주임', isSigned: false, status: '출장', signatureData: null, note: '관외출장' },
  { id: 'att_7', department: '디지털혁신팀', name: '강하늘', position: '과장', isSigned: false, status: '미서명', signatureData: null, note: '' },
  { id: 'att_8', department: '디지털혁신팀', name: '윤서아', position: '사원', isSigned: false, status: '연가', signatureData: null, note: '오후반차' }
];

document.addEventListener('DOMContentLoaded', () => {
  App.init();
});

const App = {
  init() {
    this.loadFromStorage();
    this.setupSignaturePad();
    this.setupEventListeners();
    this.render();

    // URL 파라미터 확인 (예: ?view=admin or ?sign=sessionId)
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('view') === 'admin') {
      this.switchView('admin');
    } else {
      this.switchView('participant');
    }
  },

  loadFromStorage() {
    const savedSession = localStorage.getItem('eSign_session');
    const savedAttendees = localStorage.getItem('eSign_attendees');

    if (savedSession) {
      try { 
        const parsed = JSON.parse(savedSession);
        AppState.session = Object.assign(AppState.session, parsed);
        if (!AppState.session.verifierDept) AppState.session.verifierDept = AppState.session.organizer || '담당부서';
        if (!AppState.session.verifierName) AppState.session.verifierName = '담당자';
        if (AppState.session.showApprovalBox === undefined) AppState.session.showApprovalBox = false;
        if (!AppState.session.approvalStages) AppState.session.approvalStages = ['담당', '확인', '부서장'];
      } catch(e){}
    }
    if (savedAttendees) {
      try { 
        const parsed = JSON.parse(savedAttendees);
        if (Array.isArray(parsed) && parsed.length > 0) {
          AppState.attendees = parsed;
        } else {
          AppState.attendees = [...DEFAULT_ATTENDEES];
        }
      } catch(e){
        AppState.attendees = [...DEFAULT_ATTENDEES];
      }
    } else {
      AppState.attendees = [...DEFAULT_ATTENDEES];
    }
  },

  saveToStorage() {
    localStorage.setItem('eSign_session', JSON.stringify(AppState.session));
    localStorage.setItem('eSign_attendees', JSON.stringify(AppState.attendees));
  },

  setupSignaturePad() {
    const canvas = document.getElementById('signature-canvas');
    if (canvas) {
      AppState.signaturePad = new SmoothSignaturePad(canvas, {
        strokeColor: '#0f172a',
        minWidth: 1.8,
        maxWidth: 4.0
      });
    }
  },

  setupEventListeners() {
    // 뷰 전환 버튼 (헤더)
    document.querySelectorAll('[data-switch-view]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const view = e.currentTarget.getAttribute('data-switch-view');
        this.switchView(view);
      });
    });

    // 관리자 하위 탭 전환
    document.querySelectorAll('[data-admin-tab]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const tab = e.currentTarget.getAttribute('data-admin-tab');
        this.switchAdminTab(tab);
      });
    });

    // 참여자 화면 - 부서 필터 변경
    const deptSelect = document.getElementById('participant-dept-select');
    if (deptSelect) {
      deptSelect.addEventListener('change', (e) => {
        AppState.selectedDepartment = e.target.value;
        this.renderParticipantNameList();
      });
    }

    // 참여자 화면 - 이름 검색
    const nameSearch = document.getElementById('participant-name-search');
    if (nameSearch) {
      nameSearch.addEventListener('input', (e) => {
        AppState.searchQuery = e.target.value.trim().toLowerCase();
        this.renderParticipantNameList();
      });
    }

    // 서명 패드 조작 버튼
    const btnClearSign = document.getElementById('btn-clear-signature');
    if (btnClearSign) {
      btnClearSign.addEventListener('click', () => {
        if (AppState.signaturePad) AppState.signaturePad.clear();
      });
    }

    const btnUndoSign = document.getElementById('btn-undo-signature');
    if (btnUndoSign) {
      btnUndoSign.addEventListener('click', () => {
        if (AppState.signaturePad) AppState.signaturePad.undo();
      });
    }

    // 서명 제출 버튼
    const btnSubmitSign = document.getElementById('btn-submit-signature');
    if (btnSubmitSign) {
      btnSubmitSign.addEventListener('click', () => this.handleSignatureSubmit());
    }

    // 서명 취소/다시 선택 버튼
    const btnCancelSign = document.getElementById('btn-cancel-signature');
    if (btnCancelSign) {
      btnCancelSign.addEventListener('click', () => this.cancelSigning());
    }

    // 직접 참석자 추가 모달 열기/닫기
    const btnOpenAddAttendee = document.getElementById('btn-open-add-attendee');
    const modalAddAttendee = document.getElementById('modal-add-attendee');
    const btnCloseAddModal = document.getElementById('btn-close-add-modal');
    const formAddAttendee = document.getElementById('form-add-attendee');

    if (btnOpenAddAttendee && modalAddAttendee) {
      btnOpenAddAttendee.addEventListener('click', () => {
        modalAddAttendee.classList.remove('hidden');
        document.getElementById('direct-name').focus();
      });
    }

    if (btnCloseAddModal && modalAddAttendee) {
      btnCloseAddModal.addEventListener('click', () => {
        modalAddAttendee.classList.add('hidden');
      });
    }

    if (formAddAttendee) {
      formAddAttendee.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleDirectAddAttendee();
      });
    }

    // 불참(출장/연가) 사유 모달 이벤트
    const modalAbsent = document.getElementById('modal-absent-reason');
    const btnCloseAbsentModal = document.getElementById('btn-close-absent-modal');
    const formAbsentReason = document.getElementById('form-absent-reason');

    if (btnCloseAbsentModal && modalAbsent) {
      btnCloseAbsentModal.addEventListener('click', () => {
        modalAbsent.classList.add('hidden');
      });
    }

    if (formAbsentReason) {
      formAbsentReason.addEventListener('submit', (e) => {
        e.preventDefault();
        this.handleAbsentSubmit();
      });
    }

    // 파일 업로드 설정
    this.setupFileUpload();

    // 연수 기본정보 & 확인자 & 결재란 수정 폼
    const sessionForm = document.getElementById('form-session-info');
    if (sessionForm) {
      sessionForm.addEventListener('submit', (e) => {
        e.preventDefault();
        AppState.session.title = document.getElementById('input-session-title').value.trim();
        AppState.session.date = document.getElementById('input-session-date').value;
        AppState.session.location = document.getElementById('input-session-location').value.trim();
        AppState.session.organizer = document.getElementById('input-session-organizer').value.trim();
        AppState.session.verifierDept = document.getElementById('input-verifier-dept').value.trim();
        AppState.session.verifierName = document.getElementById('input-verifier-name').value.trim();
        AppState.session.showApprovalBox = document.getElementById('check-show-approval').checked;
        
        const stagesText = document.getElementById('input-approval-stages').value.trim();
        AppState.session.approvalStages = stagesText ? stagesText.split(',').map(s => s.trim()).filter(Boolean) : ['담당', '확인', '부서장'];

        this.saveToStorage();
        alert('연수 설정 및 서명부 양식이 저장되었습니다.');
        this.render();
        this.renderPdfPreview();
      });
    }

    // 결재란 체크박스 토글 시 인풋 활성화
    const checkShowApproval = document.getElementById('check-show-approval');
    const approvalStagesContainer = document.getElementById('approval-stages-container');
    if (checkShowApproval && approvalStagesContainer) {
      checkShowApproval.addEventListener('change', (e) => {
        if (e.target.checked) {
          approvalStagesContainer.classList.remove('opacity-50', 'pointer-events-none');
        } else {
          approvalStagesContainer.classList.add('opacity-50', 'pointer-events-none');
        }
      });
    }

    // PDF 다운로드 및 인쇄 버튼
    const btnDownloadPdf = document.getElementById('btn-download-pdf');
    if (btnDownloadPdf) {
      btnDownloadPdf.addEventListener('click', () => {
        const titleSafe = AppState.session.title.replace(/[^\w가-힣]/g, '_');
        PdfGenerator.downloadPdf(`${titleSafe}_출석서명부.pdf`);
      });
    }

    const btnPrintDoc = document.getElementById('btn-print-doc');
    if (btnPrintDoc) {
      btnPrintDoc.addEventListener('click', () => {
        window.print();
      });
    }

    const btnExportExcel = document.getElementById('btn-export-excel');
    if (btnExportExcel) {
      btnExportExcel.addEventListener('click', () => {
        const titleSafe = AppState.session.title.replace(/[^\w가-힣]/g, '_');
        PdfGenerator.exportToExcel(AppState.session, AppState.attendees, `${titleSafe}_출석명단.xlsx`);
      });
    }

    // 구글 앱 스크립트 연동 설정 저장 & 테스트
    const btnSaveGasUrl = document.getElementById('btn-save-gas-url');
    if (btnSaveGasUrl) {
      btnSaveGasUrl.addEventListener('click', async () => {
        const url = document.getElementById('input-gas-url').value.trim();
        GasSync.setScriptUrl(url);
        
        const testResultEl = document.getElementById('gas-test-result');
        testResultEl.className = 'text-sm mt-2 text-blue-600';
        testResultEl.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>연결 확인 중...';
        
        const res = await GasSync.testConnection(url);
        if (res.success) {
          testResultEl.className = 'text-sm mt-2 text-green-600 font-semibold';
          testResultEl.innerHTML = `<i class="fas fa-check-circle mr-1"></i>${res.message}`;
          this.updateGasStatusBadge(true);
        } else {
          testResultEl.className = 'text-sm mt-2 text-amber-600';
          testResultEl.innerHTML = `<i class="fas fa-exclamation-triangle mr-1"></i>${res.message}`;
          this.updateGasStatusBadge(false);
        }
      });
    }

    // QR코드 전체화면 모달
    const btnOpenQrModal = document.getElementById('btn-open-fullscreen-qr');
    const modalQr = document.getElementById('modal-fullscreen-qr');
    const btnCloseQrModal = document.getElementById('btn-close-qr-modal');

    if (btnOpenQrModal && modalQr) {
      btnOpenQrModal.addEventListener('click', () => {
        modalQr.classList.remove('hidden');
        this.renderLargeQrCode();
      });
    }
    if (btnCloseQrModal && modalQr) {
      btnCloseQrModal.addEventListener('click', () => {
        modalQr.classList.add('hidden');
      });
    }
  },

  setupFileUpload() {
    const dropZone = document.getElementById('roster-drop-zone');
    const fileInput = document.getElementById('roster-file-input');

    if (!dropZone || !fileInput) return;

    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropZone.classList.add('border-blue-500', 'bg-blue-50');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500', 'bg-blue-50');
      }, false);
    });

    dropZone.addEventListener('drop', (e) => {
      const files = e.dataTransfer.files;
      if (files.length > 0) this.handleRosterFile(files[0]);
    });

    fileInput.addEventListener('change', (e) => {
      if (e.target.files.length > 0) this.handleRosterFile(e.target.files[0]);
    });

    // 텍스트 직접 붙여넣기 파싱 버튼
    const btnParseText = document.getElementById('btn-parse-text-roster');
    if (btnParseText) {
      btnParseText.addEventListener('click', () => {
        const text = document.getElementById('textarea-roster-paste').value;
        if (!text.trim()) {
          alert('붙여넣을 명단 텍스트를 입력해 주세요.');
          return;
        }
        const lines = text.split('\n');
        const parsed = ListParser.parseTextLines(lines);
        if (parsed.length === 0) {
          alert('인식 가능한 이름이나 부서 형식을 찾을 수 없습니다. 예시를 참고해 주세요.');
          return;
        }
        this.appendOrReplaceAttendees(parsed);
      });
    }
  },

  async handleRosterFile(file) {
    const statusEl = document.getElementById('file-upload-status');
    if (statusEl) {
      statusEl.innerHTML = `<i class="fas fa-spinner fa-spin text-blue-600 mr-2"></i><strong>${file.name}</strong> 파일 분석 중...`;
    }

    try {
      let attendees = [];
      if (file.name.endsWith('.pdf')) {
        attendees = await ListParser.parsePdf(file);
      } else if (file.name.match(/\.(xlsx|xls|csv)$/i)) {
        attendees = await ListParser.parseExcel(file);
      } else {
        const text = await file.text();
        attendees = ListParser.parseTextLines(text.split('\n'));
      }

      if (attendees.length === 0) {
        if (statusEl) statusEl.innerHTML = `<span class="text-amber-600"><i class="fas fa-exclamation-circle mr-1"></i>명단을 추출하지 못했습니다. 형식을 확인해 주세요.</span>`;
        return;
      }

      this.appendOrReplaceAttendees(attendees);
      if (statusEl) {
        statusEl.innerHTML = `<span class="text-green-600 font-semibold"><i class="fas fa-check-circle mr-1"></i><strong>${attendees.length}명</strong>의 명단이 성공적으로 등록되었습니다!</span>`;
      }
    } catch (err) {
      console.error(err);
      if (statusEl) {
        statusEl.innerHTML = `<span class="text-red-600"><i class="fas fa-times-circle mr-1"></i>파일 파싱 오류: ${err.message}</span>`;
      }
    }
  },

  appendOrReplaceAttendees(newAttendees) {
    const isReplace = document.getElementById('radio-roster-replace')?.checked;
    if (isReplace) {
      AppState.attendees = newAttendees;
    } else {
      const existingKeys = new Set(AppState.attendees.map(a => `${a.department}_${a.name}`));
      const filtered = newAttendees.filter(a => !existingKeys.has(`${a.department}_${a.name}`));
      AppState.attendees = [...AppState.attendees, ...filtered];
    }

    this.saveToStorage();
    this.render();
    alert(`총 ${AppState.attendees.length}명의 참석자 명단이 준비되었습니다.`);
  },

  switchView(viewName) {
    AppState.currentView = viewName;
    const viewParticipant = document.getElementById('view-participant');
    const viewAdmin = document.getElementById('view-admin');
    const navParticipantBtn = document.getElementById('nav-btn-participant');
    const navAdminBtn = document.getElementById('nav-btn-admin');

    if (viewName === 'admin') {
      viewParticipant.classList.add('hidden');
      viewAdmin.classList.remove('hidden');
      navAdminBtn.classList.add('bg-blue-700', 'text-white');
      navAdminBtn.classList.remove('text-blue-100');
      navParticipantBtn.classList.remove('bg-blue-700', 'text-white');
      navParticipantBtn.classList.add('text-blue-100');
      this.renderAdminOverview();
      this.renderPdfPreview();
      this.renderAdminQrCode();
    } else {
      viewAdmin.classList.add('hidden');
      viewParticipant.classList.remove('hidden');
      navParticipantBtn.classList.add('bg-blue-700', 'text-white');
      navParticipantBtn.classList.remove('text-blue-100');
      navAdminBtn.classList.remove('bg-blue-700', 'text-white');
      navAdminBtn.classList.add('text-blue-100');
      this.renderParticipantView();
    }
  },

  switchAdminTab(tabName) {
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      if (btn.getAttribute('data-admin-tab') === tabName) {
        btn.classList.add('border-blue-600', 'text-blue-600', 'font-bold');
        btn.classList.remove('border-transparent', 'text-gray-500');
      } else {
        btn.classList.remove('border-blue-600', 'text-blue-600', 'font-bold');
        btn.classList.add('border-transparent', 'text-gray-500');
      }
    });

    document.querySelectorAll('.admin-tab-pane').forEach(pane => {
      if (pane.id === `tab-pane-${tabName}`) {
        pane.classList.remove('hidden');
      } else {
        pane.classList.add('hidden');
      }
    });

    if (tabName === 'document') {
      this.renderPdfPreview();
    } else if (tabName === 'qr') {
      this.renderAdminQrCode();
    } else if (tabName === 'live') {
      this.renderAdminOverview();
    }
  },

  render() {
    this.updateHeaderInfo();
    this.renderDepartmentFilter();
    this.renderParticipantView();
    this.renderAdminOverview();
  },

  updateHeaderInfo() {
    document.querySelectorAll('.session-title-text').forEach(el => el.textContent = AppState.session.title);
    document.querySelectorAll('.session-date-text').forEach(el => el.textContent = AppState.session.date);
    document.querySelectorAll('.session-location-text').forEach(el => el.textContent = AppState.session.location);

    // 폼 동기화
    if (document.getElementById('input-session-title')) {
      document.getElementById('input-session-title').value = AppState.session.title;
      document.getElementById('input-session-date').value = AppState.session.date;
      document.getElementById('input-session-location').value = AppState.session.location;
      document.getElementById('input-session-organizer').value = AppState.session.organizer;
      document.getElementById('input-verifier-dept').value = AppState.session.verifierDept || AppState.session.organizer;
      document.getElementById('input-verifier-name').value = AppState.session.verifierName || '';
      
      const checkApproval = document.getElementById('check-show-approval');
      if (checkApproval) {
        checkApproval.checked = !!AppState.session.showApprovalBox;
        const container = document.getElementById('approval-stages-container');
        if (container) {
          if (AppState.session.showApprovalBox) {
            container.classList.remove('opacity-50', 'pointer-events-none');
          } else {
            container.classList.add('opacity-50', 'pointer-events-none');
          }
        }
      }

      const stagesInput = document.getElementById('input-approval-stages');
      if (stagesInput) {
        stagesInput.value = (AppState.session.approvalStages || ['담당', '확인', '부서장']).join(', ');
      }
    }

    const gasUrl = GasSync.getScriptUrl();
    if (document.getElementById('input-gas-url')) {
      document.getElementById('input-gas-url').value = gasUrl;
    }
    this.updateGasStatusBadge(!!gasUrl);
  },

  updateGasStatusBadge(isConnected) {
    const badge = document.getElementById('gas-sync-badge');
    if (!badge) return;
    if (isConnected) {
      badge.innerHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-emerald-100 text-emerald-800"><span class="w-1.5 h-1.5 mr-1.5 bg-emerald-500 rounded-full"></span>구글 시트 연동됨</span>`;
    } else {
      badge.innerHTML = `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600"><span class="w-1.5 h-1.5 mr-1.5 bg-gray-400 rounded-full"></span>로컬 브라우저 모드</span>`;
    }
  },

  getDepartments() {
    const depts = new Set(AppState.attendees.map(a => a.department || '일반'));
    return Array.from(depts).filter(Boolean).sort();
  },

  renderDepartmentFilter() {
    const depts = this.getDepartments();
    const select = document.getElementById('participant-dept-select');
    const adminSelect = document.getElementById('admin-dept-filter');

    const renderOptions = (selectEl, defaultText = '전체 부서') => {
      if (!selectEl) return;
      const currentVal = selectEl.value;
      selectEl.innerHTML = `<option value="ALL">${defaultText} (${AppState.attendees.length}명)</option>` +
        depts.map(d => {
          const count = AppState.attendees.filter(a => a.department === d).length;
          return `<option value="${d}">${d} (${count}명)</option>`;
        }).join('');
      if (depts.includes(currentVal) || currentVal === 'ALL') {
        selectEl.value = currentVal;
      }
    };

    renderOptions(select, '전체 부서');
    renderOptions(adminSelect, '전체 부서 보기');

    if (adminSelect) {
      adminSelect.onchange = (e) => {
        this.renderAdminOverview(e.target.value);
      };
    }
  },

  /* ================== 참여자 서명 화면 로직 ================== */
  renderParticipantView() {
    this.renderParticipantNameList();
    
    if (AppState.selectedAttendeeForSign) {
      document.getElementById('step-select-person').classList.add('hidden');
      document.getElementById('step-sign-canvas').classList.remove('hidden');
      
      const att = AppState.selectedAttendeeForSign;
      document.getElementById('signing-person-name').textContent = att.name;
      document.getElementById('signing-person-dept').textContent = `${att.department} · ${att.position || '참석자'}`;
      
      if (AppState.signaturePad) {
        setTimeout(() => AppState.signaturePad.resizeCanvas(), 50);
      }
    } else {
      document.getElementById('step-select-person').classList.remove('hidden');
      document.getElementById('step-sign-canvas').classList.add('hidden');
      document.getElementById('step-sign-complete').classList.add('hidden');
    }
  },

  renderParticipantNameList() {
    const listContainer = document.getElementById('participant-name-list');
    if (!listContainer) return;

    const currentDept = AppState.selectedDepartment;
    const query = AppState.searchQuery;

    let filtered = AppState.attendees.filter(a => {
      const matchDept = currentDept === 'ALL' || a.department === currentDept;
      const matchName = !query || a.name.toLowerCase().includes(query) || (a.department && a.department.toLowerCase().includes(query));
      return matchDept && matchName;
    });

    filtered.sort((a, b) => {
      if (a.department === b.department) return a.name.localeCompare(b.name, 'ko');
      return a.department.localeCompare(b.department, 'ko');
    });

    if (filtered.length === 0) {
      listContainer.innerHTML = `
        <div class="col-span-full py-10 text-center text-gray-500 bg-white rounded-xl border border-dashed border-gray-300 p-6">
          <i class="fas fa-search text-3xl text-gray-400 mb-2"></i>
          <p class="font-medium text-gray-700">검색 조건에 맞는 참석자가 없습니다.</p>
          <p class="text-xs text-gray-500 mt-1 mb-4">명단에 이름이 없으신 경우 아래 버튼으로 직접 추가해 주세요.</p>
          <button onclick="document.getElementById('btn-open-add-attendee').click()" class="inline-flex items-center px-4 py-2 bg-blue-50 text-blue-700 font-semibold rounded-lg text-sm hover:bg-blue-100">
            <i class="fas fa-user-plus mr-1.5"></i> 내 이름 직접 등록하기
          </button>
        </div>
      `;
      return;
    }

    listContainer.innerHTML = filtered.map(att => {
      const isSpecialStatus = att.status && !['미서명', '출석', ''].includes(att.status);

      if (isSpecialStatus) {
        return `
          <div class="bg-amber-50/70 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
            <div class="flex items-center space-x-3">
              <div class="w-10 h-10 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center font-bold text-xs">
                ${att.status}
              </div>
              <div>
                <div class="flex items-center space-x-1.5">
                  <span class="font-bold text-gray-800">${att.name}</span>
                  <span class="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-600">${att.position || '참석자'}</span>
                </div>
                <div class="text-xs text-gray-500 mt-0.5">${att.department} · [${att.status}] 등록됨</div>
              </div>
            </div>
            <button onclick="App.openAbsentModal('${att.id}')" class="text-xs text-amber-700 hover:text-amber-900 bg-white px-2.5 py-1 rounded-lg border border-amber-300">
              사유변경
            </button>
          </div>
        `;
      }

      if (att.isSigned) {
        return `
          <div class="bg-gray-50 border border-gray-200 rounded-xl p-4 flex items-center justify-between opacity-80">
            <div class="flex items-center space-x-3">
              <div class="w-10 h-10 rounded-full bg-emerald-100 text-emerald-600 flex items-center justify-center font-bold text-sm">
                <i class="fas fa-check"></i>
              </div>
              <div>
                <div class="flex items-center space-x-1.5">
                  <span class="font-bold text-gray-700">${att.name}</span>
                  <span class="text-xs px-2 py-0.5 rounded bg-gray-200 text-gray-600">${att.position || '참석자'}</span>
                </div>
                <div class="text-xs text-gray-500 mt-0.5">${att.department} · 서명완료</div>
              </div>
            </div>
            <span class="text-xs font-semibold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
              완료됨
            </span>
          </div>
        `;
      }

      return `
        <div class="bg-white hover:border-blue-300 border border-gray-200 rounded-xl p-4 flex items-center justify-between shadow-sm transition-all">
          <div class="flex items-center space-x-3 cursor-pointer flex-1" onclick="App.startSigning('${att.id}')">
            <div class="w-10 h-10 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-base">
              ${att.name.charAt(0)}
            </div>
            <div>
              <div class="flex items-center space-x-1.5">
                <span class="font-bold text-gray-900 text-base">${att.name}</span>
                <span class="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-600 font-medium">${att.position || '참석자'}</span>
              </div>
              <div class="text-xs text-gray-500 mt-0.5">${att.department}</div>
            </div>
          </div>
          
          <div class="flex items-center space-x-2">
            <button onclick="App.openAbsentModal('${att.id}')" class="px-2.5 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-600 text-xs rounded-lg font-medium transition-colors" title="출장/연가 등 불참 사유 입력">
              출장/연가
            </button>
            <button onclick="App.startSigning('${att.id}')" class="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold rounded-lg flex items-center space-x-1 shadow-sm">
              <span>서명</span>
              <i class="fas fa-chevron-right text-[10px]"></i>
            </button>
          </div>
        </div>
      `;
    }).join('');
  },

  startSigning(attendeeId) {
    const att = AppState.attendees.find(a => a.id === attendeeId);
    if (!att) return;

    if (att.isSigned) {
      if (!confirm(`${att.name}님은 이미 서명이 완료되었습니다. 다시 서명하시겠습니까?`)) {
        return;
      }
    }

    AppState.selectedAttendeeForSign = att;
    document.getElementById('step-select-person').classList.add('hidden');
    document.getElementById('step-sign-canvas').classList.remove('hidden');
    document.getElementById('step-sign-complete').classList.add('hidden');

    document.getElementById('signing-person-name').textContent = att.name;
    document.getElementById('signing-person-dept').textContent = `${att.department} · ${att.position || '참석자'}`;

    if (AppState.signaturePad) {
      AppState.signaturePad.clear();
      setTimeout(() => AppState.signaturePad.resizeCanvas(), 100);
    }

    window.scrollTo({ top: 0, behavior: 'smooth' });
  },

  cancelSigning() {
    AppState.selectedAttendeeForSign = null;
    document.getElementById('step-sign-canvas').classList.add('hidden');
    document.getElementById('step-select-person').classList.remove('hidden');
    this.renderParticipantNameList();
  },

  openAbsentModal(attendeeId) {
    const att = AppState.attendees.find(a => a.id === attendeeId);
    if (!att) return;

    AppState.selectedAttendeeForAbsent = att;
    document.getElementById('absent-target-name').textContent = `${att.name} (${att.department})`;
    document.getElementById('select-absent-type').value = ['출장', '연가', '공가', '병가', '조퇴'].includes(att.status) ? att.status : '출장';
    document.getElementById('input-absent-note').value = att.note || '';
    
    document.getElementById('modal-absent-reason').classList.remove('hidden');
  },

  handleAbsentSubmit() {
    if (!AppState.selectedAttendeeForAbsent) return;

    const type = document.getElementById('select-absent-type').value;
    const note = document.getElementById('input-absent-note').value.trim();

    const att = AppState.selectedAttendeeForAbsent;
    att.status = type;
    att.note = note;
    att.isSigned = false;
    att.signatureData = null;

    this.saveToStorage();

    document.getElementById('modal-absent-reason').classList.add('hidden');
    AppState.selectedAttendeeForAbsent = null;

    this.render();
    this.renderPdfPreview();
    alert(`${att.name} 님의 사유(${type})가 등록되었습니다.`);
  },

  async handleSignatureSubmit() {
    if (!AppState.selectedAttendeeForSign) return;

    if (!AppState.signaturePad || AppState.signaturePad.isEmpty()) {
      alert('서명란에 본인의 서명을 작성해 주세요.');
      return;
    }

    const signatureData = AppState.signaturePad.toDataURL();
    const att = AppState.selectedAttendeeForSign;
    att.isSigned = true;
    att.status = '출석';
    att.signatureData = signatureData;
    att.signedAt = new Date().toISOString();

    this.saveToStorage();

    // 완료 화면 표시
    document.getElementById('step-sign-canvas').classList.add('hidden');
    document.getElementById('step-sign-complete').classList.remove('hidden');
    document.getElementById('complete-user-name').textContent = `${att.name} (${att.department})`;
    document.getElementById('complete-user-time').textContent = '정상 서명 완료';

    // 구글 스프레드시트 비동기 전송
    GasSync.submitSignature(AppState.session.id, att).then(res => {
      console.log('GAS Submission Result:', res);
    });

    setTimeout(() => {
      if (AppState.currentView === 'participant' && !AppState.selectedAttendeeForSign) {
        document.getElementById('step-sign-complete').classList.add('hidden');
        document.getElementById('step-select-person').classList.remove('hidden');
        this.renderParticipantNameList();
      }
    }, 3000);

    AppState.selectedAttendeeForSign = null;
  },

  handleDirectAddAttendee() {
    const dept = document.getElementById('direct-dept').value.trim() || '현장참석';
    const name = document.getElementById('direct-name').value.trim();
    const pos = document.getElementById('direct-position').value.trim() || '참석자';

    if (!name) {
      alert('이름을 입력해 주세요.');
      return;
    }

    const newAtt = {
      id: 'att_' + Math.random().toString(36).substr(2, 9),
      department: dept,
      name: name,
      position: pos,
      isSigned: false,
      status: '미서명',
      signatureData: null,
      note: '',
      isDirectAdded: true
    };

    AppState.attendees.push(newAtt);
    this.saveToStorage();

    document.getElementById('modal-add-attendee').classList.add('hidden');
    document.getElementById('form-add-attendee').reset();

    this.renderDepartmentFilter();
    this.startSigning(newAtt.id);
  },

  /* ================== 관리자 화면 로직 ================== */
  renderAdminOverview(deptFilter = 'ALL') {
    const totalCount = AppState.attendees.length;
    const signedCount = AppState.attendees.filter(a => a.isSigned).length;
    const specialCount = AppState.attendees.filter(a => a.status && !['미서명', '출석', ''].includes(a.status)).length;
    const unsignedCount = totalCount - signedCount - specialCount;
    const signRate = totalCount > 0 ? Math.round(((signedCount + specialCount) / totalCount) * 100) : 0;

    const statTotalEl = document.getElementById('stat-total-count');
    const statSignedEl = document.getElementById('stat-signed-count');
    const statUnsignedEl = document.getElementById('stat-unsigned-count');
    const statRateEl = document.getElementById('stat-sign-rate');
    const statProgressEl = document.getElementById('stat-progress-bar');

    if (statTotalEl) statTotalEl.textContent = `${totalCount}명`;
    if (statSignedEl) statSignedEl.textContent = `${signedCount}명`;
    if (statUnsignedEl) statUnsignedEl.textContent = `${unsignedCount}명`;
    if (statRateEl) statRateEl.textContent = `${signRate}%`;
    if (statProgressEl) statProgressEl.style.width = `${signRate}%`;

    const tbody = document.getElementById('admin-attendee-table-body');
    if (!tbody) return;

    let filtered = AppState.attendees.filter(a => {
      if (deptFilter !== 'ALL' && a.department !== deptFilter) return false;
      if (AppState.showUnsignedOnly && (a.isSigned || (a.status && a.status !== '미서명'))) return false;
      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-gray-400">해당 조건의 참석자가 없습니다.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map((att, idx) => {
      const isSpecial = att.status && !['미서명', '출석', ''].includes(att.status);
      
      let signThumb = `<span class="text-xs text-gray-400">-</span>`;
      if (isSpecial) {
        signThumb = `<span class="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">${att.status}</span>`;
      } else if (att.isSigned && att.signatureData) {
        signThumb = `<img src="${att.signatureData}" class="h-8 max-w-[80px] object-contain mx-auto bg-gray-50 border rounded p-0.5" />`;
      }

      // 상태 선택 드롭다운 (관리자가 출석, 출장, 연가 등 즉시 변경 가능)
      const currentStatus = att.status || (att.isSigned ? '출석' : '미서명');
      const statusSelectHtml = `
        <select onchange="App.changeAttendeeStatus('${att.id}', this.value)" class="text-xs py-1 px-2 rounded-lg border border-gray-300 bg-white font-medium focus:ring-1 focus:ring-blue-500 outline-none">
          <option value="미서명" ${currentStatus === '미서명' ? 'selected' : ''}>미서명</option>
          <option value="출석" ${currentStatus === '출석' ? 'selected' : ''}>출석(서명)</option>
          <option value="출장" ${currentStatus === '출장' ? 'selected' : ''}>출장</option>
          <option value="연가" ${currentStatus === '연가' ? 'selected' : ''}>연가</option>
          <option value="공가" ${currentStatus === '공가' ? 'selected' : ''}>공가</option>
          <option value="병가" ${currentStatus === '병가' ? 'selected' : ''}>병가</option>
          <option value="조퇴" ${currentStatus === '조퇴' ? 'selected' : ''}>조퇴</option>
        </select>
      `;

      return `
        <tr class="hover:bg-gray-50 border-b border-gray-100 text-sm">
          <td class="py-3 px-3 text-center text-gray-500 font-mono">${idx + 1}</td>
          <td class="py-3 px-3 text-center font-medium text-gray-800">${att.department}</td>
          <td class="py-3 px-3 text-center text-gray-600">${att.position || '-'}</td>
          <td class="py-3 px-3 text-center font-bold text-gray-900">${att.name}</td>
          <td class="py-3 px-3 text-center">${statusSelectHtml}</td>
          <td class="py-3 px-3 text-center">${signThumb}</td>
          <td class="py-3 px-3 text-center text-xs text-gray-500">${att.note || (att.isDirectAdded ? '현장추가' : '-')}</td>
          <td class="py-3 px-3 text-center">
            <button onclick="App.deleteAttendee('${att.id}')" class="text-red-500 hover:text-red-700 text-xs p-1" title="삭제">
              <i class="fas fa-trash-alt"></i>
            </button>
          </td>
        </tr>
      `;
    }).join('');
  },

  changeAttendeeStatus(id, newStatus) {
    const att = AppState.attendees.find(a => a.id === id);
    if (!att) return;

    att.status = newStatus;
    if (newStatus === '출석') {
      // 서명 상태 유지
    } else if (newStatus === '미서명') {
      att.isSigned = false;
      att.signatureData = null;
    } else {
      // 출장, 연가, 공가, 병가 등
      att.isSigned = false;
      att.signatureData = null;
    }

    this.saveToStorage();
    this.render();
    this.renderPdfPreview();
  },

  deleteAttendee(id) {
    if (!confirm('이 참석자를 명단에서 삭제하시겠습니까?')) return;
    AppState.attendees = AppState.attendees.filter(a => a.id !== id);
    this.saveToStorage();
    this.render();
    this.renderPdfPreview();
  },

  renderPdfPreview() {
    PdfGenerator.renderPreviewDocument(AppState.session, AppState.attendees);
  },

  renderAdminQrCode() {
    const qrContainer = document.getElementById('admin-qr-code-container');
    const qrUrlText = document.getElementById('admin-qr-url-text');
    if (!qrContainer) return;

    const currentUrl = window.location.href.split('?')[0];
    const signUrl = `${currentUrl}?view=participant`;

    if (qrUrlText) qrUrlText.textContent = signUrl;

    qrContainer.innerHTML = '';
    if (window.QRCode) {
      new QRCode(qrContainer, {
        text: signUrl,
        width: 180,
        height: 180,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    }
  },

  renderLargeQrCode() {
    const qrContainer = document.getElementById('large-qr-code-container');
    if (!qrContainer) return;

    const currentUrl = window.location.href.split('?')[0];
    const signUrl = `${currentUrl}?view=participant`;

    qrContainer.innerHTML = '';
    if (window.QRCode) {
      new QRCode(qrContainer, {
        text: signUrl,
        width: 320,
        height: 320,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    }
  }
};

window.App = App;
