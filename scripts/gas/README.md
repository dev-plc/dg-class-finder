# GAS doGet 추가분

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
