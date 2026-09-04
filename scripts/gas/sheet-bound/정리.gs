// 출석부(DB) 시트에 **직접 붙은** 스크립트. 배포 대상이 아니다.
// 저장소의 사본이므로, 고치면 시트 쪽 GAS 에도 그대로 붙여넣을 것.
// 자세한 것은 scripts/gas/sheet-bound/README.md

// 라이브러리 함수를 호출하는 래퍼(Wrapper) 함수
function runOrganizeFromLib() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  
  try {
    // 1. 실행 시작 알림 (우측 하단에 팝업)
    ss.toast('시트 정리를 시작합니다. 잠시만 기다려주세요...', '⏳ 실행 중', -1);
    
    // 커스텀 정렬 배열 (Y를 YF, YM으로 분리하고 순서 적용)
    const customOrder = ['YF', 'YM', 'C', '남', '여', 'O', 'V'];
    
    // 라이브러리 함수 실행
    SheetLib.organizeAttendanceSheet(customOrder);
    
    // 2. 완료 알림
    ss.toast('출석부 시트 정리가 완료되었습니다!(75)', '✅ 완료', 5);
    
  } catch (error) {
    // 3. 에러 발생 시 사용자에게 팝업창으로 원인 안내
    ui.alert('⚠️ 오류 발생', '시트 정리 중 문제가 발생했습니다.\n\n상세 내용: ' + error.message, ui.ButtonSet.OK);
  }
}
/*
* **기존의 시트(새A, 새B 등)**: 괄호 안에 아무것도 넣지 않거나 기존 코드를 그대로 쓰면 원래대로 가나다순으로 깔끔하게 정렬됩니다.
* **새로운 시트(Y, C 등)**: 배열을 넣어주었기 때문에 무조건 `YF -> YM -> C -> 남 -> 여 -> O -> V` 순으로 강제 정렬됩니다. C1, C2와 같은 숫자 붙은 조들도 C 파트에 올바르게 묶이고, 이름이 없는 빈 줄들도 해당 순서에 맞춰 시트 최하단에 예쁘게 그룹화됩니다!
*/

function markDolbom() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const attendSheet = ss.getActiveSheet();                  // 현재 보고 있는 시트
  const dolbomSheet = ss.getSheetByName('돌봄일정');        // ← 실제 시트명으로 변경

  // ── 1. 돌봄일정 데이터 읽기 ──────────────────────────────
  // D열: 날짜, G열: ID1, H열: ID2
  const dolbomData = dolbomSheet.getDataRange().getValues();

  // 돌봄 맵 생성: Map<날짜(시리얼), Set<ID>>
  const dolbomMap = new Map();

  for (let r = 1; r < dolbomData.length; r++) { // 1행부터 (0행=헤더)
    const dateVal = dolbomData[r][3]; // D열 (0-index: 3)
    const id1    = String(dolbomData[r][6]).trim(); // G열
    const id2    = String(dolbomData[r][7]).trim(); // H열

    if (!dateVal || !(dateVal instanceof Date)) continue;

    const dateKey = dateVal.getTime();
    if (!dolbomMap.has(dateKey)) dolbomMap.set(dateKey, new Set());
    if (id1 && id1 !== '') dolbomMap.get(dateKey).add(id1);
    if (id2 && id2 !== '') dolbomMap.get(dateKey).add(id2);
  }

// ── 2. 출석부 구조 읽기 ──────────────────────────────────
  const DATE_ROW   = 2;  // 0-index (3행)
  const ID_COL     = 9;  // 0-index (J열=10번째)
  const START_COL  = 16; // 0-index (Q열=17번째)
  const START_ROW  = 3;  // 0-index (4행부터 데이터)

  const lastRow = attendSheet.getLastRow();
  
  // 3행(날짜 행)의 실제 마지막 데이터 열을 자동으로 계산
  const lastCol = attendSheet.getLastColumn();
  const END_COL = Math.max(START_COL, lastCol - 1); // 0-index 기준 마지막 열

  // 전체 범위 한 번에 읽기
  const allData = attendSheet.getRange(1, 1, lastRow, END_COL + 1).getValues();

  // 날짜 행에서 날짜 키 배열 생성
  const dateKeys = [];
  for (let c = START_COL; c <= END_COL; c++) {
    const d = allData[DATE_ROW][c];
    dateKeys.push((d instanceof Date) ? d.getTime() : null);
  }

  // ── 3. 돌봄 표시 ─────────────────────────────────────────
  // 변경할 셀만 모아서 한 번에 setValues
  // 범위: 4행~lastRow, Q~AF
  const writeStartRow = START_ROW + 1; // 1-index (4행)
  const writeCols     = END_COL - START_COL + 1;
  const writeRows     = lastRow - START_ROW;

  // 현재 출석 값 읽기 (Q4:AF 마지막행)
  const attendRange = attendSheet.getRange(writeStartRow, START_COL + 1, writeRows, writeCols);
  const attendValues = attendRange.getValues();

  let changed = false;

  for (let r = 0; r < writeRows; r++) {
    const rowIndex = START_ROW + r; // allData 기준 index
    const id = String(allData[rowIndex][ID_COL]).trim();
    if (!id || id === '') continue;

    for (let c = 0; c < writeCols; c++) {
      const dateKey = dateKeys[c];
      if (!dateKey) continue;

      // 돌봄 해당 여부
      const isDolbom = dolbomMap.has(dateKey) && dolbomMap.get(dateKey).has(id);

      if (isDolbom) {
        const current = String(attendValues[r][c]).trim();
        // 기존 O, X 등 값이 없을 때만 쓰기 (빈칸이면 '돌봄' 기록)
        // 이미 값 있으면 덮어쓰지 않음
        if (current === '' || current === '0' || current === 'false') {
          attendValues[r][c] = '돌봄';
          changed = true;
        }
        // 이미 O/X 있는 셀은 건드리지 않음
      }
    }
  }

  if (changed) {
    attendRange.setValues(attendValues);
    SpreadsheetApp.getUi().alert('돌봄 표시 완료!');
  } else {
    SpreadsheetApp.getUi().alert('변경할 돌봄 셀이 없습니다.');
  }
}