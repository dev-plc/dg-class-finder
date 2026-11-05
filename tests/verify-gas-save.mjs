// GAS 저장 검증 — 시트를 먼저 고친 칸을 덮지 않는다 (v32 · seen).
//
// 앱은 출결을 DB 에서 읽는데 DB 는 시트보다 최대 10분 뒤처진다 (10분 트리거).
// 그 사이 시트에 손으로 넣은 O 를 앱은 빈칸으로 보여주고, 조장이 그대로 저장하면
// X 가 나가 시트의 O 가 말없이 덮였다. 그래서 앱이 사람마다 '화면에 띄웠던 값'
// (seen)을 함께 보내고, GAS 는 시트의 지금 칸이 그 값과 다르면 쓰지 않는다.
//
// verify-gas-lunch 처럼 구글 전역만 가짜로 채워 doPost 를 그대로 돌린다.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, makeReporter } from './lib/harness.mjs';

const SRC = join(ROOT, 'scripts', 'gas', 'doGet.js');
const src = readFileSync(SRC, 'utf8');

const { ok, done } = makeReporter('GAS 저장');

const Utilities = {
  formatDate(d, tz, fmt) {
    const p = (n) => String(n).padStart(2, '0');
    const y = d.getUTCFullYear(), m = p(d.getUTCMonth() + 1), day = p(d.getUTCDate());
    return fmt === 'yyyy-MM-dd' ? `${y}-${m}-${day}` : `${m}/${day}`;
  },
};
// 스크립트 속성이 비어 있으면 DB 밀어넣기는 건너뛴다 (dbPushed: false) — 여기서는 시트만 본다.
const PropertiesService = { getScriptProperties: () => ({ getProperty: () => null }) };
const ContentService = {
  MimeType: { JSON: 'json' },
  createTextOutput: (text) => ({ text, setMimeType() { return this; } }),
};
let lockHeld = 0;
const LockService = {
  getScriptLock: () => ({
    tryLock: () => { lockHeld++; return true; },
    releaseLock: () => { lockHeld--; },
  }),
};
const Logger = { log: () => {} };

// 출석부 탭 — 머리글: id · 이름 · 회차 둘 (날짜 값 칸). 지난 회차라야 쓸 수 있다.
const D1 = new Date(Date.UTC(2026, 9, 25));   // 2026-10-25
const D2 = new Date(Date.UTC(2026, 10, 1));   // 2026-11-01
const S = '2026-11-01';
let values;
const writes = [];
function resetSheet() {
  writes.length = 0;
  values = [
    ['DG-2026', '', '', ''],
    ['id', '이름', D1, D2],
    ['김조장1111', '김조장', 'O', 'O'],
    ['이조원2222', '이조원', 'O', 'O'],    // 시트에 손으로 O — DB 에는 아직 없다
    ['박돌봄3333', '박돌봄', 'O', '돌봄'],
    ['최빈칸4444', '최빈칸', 'O', ''],
    ['정엑스5555', '정엑스', 'O', 'X'],
  ];
}
const SpreadsheetApp = {
  openById: () => ({
    getSheetByName: () => ({
      getDataRange: () => ({ getValues: () => values }),
      getRange: (r, c) => ({
        setValue(v) { values[r - 1][c - 1] = v; writes.push({ r, c, v }); return this; },
      }),
    }),
  }),
  flush() {},
};

const stubs = { Utilities, PropertiesService, SpreadsheetApp, LockService, ContentService,
                ScriptApp: {}, UrlFetchApp: {}, Session: { getScriptTimeZone: () => 'Asia/Seoul' },
                Logger };
const gas = new Function(...Object.keys(stubs), `
  ${src}
  return { doPost, DG_VERSION };
`)(...Object.values(stubs));

const post = (body) => JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(body) } }).text);
const cell = (id) => values.find(r => r[0] === id)[3];

ok('GAS 버전 32', gas.DG_VERSION === 32, String(gas.DG_VERSION));

// --- 1. 시트 O · 화면은 빈칸으로 봤다 · 보낸 값 X → 덮지 않는다 -------------------
resetSheet();
let res = post({ session: S, batch: [
  { name: '김조장', phone: '1111', status: 'O', seen: 'O' },
  { name: '이조원', phone: '2222', status: 'X', seen: '' },
] });
ok('시트가 먼저 바뀐 칸은 그대로 (O 가 X 로 안 덮인다)', cell('이조원2222') === 'O', cell('이조원2222'));
ok('그 사람은 changed 로 돌아온다',
   JSON.stringify(res.changed) === JSON.stringify([{ id: '이조원2222', current: 'O' }]),
   JSON.stringify(res.changed));
ok('seen 이 시트와 같으면 쓴다', res.saved === 1 && cell('김조장1111') === 'O', JSON.stringify(res));
ok('성공으로 응답한다', res.success === true, JSON.stringify(res));
ok('잠금을 풀고 끝난다', lockHeld === 0, String(lockHeld));

// --- 2. 전원이 changed 여도 실패가 아니다 ---------------------------------
resetSheet();
res = post({ session: S, batch: [{ name: '이조원', phone: '2222', status: 'X', seen: '' }] });
ok('전원이 changed 여도 success', res.success === true && res.saved === 0 && res.changed.length === 1,
   JSON.stringify(res));
ok('아무것도 안 썼다', writes.length === 0, JSON.stringify(writes));

// --- 3. 빈칸을 빈칸으로 봤다 → 쓴다 · X 를 X 로 봤다 → O 로 쓴다 ----------------
resetSheet();
res = post({ session: S, batch: [
  { name: '최빈칸', phone: '4444', status: 'X', seen: '' },
  { name: '정엑스', phone: '5555', status: 'O', seen: 'X' },
] });
ok('본 값이 그대로면 쓴다 (빈칸 → X · X → O)',
   cell('최빈칸4444') === 'X' && cell('정엑스5555') === 'O' && res.saved === 2 && !res.changed.length,
   JSON.stringify(res));

// --- 4. 보내려는 값이 이미 시트에 있으면 막지 않는다 -------------------------
resetSheet();
res = post({ session: S, batch: [{ name: '이조원', phone: '2222', status: 'O', seen: '' }] });
ok('이미 같은 값이면 changed 가 아니다', res.saved === 1 && !res.changed.length, JSON.stringify(res));

// --- 5. seen 이 없으면(옛 화면) 예전처럼 쓴다 -------------------------------
resetSheet();
res = post({ session: S, batch: [{ name: '이조원', phone: '2222', status: 'X' }] });
ok('seen 이 없으면 예전처럼 덮는다 (하위 호환)', cell('이조원2222') === 'X' && res.saved === 1,
   JSON.stringify(res));

// --- 6. 돌봄 칸은 seen 과 상관없이 kept ------------------------------------
resetSheet();
res = post({ session: S, batch: [
  { name: '박돌봄', phone: '3333', status: 'X', seen: '' },
  { name: '박돌봄', phone: '3333', status: 'O', seen: '돌봄' },
] });
ok('돌봄 칸은 kept — seen 과 상관없다',
   cell('박돌봄3333') === '돌봄' && res.kept.length === 2 && !res.changed.length, JSON.stringify(res));

// --- 7. 대소문자 · 공백은 같은 값으로 본다 ----------------------------------
resetSheet();
values[3][3] = ' o ';
res = post({ session: S, batch: [{ name: '이조원', phone: '2222', status: 'X', seen: 'O' }] });
ok("시트의 ' o ' 와 seen 'O' 는 같은 값", cell('이조원2222') === 'X' && res.saved === 1, JSON.stringify(res));

done();
