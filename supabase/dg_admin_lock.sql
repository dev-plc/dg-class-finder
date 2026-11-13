-- 관리자 로그인 — 2/2: 나이 · 담당교역자를 관리자만 읽게 잠근다
--
-- Supabase Dashboard → SQL Editor 에 붙여넣고 실행. 여러 번 실행해도 된다.
--
-- ⚠️ **앱 v134 가 사이트에 나간 뒤에 실행한다.** v133 까지의 앱은 dg_members 를
--    `select=*` 로 읽는다. 이 파일을 실행하면 `*` 요청이 통째로 거절돼(42501)
--    조회 화면이 죽는다. v134 부터는 열 이름을 적어 요청한다 (members-data.js
--    MEMBER_PUBLIC_COLUMNS).
-- ⚠️ 1/2 (dg_admin.sql) 를 먼저 실행하고, 새 비밀번호로 로그인이 되는 것을 본 뒤에 실행한다.
--    관리자 화면은 이 열을 dg_admin_member_extras 함수로 받는다.
--
-- 무엇을 하는가: dg_members 의 age · pastor 두 열만 anon · authenticated 에게서 뺀다.
-- 나머지 열 · 다른 표는 그대로다. 줄 단위 정책(RLS)은 열을 가리지 못해서 열 권한으로 한다.
-- 동기화(service_role)와 GAS(service_role)는 영향이 없다.

do $$
declare
  cols text;
begin
  -- 열 목록을 손으로 적지 않는다 — 하나 빠뜨리면 그 열을 쓰는 화면이 조용히 죽는다.
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position)
    into cols
  from information_schema.columns
  where table_schema = 'public'
    and table_name = 'dg_members'
    and column_name not in ('age', 'pastor');

  if cols is null then
    raise exception 'public.dg_members 표를 찾지 못했습니다';
  end if;

  -- 표 전체 읽기 권한을 거두면 열 단위 권한도 함께 거둬진다. 그 위에 허용할 열만 다시 준다.
  revoke select on table public.dg_members from anon, authenticated;
  execute format('grant select (%s) on table public.dg_members to anon, authenticated', cols);
end $$;

-- 확인 — age · pastor 만 false, 나머지는 true 여야 한다.
select column_name,
       has_column_privilege('anon', 'public.dg_members', column_name, 'select') as anon_can_read
from information_schema.columns
where table_schema = 'public' and table_name = 'dg_members'
order by ordinal_position;

-- ---------------------------------------------------------------------------
-- ⚠️ 나중에 dg_members 에 열을 더하면 anon 은 그 열을 못 읽는다 (위에서 준 것은 그때 있던
--    열뿐이다). 화면에서 쓸 열이면 **이 파일을 한 번 더 실행**한다 — age · pastor 만 빼고
--    전부 다시 열린다. 가려야 할 열이 늘면 위 not in (...) 목록에 더한다.
--
-- 되돌리기 (조회 화면이 죽었을 때 — 전부 다시 연다):
--   grant select on table public.dg_members to anon, authenticated;
-- ---------------------------------------------------------------------------
