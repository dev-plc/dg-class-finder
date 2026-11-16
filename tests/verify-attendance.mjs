// 회차 선택 · 배치 저장 · 갱신 후 재렌더 검증.
// Supabase 와 GAS 는 가짜 응답으로 대신한다 (컨테이너에서 나갈 수 없다).
//
// v131 — 조장 화면은 출결을 **DB 에서 한 조 · 한 회차만** 읽는다. 예전에는 GAS 로
// 시트 전체를 읽어 11~102초가 걸렸고, 그동안 로딩 표시가 없어 조장이 체크한 것이
// 응답이 오면 말없이 사라졌다. 회차도 그 응답이 와야 정해져 '회차를 알 수 없어'
// 가 떴다. 여기서 그 셋과 '시트를 먼저 고친 칸'(seen · changed)을 본다.
//
// v135 — 조회 화면은 **표를 직접 읽지 않는다.** 이름+뒤 4자리를 서버 함수(dg_lookup)가 확인하고
// 본인 것(조장이면 자기 조의 전 회차)만 준다. 가짜 서버도 그렇게 답한다 (harness
// routePublicSupabase) — 잠긴 표를 읽으려 들면 거절하고 기록한다.

import { serveRepo, launch, makeReporter, attendanceRowsFrom, routePublicSupabase, SHOT } from './lib/harness.mjs';

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

const FX = { members: MEMBERS, sessions: SESSIONS, attendance: ATT_ROWS };

const posted = [];
// 가짜 GAS 저장 응답. 검증마다 갈아 끼운다.
let postReply = (body) => ({ success: true, saved: body.batch.length, missing: [] });
// 가짜 조회(dg_lookup) 응답 — 늦게 주기 · 실패시키기 · '시도가 너무 많다'
const lookupMode = { delayMs: 0, fail: false, limited: false };
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

const db = await routePublicSupabase(page, FX, {
  delayMs: () => lookupMode.delayMs,
  fail: () => lookupMode.fail,
  limited: () => lookupMode.limited,
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

// --- 화면을 열 때 받는 것이 없다 ---------------------------------------------
//
// 예전에는 전원의 명단을 받아야 조회 버튼이 열렸다 — 사이트를 여는 누구나 전 명단을 가졌다.
ok('화면을 열 때 조회도 표 읽기도 없다', db.lookups.length === 0 && db.privateReads.length === 0,
   JSON.stringify(db));
ok('조회 버튼이 바로 열린다',
   await page.$eval('#searchBtn', el => !el.disabled && /조 확인하기/.test(el.textContent)));

// --- 조장으로 조회 — 서버가 늦게 와도 '확인 중' 이라고 말한다 --------------------
lookupMode.delayMs = 1500;
await page.fill('#name', '김조장');
await page.fill('#phone', '1111');
await page.click('#searchBtn');
await page.waitForTimeout(400);
const waiting = await page.evaluate(() => ({
  btn: document.getElementById('searchBtn').textContent.trim(),
  disabled: document.getElementById('searchBtn').disabled,
  shown: getComputedStyle(document.getElementById('resultContainer')).display !== 'none',
}));
ok("기다리는 동안 버튼이 '확인 중…' 으로 막혀 있다", waiting.disabled && /확인 중/.test(waiting.btn), JSON.stringify(waiting));
ok('받기 전에는 결과를 그리지 않는다 (빈 명단에 체크하는 일이 없다)', !waiting.shown);

await page.waitForSelector('#teamMemberList .team-member-item', { timeout: 10000 });
ok('조장 조회 → 조원 명단 표시', true);
const ready = await page.evaluate(() => ({
  disabled: [...document.querySelectorAll('.attendance-check')].some(cb => cb.disabled),
  picker: document.getElementById('sessionPicker').value,
  btn: document.getElementById('searchBtn').textContent.trim(),
}));
ok('명단이 뜨면 바로 체크할 수 있다 (조 전 회차가 조회 답에 들어 있다)', !ready.disabled, JSON.stringify(ready));
ok('회차가 정해져 있다 (11/09)', ready.picker === '2025-11-09', ready.picker);
ok('버튼이 원래대로', /조 확인하기/.test(ready.btn), ready.btn);
ok('서버에 이름 · 번호를 한 번 보냈다',
   db.lookups.length === 1 && db.lookups[0].name === '김조장' && db.lookups[0].phone === '1111',
   JSON.stringify(db.lookups));
lookupMode.delayMs = 0;
await page.locator('#teamMemberListContainer').screenshot({ path: `${SHOT}/attendance-mobile-loading.png` });

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

// --- 이름은 정확히 · 실패는 갈라 말한다 --------------------------------------
//
// 이름 일부 · 초성을 받으면 뒤 4자리를 차례로 넣어 보는 것만으로 명단을 긁어 갈 수 있다.
const errorAfter = async (name, phone) => {
  await page.fill('#name', name);
  await page.fill('#phone', phone);
  await page.click('#searchBtn');
  await page.waitForFunction(() => !document.getElementById('searchBtn').disabled, null, { timeout: 10000 });
  return page.evaluate(() => ({
    error: getComputedStyle(document.getElementById('errorMessage')).display !== 'none'
      ? document.getElementById('errorText').textContent.trim() : '',
    shown: getComputedStyle(document.getElementById('resultContainer')).display !== 'none',
  }));
};
const partial = await errorAfter('김조', '1111');
ok('이름 일부로는 못 찾는다', /찾을 수 없습니다/.test(partial.error) && !partial.shown, JSON.stringify(partial));
const initials = await errorAfter('ㄱㅈㅈ', '1111');
ok('초성으로는 못 찾는다', /찾을 수 없습니다/.test(initials.error), JSON.stringify(initials));

lookupMode.limited = true;
const limited = await errorAfter('김조장', '1111');
ok("시도가 너무 많으면 '잠시 후' 라고 말한다 (못 찾았다고 하지 않는다)",
   /잠시 후 다시/.test(limited.error) && !/찾을 수 없습니다/.test(limited.error), JSON.stringify(limited));
lookupMode.limited = false;
lookupMode.fail = true;
const down = await errorAfter('김조장', '1111');
ok("연결이 안 되면 그렇게 말한다 (오타로 알고 헛되이 다시 치지 않게)",
   /연결하지 못했습니다/.test(down.error), JSON.stringify(down));
lookupMode.fail = false;

// 뒤 검증이 쓸 수 있게 원래대로 다시 조회해 둔다
await page.fill('#name', '김조장');
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

// --- 다른 회차 — 조회 답에 전 회차가 있어 바로 그린다 ----------------------------
await page.selectOption('#sessionPicker', '2025-11-02');
await page.waitForTimeout(300);

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
// 누가 저장하는지 — 조회한 그 사람. GAS(v35)가 조장인지 · 자기 조인지 확인한다.
ok('저장하는 사람(조회한 조장)을 함께 보낸다',
   body?.by?.name === '김조장' && body?.by?.phone === '1111', JSON.stringify(body?.by));
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
// 회차를 바꾸면 받아 둔 값으로 바로 그리고, 뒤에서 서버에 다시 물어 맞춘다.
lookupMode.delayMs = 1500;
const lookupsBefore = db.lookups.length;
await page.selectOption('#sessionPicker', '2025-11-09');
ok('회차를 바꾸면 기다리지 않고 바로 그린다',
   await page.$eval('.attendance-check[data-name="김조장"]', el => !el.disabled && el.checked));
lookupMode.delayMs = 0;
await page.waitForTimeout(1800);
ok('그리고 뒤에서 새로 받아 맞춘다', db.lookups.length === lookupsBefore + 1,
   `${lookupsBefore} → ${db.lookups.length}`);

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

// --- 조회 화면은 명단 표를 한 번도 읽지 않았다 ----------------------------------
//
// 조회 · 조장 명단 · 회차 바꾸기 · 저장 · 배경 갱신 · 전체 출석표까지 다 지나왔다.
// 잠긴 표(명단 · 출결 · 김밥 · 과제 · 안내방)를 읽으려 든 적이 있으면 실패다.
ok('조회 화면은 잠긴 표를 한 번도 읽지 않는다', db.privateReads.length === 0, db.privateReads.join(' | '));
// 명단을 브라우저에 남기지 않는다 — 그 브라우저의 다음 사람이 그대로 읽는다.
const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }));
ok('브라우저 저장소에 명단이 없다 (조원 이름이 하나도 없다)',
   !/이조원|박과제|새로온이/.test(stored) && !/dg_members_v1/.test(stored), stored.slice(0, 200));

await browser.close();
server.close();

done();
