/**
 * Google Apps Script - 연수 전자 서명 및 출석부 데이터베이스 API
 * (사용자 수정사항: 서명시간 제외, 출장/연가 상태 기록, 확인자 정보 지원)
 */

function doGet(e) {
  var params = e ? e.parameter : {};
  var action = params.action || 'ping';
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  if (action === 'ping') {
    return createJsonResponse({ status: 'ok', success: true, message: 'Google Apps Script 연결 성공' });
  }

  if (action === 'getStatus') {
    var sessionId = params.sessionId;
    var sheet = ss.getSheetByName(sessionId) || ss.getActiveSheet();
    var data = sheet.getDataRange().getValues();
    var attendees = [];

    // 헤더(1행) 제외하고 파싱
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (!row[0]) continue;
      attendees.push({
        department: row[1],
        position: row[2],
        name: row[3],
        status: row[4],
        isSigned: row[4] === '출석' || row[4] === '서명완료',
        note: row[5]
      });
    }
    return createJsonResponse({ status: 'ok', attendees: attendees });
  }

  return createJsonResponse({ status: 'unknown_action' });
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

      // 1행: 헤더 (서명시간 제외, 상태 및 비고 중심)
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

      return createJsonResponse({ success: true, message: '명단 초기화 완료', totalCount: attendees.length });
    }

    if (action === 'submitSignature') {
      var attendee = payload.attendee;
      var sheet = ss.getActiveSheet();
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

function createJsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
