-- 관리자 로그인 — 1/2: 관리자 표시와 관리자 전용 함수
--
-- Supabase Dashboard → SQL Editor 에 붙여넣고 실행. 여러 번 실행해도 된다.
--
-- ⚠️ **먼저 계정을 만든다** (이 파일은 이미 있는 계정에 표시만 붙인다):
--      Authentication → Users → Add user → Create new user
--        Email    : 관리자 메일 (실제 메일함이면 비밀번호 재설정 메일도 받을 수 있다)
--        Password : 직접 정한다. 코드 · 문서 · 채팅 어디에도 적지 않는다
--        Auto Confirm User : 켠다
--    로그인 화면에서는 '@' 앞 아이디만 쳐도 된다 — 앱이 '@plch.or.kr' 를 붙인다
--    (scripts/admin-auth.js ADMIN_EMAIL_DOMAIN). 다른 도메인이면 메일을 통째로 친다.
--    ⚠️ 어떤 메일이 관리자인지는 이 저장소에 적지 않는다 (공개 저장소다).
--       아래 3번의 v_email 한 곳만 고쳐서 실행하고, 고친 것을 커밋하지 않는다.
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
-- 관리자를 더 두려면 계정을 더 만들고 v_email 만 바꿔 이 덩어리를 한 번 더 실행한다.
-- 표시를 떼려면:  update auth.users set raw_app_meta_data = raw_app_meta_data - 'dg_admin' where email = '…';
--
-- ⚠️ 메일이 틀리면 **오류로 멈춘다.** 예전에는 update 가 조용히 0줄을 고치고 성공으로 끝나서,
--    표시가 안 붙은 줄 모르고 다음 단계로 갔다 (2026-11 실제로 그랬다).
-- ---------------------------------------------------------------------------
do $$
declare
  v_email text := '여기에_관리자_메일';   -- ← 이 한 곳만 고친다 (대시보드에서 만든 계정의 메일)
  v_count int;
begin
  update auth.users
  set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"dg_admin": true}'::jsonb
  where lower(email) = lower(v_email);
  get diagnostics v_count = row_count;

  if v_count = 0 then
    raise exception '계정을 찾지 못했습니다: %  — Authentication → Users 에 있는 메일과 글자가 같은지 보고, v_email 을 고쳐 다시 실행하세요', v_email;
  end if;
end $$;

-- 확인 — 관리자 표시가 붙은 계정 전부. **방금 넣은 메일이 보이고 confirmed 가 true 여야 한다.**
-- (confirmed 가 false 면 로그인이 안 된다 — 계정을 만들 때 Auto Confirm User 를 안 켠 것이다)
select email,
       raw_app_meta_data -> 'dg_admin' as dg_admin,
       email_confirmed_at is not null  as confirmed
from auth.users
where raw_app_meta_data -> 'dg_admin' = 'true'::jsonb
order by email;
