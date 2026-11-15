-- 조회를 서버로 — 1/2: 조회 함수와 시도 기록
--
-- Supabase Dashboard → SQL Editor 에 붙여넣고 실행. 여러 번 실행해도 된다.
--
-- 이 파일만으로는 **아무것도 안 막힌다.** 함수와 표 하나를 만들 뿐이다. 명단 · 출결 표를 실제로
-- 가리는 것은 2/2 (dg_lookup_lock.sql) 이고, 그것은 앱 v135 가 사이트에 나간 뒤에 실행한다.
-- dg_admin.sql 을 먼저 실행해 두어야 한다 (2/2 가 dg_is_admin() 을 쓴다).
--
-- 무엇을 바꾸는가
--   v134 까지 조회 화면은 열릴 때 **전원의 이름 · 뒤 4자리 · 조 · 역할**을 받아 브라우저 안에서
--   찾았다. 사이트를 여는 누구나 전 명단을 갖게 되고, 출결 · 김밥 · 과제 제출 링크도 공개 키로
--   읽혔다. 이제 이름+뒤 4자리를 **이 함수가 확인**하고 **본인 것만** 준다.
--   조장 · 서브튜터 · 관리자 역할이면 자기 조 것까지 준다.
--
-- ⚠️ 이름은 **정확히** 맞아야 한다 (공백과 한글 조합 꼴만 다듬는다). 일부 일치 · 초성을 받으면
--    뒤 4자리를 차례로 넣어 보는 것만으로 명단을 다시 긁어 갈 수 있다 — 표를 가린 뜻이 없어진다.
-- ⚠️ 조장 확인은 이름+뒤 4자리뿐이다 (비밀번호를 따로 두지 않기로 했다). 조장의 이름과 번호를
--    **아는 사람**은 그 조장처럼 조회할 수 있다. 막는 것은 명단을 모르는 바깥 사람이다.

-- ---------------------------------------------------------------------------
-- 1. 조원 명단을 볼 수 있는 역할인가
--
-- 앱(script.js 의 isTutor) · GAS(DG_isTutorRole_)와 **같은 규칙**이다 — 글자에 조장 · 서브튜터 ·
-- 관리자가 드는가. 한쪽만 바꾸면 화면은 조장으로 보는데 서버는 아니라고 하는 어긋남이 난다.
-- ---------------------------------------------------------------------------
create or replace function public.dg_is_tutor_role(p_role text)
returns boolean
language sql
immutable
as $$
  select coalesce(p_role, '') ~ '조장|서브튜터|관리자';
$$;

-- ---------------------------------------------------------------------------
-- 2. 틀린 시도 기록
--
-- 뒤 4자리는 1만 가지뿐이다. 이름을 아는 사람이 번호를 차례로 넣어 보는 것을 늦춘다.
-- **이름을 글자로 남기지 않는다** — 해시만. 맞은 조회는 적지 않는다(쓸 일이 없다).
-- 이 표는 누구에게도 읽기를 열지 않는다 (함수만 쓴다).
-- ---------------------------------------------------------------------------
create table if not exists public.dg_lookup_log (
  id        bigserial primary key,
  at        timestamptz not null default now(),
  ip        text not null default '',
  name_hash text not null default ''
);
create index if not exists dg_lookup_log_ip_idx   on public.dg_lookup_log (ip, at);
create index if not exists dg_lookup_log_name_idx on public.dg_lookup_log (name_hash, at);
create index if not exists dg_lookup_log_at_idx   on public.dg_lookup_log (at);

alter table public.dg_lookup_log enable row level security;   -- 정책 없음 = 아무도 못 읽는다
revoke all on table public.dg_lookup_log from anon, authenticated;
grant all on table public.dg_lookup_log to service_role;
grant usage, select on sequence public.dg_lookup_log_id_seq to service_role;

-- ---------------------------------------------------------------------------
-- 3. 조회
--
-- 돌려주는 것 (jsonb):
--   { found:false }                    못 찾았다
--   { found:false, limited:true }      틀린 시도가 너무 많다 — 잠시 뒤에
--   { found:true, cohort, member, links, location, sessions,
--     attendance, lunch, homework,     본인 것
--     team }                           조장 · 서브튜터 · 관리자일 때만. 아니면 null
--
-- security definer 라 표를 직접 읽는다 (2/2 뒤에는 anon 이 표를 못 읽는다). 그래서
-- **무엇을 돌려주는지가 곧 권한이다** — 여기에 줄을 더할 때는 그 사람이 봐도 되는 것인지 따질 것.
-- ---------------------------------------------------------------------------
create or replace function public.dg_lookup(p_name text, p_phone text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  -- 제한. 고치면 docs/HANDOVER.md 의 숫자도 고친다.
  c_ip_window    constant interval := interval '10 minutes';
  c_ip_max       constant int      := 20;    -- 같은 곳에서 10분에 틀린 시도
  c_name_window  constant interval := interval '1 hour';
  c_name_max     constant int      := 30;    -- 같은 이름에 1시간에 틀린 시도

  v_name    text;
  v_phone   text;
  v_cohort  text;
  v_headers json;
  v_ip      text := '';
  v_hash    text;
  v_me      public.dg_members%rowtype;
  v_team    jsonb := null;
begin
  -- 이름: 공백을 지우고 한글 조합 꼴을 맞춘다. 번호: 전각 숫자를 반각으로, 숫자만.
  v_name  := normalize(regexp_replace(coalesce(p_name, ''), '\s', '', 'g'), NFC);
  v_phone := regexp_replace(translate(coalesce(p_phone, ''), '０１２３４５６７８９', '0123456789'), '[^0-9]', '', 'g');

  -- 꼴이 안 맞는 것은 추측이 아니다 — 기록하지 않고 돌려보낸다.
  if v_name = '' or length(v_phone) <> 4 or length(v_name) > 40 then
    return jsonb_build_object('found', false);
  end if;

  -- 지금 대상(기수). 앱의 getActiveCohortId 와 같은 규칙 — 가장 최근에 갱신된 활성 인원의 것.
  select m.cohort_id into v_cohort
  from public.dg_members m
  where m.status = 'active'
  order by m.updated_at desc nulls last
  limit 1;
  if v_cohort is null then
    return jsonb_build_object('found', false);
  end if;

  -- 요청한 곳. Supabase 는 요청 머리글을 이 설정으로 넘겨준다. 못 읽으면 주소 제한만 건너뛴다.
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::json;
    v_ip := coalesce(
      nullif(trim(v_headers ->> 'cf-connecting-ip'), ''),
      nullif(trim(split_part(coalesce(v_headers ->> 'x-forwarded-for', ''), ',', 1)), ''),
      '');
  exception when others then
    v_ip := '';
  end;
  v_hash := md5(v_cohort || ':' || v_name);

  -- 틀린 시도가 쌓였으면 맞는 번호도 받지 않는다 (안 그러면 제한이 뜻이 없다).
  if v_ip <> '' and (
       select count(*) from public.dg_lookup_log l
       where l.ip = v_ip and l.at > now() - c_ip_window) >= c_ip_max then
    return jsonb_build_object('found', false, 'limited', true);
  end if;
  if (select count(*) from public.dg_lookup_log l
      where l.name_hash = v_hash and l.at > now() - c_name_window) >= c_name_max then
    return jsonb_build_object('found', false, 'limited', true);
  end if;

  select m.* into v_me
  from public.dg_members m
  where m.cohort_id = v_cohort
    and m.status = 'active'
    and m.phone = v_phone
    and normalize(regexp_replace(m.name, '\s', '', 'g'), NFC) = v_name
  order by m.team, m.team_no
  limit 1;

  if not found then
    insert into public.dg_lookup_log (ip, name_hash) values (v_ip, v_hash);
    -- 오래된 기록은 지운다. 틀린 시도가 있을 때만 도는 일이라 조회를 늦추지 않는다.
    delete from public.dg_lookup_log where at < now() - interval '2 days';
    return jsonb_build_object('found', false);
  end if;

  -- 조원 명단 — 조장 · 서브튜터 · 관리자이고 조가 있을 때만. **자기 조만.**
  if public.dg_is_tutor_role(v_me.role) and coalesce(v_me.team, '') <> '' then
    select jsonb_build_object(
      'members', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', t.id, 'name', t.name, 'phone', t.phone, 'team', t.team,
                 'team_no', t.team_no, 'sheet_row', t.sheet_row, 'location', t.location,
                 'role', t.role, 'lunch', t.lunch)
               order by t.team_no, t.name)
        from public.dg_members t
        where t.cohort_id = v_cohort and t.status = 'active' and t.team = v_me.team), '[]'::jsonb),
      'attendance', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'member_id', a.member_id, 'session_date', a.session_date, 'status', a.status)
               order by a.member_id, a.session_date)
        from public.dg_attendance a
        join public.dg_members t on t.id = a.member_id
        where t.cohort_id = v_cohort and t.status = 'active' and t.team = v_me.team), '[]'::jsonb),
      'lunch', coalesce((
        select jsonb_agg(jsonb_build_object('member_id', l.member_id, 'session_date', l.session_date)
               order by l.member_id, l.session_date)
        from public.dg_lunch l
        join public.dg_members t on t.id = l.member_id
        where t.cohort_id = v_cohort and t.status = 'active' and t.team = v_me.team
          and l.applied is true), '[]'::jsonb),
      -- 과제는 **몇 강 · 종류만.** 제출 내용(링크 · 소감문)은 조장에게도 안 준다 — 조장 화면이 안 쓴다.
      'homework', coalesce((
        select jsonb_agg(jsonb_build_object('member_id', h.member_id, 'lecture', h.lecture, 'kind', h.kind)
               order by h.member_id, h.lecture)
        from public.dg_homework h
        join public.dg_members t on t.id = h.member_id
        where t.cohort_id = v_cohort and t.status = 'active' and t.team = v_me.team), '[]'::jsonb)
    ) into v_team;
  end if;

  return jsonb_build_object(
    'found', true,
    'cohort', v_cohort,
    'member', jsonb_build_object(
      'id', v_me.id, 'name', v_me.name, 'phone', v_me.phone, 'team', v_me.team,
      'team_no', v_me.team_no, 'sheet_row', v_me.sheet_row, 'location', v_me.location,
      'role', v_me.role, 'lunch', v_me.lunch),
    -- 안내방: 자기 조 방 + 부서 방(조 이름이 아닌 줄). 다른 조 방은 안 준다.
    -- 조 이름은 명단과 링크 탭에서 따로 손으로 적어 'o1' · 'O 1' 처럼 어긋난다 — 다듬어 견준다.
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('team', k.team, 'chat_url', k.chat_url) order by k.team)
      from public.dg_team_links k
      where k.cohort_id = v_cohort
        and ( upper(regexp_replace(k.team, '\s', '', 'g')) = upper(regexp_replace(coalesce(v_me.team, ''), '\s', '', 'g'))
           or not exists (
                select 1 from public.dg_members t
                where t.cohort_id = v_cohort and t.status = 'active'
                  and upper(regexp_replace(coalesce(t.team, ''), '\s', '', 'g')) = upper(regexp_replace(k.team, '\s', '', 'g')))
            )), '[]'::jsonb),
    'location', (
      select jsonb_build_object('location', o.location, 'image_url', o.image_url, 'detail_url', o.detail_url)
      from public.dg_locations o
      where o.location = trim(coalesce(v_me.location, ''))),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object('session_date', s.session_date, 'label', s.label, 'name', s.name)
             order by s.session_date)
      from public.dg_sessions s where s.cohort_id = v_cohort), '[]'::jsonb),
    'attendance', coalesce((
      select jsonb_agg(jsonb_build_object('session_date', a.session_date, 'status', a.status)
             order by a.session_date)
      from public.dg_attendance a where a.member_id = v_me.id), '[]'::jsonb),
    'lunch', coalesce((
      select jsonb_agg(jsonb_build_object('session_date', l.session_date, 'applied', l.applied)
             order by l.session_date)
      from public.dg_lunch l where l.member_id = v_me.id), '[]'::jsonb),
    'homework', coalesce((
      select jsonb_agg(jsonb_build_object(
               'lecture', h.lecture, 'kind', h.kind, 'content', h.content, 'submitted_at', h.submitted_at)
             order by h.lecture)
      from public.dg_homework h where h.member_id = v_me.id), '[]'::jsonb),
    'team', v_team
  );
end;
$$;

-- 조회 화면은 로그인 없이 부른다 (anon). 함수 안에서 이름+번호를 확인한다.
revoke all on function public.dg_lookup(text, text) from public;
grant execute on function public.dg_lookup(text, text) to anon, authenticated;
grant execute on function public.dg_is_tutor_role(text) to anon, authenticated;

-- 확인 — 함수 둘과 표 하나가 보여야 한다.
select 'function' as kind, proname as name from pg_proc
where pronamespace = 'public'::regnamespace and proname in ('dg_lookup', 'dg_is_tutor_role')
union all
select 'table', tablename from pg_tables where schemaname = 'public' and tablename = 'dg_lookup_log'
order by 1, 2;
