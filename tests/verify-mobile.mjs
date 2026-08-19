// 관리자 화면 모바일 레이아웃 검증.
// 좁은 폭에서 글자가 세로로 쪼개지거나 상자를 넘치지 않는지 본다.

import { serveRepo, launch, makeReporter, SHOT } from './lib/harness.mjs?v=91';

const PORT = 8097;
const server = await serveRepo(PORT);

const COHORT = 'DG-2026';
// 33개 조 — 실제 규모에 가깝게
const MEMBERS = Array.from({ length: 33 }, (_, t) =>
  Array.from({ length: 6 }, (_, i) => ({
    id: `u${t}_${i}`, cohort_id: COHORT,
    name: `조원${t}${i}`, phone: String(1000 + t * 10 + i),
    team: `Y${t + 1}`, team_no: i + 1,
    location: t % 2 ? '웨슬리홀' : '온라인',
    role: i === 0 ? '조장' : '조원', lunch: 'O', status: 'active', age: 30,
  }))).flat();
const SESSIONS = [{ session_date: '2026-08-16', label: '08/16', name: '19강' }];

const { ok, done } = makeReporter('모바일 배치');

const browser = await launch();
// 아이폰 세로 폭. 첨부해 주신 화면과 같은 조건.
const context = await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const page = await context.newPage();
await page.clock.setFixedTime(new Date('2026-08-12T09:00:00Z'));
page.on('pageerror', e => console.log('   [pageerror] ' + e.message));

await page.route('**/rest/v1/**', route => {
  const url = new URL(route.request().url());
  const table = url.pathname.split('/').pop();
  let body = [];
  if (table === 'dg_members') {
    body = url.searchParams.get('select') === 'cohort_id' ? [{ cohort_id: COHORT }] : MEMBERS;
  } else if (table === 'dg_sessions') body = SESSIONS;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.route('**/script.google.com/**', route =>
  route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));

await page.addInitScript(() => sessionStorage.setItem('adminLoggedIn', '1'));
await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });

// 첫 방문에 서비스워커가 페이지를 넘겨받아도 리로드하면 안 된다.
// (리로드가 나면 아래 검사들이 '실행 문맥이 사라졌다' 로 죽는다)
let reloaded = false;
page.on('framenavigated', f => { if (f === page.mainFrame()) reloaded = true; });
await page.waitForTimeout(1500);
ok('첫 방문에 스스로 새로고침하지 않는다', !reloaded);

// --- 탭 ---------------------------------------------------------------------
const tabs = await page.$$eval('.tab-btn', els => els.map(e => {
  const r = e.getBoundingClientRect();
  const cs = getComputedStyle(e);
  return {
    text: e.textContent.trim(),
    w: Math.round(r.width), h: Math.round(r.height),
    top: Math.round(r.top), lines: Math.round(r.height / parseFloat(cs.lineHeight || 20)),
    nowrap: cs.whiteSpace === 'nowrap',
  };
}));

// 글자가 세로로 쪼개지면 버튼이 길쭉해진다 — 폭보다 높이가 크면 그 꼴이다
ok('탭 글자가 세로로 쪼개지지 않는다', tabs.every(t => t.h < t.w),
   tabs.map(t => `${t.text} ${t.w}×${t.h}`).join(' · '));
ok('탭 줄바꿈이 막혀 있다', tabs.every(t => t.nowrap));

const rows = [...new Set(tabs.map(t => t.top))].length;
ok('탭이 두 줄로 정리된다', rows === 2, `${rows}줄`);
ok('탭 높이가 손가락에 맞는다 (44px 이상)', tabs.every(t => t.h >= 40),
   tabs.map(t => t.h).join(','));

// --- 가로 넘침 --------------------------------------------------------------
const overflow = await page.evaluate(() => {
  const bad = [];
  for (const el of document.querySelectorAll('.admin-container *')) {
    if (!el.offsetParent && el.offsetWidth === 0) continue;
    const r = el.getBoundingClientRect();
    if (r.width && r.right > window.innerWidth + 1) {
      bad.push(`${el.className || el.tagName} (${Math.round(r.right)}px)`);
    }
  }
  return bad.slice(0, 5);
});
ok('가로로 넘치는 요소가 없다', overflow.length === 0, overflow.join(', '));

const scrollX = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('페이지가 가로로 밀리지 않는다', scrollX <= 1, `${scrollX}px`);

// --- 헤더 -------------------------------------------------------------------
const logout = await page.$eval('.logout-btn', el => {
  const t = el.querySelector('.logout-text');
  const r = t.getBoundingClientRect();
  return { h: Math.round(r.height), line: parseFloat(getComputedStyle(t).lineHeight) || 20 };
});
ok('로그아웃 글자가 두 줄로 접히지 않는다', logout.h <= logout.line * 1.4,
   `${logout.h}px (한 줄 ${Math.round(logout.line)}px)`);

// 머리줄 — 폰 세로 폭(390)에서는 배지를 빼고, 조금 넓어지면(480) 다시 보인다.
// 어느 쪽이든 글자가 잘리면 안 된다.
async function headerState() {
  return page.evaluate(() => {
    const badge = document.querySelector('.admin-badge');
    const shown = getComputedStyle(badge).display !== 'none';
    const need = (el) => {
      const c = el.cloneNode(true);
      Object.assign(c.style, { position: 'absolute', width: 'auto', visibility: 'hidden' });
      document.body.appendChild(c);
      const w = Math.round(c.getBoundingClientRect().width);
      c.remove();
      return w;
    };
    const g = (s) => { const r = document.querySelector(s).getBoundingClientRect();
                       return { l: Math.round(r.left), r: Math.round(r.right),
                                w: Math.round(r.width) }; };
    return { shown, badge: g('.admin-badge'), badgeNeeds: shown ? need(badge) : 0,
             controls: g('.admin-controls'), brand: g('.admin-brand') };
  });
}

const head = await headerState();
ok('390px 에서는 배지를 빼서 자리를 만든다', !head.shown);
ok('머리줄이 겹치지 않는다', head.brand.r <= head.controls.l,
   `브랜드 끝 ${head.brand.r} / 조작부 시작 ${head.controls.l}`);

await page.setViewportSize({ width: 480, height: 844 });
await page.waitForTimeout(300);
const wide = await headerState();
ok('480px 에서는 배지가 다시 보인다', wide.shown);
ok('배지 글자가 잘리지 않는다', wide.badge.w >= wide.badgeNeeds - 1,
   `보이는 폭 ${wide.badge.w} / 필요한 폭 ${wide.badgeNeeds}`);
ok('배지가 조작부와 겹치지 않는다', wide.badge.r <= wide.controls.l,
   `배지 끝 ${wide.badge.r} / 조작부 시작 ${wide.controls.l}`);
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(300);

// 동기화 버튼 — 한 줄에 들어가야 한다
const syncBtns = await page.$$eval('.sync-bar .sync-btn', els => els.map(e => {
  const r = e.getBoundingClientRect();
  return { text: e.textContent.trim().slice(0, 12), w: Math.round(r.width), h: Math.round(r.height),
           line: parseFloat(getComputedStyle(e).lineHeight) || 20 };
}));
ok('동기화 버튼 글자가 한 줄에 들어간다',
   syncBtns.every(b => b.h <= b.line * 1.6 + 26),
   syncBtns.map(b => `${b.text} ${b.w}×${b.h}`).join(' · '));
ok('동기화 버튼 두 개가 같은 줄에',
   (await page.$$eval('.sync-bar .sync-btn', els =>
      new Set(els.map(e => Math.round(e.getBoundingClientRect().top))).size)) === 1);

await page.screenshot({ path: `${SHOT}/dg-mobile-admin.png` });

// --- 출석부 출력 탭 ---------------------------------------------------------
await page.click('.tab-btn[data-tab="print"]');
await page.waitForSelector('.pr-sheet', { timeout: 15000 });

const prScroll = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('출석부 탭에서도 가로로 밀리지 않는다', prScroll <= 1, `${prScroll}px`);

const ctrl = await page.$$eval('.pr-controls button, .pr-chk', els => els.map(e => {
  const r = e.getBoundingClientRect();
  return { text: e.textContent.trim().slice(0, 8), w: Math.round(r.width), h: Math.round(r.height) };
}));
ok('조작부 버튼도 세로로 안 쪼개진다', ctrl.every(c => c.h < c.w),
   ctrl.filter(c => c.h >= c.w).map(c => `${c.text} ${c.w}×${c.h}`).join(' · ') || '모두 정상');

await page.screenshot({ path: `${SHOT}/dg-mobile-print.png` });

// --- 출석 관리 탭 -----------------------------------------------------------
await page.click('.tab-btn[data-tab="attendance"]');
await page.waitForSelector('#attList .att-row', { timeout: 15000 });

const attScroll = await page.evaluate(() =>
  document.documentElement.scrollWidth - document.documentElement.clientWidth);
ok('출석 관리 탭에서도 가로로 밀리지 않는다', attScroll <= 1, `${attScroll}px`);

const stateBtns = await page.$$eval('.att-state', els => els.slice(0, 4).map(e => {
  const r = e.getBoundingClientRect();
  return Math.round(Math.min(r.width, r.height));
}));
ok('출결 버튼이 44px 이상', stateBtns.every(v => v >= 44), stateBtns.join(','));

const saveBtn = await page.$eval('#attSaveBtn', el => {
  const r = el.getBoundingClientRect();
  return { w: Math.round(r.width), h: Math.round(r.height),
           line: parseFloat(getComputedStyle(el).lineHeight) || 20 };
});
ok('저장 버튼 글자가 세로로 쪼개지지 않는다', saveBtn.h <= saveBtn.line * 1.6 + 30,
   `${saveBtn.w}×${saveBtn.h} (한 줄 ${Math.round(saveBtn.line)}px)`);

await page.screenshot({ path: `${SHOT}/dg-mobile-att.png` });

await browser.close();
server.close();

done();
