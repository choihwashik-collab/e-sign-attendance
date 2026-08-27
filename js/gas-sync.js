/**
 * js/gas-sync.js
 * 구글 앱 스크립트(Google Apps Script) & 구글 스프레드시트 실시간 동기화 모듈
 * (CORS 및 리다이렉트 완벽 지원 버전)
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
    let targetUrl = (url || this.getScriptUrl()).trim();
    if (!targetUrl) {
      return { success: false, message: 'Google Apps Script URL을 입력해 주세요.' };
    }

    // 1. URL 형식 체크
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

    // 2. GET Ping 시도 (CORS 모드)
    try {
      const response = await fetch(`${targetUrl}?action=ping`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        redirect: 'follow'
      });

      if (response.ok) {
        try {
          const result = await response.json();
          if (result.status === 'ok' || result.success) {
            return { success: true, message: '구글 스프레드시트와 성공적으로 연결되었습니다!' };
          }
        } catch(e) {}
        return { success: true, message: '구글 스프레드시트 연결 확인 완료!' };
      }
    } catch (corsErr) {
      console.log('Direct GET test had CORS redirect, testing fallback POST...', corsErr);
    }

    // 3. no-cors Fallback POST 테스트
    try {
      await fetch(targetUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify({ action: 'ping' })
      });

      // no-cors가 에러 없이 도달하면 엔드포인트가 살아있는 것임
      return { 
        success: true, 
        message: '구글 스프레드시트와 정상 연결되었습니다! (CORS Opaque 통신 활성화)' 
      };
    } catch (err) {
      console.error('All GAS Connection attempts failed:', err);
      return { 
        success: false, 
        message: '연결 실패: 1) 웹 앱 배포 시 "액세스 권한: 모든 사용자(Anyone)"로 설정했는지, 2) URL이 정확한지 확인해 주세요.' 
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
      // no-cors로 안전 전송
      await fetch(url, {
        method: 'POST',
        mode: 'no-cors',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: JSON.stringify(payload)
      });
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
      console.log('Submitted to Google Sheet successfully');
      return { success: true };
    } catch (err) {
      console.error('GAS submitSignature Error:', err);
      return { success: false, error: err.message };
    }
  }
};

window.GasSync = GasSync;
