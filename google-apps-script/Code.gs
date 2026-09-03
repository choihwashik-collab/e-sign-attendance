/**
 * Google Apps Script - 연수 전자 서명 및 출석부 데이터베이스 API
 * (v6: 연수 묶음 지원, 30일 자동삭제 트리거)
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
    var sheet = findAttendanceSheet(ss, params.sheetName);
    
    if (!sheet) {
      return createJsonResponse({ status: 'ok', attendees: [], message: '출석 데이터가 있는 시트를 찾을 수 없습니다.' }, callback);
    }

    var data = sheet.getDataRange().getValues();
    var attendees = [];

    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0] && !row[3]) continue;
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
      var sheetName = payload.sheetName || (session.title ? session.title.substring(0, 30) : '연수출석부');
      
      var sheet = ss.getSheetByName(sheetName);
      if (!sheet) {
        sheet = ss.insertSheet(sheetName);
      } else {
        sheet.clear();
      }

      var header = ['연번', '소속(부서)', '직급', '성명', '출석/서명상태', '비고', '서명데이터', '생성일'];
      sheet.appendRow(header);
      sheet.getRange(1, 1, 1, header.length).setBackground('#f3f4f6').setFontWeight('bold').setHorizontalAlignment('center');

      var createdAt = new Date().toISOString();
      var rows = [];
      for (var i = 0; i < attendees.length; i++) {
        var a = attendees[i];
        var statusStr = a.status || (a.isSigned ? '서명완료' : '미서명');
        rows.push([
          i + 1, a.department || '', a.position || '', a.name || '',
          statusStr, a.note || '', '', createdAt
        ]);
      }

      if (rows.length > 0) {
        sheet.getRange(2, 1, rows.length, header.length).setValues(rows);
      }

      for (var c = 1; c <= header.length; c++) {
        sheet.autoResizeColumn(c);
      }

      ss.setActiveSheet(sheet);

      return createJsonResponse({ 
        success: true, message: '명단 초기화 완료', 
        totalCount: attendees.length, sheetName: sheetName
      });
    }

    if (action === 'submitSignature') {
      var attendee = payload.attendee;
      var requestedSheetName = payload.sheetName;
      var sheet = findAttendanceSheet(ss, requestedSheetName);
      
      if (!sheet) {
        var newSheetName = requestedSheetName || '연수출석부';
        sheet = ss.getSheetByName(newSheetName);
        if (!sheet) {
          sheet = ss.insertSheet(newSheetName);
          var header = ['연번', '소속(부서)', '직급', '성명', '출석/서명상태', '비고', '서명데이터', '생성일'];
          sheet.appendRow(header);
          sheet.getRange(1, 1, 1, header.length).setBackground('#f3f4f6').setFontWeight('bold').setHorizontalAlignment('center');
        }
      }
      
      var data = sheet.getDataRange().getValues();
      var foundRow = -1;
      for (var r = 1; r < data.length; r++) {
        if (data[r][3] === attendee.name && (data[r][1] === attendee.department || !attendee.department)) {
          foundRow = r + 1;
          break;
        }
      }

      var currentStatus = attendee.status || (attendee.isSigned ? '출석' : '미서명');

      if (foundRow !== -1) {
        sheet.getRange(foundRow, 5).setValue(currentStatus);
        if (attendee.note) sheet.getRange(foundRow, 6).setValue(attendee.note);
        if (attendee.signatureData) {
          sheet.getRange(foundRow, 7).setValue(attendee.signatureData.substring(0, 500) + '...(서명데이터)');
        }
      } else {
        sheet.appendRow([
          sheet.getLastRow(),
          attendee.department || '현장참석', attendee.position || '참석자',
          attendee.name, currentStatus, attendee.note || '',
          attendee.signatureData ? attendee.signatureData.substring(0, 500) + '...(서명데이터)' : '',
          new Date().toISOString()
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
 * 30일 이상 된 출석 시트 자동 삭제
 * [설치 방법] Apps Script 편집기 → 트리거 → + 트리거 추가:
 *   함수: cleanupOldSheets / 이벤트 소스: 시간 기반 / 유형: 매일 타이머 / 시간: 새벽 1~2시
 */
function cleanupOldSheets() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheets = ss.getSheets();
  var cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - 30);
  var deletedCount = 0;

  for (var i = sheets.length - 1; i >= 0; i--) {
    var sheet = sheets[i];
    if (sheet.getLastRow() < 2) continue;
    
    try {
      var headerRow = sheet.getRange(1, 1, 1, 4).getValues()[0];
      if (headerRow[0] !== '연번' || headerRow[3] !== '성명') continue;
      
      // 생성일 컬럼(H열)에서 날짜 확인
      var createdAtCell = sheet.getRange(2, 8).getValue();
      if (!createdAtCell) continue;
      
      var createdDate = new Date(createdAtCell);
      if (isNaN(createdDate.getTime())) continue;
      
      if (createdDate < cutoffDate) {
        var sheetName = sheet.getName();
        ss.deleteSheet(sheet);
        deletedCount++;
        Logger.log('삭제됨: ' + sheetName + ' (생성일: ' + createdDate.toISOString() + ')');
      }
    } catch (e) {
      Logger.log('시트 검사 오류: ' + e.toString());
    }
  }

  Logger.log('자동 정리 완료: ' + deletedCount + '개 시트 삭제');
}

function findAttendanceSheet(ss, sheetName) {
  if (sheetName) {
    var directSheet = ss.getSheetByName(sheetName);
    if (directSheet) return directSheet;
  }

  var allSheets = ss.getSheets();
  var attendanceSheets = [];
  
  for (var i = 0; i < allSheets.length; i++) {
    var s = allSheets[i];
    if (s.getLastRow() < 2) continue;
    try {
      var headerRow = s.getRange(1, 1, 1, 4).getValues()[0];
      if (headerRow[0] === '연번' && headerRow[3] === '성명') {
        attendanceSheets.push(s);
      }
    } catch (e) {}
  }

  if (attendanceSheets.length > 0) {
    return attendanceSheets[attendanceSheets.length - 1];
  }
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
