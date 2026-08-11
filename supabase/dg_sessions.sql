-- dg_sessions 추가 (기존 테이블은 건드리지 않는다)
--
-- Supabase Dashboard → SQL Editor 에 붙여넣고 실행. 이미 만들었으면 다시 안 해도 된다.
--
-- 왜 필요한가:
--   본인 출석 그리드는 '회차 목록' 과 '내 기록' 이 모두 있어야 그린다.
--   출석 기록만으로 회차를 유추하면, 기록이 없는 회차가 목록에서 통째로 빠져
--   빠진 것인지 수업이 없었던 것인지 구분할 수 없다.
--   조장 화면은 GAS 에서 회차를 받아오지만, 조원은 그 경로를 타지 않는다
--   (조회를 빠르게 두려고 Supabase 만 읽는다).

create table if not exists dg_sessions (
  cohort_id    text not null,
  session_date date not null,
  label        text,                    -- '08/09' 같은 시트 표기
  updated_at   timestamptz default now(),
  primary key (cohort_id, session_date)
);

create index if not exists dg_sessions_cohort_idx on dg_sessions(cohort_id, session_date);

grant select on public.dg_sessions to anon, authenticated;
grant all    on public.dg_sessions to service_role;

alter table dg_sessions enable row level security;

drop policy if exists "public read dg_sessions" on dg_sessions;
create policy "public read dg_sessions" on dg_sessions for select using (true);
