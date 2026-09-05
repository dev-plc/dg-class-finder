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
// 18강 칸은 파일을 넷 올린 사람 — 폼이 한 칸에 쉼표로 이어 붙였다.
// 통째로 href 에 넣으면 아무것도 열리지 않는다.
const FOUR = [
  'https://drive.google.com/open?id=16sCcGz5h61oiKgMwekQNk146oRt7NxzW',
  'https://drive.google.com/open?id=1DXa8JkuyKFa0Y7IvO-QswyCKlFKmWhBR',
  'https://drive.google.com/open?id=1tx75D3reEq0OkAKNvyf83ai7w9rV3YTb',
  'https://drive.google.com/open?id=1kg1mb5qMI78SKz1iB8wkLzA7H2dTPKpA',
];

const HOMEWORK = [
  { member_id: 'u1', lecture: '2강',   kind: '과제+소감문', content: '', submitted_at: '2026-04-20T10:00:00' },
  { member_id: 'u1', lecture: '9강',   kind: '과제+소감문', content: '', submitted_at: null },
  { member_id: 'u1', lecture: '18강',  kind: '과제+소감문', content: FOUR.join(', '), submitted_at: '2026-08-10T10:00:00' },
  { member_id: 'u1', lecture: '제17강', kind: '과제+소감문', content: 'https://ex.com/a', submitted_at: null },
  { member_id: 'u1', lecture: '16강',  kind: '과제+소감문', content: '손으로 적어 냈습니다', submitted_at: '2026-07-20T10:00:00' },
  { member_id: 'u1', lecture: '15강',  kind: '과제+소감문', content: '', submitted_at: null },
  { member_id: 'u1', lecture: '3강',   kind: '과제+소감문', content: '', submitted_at: '2026-04-27T10:00:00' },
];

const { ok, done } = makeReporter('내 출석 현황');

const browser = await launch();

// 폰 크기로 본다 — 이 격자가 화면을 먹는 게 문제였던 곳이다.
async function openApp(sessions, homework = HOMEWORK, att = null) {
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
           : url.search.includes('member_id=eq.u1') ? (att || ATT) : [];
    } else if (table === 'dg_lunch') {
      body = LUNCH;
    } else if (table === 'dg_homework') {
      body = homework;
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

// --- 안 낸 과제와 소감문 안내 ----------------------------------------------
//
// 낸 것만 보여 주면 빠뜨린 사람은 빠뜨린 줄을 모른다.
// 지나간 18회차 중 과제가 붙은 것은 7건 → 11건이 비어 있다.
const todo = () => page.evaluate(() => {
  const box = document.getElementById('myHomeworkTodo');
  const btn = box.querySelector('.hw-todo-btn');
  return {
    cls: box.className,
    title: box.querySelector('.hw-todo-title')?.textContent.trim() || '',
    chips: [...box.querySelectorAll('.hw-todo-chip')].map(c => c.textContent.trim()),
    rest: box.querySelector('.hw-todo-rest')?.textContent.trim() || '',
    href: btn?.getAttribute('href') || '',
    label: btn?.textContent.trim() || '',
    target: btn?.getAttribute('target') || '',
  };
});

const td = await todo();
// 18회차 중 6회차는 '돌봄' 이라 안 묻는다(예외 표기). 남는 17 − 제출 7 = 10.
ok('안 낸 건수를 센다 (돌봄 뺀 17회차 - 7건 제출)', /10건/.test(td.title), td.title);
ok("문구는 '과제와 소감문'", /과제와 소감문/.test(td.title) && !/[^와] 과제 /.test(td.title), td.title);
ok('안 낸 강의를 여덟 개까지만 늘어놓는다', td.chips.length === 8, td.chips.join(' · '));
ok('나머지는 건수로', td.rest === '외 2건', td.rest);
ok('낸 강의는 목록에 없다', !td.chips.includes('18강') && !td.chips.includes('16강'),
   td.chips.join(' · '));
ok('제출 폼으로 이어진다', td.href === 'https://forms.gle/cnhxuonpz2tmMu2y9', td.href);
ok('새 창으로 연다 (조회 화면을 잃지 않게)', td.target === '_blank', td.target);
ok('버튼 문구', td.label === '제출하기 →', td.label);

// --- 제출 링크 가르기 -------------------------------------------------------
//
// 파일을 두 개 이상 올리면 폼이 한 칸에 쉼표로 이어 붙인다. 통째로 href 에
// 넣으면 두 번째 주소까지 한 주소로 읽혀 **첫 개도 열리지 않는다.**
const linkRow = (lecture) => page.evaluate((lec) => {
  const row = [...document.querySelectorAll('#myHomeworkList .hw-row')]
    .find(r => r.querySelector('.hw-lecture').textContent.trim() === lec);
  if (!row) return null;
  const a = [...row.querySelectorAll('.hw-links a')];
  return {
    hrefs: a.map(x => x.getAttribute('href')),
    labels: a.map(x => x.textContent.trim()),
    titles: a.map(x => x.getAttribute('title')),
    multi: a.every(x => x.classList.contains('multi')),
    // 낱개로 눌리는가 — 버튼끼리 겹쳐 있으면 두 번째를 못 누른다
    boxes: a.map(x => { const b = x.getBoundingClientRect();
                        return { l: Math.round(b.left), r: Math.round(b.right), w: Math.round(b.width) }; }),
    icons: [...row.querySelectorAll('.hw-links span')].map(x => x.textContent.trim()),
    text: [...row.querySelectorAll('.hw-links span')].map(x => x.getAttribute('title') || ''),
  };
}, lecture);

const four = await linkRow('18강');
ok('파일 넷을 낸 칸은 버튼도 넷', four.hrefs.length === 4, `${four.hrefs.length}개`);
ok('주소가 낱개로 갈라진다', four.hrefs.join('|') === FOUR.join('|'),
   four.hrefs.map(h => h.slice(-6)).join(' · '));
ok('주소에 쉼표가 남지 않는다', four.hrefs.every(h => !h.includes(',')),
   four.hrefs[0]);
ok('여러 개일 때는 번호를 붙인다', four.labels.join(',') === '🔗1,🔗2,🔗3,🔗4',
   four.labels.join(','));
ok('무엇을 여는 버튼인지 읽어 준다', four.titles[1] === '제출물 2 열기', four.titles.join(' / '));
ok('버튼이 겹치지 않는다 — 넷 다 따로 눌린다',
   four.boxes.every(b => b.w > 0) &&
   four.boxes.slice(1).every((b, i) => b.l >= four.boxes[i].r),
   four.boxes.map(b => `${b.l}~${b.r}`).join(' '));

const one = await linkRow('제17강');
ok('한 개짜리는 번호 없이 그대로', one.hrefs.length === 1 && one.labels[0] === '🔗',
   `${one.hrefs[0]} ${one.labels[0]}`);
ok('한 개짜리는 테를 두르지 않는다', !one.multi);

const plain = await linkRow('16강');
ok('주소가 없는 칸은 📄 로 남는다', plain.hrefs.length === 0 && plain.icons[0] === '📄',
   plain.icons.join(','));
ok('적어 낸 글은 툴팁으로 볼 수 있다', plain.text[0] === '손으로 적어 냈습니다', plain.text[0]);

const none = await linkRow('15강');
ok('빈 칸에는 아무것도 안 그린다', none.hrefs.length === 0 && none.icons.length === 0);

// 규칙 자체도 본다 — 화면은 이 함수 하나만 믿는다
const split = await page.evaluate(async () => {
  const m = await import('/scripts/members-data.js');
  const f = m.splitSubmissionLinks;
  return {
    space:   f('https://a.com/1 https://a.com/2').links.length,
    newline: f('https://a.com/1\nhttps://a.com/2').links.length,
    words:   f('1번 https://a.com/1, 2번 https://a.com/2').links,
    dot:     f('https://a.com/1.')?.links[0],
    dup:     f('https://a.com/1, https://a.com/1').links.length,
    empty:   f('').links.length + f(null).links.length,
    textOnly: f('링크 없이 적었습니다').text,
  };
});
ok('구분자가 공백이어도 갈라진다', split.space === 2, `${split.space}개`);
ok('구분자가 줄바꿈이어도 갈라진다', split.newline === 2, `${split.newline}개`);
ok('사이에 낀 말은 주소에 안 섞인다',
   split.words.join('|') === 'https://a.com/1|https://a.com/2', split.words.join(' · '));
ok('끝에 붙은 마침표는 뗀다', split.dot === 'https://a.com/1', split.dot);
ok('같은 주소를 두 번 낸 칸은 한 번만', split.dup === 1, `${split.dup}개`);
ok('빈 칸은 링크 없음', split.empty === 0);
ok('주소가 없으면 적은 글이 남는다', split.textOnly === '링크 없이 적었습니다', split.textOnly);

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

// ==========================================================================
// 3. 다 낸 사람 — 안내는 남기되 조용하게
//
// 다 냈다고 링크까지 없애면 다시 낼 일이 있을 때 찾을 곳이 없다.
// ==========================================================================
const ALL_DONE = mkSessions(7).map(s => ({
  member_id: 'u1', lecture: s.name, kind: '과제+소감문', content: '', submitted_at: null,
}));
const full = await openApp(mkSessions(7), ALL_DONE);
await lookup(full.page, '김조원', '1111');
const fullTodo = await full.page.evaluate(() => {
  const box = document.getElementById('myHomeworkTodo');
  return {
    cls: box.className,
    title: box.querySelector('.hw-todo-title')?.textContent.trim() || '',
    href: box.querySelector('.hw-todo-btn')?.getAttribute('href') || '',
    chips: box.querySelectorAll('.hw-todo-chip').length,
  };
});
ok('다 낸 사람에게는 안 낸 건수를 안 띄운다',
   fullTodo.cls.includes('done') && !/제출하지 않은/.test(fullTodo.title), fullTodo.title);
ok('그래도 제출 링크는 남는다',
   fullTodo.href === 'https://forms.gle/cnhxuonpz2tmMu2y9', fullTodo.href);
ok('밀린 강의 목록은 없다', fullTodo.chips === 0, `${fullTodo.chips}개`);
await full.page.locator('#myHomeworkSection').screenshot({ path: `${SHOT}/dg-hw-done.png` });
await full.context.close();

// ==========================================================================
// 3-2. **빈칸은 묻지 않는다**
//
// 빈칸은 셋 중 하나인데 앱은 구별할 수 없고, 셋 다 요구할 근거가 없다 —
// 합류 전 · 하차 기간 · 아직 저장 전. 20강에 들어온 사람에게 '안 낸 과제
// 19건' 이 뜨던 것이 실제 사고였다.
// ==========================================================================
const SEVEN = mkSessions(7);
const todoOf = (page) => page.evaluate(() => {
  const box = document.getElementById('myHomeworkTodo');
  return {
    cls: box.className,
    title: box.querySelector('.hw-todo-title')?.textContent.trim() || '',
    chips: [...box.querySelectorAll('.hw-todo-chip')].map(c => c.textContent.trim()),
  };
});

// 앞의 넷은 기록이 없고(아직 명단에 없었다) 5·6·7강만 찍혔다.
const LATE_ATT = SEVEN.slice(4).map(s => ({ session_date: s.session_date, status: 'O' }));
const late = await openApp(SEVEN, [], LATE_ATT);
await lookup(late.page, '김조원', '1111');
const lateTodo = await todoOf(late.page);
ok('합류 전 빈칸은 안 묻는다 (7회차인데 3건)',
   /3건/.test(lateTodo.title), lateTodo.title);
ok('묻는 것은 찍힌 회차뿐', lateTodo.chips.join(',') === '5강,6강,7강',
   lateTodo.chips.join(','));
await late.context.close();

// 기록이 하나도 없으면 요구할 것도 없다 (이번 주에 막 올라온 사람).
const blank = await openApp(SEVEN, [], []);
await lookup(blank.page, '김조원', '1111');
const blankTodo = await todoOf(blank.page);
ok('기록이 아예 없으면 0건', blankTodo.chips.length === 0 && !/제출하지 않은/.test(blankTodo.title),
   blankTodo.title);
await blank.context.close();

// **하차했다 돌아온 사람.** DG 는 재합류가 있다 — 7월에 하다가 8월에 하차하고
// 10월에 다시 오면 그 사이는 시트에서도 비어 있다. '첫 기록부터 센다' 로는
// 첫 기록이 7월이라 8~9월치가 딸려 나왔다. 빈칸을 안 묻는 규칙이 이것을 푼다.
const REJOIN_ATT = [
  { session_date: SEVEN[0].session_date, status: 'O' },   // 1강 — 처음 왔다
  { session_date: SEVEN[1].session_date, status: 'O' },   // 2강
  // 3·4·5강 = 하차 기간. 명단에 없어 아무도 안 찍는다 → 행 자체가 없다.
  { session_date: SEVEN[5].session_date, status: 'O' },   // 6강 — 다시 왔다
  { session_date: SEVEN[6].session_date, status: 'X' },   // 7강 — 결석
];
const rejoin = await openApp(SEVEN, [], REJOIN_ATT);
await lookup(rejoin.page, '김조원', '1111');
const rejoinTodo = await todoOf(rejoin.page);
ok('하차 기간은 안 묻는다', !rejoinTodo.chips.some(c => /^[345]강/.test(c)),
   rejoinTodo.chips.join(' | '));
ok('하차 앞뒤로 나온 회차는 묻는다',
   rejoinTodo.chips.join(',') === '1강,2강,6강,7강', rejoinTodo.chips.join(','));
await rejoin.context.close();

// −(수업 없음) · 돌봄 · ◎(지난 기수 이수) 는 사람이 시트에 일부러 넣은 예외
// 표기다. 예외라고 적어 둔 칸에 과제를 묻지 않는다.
const MARKED_ATT = [
  { session_date: SEVEN[0].session_date, status: '-' },
  { session_date: SEVEN[1].session_date, status: '−' },
  { session_date: SEVEN[2].session_date, status: '돌봄' },
  { session_date: SEVEN[3].session_date, status: '◎' },
  { session_date: SEVEN[4].session_date, status: 'O' },
];
const marked = await openApp(SEVEN, [], MARKED_ATT);
await lookup(marked.page, '김조원', '1111');
const markedTodo = await todoOf(marked.page);
ok('− · 돌봄 · ◎ 는 안 묻는다', markedTodo.chips.join(',') === '5강',
   markedTodo.chips.join(','));
await marked.context.close();

// ==========================================================================
// 3-3. 무엇을 요구하는가는 **그 주에 나왔는지**에 달렸다
//
// 소감문은 결석을 메우는 것이다(공지 규칙 5). 나온 주에까지 요구하면,
// 출석하고 예습과제까지 낸 사람에게 '안 냈다' 고 하게 된다 — 실제로 그랬다.
// ==========================================================================
// 나온 주에 예습과제('과제')만 냈다 → 다 한 것이다.
const PRESENT_ATT = SEVEN.map(s => ({ session_date: s.session_date, status: 'O' }));
const done2 = await openApp(SEVEN, SEVEN.map(s => ({
  member_id: 'u1', lecture: s.name, kind: '과제', content: '', submitted_at: null,
})), PRESENT_ATT);
await lookup(done2.page, '김조원', '1111');
const doneTodo2 = await todoOf(done2.page);
ok('나온 주에 예습과제만 내도 안내가 안 뜬다',
   doneTodo2.chips.length === 0 && !/제출하지 않은/.test(doneTodo2.title), doneTodo2.title);
await done2.context.close();

// 나온 주에 **아무것도** 안 냈으면 그때는 묻는다.
const noneSubmit = await openApp(SEVEN, [], PRESENT_ATT);
await lookup(noneSubmit.page, '김조원', '1111');
const noneTodo2 = await todoOf(noneSubmit.page);
ok('나온 주라도 아무것도 안 냈으면 묻는다', noneTodo2.chips.length === 7,
   `${noneTodo2.chips.length}개`);
await noneSubmit.context.close();

// 결석한 주는 '과제+소감문' 이라야 인정된다. 과제만 냈으면 남되 낸 것을 적는다.
const ABSENT_ATT = SEVEN.map((s, i) => ({
  session_date: s.session_date, status: i < 2 ? 'X' : 'O',
}));
const part = await openApp(SEVEN, [
  { member_id: 'u1', lecture: '1강', kind: '과제+소감문', content: '', submitted_at: null },
  { member_id: 'u1', lecture: '2강', kind: '과제', content: '', submitted_at: null },
  ...SEVEN.slice(2).map(s => ({
    member_id: 'u1', lecture: s.name, kind: '과제', content: '', submitted_at: null,
  })),
], ABSENT_ATT);
await lookup(part.page, '김조원', '1111');
const partTodo = await todoOf(part.page);
ok('결석한 주에 과제만 낸 것은 목록에 남는다', partTodo.chips.some(c => c.startsWith('2강')),
   partTodo.chips.join(' | '));
ok('무엇을 냈는지 칩에 적는다', partTodo.chips.some(c => c === '2강과제'),
   partTodo.chips.join(' | '));
ok('결석했어도 과제+소감문을 냈으면 빠진다', !partTodo.chips.some(c => c.startsWith('1강')),
   partTodo.chips.join(' | '));
ok('나온 주는 예습과제만으로 빠진다', partTodo.chips.length === 1,
   partTodo.chips.join(' | '));
await part.context.close();

// ==========================================================================
// 4. 회차를 못 받아 왔을 때 — '모두 냈어요' 는 거짓말이 된다
//
// 안 낸 것이 없는 게 아니라 모르는 것이다. 링크만 남기고 판단은 하지 않는다.
// ==========================================================================
const blind = await openApp([], []);
await blind.page.fill('#name', '김조원');
await blind.page.fill('#phone', '1111');
await blind.page.click('#searchBtn');
await blind.page.waitForTimeout(1500);
const blindTodo = await blind.page.evaluate(() => {
  const box = document.getElementById('myHomeworkTodo');
  return { title: box.querySelector('.hw-todo-title')?.textContent.trim() || '',
           href: box.querySelector('.hw-todo-btn')?.getAttribute('href') || '' };
});
ok('회차를 모르면 다 냈다고 하지 않는다', !/모두 냈/.test(blindTodo.title), blindTodo.title || '(비어 있음)');

await blind.context.close();

await browser.close();
server.close();

done();
