/**
 * Google Apps Script - 연수 전자 서명 및 출석부 데이터베이스 API
 * (v5: 모바일↔PC 동기화 완벽 지원 - 시트 자동 검색 로직 개선)
 */

function doGet(e) {
  var params = e ? e.parameter : {};
  var action = params.action || 'ping';
  var callback = params.callback;
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (action === 'ping') {
    return createJsonResponse({ status: 'ok', success: true, message: '구글 스프레드시트 연결 성공!' }, callback);
  }

  if (action === 'getStatus') {
    // 시트 찾기: sheetName 파라미터 우선 → 없으면 데이터가 있는 출석 시트 자동 검색
    var sheet = findAttendanceSheet(ss, params.sheetName);
    
    if (!sheet) {
      return createJsonResponse({ status: 'ok', attendees: [], message: '출석 데이터가 있는 시트를 찾을 수 없습니다.' }, callback);
    }

    var data = sheet.getDataRange().getValues();
    var attendees = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0] && !row[3]) continue; // 연번과 이름 모두 없으면 스킵
      attendees.push({
        department: row[1] || '',
        position: row[2] || '',
        name: row[3] || '',
        status: row[4] || '미서명',
        isSigned: row[4] === '출석' || row[4] === '서명완료',
        note: row[5] || ''
      });
    }
    return createJsonResponse({ 
      status: 'ok', 
      attendees: attendees,
      sheetName: sheet.getName(),
      totalCount: attendees.length
    }, callback);
  }

  return createJsonResponse({ status: 'unknown_action' }, callback);
}

function doPost(e) {
  try {
    var rawData = e.postData.contents;
    var payload = JSON.parse(rawData);
    var action = payload.action;
    var ss = SpreadsheetApp.getActiveSpreadsheet();

    if (action === 'initSession') {
      var session = payload.session;
      var attendees = payload.attendees || [];
      var sheetName = session.title ? session.title.substring(0, 30) : '연수출석부';
      
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
      } else {
        sheet.clear();
      }

      // 1행: 헤더
      var header = ['연번', '소속(부서)', '직급', '성명', '출석/서명상태', '비고', '서명데이터'];
      sheet.appendRow(header);
      sheet.getRange(1, 1, 1, header.length).setBackground('#f3f4f6').setFontWeight('bold').setHorizontalAlignment('center');

      // 참석자 데이터 채우기
      var rows = [];
      for (var i = 0; i < attendees.length; i++) {
        var a = attendees[i];
        var statusStr = a.status || (a.isSigned ? '서명완료' : '미서명');
        rows.push([
          i + 1,
          a.department || '',
          a.position || '',
          a.name || '',
          statusStr,
          a.note || '',
          ''
        ]);
      }

      if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
      }

      for (var c = 1; c <= header.length; c++) {
        sheet.autoResizeColumn(c);
      }

      // 이 시트를 활성 시트로 설정 (getStatus에서 fallback으로 찾을 수 있도록)
      ss.setActiveSheet(sheet);

      return createJsonResponse({ 
        success: true, 
        message: '명단 초기화 완료', 
        totalCount: attendees.length,
        sheetName: sheetName
      });
    }

    if (action === 'submitSignature') {
      var attendee = payload.attendee;
      var requestedSheetName = payload.sheetName;
      
      // 시트 찾기: 요청된 시트명 → 출석 데이터 시트 자동 검색
      var sheet = findAttendanceSheet(ss, requestedSheetName);
      
      if (!sheet) {
        // 시트가 없으면 새로 만들기 (최초 모바일 서명 시)
        var newSheetName = requestedSheetName || '연수출석부';
        sheet = ss.getSheetByName(newSheetName);
        if (!sheet) {
          sheet = ss.insertSheet(newSheetName);
          var header = ['연번', '소속(부서)', '직급', '성명', '출석/서명상태', '비고', '서명데이터'];
          sheet.appendRow(header);
          sheet.getRange(1, 1, 1, header.length).setBackground('#f3f4f6').setFontWeight('bold').setHorizontalAlignment('center');
        }
      }
      
      var data = sheet.getDataRange().getValues();

      var foundRow = -1;
      for (var r = 1; r < data.length; r++) {
        if (data[r][3] === attendee.name && (data[r][1] === attendee.department || !attendee.department)) {
          foundRow = r + 1; // 1-indexed
          break;
        }
      }

      var currentStatus = attendee.status || (attendee.isSigned ? '출석' : '미서명');

      if (foundRow !== -1) {
        sheet.getRange(foundRow, 5).setValue(currentStatus);
        if (attendee.note) {
          sheet.getRange(foundRow, 6).setValue(attendee.note);
        }
        if (attendee.signatureData) {
          sheet.getRange(foundRow, 7).setValue(attendee.signatureData.substring(0, 500) + '...(서명데이터)');
        }
      } else {
        var newRowIndex = sheet.getLastRow() + 1;
        sheet.appendRow([
          newRowIndex - 1,
          attendee.department || '현장참석',
          attendee.position || '참석자',
          attendee.name,
          currentStatus,
          attendee.note || '',
          attendee.signatureData ? attendee.signatureData.substring(0, 500) + '...(서명데이터)' : ''
        ]);
      }

      return createJsonResponse({ success: true, message: attendee.name + ' 님의 상태(' + currentStatus + ')가 기록되었습니다.' });
    }

    return createJsonResponse({ success: false, message: '알 수 없는 요청입니다.' });
  } catch (error) {
    return createJsonResponse({ success: false, error: error.toString() });
  }
}

/**
 * 출석 데이터가 있는 시트를 자동으로 찾아 반환
 * 1) sheetName 파라미터로 직접 검색
 * 2) 모든 시트를 순회하며 헤더 패턴(연번, 소속, 직급, 성명) 매칭
 * 3) 마지막 시트(가장 최근 생성) fallback
 */
function findAttendanceSheet(ss, sheetName) {
  // 1) 이름으로 직접 검색
  if (sheetName) {
    var directSheet = ss.getSheetByName(sheetName);
    if (directSheet) return directSheet;
  }

  // 2) 헤더 패턴으로 자동 검색 (가장 최근 생성된 출석 시트)
  var allSheets = ss.getSheets();
  var attendanceSheets = [];
  
  for (var i = 0; i < allSheets.length; i++) {
    var s = allSheets[i];
    if (s.getLastRow() < 2) continue; // 데이터 없는 시트 스킵
    
    try {
      var headerRow = s.getRange(1, 1, 1, 4).getValues()[0];
      // 헤더가 '연번', '소속(부서)', '직급', '성명' 패턴인지 확인
      if (headerRow[0] === '연번' && headerRow[3] === '성명') {
        attendanceSheets.push(s);
      }
    } catch (e) {
      // 빈 시트 등 오류 무시
    }
  }

  if (attendanceSheets.length > 0) {
    // 가장 마지막 (최근 생성된) 출석 시트 반환
    return attendanceSheets[attendanceSheets.length - 1];
  }

  // 3) 아무것도 못 찾으면 null
  return null;
}

function createJsonResponse(obj, callback) {
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + JSON.stringify(obj) + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
