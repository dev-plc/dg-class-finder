# DGfinder — Supabase 조회 이관 셋업

조회 경로만 Supabase 로 옮긴 상태다. 출석 쓰기는 여전히 시트(GAS)가 원본이다.

## 프로젝트는 plc 와 따로 판다

교육과정도 시트도 별개이고, 무엇보다 **한쪽의 `service_role` 키가 새더라도
다른 쪽 명단·출석에 닿지 않게** 하려는 것이다. 공유하면 DGfinder 의 Actions 시크릿이
plc 의 실명·연락처·출석 이력까지 읽고 쓸 수 있게 된다.

무료 티어는 조직당 프로젝트 2개까지라 plc + DG 는 그대로 들어간다.

---

## 1. Supabase

1. 새 프로젝트 생성 (region 은 `Northeast Asia (Seoul)` 권장)
2. SQL Editor 에서 `supabase/dg_schema.sql` 실행
3. Settings → API 에서 두 값을 `scripts/supabase-config.js` 에 붙여넣기
   - `SUPABASE_URL`
   - `anon` `public` 키 → `SUPABASE_ANON_KEY`

`service_role` 키는 이 파일에 넣지 않는다. 저장소가 public 이다.

## 2. GAS

`scripts/gas/README.md` 대로 `doGet` 에 네 군데를 추가한다
(`cohortHint`, `sessionDates`, `attendanceByDate`, 그리고 응답에 두 필드 추가).

재배포는 **"배포 관리 → ✏️ → 새 버전"**. "새 배포"를 누르면 URL 이 새로 생겨
시크릿에 든 옛 URL 이 404 가 난다. URL 은 반드시 `/exec` 로 끝나야 한다.

### GAS 스크립트 속성

에디터 왼쪽 **⚙️ 프로젝트 설정 → 스크립트 속성**. 시트가 아니라 스크립트
프로젝트에 붙는 값이고, 저장소에는 들어가지 않는다.

| 이름 | 필요한가 | 값 |
|---|---|---|
| `DG_SUPABASE_URL` | 필요 | 프로젝트 URL |
| `DG_SUPABASE_SERVICE_KEY` | 필요 | `service_role` 키 |
| `DG_START_YEAR` | **보통 불필요** | 첫 회차의 연도 |

`DG_START_YEAR` 은 못박고 싶을 때만 쓴다. 헤더 칸이 진짜 날짜 값이면 GAS 가
그 연도를 그대로 쓰고, 글자 `MM/DD` 만 있을 때도 앞선 날짜 칸에서 연도를
이어받는다. 시트에 날짜 칸이 하나도 없고 학기가 해를 넘길 때만 지정하면 된다.

### 10분 트리거

에디터에서 `DG_installTrigger` 를 한 번 실행한다. 시트를 사람이 직접 고친 것과
doPost 의 밀어넣기가 실패한 건을 `DG_pushToDb` 가 10분마다 메운다.

## 3. 시트

`출석부(DB)` 탭 **윗 6행 안쪽 아무 빈 칸**에 대상 표식을 적는다.

```
DG-2026
```

이 표식이 없으면 동기화가 중단된다. 엉뚱한 대상에 명단을 밀어넣어
기존 인원이 통째로 `inactive` 가 되는 사고를 구조적으로 막기 위한 것이다.

## 4. GitHub Secrets

Settings → Secrets and variables → Actions

| 이름 | 값 |
|---|---|
| `SUPABASE_URL` | 새 DG 프로젝트 URL |
| `SUPABASE_SERVICE_ROLE_KEY` | 새 DG 프로젝트의 `service_role` 키 |
| `GAS_API_URL` | 기존 GAS `/exec` URL |

## 5. 동기화 — dry-run 먼저

Actions → **시트 → DB 동기화** → Run workflow

1. **`dry_run` 체크**하고 실행 → 인원 수·위치·안내방 건수, "건너뜀" 명단 확인
2. 숫자가 맞으면 체크 해제하고 다시 실행

이후 **2시간마다** 자동으로 돈다 (Supabase 7일 pause 방지 겸용).

과제·김밥·명단은 이 워크플로로만 DB 에 들어온다 — GAS 의 10분 트리거는
출석만 민다. 하루 한 번이던 때는 낮에 낸 과제가 다음 날까지 앱에 안 보였다.

---

## 알아둘 것

**동기화는 upsert 만 한다.** 시트에서 지운 행은 DB 에 남는다.
시트를 정리했으면 DB 쪽도 지우고 다시 동기화해야 맞는다.
단 **인원은 삭제하지 않고 `status='inactive'`** 로 내린다 — 이력을 잃지 않으려는 것.

**출석은 이번 범위 밖이다.** 원본은 시트이고 쓰기는 GAS 로 간다.
`dg_attendance` 는 시트를 비추기만 한다. DB 값은 시트보다 뒤처질 수 있으므로
(워크플로 2시간 · GAS 트리거 10분), 조원 명단을 열 때는 시트에서 다시 읽는다.

**캐시 버전.** 프론트엔드 파일을 고쳤으면 배포 전에 이것 하나만 돌린다.

```
npm run bump
```

저장소 전체의 `?v=` 와 `sw.js` 의 `CACHE_VERSION` 을 한 번에 올리고, 빠진 곳이
없는지 스스로 확인한다. **손으로 고치지 말 것** — 한 곳만 빠뜨려도 그 파일만
옛것이 나오고, 원인을 찾는 데 오래 걸린다.

`npm run bump:check` 는 올리지 않고 어긋난 곳만 알려준다.

**저장소가 public 이다.** 실명·전화번호가 든 파일을 커밋하지 않는다.
Actions 로그도 누구나 볼 수 있다는 점을 감안할 것.
