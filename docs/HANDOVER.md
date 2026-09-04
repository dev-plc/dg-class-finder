# 인수인계 — 지금 상태

이어받는 사람(사람이든 에이전트든)이 **이 문서 하나만 읽고 시작**할 수 있게 적는다.
자세한 규칙은 `docs/RULES.md`, 작업 규칙은 `CLAUDE.md`.

---

## 이 앱이 무엇인가

PL교회 제자훈련(DG) 조 배치·출석 앱. `dgfinder.plch.kr`.

```
원본 = 구글 시트          DB(Supabase) = 버려도 되는 사본
  ├ 출석부(DB) 탭          앱 조회는 DB 를 직접 읽는다 (빠르다)
  ├ 김밥 탭                쓰기는 언제나 시트로 모은다 (GAS doPost)
  ├ 과제제출 탭 (폼 응답)
  └ DG링크 탭
```

| 화면 | 파일 | 누가 |
|---|---|---|
| 조회 | `index.html` · `script.js` | 조원·조장 (이름+전화 뒷 4자리) |
| 관리자 | `admin.html` · `admin.js` | 관리자 (⚠️ 인증이 sessionStorage 뿐) |
| 데이터 계층 | `scripts/members-data.js` | 화면은 여기만 통해 데이터를 만진다 |
| 출석표 렌더러 | `scripts/matrix-renderer.js` | 두 화면이 함께 쓴다 |
| 시트↔DB 동기화 | `scripts/sync-sheet-to-db.mjs` + `.github/workflows/sync-db.yml` | 2시간마다 |
| GAS | `scripts/gas/doGet.js` (사본) | 시트 읽기·쓰기, 10분 트리거 |

---

## ⚠️ 여기서 사람이 계속 넘어진 곳 셋

### 1. 출석표 칸 값은 `m.attendanceByDate` 에서만 읽는다

`renderTeamMatrixHTML()` 의 기본값이다. 그런데 **그 객체를 전 회차로 채우는 것은
`refreshAttendance()`(GAS 왕복) 뿐**이고, 조회 화면은 부르지만 **관리자 화면은 안 부른다**
(229명×39회차 왕복을 피하려던 결정). 관리자에는 `loadAttendanceForSession()` 이 넣은
**한 회차**만 있다.

→ 다른 곳에서 이 렌더러를 쓸 때는 **`getStatus` 를 반드시 넘긴다.**

```js
renderTeamMatrixHTML(name, members, extras, {
  getStatus: (m, d) => abHistory.get(m._uuid)?.get(d) ?? '',   // getAttendanceHistory()
});
```

안 넘기면 나머지 열이 전부 `·` 로 나오는데 **오류가 안 난다.** 게다가 같은 브라우저로
조회 화면을 먼저 열었으면 localStorage 캐시 때문에 맞아 보인다 —
**확인은 반드시 시크릿 창에서.** (v108 에서 실제로 이 사고가 났다.)

### 2. 버전은 `npm run bump` 로만 올린다

`?v=` 를 손으로/다른 도구로 붙이면 **node 전용 파일(`tests/*.mjs`,
`scripts/*.mjs`)에도 붙는다.** 브라우저가 안 받는 파일이라 쓸모가 없고, 올릴 때마다
바뀐 파일로 잡히고, 검증이 깨진다. `bump-version.mjs` 가 그 둘을 일부러 뺀다.

```
npm run bump         # +1
npm run bump:check   # 어긋난 곳만 보고 (고치지 않음)
```

### 3. GAS 재배포는 '배포 관리 → ✏️ → 새 버전'

**'새 배포' 를 누르면 URL 이 바뀌어** GitHub Secrets 의 옛 URL 이 404 가 된다.
자세한 것은 `scripts/gas/README.md`.

### 4. GAS 프로젝트가 **둘**이다

| | 어디 | 무엇 |
|---|---|---|
| `scripts/gas/doGet.js` | dev 계정의 **독립 프로젝트** (`SHEET_ID` 로 시트를 연다) | 웹앱 `doGet`/`doPost`. 앱과 Actions 가 부른다. 배포 대상 |
| `scripts/gas/sheet-bound/` | **출석부(DB) 시트에 직접 붙어 있다** | 메뉴 · `onEdit` · `onFormSubmit`. **배포 없음** |

헷갈리면 엉뚱한 쪽을 고치고 아무 일도 안 일어난다.
**시트 쪽이 출석 칸에 `'과제'` 를 쓴다** — `scripts/gas/sheet-bound/README.md` 와
`docs/RULES.md`.

### 5. 자동 새로고침은 `dg_sync_log` 하나만 본다

`dg_members.updated_at` 을 보면 안 된다. 동기화는 `dg_members` 를 **맨 먼저** 쓰고
`dg_attendance` 를 **맨 마지막**에 쓴다. 예전에는 첫 표가 끝나는 순간 새로고침이
돌았고(출석·과제가 아직 안 들어온 시점), 폴링이 그 시각을 이미 본 것으로 올려 버려
**두 번째 새로고침이 영영 오지 않았다.**

→ `sync-sheet-to-db.mjs` 가 **맨 마지막에** `dg_sync_log` 에 한 줄을 넣는다.
화면은 그 줄만 본다. 표가 없으면 `dg_attendance.updated_at` 으로 물러난다.

### 6. `dg_homework` 는 `kind` 까지 봐야 한다

`select=lecture` 만 하면 **그 강의에 제출이 하나라도 있으면** 인정으로 친다.
과제만 낸 사람이 '과제+소감문 제출' 로 읽힌다 — 실제로 그 사고가 났다.
인정 판정은 `isFullHomework()` 하나만 쓴다. `docs/RULES.md`.

### 6-2. 빈칸→X 는 두 경우를 뺀다

저장하면 손대지 않은 빈칸도 X 로 나간다(작업 #31). 다만 **어느 회차에도 기록이
없는 사람**과 **관리자에서 조를 안 골랐을 때(전체)** 는 뺀다. 명단에 갓 올라온
사람이 지난 회차 결석으로 찍히던 것이 그 경로였다. 규칙은 `docs/RULES.md`.

⚠️ 관리자 쪽 판정은 `getAttendanceHistory()` 에 기댄다. **못 받아 오면 예전대로**
동작한다 — 모른다고 빈칸을 통째로 빼면 결석자가 다시 '기록 없음' 으로 쌓인다.

### 7. 시트에서 지운 것이 DB 에서 안 지워질 수 있다

`upsert` 만 하는 표는 **한 방향 톱니바퀴**다. 시트에서 값을 지워도 DB 에 남는다.

| 표 | 정리 |
|---|---|
| `dg_lunch` | ○ (`sync-sheet-to-db.mjs` 김밥 절) |
| `dg_attendance` | ○ (이번에 넣었다. 안전장치 있음 — 많이 지우려 하면 멈춘다) |
| `dg_sessions` | **✕** — 지운 회차가 유령으로 남는다. 아직 안 고쳤다 |
| `dg_members` | 지우지 않고 `inactive` 로 내린다 (**의도한 것** — 이력 보존) |

⚠️ `dg_members` 는 `(cohort_id, name, phone)` 로 upsert 한다. 같은 기수에 같은
이름+뒤 4자리로 다시 들어오면 **같은 uuid 를 물려받아 옛 출결이 딸려 온다.**

---

## 지금 버전과 검증

```
npm test    # 15개 스위트 (tests/README.md 에 목록)
```

검증은 전부 Playwright + 가짜 응답이라 **실제 시트·DB 로 나가지 않는다.**
스크린샷은 `tests/.shots/`.

---

## 남은 일

### 결정이 필요한 것

| # | 무엇 | 왜 멈춰 있나 |
|---|---|---|
| 1 | 튜터에게 조원 연락처 | DB 에는 뒤 4자리만 있고 GAS 가 연락처를 일부러 안 내보낸다. anon 키 + `using(true)` 라 넣으면 사실상 공개. Supabase Auth 가 필요하다 |
| 2 | 과제 제출 기한 (원칙 3) | '결석한 주의 디지일 전까지' 를 앱도 시트 GAS 도 안 본다. 하려면 **양쪽을 같이** 고쳐야 한다 |
| 3 | 출석만 즉시 당겨오기 (GAS v30) | `DG_pushToDb` 를 `action:'pullAttendance'` 로 감싸는 설계까지 섰다. 반환값·짧은 락·연타 방지가 남았다 |
| 4 | 합류 시점을 담을 열 | 빈칸→X 는 '기록이 아예 없는 사람' 과 '조 전체' 를 빼서 급한 불은 껐다. 그래도 **기수 첫 회차**에는 전원이 기록이 없어 아무도 X 로 안 찍힌다. 정확히 하려면 `dg_members` 에 합류 회차/시각을 담고 동기화·백필까지 함께 가야 한다 |
| 5 | `dg_sessions` 정리 | 시트에서 지운 회차가 DB 에 유령으로 남는다 |

### 알려진 한계

- **관리자 인증이 sessionStorage 한 줄뿐이다.** 쓰기까지 하는 화면이라 진짜로
  막으려면 Supabase Auth 가 필요하다.
- **anon 키로 전 명단이 읽힌다** (`dg_members` RLS 가 `using (true)`).
  이름·조·위치·나이·담당교역자·전화 뒤 4자리가 여기 든다.
- 공개 저장소에 실명·전화가 든 옛 파일(`data.json`, CSV 2개)이 남아 있다 — 정리 보류.

### 사용자 쪽 할 일

- ✅ `supabase/dg_sync_log.sql` 실행 — **끝났다.**
- 시트 프로젝트의 **`code.gs`(v18) 삭제.** 연락처·결혼 여부까지 내보내던 v19 이전
  `doGet` 이 들어 있다 (323-327줄 `headers.forEach`). 지금은 배포돼 있지 않아 새는
  것이 없지만, 그 프로젝트에서 '배포 → 새 배포' 를 한 번 누르면 공개 URL 로 나간다.
  **지워도 나머지 세 파일은 그대로 돈다** — `SHEET_ID`·`TAB_*`·`doGet`·`doPost` 를
  참조하는 곳이 하나도 없다. 지우기 전 `배포 → 배포 관리` 가 비어 있는지만 확인할 것.
- (급하지 않음) `scripts/gas/sheet-bound/과제제출.gs` 를 시트 GAS 에 붙여넣기.
  실제 코드 차이는 `'◎'` 를 덮지 않게 한 **두 줄뿐**이고, **이 기수 시트에는 `◎` 가
  없어서 지금은 달라지는 것이 없다.** 지난 기수 이수자가 재참여해 누가 `◎` 를 적는
  날을 위한 보호다 — 그 스크립트를 다음에 손댈 때 같이 넣으면 된다.
- `scripts/gas/doGet.js` 를 GAS 에 붙여넣기 (v29). **메뉴 기능이라 재배포는 불필요** —
  시트를 새로 열면 `DGfinder → 과제 아이디 점검` 이 뜬다.

---

## 자주 하는 일

| 하고 싶은 것 | 어디를 |
|---|---|
| 출석표 칸 모양 | `scripts/matrix-renderer.js` + `style.css` 의 `.mx-*` |
| 결석·하차 세는 규칙 | `docs/RULES.md` 를 먼저 → `admin.js` 결석 현황 구역 |
| 과제 붙이는 키(강의명) | `members-data.js` `normalizeLecture()` — **한 곳뿐이다. 사본을 만들지 말 것** |
| 시트 열이 늘었다 | `scripts/gas/doGet.js` 의 `obj[...]` 목록 + `sync-sheet-to-db.mjs` |
| 종이 출석부 | `admin.js` 출력 탭 + `admin.css` `@media print` |
