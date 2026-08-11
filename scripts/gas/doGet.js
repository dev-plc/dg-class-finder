// DGfinder — Google Apps Script 전체 코드 (v19)
//
// 이 파일은 GAS 에디터에 붙여넣는 내용의 사본이다 (버전 관리용).
// 고칠 일이 있으면 여기서 고치고 GAS 로 옮긴 뒤, 반드시 아래 방식으로 재배포한다.
//
//   배포 → 배포 관리 → 기존 배포의 ✏️ → 버전 "새 버전" → 배포
//
// "새 배포" 를 누르면 URL 이 새로 생겨 GitHub Secrets 에 든 옛 URL 이 404 가 난다.
// URL 은 반드시 /exec 로 끝나야 한다. /dev 는 본인만 접근할 수 있어 Actions 에서 404 다.
//
// ---------------------------------------------------------------------------
// 구조: 원본은 시트 하나. DB 는 버려도 되는 사본.
//
//   앱에서 출석 체크 → doPost → ① 시트에 쓴다 (여기까지 됐으면 데이터는 안전)
//                              → ② DB 에 민다 (실패해도 잃는 것이 없다)
//   시트를 사람이 직접 고침  → 10분 트리거 pushToDb 가 DB 를 맞춘다
//   앱 조회                  → Supabase 를 직접 읽는다 (빠르다)
//
// 두 곳에서 쓰면 어느 쪽이 최신인지 판단할 근거가 사라진다. 그래서 쓰기는
// 언제나 시트로 모으고, DB 는 비추기만 한다. 어긋나도 다음 밀어넣기가 맞춘다.
// ---------------------------------------------------------------------------
//
// v19 에서 바뀐 것
//   - doPost 가 session(YYYY-MM-DD) 을 받는다. 서버 시계로 오늘을 짐작하지 않는다.
//     (10일에 9일 출석을 찍으면 10일 열이 새로 생기던 문제)
//   - 없는 회차에는 쓰지 않는다. 열을 멋대로 만들지 않는다.
//   - batch 로 여러 명을 한 번에. 바뀐 사람만 보낸다.
//   - LockService — 동시 저장에 기록이 사라지지 않게.
//   - 상태값 검증 — 배포 URL 은 인증이 없다. 허용한 값만 통과시킨다.
//   - 시트에 쓴 뒤 Supabase 에 민다. push 가 실패해도 저장은 성공으로 응답한다.
//   - pushToDb() — 10분 트리거용. 시트와 DB 를 비교해 다른 칸만 민다.
//   - 회차 날짜를 GAS 가 YYYY-MM-DD 로 확정해 내려준다. 앱도 동기화도
//     MM/DD 에서 연도를 추측하지 않는다.
//   - 전역 이름에 DG_ 접두어. 같은 프로젝트의 다른 .gs 와 이름이 겹치면
//     나중에 읽힌 쪽이 조용히 이긴다.
//
// ⚠️ 이 파일에 onOpen 을 정의하지 말 것. 한 프로젝트에 onOpen 은 하나만 살고
//    둘이면 하나가 조용히 진다. 메뉴가 필요하면 기존 onOpen 안에서
//    DG_addMenu(ui) 를 부르게 한다.

var DG_VERSION = 21;

var DG_SHEET_ID = "1esF3oBjGq1PPMHae__LZNRgEvlwxVmNW4Ciz-qjM0zE";
var DG_TAB_ROSTER = "출석부(DB)";
var DG_TAB_LINKS = "DG링크";
var DG_TAB_LUNCH = "김밥";
var DG_TAB_HOMEWORK = "과제제출";

// 앱이 쓸 수 있는 상태값. 여기 없는 값은 거부한다.
//
// 시트에는 사람이 직접 넣은 다른 표기(이수 인정 등)가 있을 수 있다.
// 앱이 그런 칸을 O/X 로 덮어쓰지 못하게 막는 것이 이 목록의 목적이다.
var DG_ALLOWED_STATUS = ['O', 'X', ''];

// 한 번에 저장할 수 있는 인원 수. 조 하나를 넘길 이유가 없다.
var DG_MAX_BATCH = 100;

// 스크립트 속성 (파일 → 프로젝트 설정 → 스크립트 속성)
//   DG_SUPABASE_URL         https://xxxx.supabase.co
//   DG_SUPABASE_SERVICE_KEY service_role 키. 절대 코드나 저장소에 두지 말 것.
//   DG_START_YEAR           첫 회차의 연도 (예: 2025). 없으면 올해로 본다.
function DG_prop(key) {
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function DG_json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ===========================================================================
// 시트 읽기 도우미
// ===========================================================================

// 헤더 행을 찾는다 ('id' 가 있는 첫 줄).
function DG_findHeaderRow(values) {
  for (var i = 0; i < Math.min(5, values.length); i++) {
    var lowered = values[i].map(function (h) { return String(h).trim().toLowerCase(); });
    if (lowered.indexOf('id') !== -1) return i;
  }
  return -1;
}

/**
 * 헤더 행을 찾는다 (주어진 낱말 중 하나가 들어 있는 첫 줄).
 * 시트 위에 제목·안내문이 한두 줄 붙는 일이 흔해서 1행으로 못박지 않는다.
 */
function DG_findHeaderRowBy(values, needles) {
  for (var i = 0; i < Math.min(6, values.length); i++) {
    var row = values[i].map(function (h) { return String(h).trim().toLowerCase(); });
    for (var c = 0; c < row.length; c++) {
      for (var n = 0; n < needles.length; n++) {
        if (row[c].indexOf(needles[n]) !== -1) return i;
      }
    }
  }
  return -1;
}

/**
 * 제출 시각을 'yyyy-MM-ddTHH:mm:ss' 로.
 *
 * 폼 응답은 보통 진짜 Date 로 들어오지만, 시트를 복사·붙여넣기 하면 글자가 된다.
 * '2026. 3. 28 오전 8:28:40' 은 new Date() 가 못 읽어서 그냥 두면 시각이
 * 통째로 비고 정렬도 무너진다.
 */
function DG_parseWhen(value, tz) {
  if (value instanceof Date) return Utilities.formatDate(value, tz, "yyyy-MM-dd'T'HH:mm:ss");

  var s = String(value == null ? '' : value).trim();
  if (!s) return '';

  var m = s.match(/^(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})\.?(?:\s*(오전|오후))?\s*(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) {
    var h = parseInt(m[5], 10);
    if (m[4] === '오후' && h < 12) h += 12;
    if (m[4] === '오전' && h === 12) h = 0;
    var d = new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10),
                     h, parseInt(m[6], 10), parseInt(m[7] || '0', 10));
    if (!isNaN(d.getTime())) return Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm:ss");
  }

  var p = new Date(s);
  return isNaN(p.getTime()) ? '' : Utilities.formatDate(p, tz, "yyyy-MM-dd'T'HH:mm:ss");
}

// 날짜 헤더를 'MM/DD' 로 통일한다. '9/6' · '09/06' · 진짜 Date 가 섞여 온다.
function DG_headerToMMDD(value, tz) {
  if (value instanceof Date) return Utilities.formatDate(value, tz, 'MM/dd');
  var m = String(value).trim().match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return '';
  return ('0' + m[1]).slice(-2) + '/' + ('0' + m[2]).slice(-2);
}

/**
 * 회차 목록. 연도를 여기서 확정한다.
 *
 * 헤더 칸이 진짜 날짜 값이면 연도를 이미 알고 있으므로 그대로 쓴다.
 * 알고 있는 것을 버리고 추측할 이유가 없다.
 *
 * 글자로 적힌 'MM/DD' 만 추측이 필요하다. 전부 같은 해로 보면 11월에 시작해
 * 1월에 끝나는 학기가 뒤집히므로(01/25 가 11/02 보다 앞서게 된다),
 * 열 순서를 시간순으로 보고 달이 작아지는 지점에서 해가 바뀐 것으로 판단한다.
 * 기준 연도는 앞선 날짜 칸에서 이어받고, 하나도 없으면 올해로 본다.
 * 스크립트 속성 DG_START_YEAR 로 못박을 수도 있다 (보통은 둘 필요 없다).
 *
 * @returns [{ key:'11/02', date:'2025-11-02', col: 열인덱스(0부터) }, ...]
 */
function DG_buildSessions(headerRow, tz) {
  var forcedYear = parseInt(DG_prop('DG_START_YEAR'), 10) || null;

  var out = [];
  var seen = {};
  var year = forcedYear;   // null 이면 첫 날짜 칸이나 올해에서 받아온다
  var prevMonth = null;

  for (var c = 0; c < headerRow.length; c++) {
    var raw = headerRow[c];
    var key = '';
    var iso = '';

    if (raw instanceof Date) {
      // 연도를 아는 경우. 추측하지 않는다.
      key = Utilities.formatDate(raw, tz, 'MM/dd');
      iso = Utilities.formatDate(raw, tz, 'yyyy-MM-dd');
      if (!forcedYear) year = parseInt(iso.slice(0, 4), 10);
      prevMonth = parseInt(key.slice(0, 2), 10);
    } else {
      var m = String(raw).trim().match(/^(\d{1,2})\/(\d{1,2})$/);
      if (!m) continue;
      var month = parseInt(m[1], 10);
      var day = parseInt(m[2], 10);

      if (year === null) {
        year = new Date().getFullYear();
      } else if (prevMonth !== null && month < prevMonth) {
        year++;   // 12 → 01
      }
      prevMonth = month;

      key = ('0' + month).slice(-2) + '/' + ('0' + day).slice(-2);
      iso = year + '-' + ('0' + month).slice(-2) + '-' + ('0' + day).slice(-2);
    }

    if (!key || seen[key]) continue;
    seen[key] = true;
    out.push({ key: key, date: iso, col: c });
  }
  return out;
}

function DG_todayISO(tz) {
  return Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
}

/**
 * 강의명 행 — 날짜 헤더 바로 윗줄에 '1강' · '교리1' 처럼 적어 두면 그대로 읽는다.
 *
 * 이것이 있어야 과제의 '몇 강' 을 회차에 정확히 붙일 수 있다.
 * 없으면 빈 객체를 돌려주고, 과제는 회차에 붙이지 않는다 —
 * 순서로 짐작하면 엉뚱한 회차에 붙기 때문이다.
 *
 * @returns { '2026-08-09': '18강', ... }
 */
function DG_readSessionLabels(values, headerRowIdx, sessions) {
  var out = {};
  if (headerRowIdx <= 0) return out;

  var above = values[headerRowIdx - 1];
  if (!above) return out;

  for (var i = 0; i < sessions.length; i++) {
    var v = above[sessions[i].col];
    var label = String(v == null ? '' : v).trim();
    if (label) out[sessions[i].date] = label;
  }
  return out;
}

/**
 * 김밥 신청 — 전 회차.
 *
 * 예전에는 '오늘 이후 가장 가까운 열' 하나만 읽었다. 결과 카드에 한 줄
 * 띄우는 데는 충분했지만, 회차별 이력을 보여주려면 전부 필요하다.
 *
 * @returns { '이민재6550': { '2026-08-09': 'O' }, ... }
 */
function DG_readLunchByDate(ss, tz) {
  var sheet = ss.getSheetByName(DG_TAB_LUNCH);
  var out = {};
  if (!sheet) return out;

  var values = sheet.getDataRange().getValues();
  var headerIdx = DG_findHeaderRow(values);
  if (headerIdx === -1) return out;

  var header = values[headerIdx];
  var idIdx = header.map(function (h) {
    return String(h).trim().toLowerCase();
  }).indexOf('id');
  if (idIdx === -1) return out;

  // 날짜 열은 출석부와 같은 방식으로 읽는다 (연도까지 확정).
  var cols = DG_buildSessions(header, tz);
  if (!cols.length) return out;

  for (var r = headerIdx + 1; r < values.length; r++) {
    var id = String(values[r][idIdx]).replace(/[^a-zA-Z0-9가-힣]/g, '');
    if (!id) continue;

    var map = {};
    for (var c = 0; c < cols.length; c++) {
      var cell = values[r][cols[c].col];
      var val = cell instanceof Date
        ? Utilities.formatDate(cell, tz, 'yyyy-MM-dd')
        : String(cell == null ? '' : cell).trim();
      if (val) map[cols[c].date] = 'O';   // 값이 있으면 신청한 것으로 본다
    }
    out[id] = map;
  }
  return out;
}

/**
 * 과제 제출 목록.
 *
 * 폼 응답 시트라 헤더 문구가 조금씩 바뀔 수 있어 부분 일치로 찾는다.
 *   타임스탬프 | Team | 아이디 | 연락처 | 성별 | 몇 강인가요? | 어떤 과제인가요? | 과제 및 소감문 제출
 *
 * '몇 강' 은 회차 날짜로 바꾸지 않는다. 39회차 중 몇 번째가 몇 강인지 시트가
 * 말해주지 않아서, 순서로 짐작하면 엉뚱한 회차에 붙는다. 적힌 그대로 넘긴다.
 *
 * @returns [{ id, lecture, kind, content, submittedAt }, ...]
 */
function DG_readHomework(ss, tz) {
  var sheet = ss.getSheetByName(DG_TAB_HOMEWORK);
  if (!sheet) return [];

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  // 헤더가 1행이라고 못박지 않는다. 위에 제목 줄이 붙는 일이 흔하다.
  var headerIdx = DG_findHeaderRowBy(values, ['아이디', '타임스탬프', 'timestamp']);
  if (headerIdx === -1) return [];

  var header = values[headerIdx].map(function (h) { return String(h).trim().toLowerCase(); });
  var find = function (needles) {
    for (var i = 0; i < header.length; i++) {
      for (var n = 0; n < needles.length; n++) {
        if (header[i].indexOf(needles[n]) !== -1) return i;
      }
    }
    return -1;
  };

  var iTime = find(['타임스탬프', 'timestamp']);
  var iId = find(['아이디']);
  var iPhone = find(['연락처']);
  var iLecture = find(['몇 강', '몇강']);
  var iKind = find(['어떤 과제', '과제 종류']);
  var iContent = find(['제출']);

  if (iId === -1) return [];

  var out = [];
  for (var r = headerIdx + 1; r < values.length; r++) {
    var row = values[r];

    // 아이디는 '이름+전화뒷4' 형태를 기대한다. 공백·전각이 섞여 오므로 정규화한다.
    var id = String(row[iId] == null ? '' : row[iId]).replace(/[^a-zA-Z0-9가-힣]/g, '');
    if (!id) continue;

    // 아이디에 번호가 안 붙어 있으면 연락처 뒷 4자리로 보완한다.
    if (iPhone !== -1 && !/\d{4}$/.test(id)) {
      var tail = String(row[iPhone] == null ? '' : row[iPhone]).replace(/[^0-9]/g, '').slice(-4);
      if (tail) id = id + tail;
    }

    var when = iTime !== -1 ? DG_parseWhen(row[iTime], tz) : '';

    out.push({
      id: id,
      lecture: iLecture !== -1 ? String(row[iLecture] == null ? '' : row[iLecture]).trim() : '',
      kind: iKind !== -1 ? String(row[iKind] == null ? '' : row[iKind]).trim() : '',
      content: iContent !== -1 ? String(row[iContent] == null ? '' : row[iContent]).trim() : '',
      submittedAt: when
    });
  }
  return out;
}

// ===========================================================================
// 출석 저장 (POST)
//
// 받는 형태
//   { session: '2025-11-02', batch: [{ name, phone, status }, ...] }
//   { name, phone, status }                      ← 옛 형태도 받는다 (오늘 회차로 본다)
// ===========================================================================
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('전송된 데이터가 없습니다.');
    }

    var body = JSON.parse(e.postData.contents);
    var tz = Session.getScriptTimeZone();

    // ---- 저장할 목록 정리 --------------------------------------------------
    var incoming = [];
    if (Object.prototype.toString.call(body.batch) === '[object Array]') {
      incoming = body.batch;
    } else if (body.name) {
      incoming = [{ name: body.name, phone: body.phone, status: body.status }];
    }
    if (!incoming.length) throw new Error('저장할 대상이 없습니다.');
    if (incoming.length > DG_MAX_BATCH) {
      throw new Error('한 번에 저장할 수 있는 인원을 넘었습니다 (' + DG_MAX_BATCH + '명).');
    }

    // 배포 URL 은 인증이 없다. 값을 반드시 검증한다.
    var entries = [];
    for (var i = 0; i < incoming.length; i++) {
      var name = String(incoming[i].name || '').replace(/[^a-zA-Z0-9가-힣]/g, '');
      var phone = String(incoming[i].phone || '').replace(/[^0-9]/g, '');
      var status = String(incoming[i].status == null ? '' : incoming[i].status).trim().toUpperCase();

      if (!name) throw new Error('이름이 없는 항목이 있습니다.');
      if (DG_ALLOWED_STATUS.indexOf(status) === -1) {
        throw new Error("허용되지 않는 값입니다: '" + status + "'");
      }
      entries.push({ id: name + phone, status: status });
    }

    // ---- 잠금 -------------------------------------------------------------
    // 컬럼을 읽고 쓰는 사이에 다른 사람이 저장하면 그 변경이 조용히 사라진다.
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(20000)) {
      throw new Error('다른 저장이 진행 중입니다. 잠시 후 다시 시도해 주세요.');
    }

    try {
      var ss = SpreadsheetApp.openById(DG_SHEET_ID);
      var sheet = ss.getSheetByName(DG_TAB_ROSTER);
      if (!sheet) throw new Error("'" + DG_TAB_ROSTER + "' 시트를 찾을 수 없습니다.");

      var values = sheet.getDataRange().getValues();
      var headerRowIdx = DG_findHeaderRow(values);
      if (headerRowIdx === -1) throw new Error("'id' 열을 찾을 수 없습니다.");

      var headerRow = values[headerRowIdx];
      var idIdx = headerRow.map(function (h) {
        return String(h).trim().toLowerCase();
      }).indexOf('id');

      var sessions = DG_buildSessions(headerRow, tz);

      // ---- 회차 결정 ------------------------------------------------------
      // 앱이 지정한 회차에만 쓴다. 없는 회차면 거부한다.
      // 예전에는 서버 시계로 오늘을 짐작하고 열이 없으면 새로 만들었는데,
      // 그러면 10일에 9일 출석을 찍을 때 10일 열이 생기고, 회차가 아닌 날에
      // 실수로 누른 것도 정식 회차가 돼 버렸다.
      var wanted = String(body.session || '').trim() || DG_todayISO(tz);
      var target = null;
      for (var s = 0; s < sessions.length; s++) {
        if (sessions[s].date === wanted) { target = sessions[s]; break; }
      }
      if (!target) {
        throw new Error('시트에 없는 회차입니다: ' + wanted);
      }
      if (target.date > DG_todayISO(tz)) {
        // 미래 회차에 O/X 가 들어가면 결석 수가 부풀려진다.
        throw new Error('아직 지나지 않은 회차입니다: ' + target.date);
      }

      // ---- id → 행 인덱스 --------------------------------------------------
      var rowOf = {};
      for (var r = headerRowIdx + 1; r < values.length; r++) {
        var rawId = String(values[r][idIdx]).replace(/[^a-zA-Z0-9가-힣]/g, '');
        if (rawId) rowOf[rawId] = r;
      }

      // ---- 쓰기 (① 원본) ---------------------------------------------------
      //
      // 이미 O/X 가 아닌 값이 들어 있는 칸은 건드리지 않는다.
      // 시트에는 사람이 직접 넣은 '돌봄' · '-' 같은 표기가 있고, 앱은 그 뜻을
      // 모른다. 조장이 무심코 체크하면 그 기록이 O/X 로 덮여 사라진다.
      // 바꿔야 한다면 시트에서 직접 고치는 게 맞다.
      var saved = [];
      var missing = [];
      var kept = [];
      for (var k = 0; k < entries.length; k++) {
        var row = rowOf[entries[k].id];
        if (row === undefined) { missing.push(entries[k].id); continue; }

        var cell = values[row][target.col];
        var current = cell instanceof Date
          ? Utilities.formatDate(cell, tz, 'yyyy-MM-dd')
          : String(cell == null ? '' : cell).trim();

        if (DG_ALLOWED_STATUS.indexOf(current.toUpperCase()) === -1) {
          kept.push(entries[k].id + '(' + current + ')');
          continue;
        }

        sheet.getRange(row + 1, target.col + 1).setValue(entries[k].status);
        saved.push(entries[k]);
      }
      SpreadsheetApp.flush();

      // ---- 밀어넣기 (② 사본) -----------------------------------------------
      // 여기서 실패해도 원본은 이미 안전하다. 저장은 성공으로 응답하고
      // 10분 트리거가 다음 차례에 맞춘다.
      var pushed = false;
      var pushError = '';
      try {
        pushed = DG_pushRows(saved.map(function (x) {
          return { id: x.id, date: target.date, status: x.status };
        }));
      } catch (pushErr) {
        pushError = String(pushErr.message || pushErr);
        Logger.log('DB push 실패(무시): ' + pushError);
      }

      return DG_json({
        success: saved.length > 0,
        version: DG_VERSION,
        session: target.date,
        saved: saved.length,
        missing: missing,
        // O/X 가 아닌 값이 있어 건드리지 않은 칸
        kept: kept,
        dbPushed: pushed,
        dbError: pushError,
        message: saved.length ? '출석 저장 완료'
               : kept.length ? '이미 다른 표기가 있어 두었습니다: ' + kept.join(', ')
               : 'ID 불일치'
      });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return DG_json({ success: false, version: DG_VERSION, message: String(err.message || err) });
  }
}

// ===========================================================================
// Supabase 밀어넣기
// ===========================================================================

/**
 * dg_attendance 에 upsert 한다.
 * @param rows [{ id:'이민재6550', date:'2025-11-02', status:'O' }, ...]
 * @returns 성공했으면 true
 */
function DG_pushRows(rows) {
  if (!rows || !rows.length) return true;

  var url = DG_prop('DG_SUPABASE_URL');
  var key = DG_prop('DG_SUPABASE_SERVICE_KEY');
  if (!url || !key) {
    Logger.log('스크립트 속성 DG_SUPABASE_URL / DG_SUPABASE_SERVICE_KEY 가 없습니다.');
    return false;
  }

  // 앱과 같은 대상만 건드린다.
  var cohort = DG_currentCohort();
  if (!cohort) {
    Logger.log('대상 표식(cohortHint) 이 없어 DB 밀어넣기를 건너뜁니다.');
    return false;
  }

  // id(이름+전화) → dg_members.id(uuid) 로 바꾼다.
  var uuidOf = DG_memberUuidMap(url, key, cohort);
  var payload = [];
  var unknown = [];
  for (var i = 0; i < rows.length; i++) {
    var uuid = uuidOf[rows[i].id];
    if (!uuid) { unknown.push(rows[i].id); continue; }
    payload.push({ member_id: uuid, session_date: rows[i].date, status: rows[i].status });
  }
  if (unknown.length) Logger.log('DB 명단에 없어 건너뜀: ' + unknown.join(', '));
  if (!payload.length) return false;

  var res = UrlFetchApp.fetch(url + '/rest/v1/dg_attendance?on_conflict=member_id,session_date', {
    method: 'post',
    contentType: 'application/json',
    headers: {
      apikey: key,
      Authorization: 'Bearer ' + key,
      Prefer: 'resolution=merge-duplicates'
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    throw new Error('Supabase ' + code + ': ' + res.getContentText().slice(0, 200));
  }
  return true;
}

// 시트 상단의 대상 표식 (DG-2026 · 3기).
function DG_currentCohort() {
  var ss = SpreadsheetApp.openById(DG_SHEET_ID);
  var sheet = ss.getSheetByName(DG_TAB_ROSTER);
  if (!sheet) return '';
  var top = sheet.getRange(1, 1, Math.min(6, sheet.getLastRow()),
                           Math.min(12, sheet.getLastColumn())).getValues();
  for (var r = 0; r < top.length; r++) {
    for (var c = 0; c < top[r].length; c++) {
      var v = String(top[r][c] || '').trim();
      if (/^DG[-\s]?\d{4}$/i.test(v) || /^\d+\s*기$/.test(v)) {
        return v.replace(/\s+/g, '').toUpperCase();
      }
    }
  }
  return '';
}

// dg_members 에서 '이름+전화' → uuid 사전을 만든다.
//
// PostgREST 는 한 번에 1000행만 준다. 조용히 잘리므로 나눠 받는다.
// order 가 없으면 페이지마다 순서가 흔들려 빠지거나 겹친다.
function DG_memberUuidMap(url, key, cohort) {
  var out = {};
  var page = 0;
  var size = 1000;
  while (true) {
    var from = page * size;
    var res = UrlFetchApp.fetch(
      url + '/rest/v1/dg_members?select=id,name,phone&cohort_id=eq.'
        + encodeURIComponent(cohort) + '&order=id&limit=' + size + '&offset=' + from,
      {
        method: 'get',
        headers: { apikey: key, Authorization: 'Bearer ' + key },
        muteHttpExceptions: true
      });
    if (res.getResponseCode() !== 200) {
      throw new Error('dg_members 조회 실패: ' + res.getContentText().slice(0, 200));
    }
    var rows = JSON.parse(res.getContentText());
    for (var i = 0; i < rows.length; i++) {
      out[String(rows[i].name) + String(rows[i].phone || '')] = rows[i].id;
    }
    if (rows.length < size) break;
    page++;
  }
  return out;
}

/**
 * 자가 치유 — 시트와 DB 를 비교해 다른 칸만 민다.
 *
 * 시트에 사람이 직접 친 값과, doPost 의 밀어넣기가 실패한 건을 메운다.
  * 10분마다 돌게 등록한다:
 *   ScriptApp.newTrigger('DG_pushToDb').timeBased().everyMinutes(10).create()
 * (아래 DG_installTrigger 를 한 번 실행하면 된다)
 */
function DG_pushToDb() {
  var url = DG_prop('DG_SUPABASE_URL');
  var key = DG_prop('DG_SUPABASE_SERVICE_KEY');
  if (!url || !key) {
    Logger.log('스크립트 속성이 없어 중단합니다.');
    return;
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    Logger.log('다른 작업이 진행 중이라 이번 차례는 건너뜁니다.');
    return;
  }

  try {
    var tz = Session.getScriptTimeZone();
    var cohort = DG_currentCohort();
    if (!cohort) {
      Logger.log('대상 표식이 없어 중단합니다.');
      return;
    }

    var ss = SpreadsheetApp.openById(DG_SHEET_ID);
    var sheet = ss.getSheetByName(DG_TAB_ROSTER);
    var values = sheet.getDataRange().getValues();
    var headerRowIdx = DG_findHeaderRow(values);
    if (headerRowIdx === -1) { Logger.log("'id' 열이 없습니다."); return; }

    var headerRow = values[headerRowIdx];
    var idIdx = headerRow.map(function (h) {
      return String(h).trim().toLowerCase();
    }).indexOf('id');

    var todayISO = DG_todayISO(tz);
    var sessions = DG_buildSessions(headerRow, tz).filter(function (s) {
      return s.date <= todayISO;   // 아직 지나지 않은 회차는 건드리지 않는다
    });

    // 시트의 현재 값
    var sheetRows = [];
    for (var r = headerRowIdx + 1; r < values.length; r++) {
      var id = String(values[r][idIdx]).replace(/[^a-zA-Z0-9가-힣]/g, '');
      if (!id) continue;
      for (var s = 0; s < sessions.length; s++) {
        var cell = values[r][sessions[s].col];
        var status = cell instanceof Date
          ? Utilities.formatDate(cell, tz, 'yyyy-MM-dd')
          : String(cell).trim();
        if (!status) continue;   // 빈칸은 '모르는 것' 이다. 결석으로 만들지 않는다.
        sheetRows.push({ id: id, date: sessions[s].date, status: status });
      }
    }

    // DB 의 현재 값
    var uuidOf = DG_memberUuidMap(url, key, cohort);
    var idOfUuid = {};
    for (var name in uuidOf) {
      if (uuidOf.hasOwnProperty(name)) idOfUuid[uuidOf[name]] = name;
    }
    var dbValue = {};
    var page = 0, size = 1000;
    while (true) {
      var res = UrlFetchApp.fetch(
        url + '/rest/v1/dg_attendance?select=member_id,session_date,status'
          + '&order=member_id,session_date&limit=' + size + '&offset=' + (page * size),
        { method: 'get', headers: { apikey: key, Authorization: 'Bearer ' + key },
          muteHttpExceptions: true });
      if (res.getResponseCode() !== 200) {
        Logger.log('dg_attendance 조회 실패: ' + res.getContentText().slice(0, 200));
        return;
      }
      var rows = JSON.parse(res.getContentText());
      for (var i = 0; i < rows.length; i++) {
        var sid = idOfUuid[rows[i].member_id];
        if (sid) dbValue[sid + '|' + rows[i].session_date] = rows[i].status || '';
      }
      if (rows.length < size) break;
      page++;
    }

    // 다른 칸만 민다
    var diff = [];
    for (var j = 0; j < sheetRows.length; j++) {
      var k = sheetRows[j].id + '|' + sheetRows[j].date;
      if (dbValue[k] !== sheetRows[j].status) diff.push(sheetRows[j]);
    }

    if (!diff.length) {
      Logger.log('맞출 것이 없습니다 (시트 ' + sheetRows.length + '칸 확인).');
      return;
    }

    // 한 번에 너무 많이 보내지 않는다
    for (var off = 0; off < diff.length; off += 500) {
      DG_pushRows(diff.slice(off, off + 500));
    }
    Logger.log('DB 를 시트에 맞췄습니다: ' + diff.length + '칸');
  } finally {
    lock.releaseLock();
  }
}

/**
 * 10분 트리거 등록. 한 번만 실행하면 된다 (중복 등록은 알아서 지운다).
 */
function DG_installTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === 'DG_pushToDb') ScriptApp.deleteTrigger(existing[i]);
  }
  ScriptApp.newTrigger('DG_pushToDb').timeBased().everyMinutes(10).create();
  Logger.log('pushToDb 트리거를 10분마다 돌도록 등록했습니다.');
}

/**
 * 시트 메뉴. onOpen 은 여기서 정의하지 않는다 —
 * 한 프로젝트에 onOpen 은 하나만 살기 때문이다.
 * 기존 onOpen 안에서 DG_addMenu(SpreadsheetApp.getUi()) 를 부르면 된다.
 */
function DG_addMenu(ui) {
  ui.createMenu('DGfinder')
    .addItem('지금 DB 에 맞추기', 'DG_pushToDb')
    .addItem('10분 트리거 등록', 'DG_installTrigger')
    .addToUi();
}

// ===========================================================================
// 명단·링크·배치도·출결 읽기 (GET)
// ===========================================================================
function doGet(e) {
  try {
    var ss = SpreadsheetApp.openById(DG_SHEET_ID);
    var tz = Session.getScriptTimeZone();

    // ---------------------------------------------------------------------
    // [김밥 탭] — 오늘 이후 가장 가까운 날짜 열을 본다
    // ---------------------------------------------------------------------
    var kimbapSheet = ss.getSheetByName(DG_TAB_LUNCH);
    var kimbapMap = {};
    if (kimbapSheet) {
      var kbValues = kimbapSheet.getDataRange().getValues();
      var kbHeaderIdx = DG_findHeaderRow(kbValues);

      if (kbHeaderIdx !== -1) {
        var kbHeadersRaw = kbValues[kbHeaderIdx];
        var kbIdIdx = kbHeadersRaw.map(function (h) {
          return String(h).trim().toLowerCase();
        }).indexOf('id');

        var todayStr = Utilities.formatDate(new Date(), tz, 'yyyy/MM/dd').split('/');
        var kbToday = new Date(parseInt(todayStr[0], 10), parseInt(todayStr[1], 10) - 1,
                               parseInt(todayStr[2], 10));

        var minDiff = Infinity;
        var targetKbIdx = -1;

        for (var c = 0; c < kbHeadersRaw.length; c++) {
          if (c === kbIdIdx) continue;
          var d = kbHeadersRaw[c];
          var dateObj = null;

          if (d instanceof Date) {
            dateObj = new Date(d.getFullYear(), d.getMonth(), d.getDate());
          } else if (typeof d === 'string' && d.trim() !== '') {
            var str = d.trim();
            var m1 = str.match(/(\d{4})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
            var m2 = str.match(/(\d{1,2})\/(\d{1,2})/);
            if (m1) {
              dateObj = new Date(parseInt(m1[1], 10), parseInt(m1[2], 10) - 1, parseInt(m1[3], 10));
            } else if (m2) {
              dateObj = new Date(kbToday.getFullYear(), parseInt(m2[1], 10) - 1, parseInt(m2[2], 10));
            }
          }

          if (dateObj) {
            var diff = dateObj.getTime() - kbToday.getTime();
            if (diff >= 0 && diff < minDiff) { minDiff = diff; targetKbIdx = c; }
          }
        }

        if (targetKbIdx !== -1 && kbIdIdx !== -1) {
          for (var kr = kbHeaderIdx + 1; kr < kbValues.length; kr++) {
            var kbId = String(kbValues[kr][kbIdIdx]).replace(/[^a-zA-Z0-9가-힣]/g, '');
            if (!kbId) continue;
            kimbapMap[kbId] = String(kbValues[kr][targetKbIdx]).trim() !== '' ? 'O' : 'X';
          }
        }
      }
    }

    // ---------------------------------------------------------------------
    // [DG링크 탭] — 조·그룹 안내방과 배치도 이미지
    // ---------------------------------------------------------------------
    var telegramSheet = ss.getSheetByName(DG_TAB_LINKS);
    var telegramMap = {};
    var locationMap = {};
    if (telegramSheet) {
      var telValues = telegramSheet.getDataRange().getValues();
      var telHeaderIdx = -1, tTeamIdx = -1, tLinkIdx = -1, tLocIdx = -1, tMapIdx = -1;
      for (var ti = 0; ti < Math.min(5, telValues.length); ti++) {
        var th = telValues[ti].map(function (h) { return String(h).trim().toLowerCase(); });
        tTeamIdx = th.indexOf('team');
        tLinkIdx = th.indexOf('link');
        tLocIdx = th.indexOf('location');
        tMapIdx = th.indexOf('map');
        if (tTeamIdx !== -1 || tLinkIdx !== -1 || tLocIdx !== -1 || tMapIdx !== -1) {
          telHeaderIdx = ti; break;
        }
      }

      if (telHeaderIdx !== -1) {
        for (var tr = telHeaderIdx + 1; tr < telValues.length; tr++) {
          if (tTeamIdx !== -1 && tLinkIdx !== -1) {
            var tName = String(telValues[tr][tTeamIdx]).trim();
            if (tName) telegramMap[tName] = String(telValues[tr][tLinkIdx]).trim();
          }
          if (tLocIdx !== -1 && tMapIdx !== -1) {
            var locName = String(telValues[tr][tLocIdx]).trim();
            if (locName) locationMap[locName] = String(telValues[tr][tMapIdx]).trim();
          }
        }
      }
    }

    // ---------------------------------------------------------------------
    // [출석부(DB) 탭] — 명단 본체
    // ---------------------------------------------------------------------
    var sheet = ss.getSheetByName(DG_TAB_ROSTER);
    var data = sheet.getDataRange().getValues();
    var headerRowIdx = DG_findHeaderRow(data);
    if (headerRowIdx === -1) throw new Error("'id' 열을 찾을 수 없습니다.");

    var originalHeadersRaw = data[headerRowIdx];
    var headers = originalHeadersRaw.map(function (h) {
      return (h instanceof Date ? Utilities.formatDate(h, tz, 'M/d') : String(h)).trim().toLowerCase();
    });
    var idIdx = headers.indexOf('id');

    var todayISO = DG_todayISO(tz);
    var sessions = DG_buildSessions(originalHeadersRaw, tz);

    // 날짜 헤더 윗줄의 강의명. 있으면 과제의 '몇 강' 을 회차에 붙일 수 있다.
    var sessionLabels = DG_readSessionLabels(data, headerRowIdx, sessions);

    // 김밥 — 회차별. 결과 카드의 한 줄(kimbapMap) 은 그대로 두고 이력을 더한다.
    var lunchByDate = DG_readLunchByDate(ss, tz);

    // 대상 표식
    var cohortHint = '';
    for (var cr = 0; cr < Math.min(6, data.length) && !cohortHint; cr++) {
      for (var cc = 0; cc < Math.min(12, data[cr].length); cc++) {
        var cv = String(data[cr][cc] || '').trim();
        if (/^DG[-\s]?\d{4}$/i.test(cv) || /^\d+\s*기$/.test(cv)) {
          cohortHint = cv.replace(/\s+/g, '').toUpperCase();
          break;
        }
      }
    }

    // 가장 최근 지난 회차. 앱이 기본으로 고를 값이다.
    var currentSession = '';
    for (var si = 0; si < sessions.length; si++) {
      if (sessions[si].date <= todayISO) currentSession = sessions[si].date;
    }

    var jsonData = [];
    for (var i = headerRowIdx + 1; i < data.length; i++) {
      var rawId = String(data[i][idIdx]).replace(/[^a-zA-Z0-9가-힣]/g, '');
      if (!rawId) continue;

      var obj = {};
      if (rawId.length > 4) {
        obj['name'] = rawId.slice(0, -4);
        obj['phone'] = rawId.slice(-4);
      } else {
        obj['name'] = rawId;
        obj['phone'] = '';
      }
      obj['id'] = rawId;

      // 화면이 쓰는 값만 담는다.
      //
      // 예전에는 headers.forEach 로 전 컬럼을 담았는데, 그러면 시트에 개인정보
      // 컬럼이 생기는 순간 인증 없는 URL 로 그대로 공개된다.
      var teamIdx = headers.indexOf('team');
      var locIdx = headers.indexOf('location');
      var roleIdx = headers.indexOf('role');
      var noIdx = headers.indexOf('no.');
      obj['team'] = teamIdx !== -1 ? String(data[i][teamIdx]).trim() : '';
      obj['location'] = locIdx !== -1 ? String(data[i][locIdx]).trim() : '';
      obj['role'] = roleIdx !== -1 ? String(data[i][roleIdx]).trim() : '';
      obj['team_no'] = noIdx !== -1 ? String(data[i][noIdx]).trim() : '';

      obj['telegramLink'] = telegramMap[obj['team']] || '';
      obj['lunch'] = kimbapMap[obj['id']] || 'X';

      // 회차별 출결. 키는 YYYY-MM-DD 다 — 받는 쪽이 연도를 추측하지 않게.
      var att = {};
      for (var sj = 0; sj < sessions.length; sj++) {
        var cell = data[i][sessions[sj].col];
        var val = cell instanceof Date
          ? Utilities.formatDate(cell, tz, 'yyyy-MM-dd')
          : String(cell).trim();
        if (val) att[sessions[sj].date] = val;
      }
      obj['attendanceByDate'] = att;
      obj['attendance'] = att[currentSession] || '';
      obj['lunchByDate'] = lunchByDate[obj['id']] || {};

      jsonData.push(obj);
    }

    return DG_json({
      success: true,
      version: DG_VERSION,
      data: jsonData,
      locationMap: locationMap,
      teamLinkMap: telegramMap,
      cohortHint: cohortHint,
      today: todayISO,
      currentSession: currentSession,
      // [{ key:'11/02', date:'2025-11-02' }, ...] — 연도는 GAS 가 확정한다
      sessions: sessions.map(function (s) {
        return { key: s.key, date: s.date, label: sessionLabels[s.date] || '' };
      }),
      // 과제 제출 목록. 인원마다 넣지 않고 따로 둔다 (대부분 몇 건 없다).
      homework: DG_readHomework(ss, tz),
      // 옛 동기화 스크립트 호환
      sessionDates: sessions.map(function (s) { return s.key; })
    });
  } catch (err) {
    return DG_json({ success: false, version: DG_VERSION, message: String(err.message || err) });
  }
}
