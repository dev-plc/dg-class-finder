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
  { id: 'u9', name: '과제낸이', team: 'YF1', team_no: 3, role: '조원', pastor: '이목사' },
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

  // u9 5월에 세 번 빠지고 그중 두 번은 과제를 냈다.
  // 인정은 한 달에 한 번뿐이라 2회로 남는다 → 5월 하차 검토 대상.
  ...['05/03', '05/10', '05/17'].map(k => ({ member_id: 'u9', session_date: D[k], status: 'X' })),
  ...['08/02', '08/09'].map(k => ({ member_id: 'u9', session_date: D[k], status: 'O' })),
];

// 과제 — 공지 규칙 5번. '예습과제와 소감문을 낸 결석' 은 한 달에 1회까지
// 출석으로 인정된다. 강의명으로 회차와 짝을 짓는다 (폼은 날짜를 모른다).
const HOMEWORK = [
  { member_id: 'u2', lecture: '14강' },   // 5월 결석 두 번 중 하나만 냈다
  { member_id: 'u9', lecture: '14강' },   // 5월 결석 세 번 중 둘을 냈다
  { member_id: 'u9', lecture: '제15강' }, // 폼에는 '제' 가 붙기도 한다
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
  } else if (table === 'dg_homework') {
    body = HOMEWORK;
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
  streak: r.querySelector('.ab-streak')?.textContent.trim() || '',
  dates: [...r.querySelectorAll('.ab-chip')].map(c => c.textContent.trim()),
})));

const t2 = await total();
ok('2회 이상만 나온다', t2.map(x => x.name).join(',') === '세번결석,과제낸이,연속결석',
   t2.map(x => `${x.name}(${x.n})`).join(' | '));
ok('결석 많은 순', t2[0].n === '3회' && t2[2].n === '2회',
   t2.map(x => `${x.name} ${x.n}`).join(' | '));
ok('어느 회차에 빠졌는지 보여준다',
   t2[0].dates.join(',') === '05/03,05/10,08/09', t2[0].dates.join(','));
ok('한 번만 빠진 사람은 없다', !t2.some(x => x.name === '한번결석'),
   t2.map(x => x.name).join(','));
// 같은 3회라도 띄엄띄엄 빠진 사람과 내리 두 주 안 나온 사람은 다른 이야기다
ok('누적 목록에도 연속 태그가 붙는다',
   t2.find(x => x.name === '연속결석')?.streak === '2주 연속',
   t2.map(x => `${x.name}:${x.streak || '-'}`).join(' | '));
ok('연속이 아닌 사람에게는 안 붙는다',
   t2.find(x => x.name === '세번결석')?.streak === '',
   t2.map(x => `${x.name}:${x.streak || '-'}`).join(' | '));
ok('강의가 아닌 회차의 결석은 세지 않는다', !t2.some(x => x.name === '자유만빠짐'),
   t2.map(x => x.name).join(','));
ok('세는 규칙을 화면에 적어 둔다',
   /결석\(X\)만/.test(await page.$eval('#abTotalNote', el => el.textContent)),
   await page.$eval('#abTotalNote', el => el.textContent.trim()));

// 문턱을 바꿀 수 있다
await page.click('#abThresholds button[data-min="3"]');
await page.waitForTimeout(300);
const t3 = await total();
ok('3회 이상으로 좁힌다', t3.map(x => x.name).join(',') === '세번결석,과제낸이',
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
ok('누적도 교역자별로 묶인다', tp.map(x => x.name).join(',') === '세번결석,연속결석,과제낸이',
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
// 알림창으로 알리면 확인을 한 번 더 눌러야 한다. 누른 자리에서 답한다.
const flashed = await page.$eval('#abWeekCopyBtn', el => el.textContent.trim());
ok('버튼이 그 자리에서 결과를 말한다', /3명 복사됨/.test(flashed), flashed);
ok('알림창은 뜨지 않는다', dialogs.length === 0, dialogs.join(' | '));
await page.waitForTimeout(2200);
ok('잠시 뒤 원래 글자로 돌아온다',
   /명단 복사/.test(await page.$eval('#abWeekCopyBtn', el => el.textContent)),
   await page.$eval('#abWeekCopyBtn', el => el.textContent.trim()));

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
ok('누적 복사본에도 연속 태그가 붙는다',
   /연속결석 \(2회: 08\/02 08\/09 · 2주 연속\)/.test(copied2),
   copied2.replace(/\n/g, ' / '));

// --- 하차 검토 ---------------------------------------------------------------
//
// 공지 규칙 6번: "특별한 이유없이 월 2회 이상 결석시 하차하게 되며"
// 공지 규칙 5번: "예습과제와 소감문을 낸 경우 한달에 1회에 한하여 출석으로 인정"
//
// 사람 이름이 올라가는 목록이라 규칙을 넓게 잡으면 안 된다. 한 번이라도
// 엉뚱한 사람이 오르면 이 화면을 아무도 안 믿는다.
const drop = () => page.$$eval('#abDropList .ab-row', els => els.map(r => ({
  name: r.querySelector('.ab-name').childNodes[0].textContent.trim(),
  n: r.querySelector('.ab-n')?.textContent.trim() || '',
  credit: r.querySelector('.ab-credit')?.textContent.trim() || '',
  chips: [...r.querySelectorAll('.ab-chip')].map(c => c.textContent.trim()),
  credited: [...r.querySelectorAll('.ab-chip.credited')].map(c => c.textContent.trim()),
  hwChips: [...r.querySelectorAll('.ab-chip.hw')].map(c => c.textContent.trim()),
  hw: r.querySelector('.ab-hw')?.textContent.trim() || '',
  hwNone: !!r.querySelector('.ab-hw.none'),
})));
const setMonth = async (mo) => {
  await page.selectOption('#abMonthPicker', mo);
  await page.waitForTimeout(300);
};

const months = await page.$$eval('#abMonthPicker option', els => els.map(e => e.value));
ok('강의가 있는 달만 고를 수 있다', months.join(',') === '2026-05,2026-08', months.join(','));
ok('기본은 가장 최근 달',
   await page.$eval('#abMonthPicker', el => el.value) === '2026-08');

// 8월 강의는 08/02 · 08/09 둘. 연속결석이 둘 다 빠졌고 과제는 없다.
await setMonth('2026-08');
const aug = await drop();
ok('월 2회 이상 결석한 사람이 오른다', aug.map(x => x.name).join(',') === '연속결석',
   aug.map(x => `${x.name}(${x.n})`).join(' | '));
ok('몇 회 결석인지 적는다', aug[0].n === '결석 2회', aug[0].n);
ok('어느 회차인지 보여준다', aug[0].chips.join(',') === '08/02,08/09', aug[0].chips.join(','));
ok('한 번만 빠진 사람은 오르지 않는다', !aug.some(x => x.name === '세번결석'),
   aug.map(x => x.name).join(','));
ok('개근한 사람도 오르지 않는다', !aug.some(x => x.name === '개근이'));

// 5월 — 과제를 낸 결석은 한 달에 하나까지 출석으로 인정된다
await setMonth('2026-05');
const may = await drop();
ok('과제를 내서 1회로 줄면 오르지 않는다', !may.some(x => x.name === '세번결석'),
   may.map(x => `${x.name}(${x.n})`).join(' | '));
ok('인정은 한 달에 한 번뿐 — 두 번 냈어도 하나만 지워진다',
   may.some(x => x.name === '과제낸이' && x.n === '결석 2회'),
   may.map(x => `${x.name}(${x.n})`).join(' | '));

const hwMan = may.find(x => x.name === '과제낸이');
ok('세 회차 다 보여준다 — 지운 것도 보여야 믿는다', hwMan.chips.length === 3,
   hwMan.chips.join(','));
ok('인정받은 회차를 따로 표시한다', hwMan.credited.length === 1, hwMan.credited.join(','));
ok('인정 회차에 📝 를 붙인다', /📝/.test(hwMan.credited[0]), hwMan.credited[0]);
ok('몇 회 인정됐는지 적는다', /과제 인정 1회/.test(hwMan.credit), hwMan.credit);

// 규칙 1번 — "결석자 심방시 … 반드시 과제 제출 확인할 것".
// 연락하기 전에 봐야 하는 값이라 이름을 눌러 들어가지 않고 그 줄에서 본다.
ok('그 줄에서 과제 제출 현황을 보여준다', /📝 2건/.test(hwMan.hw), hwMan.hw);
ok('최근에 어디까지 냈는지도 적는다', /최근 15강/.test(hwMan.hw), hwMan.hw);
ok("'9강' 이 '15강' 보다 최근이 되지 않는다", !/최근 9강/.test(hwMan.hw), hwMan.hw);

// 인정 한도(월 1회)에 걸렸을 뿐 공부는 이어간 사람과, 아무것도 안 낸 사람은
// 다른 이야기다. 인정 못 받은 제출도 회차에 표시한다.
ok('인정 못 받은 제출도 회차에 표시한다', hwMan.hwChips.length === 1,
   hwMan.hwChips.join(','));
ok('그 회차에도 📝 가 붙는다', /📝/.test(hwMan.hwChips[0]), hwMan.hwChips[0]);
ok('인정받은 것과는 다르게 칠한다',
   hwMan.credited[0] !== hwMan.hwChips[0],
   `${hwMan.credited[0]} vs ${hwMan.hwChips[0]}`);

// 아무것도 안 낸 사람 — 심방 때 제일 먼저 물어야 하는 사람이다
await setMonth('2026-08');
const noHw = (await drop()).find(x => x.name === '연속결석');
ok('한 건도 안 낸 사람은 그렇다고 적는다', noHw.hwNone && /제출 없음/.test(noHw.hw),
   noHw.hw);
await setMonth('2026-05');

// 규칙을 모르면 숫자를 믿을 수 없다
const rule = await page.$eval('.ab-rule', el => el.textContent.replace(/\s+/g, ' ').trim());
ok('규칙을 화면에 적어 둔다', /월 2회 이상/.test(rule) && /한 달에 1회까지/.test(rule), rule);
ok('화면이 모르는 것을 아는 척하지 않는다',
   /특별한 이유.*알지 못합니다/.test(rule) && /하차 확정이 아니라/.test(rule), rule);

// 복사본이 화면과 다른 수를 말하면 그 자리에서 어긋난다
await page.click('#abDropCopyBtn');
await page.waitForTimeout(300);
const dropCopied = await page.evaluate(() => navigator.clipboard.readText());
ok('복사본도 인정을 뺀 수로 적는다', /결석 2회/.test(dropCopied),
   dropCopied.replace(/\n/g, ' / '));
ok('복사본에도 인정 표시가 남는다', /📝/.test(dropCopied), dropCopied.replace(/\n/g, ' / '));
ok('무슨 목록인지 첫 줄에 적는다', /5월 하차 검토/.test(dropCopied),
   dropCopied.split('\n')[0]);
ok('복사본에도 교역자가 붙는다', /\[이목사\] YF1 과제낸이/.test(dropCopied),
   dropCopied.replace(/\n/g, ' / '));
ok('복사본에도 과제 현황이 붙는다 — 심방 전에 확인할 값이다',
   /과제 2건 최근 15강/.test(dropCopied), dropCopied.replace(/\n/g, ' / '));

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
