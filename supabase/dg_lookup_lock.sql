-- 조회를 서버로 — 2/2: 명단 · 출결 · 김밥 · 과제 · 안내방 표를 관리자만 읽게 잠근다
--
-- Supabase Dashboard → SQL Editor 에 붙여넣고 실행. 여러 번 실행해도 된다.
--
-- ⚠️ **앱 v135 가 사이트에 나간 뒤에 실행한다.** v134 까지의 조회 화면은 이 표들을 공개 키로
--    직접 읽는다 — 먼저 실행하면 조회 화면이 죽는다. v135 부터는 dg_lookup 함수만 부른다.
-- ⚠️ 1/2 (dg_lookup.sql) 와 dg_admin.sql 을 먼저 실행해 둔다.
-- ⚠️ 실행한 뒤에는 **오래 열어 둔 옛 화면**이 안 된다. 새로고침하면 새 버전이 된다.
--
-- 무엇을 하는가
--   dg_members · dg_attendance · dg_lunch · dg_homework · dg_team_links 다섯 표의 읽기를
--   '누구나'(using true)에서 **'관리자 표시가 든 로그인만'**(using dg_is_admin())으로 바꾸고,
--   anon 의 읽기 권한을 거둔다.
--   dg_sessions · dg_locations · dg_sync_log 는 그대로 공개다 — 회차 목록 · 장소 배치도 ·
--   동기화 시각은 개인정보가 아니고, 조회 화면이 로그인 없이 쓴다.
--   동기화와 GAS(service_role)는 영향이 없다.

do $$
declare
  t text;
begin
  if to_regprocedure('public.dg_is_admin()') is null then
    raise exception 'dg_is_admin() 이 없습니다 — supabase/dg_admin.sql 을 먼저 실행하세요';
  end if;
  if to_regprocedure('public.dg_lookup(text, text)') is null then
    raise exception 'dg_lookup() 이 없습니다 — supabase/dg_lookup.sql 을 먼저 실행하세요 (없이 잠그면 조회 화면이 죽는다)';
  end if;

  foreach t in array array['dg_members', 'dg_attendance', 'dg_lunch', 'dg_homework', 'dg_team_links'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', 'public read ' || t, t);
    execute format('drop policy if exists %I on public.%I', 'admin read ' || t, t);
    execute format('create policy %I on public.%I for select using (public.dg_is_admin())',
                   'admin read ' || t, t);
    -- 표 권한을 거두면 열 단위 권한(dg_members)도 함께 거둬진다.
    execute format('revoke select on table public.%I from anon', t);
  end loop;
end $$;

-- 확인 — 위 다섯 표는 anon_can_read 가 false · policy 가 'admin read …',
--        아래 세 표는 anon_can_read 가 true 여야 한다.
select c.relname as table_name,
       has_any_column_privilege('anon', c.oid, 'select') as anon_can_read,
       (select string_agg(p.polname, ', ') from pg_policy p where p.polrelid = c.oid) as policy
from pg_class c
where c.relnamespace = 'public'::regnamespace
  and c.relname in ('dg_members', 'dg_attendance', 'dg_lunch', 'dg_homework', 'dg_team_links',
                    'dg_sessions', 'dg_locations', 'dg_sync_log')
order by anon_can_read, c.relname;

-- ---------------------------------------------------------------------------
-- 되돌리기 (조회 화면이 죽었을 때 — 다섯 표를 다시 연다):
--
--   do $$ declare t text; begin
--     foreach t in array array['dg_members','dg_attendance','dg_lunch','dg_homework','dg_team_links'] loop
--       execute format('drop policy if exists %I on public.%I', 'admin read ' || t, t);
--       execute format('create policy %I on public.%I for select using (true)', 'public read ' || t, t);
--       execute format('grant select on table public.%I to anon', t);
--     end loop;
--   end $$;
--
--   그다음 dg_admin_lock.sql 을 한 번 더 실행한다 — 위가 dg_members 를 통째로 다시 열어서
--   나이 · 담당교역자까지 열린다.
-- ---------------------------------------------------------------------------
