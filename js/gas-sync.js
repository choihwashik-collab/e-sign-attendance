/** Google Apps Script / Google Sheets synchronization client (v7). */
const GasSync = {
  DEFAULT_SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxC4C0dhdK7T1LvJRdPNE6dyx7qi9glSMDP-BuLcd8liP5wLjFg2mIqPgMI8FdasAMR/exec',
  getScriptUrl() { return localStorage.getItem('eSign_gasUrl') || this.DEFAULT_SCRIPT_URL; },
  setScriptUrl(url) {
    const value = (url || '').trim();
    if (value) localStorage.setItem('eSign_gasUrl', value);
    else localStorage.removeItem('eSign_gasUrl');
  },
  async testConnection(url) {
    const targetUrl = (url || this.getScriptUrl()).trim();
    if (!targetUrl) return { success: false, message: 'Google Apps Script URL을 입력해 주세요.' };
    if (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec(?:\?|$)/.test(targetUrl)) {
      return { success: false, message: '배포된 웹 앱의 /exec URL을 입력해 주세요.' };
    }
    const result = await this._jsonpRequest(targetUrl, { action: 'ping' }, 8000);
    return result && result.success
      ? { success: true, message: result.message || '구글 스프레드시트 연결 성공' }
      : { success: false, message: '연결하지 못했습니다. 웹 앱 배포 권한을 확인해 주세요.' };
  },
  async syncBundle(bundle) {
    if (!bundle || !bundle.id) return { success: false, message: '연수 묶음 정보가 없습니다.' };
    return this._post({ action: 'initBundle', bundle });
  },
  async syncInitialRoster(bundle, attendees) {
    if (typeof bundle === 'object') return this.syncBundle({ ...bundle, attendees: attendees || bundle.attendees || [] });
    return { success: false, message: '연수 묶음 전체 정보가 필요합니다.' };
  },
  async submitAttendee(bundle, attendee) {
    if (!bundle || !bundle.id || !attendee) return { success: false, message: '전송할 출석 정보가 없습니다.' };
    return this._post({ action: 'submitAttendee', bundleId: bundle.id, bundle: this._bundleMetadata(bundle), attendee });
  },
  async submitSignature(bundle, attendee) { return this.submitAttendee(bundle, attendee); },
  async fetchBundle(bundleId) {
    const url = this.getScriptUrl();
    if (!url || !bundleId) return null;
    const data = await this._jsonpRequest(url, { action: 'getBundle', bundleId }, 10000);
    return data && data.success && data.bundle ? data.bundle : null;
  },
  async fetchBundles() {
    const url = this.getScriptUrl();
    if (!url) return [];
    const data = await this._jsonpRequest(url, { action: 'listBundles' }, 10000);
    return data && data.success && Array.isArray(data.bundles) ? data.bundles : [];
  },
  async deleteBundle(bundleId) {
    if (!bundleId) return { success: false, message: '삭제할 묶음 ID가 없습니다.' };
    return this._post({ action: 'deleteBundle', bundleId });
  },
  async fetchLiveStatus(bundleId) {
    const bundle = await this.fetchBundle(bundleId);
    return bundle ? bundle.attendees || [] : null;
  },
  _bundleMetadata(bundle) {
    return {
      id: bundle.id, name: bundle.name || '', createdAt: bundle.createdAt || new Date().toISOString(),
      sessions: bundle.sessions || [], location: bundle.location || '', organizer: bundle.organizer || '',
      verifierDept: bundle.verifierDept || '', verifierName: bundle.verifierName || '',
      showApprovalBox: !!bundle.showApprovalBox, approvalStages: bundle.approvalStages || []
    };
  },
  async _post(payload) {
    const url = this.getScriptUrl();
    if (!url) return { success: false, message: 'GAS URL이 설정되지 않았습니다.' };
    try {
      await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
      return { success: true };
    } catch (error) {
      console.error('[GasSync] POST failed:', error);
      return { success: false, message: error.message };
    }
  },
  _jsonpRequest(baseUrl, params, timeoutMs = 8000) {
    return new Promise((resolve) => {
      const callbackName = 'gas_cb_' + Math.random().toString(36).slice(2, 10);
      const script = document.createElement('script');
      let finished = false;
      const cleanup = () => { delete window[callbackName]; if (script.parentNode) script.parentNode.removeChild(script); };
      const finish = (value) => { if (finished) return; finished = true; cleanup(); resolve(value); };
      window[callbackName] = finish;
      script.onerror = () => finish(null);
      const url = new URL(baseUrl);
      url.searchParams.set('callback', callbackName);
      url.searchParams.set('_t', Date.now().toString());
      Object.entries(params || {}).forEach(([key, value]) => url.searchParams.set(key, value));
      script.src = url.toString();
      document.body.appendChild(script);
      setTimeout(() => finish(null), timeoutMs);
    });
  }
};
window.GasSync = GasSync;
