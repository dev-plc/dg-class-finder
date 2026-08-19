// 회차 선택 · 배치 저장 · 갱신 후 재렌더 검증.
// Supabase 와 GAS 는 가짜 응답으로 대신한다 (컨테이너에서 나갈 수 없다).

import { serveRepo, launch, makeReporter } from './lib/harness.mjs?v=92';

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
];
const SESSIONS = [
  { key: '11/02', date: '2025-11-02' },
  { key: '11/09', date: '2025-11-09' },
];
// 11/02 는 둘 다 출석, 11/09 는 조장만 출석 — 회차를 바꾸면 체크가 달라져야 한다
const ATT_BY_DATE = {
  '김조장1111': { '2025-11-02': 'O', '2025-11-09': 'O' },
  '이조원2222': { '2025-11-02': 'O', '2025-11-09': '돌봄' },
};

const posted = [];

const { ok, done } = makeReporter('회차·출결 저장');

const browser = await launch();
const context = await browser.newContext();
const page = await context.newPage();
page.on('dialog', d => { console.log('   [dialog] ' + d.message()); d.dismiss().catch(() => {}); });
page.on('console', m => { if (m.type() === 'error') console.log('   [console.error] ' + m.text()); });

await page.route('**/rest/v1/**', route => {
  const url = new URL(route.request().url());
  const table = url.pathname.split('/').pop();
  let body = [];
  if (table === 'dg_members') {
    body = url.searchParams.get('select') === 'cohort_id'
      ? [{ cohort_id: COHORT }]
      : MEMBERS;
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await page.route('**/script.google.com/**', route => {
  const req = route.request();
  if (req.method() === 'POST') {
    posted.push(JSON.parse(req.postData() || '{}'));
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, saved: 1, missing: [] }) });
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
    success: true, version: 19,
    today: '2025-11-10',
    currentSession: '2025-11-09',
    sessions: SESSIONS,
    data: MEMBERS.map(m => ({
      id: `${m.name}${m.phone}`, name: m.name, phone: m.phone, team: m.team,
      attendanceByDate: ATT_BY_DATE[`${m.name}${m.phone}`] || {},
    })),
    locationMap: {}, teamLinkMap: {}, cohortHint: COHORT,
  }) });
});

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('searchBtn').disabled, null, { timeout: 20000 });

// --- 조장으로 조회 --------------------------------------------------------
await page.fill('#name', '김조장');
await page.fill('#phone', '1111');
await page.click('#searchBtn');

await page.waitForSelector('#teamMemberList .team-member-item', { timeout: 10000 });
ok('조장 조회 → 조원 명단 표시', true);

// --- 회차 드롭다운 --------------------------------------------------------
const pickerOk = await page.waitForSelector('#sessionPicker', { timeout: 10000 })
  .then(() => true).catch(() => false);
ok('회차 드롭다운 표시', pickerOk);

const opts = await page.$$eval('#sessionPicker option', els => els.map(e => e.value));
ok('회차 목록에 미래 회차 없음', opts.length === 2 && opts.every(v => v <= '2025-11-10'),
   opts.join(', '));

const selected = await page.$eval('#sessionPicker', el => el.value);
ok('기본값 = 가장 최근 지난 회차', selected === '2025-11-09', selected);

// --- 회차별로 체크가 달라지는가 -------------------------------------------
const checkedOn = async () => page.$$eval('.attendance-check', els => els.map(e => e.checked));

const at1109 = await checkedOn();
ok('11/09 — 조장만 체크박스, 체크됨', JSON.stringify(at1109) === '[true]', JSON.stringify(at1109));

const badges = await page.$$eval('.attendance-badge', els => els.map(e => e.textContent.trim()));
ok('돌봄은 체크박스 대신 배지로', JSON.stringify(badges) === '["돌봄"]', JSON.stringify(badges));

await page.selectOption('#sessionPicker', '2025-11-02');
await page.waitForTimeout(300);
const at1102 = await checkedOn();
ok('11/02 로 바꾸면 둘 다 체크', JSON.stringify(at1102) === '[true,true]', JSON.stringify(at1102));
const badges2 = await page.$$eval('.attendance-badge', els => els.length);
ok('11/02 에는 배지 없음', badges2 === 0, `배지 ${badges2}개`);

// --- 일괄 저장: 체크만으로는 보내지 않는다 --------------------------------
posted.length = 0;
await page.uncheck('.attendance-check >> nth=1');
await page.waitForTimeout(800);
ok('체크만으로는 저장하지 않음', posted.length === 0, `요청 ${posted.length}건`);

// 버튼은 '실제로 쓸 인원' 을 보여준다 (명단 전체를 O/X 로 쓴다).
// 변경 건수는 그 옆 정보 줄이 말한다.
const btnText = await page.$eval('#saveAttendanceBtn', el => el.textContent.trim());
ok('저장 버튼이 쓸 인원을 보여줌', btnText.includes('2명'), btnText);
const infoText = await page.$eval('#attendanceSaveInfo', el => el.textContent.trim());
ok('정보 줄이 변경 건수와 출결 수를 보여줌',
   /변경 1건/.test(infoText) && /출석 1/.test(infoText) && /결석 1/.test(infoText), infoText);

await page.click('#saveAttendanceBtn');
await page.waitForTimeout(1200);

const body = posted[0];
ok('저장 요청에 session 포함', !!body && body.session === '2025-11-02',
   body ? JSON.stringify(body) : '(요청 없음)');
// 명단 전체를 O/X 로 보낸다. 예전에는 바뀐 사람만 보내서, 체크 안 한 사람이
// 빈칸(기록 없음)으로 남았다 — 출석도 결석도 아닌 칸이 되어 수료를 따질 때
// 한 명씩 되짚어야 했다.
const st = Object.fromEntries((body?.batch || []).map(b => [b.name, b.status]));
ok('명단 전체를 보낸다 (2명)', !!body && body.batch.length === 2,
   body ? JSON.stringify(body.batch) : '(요청 없음)');
ok('체크를 푼 사람은 X', st['이조원'] === 'X', JSON.stringify(st));
ok('체크한 사람은 O 그대로', st['김조장'] === 'O', JSON.stringify(st));

const doneText = await page.$eval('#saveAttendanceBtn', el => el.textContent.trim());
ok('저장 직후 완료 표시', doneText === '✅ 저장됨', doneText);

await page.waitForTimeout(2600);
const afterText = await page.$eval('#saveAttendanceBtn', el => el.textContent.trim());
ok('잠시 뒤 변경 없음 상태로', afterText === '변경 사항 없음', afterText);

// --- 전체 출석표 ----------------------------------------------------------
await page.click('#openMatrixBtn');
await page.waitForSelector('#matrixModal.active .matrix-table', { timeout: 10000 });

const cols = await page.$$eval('.matrix-table thead th', els => els.length);
ok('출석표 헤더 = 이름칸 + 회차수', cols === 1 + 2, `${cols}칸`);

const rows = await page.$$eval('.matrix-table tbody tr', els => els.length);
ok('출석표 행 = 조원수', rows === 2, `${rows}행`);

const cells = await page.$$eval('.matrix-table tbody tr:nth-child(2) .mx-status',
    els => els.map(e => e.textContent.trim()));
ok('돌봄이 출석표에 그대로 보임', cells.includes('돌봄'), cells.join(','));

await page.click('#matrixCloseBtn');
await page.waitForTimeout(300);
const closed = await page.$eval('#matrixModal', el => !el.classList.contains('active'));
ok('출석표 닫힘', closed);

await browser.close();
server.close();

done();
