// DGfinder — Google Apps Script 전체 코드 (v30)
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
// v30
//   - **결과 카드의 김밥도 X 를 거른다.** v25 에서 'X 를 신청으로 읽던' 것을
//     고쳤는데 DG_readLunchByDate 만 고쳤다. doGet 안의 kimbapMap(결과 카드
//     한 줄, 조 요약의 🍙 N, 조원 명단의 🍙 가 쓰는 값)은 아직 '값이 있기만
//     하면 O' 였다. 안 한다고 X 를 적은 사람이 대상자로 세어져 김밥을 그만큼
//     더 시킨다. 두 자리가 DG_isLunchApplied 하나를 같이 쓰게 했다.
//
// v29
//   - 메뉴에 '과제 아이디 점검'. 폼에 적은 아이디가 명단과 안 맞으면 그 사람의
//     과제가 조용히 버려지는데, 지금까지는 GitHub 워크플로 로그에만 남았다.
//     저장소가 public 이라 그 로그에 실명을 적을 수 없어 건수만 남기게 됐고,
//     그러면 누구를 고쳐야 할지 알 수 없다. 시트 안에 적으면 둘 다 풀린다 —
//     이름을 봐도 되는 자리이고, 고칠 대상(폼·명단)도 여기 있다.
//     '과제ID점검' 탭에 갈래별로 적는다: 번호가 다름 · 이름 한 글자 차이 ·
//     명단에 없음. 갈래마다 손볼 곳이 다르다.
//
// v28
//   - 아이디를 한 규칙으로 다듬는다 (DG_normalizeId_). 과제·김밥 탭 아이디는
//     손입력과 폼 응답이 섞여 '김도현 5326' · '김도현-5326' · '김도현(5326)' ·
//     '김도현５３２６' 처럼 제각각 들어온다. 기호만 지우면 전각 숫자는 통째로
//     사라져 이름만 남고, 명단과 짝이 안 맞아 조용히 버려졌다.
//     전각을 반각으로 바꾸고 자모를 합친 뒤 한글·영문·숫자만 남긴다.
//     ⚠️ 아이디를 만들고 맞추는 자리 전부(출석부·김밥·과제·저장·밀어넣기)에 넣었다.
//
// v27
//   - 인원마다 pastor(담당교역자)를 담는다. 결석 현황을 교역자별로 갈라 보려는
//     것. 열 이름은 '담당교역자 · 교역자 · pastor · 담당' 을 차례로 찾는다.
//     ⚠️ 이 탭의 다른 개인정보 열(연락처 · 결혼 등)은 여전히 내보내지 않는다.
//
// v26
//   - 인원마다 sheetRow(출석부 시트의 줄 번호)를 담는다. 앱의 명단 차례를
//     시트와 똑같이 맞추려는 것. 예전에는 'No.' 열로 정렬했는데, 그 칸이 비어
//     있거나 조를 다시 짜면서 어긋나 있으면 그 사람만 명단 끝으로 밀렸다.
//
// v25
//   - 김밥 칸을 O/X 로 읽는다. 예전에는 **값이 있기만 하면 신청**으로 봐서
//     X 도 신청으로 세어졌다 (시트 1명 → 화면 3명). 빈칸과 부정 표기(X · - · 0
//     · 취소 …)만 걸러내고 나머지는 그대로 신청으로 둔다.
//   - lunchDates 를 함께 내려준다. 김밥 시트에서 읽은 회차 목록이라,
//     동기화가 '시트에서 지워진 신청' 을 DB 에서 지울 수 있다. 신청자가 하나도
//     없는 회차도 들어간다 — 그래야 전원 취소된 회차도 비울 수 있다.
//
// v24
//   - doPost 가 { action: "sync" } 를 받으면 GitHub Actions 의 동기화 워크플로를
//     실행한다. 관리자가 시트를 고친 직후 GitHub 에 들어가지 않고 앱에서 누른다.
//     토큰은 스크립트 속성에 두고 앱에는 두지 않는다 — 앱 JS 는 누구나 읽는다.
//   - 잠금(LockService)을 잡기 전에 처리한다. 동기화는 시트를 건드리지 않으므로
//     출석 저장이 진행 중이어도 막힐 이유가 없다.
//   - DG_authorizeAndCheck() — 시트·외부요청·GitHub 를 한 번에 점검한다.
//     doGet/doPost 는 URL 로 불려서 승인 창을 띄울 자리가 없다. 사람이 편집기에서
//     한 번 실행해 승인해야 한다. ⚠️ appsscript.json 의 oauthScopes 도 봐야 한다
//     (scripts/gas/appsscript.json 참고). 목록에 없는 권한은 요청조차 하지 않는다.
//
// v23
//   - 인원에 age 를 담는다. 관리자 화면이 쓰는 값이라 명시적으로 하나만 더한다
//     (Tel · 연락처 · 결혼 같은 열은 그대로 내보내지 않는다).
//
// v22
//   - 회차 이름을 sessions[].label 로 내려준다. 날짜 헤더 바로 윗줄에 적힌 값을
//     쓰고, 그 줄이 통째로 비어 있을 때만 순서대로 'N강' 을 매긴다.
//     (라이브 시트에는 '자유교제' 가 끼어 있어 순번으로는 뒤가 밀린다)
//   - sessionNamesFromSheet 로 어느 쪽을 썼는지 알린다.
//
// v21
//   - 김밥을 회차별로 준다 (lunchByDate). 예전에는 오늘 이후 가장 가까운 열
//     하나만 읽어서 결과 카드의 O/X 한 줄밖에 못 만들었다.
//
// v20
//   - '과제제출' 탭을 읽어 homework 로 내려준다.
//   - 헤더 행을 1행으로 못박지 않고 윗 6행에서 찾는다 (다른 탭과 같은 방식).
//   - '2026. 3. 28 오전 8:28:40' 형식의 타임스탬프를 직접 읽는다.
//     new Date() 가 못 읽어서 그냥 두면 제출 시각이 통째로 비고 정렬이 무너진다.
//
// v19
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

var DG_VERSION = 30;

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

// 시트 → DB 동기화 워크플로. 스크립트 속성으로 덮어쓸 수 있다.
var DG_GH_REPO_DEFAULT = "dev-plc/dg-class-finder";
var DG_GH_WORKFLOW_DEFAULT = "sync-db.yml";   // .github/workflows/ 안의 파일명 (화면 제목 아님)
var DG_SYNC_MIN_INTERVAL_MS = 60 * 1000;

// 스크립트 속성 (파일 → 프로젝트 설정 → 스크립트 속성)
//   DG_SUPABASE_URL         https://xxxx.supabase.co
//   DG_SUPABASE_SERVICE_KEY service_role 키. 절대 코드나 저장소에 두지 말 것.
//   DG_START_YEAR           첫 회차의 연도 (예: 2025). 없으면 올해로 본다.
//   DG_GH_TOKEN             GitHub fine-grained 토큰 (Actions: Read and write 하나면 된다).
//                           역시 코드나 저장소에 두지 말 것.
//   DG_GH_REPO              owner/repo. 없으면 DG_GH_REPO_DEFAULT.
//   DG_GH_WORKFLOW          워크플로 파일명. 없으면 DG_GH_WORKFLOW_DEFAULT.
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
 * 회차 이름. 과제의 '몇 강인가요?' 와 견주어 붙이는 데 쓴다.
 *
 * 날짜 헤더 바로 윗줄에 '1강' · '교리1' 처럼 적어 두면 그 값이 우선한다.
 * 없으면 순서대로 'N강' 을 매긴다 (아래 설명 참고).
 *
 * @returns { map: { '2026-08-09': '18강', ... }, fromSheet: true|false }
 */
function DG_readSessionLabels(values, headerRowIdx, sessions) {
  var out = {};
  var fromSheet = false;

  if (headerRowIdx > 0) {
    var above = values[headerRowIdx - 1];
    if (above) {
      for (var i = 0; i < sessions.length; i++) {
        var label = String(above[sessions[i].col] == null ? '' : above[sessions[i].col]).trim();
        if (label) { out[sessions[i].date] = label; fromSheet = true; }
      }
    }
  }

  // 시트에 강의명 줄이 없으면 순서대로 'N강' 을 매긴다.
  //
  // 과제의 '몇 강인가요?' 값이 곧 강의명('1강' · '2강')이고, 날짜 열은 실제로
  // 있었던 회차만 담고 있다. 그래서 N번째 열이 N강이 된다.
  //
  // ⚠️ 강의가 아닌 주(수련회 등)가 날짜 열로 섞여 있으면 번호가 그만큼 밀린다.
  //    그럴 때는 날짜 헤더 윗줄에 강의명을 직접 적으면 그 값이 우선한다.
  if (!fromSheet) {
    for (var j = 0; j < sessions.length; j++) out[sessions[j].date] = (j + 1) + '강';
  }

  return { map: out, fromSheet: fromSheet };
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
  // dates 는 '이 회차를 시트에서 읽었다' 는 뜻이다. 신청자가 하나도 없는
  // 회차도 들어간다 — 동기화가 그 회차의 옛 신청을 지우는 근거로 쓴다.
  var none = { byId: out, dates: [] };
  if (!sheet) return none;

  var values = sheet.getDataRange().getValues();
  var headerIdx = DG_findHeaderRow(values);
  if (headerIdx === -1) return none;

  var header = values[headerIdx];
  var idIdx = header.map(function (h) {
    return String(h).trim().toLowerCase();
  }).indexOf('id');
  if (idIdx === -1) return none;

  // 날짜 열은 출석부와 같은 방식으로 읽는다 (연도까지 확정).
  var cols = DG_buildSessions(header, tz);
  if (!cols.length) return none;

  for (var r = headerIdx + 1; r < values.length; r++) {
    var id = DG_normalizeId_(values[r][idIdx]);
    if (!id) continue;

    var map = {};
    for (var c = 0; c < cols.length; c++) {
      var cell = values[r][cols[c].col];
      var val = cell instanceof Date
        ? Utilities.formatDate(cell, tz, 'yyyy-MM-dd')
        : String(cell == null ? '' : cell).trim();
      if (DG_isLunchApplied(val)) map[cols[c].date] = 'O';
    }
    out[id] = map;
  }
  return { byId: out, dates: cols.map(function (c) { return c.date; }) };
}

/**
 * 아이디를 한 규칙으로 다듬는다.
 *
 * 아이디는 '이름+전화뒷4' 를 기대하는데, 손입력과 폼 응답이 섞여 들어온다.
 *   '김도현 5326' · '김도현-5326' · '김도현(5326)' · '김도현５３２６'
 * 기호만 지우면 전각 숫자('５３２６')는 통째로 사라져 이름만 남는다. 그러면
 * 명단과 짝이 안 맞아 그 사람의 과제가 조용히 버려진다 — 오류가 안 나서
 * 아무도 알아채지 못한다.
 *
 * ⚠️ **아이디를 만드는 곳과 맞추는 곳 모두**에 써야 한다. 한쪽만 다듬으면
 * 오히려 더 어긋난다.
 */
function DG_normalizeId_(v) {
  var s = String(v == null ? '' : v);
  // 전각 → 반각 ('５３２６' → '5326', 'Ａ' → 'A')
  s = s.replace(/[Ａ-Ｚａ-ｚ０-９]/g, function (c) {
    return String.fromCharCode(c.charCodeAt(0) - 0xFEE0);
  });
  // 자모가 풀린 채로 오면 한 글자로 합친다 ('ㄱㅣㅁ' → '김')
  if (s.normalize) s = s.normalize('NFC');
  // 한글·영문·숫자만 남긴다. 띄어쓰기·괄호·붙임표는 사람마다 달리 적는다.
  return s.replace(/[^a-zA-Z0-9가-힣]/g, '');
}

/**
 * 김밥 칸이 '신청' 인가.
 *
 * 예전에는 값이 있기만 하면 신청으로 봤다. 그래서 **X 도 신청으로 세어져**
 * 시트에는 한 명인데 화면에는 세 명으로 나왔다. 안 한다고 적은 것을 했다고
 * 읽으면 김밥을 그만큼 더 시킨다.
 *
 * 빈칸과 부정 표기만 걸러낸다. 그 밖의 표기(수량·메모 등)는 사람이 적어 둔
 * 뜻이 있을 수 있으므로 신청으로 남긴다.
 */
function DG_isLunchApplied(val) {
  var v = String(val == null ? '' : val).trim();
  if (!v) return false;
  return !/^(x|×|✕|✗|ｘ|n|no|0|영|-|－|ㅡ|–|—|\.|·|없음|안함|미신청|취소)$/i.test(v);
}

/**
 * 과제 제출 목록.
 *
 * 폼 응답 시트라 헤더 문구가 조금씩 바뀔 수 있어 부분 일치로 찾는다.
 *   타임스탬프 | Team | 아이디 | 연락처 | 성별 | 몇 강인가요? | 어떤 과제인가요? | 과제 및 소감문 제출
 *
 * '몇 강' 은 여기서 날짜로 바꾸지 않고 적힌 그대로 넘긴다.
 * 회차와 견주는 일은 앱이 sessions[].label 과 대조해서 한다 —
 * 그 이름은 시트가 직접 말해주므로 짐작할 필요가 없다.
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
    var id = DG_normalizeId_(row[iId]);
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
/**
 * 시트 → DB 동기화 워크플로를 실행한다.
 *
 * 워크플로 실행에는 GitHub 토큰이 필요한데 그 토큰을 앱에 넣을 수 없다.
 * 저장소가 공개면 JS 를 누구나 읽고, 비공개여도 브라우저에 내려간 코드는 열린다.
 * 그래서 앱 → GAS → GitHub 로 한 단계를 둔다. 토큰은 스크립트 속성에만 있다.
 */
function DG_requestSync() {
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('DG_GH_TOKEN');
  if (!token) {
    return { success: false, message: 'DG_GH_TOKEN 이 없습니다 (프로젝트 설정 → 스크립트 속성).' };
  }

  // 연타 방지. 앱에서도 막지만 주소를 직접 부르는 경우가 남는다.
  // 스크립트 속성은 쓰기가 느려서 캐시를 쓴다.
  var cache = CacheService.getScriptCache();
  if (cache.get('dg_sync_recent')) {
    return { success: false, message: '방금 요청했습니다. 1분 뒤에 다시 눌러 주세요.' };
  }

  var repo = props.getProperty('DG_GH_REPO') || DG_GH_REPO_DEFAULT;
  var wf = props.getProperty('DG_GH_WORKFLOW') || DG_GH_WORKFLOW_DEFAULT;

  var res = UrlFetchApp.fetch(
    'https://api.github.com/repos/' + repo + '/actions/workflows/' + wf + '/dispatches', {
      method: 'post',
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      // 입력은 비워서 워크플로의 기본값이 쓰이게 한다. 여기에 값을 실으면
      // dry_run 같은 옵션이 실수로 켜질 수 있다.
      payload: JSON.stringify({ ref: 'main', inputs: {} }),
      muteHttpExceptions: true
    });

  var code = res.getResponseCode();
  if (code === 204) {
    cache.put('dg_sync_recent', '1', Math.ceil(DG_SYNC_MIN_INTERVAL_MS / 1000));
    return { success: true, message: '동기화를 요청했습니다. 보통 1~2분 걸립니다.' };
  }
  // 401·404 를 나눠 보여주는 게 중요하다. 토큰이 틀렸는지, 저장소 이름이
  // 틀렸는지, 워크플로 파일명이 틀렸는지가 한 번에 갈린다.
  if (code === 401 || code === 403) {
    return { success: false, message: '토큰이 거부됐습니다 (' + code + '). 만료됐거나 권한이 없습니다.' };
  }
  if (code === 404) {
    return { success: false, message: '워크플로를 찾지 못했습니다 (' + repo + ' · ' + wf + ').' };
  }
  return { success: false, message: 'GitHub ' + code + ': ' + res.getContentText().slice(0, 200) };
}

/**
 * 권한·설정 점검. **편집기에서 ▶ 실행**해 승인 창을 띄우는 것이 목적이다.
 *
 * doGet/doPost 는 URL 로 불려서 승인 창을 띄울 자리가 없다. 권한 없이 배포되면
 * 조용히 실패한다. 이 함수를 실행해 승인한 **뒤에** 재배포할 것. 순서를 바꾸면
 * 그대로다.
 */
function DG_authorizeAndCheck() {
  var props = PropertiesService.getScriptProperties();
  var repo = props.getProperty('DG_GH_REPO') || DG_GH_REPO_DEFAULT;
  var wf = props.getProperty('DG_GH_WORKFLOW') || DG_GH_WORKFLOW_DEFAULT;
  var token = props.getProperty('DG_GH_TOKEN');
  var url = DG_prop('DG_SUPABASE_URL');
  var key = DG_prop('DG_SUPABASE_SERVICE_KEY');
  var lines = [];

  try {
    lines.push('시트 접근      : ✅ ' + SpreadsheetApp.openById(DG_SHEET_ID).getName());
  } catch (e) {
    lines.push('시트 접근      : ❌ ' + e.message);
  }

  // ⚠️ 외부 요청 확인을 GitHub 의 미인증 주소로 하면 안 된다. Google 서버 IP 는
  //    공용이라 미인증 한도에 걸려 403 이 나고, 권한 문제로 오해하게 된다.
  //    인증되는 곳(여기서는 Supabase)으로 확인한다.
  if (!url || !key) {
    lines.push('외부 요청      : ⚠️ Supabase 속성이 없어 건너뜀');
  } else {
    try {
      var sb = UrlFetchApp.fetch(url + '/rest/v1/dg_members?select=id&limit=1', {
        headers: { apikey: key, Authorization: 'Bearer ' + key },
        muteHttpExceptions: true
      });
      lines.push('외부 요청      : ' + (sb.getResponseCode() === 200 ? '✅' : '❌ ' + sb.getResponseCode()));
    } catch (e) {
      lines.push('외부 요청      : ❌ ' + e.message);
    }
  }

  if (!token) {
    lines.push('GitHub         : ❌ DG_GH_TOKEN 없음');
  } else {
    var gh = {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
    var r1 = UrlFetchApp.fetch('https://api.github.com/repos/' + repo,
                               { headers: gh, muteHttpExceptions: true });
    var c1 = r1.getResponseCode();
    if (c1 === 200) {
      lines.push('GitHub 저장소  : ✅ ' + repo);
      var r2 = UrlFetchApp.fetch(
        'https://api.github.com/repos/' + repo + '/actions/workflows/' + wf,
        { headers: gh, muteHttpExceptions: true });
      lines.push('GitHub 워크플로: ' +
        (r2.getResponseCode() === 200 ? '✅ ' + wf : '❌ ' + wf + ' 없음 (' + r2.getResponseCode() + ')'));
    } else if (c1 === 401) {
      lines.push('GitHub 저장소  : ❌ 401 토큰이 잘못됐거나 만료됐습니다');
    } else if (c1 === 404) {
      lines.push('GitHub 저장소  : ❌ 404 ' + repo + ' 없음 또는 토큰 범위에 미포함');
    } else {
      lines.push('GitHub 저장소  : ❌ ' + c1);
    }
  }

  var out = lines.join('\n');
  Logger.log(out);
  return out;
}

function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error('전송된 데이터가 없습니다.');
    }

    var body = JSON.parse(e.postData.contents);

    // 동기화 요청은 시트를 건드리지 않는다. 잠금을 잡기 전에 끝낸다 —
    // 출석 저장이 진행 중이라고 막힐 이유가 없다.
    if (body && body.action === 'sync') {
      var sync = DG_requestSync();
      return DG_json({ success: sync.success, version: DG_VERSION, message: sync.message });
    }

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
      var name = DG_normalizeId_(incoming[i].name);
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
        var rawId = DG_normalizeId_(values[r][idIdx]);
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
      var id = DG_normalizeId_(values[r][idIdx]);
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
 * 과제 아이디 점검 — 폼에 적은 아이디가 명단과 안 맞는 건을 시트에 적는다.
 *
 * 아이디가 안 맞으면 그 사람의 과제가 **조용히** 버려진다. 오류가 안 나서
 * 아무도 모르고, 본인은 냈다고 알고 있다.
 *
 * 이 목록이 왜 시트에 있어야 하는가: 지금까지는 GitHub 워크플로 로그에만
 * 남았는데, 저장소가 public 이라 그 로그에 실명을 적을 수 없다. 건수만 남기면
 * 누구를 고쳐야 할지 알 수 없다. 시트는 이름을 봐도 되는 자리이고, 고칠
 * 대상(폼 응답·명단)도 바로 여기 있다.
 *
 * 갈래를 나누는 이유는 손볼 곳이 다르기 때문이다.
 *   번호가 다름       이름은 명단에 있는데 뒤 4자리가 다르다 → 폼 응답을 고친다
 *   이름 한 글자 차이  뒤 4자리는 맞는다 ('조헤진' vs '조혜진') → 오타다
 *   명단에 없음       둘 다 안 맞는다 → 다른 기수이거나 아직 명단에 없다
 */
function DG_checkHomeworkIds() {
  var ss = SpreadsheetApp.openById(DG_SHEET_ID);
  var tz = Session.getScriptTimeZone();

  // --- 명단 ---------------------------------------------------------------
  var roster = ss.getSheetByName(DG_TAB_ROSTER);
  if (!roster) throw new Error("'" + DG_TAB_ROSTER + "' 탭이 없습니다.");
  var rv = roster.getDataRange().getValues();
  var rHead = DG_findHeaderRow(rv);
  if (rHead === -1) throw new Error("명단에 'id' 열이 없습니다.");
  var rIdIdx = rv[rHead].map(function (h) {
    return String(h).trim().toLowerCase();
  }).indexOf('id');

  var known = {};       // 정규화한 아이디 → true
  var byName = {};      // 이름 → [뒤 4자리]
  var byPhone = {};     // 뒤 4자리 → [이름]
  for (var r = rHead + 1; r < rv.length; r++) {
    var rid = DG_normalizeId_(rv[r][rIdIdx]);
    if (!rid) continue;
    known[rid] = true;
    var m = rid.match(/^(.*?)(\d{4})$/);
    if (!m) continue;
    if (!byName[m[1]]) byName[m[1]] = [];
    byName[m[1]].push(m[2]);
    if (!byPhone[m[2]]) byPhone[m[2]] = [];
    byPhone[m[2]].push(m[1]);
  }

  // --- 과제 탭 ------------------------------------------------------------
  //
  // DG_readHomework 를 쓰지 않는 이유: 그쪽은 앱에 넘길 값만 만든다.
  // 여기서는 **시트 몇 줄인지**를 알려줘야 사람이 찾아가서 고칠 수 있다.
  var hw = ss.getSheetByName(DG_TAB_HOMEWORK);
  if (!hw) throw new Error("'" + DG_TAB_HOMEWORK + "' 탭이 없습니다.");
  var hv = hw.getDataRange().getValues();
  var hHead = DG_findHeaderRowBy(hv, ['아이디', '타임스탬프', 'timestamp']);
  if (hHead === -1) throw new Error('과제 탭에서 헤더를 찾지 못했습니다.');

  var header = hv[hHead].map(function (h) { return String(h).trim().toLowerCase(); });
  var find = function (needles) {
    for (var i = 0; i < header.length; i++) {
      for (var n = 0; n < needles.length; n++) {
        if (header[i].indexOf(needles[n]) !== -1) return i;
      }
    }
    return -1;
  };
  var iId = find(['아이디']);
  var iPhone = find(['연락처']);
  var iLecture = find(['몇 강', '몇강']);
  var iTime = find(['타임스탬프', 'timestamp']);
  if (iId === -1) throw new Error('과제 탭에 아이디 열이 없습니다.');

  // 한 글자만 다른가 (바뀜·빠짐·더해짐 한 번까지)
  var oneApart = function (a, b) {
    if (Math.abs(a.length - b.length) > 1) return false;
    var i = 0, j = 0, diff = 0;
    while (i < a.length && j < b.length) {
      if (a.charAt(i) === b.charAt(j)) { i++; j++; continue; }
      if (++diff > 1) return false;
      if (a.length > b.length) i++;
      else if (a.length < b.length) j++;
      else { i++; j++; }
    }
    return diff + (a.length - i) + (b.length - j) <= 1;
  };

  var rows = [];
  var okCount = 0;
  for (var h = hHead + 1; h < hv.length; h++) {
    var raw = String(hv[h][iId] == null ? '' : hv[h][iId]).trim();
    var id = DG_normalizeId_(raw);
    if (!id) continue;

    // 앱과 같은 보완: 아이디에 번호가 없으면 연락처 뒷 4자리를 붙인다.
    // 여기서 안 맞추면 화면과 이 목록이 다른 말을 한다.
    if (iPhone !== -1 && !/\d{4}$/.test(id)) {
      var tail = String(hv[h][iPhone] == null ? '' : hv[h][iPhone]).replace(/[^0-9]/g, '').slice(-4);
      if (tail) id = id + tail;
    }

    if (known[id]) { okCount++; continue; }

    var mm = id.match(/^(.*?)(\d{4})$/);
    var name = mm ? mm[1] : id;
    var phone = mm ? mm[2] : '';
    var kind, hint;

    if (mm && byName[name]) {
      kind = '번호가 다름';
      hint = '명단은 ' + name + byName[name].join(' / ' + name);
    } else {
      var near = [];
      var cand = (mm && byPhone[phone]) || [];
      for (var c = 0; c < cand.length; c++) {
        if (oneApart(cand[c], name)) near.push(cand[c] + phone);
      }
      if (near.length) {
        kind = '이름 한 글자 차이';
        hint = '명단은 ' + near.join(' / ');
      } else {
        kind = '명단에 없음';
        hint = mm ? '' : '아이디 꼴이 아닙니다 (이름+전화 뒷 4자리)';
      }
    }

    rows.push([
      kind,
      h + 1,                       // 사람이 보는 줄 번호는 1부터
      raw,
      hint,
      iLecture !== -1 ? String(hv[h][iLecture] == null ? '' : hv[h][iLecture]).trim() : '',
      iTime !== -1 ? DG_parseWhen(hv[h][iTime], tz) : ''
    ]);
  }

  // 갈래로 묶어서 보여준다. 섞여 있으면 무엇부터 볼지 알 수 없다.
  var order = { '번호가 다름': 0, '이름 한 글자 차이': 1, '명단에 없음': 2 };
  rows.sort(function (a, b) {
    return (order[a[0]] - order[b[0]]) || (a[1] - b[1]);
  });

  DG_writeIdReport_(ss, tz, rows, okCount);
}

/**
 * 점검 결과를 '과제ID점검' 탭에 적는다. 있으면 지우고 다시 쓴다 —
 * 지난 결과가 남아 있으면 이미 고친 건까지 다시 고치려 들게 된다.
 */
function DG_writeIdReport_(ss, tz, rows, okCount) {
  var NAME = '과제ID점검';
  var sheet = ss.getSheetByName(NAME);
  if (!sheet) sheet = ss.insertSheet(NAME);
  sheet.clear();

  var when = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd HH:mm');
  var summary = {};
  for (var i = 0; i < rows.length; i++) {
    summary[rows[i][0]] = (summary[rows[i][0]] || 0) + 1;
  }
  var parts = [];
  for (var k in summary) {
    if (summary.hasOwnProperty(k)) parts.push(k + ' ' + summary[k] + '건');
  }

  var out = [
    [when + ' 점검 · 명단과 맞은 제출 ' + okCount + '건 · 안 맞은 제출 ' + rows.length + '건', '', '', '', '', ''],
    [parts.length ? parts.join(' · ') : '안 맞는 것이 없습니다.', '', '', '', '', ''],
    ['아이디가 안 맞으면 그 사람의 과제가 조용히 버려집니다 (오류가 안 나서 안 보입니다).',
      '', '', '', '', ''],
    ['', '', '', '', '', ''],
    ['갈래', '과제 탭 줄', '적힌 아이디', '명단 후보', '몇 강', '제출 시각']
  ];
  var body = rows.length ? rows : [['', '', '(없음)', '', '', '']];
  sheet.getRange(1, 1, out.length, 6).setValues(out);
  sheet.getRange(out.length + 1, 1, body.length, 6).setValues(body);

  sheet.getRange(1, 1).setFontWeight('bold');
  sheet.getRange(out.length, 1, 1, 6).setFontWeight('bold');
  sheet.setFrozenRows(out.length);
  sheet.autoResizeColumns(1, 6);

  Logger.log('과제 아이디 점검: 맞음 ' + okCount + '건 · 안 맞음 ' + rows.length +
             '건 → ' + NAME + ' 탭');
  try {
    SpreadsheetApp.getUi().alert(
      '과제 아이디 점검\n\n' +
      '맞음 ' + okCount + '건 · 안 맞음 ' + rows.length + '건\n' +
      (parts.length ? parts.join('\n') : '') +
      '\n\n자세한 내용은 \'' + NAME + '\' 탭에 적었습니다.');
  } catch (e) {
    // 메뉴가 아니라 편집기에서 실행하면 UI 가 없다. 로그로 충분하다.
  }
}

/**
 * 시트 메뉴. onOpen 은 여기서 정의하지 않는다 —
 * 한 프로젝트에 onOpen 은 하나만 살기 때문이다.
 * 기존 onOpen 안에서 DG_addMenu(SpreadsheetApp.getUi()) 를 부르면 된다.
 */
function DG_addMenu(ui) {
  ui.createMenu('DGfinder')
    .addItem('지금 DB 에 맞추기', 'DG_pushToDb')
    .addItem('과제 아이디 점검', 'DG_checkHomeworkIds')
    .addItem('10분 트리거 등록', 'DG_installTrigger')
    .addItem('권한·설정 점검', 'DG_authorizeAndCheck')
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
            var kbId = DG_normalizeId_(kbValues[kr][kbIdIdx]);
            if (!kbId) continue;
            // ⚠️ DG_isLunchApplied 를 쓴다. 예전에는 '값이 있기만 하면 O' 였는데,
            // 그러면 **안 한다고 적은 X 도 신청**으로 세어져 김밥을 더 시킨다.
            // 회차별(DG_readLunchByDate)은 v25 에서 고쳤는데 여기를 빠뜨렸다 —
            // 두 자리가 같은 규칙을 써야 카드와 요약이 어긋나지 않는다.
            kimbapMap[kbId] = DG_isLunchApplied(kbValues[kr][targetKbIdx]) ? 'O' : 'X';
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

    // 회차 이름. 시트에 적혀 있으면 그것을, 없으면 순서대로 'N강' 을 쓴다.
    var labelInfo = DG_readSessionLabels(data, headerRowIdx, sessions);
    var sessionLabels = labelInfo.map;

    // 김밥 — 회차별. 결과 카드의 한 줄(kimbapMap) 은 그대로 두고 이력을 더한다.
    var lunchInfo = DG_readLunchByDate(ss, tz);
    var lunchByDate = lunchInfo.byId;

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
      var rawId = DG_normalizeId_(data[i][idIdx]);
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
      // 담을 열을 하나씩 적는다. 시트에는 Tel · 연락처 · 결혼 · 담당교역자 같은
      // 열이 더 있는데, 그건 여기로 내보내지 않는다.
      var teamIdx = headers.indexOf('team');
      var locIdx = headers.indexOf('location');
      var roleIdx = headers.indexOf('role');
      var noIdx = headers.indexOf('no.');
      var ageIdx = headers.indexOf('age');
      // 담당교역자. 시트마다 열 이름이 조금씩 달라 몇 가지를 순서대로 본다.
      var pastorIdx = -1;
      var pastorNames = ['담당교역자', '교역자', 'pastor', '담당'];
      for (var pn = 0; pn < pastorNames.length && pastorIdx === -1; pn++) {
        pastorIdx = headers.indexOf(pastorNames[pn]);
      }
      obj['team'] = teamIdx !== -1 ? String(data[i][teamIdx]).trim() : '';
      obj['location'] = locIdx !== -1 ? String(data[i][locIdx]).trim() : '';
      obj['role'] = roleIdx !== -1 ? String(data[i][roleIdx]).trim() : '';
      obj['team_no'] = noIdx !== -1 ? String(data[i][noIdx]).trim() : '';
      // 시트에서 몇 번째 줄인가. 화면의 명단 차례를 시트와 똑같이 맞추는 데 쓴다.
      // 'No.' 열로는 안 된다 — 비어 있거나 조를 다시 짜면서 어긋난 칸이 있고,
      // 그러면 그 사람만 명단 끝으로 밀려 시트와 순서가 달라진다.
      obj['sheetRow'] = i;
      obj['age'] = ageIdx !== -1 ? String(data[i][ageIdx]).trim() : '';
      // 하차·상담을 교역자별로 나눠 보려면 이 값이 있어야 한다.
      // (연락처·결혼 같은 열은 여전히 내보내지 않는다 — 화면이 쓰는 것만 담는다)
      obj['pastor'] = pastorIdx !== -1 ? String(data[i][pastorIdx]).trim() : '';

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
      // true 면 시트에 적힌 강의명, false 면 순서로 매긴 'N강'
      sessionNamesFromSheet: labelInfo.fromSheet,
      today: todayISO,
      currentSession: currentSession,
      // [{ key:'11/02', date:'2025-11-02', label:'18강' }, ...]
      // 연도와 회차 이름을 GAS 가 확정한다. 받는 쪽은 추측하지 않는다.
      sessions: sessions.map(function (s) {
        return { key: s.key, date: s.date, label: sessionLabels[s.date] || '' };
      }),
      // 김밥 시트에서 읽은 회차 날짜. 동기화가 '시트에서 지워진 신청' 을
      // 가려내는 데 쓴다 — 신청자가 없는 회차도 들어 있어야 한다.
      lunchDates: lunchInfo.dates,
      // 과제 제출 목록. 인원마다 넣지 않고 따로 둔다 (대부분 몇 건 없다).
      homework: DG_readHomework(ss, tz),
      // 옛 동기화 스크립트 호환
      sessionDates: sessions.map(function (s) { return s.key; })
    });
  } catch (err) {
    return DG_json({ success: false, version: DG_VERSION, message: String(err.message || err) });
  }
}
