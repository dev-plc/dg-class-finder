// 관리자 로그인 검증 — Supabase 로그인 (v134).
//
// 예전에는 script.js 가 아이디 · 비밀번호를 글자로 견줬고(비밀번호가 공개 코드에 있었다),
// admin.js 는 sessionStorage.adminLoggedIn 이 **있기만 하면** 들여보냈다.
// 여기서 보는 것:
//   · 맞으면 바로 들어가고, 틀렸을 때만 말한다 (예전과 같은 화면 동작)
//   · 비밀번호를 앱이 아니라 서버가 확인한다 · 어디에도 남기지 않는다
//   · 옛 뒷문 · 가짜 토큰 · 관리자 표시 없는 계정으로는 못 들어간다
//   · 토큰이 만료되면 새로 받는다 · 로그아웃하면 지운다
//   · 저장소 어디에도 옛 비밀번호 글자가 없다
//
// Supabase 는 가짜 응답으로 대신한다. 진짜 계정 · 비밀번호는 이 파일에 없다.

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { serveRepo, launch, makeReporter, ROOT } from './lib/harness.mjs';

const PORT = 8088;
const server = await serveRepo(PORT);

const { ok, done } = makeReporter('관리자 로그인');

// 가짜 로그인 서버가 아는 계정. 검증용으로 지어낸 값이다.
const GOOD_PW = 'correct-horse-battery-9';
const GOOD_TOKEN = 'good-access-token';
const REFRESHED_TOKEN = 'refreshed-access-token';
const ACCOUNTS = {
  'plc@dgfinder.plch.kr':   { app_metadata: { dg_admin: true } },
  'guest@dgfinder.plch.kr': { app_metadata: {} },               // 로그인은 되지만 관리자 표시가 없다
};
const SESSION_KEY = 'dg_admin_session_v1';

const browser = await launch();

const authCalls = [];
let tokenDown = false;

async function newPage() {
  const context = await browser.newContext();
  const page = await context.newPage();
  const dialogs = [];
  page.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}); });
  page.on('pageerror', e => console.log('   [pageerror] ' + e.message));

  // 조회 데이터는 이 검증의 관심사가 아니다 — 빈 응답으로 대신한다.
  await page.route('**/rest/v1/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/script.google.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify({ success: true, data: [], sessions: [] }) }));

  const json = (route, status, body) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

  await page.route('**/auth/v1/token**', (route) => {
    const req = route.request();
    const grant = new URL(req.url()).searchParams.get('grant_type');
    const body = JSON.parse(req.postData() || '{}');
    authCalls.push({ kind: 'token', grant, email: body.email || '', apikey: req.headers().apikey || '' });
    if (tokenDown) return route.abort();

    if (grant === 'refresh_token') {
      if (body.refresh_token !== 'good-refresh') return json(route, 400, { error: 'invalid_grant' });
      return json(route, 200, { access_token: REFRESHED_TOKEN, refresh_token: 'good-refresh',
                                expires_in: 3600, user: ACCOUNTS['plc@dgfinder.plch.kr'] });
    }
    const user = ACCOUNTS[body.email];
    if (!user || body.password !== GOOD_PW) {
      return json(route, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials' });
    }
    return json(route, 200, { access_token: GOOD_TOKEN, refresh_token: 'good-refresh',
                              expires_in: 3600, user });
  });
  await page.route('**/auth/v1/user', (route) => {
    const auth = route.request().headers().authorization || '';
    authCalls.push({ kind: 'user', auth });
    if (auth === `Bearer ${GOOD_TOKEN}` || auth === `Bearer ${REFRESHED_TOKEN}`) {
      return json(route, 200, ACCOUNTS['plc@dgfinder.plch.kr']);
    }
    return json(route, 401, { message: 'invalid JWT' });
  });
  await page.route('**/auth/v1/logout', (route) => {
    authCalls.push({ kind: 'logout', auth: route.request().headers().authorization || '' });
    return route.fulfill({ status: 204, body: '' });
  });

  return { context, page, dialogs };
}

const openLogin = async (page) => {
  await page.click('#adminBtn');
  await page.waitForSelector('#adminLoginModal.active', { timeout: 5000 });
};
const loginError = (page) => page.evaluate(() => {
  const el = document.getElementById('adminLoginError');
  return { shown: !!el && getComputedStyle(el).display !== 'none', text: el?.textContent.trim() || '' };
});
const sessionOf = (page) => page.evaluate((k) => sessionStorage.getItem(k), SESSION_KEY);
const INDEX = new RegExp(`localhost:${PORT}/(index\\.html)?$`);

// ==========================================================================
// 1. 로그인 화면 — 틀렸을 때 · 맞았을 때
// ==========================================================================
const a = await newPage();
const page = a.page;
await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(1500);

// --- 틀렸을 때 ------------------------------------------------------------
await openLogin(page);
await page.fill('#adminId', 'plc');
await page.fill('#adminPassword', '틀린비번');
await page.click('.admin-login-btn');
await page.waitForFunction(() => getComputedStyle(document.getElementById('adminLoginError')).display !== 'none',
                           null, { timeout: 5000 });

const err = await loginError(page);
ok('틀리면 그 자리에서 알린다', err.shown && /틀렸습니다/.test(err.text), JSON.stringify(err));
ok('틀렸을 때 페이지를 옮기지 않는다', !/admin\.html/.test(page.url()), page.url());
ok('알림창(alert)은 쓰지 않는다', a.dialogs.length === 0, a.dialogs.join(' | '));
ok('틀리면 세션을 남기지 않는다', (await sessionOf(page)) === null);
ok('버튼이 다시 눌린다 (확인 중에서 풀린다)',
   await page.$eval('.admin-login-btn', el => !el.disabled && el.textContent.trim() === '로그인'));

// 비밀번호는 **서버가** 확인한다. 앱은 친 것을 그대로 보낼 뿐이다.
const sent = authCalls.find(c => c.kind === 'token');
ok("'plc' 만 쳐도 Supabase 계정(메일 꼴)으로 보낸다", sent?.email === 'plc@dgfinder.plch.kr', JSON.stringify(sent));
ok('공개 키(anon)로 부른다 — service_role 키가 아니다',
   !!sent?.apikey && JSON.parse(Buffer.from(sent.apikey.split('.')[1], 'base64').toString()).role === 'anon');

// 다시 치기 시작하면 빨간 글씨를 지운다 — 고치는 중에도 남아 있으면
// 방금 친 것이 또 틀린 줄 안다.
await page.fill('#adminPassword', 'p');
await page.waitForTimeout(200);
ok('다시 입력하면 경고가 사라진다', !(await loginError(page)).shown);

// --- 관리자 표시가 없는 계정 -------------------------------------------------
// 가입이 열려 있어 누가 계정을 만들더라도 관리자가 될 수는 없다 (표시는 사용자가 못 바꾼다).
await page.fill('#adminId', 'guest');
await page.fill('#adminPassword', GOOD_PW);
await page.click('.admin-login-btn');
await page.waitForFunction(() => getComputedStyle(document.getElementById('adminLoginError')).display !== 'none',
                           null, { timeout: 5000 });
const notAdmin = await loginError(page);
ok('관리자 표시 없는 계정은 못 들어간다', /권한이 없는/.test(notAdmin.text) && !/admin\.html/.test(page.url()),
   JSON.stringify(notAdmin));
ok('그 계정의 토큰은 버린다', (await sessionOf(page)) === null);

// --- 로그인 서버에 닿지 못할 때 ------------------------------------------------
tokenDown = true;
await page.fill('#adminId', 'plc');
await page.fill('#adminPassword', GOOD_PW);
await page.click('.admin-login-btn');
await page.waitForFunction(() => /연결/.test(document.getElementById('adminLoginError').textContent),
                           null, { timeout: 5000 }).catch(() => {});
const down = await loginError(page);
ok("연결이 안 되면 '틀렸다' 고 하지 않는다", /연결하지 못했습니다/.test(down.text) && !/틀렸습니다/.test(down.text),
   JSON.stringify(down));
tokenDown = false;

// --- 맞았을 때 ------------------------------------------------------------
a.dialogs.length = 0;
await page.fill('#adminId', 'plc');
await page.fill('#adminPassword', GOOD_PW);
await Promise.all([
  page.waitForURL(/admin\.html/, { timeout: 10000 }),
  page.click('.admin-login-btn'),
]);
ok('맞으면 곧바로 관리자 화면으로', /admin\.html/.test(page.url()), page.url());
ok('성공했다고 한 번 더 누르게 하지 않는다', a.dialogs.length === 0, a.dialogs.join(' | '));

const stored = await page.evaluate(() => ({ ...sessionStorage }));
const session = JSON.parse(stored[SESSION_KEY] || 'null');
ok('세션(토큰)이 남는다', session?.access_token === GOOD_TOKEN, Object.keys(stored).join(','));
ok('옛 표시(adminLoggedIn)는 쓰지 않는다', !('adminLoggedIn' in stored), Object.keys(stored).join(','));
// 비밀번호는 보내고 나면 어디에도 남기지 않는다.
const everything = JSON.stringify(stored) + JSON.stringify(await page.evaluate(() => ({ ...localStorage })));
ok('비밀번호를 브라우저에 남기지 않는다', !everything.includes(GOOD_PW));

await page.waitForTimeout(800);
ok('들어온 뒤 서버에 물어 확인한다',
   authCalls.some(c => c.kind === 'user' && c.auth === `Bearer ${GOOD_TOKEN}`),
   authCalls.filter(c => c.kind === 'user').map(c => c.auth).join(' | '));
ok('확인이 끝나도 관리자 화면에 남아 있다', /admin\.html/.test(page.url()), page.url());

// --- 로그아웃 --------------------------------------------------------------
await Promise.all([
  page.waitForURL(INDEX, { timeout: 10000 }),
  page.click('#logoutBtn'),          // confirm 은 위에서 수락한다
]);
ok('로그아웃하면 세션을 지운다', (await sessionOf(page)) === null);
ok('서버에도 알린다', authCalls.some(c => c.kind === 'logout' && c.auth === `Bearer ${GOOD_TOKEN}`));
await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
await page.waitForURL(INDEX, { timeout: 10000 }).catch(() => {});
ok('로그아웃한 뒤에는 관리자 화면에 못 들어간다', INDEX.test(page.url()), page.url());
await a.context.close();

// ==========================================================================
// 2. 로그인 없이 들어가려는 길
// ==========================================================================

// 옛 뒷문 — 이 한 줄이 있기만 하면 들여보냈다.
const b = await newPage();
await b.page.addInitScript(() => sessionStorage.setItem('adminLoggedIn', 'true'));
await b.page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
await b.page.waitForURL(INDEX, { timeout: 10000 }).catch(() => {});
ok('옛 뒷문(adminLoggedIn)으로는 못 들어간다', INDEX.test(b.page.url()), b.page.url());
await b.context.close();

// 아무 토큰이나 세션 자리에 넣어 본다 — 서버가 아니라고 하면 내보낸다.
const c = await newPage();
// (초기 스크립트는 페이지를 옮길 때마다 다시 돈다 — 처음 한 번만 심는다.
//  안 그러면 쫓겨난 뒤 index.html 에서 또 심겨 '지웠는가' 를 볼 수 없다.)
await c.page.addInitScript((k) => {
  if (sessionStorage.getItem('__seeded')) return;
  sessionStorage.setItem('__seeded', '1');
  sessionStorage.setItem(k, JSON.stringify({
    access_token: 'made-up-token', refresh_token: '', expires_at_ms: 4102444800000 }));
}, SESSION_KEY);
await c.page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
await c.page.waitForURL(INDEX, { timeout: 10000 }).catch(() => {});
ok('지어낸 토큰으로는 못 들어간다', INDEX.test(c.page.url()), c.page.url());
ok('지어낸 세션은 지운다', (await sessionOf(c.page)) === null);
await c.context.close();

// ==========================================================================
// 3. 토큰이 만료되면 새로 받는다
//
// 토큰은 1시간짜리다. 출석부를 오래 띄워 두는 화면이라, 새로 못 받으면 한 시간 뒤부터
// 저장 · 동기화가 거절된다.
// ==========================================================================
const d = await newPage();
await d.page.addInitScript((k) => {
  if (sessionStorage.getItem('__seeded')) return;
  sessionStorage.setItem('__seeded', '1');
  sessionStorage.setItem(k, JSON.stringify({
    access_token: 'expired-token', refresh_token: 'good-refresh', expires_at_ms: Date.now() - 1000 }));
}, SESSION_KEY);
authCalls.length = 0;
await d.page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
await d.page.waitForTimeout(1500);
ok('만료된 토큰은 새로 받는다', authCalls.some(x => x.kind === 'token' && x.grant === 'refresh_token'),
   authCalls.map(x => `${x.kind}:${x.grant || ''}`).join(','));
ok('새 토큰으로 바뀐다', JSON.parse(await sessionOf(d.page) || '{}').access_token === REFRESHED_TOKEN);
ok('관리자 화면에 그대로 있다', /admin\.html/.test(d.page.url()), d.page.url());
ok('만료된 토큰으로 서버를 부르지 않는다',
   !authCalls.some(x => x.kind === 'user' && /expired-token/.test(x.auth)));
await d.context.close();

// 새로 받는 것도 거절되면(refresh 토큰이 죽었다) 내보낸다.
const e = await newPage();
await e.page.addInitScript((k) => sessionStorage.setItem(k, JSON.stringify({
  access_token: 'expired-token', refresh_token: 'dead-refresh', expires_at_ms: Date.now() - 1000 })), SESSION_KEY);
await e.page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
await e.page.waitForURL(INDEX, { timeout: 10000 }).catch(() => {});
ok('새로 받지 못하면 내보낸다', INDEX.test(e.page.url()), e.page.url());
await e.context.close();

// ==========================================================================
// 4. 저장소에 계정 정보가 없다
//
// 옛 비밀번호는 공개 저장소에 평문으로 있었다 (script.js 비교문 · README · 옛 사본 · 이 파일).
// 글자를 쪼개 적는다 — 이 파일 자신에도 그 글자가 남으면 안 된다.
// ==========================================================================
const OLD = ['plc' + '12' + '34', 'plc' + '01' + '10'];
const tracked = execFileSync('git', ['-c', 'core.quotepath=false', 'ls-files'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter(f => /\.(js|mjs|html|md|json|css|gs|sql|yml|txt|sh|py)$/.test(f));
const leaks = [];
for (const f of tracked) {
  let text = '';
  try { text = readFileSync(join(ROOT, f), 'utf8'); } catch { continue; }
  for (const old of OLD) if (text.includes(old)) leaks.push(f);
}
ok('추적 파일 어디에도 옛 비밀번호 글자가 없다', leaks.length === 0, [...new Set(leaks)].join(', '));

const scriptJs = readFileSync(join(ROOT, 'script.js'), 'utf8');
ok('script.js 가 비밀번호를 글자로 견주지 않는다',
   !/pw\s*===\s*['"]/.test(scriptJs) && !/password\s*===\s*['"]/.test(scriptJs));
const adminJs = readFileSync(join(ROOT, 'admin.js'), 'utf8');
ok('admin.js 가 옛 표시(adminLoggedIn)를 읽지 않는다', !/getItem\(\s*['"]adminLoggedIn/.test(adminJs));

await browser.close();
server.close();

done();
