// 동기화가 GAS 를 부를 때 한 번 삐끗해도 그날 일이 통째로 날아가지 않는가.
//
// 매일 도는 일이라, 한 번 실패하면 그 하루가 그대로 옛 데이터로 남는다.
// 실제 GAS·Supabase 로 나가지 않고 가짜 서버를 세워 스크립트를 그대로 돌린다.

import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, makeReporter } from './lib/harness.mjs';

const PORT = 8087;
const { ok, done } = makeReporter('동기화 재시도');

// GAS 대역. 앞의 N 번은 404 를 주고 그 뒤로는 정상 응답한다.
let failFirst = 0;
let calls = 0;
// 읽기 열쇠 (GAS v33~). wantKey 가 있으면 진짜 GAS 처럼 ?key= 가 같을 때만 읽어 준다.
let wantKey = '';
const seenUrls = [];
const gas = createServer((req, res) => {
  calls++;
  seenUrls.push(req.url);
  if (calls <= failFirst) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  const got = new URL(req.url, 'http://x').searchParams.get('key') || '';
  if (wantKey && got !== wantKey) {
    res.end(JSON.stringify({ success: false, code: 'read-key', message: '읽기 열쇠가 맞지 않습니다.' }));
    return;
  }
  // 대상 표식이 없으면 스크립트가 스스로 멈춘다. 여기서는 그 앞까지만 본다.
  res.end(JSON.stringify({ success: true, data: [], locationMap: {}, teamLinkMap: {} }));
});
await new Promise(r => gas.listen(PORT, r));

// spawnSync 를 쓰면 안 된다. 부모의 이벤트 루프가 멈춰서 이 파일이 세운
// 가짜 GAS 서버가 자식의 요청을 받지 못한다 — 서로 기다리다 끝난다.
function run(extraEnv = {}) {
  return new Promise((resolve) => {
    // 바깥 환경에 GAS_READ_KEY 가 있어도 섞이지 않게 뺀다.
    const { GAS_READ_KEY: _drop, ...baseEnv } = process.env;
    const child = spawn(process.execPath, [join(ROOT, 'scripts/sync-sheet-to-db.mjs')], {
      env: {
        ...baseEnv,
        SUPABASE_URL: 'http://localhost:1/none',
        SUPABASE_SERVICE_ROLE_KEY: 'test-key-not-real',
        GAS_API_URL: `http://localhost:${PORT}/exec`,
        ...extraEnv,
      },
    });
    let stdout = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stdout += d; });
    child.on('close', (status) => resolve({ status, stdout }));
  });
}

// --- 한 번 삐끗해도 다시 부른다 --------------------------------------------
failFirst = 1; calls = 0;
const once = await run();
ok('404 를 한 번 받으면 다시 부른다', calls >= 2, `${calls}회 호출`);
ok('다시 받아서 진행한다', /다시 시도해서 받았습니다/.test(once.stdout),
   once.stdout.split('\n').filter(l => /GAS|시도/.test(l)).join(' | '));
// 대상 표식이 없어 그 다음 단계에서 멈추는 것이 정상 (여기까지가 이 검증의 몫)
ok('시트 읽기 단계는 넘어간다', /대상을 정할 수 없습니다/.test(once.stdout),
   once.stdout.trim().split('\n').slice(-2).join(' | '));

// --- 계속 실패하면 안내하고 멈춘다 ------------------------------------------
failFirst = 99; calls = 0;
const never = await run();
ok('끝까지 실패하면 멈춘다', never.status === 1, `종료코드 ${never.status}`);
ok('여러 번 시도한 것을 알린다', /4번 불렀지만 모두 실패/.test(never.stdout),
   never.stdout.split('\n').filter(Boolean).slice(-4).join(' | '));
ok('고칠 곳을 안내한다', /\/exec 로 끝나는지/.test(never.stdout));
ok('재배포 직후일 수 있다고 알린다', /방금 재배포했다면/.test(never.stdout));
// 배포 ID 가 로그에 남지 않는지 (실제 GAS URL 모양으로 확인)
const masked = spawnSync(process.execPath, ['-e',
  "const m=(u)=>String(u).replace(/\\/s\\/[^/]+\\//,'/s/***/');" +
  "console.log(m('https://script.google.com/macros/s/AKfycb-secret-id/exec'))"],
  { encoding: 'utf8' }).stdout.trim();
ok('로그에 배포 ID 를 남기지 않는다', masked === 'https://script.google.com/macros/s/***/exec', masked);

// --- 읽기 열쇠 (GAS v33~) ---------------------------------------------------
//
// GAS 의 doGet 주소는 앱 코드에 적혀 있어 누구나 안다. 열쇠 없이는 안 읽히게 하고
// 동기화만 열쇠를 들고 간다. **열쇠는 로그에 찍히면 안 된다** — Actions 로그는 공개다.
// 주소에 넣을 때 깨지는 글자(+ / = &)를 일부러 섞는다.
const KEY = 'k3y+With/odd=chars&1234567890abcdef';

failFirst = 0; calls = 0; seenUrls.length = 0; wantKey = '';
const noKey = await run();
ok('열쇠가 없으면 주소에 key 를 안 붙인다', seenUrls.length > 0 && seenUrls.every(u => !/[?&]key=/.test(u)),
   seenUrls.join(' | '));
ok('열쇠가 없다고 로그에 말한다', /읽기 열쇠: 없음/.test(noKey.stdout));
ok('GAS 가 안 잠겨 있으면 열쇠 없이도 읽는다', /대상을 정할 수 없습니다/.test(noKey.stdout),
   noKey.stdout.trim().split('\n').slice(-2).join(' | '));

failFirst = 0; calls = 0; seenUrls.length = 0; wantKey = KEY;
const withKey = await run({ GAS_READ_KEY: KEY });
const sentKey = new URL(seenUrls[0] || '/', 'http://x').searchParams.get('key');
ok('열쇠를 주면 주소에 실어 보낸다 (깨지지 않게)', sentKey === KEY, String(sentKey));
ok('열쇠가 맞으면 읽고 다음 단계로 간다', /대상을 정할 수 없습니다/.test(withKey.stdout),
   withKey.stdout.trim().split('\n').slice(-2).join(' | '));
ok('보냈다고만 말한다', /읽기 열쇠: 보냄/.test(withKey.stdout));
ok('열쇠 글자가 로그 어디에도 없다',
   !withKey.stdout.includes(KEY) && !withKey.stdout.includes(encodeURIComponent(KEY)),
   withKey.stdout.split('\n').filter(l => l.includes('k3y')).join(' | '));

// GAS 는 잠겼는데 열쇠를 안 보냈다 / 틀렸다 → 고칠 곳을 말하고 멈춘다. DB 는 안 건드린다.
calls = 0; seenUrls.length = 0; wantKey = KEY;
const locked = await run();
ok('잠겼는데 열쇠가 없으면 멈춘다', locked.status === 1, `종료코드 ${locked.status}`);
ok('무엇을 맞춰야 하는지 말한다',
   /GAS_READ_KEY/.test(locked.stdout) && /DG_READ_KEY/.test(locked.stdout) && /보내지 않았습니다/.test(locked.stdout),
   locked.stdout.trim().split('\n').slice(-4).join(' | '));
ok('다시 부르지 않는다 (틀린 열쇠는 몇 번을 해도 틀리다)', calls === 1, `${calls}회 호출`);

calls = 0; seenUrls.length = 0; wantKey = KEY;
const wrong = await run({ GAS_READ_KEY: 'wrong-key-000' });
ok('열쇠가 다르면 값이 다르다고 말한다',
   wrong.status === 1 && /값이 다릅니다/.test(wrong.stdout) && !wrong.stdout.includes('wrong-key-000'),
   wrong.stdout.trim().split('\n').slice(-4).join(' | '));

gas.close();
done();
