-- dg_sync_log 추가 — 동기화가 **끝났다**는 표시 한 줄.
--
-- Supabase Dashboard → SQL Editor 에 붙여넣고 실행. 여러 번 돌려도 안전하다.
--
-- 왜 필요한가:
--   화면의 자동 새로고침이 dg_members.updated_at 을 보고 있었다. 그런데
--   동기화는 dg_members 를 **맨 먼저** 쓴다(sync-sheet-to-db.mjs). 그래서
--   출석·과제·김밥이 아직 하나도 안 들어간 시점에 새로고침이 돌았고,
--   폴링은 그 시각을 이미 본 것으로 올려 버려 **두 번째 새로고침이 영영
--   오지 않았다.** 다음 동기화(2시간 뒤)까지 옛 값을 붙들고 있었다.
--
--   dg_attendance 는 맨 마지막에 쓰이지만 그것만으로는 부족하다 — 출석이
--   하나도 안 바뀐 회차에는 아무 줄도 안 건드려 시각이 안 튄다.
--   그래서 '다 끝났다' 를 뜻하는 줄을 따로 남긴다.
--
-- 개인정보: 이름·전화는 들어가지 않는다. 건수만 남긴다.

create table if not exists dg_sync_log (
  id          bigserial primary key,
  cohort_id   text,
  finished_at timestamptz not null default now(),
  members     int,
  attendance  int,
  lunch       int,
  homework    int
);

-- 화면은 늘 '가장 최근 한 줄' 만 읽는다.
create index if not exists dg_sync_log_finished_idx
  on dg_sync_log (finished_at desc);

grant select on public.dg_sync_log to anon, authenticated;
grant all    on public.dg_sync_log to service_role;

alter table dg_sync_log enable row level security;

-- 읽기만 연다. 쓰는 것은 service_role 인 동기화 스크립트뿐이다
-- (다른 dg_* 와 같은 규칙 — 클라이언트에는 anon 키만 나간다).
drop policy if exists "public read dg_sync_log" on dg_sync_log;
create policy "public read dg_sync_log" on dg_sync_log for select using (true);
