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
  // 관리자 확인(v34)이 캐시 열쇠를 만들 때 쓴다. 진짜 해시일 필요는 없다 — 토큰마다 다르면 된다.
  DigestAlgorithm: { SHA_256: 'sha256' },
  computeDigest: (algo, text) => Array.from(Buffer.from(String(text))),
  base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
};
// 스크립트 속성. 비어 있으면 DB 밀어넣기는 건너뛴다 (dbPushed: false) — 앞쪽 검증은 시트만 본다.
// 관리자 확인(v34) 검증에서 Supabase 속성을 채운다.
const PROPS = {};
const PropertiesService = { getScriptProperties: () => ({ getProperty: (k) => PROPS[k] ?? null }) };
// Supabase 대역 — /auth/v1/user 에 토큰을 물으면 누구의 것인지 답한다.
const TOKENS = {
  'admin-token': { status: 200, user: { app_metadata: { dg_admin: true } } },
  'guest-token': { status: 200, user: { app_metadata: {} } },            // 로그인은 됐지만 관리자 표시가 없다
  'fake-meta-token': { status: 200, user: { user_metadata: { dg_admin: true }, app_metadata: {} } },
};
const authAsked = [];
const UrlFetchApp = {
  fetch(url, opts) {
    const token = String(opts?.headers?.Authorization || '').replace(/^Bearer /, '');
    if (/\/auth\/v1\/user$/.test(url)) {
      authAsked.push(token);
      const hit = TOKENS[token] || { status: 401, user: { message: 'invalid JWT' } };
      return { getResponseCode: () => hit.status, getContentText: () => JSON.stringify(hit.user) };
    }
    // 그 밖(DB 밀어넣기 등)은 이 검증의 관심사가 아니다.
    return { getResponseCode: () => 500, getContentText: () => '{}' };
  },
};
const cacheStore = {};
const CacheService = {
  getScriptCache: () => ({
    get: (k) => (k in cacheStore ? cacheStore[k] : null),
    put: (k, v) => { cacheStore[k] = v; },
  }),
};
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

// 출석부 탭 — 머리글: id · 이름 · team · role · 회차 둘 (날짜 값 칸). 지난 회차라야 쓸 수 있다.
// team · role 은 조장 확인(v35)이 본다. Y1 의 조장은 김조장, Y2 의 조장은 다른조장이다.
const D1 = new Date(Date.UTC(2026, 9, 25));   // 2026-10-25
const D2 = new Date(Date.UTC(2026, 10, 1));   // 2026-11-01
const S = '2026-11-01';
let values;
const writes = [];
function resetSheet() {
  writes.length = 0;
  values = [
    ['DG-2026', '', '', '', '', ''],
    ['id', '이름', 'Team', 'Role', D1, D2],
    ['김조장1111', '김조장', 'Y1', '조장', 'O', 'O'],
    ['이조원2222', '이조원', 'Y1', '조원', 'O', 'O'],    // 시트에 손으로 O — DB 에는 아직 없다
    ['박돌봄3333', '박돌봄', 'Y1', '조원', 'O', '돌봄'],
    ['최빈칸4444', '최빈칸', 'Y1', '',     'O', ''],
    ['정엑스5555', '정엑스', 'Y1', '조원', 'O', 'X'],
    ['다른조장6666', '다른조장', 'Y2', '조장', 'O', ''],
    ['다른조원7777', '다른조원', 'Y2', '조원', 'O', ''],
    ['정서브8888', '정서브', 'Y2', '서브튜터', 'O', ''],
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
                ScriptApp: {}, UrlFetchApp, CacheService,
                Session: { getScriptTimeZone: () => 'Asia/Seoul' }, Logger };
const gas = new Function(...Object.keys(stubs), `
  ${src}
  return { doPost, DG_VERSION };
`)(...Object.values(stubs));

// 저장하는 사람(by)을 안 적으면 Y1 의 조장 김조장으로 보낸다 — 앞쪽 검증(seen 등)은
// '조장이 자기 조를 저장한다' 는 평소 상황을 본다. `by: null` 을 주면 아예 안 보낸다.
const TUTOR = { name: '김조장', phone: '1111' };
const post = (body) => {
  const full = body.action || 'by' in body ? { ...body } : { ...body, by: TUTOR };
  if (full.by === null) delete full.by;
  return JSON.parse(gas.doPost({ postData: { contents: JSON.stringify(full) } }).text);
};
const cell = (id) => values.find(r => r[0] === id)[5];

ok('GAS 버전 35', gas.DG_VERSION === 35, String(gas.DG_VERSION));

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
values[3][5] = ' o ';
res = post({ session: S, batch: [{ name: '이조원', phone: '2222', status: 'X', seen: 'O' }] });
ok("시트의 ' o ' 와 seen 'O' 는 같은 값", cell('이조원2222') === 'X' && res.saved === 1, JSON.stringify(res));

// ==========================================================================
// 관리자만 할 수 있는 것 (v34) — 동기화 실행 · 기록 지우기
//
// doPost 는 누구나 부를 수 있다. 주소만 알면 동기화를 돌리고 지난 회차 기록을 빈칸으로
// 지울 수 있었다. 앱이 관리자 로그인 토큰을 body.token 으로 보내고, GAS 가 그것을
// Supabase 에 물어 관리자 표시(app_metadata.dg_admin)를 확인한다.
// ==========================================================================
PROPS.DG_SUPABASE_URL = 'https://example.supabase.co';
PROPS.DG_SUPABASE_SERVICE_KEY = 'service-key-not-real';
const erase = (extra = {}) => post({ session: S, batch: [
  { name: '김조장', phone: '1111', status: '', seen: 'O' },
  { name: '최빈칸', phone: '4444', status: 'X', seen: '' },
], ...extra });

// --- 기록 지우기 (빈 값) -----------------------------------------------------
for (const [label, extra] of [['토큰 없음', {}], ['지어낸 토큰', { token: 'made-up' }],
                              ['관리자 표시 없는 계정', { token: 'guest-token' }],
                              // user_metadata 는 사용자가 스스로 바꿀 수 있는 칸이다 — 거기 적힌 것은 안 믿는다
                              ['스스로 붙인 표시(user_metadata)', { token: 'fake-meta-token' }]]) {
  resetSheet();
  res = erase(extra);
  ok(`지우는 저장 — ${label}: 거절한다`, res.success === false && res.code === 'admin-required', JSON.stringify(res));
  ok(`지우는 저장 — ${label}: 시트를 하나도 안 바꾼다 (O/X 도 같이 안 쓴다)`,
     writes.length === 0 && cell('김조장1111') === 'O' && cell('최빈칸4444') === '', JSON.stringify(writes));
}
ok('거절하고도 잠금을 남기지 않는다', lockHeld === 0, String(lockHeld));

resetSheet();
res = erase({ token: 'admin-token' });
ok('지우는 저장 — 관리자 토큰이면 쓴다',
   res.success === true && cell('김조장1111') === '' && cell('최빈칸4444') === 'X', JSON.stringify(res));

// --- O/X 저장은 토큰 없이도 된다 (조장 화면) ----------------------------------
resetSheet();
res = post({ session: S, batch: [{ name: '최빈칸', phone: '4444', status: 'O', seen: '' }] });
ok('O/X 저장은 토큰 없이도 된다 (조장 화면)', res.success === true && cell('최빈칸4444') === 'O', JSON.stringify(res));

// --- 동기화 실행 -------------------------------------------------------------
res = post({ action: 'sync' });
ok('동기화 실행 — 토큰 없이는 거절', res.success === false && res.code === 'admin-required', JSON.stringify(res));
res = post({ action: 'sync', token: 'guest-token' });
ok('동기화 실행 — 관리자 표시 없는 계정은 거절', res.code === 'admin-required', JSON.stringify(res));
res = post({ action: 'sync', token: 'admin-token' });
// 여기서는 GitHub 토큰 속성이 없어 그 다음 단계에서 멈춘다 — 관리자 확인은 지나갔다는 뜻이다.
ok('동기화 실행 — 관리자 토큰이면 다음 단계로 간다',
   res.code !== 'admin-required' && /DG_GH_TOKEN/.test(res.message || ''), JSON.stringify(res));

// --- 확인 결과 캐시 -----------------------------------------------------------
// 저장할 때마다 Supabase 에 묻지 않는다 (맞다는 답만 5분). 아니라는 답은 매번 다시 묻는다 —
// 방금 로그인한 사람을 5분 동안 막으면 안 된다.
authAsked.length = 0;
post({ action: 'sync', token: 'admin-token' });
post({ action: 'sync', token: 'admin-token' });
ok('맞다는 답은 캐시한다 (다시 안 묻는다)', authAsked.length === 0, `${authAsked.length}회 물음`);
post({ action: 'sync', token: 'guest-token' });
post({ action: 'sync', token: 'guest-token' });
ok('아니라는 답은 캐시하지 않는다', authAsked.length === 2, `${authAsked.length}회 물음`);
ok('캐시 열쇠에 토큰을 그대로 쓰지 않는다',
   Object.keys(cacheStore).length > 0 && Object.keys(cacheStore).every(k => !k.includes('admin-token')),
   Object.keys(cacheStore).join(','));

// ==========================================================================
// 조장만, 자기 조만 (v35)
//
// 예전에는 이름+뒤 4자리만 맞으면 누구의 출석이든 O/X 로 쓸 수 있었다 (명단이 공개여서
// 그 값은 누구나 알았다). 앱이 저장하는 사람을 body.by 로 보내고, GAS 가 시트 명단에서
// 그 사람의 역할과 조를 본다.
// ==========================================================================
const oneX = (who, extra = {}) => post({ session: S, batch: [
  { name: who.name, phone: who.phone, status: 'X', seen: who.seen ?? '' }], ...extra });
const BLANK_Y1 = { name: '최빈칸', phone: '4444', seen: '' };
const BLANK_Y2 = { name: '다른조원', phone: '7777', seen: '' };

for (const [label, extra, target] of [
  ['저장하는 사람을 안 보냄 (옛 화면 · 주소를 직접 부름)', { by: null }, BLANK_Y1],
  ['명단에 없는 사람', { by: { name: '없는사람', phone: '0000' } }, BLANK_Y1],
  ['번호가 다른 사람', { by: { name: '김조장', phone: '1112' } }, BLANK_Y1],
  ['조원 (역할이 조원)', { by: { name: '이조원', phone: '2222' } }, BLANK_Y1],
  ['역할이 빈 사람', { by: { name: '최빈칸', phone: '4444' } }, BLANK_Y1],
  ['다른 조의 조장', { by: { name: '다른조장', phone: '6666' } }, BLANK_Y1],
  ['조장이 남의 조 사람을', { by: TUTOR }, BLANK_Y2],
]) {
  resetSheet();
  res = oneX(target, extra);
  ok(`조장 확인 — ${label}: 거절한다`, res.success === false && res.code === 'not-tutor', JSON.stringify(res));
  ok(`조장 확인 — ${label}: 시트를 안 바꾼다`, writes.length === 0, JSON.stringify(writes));
}
ok('거절하고도 잠금을 남기지 않는다 (조장 확인)', lockHeld === 0, String(lockHeld));

// 자기 조 사람과 남의 조 사람이 섞이면 **전부** 안 쓴다 (반만 쓰면 화면과 시트가 어긋난다).
resetSheet();
res = post({ session: S, batch: [
  { name: '최빈칸', phone: '4444', status: 'X', seen: '' },
  { name: '다른조원', phone: '7777', status: 'X', seen: '' }] });
ok('남의 조 사람이 하나라도 섞이면 전부 안 쓴다',
   res.code === 'not-tutor' && writes.length === 0 && cell('최빈칸4444') === '', JSON.stringify(res));

resetSheet();
res = oneX(BLANK_Y1);
ok('조장이 자기 조 사람을 저장한다', res.success === true && cell('최빈칸4444') === 'X', JSON.stringify(res));
resetSheet();
res = oneX(BLANK_Y2, { by: { name: '정서브', phone: '8888' } });
ok('서브튜터도 자기 조를 저장한다', res.success === true && cell('다른조원7777') === 'X', JSON.stringify(res));
resetSheet();
res = oneX(BLANK_Y2, { by: { name: ' 다른 조장 ', phone: '６６６６'.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)) } });
ok('이름의 공백은 다듬어 본다', res.success === true, JSON.stringify(res));
// 명단에 없는 사람이 섞인 것은 예전처럼 missing 으로 돌려준다 (거절이 아니다).
resetSheet();
res = post({ session: S, batch: [
  { name: '최빈칸', phone: '4444', status: 'X', seen: '' },
  { name: '유령', phone: '0001', status: 'X', seen: '' }] });
ok('명단에 없는 사람은 missing 으로 (나머지는 쓴다)',
   res.success === true && res.saved === 1 && res.missing.length === 1, JSON.stringify(res));

// 관리자 토큰이 있으면 조와 상관없이 쓴다 (관리자 화면 — by 를 안 보낸다).
resetSheet();
res = post({ session: S, token: 'admin-token', by: null, batch: [
  { name: '최빈칸', phone: '4444', status: 'X', seen: '' },
  { name: '다른조원', phone: '7777', status: 'O', seen: '' }] });
ok('관리자 토큰이면 조와 상관없이 쓴다',
   res.success === true && cell('최빈칸4444') === 'X' && cell('다른조원7777') === 'O', JSON.stringify(res));
resetSheet();
res = oneX(BLANK_Y1, { by: null, token: 'guest-token' });
ok('관리자 표시 없는 토큰은 조장 확인을 건너뛰지 못한다', res.code === 'not-tutor' && writes.length === 0, JSON.stringify(res));

// team · role 열을 못 찾으면 확인할 길이 없다 → 거절 (열어 두지 않는다).
resetSheet();
values[1][2] = '조';          // 머리글이 'team' 이 아니다
res = oneX(BLANK_Y1);
ok('team · role 열이 없으면 거절한다 (열어 두지 않는다)',
   res.code === 'not-tutor' && /team/.test(res.message) && writes.length === 0, JSON.stringify(res));

// --- Supabase 속성이 없으면 확인할 길이 없다 → 거절 (열어 두지 않는다) -----------
delete PROPS.DG_SUPABASE_URL;
for (const k of Object.keys(cacheStore)) delete cacheStore[k];
res = post({ action: 'sync', token: 'admin-token' });
ok('확인할 길이 없으면 거절한다 (열어 두지 않는다)', res.code === 'admin-required', JSON.stringify(res));

done();
