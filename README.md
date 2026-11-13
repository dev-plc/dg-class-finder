# DGfinder — PL교회 제자훈련(DG) 조 배치 · 출석

`dgfinder.plch.kr`. 조원은 이름과 전화 뒷 4자리로 자기 조 · 장소 · 배치도 · 출석 · 과제를
확인하고, 조장은 그 자리에서 조원 출석을 저장한다. 관리자 화면은 조별 · 개인별 현황,
출석 관리, 결석 현황, 종이 출석부 출력을 맡는다.

**이어받는 사람은 [`docs/HANDOVER.md`](docs/HANDOVER.md) 부터 읽는다.** 지금 상태 · 남은 일 ·
사람이 계속 넘어진 곳이 거기 있다.

## 구조

```
원본 = 구글 시트          DB(Supabase) = 버려도 되는 사본
  ├ 출석부(DB) 탭          앱 조회는 DB 를 직접 읽는다
  ├ 김밥 탭                쓰기는 언제나 시트로 모은다 (GAS doPost)
  ├ 과제제출 탭 (폼 응답)
  └ DG링크 탭
```

| 무엇 | 어디 |
|---|---|
| 조회 화면 | `index.html` · `script.js` |
| 관리자 화면 | `admin.html` · `admin.js` |
| 데이터 계층 | `scripts/members-data.js` |
| 시트 → DB 동기화 | `scripts/sync-sheet-to-db.mjs` · `.github/workflows/sync-db.yml` |
| GAS (사본) | `scripts/gas/` — 프로젝트가 **둘**이다. `scripts/gas/README.md` |
| 검증 | `tests/` — `tests/README.md` |

배치도 이미지는 시트(DG링크 탭)에 적힌 주소를 그대로 쓴다. 구글 드라이브 파일은
`https://drive.google.com/thumbnail?authuser=0&sz=w1000&id=FILE_ID` 꼴로 적어야 깨지지 않는다.

## 문서

| | |
|---|---|
| [`docs/HANDOVER.md`](docs/HANDOVER.md) | 인수인계 — 지금 버전 · 함정 · 남은 일 |
| [`docs/RULES.md`](docs/RULES.md) | 출석 인정 · 하차 규칙의 **단일 출처** |
| [`CLAUDE.md`](CLAUDE.md) | 이 저장소에서 일하는 규칙 |
| [`scripts/gas/README.md`](scripts/gas/README.md) | GAS 설정 · 재배포 |
| [`SUPABASE_SETUP.md`](SUPABASE_SETUP.md) | DB · GitHub Secrets 설정 |

## 개발

```bash
npm install
npm test          # 화면 검증 (Playwright + 가짜 응답 — 실제 시트 · DB 로 나가지 않는다)
npm run bump      # 버전(?v=)은 이것으로만 올린다
```

배포는 GitHub Pages 가 `main` 을 그대로 내보낸다.

## 개인정보

**공개 저장소이고 사이트로 그대로 나간다.** 명단 · 연락처 · 계정 정보가 든 파일을 올리지 않는다
(`*.csv` · `data.json` 은 `.gitignore` 로 막아 두었다). `service_role` 키는 GitHub Secrets 에만 둔다.
