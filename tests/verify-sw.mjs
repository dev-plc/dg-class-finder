// Service Worker 자동 업데이트 검증.
// 실제 Chromium 으로 배포 → 재배포 → 탭 복귀 흐름을 재현한다.

import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT, serveRepo, launch, makeReporter } from './lib/harness.mjs?v=108';

// 이 검증은 '재배포' 를 흉내내려고 실제로 자산 버전을 올린다. 끝나면 되돌린다 —
// 검사를 돌렸다는 이유로 커밋할 것이 생기면 안 된다.
const readVersion = () =>
  readFileSync(join(ROOT, 'sw.js'), 'utf8').match(/const CACHE_VERSION = 'dgf-v(\d+)'/)[1];
const VERSION_BEFORE = readVersion();
process.on('exit', () => {
  if (readVersion() === VERSION_BEFORE) return;
  execSync(`node scripts/bump-version.mjs ${VERSION_BEFORE}`, { cwd: ROOT, stdio: 'pipe' });
  console.log(`   (자산 버전 되돌림: v${VERSION_BEFORE})`);
});

const PORT = 8090;
const server = await serveRepo(PORT);
const BASE = `http://localhost:${PORT}/`;
console.log(`서버: ${BASE}`);

const { ok, done } = makeReporter('Service Worker');

const browser = await launch();

// ---------------------------------------------------------------------------
// 준비: 페이지마다 로드 횟수를 세고, Supabase 는 빈 응답으로 대신한다
// (컨테이너에서 supabase.co 로 나갈 수 없고, 이 검증의 관심사도 아니다)
// ---------------------------------------------------------------------------
async function newPage(context) {
  await context.addInitScript(() => {
    const n = Number(sessionStorage.getItem('loadCount') || 0) + 1;
    sessionStorage.setItem('loadCount', String(n));
  });
  const page = await context.newPage();
  await page.route('**/rest/v1/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('**/script.google.com/**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true,"data":[]}' }));
  page.on('dialog', d => d.dismiss().catch(() => {}));
  return page;
}

const loadCount = (page) => page.evaluate(() => Number(sessionStorage.getItem('loadCount') || 0));
const swState = (page) => page.evaluate(async () => {
  const r = await navigator.serviceWorker.getRegistration();
  return { hasReg: !!r, controlled: !!navigator.serviceWorker.controller };
});

// ===========================================================================
// 검증 3: 첫 방문(시크릿 창)에서 리로드가 일어나지 않는가
// ===========================================================================
{
  const context = await browser.newContext();
  const page = await newPage(context);
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForTimeout(3000);

  const count = await loadCount(page);
  const st = await swState(page);
  ok('3. 첫 방문에 리로드 없음', count === 1, `load ${count}회, SW등록=${st.hasReg}`);
  await context.close();
}

// ===========================================================================
// 검증 1·2: 재배포 후 탭 복귀 → 토스트 + 리로드 1회
// ===========================================================================
{
  const context = await browser.newContext();
  const page = await newPage(context);

  // 1차 배포 상태로 방문 → SW 가 페이지를 제어하게 만든다
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 })
    .catch(() => {});
  // 실제 사용자는 '이미 SW 의 제어를 받는 페이지' 에서 재배포를 맞는다.
  // 첫 방문 직후 상태와 구분하기 위해 한 번 새로고침해 그 상태를 만든다.
  await page.reload({ waitUntil: 'load' });
  await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 })
    .catch(() => {});
  const before = await loadCount(page);
  const stBefore = await swState(page);

  // === 재배포 시뮬레이션 ===
  execSync('node scripts/bump-version.mjs', { cwd: ROOT, stdio: 'pipe' });
  console.log('   (재배포: 버전 +1)');

  // 토스트는 0.6초 뒤 리로드에 휩쓸려 사라진다. waitForSelector 로 잡으려 하면
  // 리로드와 경쟁해서 있었는데도 못 봤다고 나온다. 페이지 안에서 지켜보다가
  // sessionStorage 에 적어 두게 한다 (리로드를 넘어 남는다).
  await page.evaluate(() => {
    sessionStorage.removeItem('dg_test_toast');
    new MutationObserver(() => {
      const t = document.getElementById('swUpdateToast');
      if (t && t.classList.contains('visible')) sessionStorage.setItem('dg_test_toast', t.textContent);
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true });
  });

  // 탭으로 돌아옴 → visibilitychange 핸들러가 registration.update() 를 부른다
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(3000);
  const toastText = await page.evaluate(() => sessionStorage.getItem('dg_test_toast'));
  ok('1. 새 버전 감지 → 토스트 표시', !!toastText, toastText || '(못 봄)');

  // 리로드 대기
  await page.waitForTimeout(6000);
  const after = await loadCount(page);
  ok('1. 자동 리로드 발생', after > before, `load ${before} → ${after}회`);
  ok('2. 리로드가 한 번만 (무한루프 없음)', after === before + 1, `load ${before} → ${after}회`);

  // 추가로 5초 더 지켜본다 — 루프가 있으면 계속 늘어난다
  await page.waitForTimeout(5000);
  const settled = await loadCount(page);
  ok('2. 리로드 후 안정 (추가 리로드 없음)', settled === after, `최종 ${settled}회`);
  console.log(`   SW 제어 상태: 갱신전 ${JSON.stringify(stBefore)}`);

  // =========================================================================
  // 검증 4: 오프라인에서 캐시로 뜨는가
  // =========================================================================
  await context.setOffline(true);
  let offlineOk = false, title = '';
  try {
    await page.reload({ waitUntil: 'load', timeout: 15000 });
    title = await page.title();
    offlineOk = await page.evaluate(() => !!document.getElementById('searchBtn'));
  } catch (e) {
    offlineOk = false; title = `실패: ${e.message.split('\n')[0]}`;
  }
  ok('4. 오프라인에서 캐시로 렌더', offlineOk, `title="${title}"`);
  await context.setOffline(false);

  await context.close();
}

await browser.close();
server.close();

done();
