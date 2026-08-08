-- DGfinder — Supabase schema (조회 전용)
--
-- plc-class-finder 와 같은 Supabase 프로젝트에 얹는다.
-- 테이블 이름은 전부 dg_ 로 시작해 기존 테이블(members, cohorts …)과 충돌하지 않는다.
--
-- Supabase Dashboard → SQL Editor 에 붙여넣고 실행.
-- 재실행 안전: drop 후 재생성한다. 운영 데이터가 들어간 뒤에는 실행하지 말 것.

drop table if exists dg_attendance cascade;
drop table if exists dg_team_links cascade;
drop table if exists dg_locations  cascade;
drop table if exists dg_members    cascade;

-- ===================================================================
-- 1. Tables
-- ===================================================================

create table dg_members (
  id         uuid primary key default gen_random_uuid(),
  cohort_id  text not null,             -- 시트가 스스로 밝힌 대상 표식 ('DG-2026' 등)
  name       text not null,
  -- 전화 뒷 4자리. null 을 넣으면 아래 unique 가 걸리지 않아
  -- 동기화할 때마다 같은 사람의 새 행이 쌓인다. 반드시 빈 문자열로.
  phone      text not null default '',
  team       text,
  team_no    int,                       -- 조 내 순번 (시트 순서 보존용)
  location   text,
  role       text,                      -- 조장/서브튜터/관리자 — 조원 명단 노출 판정에 쓴다
  lunch      text not null default '',  -- 김밥 O/X — 결과 카드에 고정 노출
  status     text not null default 'active',
  updated_at timestamptz default now(),
  unique (cohort_id, name, phone)
);

create table dg_locations (
  location   text primary key,
  image_url  text,
  detail_url text,
  updated_at timestamptz default now()
);

-- 조별 안내방과 그룹 안내방(청년부·온라인·청년부부·남장년부·여장년부)이
-- 시트에서 같은 표에 있으므로 여기서도 한 테이블에 담는다.
create table dg_team_links (
  cohort_id text not null,
  team      text not null,
  chat_url  text,
  primary key (cohort_id, team)
);

-- 출석은 이번 범위에서 '읽기 전용'이다.
-- 쓰기는 기존대로 앱 → GAS → 시트로 가고, 이 표는 시트를 비추기만 한다.
create table dg_attendance (
  member_id    uuid references dg_members(id) on delete cascade,
  session_date date,
  status       text,                    -- O/X/빈값
  updated_at   timestamptz default now(),
  primary key (member_id, session_date)
);

-- ===================================================================
-- 2. Indexes
-- ===================================================================

create index dg_members_cohort_team_idx on dg_members(cohort_id, team);
create index dg_members_cohort_name_idx on dg_members(cohort_id, name);
create index dg_attendance_date_idx     on dg_attendance(session_date);

-- ===================================================================
-- 3. GRANTs
--
-- service_role 은 RLS 를 우회하지만, 프로젝트의 auto-expose 가 꺼져 있으면
-- GRANT 가 없어 'permission denied for table ...' 이 난다. 명시적으로 준다.
-- ===================================================================

grant select on public.dg_members    to anon, authenticated;
grant select on public.dg_locations  to anon, authenticated;
grant select on public.dg_team_links to anon, authenticated;
grant select on public.dg_attendance to anon, authenticated;

grant all on public.dg_members    to service_role;
grant all on public.dg_locations  to service_role;
grant all on public.dg_team_links to service_role;
grant all on public.dg_attendance to service_role;

-- ===================================================================
-- 4. Row Level Security — 읽기만 열고 쓰기는 막는다
-- ===================================================================

alter table dg_members    enable row level security;
alter table dg_locations  enable row level security;
alter table dg_team_links enable row level security;
alter table dg_attendance enable row level security;

create policy "public read dg_members"    on dg_members    for select using (true);
create policy "public read dg_locations"  on dg_locations  for select using (true);
create policy "public read dg_team_links" on dg_team_links for select using (true);
create policy "public read dg_attendance" on dg_attendance for select using (true);

-- 쓰기 정책은 만들지 않는다. 동기화는 service_role 키로만 한다.

-- ===================================================================
-- 5. updated_at 자동 갱신
-- ===================================================================

create or replace function dg_set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger dg_members_set_updated_at
  before update on dg_members
  for each row execute function dg_set_updated_at();

create trigger dg_locations_set_updated_at
  before update on dg_locations
  for each row execute function dg_set_updated_at();

create trigger dg_attendance_set_updated_at
  before update on dg_attendance
  for each row execute function dg_set_updated_at();
