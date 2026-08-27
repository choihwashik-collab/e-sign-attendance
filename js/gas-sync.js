/**
 * js/gas-sync.js
 * 구글 앱 스크립트(Google Apps Script) & 구글 스프레드시트 실시간 동기화 모듈
 */

const GasSync = {
  getScriptUrl() {
    return localStorage.getItem('eSign_gasUrl') || '';
  },

  setScriptUrl(url) {
    localStorage.setItem('eSign_gasUrl', url.trim());
  },

  /**
   * 구글 앱 스크립트 웹앱 연결 테스트
   */
  async testConnection(url) {
    const targetUrl = url || this.getScriptUrl();
    if (!targetUrl) {
      return { success: false, message: 'Google Apps Script URL이 설정되지 않았습니다.' };
    }

    try {
      const response = await fetch(`${targetUrl}?action=ping`, {
        method: 'GET',
        mode: 'cors'
      });
      const result = await response.json();
      if (result.status === 'ok' || result.success) {
        return { success: true, message: '구글 스프레드시트와 성공적으로 연결되었습니다!' };
      }
      return { success: false, message: result.message || '응답 형식이 올바르지 않습니다.' };
    } catch (err) {
      console.warn('GAS Direct Ping Failed (CORS or offline), testing fallback...', err);
      // JSONP나 CORS no-cors 시도 또는 안내
      return { 
        success: false, 
        message: '연결 실패: URL이 정확한지 확인하고, Apps Script 배포 시 액세스 권한을 "모든 사용자(Anyone)"로 설정했는지 확인하세요.' 
      };
    }
  },

  /**
   * 연수 세션 및 초기 명단 시트에 저장
   */
  async syncInitialRoster(sessionData, attendees) {
    const url = this.getScriptUrl();
    if (!url) return { success: false, message: 'GAS URL 미설정 (로컬 저장만 적용)' };

    try {
      const payload = {
        action: 'initSession',
        session: sessionData,
        attendees: attendees.map(a => ({
          id: a.id,
          department: a.department,
          name: a.name,
          position: a.position,
          isSigned: a.isSigned,
          signedAt: a.signedAt || ''
        }))
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      return await response.json();
    } catch (err) {
      console.error('GAS initSession Error:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * 개별 참여자 서명 데이터 구글 시트에 실시간 전송
   */
  async submitSignature(sessionId, attendeeData) {
    const url = this.getScriptUrl();
    if (!url) return { success: false, message: '로컬에만 저장되었습니다.' };

    try {
      const payload = {
        action: 'submitSignature',
        sessionId: sessionId,
        attendee: {
          id: attendeeData.id,
          department: attendeeData.department,
          name: attendeeData.name,
          position: attendeeData.position,
          signedAt: attendeeData.signedAt,
          signatureData: attendeeData.signatureData,
          ip: attendeeData.ip || ''
        }
      };

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
      return await response.json();
    } catch (err) {
      console.error('GAS submitSignature Error:', err);
      return { success: false, error: err.message };
    }
  },

  /**
   * 구글 시트로부터 최신 서명 현황 조회
   */
  async fetchLiveStatus(sessionId) {
    const url = this.getScriptUrl();
    if (!url) return null;

    try {
      const response = await fetch(`${url}?action=getStatus&sessionId=${encodeURIComponent(sessionId)}`, {
        method: 'GET',
        mode: 'cors'
      });
      return await response.json();
    } catch (err) {
      console.warn('GAS fetchLiveStatus Error:', err);
      return null;
    }
  }
};

window.GasSync = GasSync;
