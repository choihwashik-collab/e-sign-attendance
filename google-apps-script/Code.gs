/** Google Apps Script backend for E-Sign Attendance (v7). */
var REGISTRY_SHEET = '_eSignBundles';
var ATTENDANCE_HEADERS = ['참석자ID', '소속(부서)', '직급', '성명', '출석/서명상태', '비고', '서명데이터', '서명시각'];
var REGISTRY_HEADERS = ['묶음ID', '묶음명', '생성일', '연수목록JSON', '장소', '주관', '확인부서', '확인자', '결재란표시', '결재단계JSON', '출석시트ID'];

function doGet(e) {
  try {
    var params = e && e.parameter ? e.parameter : {};
    var action = params.action || 'ping';
    if (action === 'ping') return jsonResponse({ success: true, message: '구글 스프레드시트 연결 성공!' }, params.callback);
    if (action === 'listBundles') {
      return jsonResponse({ success: true, bundles: listBundles_() }, params.callback);
    }
    if (action === 'getBundle' || action === 'getStatus') {
      var bundle = readBundle_(params.bundleId, params.sheetName);
      return jsonResponse(bundle ? { success: true, bundle: bundle, attendees: bundle.attendees } : { success: false, message: '연수 묶음을 찾을 수 없습니다.' }, params.callback);
    }
    return jsonResponse({ success: false, message: '알 수 없는 요청입니다.' }, params.callback);
  } catch (error) {
    return jsonResponse({ success: false, error: String(error) }, e && e.parameter && e.parameter.callback);
  }
}

function doPost(e) {
  var lock = LockService.getDocumentLock();
  try {
    lock.waitLock(30000);
    var payload = JSON.parse(e.postData.contents || '{}');
    if (payload.action === 'initBundle' || payload.action === 'initSession') {
      var legacyBundle = payload.bundle || payload.session;
      if (!legacyBundle) throw new Error('연수 묶음 정보가 없습니다.');
      if (payload.attendees && !legacyBundle.attendees) legacyBundle.attendees = payload.attendees;
      saveBundle_(legacyBundle);
      return jsonResponse({ success: true, message: '연수 묶음과 명단을 저장했습니다.' });
    }
    if (payload.action === 'submitAttendee' || payload.action === 'submitSignature') {
      saveAttendee_(payload.bundleId || payload.sessionId, payload.bundle, payload.attendee);
      return jsonResponse({ success: true, message: '출석 상태를 저장했습니다.' });
    }
    if (payload.action === 'deleteBundle') {
      deleteBundle_(payload.bundleId);
      return jsonResponse({ success: true, message: '연수 묶음을 삭제했습니다.' });
    }
    return jsonResponse({ success: false, message: '알 수 없는 요청입니다.' });
  } catch (error) {
    return jsonResponse({ success: false, error: String(error) });
  } finally {
    try { lock.releaseLock(); } catch (ignore) {}
  }
}

function saveBundle_(bundle) {
  if (!bundle || !bundle.id) throw new Error('묶음 ID가 없습니다.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var registry = getRegistry_(ss);
  var registryRow = findRegistryRow_(registry, bundle.id);
  var sheet = registryRow ? ss.getSheetById(Number(registry.getRange(registryRow, 11).getValue())) : null;
  if (!sheet) sheet = ss.insertSheet(makeSheetName_(bundle));

  sheet.clear();
  sheet.getRange(1, 1, 1, ATTENDANCE_HEADERS.length).setValues([ATTENDANCE_HEADERS]).setFontWeight('bold').setBackground('#f3f4f6');
  var attendees = bundle.attendees || [];
  if (attendees.length) {
    var rows = attendees.map(function(a) { return attendeeRow_(a); });
    sheet.getRange(2, 1, rows.length, ATTENDANCE_HEADERS.length).setValues(rows);
  }
  sheet.setFrozenRows(1);
  sheet.hideColumns(7);
  upsertRegistry_(registry, registryRow, bundle, sheet.getSheetId());
}

function saveAttendee_(bundleId, bundleMetadata, attendee) {
  if (!bundleId || !attendee) throw new Error('묶음 ID 또는 참석자 정보가 없습니다.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var registry = getRegistry_(ss);
  var registryRow = findRegistryRow_(registry, bundleId);
  if (!registryRow) {
    var initial = bundleMetadata || { id: bundleId, name: '연수 출석부', sessions: [] };
    initial.id = bundleId;
    initial.attendees = [attendee];
    saveBundle_(initial);
    return;
  }
  if (bundleMetadata) upsertRegistry_(registry, registryRow, bundleMetadata, registry.getRange(registryRow, 11).getValue());
  var sheet = ss.getSheetById(Number(registry.getRange(registryRow, 11).getValue()));
  if (!sheet) throw new Error('출석 시트를 찾을 수 없습니다.');
  var values = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues() : [];
  var targetRow = -1;
  for (var i = 0; i < values.length; i++) {
    if ((attendee.id && values[i][0] === attendee.id) || (!attendee.id && values[i][1] === attendee.department && values[i][3] === attendee.name)) {
      targetRow = i + 2;
      break;
    }
  }
  if (targetRow < 0) targetRow = sheet.getLastRow() + 1;
  sheet.getRange(targetRow, 1, 1, ATTENDANCE_HEADERS.length).setValues([attendeeRow_(attendee)]);
}

function readBundle_(bundleId, legacySheetName) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var registry = getRegistry_(ss);
  var row = bundleId ? findRegistryRow_(registry, bundleId) : -1;
  if (row < 0 && legacySheetName) {
    var candidate = ss.getSheetByName(legacySheetName);
    if (candidate) return readLegacyBundle_(candidate, bundleId);
  }
  if (row < 0) return null;
  var meta = registry.getRange(row, 1, 1, REGISTRY_HEADERS.length).getValues()[0];
  var sheet = ss.getSheetById(Number(meta[10]));
  var attendees = [];
  if (sheet && sheet.getLastRow() > 1) {
    var data = sheet.getRange(2, 1, sheet.getLastRow() - 1, ATTENDANCE_HEADERS.length).getValues();
    attendees = data.filter(function(r) { return r[0] || r[3]; }).map(function(r) {
      var status = r[4] || '미서명';
      return { id: r[0] || newId_('att'), department: r[1] || '', position: r[2] || '', name: r[3] || '', status: status,
        note: r[5] || '', signatureData: r[6] || null, signedAt: dateString_(r[7]), isSigned: status === '출석' || status === '서명완료' };
    });
  }
  return { id: meta[0], name: meta[1], createdAt: dateString_(meta[2]), sessions: parseJson_(meta[3], []), location: meta[4] || '',
    organizer: meta[5] || '', verifierDept: meta[6] || '', verifierName: meta[7] || '', showApprovalBox: meta[8] === true || meta[8] === 'TRUE',
    approvalStages: parseJson_(meta[9], ['담당', '확인', '부서장']), attendees: attendees };
}

function listBundles_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var registry = getRegistry_(ss);
  if (registry.getLastRow() < 2) return [];
  var ids = registry.getRange(2, 1, registry.getLastRow() - 1, 1).getValues();
  var bundles = [];
  for (var i = 0; i < ids.length; i++) {
    if (!ids[i][0]) continue;
    var bundle = readBundle_(String(ids[i][0]));
    if (bundle) bundles.push(bundle);
  }
  bundles.sort(function(a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  return bundles;
}

function deleteBundle_(bundleId) {
  if (!bundleId) throw new Error('삭제할 묶음 ID가 없습니다.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var registry = getRegistry_(ss);
  var row = findRegistryRow_(registry, bundleId);
  if (row < 0) return;
  var sheetId = Number(registry.getRange(row, 11).getValue());
  var sheet = ss.getSheetById(sheetId);
  if (sheet && ss.getSheets().length > 1) ss.deleteSheet(sheet);
  registry.deleteRow(row);
}

function readLegacyBundle_(sheet, bundleId) {
  var data = sheet.getDataRange().getValues();
  var attendees = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][3]) continue;
    var status = data[i][4] || '미서명';
    attendees.push({ id: newId_('att'), department: data[i][1] || '', position: data[i][2] || '', name: data[i][3], status: status,
      note: data[i][5] || '', signatureData: null, signedAt: null, isSigned: status === '출석' || status === '서명완료' });
  }
  return { id: bundleId || newId_('bundle'), name: sheet.getName(), createdAt: new Date().toISOString(), sessions: [{ id: newId_('sess'), title: sheet.getName(), date: '' }], attendees: attendees };
}

function getRegistry_(ss) {
  var sheet = ss.getSheetByName(REGISTRY_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(REGISTRY_SHEET);
    sheet.getRange(1, 1, 1, REGISTRY_HEADERS.length).setValues([REGISTRY_HEADERS]).setFontWeight('bold').setBackground('#dbeafe');
    sheet.setFrozenRows(1);
    sheet.hideSheet();
  }
  return sheet;
}

function findRegistryRow_(sheet, bundleId) {
  if (!bundleId || sheet.getLastRow() < 2) return -1;
  var finder = sheet.getRange(2, 1, sheet.getLastRow() - 1, 1).createTextFinder(String(bundleId)).matchEntireCell(true).findNext();
  return finder ? finder.getRow() : -1;
}

function upsertRegistry_(registry, row, bundle, sheetId) {
  var values = [[bundle.id, bundle.name || '연수 출석부', bundle.createdAt || new Date().toISOString(), JSON.stringify(bundle.sessions || []),
    bundle.location || '', bundle.organizer || '', bundle.verifierDept || '', bundle.verifierName || '', !!bundle.showApprovalBox,
    JSON.stringify(bundle.approvalStages || ['담당', '확인', '부서장']), Number(sheetId)]];
  registry.getRange(row > 0 ? row : registry.getLastRow() + 1, 1, 1, REGISTRY_HEADERS.length).setValues(values);
}

function attendeeRow_(a) {
  var signature = a.signatureData || '';
  if (signature.length > 49000) throw new Error(a.name + '님의 서명 데이터가 너무 큽니다.');
  return [a.id || newId_('att'), a.department || '', a.position || '', a.name || '', a.status || (a.isSigned ? '출석' : '미서명'),
    a.note || '', signature, a.signedAt || ''];
}

function makeSheetName_(bundle) {
  var base = String(bundle.name || '연수출석부').replace(/[\\\/\?\*\[\]:]/g, '_').substring(0, 18);
  var suffix = String(bundle.id).replace(/[^a-zA-Z0-9]/g, '').slice(-8);
  return (base + '_' + suffix).substring(0, 30);
}

function cleanupOldSheets() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var registry = getRegistry_(ss);
    if (registry.getLastRow() < 2) return;
    var rows = registry.getRange(2, 1, registry.getLastRow() - 1, REGISTRY_HEADERS.length).getValues();
    var cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 30);
    for (var i = rows.length - 1; i >= 0; i--) {
      var created = new Date(rows[i][2]);
      if (!isNaN(created.getTime()) && created < cutoff) {
        var sheet = ss.getSheetById(Number(rows[i][10]));
        if (sheet && ss.getSheets().length > 1) ss.deleteSheet(sheet);
        registry.deleteRow(i + 2);
      }
    }
  } finally { lock.releaseLock(); }
}

function setupCleanupTrigger() {
  ScriptApp.getProjectTriggers().filter(function(t) { return t.getHandlerFunction() === 'cleanupOldSheets'; }).forEach(function(t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('cleanupOldSheets').timeBased().everyDays(1).atHour(2).create();
}

function parseJson_(value, fallback) { try { return JSON.parse(value || ''); } catch (e) { return fallback; } }
function dateString_(value) { return value instanceof Date ? value.toISOString() : (value ? String(value) : null); }
function newId_(prefix) { return prefix + '_' + new Date().getTime() + '_' + Math.floor(Math.random() * 100000); }
function jsonResponse(obj, callback) {
  var body = callback ? callback + '(' + JSON.stringify(obj) + ')' : JSON.stringify(obj);
  return ContentService.createTextOutput(body).setMimeType(callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

// Compatibility alias used by older deployments.
function createJsonResponse(obj, callback) { return jsonResponse(obj, callback); }
