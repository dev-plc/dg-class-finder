// 안내방 버튼 검증 — 조 방과 부서 방.
//
// 링크는 시트의 DG링크 탭에서 오고, 조 이름으로 찾는다. 이름을 두 사람이
// 각각 손으로 적기 때문에 'o1' 과 'O1' 처럼 어긋나기 쉽다. 어긋나면 버튼이
// 조용히 사라지는데, 오류가 안 나서 아무도 알아채지 못한다.

import { serveRepo, launch, makeReporter } from './lib/harness.mjs';

const PORT = 8089;
const server = await serveRepo(PORT);

const COHORT = 'DG-2026';

const MEMBERS = [
  { id: 'u1', name: '온라인원', phone: '1001', team: 'O1' },
  { id: 'u2', name: '청년원', phone: '1002', team: 'YF1' },   // 조 방 링크가 없다
  { id: 'u3', name: '브이원', phone: '1003', team: 'V1' },    // 부서도 조 방도 없다
  { id: 'u4', name: '온라인장', phone: '1004', team: '온라인' }, // 조 이름이 곧 부서
].map(m => ({ ...m, cohort_id: COHORT, team_no: 1, sheet_row: 1,
              location: '온라인', role: '조원', lunch: 'O', status: 'active', age: 30 }));

// 시트에는 소문자로 적혀 있다. 명단의 조 이름은 대문자다.
const LINKS = [
  { team: 'o1', chat_url: 'https://t.me/o1room' },
  { team: '온라인', chat_url: 'https://t.me/online' },
  { team: '청년부', chat_url: 'https://t.me/young' },
];

const { ok, done } = makeReporter('안내방 버튼');

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 420, height: 900 } });
const page = await context.newPage();
page.on('pageerror', e => console.log('   [pageerror] ' + e.message));

await page.route('**/rest/v1/**', route => {
  const url = new URL(route.request().url());
  const table = url.pathname.split('/').pop();
  let body = [];
  if (table === 'dg_members') {
    body = url.searchParams.get('select') === 'cohort_id' ? [{ cohort_id: COHORT }] : MEMBERS;
  } else if (table === 'dg_team_links') {
    body = LINKS;
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.route('**/script.google.com/**', route =>
  route.fulfill({ status: 200, contentType: 'application/json',
                  body: JSON.stringify({ success: true, data: [], sessions: [] }) }));

await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load' });
await page.waitForFunction(() => !document.getElementById('searchBtn').disabled,
                           null, { timeout: 20000 });

async function lookup(name, phone) {
  await page.fill('#name', name);
  await page.fill('#phone', phone);
  await page.click('#searchBtn');
  await page.waitForTimeout(600);
  return page.evaluate(() => {
    const shown = (el) => !!el && el.offsetParent !== null;
    const row = document.getElementById('telegramRow');
    const team = document.getElementById('resultTelegramLink');
    const group = document.getElementById('resultGroupTelegramLink');
    return {
      row: shown(row),
      team: shown(team) ? { text: document.getElementById('telegramLinkText').textContent.trim(),
                            href: team.getAttribute('href') } : null,
      group: shown(group) ? { text: document.getElementById('groupTelegramLinkText').textContent.trim(),
                              href: group.getAttribute('href') } : null,
    };
  });
}

// --- O1: 시트에 'o1' 로 적혀 있어도 찾아야 한다 ----------------------------
const o1 = await lookup('온라인원', '1001');
ok('대소문자가 달라도 조 방을 찾는다', o1.team?.href === 'https://t.me/o1room',
   JSON.stringify(o1.team));
ok('조 방 버튼에 조 이름을 적는다', o1.team?.text === 'O1조 방 입장하기', o1.team?.text);
ok('O 로 시작하면 온라인 부서 방이 함께 붙는다',
   o1.group?.href === 'https://t.me/online' && /온라인 방/.test(o1.group?.text || ''),
   JSON.stringify(o1.group));

// --- YF1: 조 방 링크가 없어도 부서 방은 보여야 한다 ------------------------
//
// 예전에는 두 버튼이 한 줄에 있고, 조 방 링크가 없으면 그 줄을 통째로 감췄다.
// 그래서 부서 방까지 같이 사라졌다.
const yf1 = await lookup('청년원', '1002');
ok('조 방 링크가 없으면 그 버튼만 감춘다', yf1.team === null, JSON.stringify(yf1.team));
ok('조 방이 없어도 부서 방은 나온다',
   yf1.group?.href === 'https://t.me/young' && /청년부 방/.test(yf1.group?.text || ''),
   JSON.stringify(yf1));
ok('안내방 줄은 살아 있다', yf1.row === true, JSON.stringify(yf1));

// --- V1: 붙일 것이 없으면 줄 자체를 감춘다 --------------------------------
const v1 = await lookup('브이원', '1003');
ok('붙일 링크가 없으면 안내방 줄을 감춘다',
   v1.row === false && !v1.team && !v1.group, JSON.stringify(v1));

// --- '온라인' 조: 자기 자신을 부서로 달지 않는다 ---------------------------
const on = await lookup('온라인장', '1004');
ok('조 이름이 곧 부서면 부서 방을 또 달지 않는다', on.group === null, JSON.stringify(on));
ok('그 조의 방은 그대로 나온다', on.team?.href === 'https://t.me/online',
   JSON.stringify(on.team));

await browser.close();
server.close();

done();
