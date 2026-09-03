// 관리자 출석 관리 화면 검증 — 사양서 검증 1~8번.
// Supabase / GAS 는 가짜 응답으로 대신한다 (컨테이너 밖으로 못 나간다).

import { serveRepo, launch, makeReporter, SHOT } from './lib/harness.mjs?v=108';

const PORT = 8094;
const server = await serveRepo(PORT);

// --------------------------------------------------------------------------
// 가짜 데이터
// --------------------------------------------------------------------------
const COHORT = 'DG-2026';
const TODAY = '2026-08-12';

// Y1 5명 · Y2 3명
const MEMBERS = [
  { id: 'u1', name: '김조장', phone: '1001', team: 'Y1', team_no: 1, role: '조장' },
  { id: 'u2', name: '이수료', phone: '1002', team: 'Y1', team_no: 2, role: '조원' },  // ◎ 보유
  { id: 'u3', name: '박제외', phone: '1003', team: 'Y1', team_no: 3, role: '조원' },  // − 보유
  { id: 'u4', name: '최빈칸', phone: '1004', team: 'Y1', team_no: 4, role: '조원' },
  { id: 'u5', name: '정출석', phone: '1005', team: 'Y1', team_no: 5, role: '조원' },
  { id: 'u6', name: '강조장', phone: '2001', team: 'Y2', team_no: 1, role: '조장' },
  { id: 'u7', name: '윤조원', phone: '2002', team: 'Y2', team_no: 2, role: '조원' },
  { id: 'u8', name: '한돌봄', phone: '2003', team: 'Y2', team_no: 3, role: '조원' },  // 돌봄 보유
].map(m => ({ ...m, cohort_id: COHORT, location: '웨슬리홀', lunch: 'O', status: 'active', age: 30 }));

// 08/02 = 지난 회차, 08/09 = 가장 최근 지난 회차, 08/16 = 아직 안 지남
const SESSIONS = [
  { session_date: '2026-08-02', label: '08/02', name: '17강' },
  { session_date: '2026-08-09', label: '08/09', name: '18강' },
  { session_date: '2026-08-16', label: '08/16', name: '19강' },
];

// 08/09 기준: 정출석 O · 이수료 ◎ · 박제외 − · 한돌봄 돌봄 · 나머지 빈칸
let ATT = {
  '김조장1001': { '2026-08-02': 'O', '2026-08-09': '' },
  '이수료1002': { '2026-08-02': 'O', '2026-08-09': '◎' },
  '박제외1003': { '2026-08-02': 'O', '2026-08-09': '-' },
  '최빈칸1004': { '2026-08-02': 'X', '2026-08-09': '' },
  '정출석1005': { '2026-08-02': 'O', '2026-08-09': 'O' },
  '강조장2001': { '2026-08-02': 'O', '2026-08-09': '' },
  '윤조원2002': { '2026-08-02': 'O', '2026-08-09': '' },
  '한돌봄2003': { '2026-08-02': 'O', '2026-08-09': '돌봄' },
};

const posted = [];
const { ok, done } = makeReporter('관리자 출석 관리');

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 900, height: 900 } });
const page = await context.newPage();

// 브라우저 시계를 고정한다. 관리자 화면은 GAS 를 부르지 않아서 '오늘' 을
// 브라우저에서 읽는다 — 안 고정하면 실제 날짜에 따라 기본 주차가 달라진다.
await page.clock.setFixedTime(new Date('2026-08-12T09:00:00Z'));

const dialogs = [];
page.on('dialog', d => {
  dialogs.push({ type: d.type(), message: d.message() });
  // confirm 은 승인, alert 은 닫기
  (d.type() === 'confirm' ? d.accept() : d.dismiss()).catch(() => {});
});
page.on('console', m => { if (m.type() === 'error') console.log('   [console.error] ' + m.text()); });
page.on('pageerror', e => console.log('   [pageerror] ' + e.message));

// 화면은 이제 출결을 DB 에서 읽는다. 동기화도 GAS 10분 트리거도 '빈칸만'
// 건너뛰고 시트에 적힌 값을 그대로 넣으므로 ◎ · − · 돌봄 도 DB 에 들어 있다.
const restCalls = [];
await page.route('**/rest/v1/**', route => {
  const url = new URL(route.request().url());
  const table = url.pathname.split('/').pop();
  restCalls.push({ table, search: url.search });
  let body = [];
  if (table === 'dg_members') {
    body = url.searchParams.get('select') === 'cohort_id' ? [{ cohort_id: COHORT }] : MEMBERS;
  } else if (table === 'dg_sessions') {
    body = SESSIONS;
  } else if (table === 'dg_attendance') {
    const date = (url.searchParams.get('session_date') || '').replace('eq.', '');
    body = MEMBERS
      .map(m => ({ member_id: m.id, status: ATT[`${m.name}${m.phone}`]?.[date] ?? '' }))
      .filter(r => r.status !== '');   // 빈칸은 행 자체가 없다 (동기화가 건너뛴다)
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

const gasPayload = () => ({
  success: true, version: 23,
  today: TODAY,
  currentSession: '2026-08-09',
  sessions: SESSIONS.map(s => ({ key: s.label, date: s.session_date, label: s.name })),
  data: MEMBERS.map(m => ({
    id: `${m.name}${m.phone}`, name: m.name, phone: m.phone, team: m.team,
    attendanceByDate: ATT[`${m.name}${m.phone}`] || {},
  })),
  locationMap: {}, teamLinkMap: {}, cohortHint: COHORT,
});

let gasGetCount = 0;
await page.route('**/script.google.com/**', route => {
  const req = route.request();
  if (req.method() !== 'POST') gasGetCount++;
  if (req.method() === 'POST') {
    const body = JSON.parse(req.postData() || '{}');
    posted.push(body);
    // GAS 처럼 동작한다: O/X/빈칸 이 아닌 칸은 두고(kept) 온다
    const kept = [];
    let saved = 0;
    for (const b of body.batch || []) {
      const id = `${b.name}${b.phone}`;
      const cur = String(ATT[id]?.[body.session] ?? '').trim();
      if (!['O', 'X', ''].includes(cur.toUpperCase())) { kept.push(`${id}(${cur})`); continue; }
      ATT[id][body.session] = b.status;
      saved++;
    }
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ success: true, session: body.session, saved, missing: [], kept }) });
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(gasPayload()) });
});

await page.addInitScript(() => sessionStorage.setItem('adminLoggedIn', '1'));
await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
// 조별 탭은 숨어 있으므로 '보일 때까지' 가 아니라 '생길 때까지' 기다린다
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });

// --- 탭 열기 --------------------------------------------------------------
restCalls.length = 0;
const t0 = Date.now();
await page.click('.tab-btn[data-tab="attendance"]');
await page.waitForSelector('#attList .att-row', { timeout: 15000 });
const openMs = Date.now() - t0;

// --- 성능: 시트 전체를 읽지 않는다 ----------------------------------------
ok('탭을 열 때 GAS(시트 전체) 호출 없음', gasGetCount === 0, `${gasGetCount}회`);
// 화면 로드 시 도는 배경 refresh 의 '오늘 출결' 조회는 따로다 (dg_members!inner).
const attQ = restCalls.filter(c => c.table === 'dg_attendance' && !c.search.includes('inner'));
ok('고른 회차 하나만 조회', attQ.length === 1 && attQ[0].search.includes('session_date=eq.2026-08-09'),
   attQ.map(c => c.search).join(' | '));
ok('탭이 바로 열림', openMs < 2000, `${openMs}ms`);

// 배경 갱신을 실제 경로로 일으킨다. 모듈은 싱글턴이라 같은 ?v= 로 import 하면
// 화면이 쓰고 있는 것과 같은 인스턴스가 나온다 — 테스트용 훅을 코드에 심지 않는다.
const ASSET_V = await page.evaluate(() =>
  document.querySelector('script[src*="admin.js"]').src.match(/v=(\d+)/)[1]);
async function refreshFromServer() {
  await page.evaluate(async (v) => {
    const mod = await import(`./scripts/members-data.js?v=${v}`);
    await mod.refreshAttendance();
  }, ASSET_V);
}

// 검증 8: 조를 '전체' 로 두면 조별로 묶여 나오는가
const teamValue = await page.$eval('#attTeamPicker', el => el.value);
const groups = await page.$$eval('.att-group-head', els => els.map(e => e.textContent.trim().split(' ')[0]));
ok('8. 조 전체 → 조별로 묶여 나옴', teamValue === '' && groups.join(',') === 'Y1,Y2',
   `team="${teamValue}" groups=${groups.join(',')}`);

const rowCount = await page.$$eval('#attList .att-row', els => els.length);
ok('   전원 8명이 한 화면에', rowCount === 8, `${rowCount}행`);

// 검증 6(기본값): 가장 최근 지난 강의가 기본
const sess = await page.$eval('#attSessionPicker', el => el.value);
// 오늘 08/12 기준 08/09(3일 전) · 08/16(4일 뒤) → 08/09
ok('6. 기본 주차 = 오늘과 가장 가까운 회차', sess === '2026-08-09', sess);

// 검증 7: 관리자는 전 주차(미래 포함)를 본다
const opts = await page.$$eval('#attSessionPicker option', els => els.map(e => e.value));
ok('7. 주차 목록에 전 주차(미래 포함)', opts.length === 3 && opts.includes('2026-08-16'), opts.join(','));
ok('주차 목록이 오름차순', opts.join(',') === '2026-08-02,2026-08-09,2026-08-16', opts.join(','));

// --- 보호 값 --------------------------------------------------------------
const locks = await page.$$eval('.att-row.locked', els => els.map(e => ({
  name: e.querySelector('.att-name').textContent.trim(),
  lock: e.querySelector('.att-lock')?.textContent.trim() || '',
  buttons: e.querySelectorAll('.att-state').length,
})));
ok('◎ − 돌봄 은 버튼 없이 읽기 전용',
   locks.length === 3 && locks.every(l => l.buttons === 0),
   locks.map(l => `${l.name}:${l.lock}`).join(' '));

await page.screenshot({ path: `${SHOT}/dg-admin-att-open.png`, fullPage: true });

// 검증 5: 미기록을 결석으로 세지 않는가
const summary0 = await page.$eval('#attSummary', el => el.textContent.replace(/\s+/g, ' ').trim());
ok('5. 미기록 ≠ 결석 (결석 0 · 미기록 4)',
   /출석 1/.test(summary0) && /결석 0/.test(summary0) && /미기록 4/.test(summary0), summary0);

// --- 검증 1: 두 명 찍고 저장 → 바뀐 두 명만 전송 ---------------------------
posted.length = 0;
await page.click('.att-state[data-uuid="u1"][data-status="O"]');
await page.click('.att-state[data-uuid="u4"][data-status="X"]');
await page.waitForTimeout(150);

ok('   변경 줄에 파란 띠', await page.$eval('.att-row.changed', el => !!el).catch(() => false));
const unmarkedBar = await page.$$eval('.att-row.unmarked', els => els.length);
ok('   미기록 줄에 주황 띠', unmarkedBar === 2, `${unmarkedBar}줄`);

// 손대지 않은 빈칸(강조장 · 윤조원)도 결석으로 함께 나간다.
// 버튼의 수는 실제로 쓰는 수여야 한다 — 2 라 적고 4명을 쓰면 안 된다.
const saveText = await page.$eval('#attSaveBtn', el => el.textContent.trim());
ok('   저장 버튼이 실제로 쓸 인원 표시 (변경 2 + 빈칸 2)', saveText === '4명 저장', saveText);
const saveInfo = await page.$eval('#attSaveInfo', el => el.textContent.trim());
ok('   빈칸이 결석으로 나간다고 알린다', /빈칸 2명은 결석/.test(saveInfo), saveInfo);

await page.click('#attSaveBtn');
await page.waitForTimeout(800);

const body1 = posted[0];
const st1 = Object.fromEntries((body1?.batch || []).map(b => [b.name, b.status]));
ok('1. 바뀐 두 명 + 빈칸 두 명 전송', !!body1 && body1.batch.length === 4,
   body1 ? JSON.stringify(body1.batch) : '(요청 없음)');
ok('1. 손대지 않은 빈칸은 X 로 나간다',
   st1['강조장'] === 'X' && st1['윤조원'] === 'X', JSON.stringify(st1));
ok('1. 찍은 값은 그대로', st1['김조장'] === 'O' && st1['최빈칸'] === 'X', JSON.stringify(st1));
ok('1. 시트에도 결석으로 들어간다',
   ATT['강조장2001']['2026-08-09'] === 'X' && ATT['윤조원2002']['2026-08-09'] === 'X',
   `강조장=${ATT['강조장2001']['2026-08-09']} 윤조원=${ATT['윤조원2002']['2026-08-09']}`);
ok('1. 회차가 함께 전송', body1?.session === '2026-08-09', body1?.session);
ok('1. ◎ − 돌봄 인 사람은 전송에 없음',
   !!body1 && !body1.batch.some(b => ['이수료', '박제외', '한돌봄'].includes(b.name)),
   body1 ? body1.batch.map(b => b.name).join(',') : '');

// --- 검증 2: ◎ 가 있는 조에서 '빈칸 → 결석' -------------------------------
//
// 위 저장으로 빈칸이 하나도 남지 않았다. 강조장의 X 를 다시 눌러 비워 둔다.
await page.click('.att-state[data-uuid="u6"][data-status="X"]');
await page.waitForTimeout(150);

dialogs.length = 0;
await page.click('#attBlankAbsentBtn');
await page.waitForTimeout(300);

const confirmMsg = dialogs.find(d => d.type === 'confirm')?.message || '';
ok('2. 빈칸→결석 은 확인을 묻는다', !!confirmMsg, confirmMsg.split('\n')[0]);
ok('2. 대상 명단을 보여준다', /강조장/.test(confirmMsg), confirmMsg.replace(/\n/g, ' | '));

const afterBlank = await page.evaluate(() => {
  const out = {};
  document.querySelectorAll('.att-row').forEach(r => {
    const name = r.querySelector('.att-name').textContent.trim();
    const on = r.querySelector('.att-state.on');
    out[name] = r.classList.contains('locked')
      ? r.querySelector('.att-lock').textContent.replace('🔒', '').trim()
      : (on ? on.dataset.status : '');
  });
  return out;
});
ok('2. ◎ 는 그대로', afterBlank['이수료'] === '◎', JSON.stringify(afterBlank));
ok('2. − 도 그대로', afterBlank['박제외'] === '−' || afterBlank['박제외'] === '-', afterBlank['박제외']);
ok('2. 빈칸이던 사람만 X 로', afterBlank['강조장'] === 'X' && afterBlank['윤조원'] === 'X',
   JSON.stringify(afterBlank));

// --- 검증 3: 같은 버튼 다시 눌러 빈칸 → 저장 → 기록 삭제 -------------------
posted.length = 0;
await page.click('#attRevertBtn');           // 위 일괄 변경은 버린다
await page.waitForTimeout(200);
await page.click('.att-state[data-uuid="u1"][data-status="O"]');   // 방금 저장한 O 를 다시 눌러 해제
await page.waitForTimeout(150);
const cleared = await page.$$eval('.att-row.changed .att-state.on', els => els.length);
ok('3. 같은 버튼 재클릭 → 빈칸', cleared === 0, `${cleared}개 남음`);

await page.click('#attSaveBtn');
await page.waitForTimeout(800);
// 사람이 일부러 지운 칸은 '결석' 이 아니라 '기록 없음' 이다.
// 여기서 X 로 바꿔 버리면 '전체 지우기' 로 잘못 찍은 것을 되돌릴 수가 없다.
const st3 = Object.fromEntries((posted[0]?.batch || []).map(b => [b.name, b.status]));
ok('3. 일부러 지운 칸은 빈 값으로 전송', st3['김조장'] === '',
   JSON.stringify(posted[0]?.batch));
ok('3. 시트에서 기록이 지워짐', ATT['김조장1001']['2026-08-09'] === '',
   JSON.stringify(ATT['김조장1001']));

// --- 검증 4: 배경 갱신이 오면 새 값으로 (편집 중이 아닐 때) ---------------
ATT['정출석1005']['2026-08-09'] = 'X';    // 서버 쪽에서 값이 바뀌었다고 가정
await refreshFromServer();
await page.waitForTimeout(500);

const afterRefresh = await page.evaluate(() => {
  const r = [...document.querySelectorAll('.att-row')]
    .find(x => x.querySelector('.att-name').textContent.trim() === '정출석');
  return r.querySelector('.att-state.on')?.dataset.status || '';
});
ok('4. 편집 중이 아니면 새 값으로 갱신', afterRefresh === 'X', `현재 ${afterRefresh}`);
const staleHidden = await page.$eval('#attStaleNotice', el => el.style.display === 'none');
ok('4. 경고는 뜨지 않음', staleHidden);

// --- 검증 5: 편집 중 배경 갱신 → 입력 유지 + 경고 -------------------------
await page.click('.att-state[data-uuid="u4"][data-status="O"]');   // 편집 시작
await page.waitForTimeout(150);
ATT['윤조원2002']['2026-08-09'] = 'O';
await refreshFromServer();
await page.waitForTimeout(500);

const draftKept = await page.evaluate(() => {
  const r = [...document.querySelectorAll('.att-row')]
    .find(x => x.querySelector('.att-name').textContent.trim() === '최빈칸');
  return r.querySelector('.att-state.on')?.dataset.status || '';
});
ok('5. 편집 중 갱신이 와도 입력이 유지됨', draftKept === 'O', `현재 ${draftKept}`);
const staleShown = await page.$eval('#attStaleNotice', el => el.style.display !== 'none');
ok('5. 대신 경고가 뜬다', staleShown);

// --- 검증 6: 수업 전 주차 → 결석 0, 미기록 N ------------------------------
dialogs.length = 0;
await page.selectOption('#attSessionPicker', '2026-08-16');
await page.waitForTimeout(400);
const futureSummary = await page.$eval('#attSummary', el => el.textContent.replace(/\s+/g, ' ').trim());
ok('6. 수업 전 주차 → 결석 0 · 미기록 8', /결석 0/.test(futureSummary) && /미기록 8/.test(futureSummary),
   futureSummary);
const saveDisabled = await page.$eval('#attSaveBtn', el => el.disabled);
ok('7. 미래 회차는 저장 불가', saveDisabled);
const btnsDisabled = await page.$$eval('.att-state', els => els.every(e => e.disabled));
ok('7. 미래 회차는 버튼도 잠김', btnsDisabled);

// --- 주차를 바꾸면 그 회차만 다시 읽는가 -----------------------------------
restCalls.length = 0;
const gasBefore = gasGetCount;
await page.selectOption('#attSessionPicker', '2026-08-09');
await page.waitForTimeout(500);
const switchQ = restCalls.filter(c => c.table === 'dg_attendance');
ok('주차를 바꾸면 그 회차만 다시 읽는다',
   switchQ.length === 1 && switchQ[0].search.includes('session_date=eq.2026-08-09'),
   switchQ.map(c => c.search).join(' | '));
ok('주차 전환에도 GAS 호출 없음', gasGetCount === gasBefore, `${gasGetCount - gasBefore}회`);
ok('읽은 시각이 표시된다',
   /읽음/.test(await page.$eval('#attLoadedAt', el => el.textContent)),
   await page.$eval('#attLoadedAt', el => el.textContent));

// --- 검증 7: 주차 변경 시 저장 안 한 변경이 있으면 묻는가 -----------------
await page.click('.att-state[data-uuid="u4"][data-status="X"]');
await page.waitForTimeout(150);

dialogs.length = 0;
await page.selectOption('#attSessionPicker', '2026-08-02');
await page.waitForTimeout(400);
ok('7. 주차 변경 시 저장 안 한 변경을 묻는다',
   dialogs.some(d => d.type === 'confirm' && /저장하지 않은/.test(d.message)),
   dialogs.map(d => d.message.split('\n')[0]).join(' | '));

// --- 주차·조 기억 ----------------------------------------------------------
await page.selectOption('#attTeamPicker', 'Y2');
await page.waitForTimeout(300);
const prefs = await page.evaluate(() => localStorage.getItem('dg_admin_att_v1'));
ok('6. 고른 주차·조를 기억', /2026-08-02/.test(prefs || '') && /Y2/.test(prefs || ''), prefs);

const y2rows = await page.$$eval('#attList .att-row', els => els.length);
ok('   조를 고르면 그 조만', y2rows === 3, `${y2rows}행`);

await page.screenshot({ path: `${SHOT}/dg-admin-att.png`, fullPage: true });

await browser.close();
server.close();

done();
