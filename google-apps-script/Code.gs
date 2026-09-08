/** E-Sign v9: authenticated writes/reads, scoped invitations, checked receipts. */
var REGISTRY_SHEET = '_eSignBundles';
var ATTENDANCE_HEADERS = ['참석자ID', '소속(부서)', '직급', '성명', '출석/서명상태', '비고', '서명데이터', '서명시각'];
var REGISTRY_HEADERS = ['묶음ID', '묶음명', '생성일', '연수목록JSON', '장소', '주관', '확인부서', '확인자', '결재란표시', '결재단계JSON', '출석시트ID'];
var API_VERSION = 9;

function doGet(e) {
  var p = e && e.parameter || {};
  if (p.action === 'ping') return jsonResponse({success:true, apiVersion:API_VERSION}, p.callback);
  // Only an unguessable, short-lived receipt capability is accepted in a URL.
  // Administrator/invitation credentials are sent in POST bodies, never query strings.
  if (p.action === 'receipt' && /^[a-f0-9]{64}$/.test(p.requestId || '')) {
    var suffix = p.part === undefined ? 'meta' : (/^\d{1,3}$/.test(p.part) ? p.part : 'invalid');
    var cached = CacheService.getScriptCache().get('r:' + p.requestId + ':' + suffix);
    return jsonResponse(cached ? JSON.parse(cached) : {pending:true}, p.callback);
  }
  return jsonResponse({success:false, message:'인증된 v9 요청이 필요합니다.'}, p.callback);
}

function doPost(e) {
  var p, lock = LockService.getScriptLock(), locked = false;
  try {
    if (!e || !e.postData || e.postData.contents.length > 4000000) throw new Error('요청 크기를 초과했습니다.');
    p = JSON.parse(e.postData.contents);
    if (!/^[a-f0-9]{64}$/.test(p.requestId || '')) throw new Error('잘못된 요청 번호입니다.');
    var admin = isAdmin_(p.adminKey);
    if (!admin) requireInvitation_(p.bundleId, p.token);
    lock.waitLock(20000); locked = true;
    if (!admin) requireInvitation_(p.bundleId, p.token); // Recheck expiry/revocation after lock acquisition.
    // Retries with the same request number cannot repeat a mutation during receipt lifetime.
    var cached = CacheService.getScriptCache().get('r:' + p.requestId + ':meta');
    if (cached) return jsonResponse({accepted:true});
    var result = dispatch_(p, admin);
    storeReceipt_(p.requestId, result);
    return jsonResponse({accepted:true});
  } catch (error) {
    if (p && /^[a-f0-9]{64}$/.test(p.requestId || '')) {
      storeReceipt_(p.requestId, {success:false, message:error.message || '처리 실패'});
    }
    return jsonResponse({accepted:false});
  } finally { if (locked) lock.releaseLock(); }
}

function isAdmin_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  return typeof key === 'string' && !!expected && expected.length >= 32 && secureEqual_(key, expected);
}
function secureEqual_(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  var ha = hash_(a), hb = hash_(b), diff = 0;
  for (var i=0;i<ha.length;i++) diff |= ha.charCodeAt(i) ^ hb.charCodeAt(i);
  return diff === 0;
}
function hash_(s) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8)
    .map(function(b){return ('0' + ((b+256)%256).toString(16)).slice(-2);}).join('');
}
function control_(id) {
  return parseJson_(PropertiesService.getScriptProperties().getProperty('bundle_' + id), {revision:0});
}
function setControl_(id, value) {
  PropertiesService.getScriptProperties().setProperty('bundle_' + id, JSON.stringify(value));
}
function requireInvitation_(id, token) {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id || '') || typeof token !== 'string' || token.length !== 64) throw new Error('관리자 인증 또는 유효한 초대 링크가 필요합니다.');
  var c = control_(id);
  if (!c.tokenHash || c.expiresAt <= Date.now() || !secureEqual_(hash_(token), c.tokenHash)) throw new Error('초대 링크가 만료되었거나 종료되었습니다. 진행자에게 새 QR을 요청하세요.');
}
function checkRevision_(bundle, expected) {
  if (bundle && control_(bundle.id).revision !== expected) throw new Error('다른 기기에서 변경되었습니다. 최신 자료를 불러온 뒤 다시 수정하세요.');
}
function bump_(id) {
  var c = control_(id); c.revision = (c.revision || 0) + 1; setControl_(id, c);
}
function bundleView_(bundle, admin) {
  if (!bundle) return null;
  bundle.revision = control_(bundle.id).revision || 0;
  if (admin) return bundle;
  return {id:bundle.id, name:bundle.name, sessions:bundle.sessions, createdAt:bundle.createdAt, revision:bundle.revision,
    attendees:bundle.attendees.map(function(a){
      return {id:a.id, department:a.department, name:a.name, isSigned:a.isSigned,
        status:a.isSigned ? '서명완료' : (a.signedAt ? '처리완료' : '미서명'), signedAt:a.signedAt || null};
    })};
}

function dispatch_(p, admin) {
  if (['listRosters','saveRoster','deleteRoster'].indexOf(p.action)>=0) {
    if (!admin) throw new Error('기본명단은 관리자만 관리할 수 있습니다.');
    return rosterAction_(p);
  }
  if (p.action === 'login') {
    if (!admin) throw new Error('관리자 키가 올바르지 않습니다.');
    return {success:true, apiVersion:API_VERSION};
  }
  if (p.action === 'listBundles') {
    if (!admin) throw new Error('관리자 전용 요청입니다.');
    return {success:true, bundles:listBundles_().map(function(b){
      return {id:b.id,name:b.name,sessions:b.sessions,createdAt:b.createdAt,attendees:[],revision:control_(b.id).revision || 0,summary:true};
    })};
  }
  var id = p.bundleId || (p.bundle && p.bundle.id);
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id || '')) throw new Error('묶음 ID가 올바르지 않습니다.');
  var bundle = readBundle_(id);
  if (p.action === 'getBundle') {
    if (!bundle) throw new Error('연수 묶음을 찾을 수 없습니다.');
    return {success:true,bundle:bundleView_(bundle,admin)};
  }
  if (p.action === 'initBundle') {
    if (!admin) throw new Error('관리자 전용 요청입니다.');
    checkRevision_(bundle, p.expectedRevision);
    var clean = validateBundle_(p.bundle, bundle);
    // Roster/metadata writes never overwrite existing attendance or signatures.
    if (bundle) {
      clean.createdAt = bundle.createdAt;
      clean.attendees = clean.attendees.map(function(a){
        var prior = bundle.attendees.find(function(b){return a.id === b.id;});
        if (prior) { a.status=prior.status; a.signatureData=prior.signatureData; a.signedAt=prior.signedAt; a.isSigned=prior.isSigned; a.note=prior.note; }
        return a;
      });
    } else clean.createdAt = new Date().toISOString();
    saveBundle_(clean); bump_(id);
    return {success:true,bundle:bundleView_(readBundle_(id),true)};
  }
  if (!bundle) throw new Error('연수 묶음을 찾을 수 없습니다. 삭제된 묶음은 자동 복원하지 않습니다.');
  if (p.action === 'shareBundle' || p.action === 'closeSharing') {
    if (!admin) throw new Error('관리자 전용 요청입니다.');
    var c = control_(id);
    if (p.action === 'closeSharing') { delete c.tokenHash; c.expiresAt=0; setControl_(id,c); return {success:true}; }
    var token = Utilities.getUuid().replace(/-/g,'') + Utilities.getUuid().replace(/-/g,'');
    c.tokenHash=hash_(token); c.expiresAt=Date.now()+24*60*60*1000; setControl_(id,c);
    return {success:true,token:token,expiresAt:c.expiresAt};
  }
  if (p.action === 'deleteBundle') {
    if (!admin) throw new Error('관리자 전용 요청입니다.');
    checkRevision_(bundle,p.expectedRevision); deleteBundle_(id); return {success:true};
  }
  if (p.action === 'submitAttendee') {
    if (!admin) throw new Error('현장 명단 추가와 출결 변경은 진행자만 가능합니다.');
    checkRevision_(bundle,p.expectedRevision);
    var incoming=validateAttendee_(p.attendee), existing=bundle.attendees.find(function(a){return a.id===incoming.id;});
    if (!existing) throw new Error('등록된 참석자를 찾을 수 없습니다.');
    incoming.signatureData = incoming.status === '출석' ? existing.signatureData : null;
    incoming.signedAt = nextTimestamp_(existing.signedAt);
    if(incoming.status!=='출석' && incoming.status!=='미서명') incoming.note=reasonNote_(incoming.status,incoming.note);
    if(incoming.status==='미서명')incoming.note='';
    incoming.isSigned = !!incoming.signatureData;
    saveAttendee_(id,null,incoming); bump_(id);
    return {success:true,bundle:bundleView_(readBundle_(id),true)};
  }
  if (p.action === 'submitSignature' || p.action === 'submitReason') {
    var attendee = bundle.attendees.find(function(a){return a.id === p.attendeeId;});
    if (!attendee) throw new Error('명단에 없는 참석자입니다. 진행자에게 등록을 요청하세요.');
    var signing=p.action==='submitSignature', note='';
    if(signing)validateSignature_(p.signatureData);
    else {
      if(['조퇴','출장','연가','공가','병가','기타 불참'].indexOf(p.status)<0)throw new Error('사유를 선택하세요.');
      note=reasonNote_(p.status,text_(p.note,400,false));
    }
    // Exact retransmissions are harmless; a deliberate correction requires the last seen timestamp.
    if ((signing && attendee.signatureData===p.signatureData && attendee.status==='출석') ||
        (!signing && attendee.status===p.status && attendee.note===note && !attendee.signatureData)) {
      return {success:true,signedAt:attendee.signedAt,revision:control_(id).revision};
    }
    if((p.expectedSignedAt || null)!==(attendee.signedAt || null))throw new Error('다른 기기에서 이 사람의 기록이 변경되었습니다. 명단을 새로 불러온 뒤 다시 선택하세요.');
    attendee.signatureData=signing?p.signatureData:null;
    attendee.status=signing?'출석':p.status; attendee.signedAt=nextTimestamp_(attendee.signedAt); attendee.note=note;
    saveAttendee_(id,null,attendee); bump_(id);
    return {success:true,signedAt:attendee.signedAt,revision:control_(id).revision};
  }
  throw new Error('지원하지 않는 요청입니다.');
}

function nextTimestamp_(prior) {
  return new Date(Math.max(Date.now(),(Date.parse(prior)||0)+1)).toISOString();
}
function reasonNote_(status,note) {
  return note && note!==status && note.indexOf(status+': ')!==0 ? status+': '+note : (note || status);
}

// Basic rosters are kept in a separate sheet and are never expired with attendance bundles.
function rosterAction_(p) {
  var ss=SpreadsheetApp.getActiveSpreadsheet(),sheet=ss.getSheetByName('_eSignRosters');
  if(!sheet) {
    if(p.action==='listRosters')return {success:true,rosters:[]};
    sheet=ss.insertSheet('_eSignRosters');
    sheet.getRange(1,1,1,5).setValues([['명단ID','명단명','버전','수정시각','명단JSON']]);
    sheet.hideSheet();
  }
  var rows=sheet.getLastRow()>1?sheet.getRange(2,1,sheet.getLastRow()-1,5).getValues():[];
  function unpack(r){return {id:r[0],name:r[1],revision:Number(r[2]),updatedAt:dateString_(r[3]),attendees:parseJson_(r[4],[])};}
  if(p.action==='listRosters')return {success:true,rosters:rows.filter(function(r){return !!r[0];}).map(unpack)};
  var id=p.rosterId || (p.roster && p.roster.id);
  if(!/^roster_[a-zA-Z0-9_-]{1,80}$/.test(id || ''))throw new Error('기본명단 ID가 올바르지 않습니다.');
  var index=rows.findIndex(function(r){return r[0]===id;});
  if(index>=0 && Number(rows[index][2])!==p.expectedRevision)throw new Error('다른 기기에서 기본명단이 수정되었습니다. 목록을 새로 불러오세요.');
  if(index<0 && p.expectedRevision!==undefined && p.expectedRevision!==null)throw new Error('삭제된 기본명단입니다. 새로 저장해 주세요.');
  if(p.action==='deleteRoster') {
    if(index<0)throw new Error('기본명단을 찾을 수 없습니다.');
    sheet.deleteRow(index+2);return {success:true};
  }
  if(index<0 && rows.length>=30)throw new Error('기본명단은 최대 30개입니다.');
  var roster=p.roster;
  if(!roster || !Array.isArray(roster.attendees) || roster.attendees.length>200)throw new Error('기본명단은 최대 200명입니다.');
  var people=roster.attendees.map(function(a){return {
    department:text_(a.department,100,false),name:text_(a.name,100,true),position:text_(a.position,100,false)
  };});
  var json=JSON.stringify(people);
  if(json.length>45000)throw new Error('기본명단이 너무 큽니다. 나눠서 저장하세요.');
  var value=[id,cellText_(text_(roster.name,100,true)),index>=0?Number(rows[index][2])+1:1,new Date().toISOString(),json];
  sheet.getRange(index>=0?index+2:sheet.getLastRow()+1,1,1,5).setValues([value]);
  return {success:true,roster:unpack(value)};
}

function text_(v, max, required) {
  if (v === undefined || v === null) v='';
  if (typeof v !== 'string' || v.length > max || (required && !v.trim())) throw new Error('입력 형식 또는 길이를 확인하세요.');
  return v.trim();
}
function cellText_(v) {
  var s=String(v || '');
  return /^[=+@\-\t\r]/.test(s) ? "'" + s : s;
}
function validateSignature_(s) {
  if (typeof s !== 'string' || s.length > 16000 || !/^data:image\/png;base64,iVBORw0KGgo[A-Za-z0-9+/]*={0,2}$/.test(s)) throw new Error('서명 이미지가 올바르지 않거나 너무 큽니다. 지우고 간단히 다시 서명해 주세요.');
}
function validateAttendee_(a) {
  if (!a || !/^[a-zA-Z0-9_-]{1,100}$/.test(a.id || '')) throw new Error('참석자 ID가 올바르지 않습니다.');
  var status=a.status || '미서명';
  if (['미서명','출석','서명완료','출장','연가','공가','병가','조퇴','기타 불참'].indexOf(status)<0) throw new Error('출결 상태가 올바르지 않습니다.');
  return {id:a.id,department:text_(a.department,100,false),name:text_(a.name,100,true),position:text_(a.position,100,false),
    status:status,note:text_(a.note,500,false),signatureData:null,signedAt:null,isSigned:false};
}
function validateBundle_(b, prior) {
  if (!b || !Array.isArray(b.attendees) || b.attendees.length>200 || !Array.isArray(b.sessions) || !b.sessions.length || b.sessions.length>30) throw new Error('묶음은 연수 1~30개, 참석자 최대 200명입니다.');
  var attendees=b.attendees.map(validateAttendee_), ids={};
  attendees.forEach(function(a){if(ids[a.id]) throw new Error('참석자 ID가 중복됩니다.'); ids[a.id]=true;});
  var clean={id:b.id,name:text_(b.name,200,true),createdAt:new Date().toISOString(),attendees:attendees,
    sessions:b.sessions.map(function(s){return {id:text_(s.id,100,true),title:text_(s.title,200,true),date:text_(s.date,30,true)};}),
    location:text_(b.location,200,false),organizer:text_(b.organizer,200,false),verifierDept:text_(b.verifierDept,100,false),verifierName:text_(b.verifierName,100,false),
    showApprovalBox:!!b.showApprovalBox,approvalStages:(Array.isArray(b.approvalStages)?b.approvalStages:[]).slice(0,8).map(function(s){return text_(s,30,true);})};
  // Only NEW roster entries may import a locally saved signature during explicit migration.
  attendees.forEach(function(a,i){
    if(prior && prior.attendees.some(function(old){return old.id===a.id;})) return;
    var src=b.attendees[i];
    if(src.signatureData){validateSignature_(src.signatureData);a.signatureData=src.signatureData;a.signedAt=text_(src.signedAt,40,true);a.isSigned=src.status==='출석'||src.status==='서명완료';}
  });
  return clean;
}
function storeReceipt_(id, result) {
  var body=JSON.stringify(result);
  if(body.length>4000000) body=JSON.stringify({success:false,message:'조회 데이터가 너무 큽니다. 시트에서 백업 후 묶음을 나눠 주세요.'});
  var cache=CacheService.getScriptCache(), chunks=Math.ceil(body.length/18000), entries={};
  for(var i=0;i<chunks;i++) entries['r:'+id+':'+i]=JSON.stringify({part:body.slice(i*18000,(i+1)*18000)});
  cache.putAll(entries,90);
  cache.put('r:'+id+':meta',JSON.stringify({ready:true,parts:chunks}),90);
}
function jsonResponse(obj, callback) {
  var valid=/^gas_cb_[a-f0-9]{32}$/.test(callback || '');
  var body=JSON.stringify(obj).replace(/</g,'\\u003c').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');
  return ContentService.createTextOutput(valid ? callback+'('+body+');' : body)
    .setMimeType(valid ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON);
}

// Run once from the Apps Script editor, then copy ADMIN_KEY from Script Properties.
// Never put the key in the source code, QR, URL, or execution logs.
function initializeSecurity() {
  var p=PropertiesService.getScriptProperties();
  if(!p.getProperty('ADMIN_KEY')) p.setProperty('ADMIN_KEY',Utilities.getUuid().replace(/-/g,'')+Utilities.getUuid().replace(/-/g,''));
  return 'ADMIN_KEY가 준비되었습니다. 프로젝트 설정 > 스크립트 속성에서 확인하세요.';
}

function saveBundle_(bundle) {
  if (!bundle || !bundle.id) throw new Error('묶음 ID가 없습니다.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var registry = getRegistry_(ss);
  var registryRow = findRegistryRow_(registry, bundle.id);
  var sheet = registryRow > 0 ? ss.getSheetById(Number(registry.getRange(registryRow, 11).getValue())) : null;
  var attendees = bundle.attendees || [];
  var rows = attendees.map(function(a) { return attendeeRow_(a); });
  if (!sheet) sheet = ss.insertSheet(makeSheetName_(bundle));

  // Write the new rows before removing surplus rows. All callers hold the script lock.
  var previousLastRow = sheet.getLastRow();
  sheet.getRange(1, 1, 1, ATTENDANCE_HEADERS.length).setValues([ATTENDANCE_HEADERS]).setFontWeight('bold').setBackground('#f3f4f6');
  if (attendees.length) {
    sheet.getRange(2, 1, rows.length, ATTENDANCE_HEADERS.length).setValues(rows);
  }
  if (previousLastRow > rows.length + 1) sheet.getRange(rows.length + 2, 1, previousLastRow - rows.length - 1, ATTENDANCE_HEADERS.length).clearContent();
  sheet.setFrozenRows(1);
  sheet.hideColumns(7);
  upsertRegistry_(registry, registryRow, bundle, sheet.getSheetId());
}

function saveAttendee_(bundleId, bundleMetadata, attendee) {
  if (!bundleId || !attendee) throw new Error('묶음 ID 또는 참석자 정보가 없습니다.');
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var registry = getRegistry_(ss);
  var registryRow = findRegistryRow_(registry, bundleId);
  if (registryRow < 0) {
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
        note: r[5] || '', signatureData: r[6] || null, signedAt: dateString_(r[7]), isSigned: !!r[6] && (status === '출석' || status === '서명완료') };
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
  PropertiesService.getScriptProperties().deleteProperty('bundle_' + bundleId);
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
  var values = [[bundle.id, cellText_(bundle.name || '연수 출석부'), bundle.createdAt || new Date().toISOString(), JSON.stringify(bundle.sessions || []),
    cellText_(bundle.location), cellText_(bundle.organizer), cellText_(bundle.verifierDept), cellText_(bundle.verifierName), !!bundle.showApprovalBox,
    JSON.stringify(bundle.approvalStages || ['담당', '확인', '부서장']), Number(sheetId)]];
  registry.getRange(row > 0 ? row : registry.getLastRow() + 1, 1, 1, REGISTRY_HEADERS.length).setValues(values);
}

function attendeeRow_(a) {
  var signature = a.signatureData || '';
  if (signature.length > 49000) throw new Error(a.name + '님의 서명 데이터가 너무 큽니다.');
  return [a.id || newId_('att'), cellText_(a.department), cellText_(a.position), cellText_(a.name), a.status || '미서명',
    cellText_(a.note), signature, a.signedAt || ''];
}

function makeSheetName_(bundle) {
  var base = String(bundle.name || '연수출석부').replace(/[\\\/\?\*\[\]:]/g, '_').substring(0, 18);
  var suffix = String(bundle.id).replace(/[^a-zA-Z0-9]/g, '').slice(-8);
  return (base + '_' + suffix).substring(0, 30);
}

function cleanupOldSheets() {
  var lock = LockService.getScriptLock();
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
        PropertiesService.getScriptProperties().deleteProperty('bundle_' + rows[i][0]);
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

