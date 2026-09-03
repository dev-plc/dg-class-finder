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
| 1 | 전체 출석표에 **다가오는 주차** 넣기 | 계획에는 있었는데 v108 에 안 들어갔다. `getSessions({ throughNext })` 를 더하면 된다 |
| 2 | 자동 새로고침 범위 | 지금은 조회·관리자 **둘 다 30초 영구 폴링**(`startAutoRefresh`). 원 요청은 '시트에서 가져오기 뒤 최대 4분'. 멈추는 길·`document.hidden` 처리가 없다 |
| 3 | 튜터에게 조원 연락처 | DB 에는 뒤 4자리만 있고 GAS 가 연락처를 일부러 안 내보낸다. anon 키 + `using(true)` 라 넣으면 사실상 공개. Supabase Auth 가 필요하다 |
| 4 | 시트에도 '과제' 를 쓸지 | `docs/RULES.md` 마지막 절 참고. 쓰면 결석 계산이 바뀐다 |

### 알려진 한계

- **관리자 인증이 sessionStorage 한 줄뿐이다.** 쓰기까지 하는 화면이라 진짜로
  막으려면 Supabase Auth 가 필요하다.
- **anon 키로 전 명단이 읽힌다** (`dg_members` RLS 가 `using (true)`).
  이름·조·위치·나이·담당교역자·전화 뒤 4자리가 여기 든다.
- 공개 저장소에 실명·전화가 든 옛 파일(`data.json`, CSV 2개)이 남아 있다 — 정리 보류.

### 사용자 쪽 할 일

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
