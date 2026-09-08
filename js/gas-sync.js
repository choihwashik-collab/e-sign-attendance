/** v8 transport: credentials in POST bodies; short-lived random receipts confirm server results. */
const GasSync = {
  DEFAULT_SCRIPT_URL:'https://script.google.com/macros/s/AKfycbxC4C0dhdK7T1LvJRdPNE6dyx7qi9glSMDP-BuLcd8liP5wLjFg2mIqPgMI8FdasAMR/exec',
  adminKey: '',
  participant: null,
  scriptUrl: '',
  async initialize() {
    this.scriptUrl = localStorage.getItem('eSign_server_v8') || this.DEFAULT_SCRIPT_URL;
    if (this.scriptUrl && !this.isValidUrl(this.scriptUrl)) this.scriptUrl = '';
  },
  isValidUrl(url) { return /^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url || ''); },
  getScriptUrl() { return this.scriptUrl; },
  setScriptUrl(url, persist = true) {
    const value = String(url || '').trim();
    if (value && !this.isValidUrl(value)) throw new Error('정확한 Google Apps Script /exec 주소만 허용됩니다. 쿼리와 다른 도메인은 사용할 수 없습니다.');
    if (value !== this.scriptUrl) { this.adminKey = ''; this.participant = null; }
    this.scriptUrl = value;
    if (persist) {
      if (value) localStorage.setItem('eSign_server_v8', value);
      else localStorage.removeItem('eSign_server_v8');
    }
  },
  randomHex(bytes = 32) {
    return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2,'0')).join('');
  },
  async testConnection(url = this.getScriptUrl()) {
    if (!this.isValidUrl(url)) return {success:false,message:'연동 주소가 없습니다.'};
    const result = await this._jsonpRequest(url,{action:'ping'});
    const success = result?.success && result.apiVersion === 10;
    return {success:!!success,message:success?'서버 연결 확인':'서버 업데이트 또는 연결 확인이 필요합니다.'};
  },
  async login(key) {
    if (typeof key !== 'string' || key.length < 32) throw new Error('스크립트 속성의 관리자 키(32자 이상)를 입력하세요.');
    if (!(await this.testConnection()).success) throw new Error('Google Apps Script에 새 Code.gs를 적용하고 새 버전으로 배포해 주세요.');
    const result = await this._post({action:'login'},key);
    if (result.apiVersion !== 10) throw new Error('Google Apps Script에 새 Code.gs를 적용하고 새 버전으로 배포해 주세요.');
    this.adminKey = key;
    this.participant = null;
    return result;
  },
  logout() { this.adminKey=''; this.participant=null; },
  async fetchBundles() { return (await this._post({action:'listBundles'})).bundles; },
  async fetchPublicBundles() { const r=await this._jsonpRequest(this.getScriptUrl(),{action:'listPublicBundles'});if(!r?.success)throw new Error('공개 연수 목록을 불러오지 못했습니다.');return r.bundles; },
  async fetchBundle(bundleId) {
    if(!this.adminKey&&!this.participant){const r=await this._jsonpRequest(this.getScriptUrl(),{action:'getPublicBundle',bundleId});if(!r?.success)throw new Error(r?.message||'연수를 불러오지 못했습니다.');return r.bundle;}
    return (await this._post({action:'getBundle',bundleId})).bundle;
  },
  async syncBundle(bundle) {
    return this._post({action:'initBundle',bundle,expectedRevision:bundle.revision});
  },
  async submitAttendee(bundle, attendee) {
    return this._post({action:'submitAttendee',bundleId:bundle.id,attendee,expectedRevision:bundle.revision});
  },
  async submitSignature(bundle, attendee) {
    return this._post({action:'submitSignature',bundleId:bundle.id,attendeeId:attendee.id,signatureData:attendee.signatureData,expectedSignedAt:attendee.signedAt || null});
  },
  async submitReason(bundle,attendee,status,note) {
    return this._post({action:'submitReason',bundleId:bundle.id,attendeeId:attendee.id,status,note,expectedSignedAt:attendee.signedAt || null});
  },
  async listRosters(){return (await this._post({action:'listRosters'})).rosters;},
  async saveRoster(roster){return this._post({action:'saveRoster',roster,expectedRevision:roster.revision});},
  async deleteRoster(roster){return this._post({action:'deleteRoster',rosterId:roster.id,expectedRevision:roster.revision});},
  async deleteBundle(bundle) {
    return this._post({action:'deleteBundle',bundleId:bundle.id,expectedRevision:bundle.revision});
  },
  async shareBundle(bundleId) { return this._post({action:'shareBundle',bundleId}); },
  async closeSharing(bundleId) { return this._post({action:'closeSharing',bundleId}); },
  async _post(payload, loginKey) {
    const url = this.getScriptUrl();
    if (!this.isValidUrl(url)) throw new Error('서버 주소를 먼저 설정하세요.');
    const requestId = this.randomHex();
    const body = {...payload,requestId};
    if (loginKey || this.adminKey) body.adminKey=loginKey || this.adminKey;
    else if (this.participant?.bundleId === payload.bundleId) body.token=this.participant.token;
    else if(payload.action!=='submitSignature'&&payload.action!=='submitReason') throw new Error('진행자 로그인 또는 유효한 초대 링크가 필요합니다.');
    const controller = new AbortController();
    const timer = setTimeout(()=>controller.abort(),45000);
    try {
      await fetch(url,{method:'POST',mode:'no-cors',credentials:'omit',referrerPolicy:'no-referrer',
        headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify(body),signal:controller.signal});
      const deadline=Date.now()+45000;
      let receipt;
      while (Date.now()<deadline) {
        receipt=await this._jsonpRequest(url,{action:'receipt',requestId});
        if (receipt?.ready) break;
        await new Promise(r=>setTimeout(r,1000));
      }
      if (!receipt?.ready || !Number.isInteger(receipt.parts) || receipt.parts<1 || receipt.parts>223) throw new Error('저장 결과를 확인하지 못했습니다. 최신 자료를 불러와 확인한 후 재시도하세요.');
      const parts=[];
      for(let i=0;i<receipt.parts;i+=4) {
        const batch=await Promise.all(Array.from({length:Math.min(4,receipt.parts-i)},(_,j)=>
          this._jsonpRequest(url,{action:'receipt',requestId,part:i+j})));
        if(batch.some(p=>typeof p?.part!=='string')) throw new Error('응답이 만료되었습니다. 최신 자료를 다시 불러오세요.');
        parts.push(...batch.map(p=>p.part));
      }
      const result=JSON.parse(parts.join(''));
      if(!result.success) throw new Error(result.message || '서버 처리 실패');
      return result;
    } finally { clearTimeout(timer); }
  },
  _jsonpRequest(baseUrl, params, timeoutMs = 7000) {
    if (!this.isValidUrl(baseUrl)) return Promise.reject(new Error('허용되지 않은 서버 주소입니다.'));
    return new Promise(resolve=>{
      const callbackName='gas_cb_'+this.randomHex(16),script=document.createElement('script');
      let finished=false,timer;
      const finish=value=>{
        if(finished)return;
        finished=true;clearTimeout(timer);delete window[callbackName];script.remove();resolve(value);
      };
      window[callbackName]=finish;
      script.onerror=()=>finish(null);
      const url=new URL(baseUrl);
      Object.entries({...params,callback:callbackName}).forEach(([k,v])=>url.searchParams.set(k,v));
      script.src=url.href;script.referrerPolicy='no-referrer';
      timer=setTimeout(()=>finish(null),timeoutMs);
      document.body.appendChild(script);
    });
  }
};
window.GasSync=GasSync;

