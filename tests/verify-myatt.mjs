// 본인 출석 그리드 — 최근 10회차만 펴 두고 나머지는 접는지 검증.
// Supabase / GAS 는 가짜 응답으로 대신한다 (컨테이너 밖으로 못 나간다).

import { serveRepo, launch, makeReporter, SHOT } from './lib/harness.mjs';

const PORT = 8098;
const server = await serveRepo(PORT);

// --------------------------------------------------------------------------
// 가짜 데이터
//
// 20회차 중 18회차가 지나갔다 (08/16 · 08/23 은 아직). 18 - 10 = 8회차가
// 접혀야 한다. 미래 회차를 거르는 규칙과 접는 규칙이 겹치지 않게 둘 다 본다.
// --------------------------------------------------------------------------
const COHORT = 'DG-2026';
const TODAY = '2026-08-12';

const MEMBERS = [
  { id: 'u1', cohort_id: COHORT, name: '김조원', phone: '1111', team: 'Y1', team_no: 1,
    location: '웨슬리홀', role: '조원', lunch: 'O', status: 'active', age: 30 },
  { id: 'u2', cohort_id: COHORT, name: '박신입', phone: '2222', team: 'Y1', team_no: 2,
    location: '웨슬리홀', role: '조원', lunch: 'X', status: 'active', age: 25 },
];

const mkSessions = (n) => Array.from({ length: n }, (_, i) => {
  const iso = new Date(Date.UTC(2026, 3, 12 + i * 7)).toISOString().slice(0, 10);
  return { session_date: iso, label: iso.slice(5).replace('-', '/'), name: `${i + 1}강` };
});

const SESSIONS = mkSessions(20);
const PAST = SESSIONS.filter(s => s.session_date <= TODAY);

// 결석 하나(3회차)와 김밥 하나(2회차)를 **접히는 쪽**에 둔다.
// 접어도 요약 줄이 그것을 세고 있어야 한다.
const ATT = PAST.map((s, i) => ({
  session_date: s.session_date,
  status: i === 2 ? 'X' : i === 5 ? '돌봄' : 'O',
}));
const LUNCH = [{ member_id: 'u1', session_date: PAST[1].session_date, applied: true }];
// 강 번호가 뒤죽박죽이고 제출 시각이 빈 것도 섞여 있다.
// 문자열로 견주면 '9강' 이 '19강' 보다 앞서고, 시각이 빈 건에서 차례가 흔들린다.
const HOMEWORK = [
  { member_id: 'u1', lecture: '2강',   kind: '독후감', content: '', submitted_at: '2026-04-20T10:00:00' },
  { member_id: 'u1', lecture: '9강',   kind: '독후감', content: '', submitted_at: null },
  { member_id: 'u1', lecture: '18강',  kind: '독후감', content: 'https://ex.com/a', submitted_at: '2026-08-10T10:00:00' },
  { member_id: 'u1', lecture: '제17강', kind: '독후감', content: '', submitted_at: null },
  { member_id: 'u1', lecture: '16강',  kind: '독후감', content: '', submitted_at: '2026-07-20T10:00:00' },
  { member_id: 'u1', lecture: '15강',  kind: '독후감', content: '', submitted_at: null },
  { member_id: 'u1', lecture: '3강',   kind: '독후감', content: '', submitted_at: '2026-04-27T10:00:00' },
];

const { ok, done } = makeReporter('내 출석 현황');

const browser = await launch();

// 폰 크기로 본다 — 이 격자가 화면을 먹는 게 문제였던 곳이다.
async function openApp(sessions) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(`${TODAY}T09:00:00Z`));
  page.on('console', m => { if (m.type() === 'error') console.log('   [console.error] ' + m.text()); });
  page.on('pageerror', e => console.log('   [pageerror] ' + e.message));

  await page.route('**/rest/v1/**', route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop();
    const select = url.searchParams.get('select') || '';
    let body = [];
    if (table === 'dg_members') {
      body = select === 'cohort_id' ? [{ cohort_id: COHORT }] : MEMBERS;
    } else if (table === 'dg_sessions') {
      body = sessions;
    } else if (table === 'dg_attendance') {
      // 첫 로드는 '오늘 회차' 만 묻는다 (조원 명단 체크박스용) — 그건 빈 값.
      // 본인 이력 조회만 회차별 행을 돌려준다.
      body = select.includes('dg_members!inner') ? []
           : url.search.includes('member_id=eq.u1') ? ATT : [];
    } else if (table === 'dg_lunch') {
      body = LUNCH;
    } else if (table === 'dg_homework') {
      body = HOMEWORK;
    }
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });

  await page.route('**/script.google.com/**', route => {
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      success: true, version: 24, today: TODAY,
      currentSession: sessions[sessions.length - 1].session_date,
      sessions: sessions.map(s => ({ key: s.label, date: s.session_date, label: s.name })),
      data: [], locationMap: {}, teamLinkMap: {}, cohortHint: COHORT,
    }) });
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
  await page.waitForFunction(() => !document.getElementById('searchBtn').disabled,
                             null, { timeout: 20000 });
  return { context, page };
}

async function lookup(page, name, phone) {
  await page.fill('#name', name);
  await page.fill('#phone', phone);
  await page.click('#searchBtn');
  // 앞쪽 칩은 접혀 있어서 waitForSelector 의 '보이는가' 판정에 걸린다.
  await page.waitForFunction(
    () => document.querySelectorAll('#myAttendanceGrid .att-chip').length > 0,
    null, { timeout: 10000 });
  // 결과 카드가 부드럽게 스크롤돼 들어오는 동안 위쪽이 몇 px 움직인다.
  // 자리 검증을 하려면 그게 끝난 뒤에 재야 한다.
  await page.waitForTimeout(1200);
}

// 화면에 실제로 보이는 칩만 센다 (display:none 은 offsetParent 가 없다)
const gridState = (page) => page.evaluate(() => {
  const chips = [...document.querySelectorAll('#myAttendanceGrid .att-chip')];
  const shown = chips.filter(c => c.offsetParent !== null);
  const btn = document.getElementById('myAttendanceMoreBtn');
  const grid = document.getElementById('myAttendanceGrid');
  return {
    all: chips.length,
    shown: shown.length,
    first: shown[0]?.querySelector('.att-date')?.textContent.trim() || '',
    last: shown[shown.length - 1]?.querySelector('.att-date')?.textContent.trim() || '',
    gridH: Math.round(grid.getBoundingClientRect().height),
    btnTop: Math.round(btn.getBoundingClientRect().top + window.scrollY),
    btnShown: !btn.hidden,
    btnText: btn.textContent.trim(),
    expanded: btn.getAttribute('aria-expanded'),
    summary: document.getElementById('myAttendanceSummary').textContent.trim(),
  };
});

// ==========================================================================
// 1. 회차가 많을 때
// ==========================================================================
const { context, page } = await openApp(SESSIONS);
await lookup(page, '김조원', '1111');

const shut = await gridState(page);
ok('지나간 회차만 그린다 (미래 2회차 제외)', shut.all === 18, `${shut.all}칸 / 전체 20회차`);
ok('처음에는 최근 10회차만 보인다', shut.shown === 10, `${shut.shown}칸`);
ok('접히는 쪽은 오래된 회차다',
   shut.first === PAST[8].label && shut.last === PAST[17].label,
   `${shut.first} ~ ${shut.last} (기대 ${PAST[8].label} ~ ${PAST[17].label})`);
ok('버튼이 몇 회차가 접혔는지 말한다', shut.btnShown && /이전 8회차 더 보기/.test(shut.btnText),
   shut.btnText);
ok('버튼은 격자 위에 둔다', shut.btnTop > 0 && shut.btnTop < 5000, `top ${shut.btnTop}px`);

// 접어도 정보가 사라지면 안 된다 — 요약 줄은 전체 기준이다
ok('요약은 접어도 전체 회차 기준', /총 18회차/.test(shut.summary), shut.summary);
ok('접힌 쪽의 결석·특이표기도 요약에 들어간다',
   /결석 1/.test(shut.summary) && /그 외 1/.test(shut.summary), shut.summary);
// 과제 7건은 전부 지나간 강의(2·3·9·15·16·17·18강)라 요약에 다 들어간다
ok('접힌 쪽의 김밥·과제도 요약에 들어간다',
   /🍙 1회/.test(shut.summary) && /📝 7건/.test(shut.summary), shut.summary);

await page.screenshot({ path: `${SHOT}/dg-myatt-shut.png` });

// --- 과제 목록 -------------------------------------------------------------
//
// 최근 것(강 번호가 큰 것)부터, 다섯 건만 펴 두고 나머지는 접는다.
const hw = () => page.evaluate(() => {
  const rows = [...document.querySelectorAll('#myHomeworkList .hw-row')];
  const btn = document.getElementById('myHomeworkMoreBtn');
  return {
    all: rows.map(r => r.querySelector('.hw-lecture').textContent.trim()),
    shown: rows.filter(r => r.offsetParent !== null)
               .map(r => r.querySelector('.hw-lecture').textContent.trim()),
    btnShown: !btn.hidden,
    btnText: btn.textContent.trim(),
    summary: document.getElementById('myHomeworkSummary').textContent.trim(),
  };
});

const h = await hw();
ok('과제가 강 번호 내림차순으로 나온다',
   h.all.join(',') === '18강,제17강,16강,15강,9강,3강,2강', h.all.join(' → '));
ok('처음에는 다섯 건만 보인다', h.shown.length === 5, h.shown.join(' → '));
ok('보이는 것은 최근 다섯 건', h.shown.join(',') === '18강,제17강,16강,15강,9강',
   h.shown.join(' → '));
ok('나머지는 버튼 뒤에', h.btnShown && /이전 2건 더 보기/.test(h.btnText), h.btnText);
ok('요약은 접어도 전체 건수', /총 7건/.test(h.summary), h.summary);

await page.click('#myHomeworkMoreBtn');
await page.waitForTimeout(250);
const h2 = await hw();
ok('누르면 전부 보인다', h2.shown.length === 7, `${h2.shown.length}건`);
ok('펼치면 버튼이 접기로 바뀐다', /최근 5건만 보기/.test(h2.btnText), h2.btnText);
await page.click('#myHomeworkMoreBtn');
await page.waitForTimeout(250);
ok('다시 누르면 접힌다', (await hw()).shown.length === 5);

// --- 펼치기 ---------------------------------------------------------------
await page.click('#myAttendanceMoreBtn');
await page.waitForTimeout(250);
const open = await gridState(page);
ok('누르면 전부 보인다', open.shown === 18, `${open.shown}칸`);
ok('펼치면 버튼이 접기로 바뀐다', /최근 10회차만 보기/.test(open.btnText), open.btnText);
ok('펼침 상태를 알린다', open.expanded === 'true' && shut.expanded === 'false',
   `${shut.expanded} → ${open.expanded}`);
// 접힌 회차가 격자 앞쪽이라, 버튼이 아래 있으면 누르는 순간 밀려난다
ok('펼쳐도 방금 누른 버튼이 제자리에 있다', Math.abs(open.btnTop - shut.btnTop) <= 2,
   `${shut.btnTop}px → ${open.btnTop}px`);
ok('접었을 때 실제로 자리를 덜 차지한다', shut.gridH < open.gridH,
   `접음 ${shut.gridH}px / 펼침 ${open.gridH}px`);

await page.screenshot({ path: `${SHOT}/dg-myatt-open.png` });

// --- 다시 접기 ------------------------------------------------------------
await page.click('#myAttendanceMoreBtn');
await page.waitForTimeout(250);
const reshut = await gridState(page);
ok('다시 누르면 접힌다', reshut.shown === 10 && reshut.expanded === 'false',
   `${reshut.shown}칸 / expanded=${reshut.expanded}`);

// --- 다른 사람을 조회하면 접힌 채로 시작 -----------------------------------
await page.click('#myAttendanceMoreBtn');
await page.waitForTimeout(200);
await lookup(page, '박신입', '2222');
const other = await gridState(page);
ok('다른 사람을 조회하면 다시 접힌 채로 시작',
   other.expanded === 'false' && other.shown === 10, JSON.stringify(other));
ok('출결 기록이 없는 사람도 회차 수는 같다', other.all === 18, `${other.all}칸`);

await context.close();

// ==========================================================================
// 2. 회차가 10 이하일 때 — 접을 게 없으면 버튼도 없어야 한다
// ==========================================================================
const small = await openApp(mkSessions(7));
await lookup(small.page, '김조원', '1111');
const few = await gridState(small.page);
ok('회차가 10 이하면 접지 않는다', few.all === 7 && few.shown === 7,
   `${few.shown}/${few.all}칸`);
ok('접을 게 없으면 버튼도 없다', few.btnShown === false, few.btnText || '(없음)');
await small.context.close();

await browser.close();
server.close();

done();
