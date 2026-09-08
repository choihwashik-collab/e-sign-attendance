/** E-Sign v8 controller. Remote data stays in memory; local mode is explicitly single-device. */
function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
const AppState = {
  bundles:[],currentBundle:null,selectedDepartment:'ALL',searchQuery:'',
  selectedAttendeeForSign:null,selectedAttendeeForAbsent:null,signaturePad:null,
  currentView:'home',isAdminAuthenticated:false,isSyncing:false,tempBundleSessions:[]
};
const App = {
  localMode:false,busy:false,settingsDirty:false,syncInterval:null,share:null,rosterDirty:false,
  async init() {
    await GasSync.initialize();
    this.setupEventListeners();
    const canvas=document.getElementById('signature-canvas');
    if(canvas && typeof SmoothSignaturePad!=='undefined')AppState.signaturePad=new SmoothSignaturePad(canvas);
    document.getElementById('input-login-url').value=GasSync.getScriptUrl();
    // Old passwords no longer grant any remote access.
    localStorage.removeItem('eSign_adminPw');localStorage.removeItem('eSign_masterPw');
    this.switchView('home');
    const params=new URLSearchParams(location.hash.slice(1));
    const id=params.get('bundle'),url=params.get('gas'),token=params.get('token');
    if(id || token || url) {
      await this.perform(async()=>{
        if(!GasSync.isValidUrl(url)||!id||!token||!/^[a-f0-9]{64}$/.test(token))throw new Error('올바르지 않은 초대 링크입니다. 진행자에게 새 QR을 요청하세요.');
        if(url!==GasSync.getScriptUrl() && !confirm('진행자가 배포한 QR인지 확인하세요. 이 링크의 Google 서버로 이름과 서명을 전송합니다. 신뢰하는 연수의 링크일 때만 계속하세요.'))return;
        GasSync.setScriptUrl(url,false);GasSync.participant={bundleId:id,token};
        const b=await GasSync.fetchBundle(id);
        this.acceptBundle(b);await this.selectBundle(id,false);this.switchView('participant');
        this.message('이름·소속·서명은 연수 출석 확인 목적으로 진행자의 Google 시트에 저장됩니다. 보관 기간은 진행자에게 확인하세요.');
      });
    } else if(new URLSearchParams(location.search).has('bundle')) {
      this.message('기존 공유 링크는 사용할 수 없습니다. 진행자에게 보안 버전의 새 QR을 요청하세요.',true);
    } else {
      await this.perform(async()=>{AppState.bundles=await GasSync.fetchPublicBundles();this.renderBundleList();this.message('참석할 연수를 선택하세요.');});
    }
  },
  message(text,error=false) {
    const el=document.getElementById('app-message');
    if(el){el.textContent=text;el.className=error?'app-message error':'app-message';el.hidden=!text;}
  },
  async perform(work) {
    if(this.busy){this.message('앞선 작업을 처리 중입니다. 잠시 기다려 주세요.');return;}
    this.busy=true;
    try {return await work();}
    catch(e){this.message(e.message || '처리하지 못했습니다.',true);return false;}
    finally {this.busy=false;}
  },
  requireAdmin() {
    if(!AppState.isAdminAuthenticated){this.showAdminPasswordModal();throw new Error('진행자 로그인이 필요합니다.');}
  },
  getGasUrl(){return this.localMode?'':GasSync.getScriptUrl();},
  showAdminPasswordModal() {
    document.getElementById('input-login-url').value=GasSync.getScriptUrl();
    document.getElementById('input-admin-pw').value='';
    document.getElementById('modal-admin-password').classList.remove('hidden');
  },
  async handleAdminPasswordSubmit() {
    const url=document.getElementById('input-login-url').value.trim();
    const key=document.getElementById('input-admin-pw').value.trim();
    GasSync.setScriptUrl(url);
    await GasSync.login(key);
    const bundles=await GasSync.fetchBundles();
    this.localMode=false;AppState.isAdminAuthenticated=true;AppState.bundles=bundles;AppState.currentBundle=null;
    document.getElementById('input-admin-pw').value='';
    document.getElementById('modal-admin-password').classList.add('hidden');
    history.replaceState(null,'',location.pathname);
    this.switchView('home');this.updateGasStatusBadge(true);
    this.message('로그인했습니다. 연수를 선택하거나 새로 만드세요.');
  },
  useLocalMode() {
    if(!confirm('단일 기기 모드는 로그인 보호·휴대폰 공유가 없고 이 브라우저에만 저장됩니다. 공용 기기에서는 사용하지 마세요. 계속할까요?'))return;
    GasSync.logout();this.localMode=true;AppState.isAdminAuthenticated=true;
    const stored=JSON.parse(localStorage.getItem('eSign_bundles') || '[]');
    if(!Array.isArray(stored))throw new Error('로컬 자료 형식이 올바르지 않습니다.');
    AppState.bundles=stored;AppState.currentBundle=null;
    document.getElementById('modal-admin-password').classList.add('hidden');
    history.replaceState(null,'',location.pathname);
    this.switchView('home');this.updateGasStatusBadge(false);
    this.message('단일 기기 모드: 서명은 이 브라우저에만 저장됩니다. 브라우저 자료 삭제 전 JSON 백업을 받으세요.');
  },
  logout() {
    GasSync.logout();clearInterval(this.syncInterval);this.share=null;this.localMode=false;this.settingsDirty=false;
    AppState.isAdminAuthenticated=false;AppState.bundles=[];AppState.currentBundle=null;AppState.selectedAttendeeForSign=null;
    AppState.signaturePad?.clear();
    window.RosterManager?.reset();
    for(const id of ['participant-name-list','admin-attendee-table-body','pdf-preview-area','admin-qr-code-container','large-qr-code-container'])document.getElementById(id)?.replaceChildren();
    document.getElementById('modal-fullscreen-qr').classList.add('hidden');
    this.switchView('home');history.replaceState(null,'',location.pathname);this.message('로그아웃했습니다. 로컬 모드의 기존 저장 자료는 삭제하지 않았습니다.');
  },
  acceptBundle(bundle) {
    const next=AppState.bundles.filter(b=>b.id!==bundle.id).concat(bundle);
    if(this.localMode)localStorage.setItem('eSign_bundles',JSON.stringify(next)); // Fail before showing success.
    AppState.bundles=next;
    if(AppState.currentBundle?.id===bundle.id)AppState.currentBundle=bundle;
  },
  async selectBundle(id,refresh=true) {
    if(this.settingsDirty && !confirm('저장하지 않은 설정을 버리고 이동할까요?'))return;
    let b=AppState.bundles.find(b=>b.id===id);
    if(!this.localMode && refresh)b=await GasSync.fetchBundle(id);
    if(!b)throw new Error('연수를 찾을 수 없습니다.');
    this.acceptBundle(b);AppState.currentBundle=b;AppState.selectedDepartment='ALL';AppState.searchQuery='';
    this.settingsDirty=false;this.updateHeaderInfo();this.renderParticipantView();this.renderAdminOverview();this.renderBundleSessionsInSettings();
    this.startPeriodicSync();
  },
  startPeriodicSync() {
    clearInterval(this.syncInterval);
    if(this.localMode)return;
    this.syncInterval=setInterval(()=>{
      if(!document.hidden&&!this.busy&&!this.settingsDirty&&!this.rosterDirty&&!AppState.selectedAttendeeForSign&&AppState.currentBundle)
        this.perform(()=>this.syncFromGoogleSheet(false));
    },30000);
  },
  async syncFromGoogleSheet(showToast=true) {
    if(this.localMode||!AppState.currentBundle)return;
    if(this.settingsDirty)throw new Error('입력 중인 설정을 먼저 저장해 주세요.');
    if(AppState.selectedAttendeeForSign)throw new Error('서명 입력을 완료하거나 취소해 주세요.');
    const id=AppState.currentBundle.id,b=await GasSync.fetchBundle(id);
    if(AppState.currentBundle?.id!==id)return;
    this.acceptBundle(b);this.updateHeaderInfo();this.renderParticipantView();this.renderAdminOverview();this.renderBundleSessionsInSettings();
    if(showToast)this.message('최신 명단과 서명을 불러왔습니다.');
  },
  async editBundle(change, savingSettings=false) {
    this.requireAdmin();
    if(this.settingsDirty&&!savingSettings)throw new Error('입력 중인 설정을 먼저 [설정 저장]으로 저장해 주세요.');
    if(!AppState.currentBundle || AppState.currentBundle.summary)throw new Error('연수를 먼저 열어 주세요.');
    const draft=JSON.parse(JSON.stringify(AppState.currentBundle));
    change(draft);
    if(!draft.sessions.length)throw new Error('최소 1개의 연수가 필요합니다.');
    if(draft.attendees.length>200)throw new Error('묶음당 최대 200명입니다.');
    const saved=this.localMode?draft:(await GasSync.syncBundle(draft)).bundle;
    this.acceptBundle(saved);this.settingsDirty=false;
    this.renderParticipantView();this.renderAdminOverview();this.renderBundleSessionsInSettings();
    this.message(this.localMode?'이 브라우저에 저장했습니다.':'서버 저장을 확인했습니다.');
  },
  async createBundle(name,sessions) {
    this.requireAdmin();
    const b={id:'bundle_'+GasSync.randomHex(16),name,createdAt:new Date().toISOString(),sessions,attendees:[],
      location:'',organizer:'',verifierDept:'',verifierName:'',showApprovalBox:false,approvalStages:['담당','확인','부서장']};
    this.acceptBundle(this.localMode?b:(await GasSync.syncBundle(b)).bundle);this.renderBundleList();
    this.message('연수 묶음을 생성했습니다.');
  },
  async deleteBundle(id) {
    this.requireAdmin();
    if(!confirm('이 묶음과 모든 서명을 삭제할까요? 먼저 JSON/PDF 백업을 받으세요.'))return;
    const b=AppState.bundles.find(b=>b.id===id);
    if(!this.localMode)await GasSync.deleteBundle(b);
    const next=AppState.bundles.filter(b=>b.id!==id);
    if(this.localMode)localStorage.setItem('eSign_bundles',JSON.stringify(next));
    AppState.bundles=next;
    if(AppState.currentBundle?.id===id)AppState.currentBundle=null;
    if(this.share?.bundleId===id)this.share=null;
    this.switchView('home');this.message('묶음을 삭제했습니다. 앱 내 복구 기능은 없으며 백업이 필요합니다.');
  },
  async addSessionToBundle(id,title,date) {await this.editBundle(b=>b.sessions.push({id:'sess_'+GasSync.randomHex(16),title,date}));},
  async removeSessionFromBundle(id,sid) {await this.editBundle(b=>{b.sessions=b.sessions.filter(s=>s.id!==sid);});},
  switchView(view) {
    if(view==='admin'&&!AppState.isAdminAuthenticated){this.showAdminPasswordModal();return;}
    AppState.currentView=view;
    for(const v of ['home','participant','admin']) {
      document.getElementById('view-'+(v==='home'?'bundle-list':v))?.classList.toggle('hidden',v!==view);
      document.getElementById('nav-btn-'+v)?.classList.toggle('active',v===view);
    }
    document.getElementById('btn-open-add-attendee').classList.toggle('hidden',!AppState.isAdminAuthenticated);
    document.getElementById('btn-create-bundle').classList.toggle('hidden',!AppState.isAdminAuthenticated);
    document.getElementById('btn-basic-rosters-home').classList.toggle('hidden',!AppState.isAdminAuthenticated);
    if(view==='home')this.renderBundleList();
    if(view==='participant')this.renderParticipantView();
    if(view==='admin'&&AppState.currentBundle){this.renderAdminOverview();this.renderPdfPreview();this.renderAdminQrCode();}
  },
  switchAdminTab(name) {
    document.querySelectorAll('.admin-tab-btn').forEach(el=>el.classList.toggle('active',el.dataset.adminTab===name));
    document.querySelectorAll('.tab-pane').forEach(el=>el.classList.add('hidden'));
    document.getElementById('tab-pane-'+name)?.classList.remove('hidden');
    if(name==='document')this.renderPdfPreview();
    if(name==='qr')this.renderAdminQrCode();
  },
  // Rendering
  renderBundleList: function() {
    const container = document.getElementById('bundle-cards-container');
    if (!container) return;

    container.innerHTML = '';
    
    if (AppState.bundles.length === 0) {
      container.innerHTML = '<div class="p-8 text-center text-gray-500">생성된 연수 묶음이 없습니다.</div>';
      return;
    }

    const now = new Date().getTime();
    const twentyFiveDaysMs = 25 * 24 * 60 * 60 * 1000;

    AppState.bundles.sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt)).forEach(bundle => {
      const attendees = bundle.attendees || [];
      const signedCount = attendees.filter(a => a.isSigned).length;
      
      const createdAtMs = new Date(bundle.createdAt).getTime();
      const isExpiringSoon = (now - createdAtMs) > twentyFiveDaysMs;
      const warningBadge = isExpiringSoon && !this.localMode ? '<span class="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">30일 경과 예정</span>' : '';

      const sessionTitles = bundle.sessions.map(s => s.title).join(', ');
      
      const card = document.createElement('div');
      card.className = 'bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col';
      card.innerHTML = `
        <div class="p-5 flex-grow">
          <div class="flex justify-between items-start mb-2">
            <h3 class="text-lg font-semibold text-gray-900">${escapeHtml(bundle.name)} ${warningBadge}</h3>
          </div>
          <p class="text-sm text-gray-500 mb-4 h-10 overflow-hidden text-ellipsis">${escapeHtml(sessionTitles)}</p>
          <div class="text-sm text-gray-600 mb-2">
            <span class="font-medium text-gray-900">연수 개수:</span> ${bundle.sessions.length}개
          </div>
          <div class="flex justify-between text-sm text-gray-600">
            <span>서명/총원:</span>
            <span class="font-medium">${bundle.summary ? '열어서 확인' : signedCount + ' / ' + attendees.length + '명'}</span>
          </div>
        </div>
        <div class="bg-gray-50 p-4 border-t border-gray-200 flex justify-end gap-2">
          <button class="btn-open-bundle px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm" data-id="${escapeHtml(bundle.id)}">열기</button>
          ${AppState.isAdminAuthenticated?`<button class="btn-manage-bundle px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm" data-id="${escapeHtml(bundle.id)}">관리</button>
          <button class="btn-delete-bundle px-4 py-2 bg-red-100 text-red-600 rounded hover:bg-red-200 text-sm" data-id="${escapeHtml(bundle.id)}">삭제</button>`:''}
        </div>
      `;
      container.appendChild(card);
    });

    container.querySelectorAll('.btn-open-bundle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.perform(async () => { await this.selectBundle(e.target.dataset.id); this.switchView('participant'); });
      });
    });

    container.querySelectorAll('.btn-manage-bundle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.perform(async () => { await this.selectBundle(e.target.dataset.id); this.switchView('admin'); });
      });
    });

    container.querySelectorAll('.btn-delete-bundle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.perform(() => this.deleteBundle(e.target.dataset.id));
      });
    });
  },

  renderParticipantView: function() {
    if (!AppState.currentBundle) return;
    
    const infoEl = document.getElementById('participant-bundle-info');
    if (infoEl) {
      infoEl.textContent = AppState.currentBundle.name;
    }

    const sessionListEl = document.getElementById('participant-session-list');
    if (sessionListEl) {
      sessionListEl.innerHTML = '';
      AppState.currentBundle.sessions.forEach(sess => {
        const li = document.createElement('li');
        li.className = 'text-sm text-gray-600';
        li.textContent = `• ${sess.title} (${sess.date})`;
        sessionListEl.appendChild(li);
      });
    }

    this.renderDepartmentFilter();
    this.renderParticipantNameList();
  },

  renderDepartmentFilter: function() {
    if (!AppState.currentBundle) return;
    const depts = new Set(AppState.currentBundle.attendees.map(a => a.department));
    
    // For participant view
    const pSelect = document.getElementById('participant-dept-select');
    if (pSelect) {
      pSelect.innerHTML = '<option value="ALL">전체 부서</option>';
      Array.from(depts).sort().forEach(dept => {
        if (dept) {
          const option = document.createElement('option');
          option.value = dept;
          option.textContent = dept;
          pSelect.appendChild(option);
        }
      });
      pSelect.value = AppState.selectedDepartment;
    }

    // For admin view
    const aSelect = document.getElementById('admin-dept-filter');
    if (aSelect) {
      aSelect.innerHTML = '<option value="ALL">전체 부서</option>';
      Array.from(depts).sort().forEach(dept => {
        if (dept) {
          const option = document.createElement('option');
          option.value = dept;
          option.textContent = dept;
          aSelect.appendChild(option);
        }
      });
      aSelect.value = AppState.selectedDepartment;
    }
  },

  renderParticipantNameList: function() {
    const listEl = document.getElementById('participant-name-list');
    if (!listEl || !AppState.currentBundle) return;

    listEl.innerHTML = '';
    
    let filtered = AppState.currentBundle.attendees;
    if (AppState.selectedDepartment !== 'ALL') {
      filtered = filtered.filter(a => a.department === AppState.selectedDepartment);
    }
    if (AppState.searchQuery) {
      const q = AppState.searchQuery.toLowerCase();
      filtered = filtered.filter(a => a.name.toLowerCase().includes(q) || a.department.toLowerCase().includes(q));
    }

    if (filtered.length === 0) {
      listEl.innerHTML = '<div class="col-span-full text-center text-gray-500 py-4">해당하는 참석자가 없습니다.</div>';
      return;
    }

    filtered.forEach(attendee => {
      const btn = document.createElement('button');
      btn.className = `p-4 rounded-lg border text-left flex flex-col justify-between transition-colors ${
        attendee.isSigned ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 hover:border-blue-500 hover:shadow-md'
      }`;
      
      let statusHtml = '';
      if (attendee.isSigned) {
        statusHtml = `<span class="text-xs font-semibold text-green-600 bg-green-100 px-2 py-1 rounded-full">서명완료</span>`;
      } else if (attendee.status && attendee.status !== '미서명') {
        statusHtml = `<span class="text-xs font-semibold text-gray-600 bg-gray-200 px-2 py-1 rounded-full">${escapeHtml(attendee.status)}</span>`;
      }

      btn.innerHTML = `
        <div class="flex justify-between items-start mb-2">
          <span class="text-sm text-gray-500 font-medium">${escapeHtml(attendee.department)}</span>
          ${statusHtml}
        </div>
        <div class="text-lg font-bold text-gray-900">${escapeHtml(attendee.name)}</div>
      `;

      btn.addEventListener('click', () => this.startSigning(attendee.id));
      
      listEl.appendChild(btn);
    });
  },

  renderAdminOverview: function(deptFilter = 'ALL') {
    if (!AppState.currentBundle) return;
    
    const attendees = AppState.currentBundle.attendees;
    let filtered = attendees;
    if (deptFilter !== 'ALL') {
      filtered = attendees.filter(a => a.department === deptFilter);
    }

    const total = filtered.length;
    const signed = filtered.filter(a => a.isSigned).length;
    const unsigned = total - signed;
    const rate = total > 0 ? Math.round((signed / total) * 100) : 0;

    const totalEl = document.getElementById('stat-total-count');
    const signedEl = document.getElementById('stat-signed-count');
    const unsignedEl = document.getElementById('stat-unsigned-count');
    const rateEl = document.getElementById('stat-sign-rate');
    const barEl = document.getElementById('stat-progress-bar');

    if (totalEl) totalEl.textContent = `${total}명`;
    if (signedEl) signedEl.textContent = `${signed}명`;
    if (unsignedEl) unsignedEl.textContent = `${unsigned}명`;
    if (rateEl) rateEl.textContent = `${rate}%`;
    if (barEl) barEl.style.width = `${rate}%`;

    const tbody = document.getElementById('admin-attendee-table-body');
    if (tbody) {
      tbody.innerHTML = '';
      filtered.forEach((attendee, index) => {
        const tr = document.createElement('tr');
        tr.className = attendee.isSigned ? 'bg-green-50' : 'hover:bg-gray-50';
        
        let statusBadge = '<span class="px-2 py-1 text-xs font-medium bg-red-100 text-red-800 rounded-full">미서명</span>';
        if (attendee.isSigned) {
          statusBadge = '<span class="px-2 py-1 text-xs font-medium bg-green-100 text-green-800 rounded-full">서명완료</span>';
        } else if (attendee.status && attendee.status !== '미서명') {
          statusBadge = `<span class="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded-full">${escapeHtml(attendee.status)}</span>`;
        }

        const signedAtStr = attendee.signedAt ? new Date(attendee.signedAt).toLocaleTimeString() : '-';

        const statusSelect = `
          <select class="admin-status-select text-sm border-gray-300 rounded-md" data-id="${escapeHtml(attendee.id)}">
            <option value="미서명" ${attendee.status === '미서명' && !attendee.isSigned ? 'selected' : ''}>미서명</option>
            <option value="출석" ${attendee.isSigned ? 'selected' : ''} ${attendee.isSigned ? 'disabled' : ''}>출석</option>
            <option value="출장" ${attendee.status === '출장' ? 'selected' : ''}>출장</option>
            <option value="연가" ${attendee.status === '연가' ? 'selected' : ''}>연가</option>
            <option value="공가" ${attendee.status === '공가' ? 'selected' : ''}>공가</option>
            <option value="병가" ${attendee.status === '병가' ? 'selected' : ''}>병가</option>
            <option value="조퇴" ${attendee.status === '조퇴' ? 'selected' : ''}>조퇴</option>
          </select>
        `;

        tr.innerHTML = `
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${index + 1}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${escapeHtml(attendee.department)}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${escapeHtml(attendee.name)}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${statusBadge}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${signedAtStr}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${statusSelect}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
            <button class="btn-del-attendee text-red-600 hover:text-red-900" data-id="${escapeHtml(attendee.id)}">삭제</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll('.admin-status-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
          this.perform(() => this.changeAttendeeStatus(e.target.dataset.id, e.target.value));
        });
      });

      tbody.querySelectorAll('.btn-del-attendee').forEach(btn => {
        btn.addEventListener('click', (e) => {
          this.perform(() => this.deleteAttendee(e.target.dataset.id));
        });
      });
    }
  },

  renderPdfPreview: function() {
    if (!AppState.currentBundle || typeof PdfGenerator === 'undefined') return;
    const previewArea = document.getElementById('pdf-preview-area');
    if (previewArea) {
      if (AppState.currentBundle.sessions.length > 0) {
        PdfGenerator.renderPreviewDocument(
          AppState.currentBundle,
          AppState.currentBundle.attendees,
          AppState.currentBundle.sessions[0]
        );
      } else {
        previewArea.innerHTML = '<div class="text-center p-8 text-gray-500">연수가 없습니다. 설정에서 연수를 추가하세요.</div>';
      }
    }
  },

  renderAdminQrCode: function() {
    const container=document.getElementById('admin-qr-code-container');
    const label=document.getElementById('admin-qr-url-text');
    if (!container) return;
    container.replaceChildren();
    const share=this.share;
    if (!share || share.bundleId!==AppState.currentBundle?.id || share.expiresAt<=Date.now()) {
      if(label) label.textContent='[24시간 QR 발급]을 눌러 주세요. 발급은 기존 명단을 덮어쓰지 않습니다.';
      return;
    }
    if(label)label.textContent='유효기간: '+new Date(share.expiresAt).toLocaleString();
    if(typeof QRCode!=='undefined')new QRCode(container,{text:share.url,width:240,height:240,correctLevel:QRCode.CorrectLevel.M});
  },

  renderLargeQrCode: function() {
    if(!this.share || this.share.bundleId!==AppState.currentBundle?.id || this.share.expiresAt<=Date.now())throw new Error('먼저 QR을 발급해 주세요.');
    const container=document.getElementById('large-qr-code-container');
    container.replaceChildren();
    if(typeof QRCode!=='undefined')new QRCode(container,{text:this.share.url,width:400,height:400,correctLevel:QRCode.CorrectLevel.M});
  },

  updateHeaderInfo: function() {
    if (!AppState.currentBundle) return;
    const bundle = AppState.currentBundle;
    document.getElementById('input-gas-url').value = this.getGasUrl();
    
    const loc = document.getElementById('input-session-location');
    const org = document.getElementById('input-session-organizer');
    const vDept = document.getElementById('input-verifier-dept');
    const vName = document.getElementById('input-verifier-name');
    const showApp = document.getElementById('check-show-approval');
    const appStages = document.getElementById('input-approval-stages');

    if(loc) loc.value = bundle.location || '';
    if(org) org.value = bundle.organizer || '';
    if(vDept) vDept.value = bundle.verifierDept || '';
    if(vName) vName.value = bundle.verifierName || '';
    if(showApp) showApp.checked = bundle.showApprovalBox || false;
    if(appStages) appStages.value = bundle.approvalStages ? bundle.approvalStages.join(',') : '담당,확인,부서장';

    const stageContainer = document.getElementById('approval-stages-container');
    if(stageContainer) {
      if (bundle.showApprovalBox) {
        stageContainer.classList.remove('hidden');
      } else {
        stageContainer.classList.add('hidden');
      }
    }
  },

  updateGasStatusBadge: function(isConnected) {
    const badge = document.getElementById('gas-sync-badge');
    if (!badge) return;
    if (isConnected === null) {
      badge.textContent = 'GAS 확인 중';
      badge.className = 'px-2 py-1 text-xs rounded-full bg-yellow-100 text-yellow-800';
      return;
    }
    if (isConnected) {
      badge.textContent = 'GAS 연결됨';
      badge.className = 'px-2 py-1 text-xs rounded-full bg-green-100 text-green-800';
    } else {
      badge.textContent = 'GAS 미연결';
      badge.className = 'px-2 py-1 text-xs rounded-full bg-gray-100 text-gray-800';
    }
  },

  renderBundleSessionsInSettings: function() {
    const container = document.getElementById('settings-session-list');
    if (!container || !AppState.currentBundle) return;
    container.innerHTML = '';
    
    AppState.currentBundle.sessions.forEach(sess => {
      const li = document.createElement('li');
      li.className = 'flex justify-between items-center py-2 border-b';
      li.innerHTML = `
        <div>
          <span class="font-medium">${escapeHtml(sess.title)}</span> <span class="text-sm text-gray-500">(${escapeHtml(sess.date)})</span>
        </div>
        <button type="button" class="btn-del-session text-red-500 hover:text-red-700 text-sm" data-id="${escapeHtml(sess.id)}">삭제</button>
      `;
      container.appendChild(li);
    });

    container.querySelectorAll('.btn-del-session').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.perform(() => this.removeSessionFromBundle(AppState.currentBundle.id, e.target.dataset.id));
      });
    });
  },

  // Signing is the only participant mutation; attendance identities come from the server roster.
  startSigning(id) {
    if(this.busy)return;
    const attendee=AppState.currentBundle?.attendees.find(a=>a.id===id);
    if(!attendee)return;
    AppState.selectedAttendeeForSign=attendee;
    document.getElementById('step-select-person').classList.add('hidden');
    document.getElementById('step-sign-complete').classList.add('hidden');
    document.getElementById('step-sign-canvas').classList.remove('hidden');
    document.getElementById('signing-person-name').textContent=attendee.name;
    document.getElementById('signing-person-dept').textContent=attendee.department;
    document.getElementById('participant-attendance-type').value='출석';
    document.getElementById('participant-attendance-note').value='';
    this.updateSigningMode();
    AppState.signaturePad?.resizeCanvas();AppState.signaturePad?.clear();
    this.message(attendee.signedAt?'다시 저장하면 이 사람의 이전 서명 또는 사유가 교체됩니다.':'이름을 확인하고 서명하거나 조퇴·출장 등의 사유를 선택하세요.');
  },
  cancelSigning() {
    if(this.busy)return;
    AppState.selectedAttendeeForSign=null;AppState.signaturePad?.clear();
    document.getElementById('step-sign-canvas').classList.add('hidden');
    document.getElementById('step-select-person').classList.remove('hidden');
  },
  async handleSignatureSubmit() {
    if(!AppState.selectedAttendeeForSign||!AppState.currentBundle)return;
    const status=document.getElementById('participant-attendance-type').value || '출석';
    const signing=status==='출석',detail=document.getElementById('participant-attendance-note').value.trim();
    if(signing&&(!AppState.signaturePad||AppState.signaturePad.isEmpty()))throw new Error('서명을 입력해 주세요.');
    if(status==='기타 불참'&&!detail)throw new Error('기타 불참 사유를 입력하세요.');
    const attendee={...AppState.selectedAttendeeForSign,signatureData:signing?AppState.signaturePad.toCompactDataURL():null,status,isSigned:signing,note:signing?'':(detail?status+': '+detail:status)};
    this.message(this.localMode?'브라우저에 저장 중…':'서버에 저장하고 결과를 확인 중입니다. 완료될 때까지 창을 닫지 마세요.');
    const result=this.localMode?{signedAt:new Date(Math.max(Date.now(),(Date.parse(attendee.signedAt)||0)+1)).toISOString()}:
      signing?await GasSync.submitSignature(AppState.currentBundle,attendee):await GasSync.submitReason(AppState.currentBundle,attendee,status,detail);
    attendee.signedAt=result.signedAt;
    const draft={...AppState.currentBundle,revision:result.revision ?? AppState.currentBundle.revision,attendees:AppState.currentBundle.attendees.map(a=>a.id===attendee.id?attendee:a)};
    this.acceptBundle(draft);
    document.getElementById('step-sign-canvas').classList.add('hidden');
    document.getElementById('step-sign-complete').classList.remove('hidden');
    document.getElementById('complete-user-name').textContent=attendee.name;
    document.getElementById('complete-heading').textContent=signing?'서명 완료':'사유 등록 완료';
    document.getElementById('complete-description').textContent=signing?'님의 서명이 저장되었습니다.':'님의 사유가 비고란에 저장되었습니다.';
    document.getElementById('complete-user-time').textContent=new Date(attendee.signedAt).toLocaleString();
    AppState.selectedAttendeeForSign=null;AppState.signaturePad?.clear();
    this.message(signing?'서명을 저장했습니다.':'사유를 저장했습니다. 서명란은 공란으로 출력됩니다.');
    setTimeout(()=>{
      document.getElementById('step-sign-complete').classList.add('hidden');
      document.getElementById('step-select-person').classList.remove('hidden');
      this.renderParticipantNameList();this.renderAdminOverview();
    },2500);
  },
  updateSigningMode() {
    const signing=document.getElementById('participant-attendance-type').value==='출석';
    document.getElementById('signature-input-area').classList.toggle('hidden',!signing);
    document.getElementById('signature-tools').classList.toggle('hidden',!signing);
    document.getElementById('participant-note-area').classList.toggle('hidden',signing);
    document.getElementById('btn-submit-signature').textContent=signing?'서명 완료':'사유 저장';
    if(signing)AppState.signaturePad?.resizeCanvas();
  },
  async handleDirectAddAttendee() {
    this.requireAdmin();
    const name=document.getElementById('direct-name').value.trim();
    if(!name)throw new Error('이름을 입력하세요.');
    const attendee={id:'att_'+GasSync.randomHex(16),name,department:document.getElementById('direct-dept').value.trim()||'미지정',
      position:document.getElementById('direct-position').value.trim(),status:'미서명',isSigned:false,signatureData:null,signedAt:null,note:'현장추가'};
    await this.editBundle(b=>b.attendees.push(attendee));
    document.getElementById('form-add-attendee').reset();
    document.getElementById('modal-add-attendee').classList.add('hidden');
  },
  async changeAttendeeStatus(id,status) {
    this.requireAdmin();
    const old=AppState.currentBundle.attendees.find(a=>a.id===id);
    if(!old)return;
    if(old.signatureData&&status!=='출석'&&!confirm('출결을 변경하면 기존 서명을 지웁니다. 계속할까요?')){this.renderAdminOverview();return;}
    const attendee={...old,status};
    if(status!=='출석'){attendee.isSigned=false;attendee.signatureData=null;attendee.signedAt=new Date().toISOString();attendee.note=status==='미서명'?'':status;}
    if(this.localMode) {
      const b={...AppState.currentBundle,attendees:AppState.currentBundle.attendees.map(a=>a.id===id?attendee:a)};
      this.acceptBundle(b);
    } else this.acceptBundle((await GasSync.submitAttendee(AppState.currentBundle,attendee)).bundle);
    this.renderParticipantView();this.renderAdminOverview();
    this.message('출결 상태를 저장했습니다. 서명 없이 지정한 출석은 서명 완료로 집계하지 않습니다.');
  },
  async deleteAttendee(id) {
    if(!confirm('참석자와 서명을 삭제할까요?'))return;
    await this.editBundle(b=>{b.attendees=b.attendees.filter(a=>a.id!==id);});
  },
  async handleRosterFile(file) {
    this.requireAdmin();
    if(!file)return;
    if(file.size>5*1024*1024)throw new Error('명단 파일은 5MB 이하로 나눠 주세요.');
    this.message('명단 파일을 분석 중입니다.');
    const ext=file.name.split('.').pop().toLowerCase();
    let result;
    if(ext==='pdf')result=await ListParser.parsePdf(file);
    else if(['xlsx','xls','csv'].includes(ext))result=await ListParser.parseExcel(file);
    else if(ext==='txt')result=ListParser.parseTextLines(await file.text());
    else throw new Error('PDF, Excel, CSV, TXT 파일만 지원합니다.');
    await this.appendOrReplaceAttendees(result);
  },
  async appendOrReplaceAttendees(parsed) {
    this.requireAdmin();
    if(!Array.isArray(parsed)||!parsed.length)throw new Error('명단을 추출하지 못했습니다. 텍스트 형식을 확인하세요.');
    const mapped=parsed.map(p=>({id:'att_'+GasSync.randomHex(16),department:p.department||'미지정',name:p.name,position:p.position||'',
      status:'미서명',isSigned:false,signatureData:null,signedAt:null,note:''}));
    const replace=document.querySelector('input[name="roster-mode"]:checked')?.value==='replace';
    if(replace&&!confirm('명단 교체는 기존 참석자와 서명을 삭제합니다. 백업 후 진행할까요?'))return;
    await this.editBundle(b=>{b.attendees=replace?mapped:b.attendees.concat(mapped);});
    document.getElementById('file-upload-status').textContent=mapped.length+'명을 저장했습니다. 이름·부서가 정확한지 검토하세요.';
  },
  async issueQr() {
    this.requireAdmin();
    if(this.localMode)throw new Error('단일 기기 모드는 휴대폰 공유를 지원하지 않습니다. 서버에 로그인하세요.');
    if(!AppState.currentBundle)throw new Error('연수를 먼저 열어 주세요.');
    if(!/^https?:$/.test(location.protocol))throw new Error('휴대폰 공유는 HTTPS로 배포된 앱에서 이용하세요.');
    if(!confirm('24시간 QR을 발급할까요? 이 연수의 기존 QR은 즉시 무효화됩니다.'))return;
    const id=AppState.currentBundle.id,result=await GasSync.shareBundle(id);
    const url=new URL(location.href);url.search='';url.hash=new URLSearchParams({gas:GasSync.getScriptUrl(),bundle:id,token:result.token}).toString();
    this.share={bundleId:id,url:url.href,expiresAt:result.expiresAt};this.renderAdminQrCode();
    this.message('24시간 QR을 발급했습니다. 전달받은 사람은 명단을 보고 서명할 수 있으므로 외부 공개를 피하세요.');
  },
  async closeSharing() {
    this.requireAdmin();
    if(!AppState.currentBundle||this.localMode)return;
    await GasSync.closeSharing(AppState.currentBundle.id);this.share=null;this.renderAdminQrCode();
    document.getElementById('large-qr-code-container').replaceChildren();
    document.getElementById('modal-fullscreen-qr').classList.add('hidden');
    this.message('참석자 접속과 새 서명 접수를 종료했습니다. 기존 서명은 유지됩니다.');
  },
  async saveSettings() {
    await this.editBundle(b=>{
      b.location=document.getElementById('input-session-location').value.trim();
      b.organizer=document.getElementById('input-session-organizer').value.trim();
      b.verifierDept=document.getElementById('input-verifier-dept').value.trim();
      b.verifierName=document.getElementById('input-verifier-name').value.trim();
      b.showApprovalBox=document.getElementById('check-show-approval').checked;
      b.approvalStages=document.getElementById('input-approval-stages').value.split(',').map(s=>s.trim()).filter(Boolean);
    }, true);
    this.updateHeaderInfo();
  },
  async downloadBackup() {
    this.requireAdmin();
    let bundles;
    if(this.localMode)bundles=AppState.bundles;
    else {
      if(!AppState.currentBundle)throw new Error('백업할 연수를 먼저 열어 주세요.');
      bundles=[await GasSync.fetchBundle(AppState.currentBundle.id)];
    }
    const link=document.createElement('a'),url=URL.createObjectURL(new Blob([JSON.stringify({version:8,exportedAt:new Date().toISOString(),bundles},null,2)],{type:'application/json'}));
    link.href=url;link.download='출석_서명_백업_'+new Date().toISOString().slice(0,10)+'.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),10000);
    this.message('백업 파일에 이름과 서명 원본이 포함됩니다. 안전한 장소에 보관하고 보관 기간이 끝나면 삭제하세요.');
  },
  async migrateLocal() {
    this.requireAdmin();
    if(this.localMode)throw new Error('서버 로그인 후 로컬 자료를 가져오세요.');
    const locals=JSON.parse(localStorage.getItem('eSign_bundles')||'[]');
    if(!Array.isArray(locals)||!locals.length)throw new Error('이 브라우저에 기존 로컬 자료가 없습니다.');
    const choice=prompt('서버에 새 묶음으로 복사할 로컬 자료 번호를 입력하세요. 반복하면 중복 생성됩니다.\n'+locals.map((b,i)=>(i+1)+'. '+b.name).join('\n'));
    if(choice===null)return;
    const index=Number(choice)-1;
    if(!Number.isInteger(index)||!locals[index])throw new Error('목록의 번호를 입력하세요.');
    if(!confirm('선택한 명단과 서명을 현재 Google 서버에 업로드할까요? 원본 로컬 자료는 유지됩니다.'))return;
    const draft=JSON.parse(JSON.stringify(locals[index]));draft.id='bundle_'+GasSync.randomHex(16);delete draft.revision;
    for(const a of draft.attendees)if(a.signatureData)a.signatureData=await this.compactImportedSignature(a.signatureData);
    const saved=(await GasSync.syncBundle(draft)).bundle;
    this.acceptBundle(saved);this.renderBundleList();this.message('새 서버 묶음으로 복사했습니다. 기존 로컬 자료는 그대로 있습니다.');
  },
  async compactImportedSignature(src) {
    if(!/^data:image\/png;base64,[A-Za-z0-9+/]+=*$/.test(src)||src.length>2000000)throw new Error('기존 서명 이미지 형식 또는 크기를 확인하세요.');
    const image=new Image();
    await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('기존 서명 이미지를 읽지 못했습니다.'));image.src=src;});
    const canvas=document.createElement('canvas');canvas.width=Math.min(image.width,512);canvas.height=Math.max(1,Math.round(image.height*canvas.width/image.width));
    if(canvas.height>1024)throw new Error('기존 서명 이미지 비율이 올바르지 않습니다.');
    canvas.getContext('2d').drawImage(image,0,0,canvas.width,canvas.height);
    return SmoothSignaturePad.compactCanvas(canvas);
  },
  renderTempSessions() {
    const list=document.getElementById('bundle-session-list-preview');list.replaceChildren();
    AppState.tempBundleSessions.forEach((s,i)=>{
      const row=document.createElement('div'),button=document.createElement('button');
      row.textContent=s.title+' ('+s.date+') ';button.textContent='삭제';button.type='button';
      button.addEventListener('click',()=>{AppState.tempBundleSessions.splice(i,1);this.renderTempSessions();});row.appendChild(button);list.appendChild(row);
    });
  },
  setupEventListeners() {
    document.querySelectorAll('[data-close-modal]').forEach(button=>button.addEventListener('click',()=>{
      if(!this.busy)document.getElementById(button.dataset.closeModal)?.classList.add('hidden');
    }));
    const on=(id,event,fn,async=true)=>document.getElementById(id)?.addEventListener(event,e=>{
      e.preventDefault();if(async)this.perform(()=>fn(e));else fn(e);
    });
    document.querySelectorAll('[data-switch-view]').forEach(el=>el.addEventListener('click',()=>{if(!this.busy)this.switchView(el.dataset.switchView);}));
    document.querySelectorAll('.admin-tab-btn').forEach(el=>el.addEventListener('click',()=>{if(!this.busy)this.switchAdminTab(el.dataset.adminTab);}));
    on('btn-admin-pw-submit','click',()=>this.handleAdminPasswordSubmit());
    document.getElementById('input-admin-pw').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();this.perform(()=>this.handleAdminPasswordSubmit());}});
    on('btn-admin-pw-cancel','click',()=>document.getElementById('modal-admin-password').classList.add('hidden'),false);
    on('btn-local-mode','click',()=>this.useLocalMode());
    on('btn-login','click',()=>this.showAdminPasswordModal(),false);
    on('btn-logout','click',()=>this.logout());
    on('btn-backup','click',()=>this.downloadBackup());
    on('btn-import-local','click',()=>this.migrateLocal());
    on('btn-disconnect','click',()=>{this.logout();GasSync.setScriptUrl('');this.message('서버 연결을 해제했습니다. 기본 서버로 자동 연결하지 않습니다.');});
    on('btn-issue-qr','click',()=>this.issueQr());
    on('btn-close-sharing','click',()=>this.closeSharing());
    on('btn-create-bundle','click',()=>{
      this.requireAdmin();document.getElementById('input-bundle-name').value='';AppState.tempBundleSessions=[];this.renderTempSessions();
      document.getElementById('modal-create-bundle').classList.remove('hidden');
    });
    on('btn-bundle-add-session','click',()=>{
      const title=document.getElementById('input-bundle-session-title').value.trim(),date=document.getElementById('input-bundle-session-date').value;
      if(!title||!date)throw new Error('연수 제목과 날짜를 입력하세요.');
      AppState.tempBundleSessions.push({id:'sess_'+GasSync.randomHex(16),title,date});this.renderTempSessions();
      document.getElementById('input-bundle-session-title').value='';
    });
    on('btn-bundle-create-submit','click',async()=>{
      const name=document.getElementById('input-bundle-name').value.trim();
      if(!name||!AppState.tempBundleSessions.length)throw new Error('묶음 이름과 연수를 입력하세요.');
      await this.createBundle(name,[...AppState.tempBundleSessions]);document.getElementById('modal-create-bundle').classList.add('hidden');
    });
    on('btn-add-session-to-bundle','click',async()=>{
      const title=document.getElementById('input-new-session-title').value.trim(),date=document.getElementById('input-new-session-date').value;
      if(!title||!date)throw new Error('제목과 날짜를 입력하세요.');
      await this.addSessionToBundle(AppState.currentBundle?.id,title,date);document.getElementById('input-new-session-title').value='';
    });
    document.getElementById('form-session-info').addEventListener('input',()=>{
      this.settingsDirty=true;
      document.getElementById('approval-stages-container').classList.toggle('hidden',!document.getElementById('check-show-approval').checked);
    });
    on('form-session-info','submit',()=>this.saveSettings());
    on('participant-dept-select','change',e=>{AppState.selectedDepartment=e.target.value;this.renderParticipantNameList();},false);
    on('participant-name-search','input',e=>{AppState.searchQuery=e.target.value;this.renderParticipantNameList();},false);
    on('admin-dept-filter','change',e=>{this.renderAdminOverview(e.target.value);},false);
    on('btn-clear-signature','click',()=>AppState.signaturePad?.clear());
    on('btn-undo-signature','click',()=>AppState.signaturePad?.undo());
    on('btn-cancel-signature','click',()=>this.cancelSigning(),false);
    on('btn-submit-signature','click',()=>this.handleSignatureSubmit());
    on('participant-attendance-type','change',()=>this.updateSigningMode(),false);
    on('btn-open-add-attendee','click',()=>{this.requireAdmin();document.getElementById('modal-add-attendee').classList.remove('hidden');});
    on('btn-close-add-modal','click',()=>document.getElementById('modal-add-attendee').classList.add('hidden'),false);
    on('form-add-attendee','submit',()=>this.handleDirectAddAttendee());
    on('btn-open-fullscreen-qr','click',()=>{this.renderLargeQrCode();document.getElementById('modal-fullscreen-qr').classList.remove('hidden');});
    on('btn-close-qr-modal','click',()=>document.getElementById('modal-fullscreen-qr').classList.add('hidden'),false);
    on('btn-parse-text-roster','click',()=>this.appendOrReplaceAttendees(ListParser.parseTextLines(document.getElementById('textarea-roster-paste').value)));
    on('roster-file-input','change',e=>this.handleRosterFile(e.target.files[0]));
    on('roster-drop-zone','click',()=>document.getElementById('roster-file-input').click(),false);
    const drop=document.getElementById('roster-drop-zone');
    drop.addEventListener('dragover',e=>e.preventDefault());
    drop.addEventListener('drop',e=>{e.preventDefault();this.perform(()=>this.handleRosterFile(e.dataTransfer.files[0]));});
    on('btn-download-pdf','click',async()=>{this.requireAdmin();if(!AppState.currentBundle)throw new Error('연수를 선택하세요.');await PdfGenerator.downloadAllSessionPdfs(AppState.currentBundle);});
    on('btn-print-doc','click',()=>{this.requireAdmin();this.renderPdfPreview();window.print();});
    on('btn-export-excel','click',async()=>{this.requireAdmin();if(AppState.currentBundle){if(!this.localMode)await this.syncFromGoogleSheet(false);await PdfGenerator.exportToExcel(AppState.currentBundle,AppState.currentBundle.attendees);this.message('서명 그림을 포함한 Excel 파일을 저장했습니다.');}});
    on('btn-fetch-from-gas','click',()=>this.syncFromGoogleSheet());
    on('btn-force-sync-gas','click',()=>this.saveSettings());
    on('btn-save-gas-url','click',()=>this.showAdminPasswordModal(),false);
    on('btn-change-admin-pw','click',()=>this.message('관리자 키 변경: Apps Script 프로젝트 설정 → 스크립트 속성 → ADMIN_KEY를 새 난수(32자 이상)로 바꾸세요. 기존 키는 즉시 무효화됩니다.'),false);
    on('btn-change-master-pw','click',()=>this.message('마스터 비밀번호는 폐지했습니다. Google 계정 소유자가 스크립트 속성에서 관리자 키를 복구·교체합니다.'),false);
    window.RosterManager?.init();
    window.addEventListener('beforeunload',e=>{if(this.busy||this.settingsDirty||this.rosterDirty||AppState.selectedAttendeeForSign){e.preventDefault();e.returnValue='';}});
  }
};
window.App=App;
document.addEventListener('DOMContentLoaded',()=>App.init().catch(e=>App.message(e.message,true)));

