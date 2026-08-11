-- dg_lunch 추가 + dg_sessions 에 label 열 (기존 테이블은 건드리지 않는다)
--
-- Supabase Dashboard → SQL Editor 에 붙여넣고 실행.
--
-- 김밥은 지금까지 '다가오는 회차 한 건' 만 봤다. 결과 카드에 한 줄 띄우는 데는
-- 충분했지만, 출석 그리드에 회차별로 표시하려면 이력이 필요하다.

create table if not exists dg_lunch (
  cohort_id    text not null,
  member_id    uuid not null references dg_members(id) on delete cascade,
  session_date date not null,
  applied      boolean not null default false,
  updated_at   timestamptz default now(),
  primary key (cohort_id, member_id, session_date)
);

create index if not exists dg_lunch_member_idx on dg_lunch(member_id, session_date);

grant select on public.dg_lunch to anon, authenticated;
grant all    on public.dg_lunch to service_role;

alter table dg_lunch enable row level security;

drop policy if exists "public read dg_lunch" on dg_lunch;
create policy "public read dg_lunch" on dg_lunch for select using (true);

-- 회차 이름 ('1강' · '교리1' 등). 시트의 날짜 헤더 윗줄에서 온다.
-- 없으면 빈 값이고, 그때는 과제를 회차에 붙이지 않는다.
alter table dg_sessions add column if not exists name text;
