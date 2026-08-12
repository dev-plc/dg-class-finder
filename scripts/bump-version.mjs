// 자산 버전을 저장소 전체에서 한 번에 올린다.
//
//   node scripts/bump-version.mjs           현재 버전 +1
//   node scripts/bump-version.mjs 12        12 으로 지정
//   node scripts/bump-version.mjs --check   올리지 않고 어긋난 곳만 보고 (CI 용)
//
// 왜 스크립트인가:
//   버전을 손으로 고치면 반드시 한 곳을 빠뜨린다. plc-class-finder 에서
//   HTML 의 <script> 태그만 올리고 JS 의 import 를 빠뜨려, 진입점만 새 파일이고
//   그 아래 모듈 체인은 전부 캐시에서 나오는 상태로 몇 시간을 보냈다.
//   빠뜨릴 수 있는 자리를 없애는 게 이 파일의 존재 이유다.
//
// 건드리는 곳
//   - HTML 의 <script src> · <link href>  (로컬 경로만)
//   - JS 의 import/export ... from 뒤 상대경로 (./ 또는 ../ 로 시작하는 것만)
//   - sw.js 의 CACHE_VERSION 과 PRECACHE_URLS
//
// 아래 주석에 import 예시를 따옴표째 적지 말 것 — 이 스크립트가 자기 주석까지 고친다.
//
// 건드리지 않는 곳
//   - 외부 URL (https://www.gstatic.com/... 등) — ?v= 를 붙이면 깨진다
//   - scripts/gas/ — Apps Script 소스이지 웹 자산이 아니다

import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SW_PATH = join(ROOT, 'sw.js');

const EXCLUDE_DIRS = new Set(['node_modules', '.git', 'images', 'icons', 'assets']);
const EXCLUDE_PATHS = ['scripts/gas/', '교리교육 조배치 검색기/'];
const EXTS = /\.(html|js|mjs|css)$/i;

const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const explicit = args.find(a => /^\d+$/.test(a));

// ---------------------------------------------------------------- 현재 버전
const swSource = readFileSync(SW_PATH, 'utf8');
const currentMatch = swSource.match(/const CACHE_VERSION = 'dgf-v(\d+)'/);
if (!currentMatch) {
  console.log("❌ sw.js 에서 CACHE_VERSION 을 찾지 못했습니다 ('dgf-vNN' 형식이어야 합니다).");
  process.exit(1);
}
const CURRENT = parseInt(currentMatch[1], 10);
const NEXT = CHECK_ONLY ? CURRENT : (explicit ? parseInt(explicit, 10) : CURRENT + 1);

if (!CHECK_ONLY && NEXT <= CURRENT && !explicit) {
  console.log(`❌ 새 버전(${NEXT})이 현재(${CURRENT})보다 크지 않습니다.`);
  process.exit(1);
}

// ------------------------------------------------------------------ 파일 수집
function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (EXCLUDE_DIRS.has(entry)) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (EXTS.test(entry)) out.push(full);
  }
  return out;
}

const files = walk(ROOT).filter(f => {
  const rel = relative(ROOT, f);
  return !EXCLUDE_PATHS.some(p => rel.startsWith(p));
});

// ------------------------------------------------------------------ 치환 규칙
//
// 어느 규칙이든 로컬 경로만 잡는다. https:// · // · data: 로 시작하면 건너뛴다.

// HTML: <script src="x.js"> · <link href="x.css">
const HTML_ASSET = /((?:src|href)=")(?!https?:|\/\/|data:|#|mailto:)([^"?]+?\.(?:js|mjs|css))(\?v=\d+)?(")/gi;

// JS: import/export ... from 뒤의 상대경로.
// . 으로 시작하는 것만 잡아 외부 CDN (https://www.gstatic.com/...) 을 제외한다.
const JS_IMPORT = /((?:from|import)\s*['"])(\.\.?\/[^'"?]+?\.(?:js|mjs))(\?v=\d+)?(['"])/g;

// sw.js 의 PRECACHE_URLS 안 상대경로 문자열 (버전 예시를 여기 적지 말 것)
const SW_PRECACHE = /(['"]\.\/[^'"?]+?\.(?:js|mjs|css))(\?v=\d+)?(['"])/g;

function applyTo(file, source) {
  const rel = relative(ROOT, file);
  let out = source;

  if (/\.html$/i.test(rel)) {
    out = out.replace(HTML_ASSET, (_m, pre, path, _old, post) => `${pre}${path}?v=${NEXT}${post}`);
  } else if (/\.(js|mjs)$/i.test(rel)) {
    out = out.replace(JS_IMPORT, (_m, pre, path, _old, post) => `${pre}${path}?v=${NEXT}${post}`);
    out = out.replace(/admin\.html\?v=\d+/g, `admin.html?v=${NEXT}`);
    if (rel === 'sw.js') {
      out = out.replace(/const CACHE_VERSION = 'dgf-v\d+'/, `const CACHE_VERSION = 'dgf-v${NEXT}'`);
      out = out.replace(SW_PRECACHE, (_m, path, _old, post) => `${path}?v=${NEXT}${post}`);
    }
  }

  return out;
}

// ---------------------------------------------------------------------- 실행
const changed = [];
for (const file of files) {
  const source = readFileSync(file, 'utf8');
  const next = applyTo(file, source);
  if (next !== source) {
    changed.push(relative(ROOT, file));
    if (!CHECK_ONLY) writeFileSync(file, next);
  }
}

if (CHECK_ONLY) {
  if (changed.length) {
    console.log(`❌ 버전이 어긋난 파일 ${changed.length}개 (현재 v${CURRENT} 기준):`);
    for (const f of changed) console.log(`   ${f}`);
    console.log('\n   node scripts/bump-version.mjs 로 맞추세요.');
    process.exit(1);
  }
  console.log(`✅ 전부 v${CURRENT} 로 일치합니다.`);
  process.exit(0);
}

console.log(`🔖 v${CURRENT} → v${NEXT}`);
if (changed.length) {
  console.log(`\n바뀐 파일 ${changed.length}개:`);
  for (const f of changed) console.log(`   ${f}`);
} else {
  console.log('\n바뀐 파일 없음 (이미 그 버전입니다).');
}

// 빠진 곳이 없는지 스스로 확인한다. 이 스크립트의 존재 이유가 그것이므로
// 통과하지 못하면 실패로 끝내는 게 맞다.
const stale = [];
for (const file of files) {
  const rel = relative(ROOT, file);
  const source = readFileSync(file, 'utf8');
  for (const m of source.matchAll(/\?v=(\d+)/g)) {
    if (parseInt(m[1], 10) !== NEXT) stale.push(`${rel} (?v=${m[1]})`);
  }
}
if (stale.length) {
  console.log(`\n❌ 옛 버전이 남았습니다:`);
  for (const s of stale) console.log(`   ${s}`);
  process.exit(1);
}

console.log(`\n✅ 저장소 전체가 v${NEXT} 로 일치합니다.`);

// GAS 는 별도 버전을 쓴다 (자산 ?v= 와 무관). 다만 파일 머리말과 DG_VERSION 이
// 어긋나면 "어느 버전을 올린 거지" 로 헤매게 되므로 여기서 같이 봐 준다.
try {
  const gas = readFileSync(join(ROOT, 'scripts/gas/doGet.js'), 'utf8');
  const constV = gas.match(/var DG_VERSION = (\d+)/)?.[1];
  const headV = gas.match(/Google Apps Script 전체 코드 \(v(\d+)\)/)?.[1];
  if (constV && headV && constV !== headV) {
    console.log(`\n⚠️ GAS 버전 표기가 어긋납니다: 머리말 v${headV} · DG_VERSION ${constV}`);
    console.log('   둘을 맞추세요 (배포한 버전을 알 수 없게 됩니다).');
  }
} catch { /* GAS 파일이 없으면 넘어간다 */ }
