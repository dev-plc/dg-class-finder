# GAS 설정

전체 코드는 `doGet.js` 다. 여기 문서는 **손으로 해야 하는 설정**만 적는다.

---

## v29 — 과제 아이디 점검 (메뉴, 배포 불필요)

`DGfinder → 과제 아이디 점검` 을 누르면 **`과제ID점검` 탭**에 결과를 적는다.
있으면 지우고 다시 쓴다 — 지난 결과가 남으면 이미 고친 것까지 또 고치게 된다.

```
2026-08-22 18:20 점검 · 명단과 맞은 제출 2854건 · 안 맞은 제출 35건
번호가 다름 12건 · 이름 한 글자 차이 3건 · 명단에 없음 20건

갈래              과제 탭 줄  적힌 아이디    명단 후보      몇 강   제출 시각
번호가 다름        128        김도현9999     명단은 김도현5326  16강  …
이름 한 글자 차이   96        조헤진5698     명단은 조혜진5698  15강  …
명단에 없음        204        차병옥DG일요일  아이디 꼴이 아닙니다 …
```

아이디가 명단과 안 맞으면 **그 사람의 과제가 조용히 버려진다.** 오류가 안 나서
아무도 모르고, 본인은 냈다고 알고 있다.

갈래를 나누는 이유는 손볼 곳이 다르기 때문이다.

| 갈래 | 뜻 | 고칠 곳 |
|---|---|---|
| 번호가 다름 | 이름은 명단에 있는데 뒤 4자리가 다르다 | 폼 응답 |
| 이름 한 글자 차이 | 뒤 4자리는 맞다 (`조헤진`↔`조혜진`) | 오타 |
| 명단에 없음 | 둘 다 안 맞다 | 다른 기수이거나 아직 명단에 없다 |

⚠️ 이 목록이 왜 GitHub 이 아니라 시트에 있는가: 저장소가 public 이라 Actions
로그는 누구나 읽는다. 거기에는 실명을 적을 수 없어 건수만 남기는데, 그러면
누구를 고쳐야 할지 알 수 없다. 시트는 이름을 봐도 되는 자리이고 고칠 대상
(폼 응답·명단)도 여기 있다.

메뉴만 쓰므로 **재배포는 필요 없다.** 붙여넣고 시트를 새로 열면 메뉴에 뜬다
(기존 `onOpen` 에서 `DG_addMenu(SpreadsheetApp.getUi())` 를 부르고 있어야 한다).

---

## v28 — 아이디 정규화 (설정 없음, 재배포만)

과제·김밥 탭의 아이디는 손입력과 폼 응답이 섞여 제각각 들어온다.

```
김도현5326   김도현 5326   김도현-5326   김도현(5326)   김도현５３２６
```

기호만 지우던 것을 한 규칙으로 다듬는다 — **전각을 반각으로 바꾸고**(５→5),
자모가 풀린 글자를 합친 뒤, 한글·영문·숫자만 남긴다. 예전에는 전각 숫자가
통째로 지워져 이름만 남았고, 명단과 짝이 안 맞아 그 사람의 과제가 조용히
버려졌다 — 오류가 안 나서 아무도 몰랐다.

⚠️ 아이디를 **만드는 자리와 맞추는 자리 전부**(출석부·김밥·과제·저장·밀어넣기)에
같은 함수를 쓴다. 한쪽만 다듬으면 오히려 더 어긋난다. 동기화 스크립트에도
같은 규칙이 들어 있어, 재배포 전이라도 짝은 맞는다.

새로 넣을 설정은 없다. `doGet.js` 를 붙여넣고 재배포하면 된다.

---

## v25 — 김밥 O/X (설정 없음, 재배포만)

김밥 칸을 **값이 있기만 하면 신청**으로 읽던 것을 고쳤다. X 도 신청으로
세어져서 시트에 1명인 조가 화면에는 3명으로 나왔다. 빈칸과 부정 표기
(`X` · `-` · `0` · `취소` · `없음` …)만 걸러내고 나머지는 그대로 신청으로 둔다.

읽은 회차 목록(`lunchDates`)도 함께 내려준다. 동기화가 **시트에서 지운 신청을
DB 에서도 지우는** 근거로 쓴다 — 예전에는 한 번 신청하면 취소해도 영영 남았다.

새로 넣을 설정은 없다. `doGet.js` 를 붙여넣고 재배포하면 된다.

```
배포 → 배포 관리 → 기존 배포의 ✏️ → 버전 "새 버전" → 배포
```

⚠️ "새 배포" 를 누르면 URL 이 바뀌어 GitHub Secrets 의 옛 URL 이 404 가 된다.

재배포한 뒤 관리자 페이지에서 `⟳ 시트에서 지금 가져오기` 를 한 번 누르면
그동안 쌓인 잘못된 신청이 정리된다.

---

## v24 — '시트에서 지금 가져오기' 버튼 설정

관리자 페이지의 버튼이 GAS 를 거쳐 GitHub Actions 동기화를 실행한다.
토큰을 앱에 넣을 수 없어서 GAS 를 한 단계 두는 것이다 — 앱 JS 는 누구나 읽는다.

```
앱 [버튼] ──POST {action:"sync"}──▶ GAS doPost ──▶ GitHub Actions ──▶ 시트를 읽어 DB 에
            (토큰 없음)              (토큰은 여기)
```

### 1. GitHub 토큰 발급

`Settings → Developer settings → Personal access tokens → Fine-grained tokens`

| 항목 | 값 |
|---|---|
| Repository access | **`dev-plc/dg-class-finder` 만** |
| Permissions | **`Actions: Read and write`** 하나면 된다 |
| Expiration | 넉넉히. 만료되면 버튼이 401 로 죽는다 |

### 2. 스크립트 속성

Apps Script 편집기 → `프로젝트 설정`(왼쪽 톱니) → `스크립트 속성`

```
DG_GH_TOKEN    = (발급받은 토큰)
DG_GH_REPO     = dev-plc/dg-class-finder     ← 없으면 기본값이 쓰인다
DG_GH_WORKFLOW = sync-db.yml                 ← .github/workflows/ 안의 파일명 (화면 제목 아님)
```

⚠️ 토큰은 스크립트 속성에만. 코드·저장소·채팅 어디에도 남기지 말 것.

### 3. 매니페스트 — ⚠️ 여기서 제일 오래 막힌다

`UrlFetchApp.fetch 을 호출할 수 있는 권한이 없습니다` 가 뜨고, **승인 창을
아무리 다시 띄워도 안 풀린다.**

GAS 는 보통 코드를 훑어 필요한 권한을 스스로 잡는데, `appsscript.json` 에
`oauthScopes` 가 적혀 있으면 **그 목록 밖의 권한은 요청조차 하지 않는다.**
승인할 것이 없으니 버튼을 눌러도 그대로다.

`프로젝트 설정` → `"appsscript.json" 매니페스트 파일을 편집기에 표시` 체크 →
파일 목록에 나타나면 이 저장소의 `scripts/gas/appsscript.json` 내용으로 맞춘다.

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/script.external_request",
  "https://www.googleapis.com/auth/script.scriptapp"
]
```

| 권한 | 쓰임 |
|---|---|
| `spreadsheets` | 출석부·김밥·과제 탭 읽기·쓰기 |
| `script.external_request` | Supabase 호출, GitHub 워크플로 실행 |
| `script.scriptapp` | 10분 트리거 등록 (`DG_installTrigger`) |

### 4. 승인 → 재배포 (순서가 중요)

`doGet`/`doPost` 는 URL 로 불려서 **승인 창을 띄울 자리가 없다.** 권한 없이
배포되면 조용히 실패한다. 사람이 편집기에서 함수를 실행해야 승인이 된다.

1. 편집기에서 **`DG_authorizeAndCheck` ▶ 실행** → 승인 창 → 허용
2. 실행 로그에서 네 줄이 전부 ✅ 인지 확인
3. **그다음** 재배포 (`배포 → 배포 관리 → ✏️ → 버전: 새 버전`)

순서를 바꾸면 그대로다. 2번에서 승인 창이 안 뜨면 이미 승인됐거나 목록이 아직
안 바뀐 것이다. 후자라면 [Google 계정 → 보안 → 타사 앱](https://myaccount.google.com/permissions)
에서 이 스크립트의 액세스를 지우고 다시 실행하면 처음부터 묻는다.

로그 예시:

```
시트 접근      : ✅ DG 출석부
외부 요청      : ✅
GitHub 저장소  : ✅ dev-plc/dg-class-finder
GitHub 워크플로: ✅ sync-db.yml
```

`401` 은 토큰, `404` 는 저장소 이름 또는 워크플로 파일명이다. 나눠 보여주는
이유가 그것이다.

---

# GAS doGet 추가분 (v18 이전 기록)

동기화 스크립트가 필요로 하는 값 두 가지를 `doGet` 응답에 더한다.
기존 로직은 건드리지 않는다.

| 필드 | 왜 필요한가 |
|---|---|
| `cohortHint` | 시트가 스스로 어느 대상인지 밝힌다. 동기화가 이 값과 대조해, 엉뚱한 대상에 명단을 밀어넣는 사고를 막는다 (다르면 아무것도 쓰지 않고 중단). |
| `sessionDates` + `attendanceByDate` | 회차별 출석을 `dg_attendance` 로 옮긴다. 없으면 출석 동기화만 건너뛰고 조회 기능은 정상 동작한다. |

## 1. 시트에 표식 적기

`출석부(DB)` 탭 **윗 6행 안쪽 아무 빈 칸**에 대상 표식을 적는다.

```
DG-2026
```

형식은 `DG-무언가` 또는 `N기`. 이 칸이 없으면 동기화가 중단되므로 반드시 적을 것.

## 2. doGet 수정

### (a) 대상 표식 읽기 — `var jsonData = [];` **앞**에 넣는다

```js
    // 시트가 스스로 밝히는 대상 표식 (윗 6행 · 왼쪽 12열 안에서 찾는다)
    var cohortHint = "";
    for (var cr = 0; cr < Math.min(6, data.length) && !cohortHint; cr++) {
      for (var cc = 0; cc < Math.min(12, data[cr].length); cc++) {
        var cv = String(data[cr][cc] || '').trim();
        if (/^DG[-\s]?\S+$/i.test(cv) || /^\d+\s*기$/.test(cv)) {
          cohortHint = cv.replace(/\s+/g, '');
          break;
        }
      }
    }
```

### (b) 날짜 헤더 모으기 — 위 블록 바로 뒤에 넣는다

```js
    // 날짜 헤더를 MM/DD 로 통일해서 모은다.
    // 시트에는 '9/6' · '09/06' · 진짜 Date 값이 섞여 들어온다.
    var sessionDates = [];
    var dateColIdx = {};   // 'MM/DD' → 열 인덱스
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
```

### (c) 멤버별 출석 맵 — 인원 루프 안, `jsonData.push(obj);` **앞**에 넣는다

```js
      // 회차별 출석 (동기화 전용. 화면은 기존 obj.attendance 를 그대로 쓴다)
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
```

### (d) 응답에 추가 — 마지막 `return` 을 이렇게 바꾼다

```js
    return output.setContent(JSON.stringify({
      success: true,
      version: currentVersion,
      data: jsonData,
      locationMap: locationMap,
      teamLinkMap: telegramMap,
      cohortHint: cohortHint,
      sessionDates: sessionDates
    }));
```

## 3. 재배포

**"새 배포" 를 누르지 말 것** — 매번 새 URL 이 생겨서 GitHub Secrets 에 든 옛 URL 이 404 가 난다.

> 배포 → **배포 관리** → 기존 배포의 **✏️(편집)** → 버전 **"새 버전"** → 배포

URL 은 그대로 유지된다. 그리고 그 URL 은 반드시 `/exec` 로 끝나야 한다.
`/dev` 는 본인만 접근할 수 있어 Actions 에서 404 다.

## 4. 확인

브라우저에서 `.../exec` 를 직접 열어 응답에 `cohortHint` 와 `sessionDates` 가
들어 있는지 본다. 그다음 Actions 에서 **dry-run** 을 먼저 돌린다.
