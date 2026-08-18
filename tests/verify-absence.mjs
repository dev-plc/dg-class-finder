// 결석 현황 검증 — 이 주차 결석자 · 2회 이상 결석자.
//
// 세는 규칙이 이 화면의 전부다. 넓게 세면 엉뚱한 사람이 하차 명단에 올라오고,
// 한 번 그런 일이 있으면 아무도 이 화면을 믿지 않는다. 그래서 규칙마다
// 그 규칙 때문에만 걸리는 사람을 하나씩 심어 두고 확인한다.

import { serveRepo, launch, makeReporter, SHOT } from './lib/harness.mjs';

const PORT = 8099;
const server = await serveRepo(PORT);

const COHORT = 'DG-2026';
const TODAY = '2026-08-12';

// 회차: 05/03 ~ 08/09 매주 · 08/16 은 아직 안 옴 · 06/07 은 '자유교제'(강의 아님)
const SESSIONS = [
  { session_date: '2026-05-03', label: '05/03', name: '14강' },
  { session_date: '2026-05-10', label: '05/10', name: '15강' },
  { session_date: '2026-05-17', label: '05/17', name: '16강' },
  { session_date: '2026-06-07', label: '06/07', name: '자유교제' },
  { session_date: '2026-08-02', label: '08/02', name: '17강' },
  { session_date: '2026-08-09', label: '08/09', name: '18강' },
  { session_date: '2026-08-16', label: '08/16', name: '19강' },
];
const D = Object.fromEntries(SESSIONS.map(s => [s.label, s.session_date]));

// 담당교역자를 조 차례와 어긋나게 둔다 — 그래야 정렬을 실제로 검증할 수 있다.
//   조 차례  : 한번결석(YF1) · 세번결석(YF1) · 연속결석(YM1)
//   교역자   : 세번결석(김목사) · 연속결석(김목사) · 한번결석(이목사)
const MEMBERS = [
  { id: 'u1', name: '한번결석', team: 'YF1', team_no: 1, role: '조장', pastor: '이목사' },
  { id: 'u2', name: '세번결석', team: 'YF1', team_no: 2, role: '조원', pastor: '김목사' },
  { id: 'u3', name: '연속결석', team: 'YM1', team_no: 1, role: '조원', pastor: '김목사' },
  { id: 'u4', name: '개근이', team: 'YM1', team_no: 2, role: '조원', pastor: '김목사' },
  { id: 'u5', name: '빈칸이', team: 'C1', team_no: 1, role: '조원', pastor: '이목사' },
  { id: 'u6', name: '돌봄이', team: 'C1', team_no: 2, role: '조원', pastor: '' },
  { id: 'u7', name: '이수료', team: 'C1', team_no: 3, role: '조원', pastor: '' },
  { id: 'u8', name: '자유만빠짐', team: 'C1', team_no: 4, role: '조원', pastor: '' },
].map((m, i) => ({ ...m, cohort_id: COHORT, phone: String(1001 + i), sheet_row: i + 1,
                   location: '웨슬리홀', lunch: 'O', status: 'active', age: 30 }));

// 세는 규칙을 하나씩 겨눈다.
//   u1 08/09 만 결석 (1회)                     → 이 주차 O · 누적 X
//   u2 05/03 · 05/10 · 08/09 결석 (3회)        → 3회 이상에도 걸린다
//   u3 08/02 · 08/09 연속 결석 (2회)           → '2주 연속' 표시
//   u4 전부 출석                                → 어디에도 안 나온다
//   u5 08/09 이 빈칸                            → 결석이 아니다
//   u6 08/09 이 '돌봄'                          → 결석이 아니다
//   u7 08/09 이 '◎'                            → 결석이 아니다
//   u8 06/07(자유교제)만 결석                   → 강의 회차가 아니라 안 센다
const ATT = [
  ...['05/03', '05/10', '05/17', '08/02'].map(k => ({ member_id: 'u1', session_date: D[k], status: 'O' })),
  { member_id: 'u1', session_date: D['08/09'], status: 'X' },

  { member_id: 'u2', session_date: D['05/03'], status: 'X' },
  { member_id: 'u2', session_date: D['05/10'], status: 'X' },
  { member_id: 'u2', session_date: D['05/17'], status: 'O' },
  { member_id: 'u2', session_date: D['08/02'], status: 'O' },
  { member_id: 'u2', session_date: D['08/09'], status: 'X' },

  ...['05/03', '05/10', '05/17'].map(k => ({ member_id: 'u3', session_date: D[k], status: 'O' })),
  { member_id: 'u3', session_date: D['08/02'], status: 'X' },
  { member_id: 'u3', session_date: D['08/09'], status: 'X' },

  ...['05/03', '05/10', '05/17', '08/02', '08/09'].map(k => ({ member_id: 'u4', session_date: D[k], status: 'O' })),

  ...['05/03', '05/10', '05/17', '08/02'].map(k => ({ member_id: 'u5', session_date: D[k], status: 'O' })),
  { member_id: 'u5', session_date: D['08/09'], status: '' },

  { member_id: 'u6', session_date: D['08/09'], status: '돌봄' },
  { member_id: 'u7', session_date: D['08/09'], status: '◎' },

  { member_id: 'u8', session_date: D['06/07'], status: 'X' },
  { member_id: 'u8', session_date: D['08/09'], status: 'O' },
];

const { ok, done } = makeReporter('결석 현황');

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1000, height: 900 } });
await context.addInitScript(() => sessionStorage.setItem('adminLoggedIn', '1'));
const page = await context.newPage();
await page.clock.setFixedTime(new Date(`${TODAY}T09:00:00Z`));
const dialogs = [];
page.on('dialog', d => { dialogs.push(d.message()); d.accept().catch(() => {}); });
page.on('pageerror', e => console.log('   [pageerror] ' + e.message));

let historyCalls = 0;
await page.route('**/rest/v1/**', route => {
  const url = new URL(route.request().url());
  const table = url.pathname.split('/').pop();
  const select = url.searchParams.get('select') || '';
  let body = [];
  if (table === 'dg_members') {
    body = select === 'cohort_id' ? [{ cohort_id: COHORT }] : MEMBERS;
  } else if (table === 'dg_sessions') {
    body = SESSIONS;
  } else if (table === 'dg_attendance') {
    // 전 회차를 한 번에 받는 조회만 이력이다 (session_date 로 좁히지 않는 쪽)
    if (select.includes('session_date') && !url.search.includes('session_date=eq.')) {
      historyCalls++;
      body = ATT;
    }
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.route('**/script.google.com/**', route =>
  route.fulfill({ status: 200, contentType: 'application/json',
                  body: JSON.stringify({ success: true, today: TODAY }) }));

await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });

await page.click('.tab-btn[data-tab="absence"]');
await page.waitForSelector('#abWeekList .ab-row', { timeout: 15000 });

// --- 주차 목록 -------------------------------------------------------------
const weeks = await page.$$eval('#abSessionPicker option', els => els.map(e => e.value));
ok('미래 회차는 고를 수 없다', !weeks.includes(D_0816()), weeks.join(','));
function D_0816() { return '2026-08-16'; }
ok('강의가 아닌 회차(자유교제)는 목록에 없다', !weeks.includes('2026-06-07'), weeks.join(','));
ok('기본 주차 = 오늘과 가장 가까운 강의 회차',
   (await page.$eval('#abSessionPicker', el => el.value)) === '2026-08-09',
   await page.$eval('#abSessionPicker', el => el.value));

// --- 이 주차 결석자 --------------------------------------------------------
const week = () => page.$$eval('#abWeekList .ab-row', els => els.map(r => ({
  team: r.querySelector('.ab-team').textContent.trim(),
  name: r.querySelector('.ab-name').childNodes[0].textContent.trim(),
  pastor: r.querySelector('.ab-pastor')?.textContent.trim() || '',
  extra: r.querySelector('.ab-extra').textContent.trim(),
})));

const w = await week();
ok('X 인 사람만 나온다 (3명)', w.length === 3, w.map(x => x.name).join(', '));
ok('빈칸은 결석이 아니다', !w.some(x => x.name === '빈칸이'), w.map(x => x.name).join(', '));
ok('돌봄 · ◎ 도 결석이 아니다',
   !w.some(x => ['돌봄이', '이수료'].includes(x.name)), w.map(x => x.name).join(', '));
ok('개근한 사람은 없다', !w.some(x => x.name === '개근이'), w.map(x => x.name).join(', '));
ok('조 차례로 나온다 (YF · YM · C)',
   w.map(x => x.team).join(',') === 'YF1,YF1,YM1', w.map(x => `${x.team} ${x.name}`).join(' | '));
ok('연속 결석은 몇 주째인지 알려 준다',
   w.find(x => x.name === '연속결석')?.extra.includes('2주 연속'),
   w.map(x => `${x.name}:${x.extra}`).join(' | '));
ok('한 번만 빠진 사람에게는 연속 표시가 없다',
   w.find(x => x.name === '한번결석')?.extra === '',
   w.map(x => `${x.name}:${x.extra || '-'}`).join(' | '));
ok('머리말이 주차와 인원을 보여준다',
   /08\/09/.test(await page.$eval('#abWeekCount', el => el.textContent))
   && /3명/.test(await page.$eval('#abWeekCount', el => el.textContent)),
   await page.$eval('#abWeekCount', el => el.textContent.trim()));

// 기록이 없는 사람이 있으면 '결석 아님' 이라고 밝힌다 (없는 사실을 만들지 않는다)
const note = await page.$eval('#abWeekNote', el => el.textContent.trim());
ok('기록 없는 사람은 결석으로 세지 않았다고 알린다', /기록이 없습니다/.test(note), note);

// --- 2회 이상 결석자 -------------------------------------------------------
const total = () => page.$$eval('#abTotalList .ab-row', els => els.map(r => ({
  name: r.querySelector('.ab-name').childNodes[0].textContent.trim(),
  n: r.querySelector('.ab-n')?.textContent.trim() || '',
  dates: [...r.querySelectorAll('.ab-chip')].map(c => c.textContent.trim()),
})));

const t2 = await total();
ok('2회 이상만 나온다', t2.map(x => x.name).join(',') === '세번결석,연속결석',
   t2.map(x => `${x.name}(${x.n})`).join(' | '));
ok('결석 많은 순', t2[0].n === '3회' && t2[1].n === '2회',
   t2.map(x => `${x.name} ${x.n}`).join(' | '));
ok('어느 회차에 빠졌는지 보여준다',
   t2[0].dates.join(',') === '05/03,05/10,08/09', t2[0].dates.join(','));
ok('한 번만 빠진 사람은 없다', !t2.some(x => x.name === '한번결석'),
   t2.map(x => x.name).join(','));
ok('강의가 아닌 회차의 결석은 세지 않는다', !t2.some(x => x.name === '자유만빠짐'),
   t2.map(x => x.name).join(','));
ok('세는 규칙을 화면에 적어 둔다',
   /결석\(X\)만/.test(await page.$eval('#abTotalNote', el => el.textContent)),
   await page.$eval('#abTotalNote', el => el.textContent.trim()));

// 문턱을 바꿀 수 있다
await page.click('#abThresholds button[data-min="3"]');
await page.waitForTimeout(300);
const t3 = await total();
ok('3회 이상으로 좁힌다', t3.map(x => x.name).join(',') === '세번결석',
   t3.map(x => x.name).join(','));
ok('고른 문턱에 표시가 남는다',
   await page.$eval('#abThresholds button[data-min="3"]', el => el.classList.contains('on')));
await page.click('#abThresholds button[data-min="4"]');
await page.waitForTimeout(300);
ok('아무도 없으면 그렇다고 말한다',
   /4회 이상 결석한 사람이 없습니다/.test(await page.$eval('#abTotalList', el => el.textContent)),
   await page.$eval('#abTotalList', el => el.textContent.trim()));
await page.click('#abThresholds button[data-min="2"]');
await page.waitForTimeout(300);

// --- 주차를 바꿔도 다시 받지 않는다 ---------------------------------------
const callsBefore = historyCalls;
await page.selectOption('#abSessionPicker', '2026-08-02');
await page.waitForTimeout(400);
const w2 = await week();
ok('주차를 바꾸면 그 주차 결석자로 바뀐다',
   w2.map(x => x.name).join(',') === '연속결석', w2.map(x => x.name).join(','));
ok('주차만 바꿀 때는 다시 받지 않는다', historyCalls === callsBefore,
   `${callsBefore} → ${historyCalls}회`);

// --- 아직 출석을 찍지 않은 주차 -------------------------------------------
await page.selectOption('#abSessionPicker', '2026-05-17');
await page.waitForTimeout(400);
// 05/17 은 u1·u2·u3 이 O, 나머지는 기록 없음 → 결석 0명이지만 '전원 출석' 은 아니다
await page.selectOption('#abSessionPicker', '2026-08-09');
await page.waitForTimeout(400);

// --- 담당교역자별 정렬 -----------------------------------------------------
//
// 하차·상담은 교역자가 나눠 맡는다. 조 순서로만 나오면 자기 몫을 매번 눈으로
// 골라내야 한다.
ok('교역자 이름이 줄에 보인다', (await week()).every(x => x.pastor),
   (await week()).map(x => `${x.name}:${x.pastor || '-'}`).join(' | '));

await page.selectOption('#abSortPicker', 'pastor');
await page.waitForTimeout(400);
const wp = await week();
ok('교역자별로 묶인다', wp.map(x => x.pastor).join(',') === '김목사,김목사,이목사',
   wp.map(x => `${x.pastor} ${x.name}`).join(' | '));
ok('묶음 안에서는 조 차례',
   wp.map(x => x.name).join(',') === '세번결석,연속결석,한번결석',
   wp.map(x => x.name).join(','));

const tp = await total();
ok('누적도 교역자별로 묶인다', tp.map(x => x.name).join(',') === '세번결석,연속결석',
   tp.map(x => x.name).join(','));

await page.selectOption('#abSortPicker', 'team');
await page.waitForTimeout(400);
ok('조 순서로 되돌린다',
   (await week()).map(x => x.name).join(',') === '한번결석,세번결석,연속결석',
   (await week()).map(x => x.name).join(','));

// --- 명단 복사 -------------------------------------------------------------
await context.grantPermissions(['clipboard-read', 'clipboard-write']);
dialogs.length = 0;
await page.click('#abWeekCopyBtn');
await page.waitForTimeout(500);
const copied = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
ok('이 주차 명단을 클립보드로 복사한다',
   /한번결석/.test(copied) && /세번결석/.test(copied) && !/개근이/.test(copied),
   copied.replace(/\n/g, ' / '));
// 교역자는 정렬과 상관없이 늘 붙는다 — 조 순서로 복사했다고 누가 맡은
// 사람인지 빠지면, 받는 쪽에서 다시 물어봐야 한다.
ok('조 순서로 봐도 교역자가 붙는다',
   /\[이목사\] YF1 한번결석/.test(copied) && /\[김목사\] YM1 연속결석/.test(copied),
   copied.replace(/\n/g, ' / '));
// 화면에 보이는 것이 복사본에 없으면 옮겨 적을 때 빠진다
ok('연속 결석 표시도 함께 복사된다', /연속결석 \(2주 연속\)/.test(copied),
   copied.replace(/\n/g, ' / '));
ok('한 번만 빠진 사람에게는 붙지 않는다', /한번결석$|한번결석\n/m.test(copied + '\n'),
   copied.replace(/\n/g, ' / '));
ok('복사했다고 알린다', dialogs.some(d => /3명/.test(d)), dialogs.join(' | '));

// 교역자별로 보고 있으면 복사 명단에도 붙는다 — 그대로 나눠 보내는 글이다
await page.selectOption('#abSortPicker', 'pastor');
await page.waitForTimeout(300);
await page.click('#abWeekCopyBtn');
await page.waitForTimeout(500);
const copiedP = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
ok('교역자별로 볼 때는 그 차례로 복사된다',
   /\[김목사\] YF1 세번결석/.test(copiedP)
   && copiedP.indexOf('[김목사]') < copiedP.indexOf('[이목사]'),
   copiedP.replace(/\n/g, ' / '));
await page.selectOption('#abSortPicker', 'team');
await page.waitForTimeout(300);

dialogs.length = 0;
await page.click('#abTotalCopyBtn');
await page.waitForTimeout(500);
const copied2 = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
ok('누적 명단에는 회차까지 붙는다', /세번결석 \(3회: 05\/03 05\/10 08\/09\)/.test(copied2),
   copied2.replace(/\n/g, ' / '));
ok('누적 명단에도 교역자가 붙는다', /\[김목사\] YF1 세번결석/.test(copied2),
   copied2.replace(/\n/g, ' / '));

await page.screenshot({ path: `${SHOT}/dg-absence.png`, fullPage: true });

// 모바일에서도 줄이 깨지지 않는가
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(400);
const overflow = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('폰에서 가로로 밀리지 않는다', overflow <= 1, `${overflow}px`);
await page.screenshot({ path: `${SHOT}/dg-absence-mobile.png`, fullPage: true });

await browser.close();
server.close();

done();
