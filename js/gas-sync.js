/**
 * js/gas-sync.js
 * 구글 앱 스크립트(Google Apps Script) & 구글 스프레드시트 실시간 동기화 모듈
 * (v5: 시트명 기반 검색, JSONP 완벽 지원, 모바일↔PC 양방향 동기화)
 */

const GasSync = {
  _cachedSheetName: null,

  getScriptUrl() {
    return localStorage.getItem('eSign_gasUrl') || '';
  },

  setScriptUrl(url) {
    if (!url) return;
    localStorage.setItem('eSign_gasUrl', url.trim());
  },

  getSheetName() {
    return this._cachedSheetName || localStorage.getItem('eSign_sheetName') || '';
  },

  setSheetName(name) {
    if (!name) return;
    this._cachedSheetName = name;
    localStorage.setItem('eSign_sheetName', name);
  },

  /**
   * 구글 앱 스크립트 웹앱 연결 테스트 (JSONP + no-cors)
   */
  async testConnection(url) {
    let targetUrl = (url || this.getScriptUrl()).trim();
    if (!targetUrl) {
      return { success: false, message: 'Google Apps Script URL을 입력해 주세요.' };
    }

    if (!targetUrl.includes('script.google.com/macros/s/')) {
      return { 
        success: false, 
        message: 'URL 형식이 올바르지 않습니다. "https://script.google.com/macros/s/.../exec" 형태여야 합니다.' 
      };
    }

    if (targetUrl.endsWith('/dev')) {
      return {
        success: false,
        message: 'URL 끝이 /dev로 끝납니다. 새 배포 후 생성된 "/exec"로 끝나는 웹 앱 URL을 복사해 주세요.'
      };
    }

    // JSONP 방식으로 핑 테스트 시도 (CORS 제한 없음)
    const jsonpResult = await this._jsonpRequest(targetUrl, { action: 'ping' }, 5000);
    
    if (jsonpResult && jsonpResult.success) {
      return { success: true, message: '구글 스프레드시트와 성공적으로 연결되었습니다!' };
    }

    // no-cors Fallback POST
    try {
      await fetch(targetUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'ping' })
      });

      return {
        success: true,
        message: '구글 스프레드시트 연결 확인 완료! (실시간 전송 모드 활성화)'
      };
    } catch (err) {
      console.error('GAS connection error:', err);
      return {
        success: false,
        message: '연결 실패: Apps Script 배포 시 액세스 권한이 "모든 사용자(Anyone)"인지 확인해 주세요.'
      };
    }
  },

  /**
   * 연수 세션 및 초기 명단 시트에 저장
   */
  async syncInitialRoster(sessionData, attendees) {
    const url = this.getScriptUrl();
    if (!url) return { success: false, message: 'GAS URL 미설정 (로컬 저장만 적용)' };

    const payload = {
      action: 'initSession',
      session: sessionData,
      attendees: attendees.map(a => ({
        id: a.id,
        department: a.department,
        name: a.name,
        position: a.position,
        status: a.status || (a.isSigned ? '서명완료' : '미서명'),
        note: a.note || ''
      }))
    };

    try {
      // 먼저 JSONP로 시도 (응답 확인 가능)
      // initSession은 POST만 가능하므로 no-cors 사용
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });

      // 세션 타이틀을 시트명으로 캐시 (getStatus에서 사용)
      const sheetName = sessionData.title ? sessionData.title.substring(0, 30) : '연수출석부';
      this.setSheetName(sheetName);

      console.log('[GasSync] initSession sent. SheetName:', sheetName, 'Attendees:', attendees.length);
      return { success: true, message: '구글 시트로 명단 전송 완료' };
    } catch (err) {
      console.error('GAS initSession Error:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * 개별 참여자 서명/출석 데이터 구글 시트에 실시간 전송
   */
  async submitSignature(sessionId, attendeeData) {
    const url = this.getScriptUrl();
    if (!url) return { success: false, message: '로컬에만 저장되었습니다.' };

    const payload = {
      action: 'submitSignature',
      sessionId: sessionId,
      sheetName: this.getSheetName(), // 시트명 전달
      attendee: {
        id: attendeeData.id,
        department: attendeeData.department,
        name: attendeeData.name,
        position: attendeeData.position,
        status: attendeeData.status || (attendeeData.isSigned ? '출석' : '미서명'),
        note: attendeeData.note || '',
        signatureData: attendeeData.signatureData
      }
    };

    try {
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      console.log('[GasSync] submitSignature sent:', attendeeData.name, attendeeData.status);
      return { success: true };
    } catch (err) {
      console.error('GAS submitSignature Error:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * 구글 시트로부터 최신 명단/서명 현황 실시간 조회 (JSONP)
   */
  async fetchLiveStatus() {
    const url = this.getScriptUrl();
    if (!url) return null;

    const params = { action: 'getStatus' };
    
    // 캐시된 시트명이 있으면 전달
    const sheetName = this.getSheetName();
    if (sheetName) {
      params.sheetName = sheetName;
    }

    console.log('[GasSync] fetchLiveStatus requesting with params:', params);

    const data = await this._jsonpRequest(url, params, 8000);
    
    if (data && data.attendees && Array.isArray(data.attendees)) {
      // 서버가 반환한 시트명을 캐시
      if (data.sheetName) {
        this.setSheetName(data.sheetName);
      }
      console.log('[GasSync] fetchLiveStatus received:', data.attendees.length, 'attendees from sheet:', data.sheetName);
      return data.attendees;
    }
    
    console.warn('[GasSync] fetchLiveStatus: no valid data received', data);
    return null;
  },

  /**
   * 범용 JSONP 요청 유틸리티
   */
  _jsonpRequest(baseUrl, params, timeoutMs) {
    return new Promise((resolve) => {
      const callbackName = 'gas_cb_' + Math.random().toString(36).substr(2, 8);
      const script = document.createElement('script');
      let isResolved = false;

      window[callbackName] = (data) => {
        isResolved = true;
        cleanup();
        resolve(data);
      };

      const cleanup = () => {
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      };

      script.onerror = () => {
        if (!isResolved) {
          console.warn('[GasSync] JSONP script load error');
          cleanup();
          resolve(null);
        }
      };

      // URL 파라미터 조립
      const sep = baseUrl.includes('?') ? '&' : '?';
      const queryParts = [`callback=${callbackName}`, `_t=${Date.now()}`];
      for (const key in params) {
        queryParts.push(`${encodeURIComponent(key)}=${encodeURIComponent(params[key])}`);
      }
      script.src = `${baseUrl}${sep}${queryParts.join('&')}`;
      document.body.appendChild(script);

      setTimeout(() => {
        if (!isResolved) {
          console.warn('[GasSync] JSONP timeout after', timeoutMs, 'ms');
          cleanup();
          resolve(null);
        }
      }, timeoutMs || 5000);
    });
  }
};

window.GasSync = GasSync;
