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

  const user = { id: 'admin-uuid', email: 'plc@dgfinder.plch.kr',
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
