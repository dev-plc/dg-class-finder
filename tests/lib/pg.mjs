// 임시 Postgres — supabase/*.sql 을 **실제로** 돌려 보기 위한 것.
//
// 화면 검증은 전부 가짜 응답이라, SQL 이 맞는지는 Supabase 에 붙여 넣어 봐야 알 수 있었다
// (2단계 때 관리자 표시 SQL 이 조용히 0줄을 고치고 성공으로 끝난 것이 그 예다).
// 여기서는 이 기계에 깔린 Postgres 로 버리는 DB 를 하나 띄워, 권한 · 정책 · 함수를 진짜로 확인한다.
//
// Supabase 흉내는 최소한만 낸다:
//   · 역할 anon · authenticated · service_role(RLS 를 건너뛴다)
//   · auth.jwt() — 설정 request.jwt.claims 를 읽는다 (Supabase 와 같은 자리)
//   · auth.users — 관리자 표시 SQL 이 고치는 표
//   · 요청 머리글 — 설정 request.headers (PostgREST 가 넘겨주는 자리)

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/** initdb · pg_ctl · psql 이 있는 폴더. 없으면 null. */
export function findPgBin() {
  const candidates = [];
  if (process.env.DG_PG_BIN) candidates.push(process.env.DG_PG_BIN);
  const cfg = spawnSync('pg_config', ['--bindir'], { encoding: 'utf8' });
  if (cfg.status === 0 && cfg.stdout.trim()) candidates.push(cfg.stdout.trim());
  for (const root of ['/usr/lib/postgresql', '/usr/local/opt', '/opt/homebrew/opt']) {
    if (!existsSync(root)) continue;
    for (const v of readdirSync(root).sort().reverse()) candidates.push(join(root, v, 'bin'));
  }
  for (const dir of (process.env.PATH || '').split(':')) candidates.push(dir);
  return candidates.find(d => d && existsSync(join(d, 'initdb')) && existsSync(join(d, 'pg_ctl'))
                              && existsSync(join(d, 'psql'))) || null;
}

/**
 * 임시 DB 를 띄운다. 끝나면 반드시 stop() 을 부를 것.
 * @returns {{ sql, sqlFile, stop } | null} Postgres 가 없으면 null
 */
export function startTempPostgres({ port = 54329 } = {}) {
  const bin = findPgBin();
  if (!bin) return null;

  // Postgres 는 root 로 돌지 않는다. root 면 postgres 사용자로 바꿔 돌린다.
  const asRoot = typeof process.getuid === 'function' && process.getuid() === 0;
  const dir = mkdtempSync(join(tmpdir(), 'dg-pg-'));
  const data = join(dir, 'data');
  const run = (cmd, args, opts = {}) => {
    const full = asRoot ? ['runuser', ['-u', 'postgres', '--', join(bin, cmd), ...args]]
                        : [join(bin, cmd), args];
    return spawnSync(full[0], full[1], { encoding: 'utf8', ...opts });
  };
  if (asRoot) {
    chmodSync(dir, 0o755);
    spawnSync('chown', ['postgres', dir]);
  }

  const init = run('initdb', ['-D', data, '-U', 'postgres', '--auth=trust', '-E', 'UTF8', '--locale=C']);
  if (init.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error('initdb 실패: ' + (init.stderr || init.stdout));
  }
  const start = run('pg_ctl', ['-D', data, '-w', '-l', join(dir, 'log'),
    '-o', `-p ${port} -k ${dir} -c listen_addresses='' -c fsync=off -c synchronous_commit=off`, 'start']);
  if (start.status !== 0) {
    rmSync(dir, { recursive: true, force: true });
    throw new Error('Postgres 시작 실패: ' + (start.stderr || start.stdout));
  }

  const psql = (args, input) => run('psql',
    ['-h', dir, '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-X', '-q', '-At', ...args],
    { input });

  /**
   * SQL 을 돌린다.
   * @param {string} text
   * @param {{ role?: string, claims?: object, headers?: object, allowError?: boolean }} [as]
   *   role     'anon' · 'authenticated' · 'service_role' (없으면 주인 = SQL Editor 와 같다)
   *   claims   로그인 토큰 내용 흉내 (auth.jwt() 가 돌려준다)
   *   headers  요청 머리글 흉내 (x-forwarded-for 등)
   * @returns {{ ok, out, err, rows }} rows = 줄 단위 출력
   */
  const sql = (text, as = {}) => {
    const pre = [];
    const lit = (v) => `'${String(v).replace(/'/g, "''")}'`;
    pre.push(`select set_config('request.jwt.claims', ${lit(as.claims ? JSON.stringify(as.claims) : '')}, false);`);
    pre.push(`select set_config('request.headers', ${lit(as.headers ? JSON.stringify(as.headers) : '')}, false);`);
    if (as.role) pre.push(`set role ${as.role};`);
    // 앞머리(set_config)의 출력은 버린다 — 구분 줄 뒤만 결과로 본다.
    const script = `\\o /dev/null\n${pre.join('\n')}\n\\o\n${text}\n`;
    const r = psql(['-v', 'ON_ERROR_STOP=1', '-f', '-'], script);
    const ok = r.status === 0;
    if (!ok && !as.allowError) {
      throw new Error(`SQL 실패:\n${text.slice(0, 300)}\n→ ${r.stderr.trim()}`);
    }
    const out = (r.stdout || '').trim();
    return { ok, out, err: (r.stderr || '').trim(), rows: out ? out.split('\n') : [] };
  };

  /** 저장소의 SQL 파일을 주인으로 돌린다 (SQL Editor 에 붙여 넣는 것과 같다). */
  // 파일은 여기서 읽어 넘긴다 — postgres 사용자는 저장소 폴더를 못 읽을 수 있다.
  const sqlFile = (path, { allowError = false, transform = (t) => t } = {}) => {
    const r = psql(['-v', 'ON_ERROR_STOP=1', '-f', '-'], transform(readFileSync(path, 'utf8')));
    if (r.status !== 0 && !allowError) throw new Error(`${path} 실패 → ${r.stderr.trim()}`);
    return { ok: r.status === 0, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
  };

  const stop = () => {
    run('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop']);
    rmSync(dir, { recursive: true, force: true });
  };

  // Supabase 가 미리 갖춰 두는 것들.
  sql(`
    create role anon nologin;
    create role authenticated nologin;
    create role service_role nologin bypassrls;
    grant usage on schema public to anon, authenticated, service_role;
    create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    create function auth.jwt() returns jsonb language sql stable as $f$
      select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb;
    $f$;
    create table auth.users (
      id uuid primary key default gen_random_uuid(),
      email text unique,
      raw_app_meta_data jsonb,
      email_confirmed_at timestamptz
    );
  `);

  return { sql, sqlFile, stop };
}
