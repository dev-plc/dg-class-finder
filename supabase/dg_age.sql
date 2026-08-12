-- dg_members 에 age 열 추가 (기존 데이터는 그대로 둔다)
--
-- Supabase Dashboard → SQL Editor 에 붙여넣고 실행.
--
-- 관리자 화면이 나이를 보여준다. 지금까지는 게시된 CSV 를 직접 읽어서 썼는데,
-- 그 CSV 는 인증 없이 누구나 열 수 있어 명단 전체가 공개돼 있었다.
-- 관리자 화면을 Supabase 로 옮기면서 그 URL 을 버리는 대신 age 만 가져온다.
--
-- ⚠️ dg_members 는 anon 이 읽을 수 있다(RLS 공개 읽기). 즉 age 도 공개된다.
--    지금 구조에는 진짜 로그인이 없어서 관리자 화면이 보여주는 값은
--    모두 anon 으로 읽히는 값이다. 나이를 감춰야 한다면 Supabase Auth 로
--    관리자만 읽는 경로를 따로 만들어야 한다.

alter table dg_members add column if not exists age int;
