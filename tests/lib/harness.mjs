// 검증 스크립트가 함께 쓰는 것들.
//
// 경로를 어디에도 박지 않는다. 예전에는 저장소 위치와 크로미움 경로가 스크립트마다
// 박혀 있어서, 다른 컴퓨터에서는 한 줄도 돌지 않았다.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/** 저장소 뿌리 (tests/lib/harness.mjs 에서 두 단계 위) */
export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** 스크린샷을 둘 곳. 저장소를 더럽히지 않게 tests/.shots 로 (gitignore 됨) */
export const SHOT = process.env.DG_SHOT_DIR || join(ROOT, 'tests', '.shots');
mkdirSync(SHOT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** 저장소를 그대로 내주는 정적 서버. 캐시는 끈다 (옛 파일을 보면 검증이 거짓이 된다) */
export async function serveRepo(port) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(ROOT, p);
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(readFileSync(file));
  });
  await new Promise(r => server.listen(port, r));
  return server;
}

/**
 * 크로미움을 띄운다.
 *
 * 1) DG_CHROMIUM 이 있으면 그것을 쓴다.
 * 2) 없으면 playwright 가 아는 자리를 그대로 쓴다 (보통 이쪽이 맞다).
 * 3) 그것도 안 되면 PLAYWRIGHT_BROWSERS_PATH 아래를 뒤진다.
 *    (컨테이너에 playwright 버전과 어긋나는 크로미움이 깔려 있는 경우)
 */
export async function launch(options = {}) {
  const explicit = process.env.DG_CHROMIUM;
  if (explicit) return chromium.launch({ executablePath: explicit, ...options });

  try {
    return await chromium.launch(options);
  } catch (err) {
    const found = findChromium();
    if (!found) throw err;
    console.log(`   (크로미움을 ${found} 에서 찾았습니다)`);
    return chromium.launch({ executablePath: found, ...options });
  }
}

function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return null;
  for (const dir of readdirSync(base)) {
    if (!dir.startsWith('chromium')) continue;
    for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(base, dir, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * 결과를 모으고 세는 것.
 *
 * 실패한 것을 마지막에 다시 모아 보여준다 — 검사가 100건이 넘으면
 * 스크롤을 되짚어 올라가며 ❌ 를 찾게 된다.
 */
export function makeReporter(title) {
  const results = [];
  const ok = (name, pass, detail = '') => {
    results.push({ name, pass, detail });
    console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  const done = () => {
    const failed = results.filter(r => !r.pass);
    console.log('\n' + '='.repeat(54));
    if (failed.length) {
      console.log(`❌ ${title} — 실패 ${failed.length}/${results.length}`);
      for (const f of failed) console.log(`   · ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
    } else {
      console.log(`✅ ${title} — 전부 통과 (${results.length}건)`);
    }
    process.exit(failed.length ? 1 : 0);
  };

  return { ok, done, results };
}

/**
 * 가짜 dg_attendance — 앱이 보내는 PostgREST 조건을 **그대로 따라** 거른다.
 *
 *   member_id=eq.u1 · member_id=in.(u1,u2) · session_date=eq.YYYY-MM-DD
 *
 * v131 부터 조장 화면도 출결을 DB 에서 읽는다 (한 조 · 한 회차, 전체 출석표는 한 조 ·
 * 전 회차). 조건을 무시하고 다 돌려주면 '한 회차만 묻는가' 를 검증할 수 없고,
 * 다른 회차 값이 섞여 들어와도 통과한다.
 *
 * @param {URL} url
 * @param {Array<{member_id, session_date, status}>} rows
 */
export function filterAttendance(url, rows) {
  const p = url.searchParams;
  let out = rows;
  const mid = p.get('member_id') || '';
  if (mid.startsWith('eq.')) out = out.filter(r => r.member_id === mid.slice(3));
  if (mid.startsWith('in.(')) {
    const ids = new Set(mid.slice(4, -1).split(','));
    out = out.filter(r => ids.has(r.member_id));
  }
  const sd = p.get('session_date') || '';
  if (sd.startsWith('eq.')) out = out.filter(r => r.session_date === sd.slice(3));
  return out;
}

/** { '이름전화': { 'YYYY-MM-DD': status } } → dg_attendance 행. 빈 값은 행이 없는 것과 같다. */
export function attendanceRowsFrom(members, byKey) {
  const rows = [];
  for (const m of members) {
    for (const [date, status] of Object.entries(byKey[`${m.name}${m.phone}`] || {})) {
      if (status !== '') rows.push({ member_id: m.id, session_date: date, status });
    }
  }
  return rows;
}

/**
 * 관리자로 로그인해 있는 상태를 만든다 (v134~ — Supabase 로그인).
 *
 * 예전 검증은 `sessionStorage.adminLoggedIn = '1'` 한 줄로 들어갔다. 그것이 곧 뒷문이었다 —
 * 앱이 그 한 줄만 보고 들여보냈기 때문이다. 지금은 앱이 세션(토큰)을 보관하고 서버에
 * 물어 확인하므로, 검증도 **가짜 서버 응답**까지 갖춰야 들어간다.
 *
 *   · 세션            sessionStorage.dg_admin_session_v1  (만료는 먼 훗날)
 *   · /auth/v1/user   이 토큰이 관리자의 것인가 — `admin: false` 면 표시 없는 계정
 *   · /auth/v1/token  토큰 새로 받기
 *   · rpc/dg_admin_member_extras  나이 · 담당교역자 (관리자 토큰일 때만)
 *
 * ⚠️ **`**​/rest/v1/**` 가짜를 건 뒤에, 같은 page 에** 부른다. Playwright 는 나중에 건 길을
 *    먼저 보고, page 의 길을 context 의 길보다 먼저 본다. 순서가 바뀌면 함수 요청이
 *    표 가짜로 넘어가 나이 · 교역자가 조용히 빈다.
 *
 * @param page
 * @param {{ members?: Array, admin?: boolean, calls?: Array }} [opts]
 *   members  dg_members 가짜 행 (id · age · pastor 를 읽는다)
 *   calls    주면 여기에 받은 요청을 적는다 ({ kind, auth })
 */
export const ADMIN_TOKEN = 'test-admin-token';
export const ADMIN_SESSION_KEY = 'dg_admin_session_v1';

export async function asAdmin(page, { members = [], admin = true, calls = null } = {}) {
  const session = JSON.stringify({
    access_token: ADMIN_TOKEN,
    refresh_token: 'test-refresh-token',
    expires_at_ms: 4102444800000,   // 2100년 — 시계를 고정한 검증에서도 안 끊긴다
  });
  await page.addInitScript(([k, v]) => {
    // 로그아웃을 검증한 뒤 다시 채워지면 안 된다 — 처음 한 번만.
    if (!sessionStorage.getItem('__dg_admin_seeded')) {
      sessionStorage.setItem(k, v);
      sessionStorage.setItem('__dg_admin_seeded', '1');
    }
  }, [ADMIN_SESSION_KEY, session]);

  const user = { id: 'admin-uuid', email: 'tester@plch.or.kr',
                 app_metadata: admin ? { dg_admin: true } : {} };
  const json = (route, status, body) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  const authOf = (route) => route.request().headers().authorization || '';

  await page.route('**/auth/v1/user', (route) => {
    calls?.push({ kind: 'user', auth: authOf(route) });
    if (authOf(route) !== `Bearer ${ADMIN_TOKEN}`) return json(route, 401, { message: 'invalid JWT' });
    return json(route, 200, user);
  });
  await page.route('**/auth/v1/token**', (route) => {
    calls?.push({ kind: 'token', auth: authOf(route) });
    return json(route, 200, { access_token: ADMIN_TOKEN, refresh_token: 'test-refresh-token',
                              expires_in: 3600, user });
  });
  await page.route('**/auth/v1/logout', (route) => {
    calls?.push({ kind: 'logout', auth: authOf(route) });
    return route.fulfill({ status: 204, body: '' });
  });
  await page.route('**/rest/v1/rpc/dg_admin_member_extras', (route) => {
    calls?.push({ kind: 'extras', auth: authOf(route) });
    // 진짜 DB 처럼: 관리자 표시가 든 토큰이 아니면 빈 목록.
    const ok = admin && authOf(route) === `Bearer ${ADMIN_TOKEN}`;
    return json(route, 200, ok
      ? members.map(m => ({ member_id: m.id, age: m.age ?? null, pastor: m.pastor ?? null }))
      : []);
  });
}

/**
 * 진짜 DB 처럼 dg_members 에서 나이 · 담당교역자를 뺀 행.
 * (anon 에게 그 두 열이 안 열려 있다 — supabase/dg_admin_lock.sql)
 */
export function publicMemberRows(members) {
  return members.map(({ age, pastor, ...rest }) => rest);
}

// ============================================================================
// 가짜 dg_lookup (v135~) — 조회 화면이 부르는 서버 함수
//
// 조회 화면은 표를 직접 읽지 않는다. 이름+뒤 4자리를 dg_lookup 에 보내면 서버가 확인하고
// 본인 것(조장이면 자기 조 것까지)만 준다. 화면 검증은 그 답을 **표 가짜에서 만들어** 준다 —
// supabase/dg_lookup.sql 과 같은 규칙으로. (SQL 자체는 verify-db 가 실제 Postgres 로 본다.)
// ============================================================================

const normName = (v) => String(v ?? '').replace(/\s/g, '').normalize('NFC');
const normPhone = (v) => String(v ?? '')
  .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/[^0-9]/g, '');
const normTeam = (v) => String(v ?? '').replace(/\s/g, '').toUpperCase();
export const isTutorRole = (role) => /조장|서브튜터|관리자/.test(String(role ?? ''));

/**
 * dg_lookup 의 답을 표 가짜에서 만든다.
 *
 * @param {object} fx
 *   members     dg_members 행 (id · cohort_id · name · phone · team · team_no · location · role · lunch · status)
 *   sessions    dg_sessions 행 (session_date · label · name)
 *   attendance  dg_attendance 행 (member_id · session_date · status)
 *   lunch       dg_lunch 행 (member_id · session_date · applied)
 *   homework    dg_homework 행 (member_id · lecture · kind · content · submitted_at)
 *   teamLinks   dg_team_links 행 (team · chat_url)
 *   locations   dg_locations 행 (location · image_url · detail_url)
 */
export function lookupBundle(fx, name, phone) {
  const n = normName(name);
  const p = normPhone(phone);
  if (!n || p.length !== 4) return { found: false };

  const active = (fx.members || []).filter(m => (m.status ?? 'active') === 'active');
  const cohort = active[0]?.cohort_id || 'DG-2026';
  const me = active.find(m => m.cohort_id === cohort && String(m.phone ?? '') === p && normName(m.name) === n);
  if (!me) return { found: false };

  const pick = (m) => ({
    id: m.id, name: m.name, phone: m.phone ?? '', team: m.team ?? '', team_no: m.team_no ?? null,
    sheet_row: m.sheet_row ?? null, location: m.location ?? '', role: m.role ?? '', lunch: m.lunch ?? '',
  });
  const att = fx.attendance || [];
  const lunch = fx.lunch || [];
  const hw = fx.homework || [];

  let team = null;
  if (isTutorRole(me.role) && me.team) {
    const mates = active.filter(m => m.cohort_id === cohort && m.team === me.team)
      .sort((a, b) => (a.team_no ?? 0) - (b.team_no ?? 0) || String(a.name).localeCompare(String(b.name)));
    const ids = new Set(mates.map(m => m.id));
    team = {
      members: mates.map(pick),
      attendance: att.filter(r => ids.has(r.member_id))
        .map(r => ({ member_id: r.member_id, session_date: r.session_date, status: r.status })),
      lunch: lunch.filter(r => ids.has(r.member_id) && r.applied !== false)
        .map(r => ({ member_id: r.member_id, session_date: r.session_date })),
      // 조원의 과제는 몇 강 · 종류만 — 내용은 조장에게도 안 준다.
      homework: hw.filter(r => ids.has(r.member_id))
        .map(r => ({ member_id: r.member_id, lecture: r.lecture ?? '', kind: r.kind ?? '' })),
    };
  }

  const memberTeams = new Set(active.filter(m => m.cohort_id === cohort).map(m => normTeam(m.team)));
  const DEPTS = new Set(['청년부', '온라인', '온라인DG', '청년부부', '남장년부', '여장년부'].map(normTeam));
  const links = (fx.teamLinks || [])
    .filter(l => normTeam(l.team) === normTeam(me.team) || DEPTS.has(normTeam(l.team))
              || !memberTeams.has(normTeam(l.team)))
    .map(l => ({ team: l.team, chat_url: l.chat_url ?? '' }));
  const loc = (fx.locations || []).find(l => l.location === String(me.location ?? '').trim()) || null;

  return {
    found: true,
    cohort,
    member: pick(me),
    links,
    location: loc ? { location: loc.location, image_url: loc.image_url ?? '', detail_url: loc.detail_url ?? null } : null,
    sessions: (fx.sessions || []).map(s => ({ session_date: s.session_date, label: s.label ?? null, name: s.name ?? null })),
    attendance: att.filter(r => r.member_id === me.id).map(r => ({ session_date: r.session_date, status: r.status })),
    lunch: lunch.filter(r => r.member_id === me.id).map(r => ({ session_date: r.session_date, applied: r.applied !== false })),
    homework: hw.filter(r => r.member_id === me.id).map(r => ({
      lecture: r.lecture ?? '', kind: r.kind ?? '', content: r.content ?? '', submitted_at: r.submitted_at ?? null })),
    team,
  };
}

// 조회 화면이 읽어도 되는 표 — 개인정보가 아니라 공개로 둔 것 (supabase/dg_lookup_lock.sql).
export const PUBLIC_TABLES = new Set(['dg_sessions', 'dg_locations', 'dg_sync_log']);

/**
 * 조회 화면용 가짜 Supabase 를 건다 — dg_lookup 답 + 공개 표 셋.
 *
 * 잠긴 표(명단 · 출결 · 김밥 · 과제 · 안내방)를 읽으려 들면 **진짜처럼 거절하고 기록한다.**
 * 검증이 `privateReads` 가 비었는지 본다 — 조회 화면이 표를 직접 읽으면 실패다.
 *
 * @param page
 * @param {object|() => object} fx  lookupBundle 의 자료 (함수면 부를 때마다 새로 읽는다)
 * @param {object} [opts]
 *   delayMs   dg_lookup 을 늦게 준다 (number 또는 () => number)
 *   fail      dg_lookup 을 500 으로 (boolean 또는 () => boolean)
 *   limited   dg_lookup 이 '틀린 시도가 너무 많다' 로 (같은 꼴)
 * @returns {{ lookups: Array<{name, phone}>, privateReads: string[] }}
 */
export async function routePublicSupabase(page, fx, opts = {}) {
  const log = { lookups: [], privateReads: [] };
  const val = (v) => (typeof v === 'function' ? v() : v);
  const data = () => (typeof fx === 'function' ? fx() : fx);
  const json = (route, status, body) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});

  await page.route('**/rest/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const name = url.pathname.split('/').pop();

    if (url.pathname.endsWith('/rpc/dg_lookup')) {
      const args = JSON.parse(route.request().postData() || '{}');
      log.lookups.push({ name: args.p_name, phone: args.p_phone });
      const delay = val(opts.delayMs) || 0;
      if (delay) await new Promise(r => setTimeout(r, delay));
      if (val(opts.fail)) return json(route, 500, { message: 'boom' });
      if (val(opts.limited)) return json(route, 200, { found: false, limited: true });
      return json(route, 200, lookupBundle(data(), args.p_name, args.p_phone));
    }
    if (PUBLIC_TABLES.has(name)) {
      const d = data();
      const body = name === 'dg_sessions' ? (d.sessions || [])
                 : name === 'dg_locations' ? (d.locations || [])
                 : (d.syncLog || []);
      return json(route, 200, body);
    }
    // 잠긴 표 — 진짜 DB 처럼 거절한다.
    log.privateReads.push(name + url.search);
    return json(route, 401, { code: '42501', message: `permission denied for table ${name}` });
  });
  return log;
}
