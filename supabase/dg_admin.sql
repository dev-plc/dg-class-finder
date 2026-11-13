-- 관리자 로그인 — 1/2: 관리자 표시와 관리자 전용 함수
--
-- Supabase Dashboard → SQL Editor 에 붙여넣고 실행. 여러 번 실행해도 된다.
--
-- ⚠️ **먼저 계정을 만든다** (이 파일은 이미 있는 계정에 표시만 붙인다):
--      Authentication → Users → Add user → Create new user
--        Email    : plc@dgfinder.plch.kr     (실제 메일함일 필요 없다)
--        Password : 직접 정한다. 코드 · 문서 · 채팅 어디에도 적지 않는다
--        Auto Confirm User : 켠다
--    화면에서는 지금처럼 'plc' 만 친다 — 앱이 '@dgfinder.plch.kr' 를 붙인다
--    (scripts/admin-auth.js ADMIN_EMAIL_DOMAIN).
--
-- 이 파일만으로는 **아무것도 안 막힌다.** 함수와 표시를 만들 뿐이다. 나이 · 담당교역자를
-- 실제로 가리는 것은 2/2 (dg_admin_lock.sql) 이고, 그것은 앱 v134 가 사이트에 나간 뒤에 실행한다.
--
-- 왜 app_metadata 인가: 사용자가 스스로 바꿀 수 없는 칸이다 (user_metadata 는 바꿀 수 있다).
-- 그래서 가입이 열려 있어 누가 계정을 만들더라도 관리자가 될 수는 없다. 이 표시는
-- 로그인할 때 토큰에 실리고, 아래 함수와 GAS(DG_isAdmin_)가 그것을 본다.

-- ---------------------------------------------------------------------------
-- 1. 지금 요청이 관리자의 것인가
-- ---------------------------------------------------------------------------
create or replace function public.dg_is_admin()
returns boolean
language sql
stable
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'dg_admin')::boolean, false);
$$;

grant execute on function public.dg_is_admin() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. 관리자 전용 값 — 나이 · 담당교역자
--
-- dg_members 의 age · pastor 열은 (2/2 를 실행하면) anon · authenticated 가 읽지 못한다.
-- 이 함수만이 그 값을 주고, 관리자 표시가 든 토큰일 때만 준다. 아니면 빈 목록이다.
-- security definer 라 표를 직접 읽을 수 있다 — 그래서 안에서 반드시 dg_is_admin() 을 본다.
-- ---------------------------------------------------------------------------
create or replace function public.dg_admin_member_extras(p_cohort text)
returns table (member_id uuid, age int, pastor text)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, m.age, m.pastor
  from public.dg_members m
  where m.cohort_id = p_cohort
    and public.dg_is_admin();
$$;

-- 새 함수는 기본으로 누구나 실행할 수 있게 만들어진다. 로그인한 사용자에게만 남긴다
-- (그 안에서 관리자인지 다시 본다).
revoke all on function public.dg_admin_member_extras(text) from public, anon;
grant execute on function public.dg_admin_member_extras(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. 계정에 관리자 표시
--
-- 관리자를 더 두려면 계정을 더 만들고 아래 where 의 메일만 바꿔 한 번 더 실행한다.
-- 표시를 떼려면:  raw_app_meta_data - 'dg_admin'
-- ---------------------------------------------------------------------------
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"dg_admin": true}'::jsonb
where email = 'plc@dgfinder.plch.kr';

-- 확인 — **한 줄이 나오고 dg_admin 이 true 여야 한다.**
-- 아무 줄도 안 나오면 계정이 아직 없는 것이다. 맨 위대로 계정을 만들고 이 파일을 다시 실행한다.
select email,
       raw_app_meta_data -> 'dg_admin' as dg_admin,
       email_confirmed_at is not null  as confirmed
from auth.users
where email = 'plc@dgfinder.plch.kr';
