// 출석부(DB) 시트에 **직접 붙은** 스크립트. 배포 대상이 아니다.
// 저장소의 사본이므로, 고치면 시트 쪽 GAS 에도 그대로 붙여넣을 것.
// 자세한 것은 scripts/gas/sheet-bound/README.md

/**
 * 문자열 정형화 함수 (공백 제거 및 소문자 변환)
 */
function normalizeString(str) {
  if (!str) return "";
  return String(str).replace(/\s+/g, "").toLowerCase();
}

/**
 * 수기 입력 시 작동하는 단순 트리거 (onEdit)
 */
function onEdit(e) {
  if (!e) return;
  var sheet = e.source.getActiveSheet();
  
  if (sheet.getName() !== '과제제출') return;
  
  var row = e.range.getRow();
  if (row === 1) return; 

  processAttendance(sheet, row);
}

/**
 * 구글 폼 제출 시 작동하는 트리거 (onFormSubmit)
 */
function onFormSubmit(e) {
  if (!e) return;
  var sheet = e.range.getSheet();
  
  if (sheet.getName() !== '과제제출') return;
  
  var row = e.range.getRow();
  processAttendance(sheet, row);
}

/**
 * 출석부(DB) 업데이트 핵심 로직
 */
function processAttendance(sheet, row) {
  // 1. 과제제출 시트의 데이터 가져오기 
  var rawId = sheet.getRange(row, 3).getValue(); 
  var rawLecture = sheet.getRange(row, 6).getValue();
  var assignment = sheet.getRange(row, 7).getValue();

  // 빈 값이 있거나, 제출한 과제가 '과제+소감문'이 포함되지 않은 경우 종료
  if (!rawId || !rawLecture || !assignment) return;
  if (String(assignment).indexOf('과제+소감문') === -1) return; 

  // 입력된 아이디 정형화 및 폼에서 들어온 강의명 양옆 공백 제거
  var normalizedInputId = normalizeString(rawId);
  var lecture = String(rawLecture).trim(); 

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var dbSheet = ss.getSheetByName('출석부(DB)');
  if (!dbSheet) return;

  var dbData = dbSheet.getDataRange().getValues();

  var targetRow = -1;
  var targetCol = -1;

  // 행 찾기: 출석부(DB) J열(인덱스 9)에서 정형화된 'ID' 검색
  for (var i = 3; i < dbData.length; i++) {
    var rawDbId = dbData[i][9];
    var normalizedDbId = normalizeString(rawDbId); 
    
    if (normalizedDbId !== "" && normalizedDbId === normalizedInputId) { 
      targetRow = i + 1; 
      break;
    }
  }

  // 열 찾기: 출석부(DB) 2행(인덱스 1)에서 '강의명' 검색
  for (var j = 0; j < dbData[1].length; j++) {
    // 출석부에 적힌 강의명도 양옆 공백을 제거하고 매칭 (띄어쓰기 오류 방지)
    var dbLecture = String(dbData[1][j]).trim();
    
    if (dbLecture === lecture) {
      targetCol = j + 1;
      break;
    }
  }

  // 아이디와 강의명을 출석부(DB)에서 모두 찾았을 경우
  if (targetRow !== -1 && targetCol !== -1) {
    var cell = dbSheet.getRange(targetRow, targetCol);
    var currentValue = cell.getValue();

    // 기존 값이 'X' · 'x' 인 경우에만 '과제'로 덮어쓴다.
    //
    // ⚠️ '◎'(지난 기수 이수)는 **결석이 아니다.** 덮으면 그 기록이 영영
    // 사라진다 — 되돌릴 길은 시트 버전 기록뿐이다. 조건에서 뺐다.
    if (currentValue === 'X' || currentValue === 'x') {
      cell.setValue('과제');
    }
  }
}

/**
 * 기존 과제제출 내역 전체를 읽어 출석부(DB)에 일괄 반영하는 수동 함수
 */
function syncAllAttendance() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  
  // 탭 이름이 '과제'라면 아래 이름을 '과제'로 수정하세요.
  var submitSheet = ss.getSheetByName('과제제출'); 
  var dbSheet = ss.getSheetByName('출석부(DB)');

  if (!submitSheet || !dbSheet) {
    SpreadsheetApp.getUi().alert('시트를 찾을 수 없습니다. 이름을 확인해 주세요.');
    return;
  }

  // 데이터 전체 가져오기
  var submitData = submitSheet.getDataRange().getValues();
  var dbData = dbSheet.getDataRange().getValues();

  // 처리 속도 향상을 위해 DB의 ID와 강의명 위치를 미리 딕셔너리로 저장 (캐싱)
  var idToRowMap = {};
  for (var i = 3; i < dbData.length; i++) { // 4행부터 데이터 시작 (인덱스 3)
    var rawDbId = dbData[i][9]; // J열
    var nId = normalizeString(rawDbId);
    if (nId) idToRowMap[nId] = i + 1; // 실제 시트 행 번호
  }

  var lectureToColMap = {};
  for (var j = 0; j < dbData[1].length; j++) { // 2행에 강의명 (인덱스 1)
    var lec = String(dbData[1][j]).trim();
    if (lec) lectureToColMap[lec] = j + 1; // 실제 시트 열 번호
  }

  var updateCount = 0;

  // 과제제출 시트의 2행부터 마지막 행까지 전체 루프 돌기
  for (var r = 1; r < submitData.length; r++) {
    var rawId = submitData[r][2];      // C열 (인덱스 2)
    var rawLecture = submitData[r][5]; // F열 (인덱스 5)
    var assignment = submitData[r][6]; // G열 (인덱스 6)

    // 값이 없거나 '과제+소감문'이 아니면 패스
    if (!rawId || !rawLecture || !assignment) continue;
    if (String(assignment).indexOf('과제+소감문') === -1) continue;

    // 공백 제거 및 정형화
    var nId = normalizeString(rawId);
    var targetLecture = String(rawLecture).trim();

    var targetRow = idToRowMap[nId];
    var targetCol = lectureToColMap[targetLecture];

    // DB 시트에서 ID와 강의명을 모두 찾았을 경우
    if (targetRow && targetCol) {
      // dbData 배열(메모리)에서 현재 값 확인 (0-based 인덱스 적용)
      var currentValue = dbData[targetRow - 1][targetCol - 1];
      
      // 'X' · 'x' 인 경우에만 시트에 직접 '과제' 입력.
      // ('◎' 는 지난 기수 이수라 덮지 않는다 — 위 processAttendance 주석 참고)
      if (currentValue === 'X' || currentValue === 'x') {
        dbSheet.getRange(targetRow, targetCol).setValue('과제');
        
        // 중복 업데이트 방지를 위해 메모리상 데이터도 변경
        dbData[targetRow - 1][targetCol - 1] = '과제'; 
        updateCount++;
      }
    }
  }
  
  // 작업 완료 후 팝업 알림
  SpreadsheetApp.getUi().alert(updateCount + '개의 결석 및 보충 표기가 [과제]로 일괄 변경되었습니다.');
}
