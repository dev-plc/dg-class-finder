-- dg_homework 추가 (기존 테이블은 건드리지 않는다)
--
-- Supabase Dashboard → SQL Editor 에 붙여넣고 실행.
--
-- '과제제출' 탭(폼 응답)을 그대로 비춘다.
--   타임스탬프 | Team | 아이디 | 연락처 | 성별 | 몇 강인가요? | 어떤 과제인가요? | 과제 및 소감문 제출
--
-- lecture 를 회차 날짜로 바꾸지 않는 이유:
--   39회차 중 몇 번째가 몇 강인지 시트가 말해주지 않는다. 순서로 짐작하면
--   엉뚱한 회차에 붙는다. 적힌 그대로 두고 화면에서도 그대로 보여준다.

create table if not exists dg_homework (
  cohort_id    text not null,
  member_id    uuid not null references dg_members(id) on delete cascade,
  lecture      text not null default '',   -- '몇 강인가요?' 원본
  kind         text not null default '',   -- '어떤 과제인가요?'
  content      text,                       -- 제출한 링크·내용
  submitted_at timestamptz,
  updated_at   timestamptz default now(),
  -- 같은 사람이 같은 강·같은 종류를 다시 내면 나중 것이 이긴다
  primary key (cohort_id, member_id, lecture, kind)
);

create index if not exists dg_homework_member_idx on dg_homework(member_id, submitted_at);

grant select on public.dg_homework to anon, authenticated;
grant all    on public.dg_homework to service_role;

alter table dg_homework enable row level security;

drop policy if exists "public read dg_homework" on dg_homework;
create policy "public read dg_homework" on dg_homework for select using (true);
