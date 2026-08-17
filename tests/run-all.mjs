// 검증 전부 돌린다.  node tests/run-all.mjs [이름조각 ...]
//
//   node tests/run-all.mjs              전부
//   node tests/run-all.mjs print att    이름에 그 글자가 든 것만
//
// 하나가 실패해도 끝까지 돌린다 — 처음 실패에서 멈추면 나머지 상태를 모른다.

import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const filter = process.argv.slice(2);

const files = readdirSync(HERE)
  .filter(f => f.startsWith('verify-') && f.endsWith('.mjs'))
  .filter(f => !filter.length || filter.some(k => f.includes(k)))
  .sort();

if (!files.length) {
  console.log(`돌릴 것이 없습니다 (${filter.join(', ')})`);
  process.exit(1);
}

const out = [];
for (const f of files) {
  console.log(`\n${'─'.repeat(54)}\n▶ ${f}\n${'─'.repeat(54)}`);
  const r = spawnSync(process.execPath, [join(HERE, f)], { stdio: 'inherit' });
  out.push({ f, code: r.status ?? 1 });
}

console.log(`\n${'═'.repeat(54)}`);
for (const { f, code } of out) console.log(`${code === 0 ? '✅' : '❌'} ${f}`);
const bad = out.filter(o => o.code !== 0);
console.log(bad.length ? `\n❌ ${bad.length}/${out.length} 실패` : `\n✅ ${out.length}개 전부 통과`);
process.exit(bad.length ? 1 : 0);
