// 관리자 화면 검증 — 검색(동명이인 포함) · 조별 보기 · 개인별 보기 · 필터.
// Supabase 는 가짜 응답으로 대신한다.

import { serveRepo, launch, makeReporter } from './lib/harness.mjs';

const PORT = 8092;
const server = await serveRepo(PORT);

const COHORT = 'DG-2026';
// 청년부는 YF · YM 으로 갈렸다. 조 차례를 실제로 검증하려면 부서가 섞여
// 있어야 한다 — YF · YM 만 있으면 어떤 규칙으로 정렬해도 답이 같다.
// DB 가 돌려주는 차례는 조 이름 순이 아니다(team,team_no). 일부러 섞어 둔다.
const M = [
  { id: 'u4', cohort_id: COHORT, name: '박집사', phone: '4444', team: '남1', team_no: 1,
    location: '칼빈', role: '조장', age: 52, lunch: 'O', status: 'active' },
  { id: 'u1', cohort_id: COHORT, name: '김철수', phone: '1111', team: 'YF1', team_no: 1,
    location: '칼빈', role: '조장', age: 28, lunch: 'O', status: 'active' },
  { id: 'u5', cohort_id: COHORT, name: '최권사', phone: '5555', team: '여1', team_no: 1,
    location: '칼빈', role: '조장', age: 60, lunch: 'X', status: 'active' },
  { id: 'u2', cohort_id: COHORT, name: '김철수', phone: '2222', team: 'YM1', team_no: 1,
    location: '웨슬리홀', role: '', age: 35, lunch: 'X', status: 'active' },
  // YM5 → YM1, YM6 → YM2 로 번호를 다시 매긴 상태. 옛 이름은 시트에 없다.
  { id: 'u8', cohort_id: COHORT, name: '조형제', phone: '8888', team: 'YM2', team_no: 1,
    location: '웨슬리홀', role: '조장', age: 26, lunch: 'O', status: 'active' },
  { id: 'u6', cohort_id: COHORT, name: '정부부', phone: '6666', team: 'C1', team_no: 1,
    location: '온라인', role: '조장', age: 40, lunch: 'O', status: 'active' },
  { id: 'u3', cohort_id: COHORT, name: '이영희', phone: '3333', team: 'YF1', team_no: 2,
    location: '칼빈', role: '', age: 31, lunch: 'O', status: 'active' },
  { id: 'u7', cohort_id: COHORT, name: '한지난', phone: '7777', team: 'Y9', team_no: 1,
    location: '칼빈', role: '', age: 29, lunch: 'X', status: 'active' },
];

// 출석 관리 탭은 회차가 있어야 조 선택칸을 그린다.
const SESSIONS = [
  // 08/02 는 일부러 출결 기록을 안 둔다 — '기록 없음' 칸이 어두운 바탕에서
  // 사라지지 않는지 보려는 것.
  { session_date: '2026-08-02', label: '08/02', name: '자유교제' },
  { session_date: '2026-08-09', label: '08/09', name: '18강' },
  { session_date: '2026-08-16', label: '08/16', name: '19강' },
];

// 개인별 카드를 눌렀을 때 뜨는 상세 모달용
const ATT = [
  { member_id: 'u1', session_date: '2026-08-09', status: 'O' },
  { member_id: 'u1', session_date: '2026-08-16', status: '-' },   // 수업 없음 — 흐린 칸
];
// 강 번호가 뒤죽박죽이고 제출 시각이 빈 것도 섞여 있다
const HW = [
  { member_id: 'u1', lecture: '9강',  kind: '과제', content: '', submitted_at: '2026-08-01T09:00:00' },
  { member_id: 'u1', lecture: '18강', kind: '과제', content: '', submitted_at: null },
  { member_id: 'u1', lecture: '15강', kind: '과제', content: '', submitted_at: '2026-07-01T09:00:00' },
];

const { ok, done } = makeReporter('관리자 화면');

const browser = await launch();
const ctx = await browser.newContext();
// 관리자 화면은 로그인 표시가 있어야 들어간다.
// 기억해 둔 조가 **이름이 바뀌어 없어진** 상태로 시작한다 (YM5 → YM1).
// 없는 조를 붙들고 있으면 빈 명단이 뜨고, 그 상태로 일괄 버튼을 누르면 사고가 난다.
await ctx.addInitScript(() => {
  sessionStorage.setItem('adminLoggedIn', 'true');
  localStorage.setItem('dg_admin_att_v1', JSON.stringify({ session: '', team: 'YM5' }));
  localStorage.setItem('dg_admin_print_skip_v1', JSON.stringify(['YM5', 'YM6']));
});
const page = await ctx.newPage();
page.on('dialog', d => { console.log('   [dialog] ' + d.message()); d.dismiss().catch(() => {}); });
page.on('console', m => { if (m.type() === 'error') console.log('   [console.error] ' + m.text()); });

// 게시된 CSV 로 나가면 안 된다 — 나가면 잡아낸다
let csvHits = 0;
await page.route('**/docs.google.com/**', route => { csvHits++; route.abort(); });

await page.route('**/rest/v1/**', route => {
  const u = new URL(route.request().url());
  const t = u.pathname.split('/').pop();
  let body = [];
  if (t === 'dg_members') {
    body = u.searchParams.get('select') === 'cohort_id' ? [{ cohort_id: COHORT }] : M;
  } else if (t === 'dg_sessions') {
    body = SESSIONS;
  } else if (t === 'dg_attendance') {
    body = (u.searchParams.get('select') || '').includes('dg_members!inner') ? [] : ATT;
  } else if (t === 'dg_homework') {
    body = HW;
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.route('**/script.google.com/**', route =>
  route.fulfill({ status: 200, contentType: 'application/json',
                  body: JSON.stringify({ success: true, data: [], sessions: [] }) }));

await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
await page.waitForTimeout(2500);

ok('게시된 CSV 로 나가지 않음', csvHits === 0, `요청 ${csvHits}건`);

// --- 조별 보기 ------------------------------------------------------------
await page.click('.tab-btn[data-tab="teams"]');
await page.waitForTimeout(400);
const teamCards = await page.$$eval('#teamsGrid > *', els => els.length);
ok('조별 보기 — 조 카드', teamCards === 7, `${teamCards}개`);

// 조 차례 — 청년부(YF·YM)가 예전 Y 자리를 그대로 쓴다.
// 'YF' 를 아는 접두어로 두지 않으면 모르는 이름 취급이라 C·남·여 뒤로 밀린다.
const order = await page.$$eval('#teamsGrid .team-card-name', els => els.map(e => e.textContent.trim()));
ok('조 차례 — YF · YM 이 C · 남 · 여 앞',
   order.join(',') === 'YF1,YM1,YM2,Y9,C1,남1,여1', order.join(' → '));
ok('YF 가 YM 보다 앞', order.indexOf('YF1') < order.indexOf('YM1'), order.join(' → '));
ok('YM 안에서는 번호순', order.indexOf('YM1') < order.indexOf('YM2'), order.join(' → '));
ok('지난 기수 Y 도 청년부 자리에 남는다',
   order.indexOf('Y9') < order.indexOf('C1'), order.join(' → '));

// 이름이 바뀐 조를 기억하고 있으면 붙들지 않고 '전체' 로 돌아간다
await page.click('.tab-btn[data-tab="attendance"]');
await page.waitForTimeout(600);
const attTeamVal = await page.$eval('#attTeamPicker', el => el.value);
const attTeamOpts = await page.$$eval('#attTeamPicker option', els => els.map(e => e.value));
ok('없어진 조를 기억하고 있어도 전체로 돌아간다', attTeamVal === '', `‘${attTeamVal}’`);
ok('조 목록은 지금 이름만', attTeamOpts.includes('YM1') && attTeamOpts.includes('YM2')
   && !attTeamOpts.includes('YM5'), attTeamOpts.join(','));
const attRows = await page.$$eval('#attList .att-row', els => els.length);
ok('전체로 돌아갔으니 명단이 다 나온다', attRows === M.length, `${attRows}줄 / ${M.length}명`);

// 옛 이름으로 '뺀 조' 를 기억하고 있어도, 이름이 바뀐 조가 인쇄에서 빠지면 안 된다
await page.click('.tab-btn[data-tab="print"]');
await page.waitForSelector('.pr-sheet', { timeout: 15000 });
const prCountText = await page.$eval('#prCount', el => el.textContent.trim());
ok('옛 이름으로 뺀 기억이 남아 있어도 다 출력한다',
   /(\d+)장 중 \1장 출력/.test(prCountText), prCountText);

// --- 개인별 보기 + 나이 ---------------------------------------------------
await page.click('.tab-btn[data-tab="members"]');
await page.waitForTimeout(400);
const memberCards = await page.$$eval('#membersGrid > *', els => els.length);
ok('개인별 보기 — 인원 카드', memberCards === 8, `${memberCards}명`);

const hasAge = await page.evaluate(() => document.getElementById('membersGrid').textContent.includes('28'));
ok('나이가 표시됨', hasAge);

// --- 필터 ------------------------------------------------------------------
await page.fill('#memberFilter', '이영희');
await page.waitForTimeout(400);
const filtered = await page.$$eval('#membersGrid > *', els => els.length);
ok('개인별 필터', filtered === 1, `${filtered}명`);
await page.fill('#memberFilter', '');
await page.waitForTimeout(300);

// --- 개인 상세 모달 — 다크 모드에서 글씨가 보이는가 --------------------------
//
// 다크 모드에서 --white 는 '카드 바탕색'(진한 남색)이다. 그걸 글자색으로 쓰면
// 제목이 배경과 같은 색이 되어 통째로 사라진다.
await page.click('.tab-btn[data-tab="members"]');
await page.waitForTimeout(400);
await page.click('#membersGrid > *');
await page.waitForSelector('.md-section', { timeout: 10000 });
await page.waitForTimeout(500);

const md = await page.evaluate(() => {
  const rgb = (v) => (v.match(/\d+/g) || []).slice(0, 3).map(Number);
  const dist = (a, b) => Math.abs(a[0]-b[0]) + Math.abs(a[1]-b[1]) + Math.abs(a[2]-b[2]);
  const h3 = document.querySelector('.md-section-head h3');
  const body = document.querySelector('.member-detail-body');
  const chips = [...document.querySelectorAll('.member-detail-body .att-chip')];
  const dim = chips.find(c => c.classList.contains('none') || c.classList.contains('empty'));
  return {
    titleGap: dist(rgb(getComputedStyle(h3).color), rgb(getComputedStyle(body).backgroundColor)),
    titleText: h3.textContent.trim(),
    dimOpacity: dim ? Number(getComputedStyle(dim).opacity) : null,
    // 회차 이름이 배경에 묻히지 않는가 (가장 안 보이는 칸 기준)
    nameGap: Math.min(...chips.map(c => {
      const n = c.querySelector('.att-name');
      return n ? dist(rgb(getComputedStyle(n).color), rgb(getComputedStyle(c).backgroundColor)) : 999;
    })),
    hw: [...document.querySelectorAll('.md-hw-lecture')].map(e => e.textContent.trim()),
  };
});
ok('구역 제목이 배경에 묻히지 않는다', md.titleGap > 150, `색 차이 ${md.titleGap} (${md.titleText})`);
ok('기록 없는 칸도 읽힌다 (흐리게 지우지 않는다)', md.dimOpacity === 1, `opacity ${md.dimOpacity}`);
ok('칸 안의 회차 이름이 배경에 묻히지 않는다', md.nameGap > 100, `색 차이 ${md.nameGap}`);
ok('과제는 강 번호 내림차순 — 조원 화면과 같은 차례',
   md.hw.join(',') === '18강,15강,9강', md.hw.join(','));

await page.click('#memberDetailClose');
await page.waitForTimeout(300);

// --- 검색 모드는 없앴다 -----------------------------------------------------
//
// 개인별 보기의 필터 + 카드 클릭 상세가 그 일을 대신한다. 탭이 남아 있으면
// 같은 일을 두 곳에서 하게 되고, 둘이 조금씩 달라진다.
const tabs = await page.$$eval('.tab-btn', els => els.map(e => e.dataset.tab));
ok('검색 모드 탭이 없다', !tabs.includes('search'), tabs.join(','));
ok('첫 탭은 개인별 보기', tabs[0] === 'members', tabs.join(','));
ok('탭 차례 — 개인별·조별·출석·결석·출력',
   tabs.join(',') === 'members,teams,attendance,absence,print', tabs.join(','));
ok('검색 모드 자리도 사라졌다',
   await page.evaluate(() => !document.getElementById('searchTab')));
// 여기까지 오며 탭을 옮겨 다녔으므로 새로 열어서 본다
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1500);
ok('첫 화면이 개인별 보기로 열린다',
   await page.evaluate(() => !!document.querySelector('#membersTab.active')));

await browser.close();
server.close();

done();
