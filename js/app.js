/** js/app.js - 전자 서명 웹 애플리케이션 메인 컨트롤러 (v6: 연수 묶음 관리, 비밀번호, 자동삭제) */
const AppState = {
  bundles: [],
  currentBundle: null,
  selectedDepartment: 'ALL',
  searchQuery: '',
  selectedAttendeeForSign: null,
  selectedAttendeeForAbsent: null,
  signaturePad: null,
  currentView: 'home',
  isAdminAuthenticated: false,
  isSyncing: false,
  tempBundleSessions: []
};

const App = {
  syncInterval: null,

  init: function() {
    this.loadBundles();
    this.cleanupExpiredBundles();
    
    // Setup signature pad
    const canvas = document.getElementById('signature-canvas');
    if (canvas && typeof SmoothSignaturePad !== 'undefined') {
      AppState.signaturePad = new SmoothSignaturePad(canvas, {
        minWidth: 1.5,
        maxWidth: 3.5,
        penColor: '#000000'
      });
    }

    this.setupEventListeners();

    // Parse URL params
    const urlParams = new URLSearchParams(window.location.search);
    const gasParam = urlParams.get('gas');
    const sheetParam = urlParams.get('sheet');
    const bundleParam = urlParams.get('bundle');
    const viewParam = urlParams.get('view');

    if (gasParam && typeof GasSync !== 'undefined') GasSync.setScriptUrl(gasParam);
    if (sheetParam && typeof GasSync !== 'undefined') GasSync.setSheetName(sheetParam);
    
    if (bundleParam) {
      this.selectBundle(bundleParam);
      if (viewParam) {
         this.switchView(viewParam);
      } else {
         this.switchView('participant');
      }
    } else {
      this.switchView('home');
    }

    if (this.getGasUrl() && AppState.currentBundle) {
      this.startPeriodicSync();
    }
  },

  getGasUrl: function() {
    return typeof GasSync !== 'undefined' ? GasSync.getScriptUrl() : '';
  },

  startPeriodicSync: function() {
    if (this.syncInterval) clearInterval(this.syncInterval);
    this.syncInterval = setInterval(() => {
      if (AppState.currentBundle && this.getGasUrl()) {
        this.syncFromGoogleSheet(false);
      }
    }, 15000);
  },

  // Storage functions
  loadBundles: function() {
    try {
      const stored = localStorage.getItem('eSign_bundles');
      if (stored) {
        AppState.bundles = JSON.parse(stored);
      } else {
        AppState.bundles = [];
      }
    } catch (e) {
      console.error('Failed to load bundles', e);
      AppState.bundles = [];
    }
  },

  saveBundles: function() {
    try {
      localStorage.setItem('eSign_bundles', JSON.stringify(AppState.bundles));
    } catch (e) {
      console.error('Failed to save bundles', e);
    }
  },

  getAdminPw: function() {
    return localStorage.getItem('eSign_adminPw') || '2026';
  },

  getMasterPw: function() {
    return localStorage.getItem('eSign_masterPw') || '9723';
  },

  setAdminPw: function(pw) {
    localStorage.setItem('eSign_adminPw', pw);
  },

  setMasterPw: function(pw) {
    localStorage.setItem('eSign_masterPw', pw);
  },

  cleanupExpiredBundles: function() {
    const now = new Date().getTime();
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;
    
    const initialCount = AppState.bundles.length;
    AppState.bundles = AppState.bundles.filter(b => {
      const createdAtMs = new Date(b.createdAt).getTime();
      return (now - createdAtMs) <= thirtyDaysMs;
    });

    const removedCount = initialCount - AppState.bundles.length;
    if (removedCount > 0) {
      console.log(`Removed ${removedCount} expired bundles.`);
      this.saveBundles();
    }
  },

  // Bundle CRUD
  createBundle: function(name, sessions) {
    const timestamp = new Date().getTime();
    const random = Math.floor(Math.random() * 10000);
    const newBundle = {
      id: 'bundle_' + timestamp + '_' + random,
      name: name,
      createdAt: new Date().toISOString(),
      sessions: sessions,
      attendees: [],
      location: '',
      organizer: '',
      verifierDept: '',
      verifierName: '',
      showApprovalBox: false,
      approvalStages: ['담당', '확인', '부서장']
    };
    
    AppState.bundles.push(newBundle);
    this.saveBundles();
    this.renderBundleList();
  },

  deleteBundle: function(bundleId) {
    if (confirm('이 묶음을 정말 삭제하시겠습니까? 관련 데이터가 모두 삭제됩니다.')) {
      AppState.bundles = AppState.bundles.filter(b => b.id !== bundleId);
      this.saveBundles();
      if (AppState.currentBundle && AppState.currentBundle.id === bundleId) {
        AppState.currentBundle = null;
        this.switchView('home');
      } else {
        this.renderBundleList();
      }
    }
  },

  selectBundle: function(bundleId) {
    const bundle = AppState.bundles.find(b => b.id === bundleId);
    if (bundle) {
      AppState.currentBundle = bundle;
      this.updateHeaderInfo();
      this.renderParticipantView();
      this.renderAdminOverview();
      this.renderBundleSessionsInSettings();
    }
  },

  addSessionToBundle: function(bundleId, title, date) {
    const bundle = AppState.bundles.find(b => b.id === bundleId);
    if (bundle) {
      const sessId = 'sess_' + new Date().getTime() + '_' + Math.floor(Math.random()*1000);
      bundle.sessions.push({ id: sessId, title: title, date: date });
      this.saveBundles();
      if (AppState.currentBundle && AppState.currentBundle.id === bundleId) {
        this.renderParticipantView();
        this.renderBundleSessionsInSettings();
      }
    }
  },

  removeSessionFromBundle: function(bundleId, sessionId) {
    const bundle = AppState.bundles.find(b => b.id === bundleId);
    if (bundle) {
      bundle.sessions = bundle.sessions.filter(s => s.id !== sessionId);
      this.saveBundles();
      if (AppState.currentBundle && AppState.currentBundle.id === bundleId) {
        this.renderParticipantView();
        this.renderBundleSessionsInSettings();
      }
    }
  },

  // View switching
  switchView: function(viewName) {
    if (viewName === 'admin' && !AppState.isAdminAuthenticated) {
      this.showAdminPasswordModal();
      return;
    }

    AppState.currentView = viewName;
    
    const views = ['home', 'participant', 'admin'];
    views.forEach(v => {
      const el = document.getElementById('view-' + (v === 'home' ? 'bundle-list' : v));
      if (el) el.classList.toggle('hidden', v !== viewName);
    });

    const navBtns = ['home', 'participant', 'admin'];
    navBtns.forEach(b => {
      const el = document.getElementById('nav-btn-' + b);
      if (el) el.classList.toggle('active', b === viewName);
    });

    if (viewName === 'home') {
      this.renderBundleList();
    } else if (viewName === 'participant') {
      if (AppState.currentBundle) {
        this.renderParticipantView();
      }
    } else if (viewName === 'admin') {
      if (AppState.currentBundle) {
        this.renderAdminOverview();
        this.renderPdfPreview();
        this.renderAdminQrCode();
      }
    }
  },

  switchAdminTab: function(tabName) {
    const tabs = document.querySelectorAll('.admin-tab-btn');
    tabs.forEach(tab => {
      tab.classList.toggle('active', tab.dataset.adminTab === tabName);
    });

    const panes = document.querySelectorAll('.tab-pane');
    panes.forEach(pane => {
      pane.classList.add('hidden');
    });

    const activePane = document.getElementById('tab-pane-' + tabName);
    if (activePane) activePane.classList.remove('hidden');

    if (tabName === 'document') {
      this.renderPdfPreview();
    } else if (tabName === 'qr') {
      this.renderAdminQrCode();
    }
  },

  // Admin password
  showAdminPasswordModal: function() {
    const modal = document.getElementById('modal-admin-password');
    const input = document.getElementById('input-admin-pw');
    const error = document.getElementById('admin-pw-error');
    if (modal) {
      modal.classList.remove('hidden');
      if (input) {
        input.value = '';
        input.focus();
      }
      if (error) error.classList.add('hidden');
    }
  },

  handleAdminPasswordSubmit: function() {
    const input = document.getElementById('input-admin-pw');
    const error = document.getElementById('admin-pw-error');
    const pw = input ? input.value : '';

    if (pw === this.getAdminPw() || pw === this.getMasterPw()) {
      AppState.isAdminAuthenticated = true;
      const modal = document.getElementById('modal-admin-password');
      if (modal) modal.classList.add('hidden');
      this.switchView('admin');
    } else {
      if (error) error.classList.remove('hidden');
    }
  },

  handleChangeAdminPassword: function() {
    const masterVerify = document.getElementById('input-master-pw-verify');
    const newAdminPw = document.getElementById('input-new-admin-pw');
    
    if (!masterVerify || !newAdminPw) return;

    if (masterVerify.value === this.getMasterPw()) {
      if (newAdminPw.value.length < 4) {
        alert('새 관리자 비밀번호는 4자리 이상이어야 합니다.');
        return;
      }
      this.setAdminPw(newAdminPw.value);
      alert('관리자 비밀번호가 변경되었습니다.');
      masterVerify.value = '';
      newAdminPw.value = '';
    } else {
      alert('마스터 비밀번호가 틀렸습니다.');
    }
  },

  handleChangeMasterPassword: function() {
    const currentMaster = document.getElementById('input-current-master-pw');
    const newMaster = document.getElementById('input-new-master-pw');
    
    if (!currentMaster || !newMaster) return;

    if (currentMaster.value === this.getMasterPw()) {
       if (newMaster.value.length < 4) {
        alert('새 마스터 비밀번호는 4자리 이상이어야 합니다.');
        return;
      }
      this.setMasterPw(newMaster.value);
      alert('마스터 비밀번호가 변경되었습니다.');
      currentMaster.value = '';
      newMaster.value = '';
    } else {
      alert('현재 마스터 비밀번호가 틀렸습니다.');
    }
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
      const signedCount = attendees.filter(a => a.isSigned || (a.status && a.status !== '미서명')).length;
      
      const createdAtMs = new Date(bundle.createdAt).getTime();
      const isExpiringSoon = (now - createdAtMs) > twentyFiveDaysMs;
      const warningBadge = isExpiringSoon ? '<span class="ml-2 inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">삭제 임박</span>' : '';

      const sessionTitles = bundle.sessions.map(s => s.title).join(', ');
      
      const card = document.createElement('div');
      card.className = 'bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden flex flex-col';
      card.innerHTML = `
        <div class="p-5 flex-grow">
          <div class="flex justify-between items-start mb-2">
            <h3 class="text-lg font-semibold text-gray-900">${bundle.name} ${warningBadge}</h3>
          </div>
          <p class="text-sm text-gray-500 mb-4 h-10 overflow-hidden text-ellipsis">${sessionTitles}</p>
          <div class="text-sm text-gray-600 mb-2">
            <span class="font-medium text-gray-900">연수 개수:</span> ${bundle.sessions.length}개
          </div>
          <div class="flex justify-between text-sm text-gray-600">
            <span>서명/총원:</span>
            <span class="font-medium">${signedCount} / ${attendees.length}명</span>
          </div>
        </div>
        <div class="bg-gray-50 p-4 border-t border-gray-200 flex justify-end gap-2">
          <button class="btn-open-bundle px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm" data-id="${bundle.id}">열기</button>
          <button class="btn-manage-bundle px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 text-sm" data-id="${bundle.id}">관리</button>
          <button class="btn-delete-bundle px-4 py-2 bg-red-100 text-red-600 rounded hover:bg-red-200 text-sm" data-id="${bundle.id}">삭제</button>
        </div>
      `;
      container.appendChild(card);
    });

    container.querySelectorAll('.btn-open-bundle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.selectBundle(e.target.dataset.id);
        this.switchView('participant');
      });
    });

    container.querySelectorAll('.btn-manage-bundle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.selectBundle(e.target.dataset.id);
        this.switchView('admin');
      });
    });

    container.querySelectorAll('.btn-delete-bundle').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.deleteBundle(e.target.dataset.id);
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
        statusHtml = `<span class="text-xs font-semibold text-gray-600 bg-gray-200 px-2 py-1 rounded-full">${attendee.status}</span>`;
      }

      btn.innerHTML = `
        <div class="flex justify-between items-start mb-2">
          <span class="text-sm text-gray-500 font-medium">${attendee.department}</span>
          ${statusHtml}
        </div>
        <div class="text-lg font-bold text-gray-900">${attendee.name}</div>
      `;

      if (!attendee.isSigned) {
        btn.addEventListener('click', () => this.startSigning(attendee.id));
      }
      
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
    const signed = filtered.filter(a => a.isSigned || (a.status && a.status !== '미서명')).length;
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
          statusBadge = `<span class="px-2 py-1 text-xs font-medium bg-gray-100 text-gray-800 rounded-full">${attendee.status}</span>`;
        }

        const signedAtStr = attendee.signedAt ? new Date(attendee.signedAt).toLocaleTimeString() : '-';

        const statusSelect = `
          <select class="admin-status-select text-sm border-gray-300 rounded-md" data-id="${attendee.id}">
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
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-900">${attendee.department}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">${attendee.name}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${statusBadge}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${signedAtStr}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">${statusSelect}</td>
          <td class="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
            <button class="btn-del-attendee text-red-600 hover:text-red-900" data-id="${attendee.id}">삭제</button>
          </td>
        `;
        tbody.appendChild(tr);
      });

      tbody.querySelectorAll('.admin-status-select').forEach(sel => {
        sel.addEventListener('change', (e) => {
          this.changeAttendeeStatus(e.target.dataset.id, e.target.value);
        });
      });

      tbody.querySelectorAll('.btn-del-attendee').forEach(btn => {
        btn.addEventListener('click', (e) => {
          this.deleteAttendee(e.target.dataset.id);
        });
      });
    }
  },

  renderPdfPreview: function() {
    if (!AppState.currentBundle || typeof PdfGenerator === 'undefined') return;
    const previewArea = document.getElementById('pdf-preview-area');
    if (previewArea) {
      if (AppState.currentBundle.sessions.length > 0) {
        PdfGenerator.renderPreviewDocument(AppState.currentBundle, AppState.currentBundle.sessions[0].id, previewArea);
      } else {
        previewArea.innerHTML = '<div class="text-center p-8 text-gray-500">연수가 없습니다. 설정에서 연수를 추가하세요.</div>';
      }
    }
  },

  renderAdminQrCode: function() {
    const container = document.getElementById('admin-qr-code-container');
    const urlText = document.getElementById('admin-qr-url-text');
    if (!container || !AppState.currentBundle) return;
    
    container.innerHTML = '';
    const shareUrl = this.getShareSignUrl();
    if (urlText) urlText.value = shareUrl;

    if (typeof QRCode !== 'undefined') {
      new QRCode(container, {
        text: shareUrl,
        width: 200,
        height: 200,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.M
      });
    }
  },

  renderLargeQrCode: function() {
    const container = document.getElementById('large-qr-code-container');
    if (!container || !AppState.currentBundle) return;
    
    container.innerHTML = '';
    const shareUrl = this.getShareSignUrl();

    if (typeof QRCode !== 'undefined') {
      new QRCode(container, {
        text: shareUrl,
        width: 400,
        height: 400,
        colorDark : "#000000",
        colorLight : "#ffffff",
        correctLevel : QRCode.CorrectLevel.M
      });
    }
  },

  updateHeaderInfo: function() {
    if (!AppState.currentBundle) return;
    const bundle = AppState.currentBundle;
    
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
          <span class="font-medium">${sess.title}</span> <span class="text-sm text-gray-500">(${sess.date})</span>
        </div>
        <button type="button" class="btn-del-session text-red-500 hover:text-red-700 text-sm" data-id="${sess.id}">삭제</button>
      `;
      container.appendChild(li);
    });

    container.querySelectorAll('.btn-del-session').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.removeSessionFromBundle(AppState.currentBundle.id, e.target.dataset.id);
      });
    });
  },

  // Signing flow
  startSigning: function(attendeeId) {
    const attendee = AppState.currentBundle.attendees.find(a => a.id === attendeeId);
    if (!attendee) return;

    AppState.selectedAttendeeForSign = attendee;
    
    document.getElementById('step-select-person').classList.add('hidden');
    document.getElementById('step-sign-complete').classList.add('hidden');
    document.getElementById('step-sign-canvas').classList.remove('hidden');

    const nameEl = document.getElementById('signing-person-name');
    const deptEl = document.getElementById('signing-person-dept');
    if (nameEl) nameEl.textContent = attendee.name;
    if (deptEl) deptEl.textContent = attendee.department;

    if (AppState.signaturePad) {
      AppState.signaturePad.resizeCanvas();
      AppState.signaturePad.clear();
    }
  },

  cancelSigning: function() {
    AppState.selectedAttendeeForSign = null;
    document.getElementById('step-sign-canvas').classList.add('hidden');
    document.getElementById('step-select-person').classList.remove('hidden');
  },

  handleSignatureSubmit: function() {
    if (!AppState.selectedAttendeeForSign || !AppState.currentBundle) return;
    if (!AppState.signaturePad || AppState.signaturePad.isEmpty()) {
      alert('서명을 입력해주세요.');
      return;
    }

    const attendee = AppState.selectedAttendeeForSign;
    const signatureData = AppState.signaturePad.toDataURL();
    
    attendee.isSigned = true;
    attendee.status = '출석';
    attendee.signatureData = signatureData;
    attendee.signedAt = new Date().toISOString();

    this.saveBundles();

    // Sync to GAS if connected
    if (this.getGasUrl() && typeof GasSync !== 'undefined') {
       GasSync.submitSignature(AppState.currentBundle.id, attendee.id, signatureData, '출석');
    }

    document.getElementById('step-sign-canvas').classList.add('hidden');
    document.getElementById('step-sign-complete').classList.remove('hidden');
    
    const compName = document.getElementById('complete-user-name');
    const compTime = document.getElementById('complete-user-time');
    if (compName) compName.textContent = attendee.name;
    if (compTime) compTime.textContent = new Date().toLocaleTimeString();

    setTimeout(() => {
      document.getElementById('step-sign-complete').classList.add('hidden');
      document.getElementById('step-select-person').classList.remove('hidden');
      AppState.selectedAttendeeForSign = null;
      this.renderParticipantNameList();
      this.renderAdminOverview(AppState.selectedDepartment);
    }, 2500);
  },

  handleDirectAddAttendee: function(e) {
    e.preventDefault();
    if (!AppState.currentBundle) return;
    
    const dept = document.getElementById('direct-dept').value.trim();
    const name = document.getElementById('direct-name').value.trim();
    const position = document.getElementById('direct-position').value.trim();
    
    if (!dept || !name) {
      alert('부서와 이름을 입력해주세요.');
      return;
    }

    const newAttendee = {
      id: 'att_' + new Date().getTime() + '_' + Math.floor(Math.random()*1000),
      department: dept,
      name: name,
      position: position,
      isSigned: false,
      status: '미서명',
      signatureData: null,
      note: '',
      signedAt: null
    };

    AppState.currentBundle.attendees.push(newAttendee);
    this.saveBundles();
    
    document.getElementById('form-add-attendee').reset();
    document.getElementById('modal-add-attendee').classList.add('hidden');
    
    this.renderParticipantView();
    this.renderAdminOverview();
    
    if (this.getGasUrl() && typeof GasSync !== 'undefined') {
      GasSync.syncInitialRoster(AppState.currentBundle.id, AppState.currentBundle.attendees);
    }
  },

  // Absent/status
  openAbsentModal: function(attendeeId) {
    const attendee = AppState.currentBundle.attendees.find(a => a.id === attendeeId);
    if (!attendee) return;
    AppState.selectedAttendeeForAbsent = attendee;
    
    document.getElementById('absent-target-name').textContent = attendee.name;
    document.getElementById('modal-absent-reason').classList.remove('hidden');
  },

  handleAbsentSubmit: function(e) {
    e.preventDefault();
    if (!AppState.selectedAttendeeForAbsent || !AppState.currentBundle) return;
    
    const type = document.getElementById('select-absent-type').value;
    const note = document.getElementById('input-absent-note').value;
    
    const attendee = AppState.selectedAttendeeForAbsent;
    attendee.status = type;
    attendee.note = note;
    
    this.saveBundles();
    
    document.getElementById('modal-absent-reason').classList.add('hidden');
    document.getElementById('form-absent-reason').reset();
    AppState.selectedAttendeeForAbsent = null;
    
    this.renderAdminOverview(document.getElementById('admin-dept-filter').value);
    this.renderParticipantNameList();

    if (this.getGasUrl() && typeof GasSync !== 'undefined') {
      GasSync.submitSignature(AppState.currentBundle.id, attendee.id, null, type);
    }
  },

  changeAttendeeStatus: function(id, newStatus) {
    if (!AppState.currentBundle) return;
    const attendee = AppState.currentBundle.attendees.find(a => a.id === id);
    if (attendee) {
      if (newStatus === '미서명') {
        attendee.isSigned = false;
        attendee.signatureData = null;
        attendee.signedAt = null;
      }
      attendee.status = newStatus;
      this.saveBundles();
      this.renderAdminOverview(document.getElementById('admin-dept-filter').value);
      this.renderParticipantNameList();

      if (this.getGasUrl() && typeof GasSync !== 'undefined') {
        GasSync.submitSignature(AppState.currentBundle.id, attendee.id, attendee.signatureData, newStatus);
      }
    }
  },

  deleteAttendee: function(id) {
    if (!confirm('이 참석자를 삭제하시겠습니까?')) return;
    if (!AppState.currentBundle) return;
    
    AppState.currentBundle.attendees = AppState.currentBundle.attendees.filter(a => a.id !== id);
    this.saveBundles();
    this.renderAdminOverview(document.getElementById('admin-dept-filter').value);
    this.renderParticipantNameList();
    this.renderDepartmentFilter();
    
    if (this.getGasUrl() && typeof GasSync !== 'undefined') {
      GasSync.syncInitialRoster(AppState.currentBundle.id, AppState.currentBundle.attendees);
    }
  },

  // File upload
  setupFileUpload: function() {
    const dropZone = document.getElementById('roster-drop-zone');
    const fileInput = document.getElementById('roster-file-input');
    
    if (dropZone && fileInput) {
      dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('border-blue-500', 'bg-blue-50');
      });
      dropZone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500', 'bg-blue-50');
      });
      dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('border-blue-500', 'bg-blue-50');
        if (e.dataTransfer.files.length) {
          this.handleRosterFile(e.dataTransfer.files[0]);
        }
      });
      dropZone.addEventListener('click', () => fileInput.click());
      fileInput.addEventListener('change', (e) => {
        if (e.target.files.length) {
          this.handleRosterFile(e.target.files[0]);
        }
      });
    }

    const btnParseText = document.getElementById('btn-parse-text-roster');
    if (btnParseText) {
      btnParseText.addEventListener('click', () => {
        const text = document.getElementById('textarea-roster-paste').value;
        if (!text) {
          alert('텍스트를 입력해주세요.');
          return;
        }
        if (typeof ListParser !== 'undefined') {
           const result = ListParser.parseTextLines(text);
           this.appendOrReplaceAttendees(result);
           document.getElementById('textarea-roster-paste').value = '';
        }
      });
    }
  },

  handleRosterFile: function(file) {
    if (!file) return;
    const status = document.getElementById('file-upload-status');
    if (status) status.textContent = `${file.name} 파일 분석 중...`;
    
    if (typeof ListParser === 'undefined') {
      if (status) status.textContent = 'Parser가 로드되지 않았습니다.';
      return;
    }

    if (file.name.endsWith('.pdf')) {
      ListParser.parsePdf(file).then(result => {
        if (status) status.textContent = `${result.length}명 처리 완료`;
        this.appendOrReplaceAttendees(result);
      }).catch(err => {
        if (status) status.textContent = 'PDF 처리 오류: ' + err.message;
      });
    } else if (file.name.endsWith('.xlsx') || file.name.endsWith('.xls')) {
      ListParser.parseExcel(file).then(result => {
        if (status) status.textContent = `${result.length}명 처리 완료`;
        this.appendOrReplaceAttendees(result);
      }).catch(err => {
        if (status) status.textContent = 'Excel 처리 오류: ' + err.message;
      });
    } else {
      if (status) status.textContent = '지원되지 않는 파일 형식입니다.';
    }
  },

  appendOrReplaceAttendees: function(parsedAttendees) {
    if (!AppState.currentBundle || !parsedAttendees || parsedAttendees.length === 0) return;
    
    const mode = document.querySelector('input[name="roster-mode"]:checked')?.value || 'append';
    
    const mapped = parsedAttendees.map(p => ({
      id: 'att_' + new Date().getTime() + '_' + Math.floor(Math.random()*10000),
      department: p.department || '미지정',
      name: p.name,
      position: p.position || '',
      isSigned: false,
      status: '미서명',
      signatureData: null,
      note: '',
      signedAt: null
    }));

    if (mode === 'replace') {
      AppState.currentBundle.attendees = mapped;
    } else {
      AppState.currentBundle.attendees = AppState.currentBundle.attendees.concat(mapped);
    }

    this.saveBundles();
    this.renderAdminOverview();
    this.renderParticipantNameList();
    this.renderDepartmentFilter();
    
    alert(`${mapped.length}명의 명단이 적용되었습니다.`);

    if (this.getGasUrl() && typeof GasSync !== 'undefined') {
      GasSync.syncInitialRoster(AppState.currentBundle.id, AppState.currentBundle.attendees);
    }
  },

  // QR & sharing
  getShareSignUrl: function() {
    if (!AppState.currentBundle) return window.location.href;
    const url = new URL(window.location.href);
    url.searchParams.set('bundle', AppState.currentBundle.id);
    url.searchParams.set('view', 'participant');
    
    if (this.getGasUrl()) {
      url.searchParams.set('gas', this.getGasUrl());
    }
    if (typeof GasSync !== 'undefined' && GasSync.getSheetName()) {
      url.searchParams.set('sheet', GasSync.getSheetName());
    }
    
    return url.toString();
  },

  // Google Sheets sync
  syncFromGoogleSheet: function(showToast = true) {
    if (!AppState.currentBundle || typeof GasSync === 'undefined' || !this.getGasUrl()) return;
    
    GasSync.fetchLiveStatus(AppState.currentBundle.id)
      .then(updates => {
        if (!updates || updates.length === 0) return;
        
        let changed = false;
        updates.forEach(u => {
          const attendee = AppState.currentBundle.attendees.find(a => a.id === u.id);
          if (attendee) {
            if (u.status !== attendee.status || (u.signatureData && !attendee.signatureData)) {
              attendee.status = u.status;
              if (u.status === '출석') {
                 attendee.isSigned = true;
                 if (u.signatureData) attendee.signatureData = u.signatureData;
              } else if (u.status === '미서명') {
                 attendee.isSigned = false;
              } else {
                 attendee.isSigned = false;
              }
              changed = true;
            }
          }
        });

        if (changed) {
          this.saveBundles();
          this.renderAdminOverview(document.getElementById('admin-dept-filter').value);
          this.renderParticipantNameList();
          if (showToast) console.log('구글 시트에서 최신 상태를 동기화했습니다.');
        }
      })
      .catch(err => {
         console.error('Sync failed', err);
      });
  },

  syncToGoogleSheet: function() {
     if (!AppState.currentBundle || typeof GasSync === 'undefined' || !this.getGasUrl()) return;
     GasSync.syncInitialRoster(AppState.currentBundle.id, AppState.currentBundle.attendees)
       .then(() => alert('구글 시트에 명단을 동기화했습니다.'))
       .catch(e => alert('동기화 실패: ' + e));
  },

  renderTempSessions: function() {
    const list = document.getElementById('bundle-session-list-preview');
    if (!list) return;
    list.innerHTML = '';
    AppState.tempBundleSessions.forEach((s, idx) => {
      const li = document.createElement('li');
      li.className = 'flex justify-between items-center text-sm py-1';
      li.innerHTML = `<span>${s.title} (${s.date})</span> <button type="button" class="text-red-500" data-idx="${idx}">X</button>`;
      list.appendChild(li);
    });
    list.querySelectorAll('button').forEach(btn => {
      btn.addEventListener('click', (e) => {
        AppState.tempBundleSessions.splice(parseInt(e.target.dataset.idx), 1);
        this.renderTempSessions();
      });
    });
  },

  setupEventListeners: function() {
    // Navigation
    document.querySelectorAll('[data-switch-view]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchView(e.currentTarget.dataset.switchView);
      });
    });

    // Admin Tabs
    document.querySelectorAll('.admin-tab-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        this.switchAdminTab(e.currentTarget.dataset.adminTab);
      });
    });

    // Create bundle modal
    const btnCreateBundle = document.getElementById('btn-create-bundle');
    const modalCreate = document.getElementById('modal-create-bundle');
    const btnAddSession = document.getElementById('btn-bundle-add-session');
    const btnSubmitBundle = document.getElementById('btn-bundle-create-submit');

    if (btnCreateBundle && modalCreate) {
      btnCreateBundle.addEventListener('click', () => {
        document.getElementById('input-bundle-name').value = '';
        document.getElementById('input-bundle-session-title').value = '';
        document.getElementById('input-bundle-session-date').value = '';
        AppState.tempBundleSessions = [];
        this.renderTempSessions();
        modalCreate.classList.remove('hidden');
      });
    }

    if (btnAddSession) {
      btnAddSession.addEventListener('click', () => {
        const t = document.getElementById('input-bundle-session-title').value.trim();
        const d = document.getElementById('input-bundle-session-date').value.trim();
        if (t && d) {
           AppState.tempBundleSessions.push({ id: 'sess_' + new Date().getTime(), title: t, date: d });
           this.renderTempSessions();
           document.getElementById('input-bundle-session-title').value = '';
        }
      });
    }

    if (btnSubmitBundle) {
      btnSubmitBundle.addEventListener('click', () => {
        const name = document.getElementById('input-bundle-name').value.trim();
        if (!name) { alert('묶음 이름을 입력하세요.'); return; }
        if (AppState.tempBundleSessions.length === 0) { alert('최소 1개의 연수를 추가하세요.'); return; }
        this.createBundle(name, [...AppState.tempBundleSessions]);
        modalCreate.classList.add('hidden');
      });
    }

    modalCreate?.addEventListener('click', (e) => {
       if (e.target === modalCreate) modalCreate.classList.add('hidden');
    });

    // Admin Password Modal
    const btnPwSubmit = document.getElementById('btn-admin-pw-submit');
    const btnPwCancel = document.getElementById('btn-admin-pw-cancel');
    const inputPw = document.getElementById('input-admin-pw');

    if (btnPwSubmit) btnPwSubmit.addEventListener('click', () => this.handleAdminPasswordSubmit());
    if (btnPwCancel) btnPwCancel.addEventListener('click', () => document.getElementById('modal-admin-password').classList.add('hidden'));
    if (inputPw) {
      inputPw.addEventListener('keypress', (e) => {
        if (e.key === 'Enter') this.handleAdminPasswordSubmit();
      });
    }

    // Passwords change
    document.getElementById('btn-change-admin-pw')?.addEventListener('click', () => this.handleChangeAdminPassword());
    document.getElementById('btn-change-master-pw')?.addEventListener('click', () => this.handleChangeMasterPassword());

    // Settings save
    const formSettings = document.getElementById('form-session-info');
    if (formSettings) {
      formSettings.addEventListener('input', () => {
        if (!AppState.currentBundle) return;
        AppState.currentBundle.location = document.getElementById('input-session-location').value;
        AppState.currentBundle.organizer = document.getElementById('input-session-organizer').value;
        AppState.currentBundle.verifierDept = document.getElementById('input-verifier-dept').value;
        AppState.currentBundle.verifierName = document.getElementById('input-verifier-name').value;
        AppState.currentBundle.showApprovalBox = document.getElementById('check-show-approval').checked;
        AppState.currentBundle.approvalStages = document.getElementById('input-approval-stages').value.split(',').map(s=>s.trim());
        
        const stageContainer = document.getElementById('approval-stages-container');
        if(stageContainer) {
          if (AppState.currentBundle.showApprovalBox) stageContainer.classList.remove('hidden');
          else stageContainer.classList.add('hidden');
        }
        
        this.saveBundles();
      });
    }

    // Add session in settings
    const btnAddSess = document.getElementById('btn-add-session-to-bundle');
    if (btnAddSess) {
      btnAddSess.addEventListener('click', () => {
         if (!AppState.currentBundle) return;
         const title = document.getElementById('input-new-session-title').value.trim();
         const date = document.getElementById('input-new-session-date').value.trim();
         if (title && date) {
            this.addSessionToBundle(AppState.currentBundle.id, title, date);
            document.getElementById('input-new-session-title').value = '';
         }
      });
    }

    // Filters and search
    const pSelect = document.getElementById('participant-dept-select');
    if (pSelect) {
      pSelect.addEventListener('change', (e) => {
        AppState.selectedDepartment = e.target.value;
        this.renderParticipantNameList();
      });
    }

    const pSearch = document.getElementById('participant-name-search');
    if (pSearch) {
      pSearch.addEventListener('input', (e) => {
        AppState.searchQuery = e.target.value;
        this.renderParticipantNameList();
      });
    }

    const aSelect = document.getElementById('admin-dept-filter');
    if (aSelect) {
      aSelect.addEventListener('change', (e) => {
        AppState.selectedDepartment = e.target.value;
        this.renderAdminOverview(e.target.value);
      });
    }

    // Signature Pad buttons
    document.getElementById('btn-clear-signature')?.addEventListener('click', () => AppState.signaturePad?.clear());
    document.getElementById('btn-undo-signature')?.addEventListener('click', () => AppState.signaturePad?.undo());
    document.getElementById('btn-cancel-signature')?.addEventListener('click', () => this.cancelSigning());
    document.getElementById('btn-submit-signature')?.addEventListener('click', () => this.handleSignatureSubmit());

    // Add attendee modal
    document.getElementById('btn-open-add-attendee')?.addEventListener('click', () => {
      document.getElementById('modal-add-attendee')?.classList.remove('hidden');
    });
    document.getElementById('btn-close-add-modal')?.addEventListener('click', () => {
      document.getElementById('modal-add-attendee')?.classList.add('hidden');
    });
    document.getElementById('form-add-attendee')?.addEventListener('submit', (e) => this.handleDirectAddAttendee(e));

    // Absent modal
    document.getElementById('btn-close-absent-modal')?.addEventListener('click', () => {
      document.getElementById('modal-absent-reason')?.classList.add('hidden');
    });
    document.getElementById('form-absent-reason')?.addEventListener('submit', (e) => this.handleAbsentSubmit(e));

    // Fullscreen QR
    document.getElementById('btn-open-fullscreen-qr')?.addEventListener('click', () => {
      this.renderLargeQrCode();
      document.getElementById('modal-fullscreen-qr')?.classList.remove('hidden');
    });
    document.getElementById('btn-close-qr-modal')?.addEventListener('click', () => {
      document.getElementById('modal-fullscreen-qr')?.classList.add('hidden');
    });

    // PDF / Export
    document.getElementById('btn-download-pdf')?.addEventListener('click', () => {
      if (typeof PdfGenerator !== 'undefined' && AppState.currentBundle) {
        PdfGenerator.downloadAllSessionPdfs(AppState.currentBundle);
      }
    });
    document.getElementById('btn-print-doc')?.addEventListener('click', () => {
       window.print();
    });
    document.getElementById('btn-export-excel')?.addEventListener('click', () => {
      if (typeof PdfGenerator !== 'undefined' && AppState.currentBundle) {
        PdfGenerator.exportToExcel(AppState.currentBundle);
      }
    });

    // GAS Sync
    document.getElementById('btn-save-gas-url')?.addEventListener('click', () => {
      if (typeof GasSync !== 'undefined') {
        const url = document.getElementById('input-gas-url').value.trim();
        GasSync.setScriptUrl(url);
        GasSync.testConnection().then(ok => {
           document.getElementById('gas-test-result').textContent = ok ? '연결 성공' : '연결 실패';
           this.updateGasStatusBadge(ok);
        });
      }
    });
    
    document.getElementById('btn-force-sync-gas')?.addEventListener('click', () => this.syncToGoogleSheet());
    document.getElementById('btn-fetch-from-gas')?.addEventListener('click', () => this.syncFromGoogleSheet(true));

    this.setupFileUpload();
  }
};

window.App = App;
document.addEventListener('DOMContentLoaded', () => App.init());
