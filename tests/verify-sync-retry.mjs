// 동기화가 GAS 를 부를 때 한 번 삐끗해도 그날 일이 통째로 날아가지 않는가.
//
// 매일 도는 일이라, 한 번 실패하면 그 하루가 그대로 옛 데이터로 남는다.
// 실제 GAS·Supabase 로 나가지 않고 가짜 서버를 세워 스크립트를 그대로 돌린다.

import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { ROOT, makeReporter } from './lib/harness.mjs?v=108';

const PORT = 8087;
const { ok, done } = makeReporter('동기화 재시도');

// GAS 대역. 앞의 N 번은 404 를 주고 그 뒤로는 정상 응답한다.
let failFirst = 0;
let calls = 0;
const gas = createServer((req, res) => {
  calls++;
  if (calls <= failFirst) { res.writeHead(404); res.end('not found'); return; }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  // 대상 표식이 없으면 스크립트가 스스로 멈춘다. 여기서는 그 앞까지만 본다.
  res.end(JSON.stringify({ success: true, data: [], locationMap: {}, teamLinkMap: {} }));
});
await new Promise(r => gas.listen(PORT, r));

// spawnSync 를 쓰면 안 된다. 부모의 이벤트 루프가 멈춰서 이 파일이 세운
// 가짜 GAS 서버가 자식의 요청을 받지 못한다 — 서로 기다리다 끝난다.
function run() {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(ROOT, 'scripts/sync-sheet-to-db.mjs')], {
      env: {
        ...process.env,
        SUPABASE_URL: 'http://localhost:1/none',
        SUPABASE_SERVICE_ROLE_KEY: 'test-key-not-real',
        GAS_API_URL: `http://localhost:${PORT}/exec`,
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

gas.close();
done();
