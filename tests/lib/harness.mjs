// 검증 스크립트가 함께 쓰는 것들.
//
// 경로를 어디에도 박지 않는다. 예전에는 저장소 위치와 크로미움 경로가 스크립트마다
// 박혀 있어서, 다른 컴퓨터에서는 한 줄도 돌지 않았다.

import { createServer } from 'node:http';
import { readFileSync, existsSync, statSync, mkdirSync, readdirSync } from 'node:fs';
import { join, extname, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

/** 저장소 뿌리 (tests/lib/harness.mjs 에서 두 단계 위) */
export const ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** 스크린샷을 둘 곳. 저장소를 더럽히지 않게 tests/.shots 로 (gitignore 됨) */
export const SHOT = process.env.DG_SHOT_DIR || join(ROOT, 'tests', '.shots');
mkdirSync(SHOT, { recursive: true });

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

/** 저장소를 그대로 내주는 정적 서버. 캐시는 끈다 (옛 파일을 보면 검증이 거짓이 된다) */
export async function serveRepo(port) {
  const server = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, `http://localhost:${port}`).pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = join(ROOT, p);
    if (!existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(readFileSync(file));
  });
  await new Promise(r => server.listen(port, r));
  return server;
}

/**
 * 크로미움을 띄운다.
 *
 * 1) DG_CHROMIUM 이 있으면 그것을 쓴다.
 * 2) 없으면 playwright 가 아는 자리를 그대로 쓴다 (보통 이쪽이 맞다).
 * 3) 그것도 안 되면 PLAYWRIGHT_BROWSERS_PATH 아래를 뒤진다.
 *    (컨테이너에 playwright 버전과 어긋나는 크로미움이 깔려 있는 경우)
 */
export async function launch(options = {}) {
  const explicit = process.env.DG_CHROMIUM;
  if (explicit) return chromium.launch({ executablePath: explicit, ...options });

  try {
    return await chromium.launch(options);
  } catch (err) {
    const found = findChromium();
    if (!found) throw err;
    console.log(`   (크로미움을 ${found} 에서 찾았습니다)`);
    return chromium.launch({ executablePath: found, ...options });
  }
}

function findChromium() {
  const base = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!base || !existsSync(base)) return null;
  for (const dir of readdirSync(base)) {
    if (!dir.startsWith('chromium')) continue;
    for (const rel of ['chrome-linux/chrome', 'chrome-mac/Chromium.app/Contents/MacOS/Chromium']) {
      const p = join(base, dir, rel);
      if (existsSync(p)) return p;
    }
  }
  return null;
}

/**
 * 결과를 모으고 세는 것.
 *
 * 실패한 것을 마지막에 다시 모아 보여준다 — 검사가 100건이 넘으면
 * 스크롤을 되짚어 올라가며 ❌ 를 찾게 된다.
 */
export function makeReporter(title) {
  const results = [];
  const ok = (name, pass, detail = '') => {
    results.push({ name, pass, detail });
    console.log(`${pass ? '✅' : '❌'} ${name}${detail ? ' — ' + detail : ''}`);
  };

  const done = () => {
    const failed = results.filter(r => !r.pass);
    console.log('\n' + '='.repeat(54));
    if (failed.length) {
      console.log(`❌ ${title} — 실패 ${failed.length}/${results.length}`);
      for (const f of failed) console.log(`   · ${f.name}${f.detail ? ' — ' + f.detail : ''}`);
    } else {
      console.log(`✅ ${title} — 전부 통과 (${results.length}건)`);
    }
    process.exit(failed.length ? 1 : 0);
  };

  return { ok, done, results };
}
