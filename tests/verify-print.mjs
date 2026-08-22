// 조별 출석부 출력 검증 — 사양서 검증 1~8번.

import { serveRepo, launch, makeReporter, SHOT } from './lib/harness.mjs';

const PORT = 8096;
const server = await serveRepo(PORT);

// --------------------------------------------------------------------------
// 조 인원을 12 / 5 / 25 로 둔다 (줄 높이 계산을 보려는 것)
// 장소는 두 곳 — 하나뿐이면 장소별 묶음이 숨어야 하므로 별도로 확인한다
// --------------------------------------------------------------------------
const COHORT = 'DG-2026';
const TODAY = '2026-08-12';

// Y1(5) < Y2(12) 로 둔다 — 오름차순과 '인원 많은 순' 이 서로 다른 답을 내야
// 정렬 규칙을 실제로 검증할 수 있다.
const SPEC = [
  { team: 'Y1', location: '웨슬리홀', n: 5 },
  { team: 'Y2', location: '웨슬리홀', n: 12 },
  { team: '여1', location: '웨슬리홀', n: 4 },
  { team: 'C1', location: '웨슬리홀', n: 3 },
  { team: '남1', location: '웨슬리홀', n: 2 },
  { team: 'O1', location: '온라인',   n: 25 },
];
let uid = 0;
const MEMBERS = SPEC.flatMap(s => Array.from({ length: s.n }, (_, i) => {
  uid++;
  return {
    id: `u${uid}`, cohort_id: COHORT,
    name: `${s.team}원${String(i + 1).padStart(2, '0')}`, phone: String(1000 + uid),
    team: s.team, location: s.location,
    // 시트 줄 번호. 명단 차례는 **이것**을 따라야 한다 (시트와 같은 순서).
    sheet_row: uid + 5,
    // 'No.' 열은 일부러 어긋나게 둔다 — 예전에는 이 값으로 정렬해서,
    // Y1 은 거꾸로 나오고 여1 의 빈칸인 사람은 명단 끝으로 밀렸다.
    team_no: s.team === 'Y1' ? s.n - i : (s.team === '여1' && i === 1 ? null : i + 1),
    role: i === 0 ? '조장' : '조원', lunch: 'O', status: 'active', age: 30,
  };
}));

// 08/09 는 8월 마지막 수업이 아니고, 08/30 은 8월 마지막 수업이다
const SESSIONS = [
  { session_date: '2026-08-09', label: '08/09', name: '18강' },
  { session_date: '2026-08-16', label: '08/16', name: '19강' },
  { session_date: '2026-08-30', label: '08/30', name: '20강' },
  { session_date: '2026-09-06', label: '09/06', name: '21강' },
];

// 08/16 김밥 신청자 3명 · 19강 과제 제출자 2명 (폼 표기는 '제19강')
const LUNCH = { '2026-08-16': ['u1', 'u2', 'u13'] };
const HOMEWORK = [
  { member_id: 'u1', lecture: '제19강' },
  { member_id: 'u3', lecture: '19 강' },
  { member_id: 'u5', lecture: '18강' },
];

const { ok, done } = makeReporter('출석부 출력');

const browser = await launch();
const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
const page = await context.newPage();

// 브라우저 시계를 고정한다. 관리자 화면은 GAS 를 부르지 않아서 '오늘' 을
// 브라우저에서 읽는다 — 안 고정하면 실제 날짜에 따라 기본 주차가 달라진다.
await page.clock.setFixedTime(new Date('2026-08-12T09:00:00Z'));
const dialogs = [];
page.on('dialog', d => { dialogs.push(d.message()); d.dismiss().catch(() => {}); });
page.on('pageerror', e => console.log('   [pageerror] ' + e.message));

await page.route('**/rest/v1/**', route => {
  const url = new URL(route.request().url());
  const table = url.pathname.split('/').pop();
  let body = [];
  if (table === 'dg_members') {
    body = url.searchParams.get('select') === 'cohort_id' ? [{ cohort_id: COHORT }] : MEMBERS;
  } else if (table === 'dg_sessions') {
    body = SESSIONS;
  } else if (table === 'dg_lunch') {
    const d = (url.searchParams.get('session_date') || '').replace('eq.', '');
    body = (LUNCH[d] || []).map(id => ({ member_id: id }));
  } else if (table === 'dg_homework') {
    body = HOMEWORK;
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});
await page.route('**/script.google.com/**', route =>
  route.fulfill({ status: 200, contentType: 'application/json',
                  body: JSON.stringify({ success: true, today: TODAY }) }));

await page.addInitScript(() => sessionStorage.setItem('adminLoggedIn', '1'));
await page.goto(`http://localhost:${PORT}/admin.html`, { waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });

await page.click('.tab-btn[data-tab="print"]');
await page.waitForSelector('.pr-sheet', { timeout: 15000 });

// --- 범위 선택 -------------------------------------------------------------
const sheets = await page.$$eval('.pr-sheet', els => els.length);
ok('조마다 한 장', sheets === 6, `${sheets}장`);

const prOpts = await page.$$eval('#prSessionPicker option', els => els.map(e => e.value));
ok('주차 목록이 오름차순',
   prOpts.join(',') === '2026-08-09,2026-08-16,2026-08-30,2026-09-06', prOpts.join(','));
// 오늘 08/12 기준 08/09(3일 전) · 08/16(4일 뒤) → 08/09
ok('기본 주차 = 오늘과 가장 가까운 회차',
   (await page.$eval('#prSessionPicker', el => el.value)) === '2026-08-09',
   await page.$eval('#prSessionPicker', el => el.value));

const groups = await page.$$eval('#prScopePicker optgroup', els => els.map(e => e.label));
ok('장소가 둘이면 장소별 묶음이 나온다', groups.includes('장소별'), groups.join(','));

// --- 검증 7: 인원별 줄 높이 -----------------------------------------------
const heights = await page.$$eval('.pr-sheet', els => els.map(e => ({
  team: e.dataset.team,
  row: e.querySelector('.pr-page').style.getPropertyValue('--pr-row'),
  note: e.querySelector('.pr-page').style.getPropertyValue('--pr-note'),
  rows: e.querySelectorAll('tbody tr').length,
})));
const hOf = (t) => heights.find(h => h.team === t);
ok('7. 12명 → 18.1mm', hOf('Y2').row === '18.1mm', hOf('Y2').row);
ok('7. 25명 → 8.7mm', hOf('O1').row === '8.7mm', hOf('O1').row);
ok('7. 5명은 상한 22mm 로 묶인다 (빈 상자 방지)', hOf('Y1').row === '22mm', hOf('Y1').row);

// 특이사항 칸까지 더해 A4 를 채우는지 본다 (넘치면 빈 종이가 한 장 더 나온다)
const fill = heights.map(h => {
  // 표 + 사이 여백 3mm + 특이사항 상자
  const used = parseFloat(h.row) * h.rows + 3 + parseFloat(h.note);
  return { team: h.team, used: Math.round(used * 10) / 10, pct: Math.round((used / 233) * 100) };
});
ok('   12명·25명은 A4 를 꽉 채운다',
   fill.find(f => f.team === 'Y2').pct === 100 && fill.find(f => f.team === 'O1').pct === 100,
   fill.map(f => `${f.team} ${f.used}mm ${f.pct}%`).join(' · '));
ok('   어느 조도 A4 를 넘지 않는다', fill.every(f => f.used <= 233),
   fill.map(f => `${f.team} ${f.used}mm`).join(' · '));

// --- 맨 아래 특이사항 칸 ---------------------------------------------------
const noteBox = await page.$eval('.pr-sheet[data-team="Y2"] .pr-note', el => {
  const page = el.closest('.pr-page');
  const table = page.querySelector('.pr-table-wrap');
  const r = el.getBoundingClientRect(), t = table.getBoundingClientRect();
  return {
    label: el.querySelector('.pr-note-label')?.textContent.trim() || '',
    // 라벨 말고는 비어 있어야 한다 (손으로 적는 자리)
    onlyLabel: el.children.length === 1,
    insideTable: !!el.closest('table'),
    belowTable: Math.round(r.top - t.bottom),
    sameWidth: Math.abs(r.width - t.width) <= 1,
  };
});
ok('특이사항 상자가 있다', noteBox.label === '특이사항', noteBox.label);
ok('특이사항은 표 밖 상자다 (사람마다 적는 칸으로 안 읽히게)', !noteBox.insideTable);
ok('특이사항이 표 아래에 붙는다', noteBox.belowTable >= 8 && noteBox.belowTable <= 16,
   `${noteBox.belowTable}px`);
ok('특이사항 상자 폭 = 표 폭', noteBox.sameWidth);
ok('특이사항 안은 비어 있다', noteBox.onlyLabel);

ok('12명 조의 특이사항 상자 = 12.8mm', hOf('Y2').note === '12.8mm', hOf('Y2').note);
ok('5명 조는 특이사항 상자가 넉넉하다 (상한 40mm)', hOf('Y1').note === '40mm', hOf('Y1').note);

// --- 검증 1: 칸을 껐다 켜도 다른 칸 폭이 그대로인가 ------------------------
const widthsOf = () => page.$eval('.pr-sheet[data-team="Y1"] .pr-table',
  t => [...t.querySelectorAll('thead th')].map(th => ({
    cls: th.className, w: Math.round(th.getBoundingClientRect().width),
  })));

const w0 = await widthsOf();
await page.uncheck('#prColMemo');
await page.waitForTimeout(200);
const w1 = await widthsOf();

const same = (a, b, cls) => {
  const x = a.find(v => v.cls === cls), y = b.find(v => v.cls === cls);
  return x && y && Math.abs(x.w - y.w) <= 1;
};
ok('1. 메모를 꺼도 이름 칸 폭이 그대로', same(w0, w1, 'pr-name'),
   `${w0.find(v => v.cls === 'pr-name')?.w} → ${w1.find(v => v.cls === 'pr-name')?.w}`);
ok('1. 메모를 꺼도 체크 칸 폭이 그대로', same(w0, w1, 'pr-c-mark'),
   `${w0.find(v => v.cls === 'pr-c-mark')?.w} → ${w1.find(v => v.cls === 'pr-c-mark')?.w}`);
ok('1. 대신 테두리 없는 채움 칸이 들어간다',
   w1.some(v => v.cls === 'pr-c-fill'), w1.map(v => v.cls).join(','));

const noteWidthOk = await page.$eval('.pr-sheet[data-team="Y1"] .pr-note', el => {
  const t = el.closest('.pr-page').querySelector('.pr-table-wrap');
  return Math.abs(el.getBoundingClientRect().width - t.getBoundingClientRect().width) <= 1;
});
ok('1. 칸을 꺼도 특이사항 상자 폭이 표와 같다', noteWidthOk);
await page.check('#prColMemo');
await page.waitForTimeout(200);

// --- 데이터가 실린 칸 ------------------------------------------------------
await page.selectOption('#prSessionPicker', '2026-08-16');
await page.waitForTimeout(600);

const y1 = await page.$eval('.pr-sheet[data-team="Y1"]', el => ({
  sub: el.querySelector('.pr-sub').textContent.trim(),
  rows: [...el.querySelectorAll('tbody tr')].map(tr =>
    [...tr.querySelectorAll('td')].map(td => td.textContent.trim())),
}));
ok('김밥 신청자에게 O', y1.rows[0][2] === 'O' && y1.rows[1][2] === 'O' && y1.rows[2][2] === '',
   y1.rows.slice(0, 3).map(r => r[2] || '·').join(','));
ok('머리말에 김밥 인원이 나온다', /김밥 2명/.test(y1.sub), y1.sub);
ok("폼 표기 '제19강' 도 과제 ✓ 로", y1.rows[0][4] === '✓', JSON.stringify(y1.rows[0]));
ok("'19 강' 도 같은 회차로 인식", y1.rows[2][4] === '✓', JSON.stringify(y1.rows[2]));
ok('다른 강의 과제는 안 붙는다', y1.rows[4][4] === '', JSON.stringify(y1.rows[4]));
ok('출석 칸은 비어 있다 (현장에서 손으로)', y1.rows[0][3] === '', JSON.stringify(y1.rows[0]));

// --- 이름 칸: 직책 표시 · 가운데정렬 --------------------------------------
const nameCells = await page.$$eval('.pr-sheet[data-team="Y1"] tbody .pr-name', els =>
  els.map(e => ({
    nm: e.querySelector('.pr-nm')?.textContent.trim() || '',
    role: e.querySelector('.pr-role')?.textContent.trim() || '',
    align: getComputedStyle(e).textAlign,
    roleBlock: e.querySelector('.pr-role')
      ? getComputedStyle(e.querySelector('.pr-role')).display : '',
  })));

ok('조장은 이름 아래 직책이 붙는다', nameCells[0].role === '조장',
   `${nameCells[0].nm} / ${nameCells[0].role || '(없음)'}`);
ok('조장 표시가 이름 아래 줄로', nameCells[0].roleBlock === 'block', nameCells[0].roleBlock);
// --- 명단 차례가 시트와 같은가 --------------------------------------------
//
// 종이 출석부와 시트를 나란히 놓고 짚어 가며 대조하는 것이 주 용도다.
// 순서가 다르면 한 사람을 찾을 때마다 명단을 훑게 되고, 그러다 옆줄에 체크한다.
// 이 조들은 'No.' 열이 거꾸로거나 비어 있다 — 그래도 시트 줄 차례로 나와야 한다.
const orderOf = (team) => page.$$eval(`.pr-sheet[data-team="${team}"] tbody .pr-nm`,
  els => els.map(e => e.textContent.trim().replace(/\d{4}$/, '')));

const y1Order = await orderOf('Y1');
ok('No. 가 거꾸로여도 시트 줄 차례로 나온다',
   y1Order.join(',') === 'Y1원01,Y1원02,Y1원03,Y1원04,Y1원05', y1Order.join(' → '));

const yeoOrder = await orderOf('여1');
ok('No. 가 빈 사람도 제자리 (끝으로 밀리지 않는다)',
   yeoOrder.join(',') === '여1원01,여1원02,여1원03,여1원04', yeoOrder.join(' → '));

const noCol = await page.$$eval('.pr-sheet[data-team="Y1"] tbody .pr-c-no',
  els => els.map(e => e.textContent.trim()));
ok('번호 칸은 종이에서 1부터 다시 매긴다', noCol.join(',') === '1,2,3,4,5', noCol.join(','));

ok('조원은 직책을 적지 않는다', nameCells.slice(1).every(c => c.role === ''),
   nameCells.slice(1).map(c => c.role || '·').join(','));
ok('이름 칸이 가운데정렬', nameCells.every(c => c.align === 'center'),
   [...new Set(nameCells.map(c => c.align))].join(','));

const headAlign = await page.$eval('.pr-sheet[data-team="Y1"] thead .pr-name',
  el => getComputedStyle(el).textAlign);
ok('이름 머리글도 가운데정렬', headAlign === 'center', headAlign);

// --- 디자인: 파란 계열 · 줄무늬 · 둥근 모서리 -----------------------------
const design = await page.evaluate(() => {
  const sheet = document.querySelector('.pr-sheet[data-team="Y2"]');
  const cs = (el) => getComputedStyle(el);
  const rows = [...sheet.querySelectorAll('tbody tr')];
  return {
    title: cs(sheet.querySelector('.pr-title')).color,
    th: cs(sheet.querySelector('thead th')).backgroundColor,
    thColor: cs(sheet.querySelector('thead th')).color,
    name: cs(sheet.querySelector('.pr-nm')).color,
    border: cs(sheet.querySelector('tbody td')).borderTopColor,
    odd: cs(rows[0].querySelector('td')).backgroundColor,
    even: cs(rows[1].querySelector('td')).backgroundColor,
    radius: cs(sheet.querySelector('.pr-table-wrap')).borderRadius,
    noteRadius: cs(sheet.querySelector('.pr-note')).borderRadius,
  };
});
const INK = 'rgb(27, 59, 111)';
ok('제목·이름·머리글이 파란 계열',
   design.title === INK && design.name === INK && design.thColor === INK,
   `title=${design.title} name=${design.name} th=${design.thColor}`);
ok('표 머리글 배경이 옅은 파랑', design.th === 'rgb(237, 242, 250)', design.th);
ok('테두리가 옅은 파랑', design.border === 'rgb(195, 208, 230)', design.border);
ok('한 줄 걸러 옅은 줄무늬', design.odd !== design.even,
   `홀 ${design.odd} / 짝 ${design.even}`);
ok('표·특이사항 모서리가 둥글다',
   parseFloat(design.radius) > 0 && parseFloat(design.noteRadius) > 0,
   `${design.radius} / ${design.noteRadius}`);

// --- 검증 2·3: 월 마지막 수업이면 김밥신청 자동 켬 -------------------------
let lr = await page.$eval('#prColLunchReq', el => el.checked);
ok('2. 월 마지막 수업이 아니면 김밥신청 꺼짐 (08/16)', lr === false, String(lr));

await page.selectOption('#prSessionPicker', '2026-08-30');
await page.waitForTimeout(600);
lr = await page.$eval('#prColLunchReq', el => el.checked);
ok('2. 월 마지막 수업이면 자동으로 켜진다 (08/30)', lr === true, String(lr));

// 사람이 끄면 그 뜻을 존중한다 — 주차를 바꿔도 되돌리지 않는다
await page.uncheck('#prColLunchReq');
await page.waitForTimeout(200);
await page.selectOption('#prSessionPicker', '2026-09-06');
await page.waitForTimeout(600);
lr = await page.$eval('#prColLunchReq', el => el.checked);
ok('3. 사람이 끄면 주차를 바꿔도 꺼진 채로', lr === false, String(lr));

// --- 검증 5: 장을 빼고 인쇄 -----------------------------------------------
await page.uncheck('.pr-sheet[data-team="Y2"] .pr-pick input');
await page.waitForTimeout(200);

const skipped = await page.$eval('.pr-sheet[data-team="Y2"]', el => el.classList.contains('pr-skip'));
ok('5. 뺀 장이 표시된다', skipped);
const cnt = await page.$eval('#prCount', el => el.textContent.trim());
ok('5. 몇 장이 나가는지 보여준다', cnt === '6장 중 5장 출력', cnt);

// 체크를 눌러도 다시 그리지 않는다 (다른 장의 체크가 초기화되면 안 된다)
const stillChecked = await page.$$eval('.pr-pick input', els => els.filter(e => e.checked).length);
ok('   다른 장의 체크는 그대로', stillChecked === 5, `${stillChecked}개`);

await page.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
await page.click('#prPrintBtn');
await page.waitForTimeout(300);
ok('5. 인쇄가 호출된다', await page.evaluate(() => window.__printed) === 1);

// 장 나누기는 CSS 가 한다 — 버튼을 거쳐야만 맞는 규칙은 규칙이 아니다.
// (Ctrl+P 로 인쇄하면 그 표시가 없어서 빈 종이가 딸려 나왔다)
ok('5. 인쇄 버튼이 장에 표시를 달지 않는다',
   await page.$$eval('.pr-last', els => els.length) === 0);

// --- 조작부 — 한 줄에 담고, 버튼은 지금 할 일을 말한다 --------------------
//
// 조작부가 화면 위에 붙어 있어서 줄이 하나 늘 때마다 아래 출석부가 그만큼 가려진다.
const bar = await page.evaluate(() => {
  const rows = [...document.querySelectorAll('.pr-controls .pr-row')];
  const tops = rows.map(r => Math.round(r.getBoundingClientRect().top));
  return {
    rows: rows.length,
    lines: new Set(tops).size,
    height: Math.round(document.querySelector('.pr-controls').getBoundingClientRect().height),
    labels: [...document.querySelectorAll('.pr-group-label')].map(e => e.textContent.trim()),
    cols: [...document.querySelectorAll('.pr-chk')].map(e => e.textContent.trim()),
  };
});
ok('조작부는 두 줄', bar.rows === 2, `${bar.rows}줄`);
ok('넓은 화면에서 출력·항목이 한 줄에', bar.lines === 2, `${bar.lines}단`);
ok('조작부가 화면을 덜 먹는다 (200px 이내)', bar.height <= 200, `${bar.height}px`);
// 손이 가는 차례 — 칸을 고르고(항목) 낼 장을 고르고(출력) 인쇄.
// 인쇄가 윗줄에 있으면 장을 고른 자리에서 눈과 손이 한 번 되돌아간다.
ok('묶음 이름은 항목 · 출력', bar.labels.join(',') === '항목,출력', bar.labels.join(','));
const flow = await page.evaluate(() => {
  const x = (sel) => Math.round(document.querySelector(sel).getBoundingClientRect().left);
  return {
    cols: x('.pr-cols'), out: x('.pr-out'), print: x('#prPrintBtn'),
    pick: x('#prPickToggleBtn'),
    sameRow: Math.abs(document.querySelector('#prPickToggleBtn').getBoundingClientRect().top
                    - document.querySelector('#prPrintBtn').getBoundingClientRect().top) < 12,
  };
});
ok('항목이 왼쪽, 출력이 오른쪽', flow.cols < flow.out, `${flow.cols} < ${flow.out}`);
ok('인쇄는 출력 묶음 안, 맨 오른쪽', flow.print > flow.pick, `${flow.pick} → ${flow.print}`);
ok('장을 고른 그 줄에서 바로 누른다', flow.sameRow);
ok('집계표 이름이 짧아졌다', bar.cols.includes('집계표') && !bar.cols.some(c => c.includes('조별 집계표')),
   bar.cols.join(' | '));

// 전체 선택·해제가 한 버튼이다 — 지금 상태의 반대쪽 일을 한다
const toggleText = () => page.$eval('#prAllToggleBtn', el => el.textContent.trim());
// 앞 검증에서 한 장을 빼 둔 상태다. 먼저 전부 켜고 시작한다.
if (await toggleText() === '전체 선택') {
  await page.click('#prAllToggleBtn');
  await page.waitForTimeout(200);
}
ok('전부 켜져 있으면 전체 해제', await toggleText() === '전체 해제', await toggleText());
await page.uncheck('.pr-sheet[data-team="Y2"] .pr-pick input');
await page.waitForTimeout(200);
ok('하나라도 빠지면 전체 선택', await toggleText() === '전체 선택', await toggleText());
await page.click('#prAllToggleBtn');
await page.waitForTimeout(200);
ok('누르면 전부 켜진다',
   await page.$$eval('.pr-sheet', els => els.every(e => !e.classList.contains('pr-skip'))));
ok('그러면 다시 전체 해제로', await toggleText() === '전체 해제', await toggleText());

// --- 검증 6: 전부 끄고 인쇄 -> 막히는가 ------------------------------------
dialogs.length = 0;
await page.click('#prAllToggleBtn');   // 전부 켜져 있으니 → 전체 해제
await page.waitForTimeout(200);
await page.click('#prPrintBtn');
await page.waitForTimeout(300);
ok('6. 전부 끄면 인쇄가 막힌다', dialogs.some(d => /출력할 장이 없습니다/.test(d)),
   dialogs.join(' | '));
ok('6. 막힐 때는 인쇄를 부르지 않는다', await page.evaluate(() => window.__printed) === 1);

await page.click('#prAllToggleBtn');   // 전부 꺼져 있으니 → 전체 선택
await page.waitForTimeout(200);

// --- 검증 4: 인쇄 미리보기(음영 유지) --------------------------------------
await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(300);

const printState = await page.evaluate(() => {
  const th = document.querySelector('.pr-table thead th');
  const st = getComputedStyle(document.querySelector('.pr-page'));
  return {
    thBg: getComputedStyle(th).backgroundColor,
    colorAdjust: st.printColorAdjust || st.webkitPrintColorAdjust || '',
    controlsHidden: getComputedStyle(document.querySelector('.pr-controls')).display === 'none',
    pickHidden: getComputedStyle(document.querySelector('.pr-pick')).display === 'none',
    navHidden: getComputedStyle(document.querySelector('.tab-nav')).display === 'none',
  };
});
ok('4. 인쇄에서도 표 머리글 음영이 남는다', printState.colorAdjust === 'exact', printState.colorAdjust);
ok('4. 머리글 배경이 투명이 아니다', !/rgba\(0, 0, 0, 0\)/.test(printState.thBg), printState.thBg);
ok('4. 조작부·체크·탭은 인쇄되지 않는다',
   printState.controlsHidden && printState.pickHidden && printState.navHidden,
   JSON.stringify(printState));
await page.emulateMedia({ media: 'screen' });

// --- 검증 8: 좁은 화면에서 출력 체크가 잘리지 않는가 -----------------------
await page.setViewportSize({ width: 390, height: 800 });
await page.waitForTimeout(400);
const clipped = await page.evaluate(() => {
  const pick = document.querySelector('.pr-pick');
  const prev = document.querySelector('.pr-preview');
  const p = pick.getBoundingClientRect(), c = prev.getBoundingClientRect();
  return { left: Math.round(p.left - c.left), top: Math.round(p.top - c.top), w: Math.round(p.width) };
});
ok('8. 좁은 화면에서도 출력 체크가 상자 안에 있다',
   clipped.left >= 0 && clipped.w > 40, JSON.stringify(clipped));
await page.setViewportSize({ width: 1100, height: 900 });

// --- 조별 집계표 -----------------------------------------------------------
await page.check('#prColSummary');
await page.waitForTimeout(300);
const summaries = await page.$$eval('.pr-sheet[data-team^="__summary__"]', els => els.map(el => ({
  team: el.dataset.team,
  title: el.querySelector('.pr-title').textContent.trim(),
  sub: el.querySelector('.pr-sub').textContent.trim(),
  heads: [...el.querySelectorAll('thead th')].map(th => th.textContent.trim()),
  rows: [...el.querySelectorAll('tbody tr')].map(tr =>
    [...tr.querySelectorAll('td')].map(td => td.textContent.trim())),
  cells: [...el.querySelectorAll('.pr-total td')].map(td => td.textContent.trim()),
  index: [...el.parentElement.children].indexOf(el),
})));

ok('집계표는 전체 + 장소별', summaries.length === 3,
   summaries.map(s => s.title).join(' | '));
ok('전체가 맨 앞, 그 뒤로 장소별',
   summaries[0].title === '조별 집계표 · 전체'
   && summaries.every((s, i) => s.index === i),
   summaries.map(s => `${s.index}:${s.title}`).join(' | '));

const firstTeamSheet = await page.$eval('.pr-preview',
  el => [...el.children].findIndex(c => !c.dataset.team.startsWith('__summary__')));
ok('조별 출석부는 집계표 다음', firstTeamSheet === 3, `${firstTeamSheet}번째`);

// 표 안의 조는 이름 순 — Y · C · 남 · 여 · O
ok('집계표 안은 조 이름 순 (Y·C·남·여)',
   summaries[0].rows.map(r => r[1]).join(',') === 'Y1,Y2,C1,남1,여1,O1',
   summaries[0].rows.map(r => r[1]).join(','));

const wesRows = summaries.find(s => /웨슬리홀/.test(s.title)).rows.map(r => r[1]);
ok('장소별 집계표도 조 이름 순 (인원과 무관)',
   wesRows.join(',') === 'Y1,Y2,C1,남1,여1', wesRows.join(','));

// 장 순서는 인원 많은 장소부터 — 온라인(25) > 웨슬리홀(26)? 아니, 웨슬리홀 26 > 온라인 25
ok('장 순서가 인원 많은 장소부터',
   /웨슬리홀/.test(summaries[1].title) && /온라인/.test(summaries[2].title),
   `${summaries[1].title}(${summaries[1].sub}) → ${summaries[2].title}(${summaries[2].sub})`);

// 집계표에서 과제를 뺐다고 조별 출석부의 과제 칸까지 사라지면 안 된다
const rosterHeads = await page.$$eval('.pr-sheet[data-team="Y1"] thead th',
  els => els.map(e => e.textContent.trim()));
ok('조별 출석부의 과제 칸은 그대로', rosterHeads.includes('과제'), rosterHeads.join(','));

// 조별 출석부는 조 번호 순 그대로다 (기준이 다른 건 의도한 것)
const sheetOrder = await page.$$eval('.pr-sheet:not([data-team^="__summary__"])',
  els => els.map(e => e.dataset.team));
ok('조별 출석부도 같은 조 이름 순',
   sheetOrder.join(',') === 'Y1,Y2,C1,남1,여1,O1', sheetOrder.join(','));

// 집계표는 조 · (장소) · 인원 · 김밥 만 남긴다
ok('집계표에 출석·과제 칸이 없다',
   ['출석', '과제'].every(h => !summaries[0].heads.filter(Boolean).includes(h)),
   summaries[0].heads.join(','));
ok('집계표 열은 No.·조·장소·인원·김밥·메모',
   summaries[0].heads.filter(Boolean).join(',') === 'No.,조,장소,인원,김밥,메모',
   summaries[0].heads.join(','));
ok('장소별 집계표 열은 No.·조·인원·김밥·메모',
   summaries[1].heads.filter(Boolean).join(',') === 'No.,조,인원,김밥,메모',
   summaries[1].heads.join(','));

// 번호는 1부터 차례대로
const nos = await page.$$eval('.pr-sheet[data-team="__summary__:__all__"] tbody .pr-c-no',
  els => els.map(e => e.textContent.trim()));
ok('조 앞에 1부터 번호가 붙는다',
   nos.join(',') === nos.map((_, i) => String(i + 1)).join(','), nos.join(','));
const totalNo = await page.$eval('.pr-sheet[data-team="__summary__:__all__"] .pr-total .pr-c-no',
  el => el.textContent.trim());
ok('합계 줄에는 번호를 붙이지 않는다', totalNo === '', `"${totalNo}"`);

// 메모 칸은 손으로 적는 자리라 비어 있어야 한다
ok('집계표 메모 칸은 비어 있다',
   await page.$$eval('.pr-sheet[data-team="__summary__:__all__"] tbody .pr-c-memo',
     els => els.length > 0 && els.every(e => e.textContent.trim() === '')));

// 집계표는 머리글·본문·합계 어디든 모든 칸이 가운데정렬
const aligns = await page.evaluate(() => {
  const sheet = document.querySelector('.pr-sheet[data-team="__summary__:__all__"]');
  const out = {};
  for (const cell of sheet.querySelectorAll('th, td')) {
    const key = [...cell.classList].join('.') || '(무클래스)';
    const a = getComputedStyle(cell).textAlign;
    (out[key] ||= new Set()).add(a);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].join('/')]));
});
ok('집계표 모든 칸이 가운데정렬',
   Object.values(aligns).every(a => a === 'center'),
   Object.entries(aligns).map(([k, v]) => `${k}=${v}`).join(' · '));

ok('전체 장에는 장소 열이 있다', summaries[0].heads.includes('장소'),
   summaries[0].heads.join(','));
ok('장소별 장에는 장소 열이 없다', !summaries[1].heads.includes('장소'),
   summaries[1].heads.join(','));

// 숫자 칸이 벌어지지 않게 조 이름 칸이 남는 폭을 먹는다
const sumW = await page.$$eval('.pr-sheet[data-team="__summary__:__all__"] thead th',
  els => els.map(e => ({ cls: e.className, w: Math.round(e.getBoundingClientRect().width) })));
// 집계표는 A4 폭을 채워야 한다 (칸이 넷뿐이라 px 로 두면 왼쪽에만 몰린다)
const sumFill = await page.evaluate(() => {
  const check = (sel) => {
    const t = document.querySelector(`${sel} .pr-table`);
    const wrap = document.querySelector(`${sel} .pr-table-wrap`);
    return Math.round(t.getBoundingClientRect().width)
         - Math.round(wrap.getBoundingClientRect().width);
  };
  return {
    all: check('.pr-sheet[data-team="__summary__:__all__"]'),
    loc: check('.pr-sheet[data-team="__summary__:온라인"]'),
    roster: check('.pr-sheet[data-team="Y1"]'),
  };
});
ok('전체 집계표가 A4 폭을 채운다', Math.abs(sumFill.all) <= 1, `${sumFill.all}px 차이`);
ok('장소별 집계표도 A4 폭을 채운다', Math.abs(sumFill.loc) <= 1, `${sumFill.loc}px 차이`);
ok('조별 출석부 폭은 그대로', Math.abs(sumFill.roster) <= 1, `${sumFill.roster}px 차이`);

const totalPct = sumW.reduce((n, c) => n + c.w, 0);
const wrapW = await page.$eval('.pr-sheet[data-team="__summary__:__all__"] .pr-table-wrap',
  el => Math.round(el.getBoundingClientRect().width));
ok('집계표 칸들이 폭을 나눠 갖는다', Math.abs(totalPct - wrapW) <= 2,
   sumW.map(c => `${c.cls} ${c.w}`).join(' · '));
// 조별 출석부용 px 폭(34px)이 집계표까지 먹으면 안 된다 — CSS 순서 문제였다
ok('집계표 숫자 칸도 비율 폭을 쓴다',
   sumW.filter(c => c.cls === 'pr-c-mark').every(c => c.w > 50),
   sumW.filter(c => c.cls === 'pr-c-mark').map(c => c.w).join(','));
ok('채움 칸은 더 이상 없다', !sumW.some(c => c.cls === 'pr-c-fill'),
   sumW.map(c => c.cls).join(','));



ok('전체 합계 = 51명', summaries[0].cells[3] === '51', summaries[0].cells.join(' | '));
ok('합계 줄도 같은 칸 수', summaries[0].cells.length === 6,
   `${summaries[0].cells.length}칸: ${summaries[0].cells.join(' | ')}`);

const totalH = await page.$eval('.pr-sheet[data-team="__summary__:__all__"]', el => {
  const body = el.querySelector('tbody td').getBoundingClientRect().height;
  const total = el.querySelector('.pr-total td').getBoundingClientRect().height;
  return { body: Math.round(body), total: Math.round(total) };
});
ok('합계 줄 높이 = 본문 줄 높이', Math.abs(totalH.total - totalH.body) <= 1,
   `본문 ${totalH.body}px / 합계 ${totalH.total}px`);
const wes = summaries.find(s => /웨슬리홀/.test(s.title));
const onl = summaries.find(s => /온라인/.test(s.title));
ok('웨슬리홀 합계 = 5+12+4+3+2 = 26명', wes.cells[2] === '26', wes.cells.join(' | '));
ok('온라인 합계 = 25명', onl.cells[2] === '25', onl.cells.join(' | '));
ok('장소별 조 수가 머리말에 나온다', /5개 조/.test(wes.sub) && /1개 조/.test(onl.sub),
   `${wes.sub} | ${onl.sub}`);

await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(300);
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${SHOT}/dg-print-summary.png` });
await page.emulateMedia({ media: 'screen' });

// 조·장소를 고르면 거르지 않고 그 장으로 옮겨 간다.
//
// 예전에는 그 조만 남겨서, 한 조짜리 집계표(볼 이유가 없다)만 남고 앞뒤 장을
// 견줄 수가 없었다.
const sheetsBefore = await page.$$eval('.pr-sheet', els => els.length);
await page.selectOption('#prScopePicker', 'loc:온라인');
await page.waitForTimeout(900);
const afterLoc = await page.evaluate(() => ({
  sheets: document.querySelectorAll('.pr-sheet').length,
  jumped: document.querySelector('.pr-sheet.pr-jumped')?.dataset.team || '',
  scrolled: window.scrollY,
}));
ok('장소를 골라도 장이 줄지 않는다', afterLoc.sheets === sheetsBefore,
   `${sheetsBefore} → ${afterLoc.sheets}장`);
ok('그 장소의 집계표로 옮겨 간다', afterLoc.jumped === '__summary__:온라인', afterLoc.jumped);
ok('실제로 스크롤이 내려간다', afterLoc.scrolled > 0, `${afterLoc.scrolled}px`);

await page.selectOption('#prScopePicker', 'team:O1');
await page.waitForTimeout(900);
const afterTeam = await page.evaluate(() => ({
  sheets: document.querySelectorAll('.pr-sheet').length,
  jumped: document.querySelector('.pr-sheet.pr-jumped')?.dataset.team || '',
  top: Math.round(document.querySelector('.pr-sheet[data-team="O1"]').getBoundingClientRect().top),
}));
ok('조를 골라도 장이 줄지 않는다', afterTeam.sheets === sheetsBefore, `${afterTeam.sheets}장`);
ok('그 조의 장으로 옮겨 간다', afterTeam.jumped === 'O1', afterTeam.jumped);
// 조작부가 화면 위에 붙어 있다. 그 아래로 내려와야 머리말이 보인다.
ok('조작부에 가리지 않는 자리에 선다', afterTeam.top > 0 && afterTeam.top < 400,
   `${afterTeam.top}px`);

await page.selectOption('#prScopePicker', 'all');
await page.waitForTimeout(900);
ok('전체를 고르면 맨 위로', await page.evaluate(() => window.scrollY) === 0,
   `${await page.evaluate(() => window.scrollY)}px`);

const pad = await page.$eval('.pr-page', el => getComputedStyle(el).padding);
ok('종이에 안쪽 여백이 있다', /^(?!0px)/.test(pad) && parseFloat(pad) > 5, pad);
const tableInset = await page.evaluate(() => {
  const page = document.querySelector('.pr-page');
  const t = page.querySelector('.pr-table');
  return Math.round(t.getBoundingClientRect().left - page.getBoundingClientRect().left);
});
ok('표가 종이 끝에 붙지 않는다', tableInset >= 10, `${tableInset}px`);

await page.uncheck('#prColSummary');
await page.selectOption('#prSessionPicker', '2026-08-16');
await page.waitForTimeout(600);
await page.evaluate(() => {
  // Y1(12명) 장이 머리말부터 보이게
  document.querySelector('.pr-sheet[data-team="Y1"]').scrollIntoView();
  window.scrollBy(0, -150);
});
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOT}/dg-print.png` });

// --- 표시할 칸 기억 --------------------------------------------------------
// 과제를 끄고 메모도 끈 뒤 화면을 새로 연다.
await page.uncheck('#prColHw');
await page.uncheck('#prColMemo');
await page.check('#prColSummary');
// 김밥신청은 그 달 마지막 수업이 아닌 주차에서 일부러 켜 둔다.
await page.selectOption('#prSessionPicker', '2026-08-16');
await page.waitForTimeout(400);
await page.check('#prColLunchReq');
await page.waitForTimeout(300);

const before = await page.evaluate(() => ({
  hw: document.getElementById('prColHw').checked,
  memo: document.getElementById('prColMemo').checked,
  summary: document.getElementById('prColSummary').checked,
  lunchReq: document.getElementById('prColLunchReq').checked,
}));
ok('끄고 켠 상태가 화면에 반영된다',
   !before.hw && !before.memo && before.summary && before.lunchReq, JSON.stringify(before));

await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });
await page.click('.tab-btn[data-tab="print"]');
await page.waitForSelector('.pr-sheet', { timeout: 15000 });

const after = await page.evaluate(() => ({
  lunch: document.getElementById('prColLunch').checked,
  hw: document.getElementById('prColHw').checked,
  memo: document.getElementById('prColMemo').checked,
  summary: document.getElementById('prColSummary').checked,
  lunchReq: document.getElementById('prColLunchReq').checked,
  session: document.getElementById('prSessionPicker').value,
}));
ok('새로 열어도 과제·메모·집계표 체크를 기억한다',
   !after.hw && !after.memo && after.summary, JSON.stringify(after));
ok('김밥 현황은 켠 채로 기억한다', after.lunch, String(after.lunch));
// 기본 주차(08/09)는 8월 마지막 수업이 아니므로 자동 판단은 '꺼짐'.
// 아까 손으로 켠 것을 영구히 기억했다면 여기서 켜져 있을 것이다.
ok('김밥신청은 기억하지 않고 자동 판단으로 돌아간다',
   after.session === '2026-08-09' && after.lunchReq === false,
   `주차 ${after.session} / 김밥신청 ${after.lunchReq}`);

// 자동 판단이 여전히 살아 있는가
await page.selectOption('#prSessionPicker', '2026-08-30');
await page.waitForTimeout(500);
ok('기억을 되살린 뒤에도 월 마지막 수업이면 김밥신청이 켜진다',
   await page.$eval('#prColLunchReq', el => el.checked));

// 기억한 값이 표에도 실제로 반영되는가
const heads2 = await page.$$eval('.pr-sheet[data-team="Y2"] thead th',
  els => els.map(e => e.textContent.trim()));
ok('기억한 대로 과제·메모 칸이 빠져 있다',
   !heads2.includes('과제') && !heads2.includes('메모'), heads2.join(','));

// --- 출력 대상(뺀 조) 기억 -------------------------------------------------
await page.uncheck('.pr-sheet[data-team="Y1"] .pr-pick input');
await page.waitForTimeout(200);
const cnt1 = await page.$eval('#prCount', el => el.textContent.trim());

// 주차를 바꿔도 뺀 조가 풀리면 안 된다
await page.selectOption('#prSessionPicker', '2026-09-06');
await page.waitForTimeout(600);
const keptOnSession = await page.$eval('.pr-sheet[data-team="Y1"] .pr-pick input', el => el.checked);
ok('주차를 바꿔도 뺀 조가 그대로', keptOnSession === false, `checked=${keptOnSession}`);

// 옮겨 다녀도 마찬가지 (Y1 은 웨슬리홀)
await page.selectOption('#prScopePicker', 'loc:웨슬리홀');
await page.waitForTimeout(700);
const keptOnScope = await page.$eval('.pr-sheet[data-team="Y1"] .pr-pick input', el => el.checked);
ok('옮겨 다녀도 뺀 조가 그대로', keptOnScope === false, `checked=${keptOnScope}`);
await page.selectOption('#prScopePicker', 'all');
await page.waitForTimeout(700);

// 화면을 새로 열어도 기억한다
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });
await page.click('.tab-btn[data-tab="print"]');
await page.waitForSelector('.pr-sheet', { timeout: 15000 });

const skipAfter = await page.evaluate(() => ({
  y1: document.querySelector('.pr-sheet[data-team="Y1"] .pr-pick input').checked,
  y2: document.querySelector('.pr-sheet[data-team="Y2"] .pr-pick input').checked,
  o1: document.querySelector('.pr-sheet[data-team="O1"] .pr-pick input').checked,
  count: document.getElementById('prCount').textContent.trim(),
}));
ok('새로 열어도 뺀 조를 기억한다', skipAfter.y1 === false, JSON.stringify(skipAfter));
ok('빼지 않은 조는 그대로 켜져 있다', skipAfter.y2 && skipAfter.o1, JSON.stringify(skipAfter));
ok('출력 장수도 맞게 센다', /중 \d+장/.test(skipAfter.count),
   `${cnt1} → ${skipAfter.count}`);

// 다시 켜면 그것도 기억한다
await page.check('.pr-sheet[data-team="Y1"] .pr-pick input');
await page.waitForTimeout(200);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });
await page.click('.tab-btn[data-tab="print"]');
await page.waitForSelector('.pr-sheet', { timeout: 15000 });
ok('다시 켠 것도 기억한다',
   await page.$eval('.pr-sheet[data-team="Y1"] .pr-pick input', el => el.checked));

// 원상복구 (다음 실행에 영향 주지 않게)
await page.evaluate(() => {
  localStorage.removeItem('dg_admin_print_cols_v1');
  localStorage.removeItem('dg_admin_print_skip_v1');
});
// 인쇄에 실제로 나가는 모습
await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(300);
await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${SHOT}/dg-print-paper.png` });
// 5명 조는 한 화면에 다 들어와서 맨 아래 특이사항 칸까지 보인다
await page.locator('.pr-sheet[data-team="Y1"] .pr-page')
  .screenshot({ path: `${SHOT}/dg-print-note.png` });
await page.emulateMedia({ media: 'screen' });

// --- 상단 장 목록 ----------------------------------------------------------
//
// 조가 33개면 목록을 늘 펼쳐 두는 것만으로 화면을 먹는다. 접어 두고
// '부분 선택' 으로 연다.
const pickShut = await page.evaluate(() => {
  const list = document.getElementById('prPickList');
  const btn = document.getElementById('prPickToggleBtn');
  return {
    hidden: list.hidden,
    display: getComputedStyle(list).display,
    label: btn.textContent.trim(),
    expanded: btn.getAttribute('aria-expanded'),
    controls: btn.getAttribute('aria-controls'),
    chips: document.querySelectorAll('.pr-pick-chip').length,
  };
});
ok('처음에는 장 목록이 접혀 있다',
   pickShut.hidden === true && pickShut.display === 'none', JSON.stringify(pickShut));
ok('접혀 있어도 목록은 미리 만들어 둔다', pickShut.chips > 0, `${pickShut.chips}개`);
ok('여는 버튼이 무엇을 여는지 알린다',
   pickShut.expanded === 'false' && pickShut.controls === 'prPickList'
   && /부분 선택/.test(pickShut.label), JSON.stringify(pickShut));

await page.click('#prPickToggleBtn');
await page.waitForTimeout(250);
const pickOpen = await page.evaluate(() => {
  const list = document.getElementById('prPickList');
  const btn = document.getElementById('prPickToggleBtn');
  return {
    hidden: list.hidden,
    h: Math.round(list.getBoundingClientRect().height),
    label: btn.textContent.trim(),
    expanded: btn.getAttribute('aria-expanded'),
    on: btn.classList.contains('on'),
  };
});
ok('부분 선택을 누르면 목록이 나온다',
   pickOpen.hidden === false && pickOpen.h > 20, JSON.stringify(pickOpen));
ok('열려 있는 동안은 버튼이 눌린 티가 난다',
   pickOpen.on && pickOpen.expanded === 'true' && /닫기/.test(pickOpen.label),
   JSON.stringify(pickOpen));

// 한 번 더 누르면 도로 접힌다
await page.click('#prPickToggleBtn');
await page.waitForTimeout(250);
ok('다시 누르면 접힌다', await page.$eval('#prPickList', el => el.hidden) === true);
await page.click('#prPickToggleBtn');
await page.waitForTimeout(250);

const pick = await page.evaluate(() => ({
  chips: [...document.querySelectorAll('.pr-pick-chip')].map(c => ({
    label: c.textContent.trim(),
    on: c.querySelector('input').checked,
    team: c.querySelector('input').dataset.team,
  })),
  sheets: [...document.querySelectorAll('.pr-sheet')].map(s => s.dataset.team),
}));
ok('장마다 목록 항목이 하나씩', pick.chips.length === pick.sheets.length,
   `목록 ${pick.chips.length} / 장 ${pick.sheets.length}`);
ok('목록 차례가 장 차례와 같다',
   pick.chips.map(c => c.team).join(',') === pick.sheets.join(','),
   pick.chips.map(c => c.team).join(','));
ok('집계표는 이름으로 알아볼 수 있다',
   pick.chips.some(c => c.label.startsWith('집계표 ·')),
   pick.chips.map(c => c.label).join(' | '));

// 목록에서 끄면 그 장이 빠지고, 장 위 체크도 같이 풀린다
const liveBefore = await page.$$eval('.pr-pick-chip input', els => els.filter(e => e.checked).length);
await page.uncheck('.pr-pick-chip input[data-team="Y2"]');
await page.waitForTimeout(200);
const afterChip = await page.evaluate(() => ({
  sheetSkipped: document.querySelector('.pr-sheet[data-team="Y2"]').classList.contains('pr-skip'),
  sheetBox: document.querySelector('.pr-sheet[data-team="Y2"] .pr-pick input').checked,
  chipOff: document.querySelector('.pr-pick-chip input[data-team="Y2"]')
             .closest('.pr-pick-chip').classList.contains('off'),
  count: document.getElementById('prCount').textContent.trim(),
  others: [...document.querySelectorAll('.pr-pick-chip input')].filter(i => i.checked).length,
}));
ok('목록에서 끄면 그 장이 빠진다', afterChip.sheetSkipped);
ok('장 위 체크도 같이 풀린다', afterChip.sheetBox === false);
ok('뺀 항목은 목록에서 흐려진다', afterChip.chipOff);
ok('장수도 같이 준다', afterChip.count.includes(`중 ${liveBefore - 1}장`),
   `${afterChip.count} (끄기 전 ${liveBefore}장)`);
ok('한 장만 빠진다', afterChip.others === liveBefore - 1,
   `${afterChip.others}개 켜짐 (끄기 전 ${liveBefore}개)`);

// 접어 두면 무엇이 빠졌는지 목록으로는 못 본다 — 버튼이 대신 말해 준다
await page.click('#prPickToggleBtn');
await page.waitForTimeout(250);
const shutLabel = await page.$eval('#prPickToggleBtn', el => el.textContent.trim());
ok('접힌 채로도 몇 장을 뺐는지 알 수 있다', /1장 뺌/.test(shutLabel), shutLabel);
await page.click('#prPickToggleBtn');
await page.waitForTimeout(250);

// 반대 방향 — 장 위에서 켜면 목록도 켜진다
await page.check('.pr-sheet[data-team="Y2"] .pr-pick input');
await page.waitForTimeout(200);
ok('장 위에서 켜면 목록도 켜진다',
   await page.$eval('.pr-pick-chip input[data-team="Y2"]', el => el.checked));

// 전체 해제·선택이 목록에도 반영된다
await page.click('#prAllToggleBtn');   // 전부 켜져 있으니 → 전체 해제
await page.waitForTimeout(200);
ok('전체 해제가 목록에도 반영된다',
   (await page.$$eval('.pr-pick-chip input', els => els.every(e => !e.checked))));
await page.click('#prAllToggleBtn');   // 전부 꺼져 있으니 → 전체 선택
await page.waitForTimeout(200);
ok('전체 선택이 목록에도 반영된다',
   (await page.$$eval('.pr-pick-chip input', els => els.every(e => e.checked))));

// 목록에서 끈 것도 기억한다
await page.uncheck('.pr-pick-chip input[data-team="C1"]');
await page.waitForTimeout(200);
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });
await page.click('.tab-btn[data-tab="print"]');
await page.waitForSelector('.pr-sheet', { timeout: 15000 });
ok('목록에서 끈 것도 기억한다',
   (await page.$eval('.pr-pick-chip input[data-team="C1"]', el => el.checked)) === false);
// 연 상태까지 기억하지는 않는다 — 늘 떠 있는 게 거슬려서 접은 것이므로
ok('화면을 새로 열면 목록은 다시 접혀 있다',
   await page.$eval('#prPickList', el => el.hidden) === true);
await page.click('#prPickToggleBtn');
await page.waitForTimeout(250);
await page.check('.pr-pick-chip input[data-team="C1"]');
await page.waitForTimeout(200);

// --- 실제 조 규모(33개)에서 장이 A4 를 넘지 않는가 -------------------------
//
// 계산만으로는 놓친다 — 화면에서는 .pr-page 가 늘어나 한 장처럼 보이지만
// 인쇄하면 두 장으로 갈린다. 인쇄 매체에서 실제 높이를 재서 본다.
await page.evaluate(() => {
  localStorage.removeItem('dg_admin_print_cols_v1');
  localStorage.removeItem('dg_admin_print_skip_v1');
});
await page.route('**/rest/v1/**', route => {
  const url = new URL(route.request().url());
  const table = url.pathname.split('/').pop();
  let body = [];
  if (table === 'dg_members') {
    body = url.searchParams.get('select') === 'cohort_id'
      ? [{ cohort_id: COHORT }]
      // 33개 조 — 실제 규모. 웨슬리홀 20 · 칼빈채플 9 · 온라인 4
      : Array.from({ length: 33 }, (_, t) =>
          Array.from({ length: 6 }, (_, i) => ({
            id: `m${t}_${i}`, cohort_id: COHORT,
            name: `조원${t}${i}`, phone: String(2000 + t * 10 + i),
            team: `Y${t + 1}`, team_no: i + 1,
            location: t < 20 ? '웨슬리홀' : t < 29 ? '칼빈채플' : '온라인',
            role: i === 0 ? '조장' : '조원', lunch: 'O', status: 'active', age: 30,
          }))).flat();
  } else if (table === 'dg_sessions') body = SESSIONS;
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });
await page.click('.tab-btn[data-tab="print"]');
await page.waitForSelector('.pr-sheet', { timeout: 15000 });
await page.check('#prColSummary');
await page.waitForTimeout(500);

const bigSummaries = await page.$$eval('.pr-sheet[data-team^="__summary__"] .pr-sub',
  els => els.map(e => e.textContent.trim()));
ok('33개 조 · 장소 세 곳이 잡힌다', bigSummaries.length === 4,
   bigSummaries.join(' | '));

await page.emulateMedia({ media: 'print' });
await page.waitForTimeout(400);

// A4 세로 297 - @page 여백 24 = 273mm. 그 안에 들어와야 한 장이다.
const tall = await page.evaluate(() => {
  const MM = 273 * (96 / 25.4);
  return [...document.querySelectorAll('.pr-sheet')].map(sheet => ({
    team: sheet.dataset.team,
    h: Math.round(sheet.getBoundingClientRect().height),
    limit: Math.round(MM),
  }));
});
const over = tall.filter(t => t.h > t.limit);
ok('33개 조에서도 모든 장이 A4 한 장에 들어간다', over.length === 0,
   over.length ? over.map(t => `${t.team} ${t.h}px > ${t.limit}px`).join(' · ')
               : `가장 높은 장 ${Math.max(...tall.map(t => t.h))}px / 한 장 ${tall[0].limit}px`);

const sumTall = tall.filter(t => t.team.startsWith('__summary__'));
ok('전체 집계표(33줄)도 한 장', sumTall.every(t => t.h <= t.limit),
   sumTall.map(t => `${t.team.replace('__summary__:', '')} ${t.h}px`).join(' · '));

await page.evaluate(() => window.scrollTo(0, 0));
await page.screenshot({ path: `${SHOT}/dg-print-33.png` });
await page.emulateMedia({ media: 'screen' });

// 33개 조에서 조작부가 접혀 있을 때와 목록을 열었을 때
await page.evaluate(() => window.scrollTo(0, 0));
await page.waitForTimeout(300);
await page.screenshot({ path: `${SHOT}/dg-pick-shut.png` });

await page.click('#prPickToggleBtn');
await page.waitForTimeout(300);
// 33개나 되는 목록이 조작부를 얼마나 먹는지 — 여기가 접어 둔 이유다
const pickBox = await page.evaluate(() => {
  const ctrl = document.querySelector('.pr-controls');
  const list = document.getElementById('prPickList');
  return {
    ctrl: Math.round(ctrl.getBoundingClientRect().height),
    list: Math.round(list.getBoundingClientRect().height),
    vh: window.innerHeight,
  };
});
ok('33장이어도 목록이 화면을 다 먹지 않는다',
   pickBox.list <= 150 && pickBox.ctrl < pickBox.vh * 0.5, JSON.stringify(pickBox));
await page.screenshot({ path: `${SHOT}/dg-picklist.png` });

// --- 동기화한 과제가 실제로 붙는가 ----------------------------------------
//
// 과제는 회차마다 다시 받을 이유가 없어 한 번 받아 캐시한다. 그 캐시를 시트
// 동기화 뒤에 버리지 않으면 새로 낸 과제가 영영 안 붙는데, 화면에는 그냥
// 빈 칸이라 아무도 못 알아챈다.
let hwRows = [{ member_id: 'u1', lecture: '19강' }, { member_id: 'u3', lecture: '20과' }];
let hwFail = false;

// 지금 명단에 없는 사람의 신청. 하차한 사람 것이 DB 에 남아 있으면 이렇게 된다.
// 장에는 안 나오는 사람이므로 위쪽 집계에서도 빠져야 한다 (합계와 어긋난다).
LUNCH['2026-08-16'].push('zz-없는사람');

// 이름 없는 회차 하나를 끼운다 — 그런 주차는 과제를 붙일 방법이 없다
const SESSIONS_X = [...SESSIONS, { session_date: '2026-09-13', label: '09/13', name: '' }];

await page.route('**/rest/v1/**', route => {
  const url = new URL(route.request().url());
  const table = url.pathname.split('/').pop();
  if (table === 'dg_homework') {
    return hwFail
      ? route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"boom"}' })
      : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(hwRows) });
  }
  let body = [];
  if (table === 'dg_members') {
    body = url.searchParams.get('select') === 'cohort_id' ? [{ cohort_id: COHORT }] : MEMBERS;
  } else if (table === 'dg_sessions') {
    // 실제 조회에는 order=session_date 가 붙는다. 중간에 회차를 끼워 넣어도
    // 날짜순으로 오게 해야 진짜와 같다.
    body = [...SESSIONS_X].sort((a, b) => a.session_date.localeCompare(b.session_date));
  } else if (table === 'dg_lunch') {
    const d = (url.searchParams.get('session_date') || '').replace('eq.', '');
    body = (LUNCH[d] || []).map(id => ({ member_id: id }));
  }
  route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
});

await page.evaluate(() => {
  localStorage.removeItem('dg_admin_print_cols_v1');
  localStorage.removeItem('dg_admin_print_skip_v1');
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });
await page.click('.tab-btn[data-tab="print"]');
await page.waitForSelector('.pr-sheet', { timeout: 15000 });
await page.selectOption('#prSessionPicker', '2026-08-16');   // 19강
await page.waitForTimeout(600);

// Y1 은 u1~u5. 과제 칸은 이름 다음의 마크 칸들 중 마지막
const hwTicks = () => page.$$eval('.pr-sheet[data-team="Y1"] tbody tr',
  rows => rows.filter(r => {
    const heads = [...r.closest('table').querySelectorAll('thead th')].map(t => t.textContent.trim());
    const i = heads.indexOf('과제');
    return i >= 0 && r.children[i].textContent.trim() === '✓';
  }).length);
const dataInfo = () => page.$eval('#prDataInfo', el => el.textContent.trim());

ok('과제가 붙는다', await hwTicks() === 1, `${await hwTicks()}명`);
ok('몇 명에게 붙었는지 알려 준다', /📝 과제 1명/.test(await dataInfo()), await dataInfo());
ok('어느 강의명으로 붙였는지 알려 준다', /19강/.test(await dataInfo()), await dataInfo());

// 위쪽 집계와 집계표 합계가 같은 사람을 세는가
ok('명단에 없는 신청은 위쪽 집계에서도 뺀다', /🍙 김밥 3명/.test(await dataInfo()),
   await dataInfo());
ok('뺐다는 것을 알려 준다', /명단에 없는 1명 제외/.test(await dataInfo()), await dataInfo());
await page.check('#prColSummary');
await page.waitForTimeout(500);
const sumRow = await page.$$eval('.pr-sheet[data-team="__summary__:__all__"] tr', rows => {
  const r = rows.find(x => x.textContent.includes('합계'));
  return r ? [...r.children].map(c => c.textContent.trim()) : [];
});
// No. · 조 · 장소 · 인원 · 김밥 · 메모
ok('집계표 합계와 위쪽 집계가 같은 수', sumRow[4] === '3', sumRow.join(' | '));
await page.uncheck('#prColSummary');
await page.waitForTimeout(400);

// 시트에서 새로 가져왔다 → 화면 새로 고침
hwRows.push({ member_id: 'u2', lecture: '제19강' });
await page.click('#syncReloadBtn');
await page.waitForTimeout(1500);
ok('동기화한 과제가 새로 고침으로 붙는다', await hwTicks() === 2, `${await hwTicks()}명`);
ok('집계도 같이 늘어난다', /📝 과제 2명/.test(await dataInfo()), await dataInfo());

// --- 붙지 않을 때 이유를 말하는가 -----------------------------------------
await page.selectOption('#prSessionPicker', '2026-08-30');   // 20강 — 폼에는 '20과'
await page.waitForTimeout(600);
const warnMismatch = await dataInfo();
ok('강의명이 어긋나면 그렇다고 말한다', /‘20강’ 으로 낸 과제가 없습니다/.test(warnMismatch),
   warnMismatch);
ok('폼에 뭐라고 적혀 있는지까지 알려 준다', /‘20과’ 1건/.test(warnMismatch), warnMismatch);

await page.selectOption('#prSessionPicker', '2026-09-13');   // 회차 이름 없음
await page.waitForTimeout(600);
const warnNoName = await dataInfo();
ok('회차 이름이 없으면 그렇다고 말한다', /회차 이름이 없어 과제를 붙일 수 없습니다/.test(warnNoName),
   warnNoName);

// --- 실패를 캐시하지 않는가 -----------------------------------------------
//
// 못 받은 것을 빈 배열로 캐시해 버리면 그 뒤로는 조회조차 하지 않는다.
// 과제 칸이 영영 비는데 오류도 안 나서 알아챌 방법이 없다.
hwFail = true;
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });
await page.click('.tab-btn[data-tab="print"]');
await page.waitForSelector('.pr-sheet', { timeout: 15000 });
await page.selectOption('#prSessionPicker', '2026-08-16');
await page.waitForTimeout(600);
ok('못 불러오면 못 불러왔다고 말한다', /불러오지 못했습니다/.test(await dataInfo()), await dataInfo());

hwFail = false;
await page.selectOption('#prSessionPicker', '2026-08-30');
await page.waitForTimeout(400);
await page.selectOption('#prSessionPicker', '2026-08-16');
await page.waitForTimeout(600);
ok('한 번 실패해도 다음에 다시 받는다', await hwTicks() === 2, `${await hwTicks()}명`);

// --- 회차가 새로 생기면 가장 가까운 주차를 따라가는가 ---------------------
//
// 주차는 탭을 처음 열 때 한 번 고르고 끝이었다. 시트에 이번 주 회차를 넣고
// 가져와도 목록에 없고 지난 주차가 골라진 채라, 지난주 출석부가 나왔다.
await page.reload({ waitUntil: 'load' });          // 사람이 고른 표시도 초기화
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });
await page.click('.tab-btn[data-tab="print"]');
await page.waitForSelector('.pr-sheet', { timeout: 15000 });

const prWeek = () => page.$eval('#prSessionPicker', el => el.value);
const prWeeks = () => page.$$eval('#prSessionPicker option', els => els.map(e => e.value));
// 오늘 08/12 — 08/09 는 3일 전, 08/16 은 4일 뒤
ok('처음에는 가장 가까운 주차', await prWeek() === '2026-08-09', await prWeek());

// 시트에 이번 주 회차가 새로 생겼다 (08/13 — 오늘에서 하루)
SESSIONS_X.push({ session_date: '2026-08-13', label: '08/13', name: '19-1강' });
await page.click('#syncReloadBtn');
await page.waitForTimeout(1500);
ok('새로 생긴 회차가 목록에 들어온다', (await prWeeks()).includes('2026-08-13'),
   (await prWeeks()).join(','));
ok('새로 고치면 가장 가까운 주차로 따라간다', await prWeek() === '2026-08-13', await prWeek());
ok('주차 목록은 그대로 오름차순',
   (await prWeeks()).join(',') === [...await prWeeks()].sort().join(','),
   (await prWeeks()).join(','));

// 사람이 고른 주차는 새로 고쳐도 덮지 않는다
await page.selectOption('#prSessionPicker', '2026-08-30');
await page.waitForTimeout(600);
SESSIONS_X.push({ session_date: '2026-08-11', label: '08/11', name: '18-1강' });
await page.click('#syncReloadBtn');
await page.waitForTimeout(1500);
ok('사람이 고른 주차는 새로 고쳐도 그대로', await prWeek() === '2026-08-30', await prWeek());
ok('그래도 새 회차는 목록에 들어온다', (await prWeeks()).includes('2026-08-11'),
   (await prWeeks()).join(','));

// 탭을 다시 열 때도 맞춘다 (화면을 켜 둔 채 회차가 늘어난 경우)
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });
await page.click('.tab-btn[data-tab="print"]');
await page.waitForSelector('.pr-sheet', { timeout: 15000 });
ok('다시 열어도 가장 가까운 주차', await prWeek() === '2026-08-11', await prWeek());
SESSIONS_X.push({ session_date: '2026-08-12', label: '08/12', name: '18-2강' });
await page.click('.tab-btn[data-tab="teams"]');
await page.waitForTimeout(200);
await page.click('#syncReloadBtn');
await page.waitForTimeout(1200);
await page.click('.tab-btn[data-tab="print"]');
await page.waitForTimeout(800);
ok('다른 탭에 있는 동안 늘어난 회차도 따라간다', await prWeek() === '2026-08-12', await prWeek());

// --- 종이 수 — 고른 만큼만 나오는가 ------------------------------------------
//
// 화면의 '몇 장 출력' 은 맞는데 종이가 한 장 더 나오는 일이 있었다. 미리보기로는
// 안 보인다 — 진짜로 PDF 를 뽑아서 쪽수를 세는 수밖에 없다.
//
// 원인 둘. (1) .admin-container 의 min-height: 100vh — 인쇄에서 1vh 는 종이
// 한 장이라, 한 장만 골라도 컨테이너가 종이 높이를 차지하고 body 여백이 거기
// 얹혀 빈 종이가 생겼다. (2) 장을 '뒤에서 끊기' 로 나눠서, 뒤에 뺀 장이 남아
// 있으면 마지막 장 뒤의 끊김이 지워지지 않았다.
const pdfPages = async () => {
  // ⚠️ page.pdf() 는 **지금 흉내 내고 있는 매체**를 따른다. 이 파일은 앞에서
  // screen 으로 되돌려 놓기 때문에, 그냥 부르면 인쇄 규칙이 하나도 안 걸린
  // 화면 그대로가 PDF 로 나온다 (탭 전부 · 뺀 장까지). 여기서 다시 print 로.
  await page.emulateMedia({ media: 'print' });
  const buf = await page.pdf({ format: 'A4', printBackground: true,
                               margin: { top: '12mm', bottom: '12mm', left: '12mm', right: '12mm' } });
  await page.emulateMedia({ media: 'screen' });
  return (buf.toString('latin1').match(/\/Type\s*\/Page[^s]/g) || []).length;
};
const liveCount = () => page.$$eval('.pr-sheet:not(.pr-skip)', els => els.length);

// 전부 켠 상태로 되돌린다
await page.evaluate(() => {
  localStorage.removeItem('dg_admin_print_skip_v1');
});
await page.reload({ waitUntil: 'load' });
await page.waitForFunction(() => document.querySelectorAll('.team-card').length > 0,
                           null, { timeout: 20000 });
await page.click('.tab-btn[data-tab="print"]');
await page.waitForSelector('.pr-sheet', { timeout: 15000 });
await page.waitForTimeout(400);

const allLive = await liveCount();
ok('종이 수 = 고른 장 수 (전부 켰을 때)', await pdfPages() === allLive,
   `${await pdfPages()}쪽 / ${allLive}장`);

// 한 조만 남긴다 — 여기서 빈 종이가 딸려 나왔다
await page.click('#prPickToggleBtn');
await page.waitForTimeout(200);
await page.click('#prAllToggleBtn');          // 전체 해제
await page.waitForTimeout(200);
const oneTeam = await page.$eval('.pr-pick-chip input', el => el.dataset.team);
await page.click(`.pr-pick-chip input[data-team="${oneTeam}"]`);
await page.waitForTimeout(400);
ok('한 장만 남았다', await liveCount() === 1, `${await liveCount()}장`);
ok('한 장을 고르면 종이도 한 장 (빈 종이가 안 딸려 온다)', await pdfPages() === 1,
   `${await pdfPages()}쪽`);

// 가운데를 뺀 경우 — 끊김이 뺀 장 자리에 남으면 안 된다
await page.click('#prAllToggleBtn');           // 전체 선택
await page.waitForTimeout(300);
const midTeam = await page.$$eval('.pr-pick-chip input', els => els[1].dataset.team);
await page.click(`.pr-pick-chip input[data-team="${midTeam}"]`);
await page.waitForTimeout(400);
ok('가운데를 빼도 종이 수가 맞는다', await pdfPages() === await liveCount(),
   `${await pdfPages()}쪽 / ${await liveCount()}장`);

await browser.close();
server.close();

done();
