// 시트에서 지운 출석이 DB 에서도 지워지는가.
//
// 이게 없던 동안 `dg_attendance` 는 **한 방향 톱니바퀴**였다 — 한 번 들어간 X 가
// 시트를 비워도 영영 남았고, 명단에 갓 올라온 사람이 지난 회차 결석으로 떴다.
//
// 지우는 일이라 반대쪽 위험이 더 크다. GAS 가 부분 응답을 주면 전 회차가 빈칸으로
// 보여 **출석이 통째로 사라진다.** 그래서 '지워지는가' 만큼 '함부로 안 지우는가' 를
// 같은 무게로 본다.
//
// 실제 GAS·Supabase 로 나가지 않는다. 둘 다 가짜 서버를 세우고 스크립트를 그대로 돌린다.

import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, makeReporter } from './lib/harness.mjs';

const GAS_PORT = 8103;
const DB_PORT = 8104;
const COHORT = 'DG-2026';
const { ok, done } = makeReporter('출석 정리 (시트에서 지운 것)');

// 회차 셋. 사람 둘.
const DATES = ['2026-08-02', '2026-08-09', '2026-08-16'];
const PEOPLE = [
  { name: '김조장', phone: '1001', uuid: 'u1' },
  { name: '이조원', phone: '2002', uuid: 'u2' },
];

// ---- 가짜 GAS ------------------------------------------------------------
// sheetAtt 를 바꿔 가며 '시트가 무엇을 말하는가' 를 흉내 낸다.
let sheetAtt = {};
const gas = createServer((req, res) => {
  const data = PEOPLE.map(p => ({
    id: `${p.name}${p.phone}`, name: p.name, phone: p.phone,
    team: 'Y1', team_no: 1, role: '조원', location: '웨슬리홀', lunch: 'X',
    attendanceByDate: sheetAtt[`${p.name}${p.phone}`] || {},
  }));
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({
    success: true, version: 29, data,
    cohortHint: COHORT, locationMap: {}, teamLinkMap: {},
    sessions: DATES.map((d, i) => ({ date: d, key: d.slice(5).replace('-', '/'), label: `${i + 18}강` })),
  }));
});
await new Promise(r => gas.listen(GAS_PORT, r));

// ---- 가짜 Supabase (PostgREST 흉내) --------------------------------------
// 표에 담긴 행과, 삭제 요청이 무엇을 지웠는지를 그대로 들고 있는다.
let attendance = [];          // { member_id, session_date, status }
let deleted = [];             // 지운 것 (검증용)
let purgeReads = 0;

const body = (req) => new Promise(r => {
  let s = ''; req.on('data', d => { s += d; }); req.on('end', () => r(s));
});

const db = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${DB_PORT}`);
  const table = url.pathname.split('/').pop();
  const send = (obj, code = 200) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };

  if (table === 'dg_members') {
    if (req.method === 'POST') {
      const rows = JSON.parse(await body(req));
      return send(rows.map(r => ({
        ...r, id: PEOPLE.find(p => p.name === r.name)?.uuid || `x-${r.name}`,
      })));
    }
    if (req.method === 'PATCH') return send([]);
    // 기존 인원 조회 · 열 확인
    return send(PEOPLE.map(p => ({ id: p.uuid, name: p.name, phone: p.phone, status: 'active' })));
  }

  if (table === 'dg_attendance') {
    if (req.method === 'POST') {
      const rows = JSON.parse(await body(req));
      for (const r of rows) {
        const i = attendance.findIndex(a =>
          a.member_id === r.member_id && a.session_date === r.session_date);
        if (i === -1) attendance.push({ ...r }); else attendance[i] = { ...r };
      }
      return send(rows);
    }
    if (req.method === 'DELETE') {
      // session_date=eq.YYYY-MM-DD & member_id=in.(a,b)
      const date = (url.searchParams.get('session_date') || '').replace('eq.', '');
      const ids = (url.searchParams.get('member_id') || '')
        .replace(/^in\.\(|\)$/g, '').split(',').map(x => x.replace(/^"|"$/g, '')).filter(Boolean);
      const before = attendance.length;
      attendance = attendance.filter(a =>
        !(a.session_date === date && ids.includes(a.member_id)));
      deleted.push({ date, ids, n: before - attendance.length });
      return send([]);
    }
    purgeReads++;
    return send(attendance.map(a => ({ member_id: a.member_id, session_date: a.session_date })));
  }

  if (req.method === 'POST' || req.method === 'PATCH') { await body(req); return send([]); }
  send([]);
});
await new Promise(r => db.listen(DB_PORT, r));

function run(flags = []) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts/sync-sheet-to-db.mjs'), ...flags], {
      env: {
        ...process.env,
        SUPABASE_URL: `http://localhost:${DB_PORT}`,
        SUPABASE_SERVICE_ROLE_KEY: 'test-key-not-real',
        GAS_API_URL: `http://localhost:${GAS_PORT}/exec`,
        COHORT_ID: COHORT,
      },
    });
    let out = '';
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { out += d; });
    child.on('close', (status) => resolve({ status, out }));
  });
}

const reset = () => { deleted = []; purgeReads = 0; };

// ==========================================================================
// 1. 시트에서 지운 칸이 DB 에서도 지워진다
// ==========================================================================
attendance = [
  { member_id: 'u1', session_date: DATES[0], status: 'O' },
  { member_id: 'u1', session_date: DATES[1], status: 'X' },   // ← 시트에서 지울 것
  { member_id: 'u2', session_date: DATES[0], status: 'O' },
];
// 시트에는 u1 의 08/09 가 없다 (사람이 지웠다).
sheetAtt = {
  '김조장1001': { [DATES[0]]: 'O' },
  '이조원2002': { [DATES[0]]: 'O' },
};
reset();
const r1 = await run();
ok('스크립트가 끝까지 돈다', r1.status === 0, `종료코드 ${r1.status}`);
ok('시트에서 지워진 칸을 DB 에서도 지운다',
   !attendance.some(a => a.member_id === 'u1' && a.session_date === DATES[1]),
   JSON.stringify(attendance));
ok('지운 건수를 알린다', /시트에서 지워진 출석 1건 삭제/.test(r1.out),
   (r1.out.match(/🧹.*/) || ['(없음)'])[0]);
ok('로그에 이름을 찍지 않는다', !/김조장|이조원/.test((r1.out.match(/🧹.*/) || [''])[0]),
   (r1.out.match(/🧹.*/) || ['(없음)'])[0]);
ok('시트에 있는 칸은 그대로 둔다',
   attendance.filter(a => a.session_date === DATES[0]).length === 2,
   JSON.stringify(attendance));
// 회차마다 왕복하면 39회차에 39번이다. 범위로 한 번에 받아야 한다.
ok('출석을 회차마다 다시 읽지 않는다', purgeReads <= 2, `${purgeReads}회 조회`);

// ==========================================================================
// 2. 시트가 모르는 회차는 안 건드린다
//
// 시트에 열이 없는 날짜는 '없다' 고 말한 적이 없다. 판단할 근거가 없으므로 둔다.
// ==========================================================================
attendance = [
  { member_id: 'u1', session_date: '2026-05-03', status: 'X' },   // 시트에 없는 회차
  { member_id: 'u1', session_date: DATES[0], status: 'O' },
];
sheetAtt = { '김조장1001': { [DATES[0]]: 'O' }, '이조원2002': {} };
reset();
await run();
ok('시트가 모르는 회차의 기록은 남는다',
   attendance.some(a => a.session_date === '2026-05-03'), JSON.stringify(attendance));

// ==========================================================================
// 3. 안전장치 — 한꺼번에 많이 지우려 하면 멈춘다
//
// GAS 가 부분 응답을 주면 전 회차가 빈칸으로 보인다. 그때 시키는 대로 지우면
// 출석이 통째로 사라지고, 되돌릴 길은 시트뿐이다.
// ==========================================================================
attendance = DATES.flatMap(d => PEOPLE.map(p => ({
  member_id: p.uuid, session_date: d, status: 'O',
})));
const before3 = attendance.length;
sheetAtt = { '김조장1001': {}, '이조원2002': {} };   // 시트가 통째로 비어 보인다
reset();
const r3 = await run();
ok('너무 많이 지우려 하면 멈춘다', r3.status !== 0, `종료코드 ${r3.status}`);
ok('아무것도 안 지운다', attendance.length === before3,
   `${before3} → ${attendance.length}건`);
ok('왜 멈췄는지 알린다', /너무 많아 멈춥니다/.test(r3.out),
   (r3.out.match(/⛔.*/) || ['(없음)'])[0]);
ok('넘기는 방법을 알려준다', /--allow-purge/.test(r3.out),
   (r3.out.match(/--allow-purge.*/) || ['(없음)'])[0]);

// 정말 지운 것이 맞다면 플래그로 넘긴다.
reset();
const r4 = await run(['--allow-purge']);
ok('--allow-purge 면 지운다', r4.status === 0 && attendance.length === 0,
   `종료코드 ${r4.status} · ${attendance.length}건 남음`);

gas.close();
db.close();

done();
