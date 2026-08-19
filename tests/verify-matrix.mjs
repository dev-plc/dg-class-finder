// 전체 출석표에 김밥(🍙) · 과제(📝) 가 붙는지 검증.
// Supabase / GAS 는 가짜 응답으로 대신한다 (컨테이너 밖으로 못 나간다).

import { serveRepo, launch, makeReporter, SHOT } from './lib/harness.mjs?v=92';

const PORT = 8093;
const server = await serveRepo(PORT);

// --------------------------------------------------------------------------
// 가짜 데이터 — 조원 30명 (렌더가 한 번에 끝나는지도 같이 본다)
// --------------------------------------------------------------------------
const COHORT = 'DG-2026';
const MEMBERS = Array.from({ length: 30 }, (_, i) => ({
  id: `u${i + 1}`, cohort_id: COHORT,
  name: `조원${String(i + 1).padStart(2, '0')}`, phone: String(1000 + i),
  team: 'Y1', team_no: i + 1, location: '웨슬리홀',
  role: i === 0 ? '관리자' : i === 1 ? '조장' : '조원',
  lunch: 'O', status: 'active', age: 30 + i,
}));
MEMBERS[0].name = '하관리자';   // 정렬 검증: 이름은 뒤지만 관리자라 맨 위

// 실제 화면처럼 16회차 — 가로 스크롤이 생겨야 고정을 볼 수 있다.
// 3번째(08/02)만 강의명이 '자유교제' — 수업 없는 회차다.
const SESSIONS = Array.from({ length: 16 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 3, 12 + i * 7));
  const iso = d.toISOString().slice(0, 10);
  return {
    session_date: iso,
    label: iso.slice(5).replace('-', '/'),
    name: i === 1 ? '자유교제' : `${i < 1 ? i + 1 : i}강`,
  };
});
const D = SESSIONS.map(s => s.session_date);   // D[0] 1강 · D[1] 자유교제 · D[2] 2강

// u1: D[0] 김밥 + 1강 과제 / u2: D[2] 김밥만 / u3: 2강 과제만 (폼 표기 '제2강')
const LUNCH = [
  { member_id: 'u1', session_date: D[0], applied: true },
  { member_id: 'u2', session_date: D[2], applied: true },
  { member_id: 'u4', session_date: D[1], applied: false },  // 취소분은 안 떠야 한다
];
const HOMEWORK = [
  { member_id: 'u1', lecture: '1강' },
  { member_id: 'u3', lecture: '제2강' },       // 폼 표기가 달라도 붙어야 한다
  { member_id: 'u4', lecture: '자유교재' },     // '교재' → '교제' 정규화
];

const ATT_BY_DATE = Object.fromEntries(MEMBERS.map((m, i) => [
  `${m.name}${m.phone}`,
  Object.fromEntries(SESSIONS.map((s, j) => [
    s.session_date,
    j === 1 ? '-' : j === 2 && i === 1 ? '돌봄' : (i + j) % 3 === 0 ? 'O' : (i + j) % 3 === 1 ? 'X' : '',
  ])),
]));

const { ok, done } = makeReporter('전체 출석표');

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 420, height: 860 } });
const page = await context.newPage();
page.on('dialog', d => { console.log('   [dialog] ' + d.message()); d.dismiss().catch(() => {}); });
page.on('console', m => { if (m.type() === 'error') console.log('   [console.error] ' + m.text()); });
page.on('pageerror', e => console.log('   [pageerror] ' + e.message));

const restCalls = [];
await page.route('**/rest/v1/**', route => {
  const url = new URL(route.request().url());
  const table = url.pathname.split('/').pop();
  restCalls.push(url.pathname.split('/').pop() + '?' + url.search.slice(1));
  let body = [];
  if (table === 'dg_members') {
    body = url.searchParams.get('select') === 'cohort_id' ? [{ cohort_id: COHORT }] : MEMBERS;
  } else if (table === 'dg_sessions') {
    body = SESSIONS;
  } else if (table === 'dg_lunch') {
    body = LUNCH.filter(r => r.applied !== false || !url.search.includes('applied=is.true'));
  } else if (table === 'dg_homework') {
    body = HOMEWORK;
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await page.route('**/script.google.com/**', route => {
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    success: true, version: 23,
    today: '2026-08-12',
    currentSession: '2026-08-09',
    sessions: SESSIONS.map(s => ({ key: s.label, date: s.session_date, label: s.name })),
    data: MEMBERS.map(m => ({
      id: `${m.name}${m.phone}`, name: m.name, phone: m.phone, team: m.team,
      attendanceByDate: ATT_BY_DATE[`${m.name}${m.phone}`] || {},
    })),
    locationMap: {}, teamLinkMap: {}, cohortHint: COHORT,
  }) });
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('searchBtn').disabled, null, { timeout: 20000 });

// 명단은 조장에게만 열린다 (튜터 role 만으로는 안 열린다)
await page.fill('#name', '조원02');
await page.fill('#phone', '1001');
await page.click('#searchBtn');
await page.waitForSelector('#teamMemberList .team-member-item', { timeout: 10000 });

// --- 매트릭스 열기 --------------------------------------------------------
const t0 = Date.now();
await page.click('#openMatrixBtn');
await page.waitForSelector('#matrixModal.active .matrix-table', { timeout: 10000 });
const openMs = Date.now() - t0;
ok('30명 조도 바로 열림', openMs < 3000, `${openMs}ms`);

// 김밥·과제는 뒤에 붙는다 — 다시 그려질 때까지 기다린다
await page.waitForSelector('.mx-badges', { timeout: 10000 }).catch(() => {});
await page.waitForTimeout(400);

const rows = await page.$$eval('.matrix-table tbody tr', els => els.length);
ok('행 = 조원 30명', rows === 30, `${rows}행`);

const heads = await page.$$eval('.matrix-table thead th', els =>
  els.map(e => ({
    session: e.querySelector('.mx-session')?.textContent.trim() || '',
    date: e.querySelector('.mx-date')?.textContent.trim() || '',
    nonClass: e.classList.contains('non-class'),
  })));
ok('헤더에 강의명 + 날짜가 같이 나옴',
   heads[1]?.session === '1강' && heads[1]?.date === SESSIONS[0].label,
   JSON.stringify(heads.slice(1, 4)));
ok('수업 없는 회차만 non-class',
   heads.slice(1).filter(h => h.nonClass).map(h => h.session).join(',') === '자유교제',
   heads.slice(1).map(h => `${h.session}:${h.nonClass ? '흐림' : '보통'}`).join(' '));

// --- 뱃지 위치 -------------------------------------------------------------
const cellsOf = (rowIdx) => page.$$eval(
  `.matrix-table tbody tr:nth-child(${rowIdx}) td`,
  els => els.map(e => ({
    status: e.querySelector('.mx-status')?.textContent.trim() || '',
    badges: e.querySelector('.mx-badges')?.textContent.trim() || '',
  })));

const nameOf = (rowIdx) => page.$eval(
  `.matrix-table tbody tr:nth-child(${rowIdx}) .mx-name`, el => el.textContent.trim());

ok('관리자가 맨 위', (await nameOf(1)) === '하관리자', await nameOf(1));
ok('조장이 두 번째', (await nameOf(2)) === '조원02', await nameOf(2));

const idx = await page.$$eval('.matrix-table tbody tr .mx-name',
  els => els.map(e => e.textContent.trim()));
const rowOf = (name) => idx.indexOf(name) + 1;

const r1 = await cellsOf(rowOf('하관리자'));   // u1 — D[0] 김밥 + 1강 과제
ok('신청·제출한 주차에 🍙📝 둘 다', r1[0].badges === '🍙📝', JSON.stringify(r1.slice(0, 3)));
ok('다른 주차엔 뱃지 없음', r1.slice(1).every(c => c.badges === ''),
   JSON.stringify(r1.slice(1, 4)));

const r2 = await cellsOf(rowOf('조원02'));   // u2 — D[2] 김밥만
ok('김밥만 신청한 주차엔 🍙 만', r2[2].badges === '🍙' && r2[0].badges === '',
   JSON.stringify(r2.slice(0, 3)));
ok('돌봄 표기가 그대로 보임', r2[2].status === '돌봄', r2[2].status);

const r3 = await cellsOf(rowOf('조원03'));   // u3 — '제2강' 과제
ok("폼 표기 '제2강' 도 2강 칸에 📝", r3[2].badges === '📝', JSON.stringify(r3.slice(0, 3)));

const r4 = await cellsOf(rowOf('조원04'));   // u4 — 김밥 취소 + '자유교재' 과제
ok('applied=false 는 🍙 안 뜸', !r4.some(c => c.badges.includes('🍙')),
   JSON.stringify(r4.slice(0, 3)));
ok("'자유교재' → 자유교제 칸에 📝", r4[1].badges === '📝', JSON.stringify(r4.slice(0, 3)));

// --- 요청 횟수 — 조원 수만큼 왕복이 늘면 안 된다 ---------------------------
// 본인 그리드(1) + 본인 과제(1) + 조 전체(1) 까지가 정상.
const lunchCalls = restCalls.filter(c => c.startsWith('dg_lunch')).length;
const hwCalls = restCalls.filter(c => c.startsWith('dg_homework')).length;
ok('30명이어도 김밥 요청이 몇 건뿐', lunchCalls <= 3, `${lunchCalls}회`);
ok('30명이어도 과제 요청이 몇 건뿐', hwCalls <= 3, `${hwCalls}회`);

// --- 스크롤 고정 -----------------------------------------------------------
const stick = await page.evaluate(() => {
  const sc = document.querySelector('.matrix-scroll');
  sc.scrollLeft = sc.scrollWidth;
  sc.scrollTop = sc.scrollHeight;
  return new Promise(r => requestAnimationFrame(() => {
    const scRect = sc.getBoundingClientRect();
    const nameCell = document.querySelector('.matrix-table tbody tr:nth-child(20) .mx-name-cell');
    const head = document.querySelector('.matrix-table thead th:nth-child(3)');
    const n = nameCell.getBoundingClientRect(), h = head.getBoundingClientRect();
    r({
      nameLeft: Math.round(n.left - scRect.left),
      headTop: Math.round(h.top - scRect.top),
      scrolledX: sc.scrollLeft > 0, scrolledY: sc.scrollTop > 0,
    });
  }));
});
ok('오른쪽 끝까지 스크롤해도 이름 열이 붙어 있음',
   !stick.scrolledX || Math.abs(stick.nameLeft) < 3, JSON.stringify(stick));
ok('아래로 스크롤해도 회차 헤더가 붙어 있음',
   !stick.scrolledY || Math.abs(stick.headTop) < 3, JSON.stringify(stick));

// --- 범례 ------------------------------------------------------------------
const legend = await page.$eval('.matrix-legend', el => el.textContent.replace(/\s+/g, ' ').trim());
ok('범례에 🍙 · 📝 설명 있음', legend.includes('🍙') && legend.includes('📝'), legend);

const noneCell = (await cellsOf(rowOf('조원05')))[1];
ok("'-' 는 수업 없음으로 표시", noneCell.status === '−', JSON.stringify(noneCell));
const noneCls = await page.$eval('.matrix-table tbody tr:nth-child(1) td:nth-child(2)',
  el => el.className);
ok("'-' 칸이 특이표기(파랑)로 칠해지지 않음", !noneCls.includes('special'), noneCls);

await page.evaluate(() => {
  const sc = document.querySelector('.matrix-scroll');
  sc.scrollLeft = 0; sc.scrollTop = 0;
});
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOT}/dg-matrix.png` });
await page.evaluate(() => document.body.classList.remove('dark-mode'));
await page.waitForTimeout(200);
await page.screenshot({ path: `${SHOT}/dg-matrix-light.png` });

await page.click('#matrixCloseBtn');
await browser.close();
server.close();

done();
