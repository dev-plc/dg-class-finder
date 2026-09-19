// 전체 출석표에 김밥(🍙) · 과제(📝) 가 붙는지 검증.
// Supabase / GAS 는 가짜 응답으로 대신한다 (컨테이너 밖으로 못 나간다).

import { serveRepo, launch, makeReporter, SHOT } from './lib/harness.mjs';

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
// 아직 안 온 회차 하나. 앞의 16개는 today('2026-08-12') 보다 전이다.
// 전체 출석표는 이것까지 그리고, 회차 선택칸은 그리면 안 된다.
const UPCOMING = { session_date: '2026-08-16', label: '08/16', name: '17강' };
SESSIONS.push(UPCOMING);

const D = SESSIONS.map(s => s.session_date);   // D[0] 1강 · D[1] 자유교제 · D[2] 2강

// u1: D[0] 김밥 + 1강 과제 / u2: D[2] 김밥만 / u3: 2강 과제만 (폼 표기 '제2강')
const LUNCH = [
  { member_id: 'u1', session_date: D[0], applied: true },
  { member_id: 'u2', session_date: D[2], applied: true },
  { member_id: 'u4', session_date: D[1], applied: false },  // 취소분은 안 떠야 한다
];
// ⚠️ kind 가 인정 여부를 가른다 — '과제+소감문' 이 든 것만 인정이다.
const HOMEWORK = [
  { member_id: 'u1', lecture: '1강', kind: '과제+소감문' },
  { member_id: 'u3', lecture: '제2강', kind: '과제+소감문' },   // 폼 표기가 달라도 붙어야 한다
  { member_id: 'u4', lecture: '자유교재', kind: '과제+소감문' }, // '교재' → '교제' 정규화
  // 냈지만 종류가 모자란 것. 노란 칸이 되면 안 된다.
  { member_id: 'u2', lecture: '1강', kind: '과제' },
];

const ATT_BY_DATE = Object.fromEntries(MEMBERS.map((m, i) => [
  `${m.name}${m.phone}`,
  Object.fromEntries(SESSIONS.map((s, j) => [
    s.session_date,
    j === 1 ? '-' : j === 2 && i === 1 ? '돌봄' : (i + j) % 3 === 0 ? 'O' : (i + j) % 3 === 1 ? 'X' : '',
  ])),
]));

// 시트에 붙은 GAS 가 과제+소감문을 낸 결석 칸을 '과제' 로 바꿔 둔다.
// 앱이 X + 과제제출 기록을 보고 스스로 칠하는 칸과 **같은 모양**이어야 한다.
const MAKEUP_ID = `${MEMBERS[0].name}${MEMBERS[0].phone}`;
ATT_BY_DATE[MAKEUP_ID][D[4]] = '과제';

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

// --- 다가오는 주차 -----------------------------------------------------------
//
// 20강까지 했으면 다음 주 21강 열이 보여야 준비가 된다. 다만 그 칸을 '·(기록 없음)'
// 으로 두면 **전원이 빠진 것처럼** 읽히므로 '예정' 이라고 말해야 한다.
const soon = await page.evaluate((label) => {
  const ths = [...document.querySelectorAll('.matrix-table thead th')];
  const idx = ths.findIndex(th => th.querySelector('.mx-date')?.textContent.trim() === label);
  const th = ths[idx];
  const row = document.querySelector('.matrix-table tbody tr');
  const td = row?.children[idx];
  return {
    found: idx > 0,
    hidden: th ? th.classList.contains('old-col') : null,
    headCls: th?.className || '',
    soonText: th?.querySelector('.mx-soon')?.textContent.trim() || '',
    cellCls: td?.className || '',
    cellText: td?.querySelector('.mx-status')?.textContent.trim() || '',
  };
}, UPCOMING.label);

ok('다가오는 회차가 열로 들어온다', soon.found, JSON.stringify(soon));
ok('그 열은 접히지 않는다 (최근 10회차 안)', soon.hidden === false, `old-col=${soon.hidden}`);
ok("열 머리에 '예정' 을 단다", soon.soonText === '예정', soon.soonText);
ok('열 머리에 표시가 붙는다', /upcoming/.test(soon.headCls), soon.headCls);
ok('칸도 예정으로 칠한다', /upcoming/.test(soon.cellCls), soon.cellCls);
ok('결석으로 읽히지 않는다', !/absent|makeup/.test(soon.cellCls), soon.cellCls);
ok('칸 글자는 기록 없음 그대로', soon.cellText === '·', soon.cellText);

// 예정 회차가 들어와도 출석 수는 그대로다 ('O' 만 세므로)
const presentText = await page.$eval('.matrix-table tbody tr .mx-role',
                                     el => el.textContent.trim());
ok('출석 수는 예정 회차에 안 흔들린다', /출석 \d+/.test(presentText), presentText);

// ⚠️ 제일 중요한 것 — 회차 선택칸에는 예정 주차가 없어야 한다.
// 들어가면 조장이 미리 찍다가 GAS 거부로 실패한다.
//
// 모달은 열어 둔 채로 본다. 여기서 닫으면 뒤의 스크롤 고정 검사가 숨은 요소를
// 재게 되고, requestAnimationFrame 이 안 돌아 그 검사가 통째로 죽는다.
const picker = await page.$$eval('#sessionPicker option', els => els.map(e => e.value));
ok('회차 선택칸에는 예정 주차가 없다', !picker.includes(UPCOMING.session_date),
   picker.slice(0, 3).join(',') + ' …');
ok('지난 회차는 그대로 고를 수 있다', picker.length === SESSIONS.length - 1,
   `${picker.length}개 / 회차 ${SESSIONS.length}개`);

// 표는 딱 한 회차만 더 그린다 — 선택칸보다 하나 많아야 한다.
// (마지막 회차 뒤라면 더할 것이 없어 둘이 같아진다)
const colCount = await page.$$eval('.matrix-table thead th', els => els.length - 1);
ok('표는 선택칸보다 딱 하나 많다 (예정 하나)', colCount === picker.length + 1,
   `표 ${colCount}열 / 선택칸 ${picker.length}개`);

// --- 뱃지 위치 -------------------------------------------------------------
const cellsOf = (rowIdx) => page.$$eval(
  `.matrix-table tbody tr:nth-child(${rowIdx}) td`,
  els => els.map(e => ({
    status: e.querySelector('.mx-status')?.textContent.trim() || '',
    badges: e.querySelector('.mx-badges')?.textContent.trim() || '',
    cls: e.className,
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

// 시트가 '과제' 로 바꿔 둔 칸 (D[4]) 과, 앱이 X+과제제출로 칠하는 칸(u3 의 D[2]).
// 둘은 뜻이 같으므로 **같은 class** 여야 한다 — 다르면 같은 상황이 두 모양이 된다.
ok("시트의 '과제' 는 노란 칸이 된다",
   /\bmakeup\b/.test(r1[4].cls) && r1[4].status === '과제',
   `${r1[4].cls} / ${r1[4].status}`);
ok("파란 '그 밖의 표기'(special) 로 새지 않는다", !/special/.test(r1[4].cls), r1[4].cls);

const r2 = await cellsOf(rowOf('조원02'));   // u2 — D[2] 김밥만 · 1강은 과제만 냈다
ok('김밥만 신청한 주차엔 🍙 만', r2[2].badges === '🍙',
   JSON.stringify(r2.slice(0, 3)));
// 과제만 낸 회차. 냈다는 사실은 보이되 **노란 칸이 되면 안 된다** —
// 노란 칸은 '출석으로 인정됐다' 는 뜻이라 결석을 지워 버린다.
ok('종류가 모자란 제출도 📝 는 붙는다', r2[0].badges.includes('📝'), r2[0].badges);
ok('다만 인정은 아니다 (노란 칸이 아니다)', !/\bmakeup\b/.test(r2[0].cls), r2[0].cls);
ok('돌봄 표기가 그대로 보임', r2[2].status === '돌봄', r2[2].status);

const r3 = await cellsOf(rowOf('조원03'));   // u3 — '제2강' 과제
ok("폼 표기 '제2강' 도 2강 칸에 📝", r3[2].badges === '📝', JSON.stringify(r3.slice(0, 3)));
// u3 의 D[2] 는 시트에 X 인데 과제 기록이 있다 → 화면이 칠한다.
ok('시트발 과제와 앱이 칠한 과제가 같은 모양',
   r3[2].status === '과제' && /\bmakeup\b/.test(r3[2].cls),
   `${r3[2].cls} / ${r3[2].status}`);

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
    // ⚠️ nth-child 로 집으면 접힌 열(.old-col, display:none)을 잴 수 있다.
  // 숨은 칸의 좌표는 뜻이 없어 sticky 가 깨진 것처럼 보인다 — 보이는 열을 집는다.
  const head = [...document.querySelectorAll('.matrix-table thead th')]
    .find(th => !th.classList.contains('mx-corner') && th.offsetParent !== null);
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
// ⚠️ nth-child 로 다시 집으면 안 된다 — 이름 칸(th)이 1번이라 한 칸씩 밀리고,
// 접힌 열(.old-col)을 집을 수도 있다. 위에서 본 그 칸의 클래스를 그대로 본다.
ok("'-' 칸이 특이표기(파랑)로 칠해지지 않음", !noneCell.cls.includes('special'), noneCell.cls);
ok("'-' 칸은 '수업 없음'(none) 으로 칠해진다", noneCell.cls.includes('none'), noneCell.cls);

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
