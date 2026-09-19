// 관리자 로그인 검증 — 맞으면 바로 들어가고, 틀렸을 때만 말한다.

import { serveRepo, launch, makeReporter } from './lib/harness.mjs';

const PORT = 8088;
const server = await serveRepo(PORT);

const { ok, done } = makeReporter('관리자 로그인');

const browser = await launch();
const context = await browser.newContext();
const page = await context.newPage();

const dialogs = [];
page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
page.on('pageerror', e => console.log('   [pageerror] ' + e.message));

// 조회 데이터는 이 검증의 관심사가 아니다 — 빈 응답으로 대신한다.
await page.route('**/rest/v1/**', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
await page.route('**/script.google.com/**', route =>
  route.fulfill({ status: 200, contentType: 'application/json',
                  body: JSON.stringify({ success: true, data: [], sessions: [] }) }));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForTimeout(1500);

const openLogin = async () => {
  await page.click('#adminBtn');
  await page.waitForSelector('#adminLoginModal.active', { timeout: 5000 });
};

// --- 틀렸을 때 ------------------------------------------------------------
await openLogin();
await page.fill('#adminId', 'plc');
await page.fill('#adminPassword', '틀린비번');
await page.click('.admin-login-btn');
await page.waitForTimeout(600);

const err = await page.evaluate(() => {
  const el = document.getElementById('adminLoginError');
  return { shown: !!el && getComputedStyle(el).display !== 'none', text: el?.textContent.trim() || '' };
});
ok('틀리면 그 자리에서 알린다', err.shown && /틀렸습니다/.test(err.text), JSON.stringify(err));
ok('틀렸을 때 페이지를 옮기지 않는다', !/admin\.html/.test(page.url()), page.url());
ok('알림창(alert)은 쓰지 않는다', dialogs.length === 0, dialogs.join(' | '));

// 다시 치기 시작하면 빨간 글씨를 지운다 — 고치는 중에도 남아 있으면
// 방금 친 것이 또 틀린 줄 안다.
await page.fill('#adminPassword', 'p');
await page.waitForTimeout(200);
ok('다시 입력하면 경고가 사라진다',
   await page.evaluate(() => getComputedStyle(document.getElementById('adminLoginError')).display === 'none'));

// --- 맞았을 때 ------------------------------------------------------------
dialogs.length = 0;
await page.fill('#adminId', 'plc');
await page.fill('#adminPassword', 'plc1234');
await Promise.all([
  page.waitForURL(/admin\.html/, { timeout: 10000 }),
  page.click('.admin-login-btn'),
]);
ok('맞으면 곧바로 관리자 화면으로', /admin\.html/.test(page.url()), page.url());
ok('성공했다고 한 번 더 누르게 하지 않는다', dialogs.length === 0, dialogs.join(' | '));
ok('로그인 표시가 남는다',
   await page.evaluate(() => sessionStorage.getItem('adminLoggedIn') === 'true'));

await browser.close();
server.close();

done();
