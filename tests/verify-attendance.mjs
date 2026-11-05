// 회차 선택 · 배치 저장 · 갱신 후 재렌더 검증.
// Supabase 와 GAS 는 가짜 응답으로 대신한다 (컨테이너에서 나갈 수 없다).
//
// v131 — 조장 화면은 출결을 **DB 에서 한 조 · 한 회차만** 읽는다. 예전에는 GAS 로
// 시트 전체를 읽어 11~102초가 걸렸고, 그동안 로딩 표시가 없어 조장이 체크한 것이
// 응답이 오면 말없이 사라졌다. 회차도 그 응답이 와야 정해져 '회차를 알 수 없어'
// 가 떴다. 여기서 그 셋과 '시트를 먼저 고친 칸'(seen · changed)을 본다.

import { serveRepo, launch, makeReporter, filterAttendance, attendanceRowsFrom, SHOT } from './lib/harness.mjs';

const PORT = 8091;
const server = await serveRepo(PORT);

// --------------------------------------------------------------------------
// 가짜 데이터
// --------------------------------------------------------------------------
const COHORT = 'DG-2026';
const MEMBERS = [
  { id: 'u1', cohort_id: COHORT, name: '김조장', phone: '1111', team: 'Y1', team_no: 1,
    location: '웨슬리홀', role: '조장', lunch: 'O', status: 'active' },
  { id: 'u2', cohort_id: COHORT, name: '이조원', phone: '2222', team: 'Y1', team_no: 2,
    location: '웨슬리홀', role: '조원', lunch: 'X', status: 'active' },
  // 시트에 붙은 GAS 가 과제+소감문을 낸 결석 칸을 '과제' 로 바꿔 둔다.
  { id: 'u3', cohort_id: COHORT, name: '박과제', phone: '3333', team: 'Y1', team_no: 3,
    location: '웨슬리홀', role: '조원', lunch: 'X', status: 'active' },
  // 이번 주에 명단에 갓 올라온 사람 — 어느 회차에도 기록이 없다.
  { id: 'u4', cohort_id: COHORT, name: '새로온이', phone: '4444', team: 'Y1', team_no: 4,
    location: '웨슬리홀', role: '조원', lunch: 'X', status: 'active' },
];
const SESSIONS = [
  { session_date: '2025-11-02', label: '11/02', name: '1강' },
  { session_date: '2025-11-09', label: '11/09', name: '2강' },
  // 아직 안 온 회차 — 선택칸에 나오면 안 된다 (오늘 11/10)
  { session_date: '2025-11-16', label: '11/16', name: '3강' },
];
// 11/02 는 둘 다 출석, 11/09 는 조장만 출석 — 회차를 바꾸면 체크가 달라져야 한다
const ATT_BY_DATE = {
  '김조장1111': { '2025-11-02': 'O', '2025-11-09': 'O' },
  '이조원2222': { '2025-11-02': 'O', '2025-11-09': '돌봄' },
  '박과제3333': { '2025-11-02': 'O', '2025-11-09': '과제' },
  // '새로온이' 는 일부러 없다 — 어느 회차에도 기록이 없는 상태.
};

const ATT_ROWS = attendanceRowsFrom(MEMBERS, ATT_BY_DATE);

const posted = [];
// 가짜 GAS 저장 응답. 검증마다 갈아 끼운다.
let postReply = (body) => ({ success: true, saved: body.batch.length, missing: [] });
// 가짜 DB 출결 응답 — 늦게 주기 · 실패시키기
const attMode = { delayMs: 0, fail: false };
const attQueries = [];
let gasGets = 0;

const { ok, done } = makeReporter('회차·출결 저장');

const browser = await launch();
// 폰 폭 — 제보가 폰에서 왔다. 마지막에 화면을 찍어 남긴다.
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
const page = await context.newPage();
// 오늘은 기기 날짜다 (v131 — GAS 의 today 를 더는 받지 않는다).
await page.clock.setFixedTime(new Date('2025-11-10T09:00:00Z'));
// '지난 회차' 확인을 검증하려면 수락/취소를 골라야 한다.
let dialogAction = 'accept';
const dialogs = [];
page.on('dialog', d => {
  dialogs.push(d.message());
  console.log('   [dialog] ' + d.message());
  (dialogAction === 'accept' ? d.accept() : d.dismiss()).catch(() => {});
});
page.on('console', m => { if (m.type() === 'error') console.log('   [console.error] ' + m.text()); });

await page.route('**/rest/v1/**', async route => {
  const url = new URL(route.request().url());
  const table = url.pathname.split('/').pop();
  let body = [];
  if (table === 'dg_members') {
    body = url.searchParams.get('select') === 'cohort_id'
      ? [{ cohort_id: COHORT }]
      : MEMBERS;
  } else if (table === 'dg_sessions') {
    body = SESSIONS;
  } else if (table === 'dg_attendance') {
    // '오늘 출결'(dg_members!inner) 은 화면 로드 때, 본인 이력(member_id=eq.) 은 내 출석
    // 현황이 묻는 것 — 조원 명단 조회와 따로 센다.
    if (!url.search.includes('inner') && !url.search.includes('member_id=eq.')) {
      attQueries.push(url.search);
      if (attMode.delayMs) await new Promise(r => setTimeout(r, attMode.delayMs));
      if (attMode.fail) {
        return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
          .catch(() => {});
      }
    }
    body = filterAttendance(url, ATT_ROWS);
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
    .catch(() => {});
});

await page.route('**/script.google.com/**', route => {
  const req = route.request();
  if (req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}');
    posted.push(body);
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify(postReply(body)) });
  }
  // 출결 읽기는 DB 다. 시트 전체를 읽는 길(11~102초)로 가면 실패로 센다.
  gasGets++;
  route.fulfill({ status: 500, contentType: 'application/json', body: '{"success":false}' });
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('searchBtn').disabled, null, { timeout: 20000 });

// --- 조장으로 조회 — DB 가 늦게 와도 '불러오는 중' 이라고 말한다 ------------
//
// 예전에는 응답을 기다리는 동안 아무 표시가 없어서 조장이 빈 명단에 체크했고,
// 응답이 오면 명단을 다시 그리면서 그 체크가 사라졌다. 요약 카드는 '오늘'
// (수업 없는 날)을 세어 0 · 0 · 그 외 7 이었다.
attMode.delayMs = 1500;
attQueries.length = 0;
await page.fill('#name', '김조장');
await page.fill('#phone', '1111');
await page.click('#searchBtn');

await page.waitForSelector('#teamMemberList .team-member-item', { timeout: 10000 });
ok('조장 조회 → 조원 명단 표시', true);

const loadingState = await page.evaluate(() => ({
  disabled: [...document.querySelectorAll('.attendance-check')].map(cb => cb.disabled),
  checked: [...document.querySelectorAll('.attendance-check')].some(cb => cb.checked),
  dim: document.getElementById('teamMemberList').classList.contains('loading'),
  btn: document.getElementById('saveAttendanceBtn').textContent.trim(),
  btnDisabled: document.getElementById('saveAttendanceBtn').disabled,
  summary: document.getElementById('teamSummaryCard').textContent.replace(/\s+/g, ' ').trim(),
  picker: document.getElementById('sessionPicker').value,
}));
await page.locator('#teamMemberListContainer').screenshot({ path: `${SHOT}/attendance-mobile-loading.png` });
ok('받는 동안 체크박스는 전부 비활성',
   loadingState.disabled.length === 4 && loadingState.disabled.every(Boolean), JSON.stringify(loadingState.disabled));
ok('받는 동안 옛 값을 그리지 않는다 (체크 없음)', !loadingState.checked);
ok('받는 동안 명단을 흐리게', loadingState.dim);
ok("저장 버튼이 '불러오는 중…' 으로 막혀 있다",
   loadingState.btnDisabled && /불러오는 중/.test(loadingState.btn), loadingState.btn);
ok("요약 카드가 '11/09 출석 불러오는 중' 이라고 말한다",
   /11\/09 출석 불러오는 중/.test(loadingState.summary), loadingState.summary);
// 회차는 응답을 기다리지 않고 정해진다 — 화면에 보이는 회차가 곧 앱이 쥔 회차다.
ok('받는 동안에도 회차가 정해져 있다 (11/09)', loadingState.picker === '2025-11-09', loadingState.picker);

await page.waitForFunction(() => !document.querySelector('.attendance-check')?.disabled, null, { timeout: 10000 });
ok('응답이 오면 체크할 수 있다', true);
// 한 조 · 한 회차만 묻는다 — 시트 전체(261명 × 39회차)가 아니라.
ok('한 조 · 한 회차만 DB 에 묻는다',
   attQueries.length >= 1 && attQueries.every(q => q.includes('session_date=eq.2025-11-09')
                                               && q.includes('member_id=in.')),
   attQueries.join(' | '));
attMode.delayMs = 0;

// 폰 자판에서 전각 숫자가 들어오는 일이 있다 ('１１１１').
// 그대로 두면 숫자가 아니라고 지워져 '번호를 안 넣었다' 는 오류가 난다.
await page.click('#closeBtn');
await page.fill('#name', '김조장');
await page.fill('#phone', '１１１１');
await page.click('#searchBtn');
await page.waitForTimeout(600);
ok('전각 숫자로 쳐도 찾는다',
   await page.evaluate(() => getComputedStyle(document.getElementById('resultContainer')).display !== 'none'),
   await page.$eval('#errorText', el => el.textContent.trim()).catch(() => ''));

// 뒤 검증이 쓸 수 있게 원래대로 다시 조회해 둔다
await page.fill('#phone', '1111');
await page.click('#searchBtn');
await page.waitForSelector('#teamMemberList .team-member-item', { timeout: 10000 });

// --- 회차 드롭다운 --------------------------------------------------------
const pickerOk = await page.waitForSelector('#sessionPicker', { timeout: 10000 })
  .then(() => true).catch(() => false);
ok('회차 드롭다운 표시', pickerOk);
// 선택칸이 보여주는 회차에 selected 가 붙어 있다. 안 붙이면 브라우저가 첫 항목을 보여줘
// '보이는 회차 ≠ 저장될 회차' 가 된다.
ok('선택칸의 회차에 selected 가 붙는다',
   await page.$eval('#sessionPicker', el => el.selectedOptions[0]?.hasAttribute('selected') === true));

const opts = await page.$$eval('#sessionPicker option', els => els.map(e => e.value));
ok('회차 목록에 미래 회차 없음', opts.length === 2 && opts.every(v => v <= '2025-11-10'),
   opts.join(', '));

const selected = await page.$eval('#sessionPicker', el => el.value);
ok('기본값 = 가장 최근 지난 회차', selected === '2025-11-09', selected);

// --- 회차별로 체크가 달라지는가 -------------------------------------------
const checkedOn = async () => page.$$eval('.attendance-check', els => els.map(e => e.checked));

const at1109 = await checkedOn();
// 체크박스는 조장(O)과 새로온이(빈칸)뿐 — 돌봄·과제는 배지다.
ok('11/09 — 조장은 체크, 신규는 빈 체크박스',
   JSON.stringify(at1109) === '[true,false]', JSON.stringify(at1109));

const badges = await page.$$eval('.attendance-badge', els => els.map(e => e.textContent.trim()));
// 체크박스로 두면 '체크 안 됨' 으로 보여서 조장이 무심코 눌러 시트 기록을 덮는다.
// '과제' 도 앱이 만든 값이 아니므로 같은 규칙이다 (GAS 도 kept 로 거부한다).
ok('돌봄 · 과제는 체크박스 대신 배지로',
   JSON.stringify([...badges].sort()) === '["과제","돌봄"]', JSON.stringify(badges));

// '과제' 는 출석으로 센다 (docs/RULES.md). 조 요약이 그 규칙을 따라야 한다 —
// 여기만 'O' 를 직접 세면 화면마다 숫자가 어긋난다.
const summary1109 = await page.$eval('#teamSummaryCard', el => el.textContent.replace(/\s+/g, ' '));
ok("'과제' 를 출석으로 센다 (출석 2 · 결석 0)",
   /2 ✅ 출석/.test(summary1109) && /0 ❌ 결석/.test(summary1109), summary1109.trim());
// 카드는 **저장된 값**이다 — 아래 저장 줄(지금 체크한 값)과 다를 수 있다는 것을 글로 보인다.
ok("요약 카드 맨 위에 '11/09 저장된 출석'", /11\/09 저장된 출석/.test(summary1109), summary1109.trim());
// 빈칸은 '미입력' 으로 따로 — '그 외' 에는 시트 표기(돌봄)만 남는다.
ok('빈칸은 미입력으로 따로 센다 (미입력 1 · 그 외 1)',
   /1 ⬜ 미입력/.test(summary1109) && /1 📌 그 외/.test(summary1109), summary1109.trim());
const statCount = await page.$$eval('#teamSummaryCard .stat', els => els.length);
ok('요약 칸은 여섯 개로 고정 (3칸 격자에 둘째 줄 하나만 남지 않게)', statCount === 6, `${statCount}칸`);

// --- 처음 보는 회차를 못 받으면 — 다시 시도, 저장은 막는다 ------------------
//
// 빈 명단을 그대로 저장하면 전원이 X 로 나간다. 못 받았으면 저장할 길이 없어야 한다.
attMode.fail = true;
await page.selectOption('#sessionPicker', '2025-11-02');
await page.waitForSelector('#teamSummaryCard [data-team-att-retry]', { timeout: 10000 });
const failState = await page.evaluate(() => ({
  summary: document.getElementById('teamSummaryCard').textContent.replace(/\s+/g, ' ').trim(),
  btn: document.getElementById('saveAttendanceBtn').textContent.trim(),
  btnDisabled: document.getElementById('saveAttendanceBtn').disabled,
  allDisabled: [...document.querySelectorAll('.attendance-check')].every(cb => cb.disabled),
}));
ok('못 받으면 그렇다고 말하고 다시 시도 버튼', /불러오지 못했습니다/.test(failState.summary), failState.summary);
ok('못 받으면 저장은 막힌다', failState.btnDisabled && failState.allDisabled, JSON.stringify(failState));

attMode.fail = false;
await page.click('#teamSummaryCard [data-team-att-retry]');
await page.waitForFunction(() => !document.querySelector('.attendance-check')?.disabled, null, { timeout: 10000 });
ok('다시 시도해서 받으면 정상으로', true);

const at1102 = await checkedOn();
// 기록이 있는 셋은 체크, 기록이 없는 새로온이는 빈 채로.
//
// ⚠️ 차례는 **시트 순서**다 (team_no 1~4: 김조장·이조원·박과제·새로온이).
// 예전에는 역할 다음 이름순이라 [김조장·박과제·새로온이·이조원] 이었다 —
// 종이 출석부와 차례가 달라서 옆줄에 체크할 위험이 있었다 (compareLeadFirst).
ok('11/02 로 바꾸면 기록 있는 셋만 체크',
   JSON.stringify(at1102) === '[true,true,true,false]', JSON.stringify(at1102));
const badges2 = await page.$$eval('.attendance-badge', els => els.length);
ok('11/02 에는 배지 없음', badges2 === 0, `배지 ${badges2}개`);

// --- 일괄 저장: 체크만으로는 보내지 않는다 --------------------------------
posted.length = 0;
await page.uncheck('.attendance-check[data-name="이조원"]');
await page.waitForTimeout(800);
ok('체크만으로는 저장하지 않음', posted.length === 0, `요청 ${posted.length}건`);

// 버튼은 '실제로 쓸 인원' 을 보여준다 (명단 전체를 O/X 로 쓴다).
// 변경 건수는 그 옆 정보 줄이 말한다.
const btnText = await page.$eval('#saveAttendanceBtn', el => el.textContent.trim());
ok('저장 버튼이 쓸 인원을 보여줌', btnText.includes('4명'), btnText);
// 문구도 묶어 둔다 — 같은 화면의 과제 버튼이 '제출하기 →' 라 말결을 맞춘다.
// (N명)은 문구가 아니라 **실제로 쓰는 인원**이라 위 단언이 따로 지킨다.
ok("버튼 문구는 '저장하기'", /저장하기/.test(btnText), btnText);
const infoText = await page.$eval('#attendanceSaveInfo', el => el.textContent.trim());
ok('정보 줄이 변경 건수와 출결 수를 보여줌',
   /변경 1건/.test(infoText) && /출석 2/.test(infoText) && /결석 2/.test(infoText), infoText);

// --- 배경 갱신이 명단을 다시 그려도 체크는 남는다 -----------------------------
//
// 예전에는 응답이 늦게 오거나 배경 갱신이 끝나면 명단을 다시 그리면서 저장하지
// 않은 체크가 말없이 사라졌다.
const ASSET_V = await page.evaluate(() =>
  document.querySelector('script[src*="script.js"]').src.match(/v=(\d+)/)[1]);
await page.evaluate(async (v) => {
  const mod = await import(`./scripts/members-data.js?v=${v}`);
  await mod.refresh();
}, ASSET_V);
await page.waitForTimeout(800);
const afterRefresh = await page.evaluate(() => ({
  lee: document.querySelector('.attendance-check[data-name="이조원"]')?.checked,
  info: document.getElementById('attendanceSaveInfo').textContent.trim(),
}));
ok('배경 갱신 뒤에도 푼 체크가 그대로', afterRefresh.lee === false, JSON.stringify(afterRefresh));
ok('변경 건수도 그대로 (변경 1건)', /변경 1건/.test(afterRefresh.info), afterRefresh.info);

// --- 지난 회차는 한 번 묻는다 ---------------------------------------------
//
// 명단은 늘 오늘의 것이다. 그것으로 지난 회차를 채우면 그때 명단에 없던
// 사람에게까지 X 가 나간다 — 이번에 처음 합류한 사람이 지난 회차 결석으로
// 찍힌 것이 이 경로였다. 막지는 않고 묻는다.
dialogs.length = 0;
dialogAction = 'dismiss';
await page.click('#saveAttendanceBtn');
await page.waitForTimeout(600);
ok('지난 회차를 저장할 땐 확인을 묻는다',
   dialogs.some(m => /지난 회차/.test(m)), JSON.stringify(dialogs));
ok('취소하면 아무것도 안 보낸다', posted.length === 0, `요청 ${posted.length}건`);

dialogAction = 'accept';
await page.click('#saveAttendanceBtn');
await page.waitForTimeout(1200);

const body = posted[0];
ok('저장 요청에 session 포함', !!body && body.session === '2025-11-02',
   body ? JSON.stringify(body) : '(요청 없음)');
// 회차 선택칸에 보이는 회차 = 저장한 회차.
ok('선택칸의 회차로 저장한다', body?.session === await page.$eval('#sessionPicker', el => el.value));
ok("'회차를 알 수 없어' 가 뜨지 않는다", !dialogs.some(m => /회차를 알 수 없어/.test(m)), JSON.stringify(dialogs));
// seen = 화면에 띄웠던 값. GAS(v32)가 시트의 지금 칸과 견준다 — 빈칸과 X 를 갈라야 한다.
const seenOf = Object.fromEntries((body?.batch || []).map(b => [b.name, b.seen]));
ok('사람마다 화면에 띄웠던 값(seen)을 함께 보낸다',
   seenOf['김조장'] === 'O' && seenOf['이조원'] === 'O' && seenOf['새로온이'] === '',
   JSON.stringify(seenOf));
// 명단 전체를 O/X 로 보낸다. 예전에는 바뀐 사람만 보내서, 체크 안 한 사람이
// 빈칸(기록 없음)으로 남았다 — 출석도 결석도 아닌 칸이 되어 수료를 따질 때
// 한 명씩 되짚어야 했다.
const st = Object.fromEntries((body?.batch || []).map(b => [b.name, b.status]));
ok('명단 전체를 보낸다 (4명)', !!body && body.batch.length === 4,
   body ? JSON.stringify(body.batch) : '(요청 없음)');
// 기록이 하나도 없는 사람도 결석으로 나간다. 명단에 있으면 결석자 명단에 떠야
// 교역자가 원인을 확인하고 조치할 수 있다 — 안 찍으면 아예 안 보인다.
// (그때 명단에 없었을 위험은 위 '지난 회차 확인' 이 맡는다.)
ok('기록이 없는 사람도 X 로 보낸다', st['새로온이'] === 'X', JSON.stringify(st));
ok('체크를 푼 사람은 X', st['이조원'] === 'X', JSON.stringify(st));
ok('체크한 사람은 O 그대로', st['김조장'] === 'O', JSON.stringify(st));

const doneText = await page.$eval('#saveAttendanceBtn', el => el.textContent.trim());
ok('저장 직후 완료 표시', doneText === '✅ 저장됨', doneText);

await page.waitForTimeout(2600);
const afterText = await page.$eval('#saveAttendanceBtn', el => el.textContent.trim());
ok('잠시 뒤 변경 없음 상태로', afterText === '변경 사항 없음', afterText);
// 저장한 줄은 seen 도 새 값으로 — 다시 저장할 때 자기가 방금 쓴 값에 걸리지 않게.
ok('저장한 줄의 seen 이 새 값으로 바뀐다',
   await page.$eval('.attendance-check[data-name="이조원"]', el => el.dataset.status) === 'X');

// --- 시트를 먼저 고친 칸 — GAS 가 덮지 않고 돌려주면 시트 값으로 다시 그린다 ----
//
// DB 는 시트보다 최대 10분 뒤처진다. 그 사이 시트에 손으로 넣은 O 를 화면은 빈칸으로
// 보여주고, 그대로 저장하면 X 가 나가 시트의 O 가 덮였다.
// 이미 받아 둔 회차로 돌아가는 것은 기다리지 않는다.
attQueries.length = 0;
attMode.delayMs = 1500;
await page.selectOption('#sessionPicker', '2025-11-09');
ok('이미 받은 회차로 돌아가면 바로 그린다',
   await page.$eval('.attendance-check[data-name="김조장"]', el => !el.disabled && el.checked));
attMode.delayMs = 0;
await page.waitForTimeout(1800);

postReply = (b) => ({ success: true, saved: 1, missing: [], kept: [], dbPushed: false,
                      changed: [{ id: '새로온이4444', current: 'O' }] });
posted.length = 0;
dialogs.length = 0;
await page.uncheck('.attendance-check[data-name="김조장"]');
await page.click('#saveAttendanceBtn');
await page.waitForTimeout(1200);
const sentNew = posted[0]?.batch.find(b => b.name === '새로온이');
ok('빈칸으로 본 사람은 seen 빈칸 · X 로 나간다', sentNew?.seen === '' && sentNew?.status === 'X',
   JSON.stringify(sentNew));
const newRow = await page.$eval('.attendance-check[data-name="새로온이"]',
  el => ({ checked: el.checked, initial: el.dataset.initial, status: el.dataset.status }));
ok('시트가 먼저 바꾼 줄은 시트 값(O)으로 다시 그린다',
   newRow.checked && newRow.initial === '1' && newRow.status === 'O', JSON.stringify(newRow));
ok('그렇게 했다고 알린다',
   dialogs.some(m => /시트에서 먼저 바뀐 1명/.test(m) && /새로온이\(O\)/.test(m)), JSON.stringify(dialogs));
const sum2 = await page.$eval('#teamSummaryCard', el => el.textContent.replace(/\s+/g, ' '));
ok('요약 카드도 시트 값으로 (출석 2 · 결석 1 · 미입력 0)',
   /2 ✅ 출석/.test(sum2) && /1 ❌ 결석/.test(sum2) && /0 ⬜ 미입력/.test(sum2), sum2.trim());
ok('DB 반영이 늦으면 저장 줄이 그렇게 말한다',
   /앱 반영은 10분 안에/.test(await page.$eval('#attendanceSaveInfo', el => el.textContent)));

await page.locator('#teamMemberListContainer').screenshot({ path: `${SHOT}/attendance-mobile-ready.png` });
ok('조회할 때 GAS(시트 전체) 를 한 번도 읽지 않는다', gasGets === 0, `${gasGets}회`);

// --- 전체 출석표 ----------------------------------------------------------
await page.click('#openMatrixBtn');
await page.waitForSelector('#matrixModal.active .matrix-table', { timeout: 10000 });

const cols = await page.$$eval('.matrix-table thead th', els => els.length);
ok('출석표 헤더 = 이름칸 + 회차수 (지난 2 + 예정 1)', cols === 1 + 3, `${cols}칸`);

const rows = await page.$$eval('.matrix-table tbody tr', els => els.length);
ok('출석표 행 = 조원수', rows === 4, `${rows}행`);

// 줄 차례는 명단 정렬에 따라 흔들린다. 이름으로 찾는다.
const rowCells = (name) => page.evaluate((n) => {
  // .mx-name 안에는 이름과 전화 뒷 4자리(.mx-phone)가 함께 있다 — 이름만 견준다.
  const justName = (r) => {
    const el = r.querySelector('.mx-name');
    if (!el) return '';
    const c = el.cloneNode(true);
    c.querySelector('.mx-phone')?.remove();
    return c.textContent.trim();
  };
  const tr = [...document.querySelectorAll('.matrix-table tbody tr')]
    .find(r => justName(r) === n);
  return [...(tr?.querySelectorAll('td') || [])].map(e => ({
    st: e.querySelector('.mx-status')?.textContent.trim() || '',
    cls: e.className,
  }));
}, name);

const cells = (await rowCells('이조원')).map(c => c.st);
ok('돌봄이 출석표에 그대로 보임', cells.includes('돌봄'), cells.join(','));

const hwCells = await rowCells('박과제');
const 과제칸 = hwCells.find(c => c.st === '과제');
ok("'과제' 는 노란 칸으로 보인다", !!과제칸 && /\bmakeup\b/.test(과제칸.cls),
   JSON.stringify(hwCells));

await page.click('#matrixCloseBtn');
await page.waitForTimeout(300);
const closed = await page.$eval('#matrixModal', el => !el.classList.contains('active'));
ok('출석표 닫힘', closed);

await browser.close();
server.close();

done();
