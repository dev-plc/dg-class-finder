// 관리자 페이지의 '시트에서 지금 가져오기' · '화면 새로 고침' 검증.

import { readFileSync } from 'node:fs';

import { serveRepo, launch, makeReporter, ROOT } from './lib/harness.mjs';

const PORT = 8095;
const server = await serveRepo(PORT);

const COHORT = 'DG-2026';
let MEMBERS = [
  { id: 'u1', cohort_id: COHORT, name: '김조장', phone: '1001', team: 'Y1', team_no: 1,
    role: '조장', location: '웨슬리홀', lunch: 'O', status: 'active', age: 30 },
];
const SESSIONS = [{ session_date: '2026-08-09', label: '08/09', name: '18강' }];

const { ok, done } = makeReporter('시트 동기화 버튼');

const browser = await launch();
const page = await (await browser.newContext()).newPage();
page.on('pageerror', e => console.log('   [pageerror] ' + e.message));

let memberFetches = 0;
await page.route('**/rest/v1/**', route => {
  const url = new URL(route.request().url());
  const table = url.pathname.split('/').pop();
  let body = [];
  if (table === 'dg_members') {
    if (url.searchParams.get('select') === 'cohort_id') body = [{ cohort_id: COHORT }];
    else { memberFetches++; body = MEMBERS; }
  } else if (table === 'dg_sessions') body = SESSIONS;
  else if (table === 'dg_sync_log') body = [{ finished_at: '2026-08-22T04:20:00Z' }];
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

// GAS 는 동기화 요청만 받는다
const posts = [];
let gasReply = { success: true, version: 24, message: '동기화를 요청했습니다. 보통 1~2분 걸립니다.' };
await page.route('**/script.google.com/**', route => {
  const req = route.request();
  if (req.method() === 'POST') {
    posts.push({
      contentType: req.headers()['content-type'] || '',
      body: JSON.parse(req.postData() || '{}'),
    });
    return route.fulfill({ status: 200, contentType: 'application/json',
                           body: JSON.stringify(gasReply) });
  }
  route.fulfill({ status: 200, contentType: 'application/json',
                  body: JSON.stringify({ success: true }) });
});

await page.addInitScript(() => sessionStorage.setItem('adminLoggedIn', '1'));
await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });

// 화면 진입 애니메이션이 끝날 때까지 기다렸다가 본다.
// 한 번만 찍으면 애니메이션 중간을 집어 '안 보인다' 가 나온다.
const syncVisible = await page.locator('#syncBtn')
  .waitFor({ state: 'visible', timeout: 10000 }).then(() => true).catch(() => false);
const syncEnabled = await page.locator('#syncBtn').isEnabled();
ok('동기화 버튼이 보이고 누를 수 있다', syncVisible && syncEnabled,
   `visible=${syncVisible} enabled=${syncEnabled}`);

// --- 가져오기 -------------------------------------------------------------
await page.click('#syncBtn');
await page.waitForTimeout(600);

ok('GAS 로 action:sync 를 보낸다', posts[0]?.body?.action === 'sync',
   JSON.stringify(posts[0]?.body));
ok('CORS preflight 를 피하려 text/plain 으로 보낸다',
   /text\/plain/.test(posts[0]?.contentType || ''), posts[0]?.contentType);
ok('토큰을 앱에서 보내지 않는다',
   !JSON.stringify(posts[0]?.body || {}).match(/token|ghp_|github_pat/i),
   JSON.stringify(posts[0]?.body));

const info1 = await page.$eval('#syncInfo', el => el.textContent.trim());
// '눌러 주세요' 가 아니라 '저절로' 다 — 끝 표시(dg_sync_log)를 보고 화면이 스스로 읽는다.
ok('결과 메시지를 보여준다', /1~2분/.test(info1) && /저절로 새로 읽습니다/.test(info1), info1);

ok('연타 방지 — 버튼이 잠긴다', await page.$eval('#syncBtn', el => el.disabled));

// --- 실패 응답 -------------------------------------------------------------
gasReply = { success: false, version: 24, message: '워크플로를 찾지 못했습니다 (a/b · x.yml).' };
await page.evaluate(() => { document.getElementById('syncBtn').disabled = false; });
await page.click('#syncBtn');
await page.waitForTimeout(600);
const info2 = await page.$eval('#syncInfo', el => el.textContent.trim());
const cls2 = await page.$eval('#syncInfo', el => el.className);
ok('실패 사유를 그대로 보여준다', /워크플로를 찾지 못했습니다/.test(info2), info2);
ok('실패는 실패로 표시된다', cls2.includes('fail'), cls2);

// --- 화면 새로 고침 --------------------------------------------------------
MEMBERS = [...MEMBERS, {
  id: 'u2', cohort_id: COHORT, name: '새로온이', phone: '1002', team: 'Y1', team_no: 2,
  role: '조원', location: '웨슬리홀', lunch: 'X', status: 'active', age: 31,
}];
const before = memberFetches;
await page.click('#syncReloadBtn');
await page.waitForTimeout(900);

ok('새로 고침이 데이터를 다시 읽는다', memberFetches > before, `${memberFetches - before}회`);
const names = await page.$$eval('.member-card-id', els => els.map(e => e.textContent.trim()));
ok('추가된 인원이 화면에 나온다', names.some(n => n.includes('새로온이')), names.join(', '));
const info3 = await page.$eval('#syncInfo', el => el.textContent.trim());
ok('새로 고침 결과를 알린다', /읽었습니다/.test(info3), info3);

// --- 자동 동기화 주기 --------------------------------------------------------
//
// 과제·김밥·명단은 이 워크플로로만 DB 에 들어온다 (GAS 10분 트리거는 출석만).
// 하루 한 번이던 때는 낮에 낸 과제가 다음 날까지 앱에 안 보였다.
const yml = readFileSync(`${ROOT}/.github/workflows/sync-db.yml`, 'utf8');
const cron = (yml.match(/cron:\s*'([^']+)'/) || [])[1] || '';
ok('예약 실행이 하루 한 번보다 잦다', cron === '20 */2 * * *', cron || '(없음)');
ok('정각은 피한다 — GitHub 예약은 정각에 30~45분씩 밀린다',
   !/^0\s/.test(cron), cron);

// 화면이 알려주는 다음 시각이 그 cron 과 같아야 한다. 두 곳이 어긋나면
// 화면이 거짓말을 하고, 사람은 오지 않을 시각을 기다린다.
//
// 시계를 고정하고 실제 화면 문구를 읽는다 — 규칙을 검증 쪽에 옮겨 적으면
// 화면이 틀려도 검증은 통과한다.
async function syncInfoAt(iso) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => sessionStorage.setItem('adminLoggedIn', '1'));
  const p2 = await ctx.newPage();
  await p2.clock.setFixedTime(new Date(iso));
  await p2.route('**/rest/v1/**', route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop();
    let body = [];
    if (table === 'dg_members') {
      body = url.searchParams.get('select') === 'cohort_id' ? [{ cohort_id: COHORT }] : MEMBERS;
    } else if (table === 'dg_sessions') body = SESSIONS;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await p2.route('**/script.google.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify({ success: true }) }));
  await p2.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
  await p2.waitForFunction(() => document.getElementById('syncInfo')?.textContent.includes('다음'),
                           null, { timeout: 20000 });
  const text = await p2.$eval('#syncInfo', el => el.textContent.trim());
  await ctx.close();
  return text;
}

// KST = UTC+9. 04:20 UTC = 오후 1:20, 06:20 UTC = 오후 3:20, 00:20 UTC = 오전 9:20
const at0400 = await syncInfoAt('2026-08-22T04:00:00Z');   // 04:20 이 아직 안 지났다
ok('아직 안 지난 짝수 시는 그대로', /다음 오후 1:20 무렵/.test(at0400), at0400);

const at0430 = await syncInfoAt('2026-08-22T04:30:00Z');   // 지났으니 06:20
ok('지나갔으면 두 시간 뒤', /다음 오후 3:20 무렵/.test(at0430), at0430);

const at0330 = await syncInfoAt('2026-08-22T03:30:00Z');   // 홀수 시 → 04:20
ok('홀수 시에는 다음 짝수 시', /다음 오후 1:20 무렵/.test(at0330), at0330);

const at2330 = await syncInfoAt('2026-08-22T23:30:00Z');   // 날을 넘긴다
ok('자정을 넘겨도 이어진다', /다음 오전 9:20 무렵/.test(at2330), at2330);

ok('2시간마다라고 알린다', /2시간마다/.test(at0400), at0400);
// '무렵' 인 이유: GitHub 의 예약 실행은 30~45분씩 밀린다. 딱 떨어지는 시각을
// 적으면 그 시각에 안 돌았을 때 고장으로 읽힌다.
ok("'무렵' 이라고 적는다 — 예약 실행은 밀린다", /무렵/.test(at0400), at0400);

await page.screenshot({ path: '/dg-sync-btn.png' });

// --- 자동 새로고침 ----------------------------------------------------------
//
// 이 절이 겨누는 버그: 폴링이 dg_members.updated_at 을 보고 있었다. 그런데
// 동기화는 dg_members 를 **맨 먼저** 쓴다. 출석·과제가 아직 안 들어온 시점에
// 새로고침이 돌았고, 깃발을 먼저 올려 버려 **두 번째 새로고침이 영영 안 왔다.**
//
// 그래서 화면은 동기화가 **다 끝나고** 남기는 dg_sync_log 한 줄만 봐야 한다.

/**
 * 폴링만 보는 창을 따로 연다. 시계를 가짜로 세워 두고 앞으로 감는다 —
 * 진짜로 2분을 기다리면 검증이 못 쓸 만큼 느려진다.
 */
async function pollCase({ syncLogStatus = 200, hidden = false } = {}) {
  const ctx = await browser.newContext();
  await ctx.addInitScript(() => sessionStorage.setItem('adminLoggedIn', '1'));
  if (hidden) {
    await ctx.addInitScript(() =>
      Object.defineProperty(document, 'hidden', { get: () => true, configurable: true }));
  }
  const p2 = await ctx.newPage();
  await p2.clock.install({ time: new Date('2026-08-22T04:00:00Z') });

  const state = {
    members: [...MEMBERS],
    syncMark: '2026-08-22T04:20:00Z',
    attMark: '2026-08-22T04:20:00Z',
    memberFetches: 0,
    syncLogHits: 0,
    attHits: 0,
  };

  await p2.route('**/rest/v1/**', route => {
    const url = new URL(route.request().url());
    const table = url.pathname.split('/').pop();
    if (table === 'dg_sync_log') {
      state.syncLogHits++;
      if (syncLogStatus !== 200) {
        return route.fulfill({ status: syncLogStatus, contentType: 'application/json',
                               body: JSON.stringify({ message: 'relation does not exist' }) });
      }
      return route.fulfill({ status: 200, contentType: 'application/json',
                             body: JSON.stringify([{ finished_at: state.syncMark }]) });
    }
    if (table === 'dg_attendance') {
      state.attHits++;
      return route.fulfill({ status: 200, contentType: 'application/json',
                             body: JSON.stringify([{ updated_at: state.attMark }]) });
    }
    let body = [];
    if (table === 'dg_members') {
      if (url.searchParams.get('select') === 'cohort_id') body = [{ cohort_id: COHORT }];
      else { state.memberFetches++; body = state.members; }
    } else if (table === 'dg_sessions') body = SESSIONS;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await p2.route('**/script.google.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json',
                    body: JSON.stringify({ success: true, version: 24, message: '요청했습니다.' }) }));

  await p2.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
  await p2.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });
  // 가져오기를 눌러 촘촘한 폴링(10초)을 켠다.
  await p2.click('#syncBtn');
  await p2.waitForTimeout(300);

  state.tick = async (ms = 11000) => { await p2.clock.runFor(ms); await p2.waitForTimeout(400); };
  state.close = () => ctx.close();
  state.page = p2;
  return state;
}

{
  const c = await pollCase();

  // (1) dg_members 만 바뀐 상태 — 동기화가 아직 안 끝났다. 읽으면 안 된다.
  const before = c.memberFetches;
  c.members = [...c.members, {
    id: 'u9', cohort_id: COHORT, name: '아직안끝남', phone: '1009', team: 'Y1', team_no: 9,
    role: '조원', location: '웨슬리홀', lunch: 'X', status: 'active', age: 33,
  }];
  await c.tick();
  ok('끝 표시가 그대로면 다시 읽지 않는다', c.memberFetches === before,
     `${c.memberFetches - before}회 더 읽음`);
  ok('끝 표시를 실제로 보고 있다', c.syncLogHits > 0, `${c.syncLogHits}회 조회`);

  // (2) 끝 표시가 바뀌었다 — 이제 읽는다.
  c.syncMark = '2026-08-22T04:31:00Z';
  await c.tick();
  ok('끝 표시가 바뀌면 다시 읽는다', c.memberFetches > before,
     `${c.memberFetches - before}회 더 읽음`);
  const names = await c.page.$$eval('.member-card-id', els => els.map(e => e.textContent.trim()));
  ok('새 인원이 화면에 나온다', names.some(n => n.includes('아직안끝남')), names.join(', '));

  // (3) 같은 표시로는 또 읽지 않는다 (헛 새로고침 없음)
  const after = c.memberFetches;
  await c.tick();
  ok('같은 끝 표시로는 또 읽지 않는다', c.memberFetches === after,
     `${c.memberFetches - after}회 더 읽음`);

  await c.close();
}

{
  // 표가 아직 없으면(마이그레이션 전) dg_attendance.updated_at 으로 물러난다.
  const c = await pollCase({ syncLogStatus: 404 });
  await c.tick();
  ok('끝 표시 표가 없으면 dg_attendance 로 물러난다', c.attHits > 0, `${c.attHits}회 조회`);

  const before = c.memberFetches;
  c.attMark = '2026-08-22T04:33:00Z';
  await c.tick();
  ok('물러난 뒤에도 바뀌면 다시 읽는다', c.memberFetches > before,
     `${c.memberFetches - before}회 더 읽음`);
  await c.close();
}

{
  // 배경 탭에서는 쉰다. 켜 둔 창이 여럿이면 그만큼 헛 요청이 나간다.
  const c = await pollCase({ hidden: true });
  const before = c.syncLogHits;
  await c.tick();
  await c.tick();
  ok('배경 탭이면 요청이 안 나간다', c.syncLogHits === before,
     `${c.syncLogHits - before}회 더 조회`);
  await c.close();
}

await browser.close();
server.close();

done();
