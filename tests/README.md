# 검증

브라우저를 실제로 띄워 화면을 확인하는 검사들이다. 단위 테스트가 아니라
**사람이 보는 화면이 그렇게 보이는지**를 본다 — 인쇄물이 A4 한 장에 들어가는지,
조 차례가 맞는지, 새로 고침이 옛 값을 덮는지 같은 것들.

```bash
npm install          # playwright (devDependency)
npx playwright install chromium   # 브라우저가 없다면
npm test             # 전부
node tests/run-all.mjs print att  # 이름에 그 글자가 든 것만
node tests/verify-print.mjs       # 하나만
```

## 무엇을 보는가

| 파일 | 무엇 |
|---|---|
| `verify-print.mjs` | 출석부 출력 — A4 한 장 안에 드는가, 집계표, 장 고르기, 김밥·과제 붙기 |
| `verify-admin.mjs` | 관리자 화면 — 검색·조별·개인별, 조 차례(YF · YM · C · 남 · 여) |
| `verify-admin-att.mjs` | 출석 관리 — 스냅숏·일괄 버튼·보호값(◎ − 돌봄) |
| `verify-attendance.mjs` | 회차 선택과 출결 저장 (바뀐 사람만 보내는가) |
| `verify-matrix.mjs` | 전체 출석표 — 조원 × 회차, 🍙 · 📝 |
| `verify-myatt.mjs` | 내 출석 현황 — 최근 10회차만 펴 두는가 |
| `verify-mobile.mjs` | 폰 크기에서 버튼·표가 깨지지 않는가 |
| `verify-sync-btn.mjs` | 시트 동기화 버튼 |
| `verify-sw.mjs` | Service Worker 자동 갱신 (배포 → 재배포 → 탭 복귀) |
| `verify-gas-lunch.mjs` | GAS 김밥 읽기 — X 를 신청으로 세지 않는가 |

## 환경변수

| | |
|---|---|
| `DG_CHROMIUM` | 크로미움 실행 파일 경로. playwright 가 찾는 것과 다를 때만 |
| `DG_SHOT_DIR` | 스크린샷을 둘 곳 (기본 `tests/.shots`) |

## 짤 때

- **Supabase·GAS 로 실제로 나가지 않는다.** `page.route` 로 가짜 응답을 준다.
  그래야 어느 컴퓨터에서든 같은 결과가 나온다.
- **날짜를 고정한다.** `page.clock.setFixedTime` 없이 '가장 가까운 주차' 같은 것을
  검사하면 오늘 통과하고 내일 깨진다.
- **고친 뒤에는 되돌려서 실패하는지 본다.** 통과만 보고 넘기면, 아무것도 검사하지
  않는 검사를 늘리게 된다.
