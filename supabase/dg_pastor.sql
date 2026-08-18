-- dg_members 에 pastor 를 더한다 (담당교역자).
--
-- 왜: 결석 현황을 교역자별로 갈라 보려는 것. 하차·상담은 교역자가 나눠 맡는데,
-- 명단이 조 순서로만 나오면 자기 몫을 매번 눈으로 골라내야 한다.
--
-- Supabase → SQL Editor 에 붙여넣고 실행. 여러 번 돌려도 안전하다.

alter table dg_members add column if not exists pastor text;

-- 교역자별로 훑는 조회에 쓴다.
create index if not exists dg_members_pastor_idx
  on dg_members (cohort_id, pastor);

-- 채우는 것은 동기화가 한다.
--   관리자 페이지 → ⟳ 시트에서 지금 가져오기
-- GAS 는 v27 이상이어야 한다 (pastor 를 내려주는 버전).
