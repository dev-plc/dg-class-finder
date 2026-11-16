// DB 검증 — supabase/*.sql 을 **실제 Postgres 에** 돌려 본다.
//
// 화면 검증은 전부 가짜 응답이다. 그래서 SQL 이 맞는지 — 누가 무엇을 읽을 수 있는지 — 는
// Supabase 에 붙여 넣어 봐야 알 수 있었다. 여기서는 버리는 DB 를 띄워 저장소의 SQL 을 차례로
// 실행하고, anon(로그인 없음) · authenticated(로그인) · 관리자 · service_role(동기화)로 직접 묻는다.
//
// 보는 것
//   · 조회 함수 dg_lookup — 정확한 이름+번호만 · 본인 것만 · 조장은 자기 조만 · 틀린 시도 제한
//   · 잠근 뒤 — anon 이 명단 표를 못 읽는다 · 조회 함수는 된다 · 관리자는 읽는다
//   · 관리자 표시 SQL · 나이/교역자 잠금 (2단계 것도 여기서 처음으로 진짜 돌려 본다)
//   · 실제 규모에서 조회가 얼마나 걸리는가
//
// Postgres 가 없는 곳에서는 건너뛴다 — 그때는 **건너뛰었다고 크게 말한다.**

import { join } from 'node:path';
import { ROOT, makeReporter } from './lib/harness.mjs';
import { startTempPostgres } from './lib/pg.mjs';

const { ok, done } = makeReporter('DB (실제 Postgres)');

let db = null;
try {
  db = startTempPostgres();
} catch (err) {
  console.log('❌ 임시 Postgres 를 띄우지 못했습니다: ' + err.message);
  process.exit(1);
}
if (!db) {
  console.log('');
  console.log('⚠️ ⚠️ ⚠️  Postgres 가 없어 DB 검증을 **건너뜁니다.**');
  console.log('          supabase/*.sql 은 이 실행에서 확인되지 않았습니다.');
  console.log('          (initdb · pg_ctl · psql 이 있는 폴더를 DG_PG_BIN 으로 알려 주면 돕니다)');
  console.log('');
  process.exit(0);
}

const S = (f) => join(ROOT, 'supabase', f);
const one = (r) => r.rows[0];
const json = (r) => JSON.parse(r.out);
const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;

try {
  // ==========================================================================
  // 0. 저장소의 SQL 을 실제 순서대로 — 표 → 2단계(관리자) → 3단계(조회)
  // ==========================================================================
  for (const f of ['dg_schema.sql', 'dg_sessions.sql', 'dg_lunch.sql', 'dg_homework.sql',
                   'dg_age.sql', 'dg_pastor.sql', 'dg_sheet_row.sql', 'dg_sync_log.sql']) {
    db.sqlFile(S(f));
  }
  ok('표를 만드는 SQL 이 전부 돈다', true);

  // --- 실제 규모의 자료 -------------------------------------------------------
  // 261명 · 39회차 · 과제 5천여 건. Y1 은 30명짜리 조 (조장 조회가 가장 무거운 경우).
  db.sql(`
    insert into dg_members (cohort_id, name, phone, team, team_no, sheet_row, location, role, lunch, status, age, pastor)
    values
      ('DG-2026', '김조장', '1111', 'Y1', 1, 6, '웨슬리홀', '조장',     'O', 'active', 41, '이목사'),
      ('DG-2026', '이조원', '2222', 'Y1', 2, 7, '웨슬리홀', '조원',     'X', 'active', 33, '이목사'),
      ('DG-2026', '박다른', '3333', 'Y2', 1, 40, '칼빈',    '조장',     'O', 'active', 52, '김목사'),
      ('DG-2026', '최조원', '4444', 'Y2', 2, 41, '칼빈',    '',         'X', 'active', 29, '김목사'),
      ('DG-2026', '정서브', '5551', 'Y2', 3, 42, '칼빈',    '서브튜터', 'X', 'active', 30, '김목사'),
      ('DG-2026', '오관리', '5552', 'Y2', 4, 43, '칼빈',    '관리자',   'X', 'active', 30, '김목사'),
      ('DG-2026', '공 백',  '6666', 'Y2', 5, 44, '칼빈',    '조원',     'X', 'active', 30, '김목사'),
      ('DG-2026', '나간이', '7777', 'Y1', 3, 8, '웨슬리홀', '조원',     'X', 'inactive', 30, '이목사'),
      ('DG-2026', '조없는장', '8888', '', 9, 99, '칼빈',    '조장',     'X', 'active', 30, '김목사');
    -- 채우기: Y1 을 30명으로, 나머지는 T1~T32 에 나눠 총 261명(활성)
    insert into dg_members (cohort_id, name, phone, team, team_no, sheet_row, location, role, lunch, status, age, pastor)
    select 'DG-2026', '사람' || g, lpad((g + 2000)::text, 4, '0'),
           case when g <= 28 then 'Y1' else 'T' || ((g % 32) + 1) end,
           g + 10, g + 100, '웨슬리홀', '조원', 'O', 'active', 20 + (g % 50), '최목사'
    from generate_series(1, 253) g;
    -- 지난 기수 — 같은 이름+번호가 있어도 지금 기수가 아니면 안 나와야 한다
    insert into dg_members (cohort_id, name, phone, team, role, status, updated_at)
    values ('DG-2025', '옛기수', '9999', 'Y1', '조장', 'active', now() - interval '300 days');

    insert into dg_sessions (cohort_id, session_date, label, name)
    select 'DG-2026', d::date, to_char(d, 'MM/DD'), (row_number() over (order by d)) || '강'
    from generate_series('2026-03-29'::date, '2026-12-20'::date, interval '7 days') d;

    insert into dg_attendance (member_id, session_date, status)
    select m.id, s.session_date, case when (m.team_no + extract(doy from s.session_date)::int) % 4 = 0 then 'X' else 'O' end
    from dg_members m
    join dg_sessions s on s.cohort_id = m.cohort_id and s.session_date <= '2026-11-08'
    where m.cohort_id = 'DG-2026';

    insert into dg_lunch (cohort_id, member_id, session_date, applied)
    select 'DG-2026', m.id, s.session_date, (m.team_no % 3 <> 0)
    from dg_members m
    join dg_sessions s on s.cohort_id = m.cohort_id and extract(day from s.session_date)::int % 4 = 1
    where m.cohort_id = 'DG-2026';

    insert into dg_homework (cohort_id, member_id, lecture, kind, content, submitted_at)
    select 'DG-2026', m.id, n || '강', case when (m.team_no + n) % 3 = 0 then '과제+소감문' else '과제' end,
           'https://drive.google.com/open?id=secret-' || m.phone || '-' || n, now()
    from dg_members m cross join generate_series(1, 20) n
    where m.cohort_id = 'DG-2026';

    insert into dg_team_links (cohort_id, team, chat_url) values
      ('DG-2026', 'y 1',     'https://t.me/y1-room'),      -- 명단은 'Y1' — 손으로 적어 어긋난 꼴
      ('DG-2026', 'Y2',      'https://t.me/y2-room'),
      ('DG-2026', '청년부',   'https://t.me/group-youth'),
      ('DG-2026', '온라인DG', 'https://t.me/group-online'),
      ('DG-2026', '온라인',   'https://t.me/group-online-old'),   -- 같은 이름의 조가 명단에 있다
      ('DG-2026', 'T5',      'https://t.me/t5-room');            -- 남의 조 방
    insert into dg_members (cohort_id, name, phone, team, team_no, location, role, status)
    values ('DG-2026', '온라인조장', '4321', '온라인', 1, '칼빈', '조장', 'active');
    insert into dg_locations (location, image_url, detail_url) values
      ('웨슬리홀', 'https://example.org/wesley.jpg', 'https://example.org/wesley'),
      ('칼빈',     'https://example.org/calvin.jpg', null);
    insert into dg_sync_log (cohort_id, members, attendance, lunch, homework) values ('DG-2026', 261, 1, 1, 1);
    analyze;
  `);
  const counts = one(db.sql(`select (select count(*) from dg_members where cohort_id='DG-2026' and status='active')
      || ' · ' || (select count(*) from dg_sessions) || ' · ' || (select count(*) from dg_attendance)
      || ' · ' || (select count(*) from dg_homework)`));
  ok('실제 규모의 자료 (활성 인원 · 회차 · 출석 · 과제)', /^262 · 39 · \d{4,} · 5\d{3}$/.test(counts), counts);

  // ==========================================================================
  // 1. 2단계 SQL — 관리자 표시와 나이 · 담당교역자 잠금 (실제로는 처음 돌려 본다)
  // ==========================================================================
  db.sql(`insert into auth.users (email, email_confirmed_at) values
            ('tester@plch.or.kr', now()), ('guest@plch.or.kr', now());`);

  // 자리표시를 안 고치고 실행하면 오류로 멈춰야 한다 (조용히 0줄로 끝나지 않는다).
  const placeholder = db.sqlFile(S('dg_admin.sql'), { allowError: true });
  ok('dg_admin.sql — 메일을 안 고치면 오류로 멈춘다',
     !placeholder.ok && /계정을 찾지 못했습니다/.test(placeholder.err), placeholder.err.split('\n')[0]);

  const withMail = db.sqlFile(S('dg_admin.sql'),
    { transform: (t) => t.replace('여기에_관리자_메일', 'Tester@PLCH.or.kr') });   // 대소문자가 달라도
  ok('dg_admin.sql — 메일을 고치면 관리자 표시가 붙는다 (확인 줄에 나온다)',
     /tester@plch\.or\.kr\|true\|t/.test(withMail.out), withMail.out);
  ok('다른 계정에는 표시가 안 붙는다',
     one(db.sql(`select coalesce(raw_app_meta_data ->> 'dg_admin', 'none') from auth.users where email = 'guest@plch.or.kr'`)) === 'none');

  const ADMIN = { role: 'authenticated', claims: { app_metadata: { dg_admin: true } } };
  const GUEST = { role: 'authenticated', claims: { app_metadata: {} } };
  // user_metadata 는 사용자가 스스로 바꿀 수 있는 칸이다 — 거기 적힌 것은 믿으면 안 된다.
  const SELF_MADE = { role: 'authenticated', claims: { user_metadata: { dg_admin: true }, app_metadata: {} } };
  const ANON = { role: 'anon' };

  ok('dg_is_admin — 관리자 표시가 든 토큰만 참',
     one(db.sql('select public.dg_is_admin()', ADMIN)) === 't'
     && one(db.sql('select public.dg_is_admin()', GUEST)) === 'f'
     && one(db.sql('select public.dg_is_admin()', SELF_MADE)) === 'f'
     && one(db.sql('select public.dg_is_admin()', ANON)) === 'f');

  const extras = (as) => db.sql(`select count(*) from public.dg_admin_member_extras('DG-2026')`, { ...as, allowError: true });
  ok('나이 · 교역자 함수 — 관리자에게만 준다',
     Number(one(extras(ADMIN))) === 263 && Number(one(extras(GUEST))) === 0 && Number(one(extras(SELF_MADE))) === 0,
     `관리자 ${one(extras(ADMIN))} · 표시 없음 ${one(extras(GUEST))}`);
  ok('나이 · 교역자 함수 — 로그인 없이는 부르지도 못한다', !extras(ANON).ok, extras(ANON).err.split('\n')[0]);

  db.sqlFile(S('dg_admin_lock.sql'));
  const ageAnon = db.sql('select age from dg_members limit 1', { ...ANON, allowError: true });
  const ageAuth = db.sql('select pastor from dg_members limit 1', { ...ADMIN, allowError: true });
  ok('dg_admin_lock.sql — anon 은 나이를 못 읽는다', !ageAnon.ok && /permission denied/.test(ageAnon.err), ageAnon.err);
  ok('로그인해도 표에서 직접은 못 읽는다 (함수로만)', !ageAuth.ok && /permission denied/.test(ageAuth.err), ageAuth.err);
  ok("'select *' 는 통째로 거절된다 (그래서 앱이 열 이름을 적는다)",
     !db.sql('select * from dg_members limit 1', { ...ANON, allowError: true }).ok);
  ok('나머지 열은 아직 읽힌다 (3단계 잠금 전)',
     Number(one(db.sql(`select count(*) from (select id, name, phone, team, sheet_row from dg_members) x`, ANON))) > 261);

  // ==========================================================================
  // 2. 조회 함수 — 잠그기 전 (앱 v135 가 먼저 나가 있는 상태)
  // ==========================================================================
  db.sqlFile(S('dg_lookup.sql'));
  let ipSeq = 0;
  const freshIp = () => `10.0.${Math.floor(++ipSeq / 250)}.${ipSeq % 250}`;
  const lookup = (name, phone, ip = freshIp()) =>
    json(db.sql(`select public.dg_lookup(${lit(name)}, ${lit(phone)})`,
                { ...ANON, headers: { 'x-forwarded-for': `${ip}, 172.16.0.1` } }));

  const me = lookup('이조원', '2222');
  ok('정확한 이름+번호 → 찾는다', me.found === true && me.member?.name === '이조원' && me.member?.team === 'Y1',
     JSON.stringify(me.member));
  ok('기수 · 회차 39개가 함께 온다', me.cohort === 'DG-2026' && me.sessions.length === 39, `${me.cohort} · ${me.sessions?.length}`);
  ok('본인 출결 · 김밥 · 과제가 온다',
     me.attendance.length >= 30 && me.lunch.length > 0 && me.homework.length === 20,
     `${me.attendance.length} · ${me.lunch.length} · ${me.homework.length}`);
  ok('본인 과제에는 제출 내용이 들어 있다 (자기 제출물 링크를 연다)',
     me.homework.every(h => /secret-2222-/.test(h.content)), me.homework[0]?.content);
  ok('조원에게는 조 명단을 안 준다', me.team === null, JSON.stringify(me.team)?.slice(0, 80));
  ok('배치도 주소가 온다', me.location?.image_url === 'https://example.org/wesley.jpg', JSON.stringify(me.location));
  const linkTeams = me.links.map(l => l.team).sort().join(',');
  ok("안내방 — 자기 조('y 1' 로 적혀 있어도) + 부서 방. 다른 조 방은 없다",
     linkTeams === ['y 1', '온라인', '온라인DG', '청년부'].sort().join(','), linkTeams);
  ok('남의 조 방은 안 준다 (T5 · Y2)', !me.links.some(l => ['T5', 'Y2'].includes(l.team)), linkTeams);
  ok('나이 · 담당교역자는 어디에도 없다', !/"age"|"pastor"|이목사/.test(JSON.stringify(me)));

  // --- 이름은 정확히 ---------------------------------------------------------
  // 일부 일치 · 초성을 받으면 뒤 4자리를 차례로 넣어 보는 것만으로 명단을 긁어 갈 수 있다.
  for (const [label, name, phone] of [['이름 일부', '이조', '2222'], ['초성', 'ㅇㅈㅇ', '2222'],
                                      ['이름이 더 길다', '이조원님', '2222'], ['번호가 다르다', '이조원', '2223'],
                                      ['빈 이름', '', '2222'], ['번호 3자리', '이조원', '222'],
                                      ['SQL 을 넣어 본다', "' or 1=1 --", '2222'], ['와일드카드', '%', '2222']]) {
    const r = lookup(name, phone);
    ok(`못 찾는다 — ${label}`, r.found === false && !r.member, JSON.stringify(r).slice(0, 80));
  }
  ok('공백 · 전각 숫자는 다듬어 찾는다', lookup(' 이 조원 ', '２２２２').member?.name === '이조원');
  ok("명단에 '공 백' 으로 적힌 사람을 '공백' 으로 찾는다", lookup('공백', '6666').member?.phone === '6666');
  ok('내려간(inactive) 사람은 못 찾는다', lookup('나간이', '7777').found === false);
  ok('지난 기수 사람은 못 찾는다', lookup('옛기수', '9999').found === false);

  // --- 조장 · 서브튜터 · 관리자 — 자기 조만 -----------------------------------
  const tutor = lookup('김조장', '1111');
  const y1Ids = db.sql(`select id from dg_members where cohort_id='DG-2026' and status='active' and team='Y1'`).rows;
  ok('조장에게는 조 명단이 온다 (30명)', tutor.team?.members.length === 30, String(tutor.team?.members.length));
  ok('전부 자기 조 사람이다', tutor.team.members.every(m => m.team === 'Y1'),
     [...new Set(tutor.team.members.map(m => m.team))].join(','));
  ok('내려간 사람은 명단에 없다', !tutor.team.members.some(m => m.name === '나간이'));
  ok('조원 출결 · 김밥 · 과제가 전부 자기 조 사람 것이다',
     [tutor.team.attendance, tutor.team.lunch, tutor.team.homework]
       .every(list => list.length > 0 && list.every(r => y1Ids.includes(r.member_id))),
     `${tutor.team.attendance.length} · ${tutor.team.lunch.length} · ${tutor.team.homework.length}`);
  ok('조원의 과제 **내용**은 조장에게도 안 준다 (몇 강 · 종류만)',
     tutor.team.homework.every(h => !('content' in h)) && !/secret-2222/.test(JSON.stringify(tutor.team)));
  ok('조원의 나이 · 교역자도 없다', !/"age"|"pastor"/.test(JSON.stringify(tutor)));
  ok('서브튜터 · 관리자 역할에도 조 명단이 온다',
     lookup('정서브', '5551').team?.members.length === 5 && lookup('오관리', '5552').team?.members.length === 5);
  ok('역할이 빈 사람에게는 안 온다', lookup('최조원', '4444').team === null);
  ok('조가 없는 조장에게는 안 온다 (기수 전원이 딸려 나오면 안 된다)', lookup('조없는장', '8888').team === null);

  // --- 실제 규모에서 얼마나 걸리는가 -------------------------------------------
  const timeOf = (name, phone) => {
    const runs = [];
    for (let i = 0; i < 5; i++) {
      const plan = JSON.parse(db.sql(
        `explain (analyze, format json) select public.dg_lookup(${lit(name)}, ${lit(phone)})`, ANON).out);
      runs.push(plan[0]['Execution Time']);
    }
    return runs.sort((a, b) => a - b)[2];   // 가운데 값
  };
  const tMember = timeOf('이조원', '2222');
  const tTutor = timeOf('김조장', '1111');
  ok(`조회 시간 — 조원 ${tMember.toFixed(1)}ms`, tMember < 50, `${tMember.toFixed(2)}ms (기준 50ms)`);
  ok(`조회 시간 — 30명 조의 조장 ${tTutor.toFixed(1)}ms`, tTutor < 50, `${tTutor.toFixed(2)}ms (기준 50ms)`);

  // --- 틀린 시도 제한 ----------------------------------------------------------
  db.sql('delete from dg_lookup_log');
  lookup('이조원', '2222', '9.9.9.1');
  ok('맞은 조회는 기록하지 않는다', one(db.sql('select count(*) from dg_lookup_log')) === '0');
  lookup('이조원', '222', '9.9.9.1');
  ok('꼴이 안 맞는 입력은 기록하지 않는다 (추측이 아니다)', one(db.sql('select count(*) from dg_lookup_log')) === '0');

  // 같은 곳에서: 이름을 바꿔 가며 20번 틀리면 그곳은 맞는 번호도 못 쓴다.
  for (let i = 0; i < 20; i++) lookup(`없는사람${i}`, '0000', '9.9.9.9');
  const blocked = lookup('이조원', '2222', '9.9.9.9');
  ok('같은 곳에서 20번 틀리면 맞는 번호도 거절한다', blocked.found === false && blocked.limited === true, JSON.stringify(blocked));
  ok('다른 곳에서는 그대로 된다', lookup('이조원', '2222', '9.9.9.8').found === true);
  db.sql(`update dg_lookup_log set at = at - interval '11 minutes' where ip = '9.9.9.9'`);
  ok('10분이 지나면 풀린다', lookup('이조원', '2222', '9.9.9.9').found === true);

  // 같은 이름에: 곳을 바꿔 가며 번호를 넣어 봐도 30번이면 그 이름이 잠긴다.
  db.sql('delete from dg_lookup_log');
  for (let i = 0; i < 30; i++) lookup('박다른', String(1000 + i), `8.8.${i}.1`);
  const nameLocked = lookup('박다른', '3333', '7.7.7.7');
  ok('같은 이름에 30번 틀리면 그 이름은 잠긴다 (곳을 바꿔도)', nameLocked.limited === true, JSON.stringify(nameLocked));
  ok('다른 이름은 그대로 된다', lookup('이조원', '2222', '7.7.7.7').found === true);
  db.sql(`update dg_lookup_log set at = at - interval '61 minutes'`);
  ok('1시간이 지나면 풀린다', lookup('박다른', '3333', '7.7.7.7').found === true);

  lookup('박다른', '0001', '6.6.6.6');
  const logRow = db.sql(`select ip || '|' || name_hash from dg_lookup_log order by id desc limit 1`).out;
  ok('기록에 이름을 글자로 남기지 않는다 (해시만)', /^6\.6\.6\.6\|[0-9a-f]{32}$/.test(logRow) && !/박다른/.test(logRow), logRow);
  db.sql(`update dg_lookup_log set at = now() - interval '3 days'`);
  lookup('없는사람', '0000', '6.6.6.5');
  ok('이틀 지난 기록은 지운다', one(db.sql('select count(*) from dg_lookup_log')) === '1');
  ok('기록 표는 anon 도 로그인한 사람도 못 읽는다',
     !db.sql('select count(*) from dg_lookup_log', { ...ANON, allowError: true }).ok
     && !db.sql('select count(*) from dg_lookup_log', { ...ADMIN, allowError: true }).ok);
  // 요청 머리글을 못 읽어도 조회는 된다 (주소 제한만 건너뛴다).
  ok('요청 주소를 몰라도 조회는 된다',
     json(db.sql(`select public.dg_lookup('이조원', '2222')`, ANON)).found === true);
  db.sql('delete from dg_lookup_log');

  // ==========================================================================
  // 3. 잠근 뒤 — dg_lookup_lock.sql
  // ==========================================================================
  const lock = db.sqlFile(S('dg_lookup_lock.sql'));
  ok('dg_lookup_lock.sql 이 돈다 — 확인 줄: 다섯 표는 anon 이 못 읽고 세 표는 읽는다',
     (lock.out.match(/\|f\|admin read /g) || []).length === 5 && (lock.out.match(/\|t\|/g) || []).length === 3,
     lock.out.replace(/\n/g, ' / '));

  const LOCKED = ['dg_members', 'dg_attendance', 'dg_lunch', 'dg_homework', 'dg_team_links'];
  const col = (t) => (t === 'dg_members' ? 'id' : t === 'dg_team_links' ? 'team' : 'member_id');
  const read = (t, as) => db.sql(`select count(${col(t)}) from ${t}`, { ...as, allowError: true });

  const anonRead = LOCKED.map(t => read(t, ANON));
  ok('anon 은 다섯 표를 하나도 못 읽는다',
     anonRead.every(r => !r.ok && /permission denied/.test(r.err)), anonRead.map(r => r.ok ? '읽힘!' : '막힘').join(','));
  const guestRead = LOCKED.map(t => read(t, GUEST));
  ok('관리자 표시 없는 로그인은 한 줄도 못 본다',
     guestRead.every(r => r.ok && one(r) === '0'), guestRead.map(r => r.ok ? one(r) : '오류').join(','));
  ok('스스로 붙인 표시(user_metadata)로도 못 본다', LOCKED.every(t => one(read(t, SELF_MADE)) === '0'));
  const adminRead = LOCKED.map(t => read(t, ADMIN));
  ok('관리자는 다섯 표를 읽는다', adminRead.every(r => r.ok && Number(one(r)) > 0), adminRead.map(r => one(r)).join(','));
  ok('관리자도 나이 · 교역자는 표에서 직접 못 읽는다 (함수로만 — 2단계 그대로)',
     !db.sql('select age from dg_members limit 1', { ...ADMIN, allowError: true }).ok
     && Number(one(extras(ADMIN))) === 263);
  // 앱이 관리자 화면에서 실제로 보내는 꼴 — 조인까지.
  ok('관리자 화면의 조인 조회가 된다 (출결 + 명단)',
     Number(one(db.sql(`select count(*) from dg_attendance a join dg_members m on m.id = a.member_id
                        where m.cohort_id = 'DG-2026'`, ADMIN))) > 5000);

  ok('공개로 둔 표 셋은 anon 이 읽는다 (회차 · 장소 · 동기화 시각)',
     ['dg_sessions', 'dg_locations', 'dg_sync_log'].every(t =>
       Number(one(db.sql(`select count(*) from ${t}`, ANON))) > 0));

  const after = lookup('이조원', '2222');
  ok('잠근 뒤에도 조회 함수는 된다 (anon)', after.found === true && after.attendance.length >= 30 && after.homework.length === 20);
  ok('잠근 뒤에도 조장은 자기 조를 받는다', lookup('김조장', '1111').team?.members.length === 30);
  ok('잠근 뒤에도 일부 이름으로는 못 찾는다', lookup('이조', '2222').found === false);

  // 동기화 · GAS 는 service_role 로 쓴다 — 그대로 돼야 한다.
  const svc = { role: 'service_role' };
  ok('동기화(service_role)는 읽고 쓴다',
     Number(one(db.sql('select count(*) from dg_members', svc))) > 261
     && db.sql(`update dg_members set lunch = 'O' where name = '이조원';
                insert into dg_attendance (member_id, session_date, status)
                select id, '2026-12-20', 'O' from dg_members where name = '이조원'
                on conflict (member_id, session_date) do update set status = excluded.status;`,
               { ...svc, allowError: true }).ok);
  ok('anon 은 아무 표에도 못 쓴다',
     !db.sql(`update dg_members set lunch = 'X'`, { ...ANON, allowError: true }).ok
     && !db.sql(`insert into dg_attendance (member_id, session_date, status)
                 select id, '2026-12-27', 'O' from dg_members limit 1`, { ...ANON, allowError: true }).ok);

  // 다시 실행해도 된다 (여러 번 붙여 넣어도 같은 결과).
  ok('세 파일 다 다시 실행해도 된다',
     db.sqlFile(S('dg_lookup.sql'), { allowError: true }).ok
     && db.sqlFile(S('dg_lookup_lock.sql'), { allowError: true }).ok
     && db.sqlFile(S('dg_admin_lock.sql'), { allowError: true }).ok);
  ok('다시 실행한 뒤에도 anon 은 못 읽는다 (잠금이 풀리지 않는다)',
     LOCKED.every(t => !read(t, ANON).ok));
  ok('다시 실행한 뒤에도 조회는 된다', lookup('이조원', '2222').found === true);
} finally {
  db.stop();
}

done();
