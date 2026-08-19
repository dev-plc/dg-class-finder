// 관리자 페이지의 '시트에서 지금 가져오기' · '화면 새로 고침' 검증.

import { serveRepo, launch, makeReporter } from './lib/harness.mjs';

const PORT = 8095;
const server = await serveRepo(PORT);

const COHORT = 'DG-2026';
let MEMBERS = [
  { id: 'u1', cohort_id: COHORT, name: '김조장', phone: '1001', team: 'Y1', team_no: 1,
    role: '조장', location: '웨슬리홀', lunch: 'O', status: 'active', age: 30 },
];
const SESSIONS = [{ session_date: '2026-08-09', label: '08/09', name: '18강' }];

const { ok, done } = makeReporter('시트 동기화 버튼');

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on('pageerror', e => console.log('   [pageerror] ' + e.message));

let memberFetches = 0;
await page.route('**/rest/v1/**', route => {
  const url = new URL(route.request().url());
  const table = url.pathname.split('/').pop();
  let body = [];
  if (table === 'dg_members') {
    if (url.searchParams.get('select') === 'cohort_id') body = [{ cohort_id: COHORT }];
    else { memberFetches++; body = MEMBERS; }
  } else if (table === 'dg_sessions') body = SESSIONS;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

// GAS 는 동기화 요청만 받는다
const posts = [];
let gasReply = { success: true, version: 24, message: '동기화를 요청했습니다. 보통 1~2분 걸립니다.' };
await page.route('**/script.google.com/**', route => {
  const req = route.request();
  if (req.method() === 'POST') {
    posts.push({
      contentType: req.headers()['content-type'] || '',
      body: JSON.parse(req.postData() || '{}'),
    });
    return route.fulfill({ status: 200, contentType: 'application/json',
                           body: JSON.stringify(gasReply) });
  }
  route.fulfill({ status: 200, contentType: 'application/json',
                  body: JSON.stringify({ success: true }) });
});

await page.addInitScript(() => sessionStorage.setItem('adminLoggedIn', '1'));
await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });

// 화면 진입 애니메이션이 끝날 때까지 기다렸다가 본다.
// 한 번만 찍으면 애니메이션 중간을 집어 '안 보인다' 가 나온다.
const syncVisible = await page.locator('#syncBtn')
  .waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
const syncEnabled = await page.locator('#syncBtn').isEnabled();
ok('동기화 버튼이 보이고 누를 수 있다', syncVisible && syncEnabled,
   `visible=${syncVisible} enabled=${syncEnabled}`);

// --- 가져오기 -------------------------------------------------------------
await page.click('#syncBtn');
await page.waitForTimeout(600);

ok('GAS 로 action:sync 를 보낸다', posts[0]?.body?.action === 'sync',
   JSON.stringify(posts[0]?.body));
ok('CORS preflight 를 피하려 text/plain 으로 보낸다',
   /text\/plain/.test(posts[0]?.contentType || ''), posts[0]?.contentType);
ok('토큰을 앱에서 보내지 않는다',
   !JSON.stringify(posts[0]?.body || {}).match(/token|ghp_|github_pat/i),
   JSON.stringify(posts[0]?.body));

const info1 = await page.$eval('#syncInfo', el => el.textContent.trim());
ok('결과 메시지를 보여준다', /1~2분/.test(info1) && /새로 고침/.test(info1), info1);

ok('연타 방지 — 버튼이 잠긴다', await page.$eval('#syncBtn', el => el.disabled));

// --- 실패 응답 -------------------------------------------------------------
gasReply = { success: false, version: 24, message: '워크플로를 찾지 못했습니다 (a/b · x.yml).' };
await page.evaluate(() => { document.getElementById('syncBtn').disabled = false; });
await page.click('#syncBtn');
await page.waitForTimeout(600);
const info2 = await page.$eval('#syncInfo', el => el.textContent.trim());
const cls2 = await page.$eval('#syncInfo', el => el.className);
ok('실패 사유를 그대로 보여준다', /워크플로를 찾지 못했습니다/.test(info2), info2);
ok('실패는 실패로 표시된다', cls2.includes('fail'), cls2);

// --- 화면 새로 고침 --------------------------------------------------------
MEMBERS = [...MEMBERS, {
  id: 'u2', cohort_id: COHORT, name: '새로온이', phone: '1002', team: 'Y1', team_no: 2,
  role: '조원', location: '웨슬리홀', lunch: 'X', status: 'active', age: 31,
}];
const before = memberFetches;
await page.click('#syncReloadBtn');
await page.waitForTimeout(900);

ok('새로 고침이 데이터를 다시 읽는다', memberFetches > before, `${memberFetches - before}회`);
const names = await page.$$eval('.member-card-id', els => els.map(e => e.textContent.trim()));
ok('추가된 인원이 화면에 나온다', names.some(n => n.includes('새로온이')), names.join(', '));
const info3 = await page.$eval('#syncInfo', el => el.textContent.trim());
ok('새로 고침 결과를 알린다', /읽었습니다/.test(info3), info3);

await page.screenshot({ path: '/dg-sync-btn.png' });

await browser.close();
server.close();

done();
