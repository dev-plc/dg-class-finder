// 출석부(DB) 시트에 **직접 붙은** 스크립트. 배포 대상이 아니다.
// 저장소의 사본이므로, 고치면 시트 쪽 GAS 에도 그대로 붙여넣을 것.
// 자세한 것은 scripts/gas/sheet-bound/README.md

// 기존 스크립트의 onOpen 함수
function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('🛠️ 출석부 관리')
    .addItem('시트 자동 정리 실행', 'runOrganizeFromLib')
    .addItem('돌봄일정관리', 'markDolbom')
    .addItem('전체 결석 일괄 동기화', 'syncAllAttendance') // 드롭다운 메뉴 이름, 연결할 함수명
    .addToUi();
}