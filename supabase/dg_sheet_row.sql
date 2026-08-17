-- dg_members 에 sheet_row 를 더한다 (출석부 시트의 줄 번호).
--
-- 왜: 앱의 조원 명단 차례를 시트와 똑같이 맞추려는 것.
-- 예전에는 'No.' 열(team_no)로 정렬했는데, 그 칸이 비어 있거나 조를 다시 짜면서
-- 어긋나 있으면 그 사람만 명단 맨 끝으로 밀렸다. 종이 출석부와 시트를 나란히
-- 놓고 대조할 수 없으면 출석부의 값이 떨어진다.
--
-- Supabase → SQL Editor 에 붙여넣고 실행. 여러 번 돌려도 안전하다.

alter table dg_members add column if not exists sheet_row int;

-- 정렬에 쓰는 열이라 인덱스를 둔다 (조별로 뽑을 때 team 과 함께 쓴다).
create index if not exists dg_members_order_idx
  on dg_members (cohort_id, team, sheet_row);

-- 채우는 것은 동기화가 한다.
--   관리자 페이지 → ⟳ 시트에서 지금 가져오기
-- GAS 는 v26 이상이어야 한다 (sheetRow 를 내려주는 버전).
