// DGfinder — Google Apps Script 전체 코드
//
// 이 파일은 GAS 에디터에 붙여넣는 내용의 사본이다 (버전 관리용).
// 고칠 일이 있으면 여기서 고치고 GAS 에 옮긴 뒤, 반드시 아래 방식으로 재배포한다.
//
//   배포 → 배포 관리 → 기존 배포의 ✏️ → 버전 "새 버전" → 배포
//
// "새 배포"를 누르면 URL 이 새로 생겨 GitHub Secrets 에 든 옛 URL 이 404 가 난다.
// URL 은 반드시 /exec 로 끝나야 한다. /dev 는 본인만 접근할 수 있어 Actions 에서 404 다.
//
// v18 에서 더한 것 (Supabase 동기화용. 화면 동작은 그대로다)
//   - cohortHint        시트가 스스로 밝히는 대상 표식. 동기화가 이 값과 대조해
//                       엉뚱한 대상에 명단을 밀어넣는 사고를 막는다.
//   - sessionDates      날짜 헤더를 MM/DD 로 통일해 모은 목록
//   - attendanceByDate  인원별 회차 출석. dg_attendance 로 옮길 때 쓴다.

var SHEET_ID = "1esF3oBjGq1PPMHae__LZNRgEvlwxVmNW4Ciz-qjM0zE";
var TAB_ROSTER = "출석부(DB)";
var TAB_LINKS = "DG링크";
var TAB_LUNCH = "김밥";

/**
 * 출석 저장 (POST). 이번 이관에서 바뀌지 않았다 — 출석의 원본은 여전히 시트다.
 */
function doPost(e) {
  var output = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  var currentVersion = 18;

  try {
    if (!e || !e.postData || !e.postData.contents) {
      throw new Error("웹페이지에서 전송된 데이터가 없습니다.");
    }

    var postData = JSON.parse(e.postData.contents);
    var name = String(postData.name || "").replace(/[^a-zA-Z0-9가-힣]/g, '');
    var phone = String(postData.phone || "").replace(/[^0-9]/g, '');
    var targetId = name + phone;
    var status = postData.status;

    var ss = SpreadsheetApp.openById(SHEET_ID);
    var sheet = ss.getSheetByName(TAB_ROSTER);
    if (!sheet) throw new Error("'" + TAB_ROSTER + "' 시트를 찾을 수 없습니다.");

    // 최적화: 시트 전체가 아닌 상단 영역에서 빠르게 'id' 헤더 찾기 (TextFinder)
    var idCell = sheet.getRange(1, 1, 5, 26).createTextFinder("id").matchCase(false).matchEntireCell(true).findNext();
    if (!idCell) throw new Error("'id' 열을 찾을 수 없습니다.");

    var headerRow = idCell.getRow();
    var idCol = idCell.getColumn();
    var lastCol = Math.max(sheet.getLastColumn(), 1);

    var originalHeaders = sheet.getRange(headerRow, 1, 1, lastCol).getValues()[0];

    var tz = Session.getScriptTimeZone();
    var today = new Date();

    var todayM_d = Utilities.formatDate(today, tz, "M/d");
    var todayMM_dd = Utilities.formatDate(today, tz, "MM/dd");
    var todayFull = Utilities.formatDate(today, tz, "yyyy. M. d");

    var attendanceCol = -1;

    for (var k = 0; k < originalHeaders.length; k++) {
      var hValue = originalHeaders[k];
      var hStr = "";

      // 날짜 객체일 경우 텍스트로 치환, 이미 텍스트면 그대로 사용
      if (hValue instanceof Date) {
        hStr = Utilities.formatDate(hValue, tz, "M/d");
      } else {
        hStr = String(hValue).trim();
      }

      if (hStr === todayM_d || hStr === todayMM_dd || hStr === todayFull) {
        attendanceCol = k + 1;
        break;
      }
    }

    // 날짜 컬럼이 없으면 새 열에 텍스트 포맷으로 자동 추가
    if (attendanceCol === -1) {
      attendanceCol = lastCol + 1;
      sheet.getRange(headerRow, attendanceCol).setValue("'" + todayMM_dd);
    }

    var lastRow = sheet.getLastRow();
    var isUpdated = false;

    if (lastRow > headerRow) {
      var idRange = sheet.getRange(headerRow + 1, idCol, lastRow - headerRow, 1);
      var foundCell = idRange.createTextFinder(targetId).matchEntireCell(true).findNext();

      if (foundCell) {
        sheet.getRange(foundCell.getRow(), attendanceCol).setValue(status);
        isUpdated = true;
      }
    }

    return output.setContent(JSON.stringify({
      success: isUpdated,
      version: currentVersion,
      message: isUpdated ? "출석 완료" : "ID 불일치"
    }));
  } catch (e) {
    return output.setContent(JSON.stringify({ success: false, version: currentVersion, message: e.message }));
  }
}

/**
 * 명단·링크·배치도·출석 읽기 (GET).
 */
function doGet(e) {
  var output = ContentService.createTextOutput().setMimeType(ContentService.MimeType.JSON);
  var currentVersion = 18;

  try {
    var ss = SpreadsheetApp.openById(SHEET_ID);
    var tz = Session.getScriptTimeZone();

    // =========================================================
    // [김밥 탭]
    // =========================================================
    var kimbapSheet = ss.getSheetByName(TAB_LUNCH);
    var kimbapMap = {};
    if (kimbapSheet) {
      var kbValues = kimbapSheet.getDataRange().getValues();

      var kbHeaderIdx = -1;
      for (var i = 0; i < Math.min(5, kbValues.length); i++) {
        var tempStrs = kbValues[i].map(function(h) { return String(h).trim().toLowerCase(); });
        if (tempStrs.indexOf("id") !== -1) {
          kbHeaderIdx = i;
          break;
        }
      }

      if (kbHeaderIdx !== -1) {
        var kbHeadersRaw = kbValues[kbHeaderIdx];
        var kbIdIdx = kbHeadersRaw.map(function(h) { return String(h).trim().toLowerCase(); }).indexOf("id");

        var todayStr = Utilities.formatDate(new Date(), tz, "yyyy/MM/dd");
        var tp = todayStr.split("/");
        var kbToday = new Date(parseInt(tp[0], 10), parseInt(tp[1], 10) - 1, parseInt(tp[2], 10));

        var minDiff = Infinity;
        var targetKbIdx = -1;

        for (var c = 0; c < kbHeadersRaw.length; c++) {
          if (c === kbIdIdx) continue;
          var d = kbHeadersRaw[c];
          var dateObj = null;

          if (d instanceof Date) {
            dateObj = new Date(d.getFullYear(), d.getMonth(), d.getDate());
          } else if (typeof d === 'string' && d.trim() !== "") {
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
            if (diff >= 0 && diff < minDiff) {
              minDiff = diff;
              targetKbIdx = c;
            }
          }
        }

        if (targetKbIdx !== -1 && kbIdIdx !== -1) {
          for (var r = kbHeaderIdx + 1; r < kbValues.length; r++) {
            var kbId = String(kbValues[r][kbIdIdx]).replace(/[^a-zA-Z0-9가-힣]/g, '');
            if (!kbId) continue;
            var val = String(kbValues[r][targetKbIdx]).trim();
            kimbapMap[kbId] = (val !== "") ? "O" : "X";
          }
        }
      }
    }

    // =========================================================
    // [DG링크 탭] — 조·그룹 안내방과 배치도 이미지
    // =========================================================
    var telegramSheet = ss.getSheetByName(TAB_LINKS);
    var telegramMap = {};
    var locationMap = {};
    if (telegramSheet) {
      var telValues = telegramSheet.getDataRange().getValues();
      if (telValues.length > 0) {
        var telHeaderIdx = -1, tTeamIdx = -1, tLinkIdx = -1, tLocIdx = -1, tMapIdx = -1;
        for (var i = 0; i < Math.min(5, telValues.length); i++) {
          var tempHeaders = telValues[i].map(function(h) { return String(h).trim().toLowerCase(); });
          tTeamIdx = tempHeaders.indexOf("team");
          tLinkIdx = tempHeaders.indexOf("link");
          tLocIdx = tempHeaders.indexOf("location");
          tMapIdx = tempHeaders.indexOf("map");
          if (tTeamIdx !== -1 || tLinkIdx !== -1 || tLocIdx !== -1 || tMapIdx !== -1) {
            telHeaderIdx = i; break;
          }
        }

        if (telHeaderIdx !== -1) {
          for (var r = telHeaderIdx + 1; r < telValues.length; r++) {
            if (tTeamIdx !== -1 && tLinkIdx !== -1) {
              var tName = String(telValues[r][tTeamIdx]).trim();
              if (tName) telegramMap[tName] = String(telValues[r][tLinkIdx]).trim();
            }
            if (tLocIdx !== -1 && tMapIdx !== -1) {
              var locName = String(telValues[r][tLocIdx]).trim();
              if (locName) locationMap[locName] = String(telValues[r][tMapIdx]).trim();
            }
          }
        }
      }
    }

    // =========================================================
    // [출석부(DB) 탭] — 명단 본체
    // =========================================================
    var sheet = ss.getSheetByName(TAB_ROSTER);
    var data = sheet.getDataRange().getValues();

    var headerRowIdx = -1;
    for (var i = 0; i < Math.min(5, data.length); i++) {
      var tempStrs = data[i].map(function(h) { return String(h).trim().toLowerCase(); });
      if (tempStrs.indexOf("id") !== -1) {
        headerRowIdx = i;
        break;
      }
    }

    if (headerRowIdx === -1) throw new Error("'ID' 열을 찾을 수 없습니다.");

    var originalHeadersRaw = data[headerRowIdx];

    var headers = originalHeadersRaw.map(function(h) {
      return (h instanceof Date ? Utilities.formatDate(h, tz, "M/d") : String(h)).trim().toLowerCase();
    });
    var idIdx = headers.indexOf("id");

    var today = new Date();
    var todayM_d = Utilities.formatDate(today, tz, "M/d");
    var todayMM_dd = Utilities.formatDate(today, tz, "MM/dd");
    var todayFull = Utilities.formatDate(today, tz, "yyyy. M. d");

    var todayIdx = -1;
    for (var k = 0; k < originalHeadersRaw.length; k++) {
      var hValue = originalHeadersRaw[k];
      var hStr = hValue instanceof Date ? Utilities.formatDate(hValue, tz, "M/d") : String(hValue).trim();

      if (hStr === todayM_d || hStr === todayMM_dd || hStr === todayFull) {
        todayIdx = k;
        break;
      }
    }

    // ---------------------------------------------------------
    // 대상 표식 — 시트가 스스로 어느 대상인지 밝힌다.
    //
    // 동기화가 이 값과 지정값을 대조해, 다르면 아무것도 쓰지 않고 멈춘다.
    // 표식이 없으면 엉뚱한 대상에 명단을 밀어넣는 사고를 막을 수 없다.
    // 윗 6행 · 왼쪽 12열 안에 'DG-2026' 또는 '3기' 형태로 적어 둘 것.
    // ---------------------------------------------------------
    var cohortHint = "";
    for (var cr = 0; cr < Math.min(6, data.length) && !cohortHint; cr++) {
      for (var cc = 0; cc < Math.min(12, data[cr].length); cc++) {
        var cv = String(data[cr][cc] || '').trim();
        if (/^DG[-\s]?\d{4}$/i.test(cv) || /^\d+\s*기$/.test(cv)) {
          cohortHint = cv.replace(/\s+/g, '').toUpperCase();
          break;
        }
      }
    }

    // ---------------------------------------------------------
    // 날짜 헤더 — MM/DD 로 통일해서 모은다.
    // 시트에는 '9/6' · '09/06' · 진짜 Date 값이 섞여 들어온다.
    // ---------------------------------------------------------
    var sessionDates = [];
    var dateColIdx = {};
    for (var dc = 0; dc < originalHeadersRaw.length; dc++) {
      var dv = originalHeadersRaw[dc];
      var ds = "";
      if (dv instanceof Date) {
        ds = Utilities.formatDate(dv, tz, "MM/dd");
      } else {
        var dm = String(dv).trim().match(/^(\d{1,2})\/(\d{1,2})$/);
        if (dm) {
          ds = ('0' + dm[1]).slice(-2) + '/' + ('0' + dm[2]).slice(-2);
        }
      }
      if (ds && !dateColIdx.hasOwnProperty(ds)) {
        dateColIdx[ds] = dc;
        sessionDates.push(ds);
      }
    }

    var jsonData = [];
    for (var i = headerRowIdx + 1; i < data.length; i++) {
      var rawId = String(data[i][idIdx]).replace(/[^a-zA-Z0-9가-힣]/g, '');
      if (!rawId || rawId === "") continue;

      var obj = {};
      if (rawId.length > 4) {
        obj["name"] = rawId.slice(0, -4);
        obj["phone"] = rawId.slice(-4);
      } else {
        obj["name"] = rawId;
        obj["phone"] = "";
      }

      obj["id"] = rawId;

      var attVal = (todayIdx !== -1) ? data[i][todayIdx] : "";
      obj["attendance"] = attVal instanceof Date ? Utilities.formatDate(attVal, tz, "yyyy-MM-dd") : String(attVal).trim();

      headers.forEach(function(h, idx) {
        if (h && h !== "id") {
          var cellVal = data[i][idx];
          obj[h] = cellVal instanceof Date ? Utilities.formatDate(cellVal, tz, "yyyy-MM-dd") : String(cellVal).trim();
        }
      });

      obj["telegramLink"] = telegramMap[obj["team"]] || "";
      obj["lunch"] = kimbapMap[obj["id"]] || "X";

      // 회차별 출석 — 동기화 전용. 화면은 위의 obj.attendance 를 그대로 쓴다.
      var attByDate = {};
      for (var dk in dateColIdx) {
        if (!dateColIdx.hasOwnProperty(dk)) continue;
        var dcell = data[i][dateColIdx[dk]];
        var dstr = dcell instanceof Date
          ? Utilities.formatDate(dcell, tz, "yyyy-MM-dd")
          : String(dcell).trim();
        if (dstr) attByDate[dk] = dstr;
      }
      obj["attendanceByDate"] = attByDate;

      jsonData.push(obj);
    }

    return output.setContent(JSON.stringify({
      success: true,
      version: currentVersion,
      data: jsonData,
      locationMap: locationMap,
      teamLinkMap: telegramMap,
      cohortHint: cohortHint,
      sessionDates: sessionDates
    }));
  } catch (e) {
    return output.setContent(JSON.stringify({ success: false, version: currentVersion, message: e.message }));
  }
}
