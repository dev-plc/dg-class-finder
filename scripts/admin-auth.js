// scripts/admin-auth.js
//
// 관리자 로그인 — Supabase Auth 를 fetch 로 직접 부른다 (supabase-js 없이).
//
// ⚠️ **이 파일이 막는 것은 없다.** 브라우저 코드는 누구나 고쳐 쓸 수 있다.
// 실제로 막는 것은 서버 둘이다:
//   · DB   — 나이 · 담당교역자는 관리자 표시(dg_admin)가 든 토큰에만 준다
//            (supabase/dg_admin.sql · dg_admin_lock.sql)
//   · GAS  — 동기화 실행 · 출석 기록 지우기는 토큰을 Supabase 에 확인한 뒤에만 한다
//            (scripts/gas/doGet.js v34 · DG_isAdmin_)
// 여기는 그 토큰을 **받아 오고 보관하고 새로 받는** 일만 한다.
//
// 예전에는 script.js 가 `id === … && pw === …` 로 견줬고(비밀번호가 공개 코드에 있었다),
// admin.js 는 sessionStorage.adminLoggedIn 이 **있기만 하면** 들여보냈다. 둘 다 없앴다.
//
// 계정 · 비밀번호는 Supabase 대시보드에만 있다. 코드 · 문서 · 채팅에 적지 않는다.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './supabase-config.js?v=134';

const AUTH = `${SUPABASE_URL}/auth/v1`;
const SESSION_KEY = 'dg_admin_session_v1';
// 화면에서는 아이디만 쳐도 된다. '@' 가 없으면 이 도메인을 붙여 Supabase 계정(메일)으로 본다.
// 메일을 통째로 쳐도 된다 — 다른 도메인의 계정도 그렇게 들어온다.
// 어떤 계정이 관리자인지는 여기 적지 않는다 (대시보드 Authentication → Users).
export const ADMIN_EMAIL_DOMAIN = 'plch.or.kr';
// 토큰은 1시간짜리다. 만료 이만큼 전부터는 새로 받는다 — 출석부를 오래 띄워 두는 화면이다.
const REFRESH_MARGIN_MS = 60 * 1000;

/** 로그인이 틀렸거나 권한이 없을 때. message 는 화면에 그대로 보여도 되는 문구다. */
export class AdminAuthError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'AdminAuthError';
    this.code = code;   // 'invalid' | 'not-admin' | 'network' | 'expired'
  }
}

function toEmail(id) {
  const v = String(id || '').trim();
  return v.includes('@') ? v : `${v}@${ADMIN_EMAIL_DOMAIN}`;
}

// --- 세션 보관 (sessionStorage — 탭을 닫으면 로그아웃) ------------------------

function readSession() {
  try {
    const s = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    return s && s.access_token ? s : null;
  } catch { return null; }
}

function writeSession(tokenResponse) {
  const s = {
    access_token: tokenResponse.access_token,
    refresh_token: tokenResponse.refresh_token || '',
    // expires_at(초)을 주면 그것을, 아니면 expires_in 으로 계산한다.
    expires_at_ms: tokenResponse.expires_at
      ? tokenResponse.expires_at * 1000
      : Date.now() + (tokenResponse.expires_in || 3600) * 1000,
  };
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); } catch { /* 무시 */ }
  return s;
}

function clearSession() {
  try { sessionStorage.removeItem(SESSION_KEY); } catch { /* 무시 */ }
}

/**
 * 세션이 **있어 보이는가** — 동기, 화면을 그리기 전 빠른 판단용.
 * 맞는 토큰인지는 모른다. 서버가 판단한다 (verifyAdmin · DB · GAS).
 */
export function hasAdminSession() {
  return !!readSession();
}

const isAdminUser = (user) => user?.app_metadata?.dg_admin === true;

async function postToken(grant, body) {
  let res;
  try {
    res = await fetch(`${AUTH}/token?grant_type=${grant}`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new AdminAuthError('로그인 서버에 연결하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'network');
  }
  return res;
}

/**
 * 로그인. 성공하면 세션을 보관한다.
 * @throws {AdminAuthError} 틀렸거나(invalid) · 관리자가 아니거나(not-admin) · 연결 실패(network)
 */
export async function adminSignIn(id, password) {
  const res = await postToken('password', { email: toEmail(id), password: String(password || '') });

  if (!res.ok) {
    // 400 = 틀린 아이디/비밀번호. 429 = 너무 많이 틀렸다 (Supabase 가 막는다).
    if (res.status === 429) {
      throw new AdminAuthError('잠시 후 다시 시도해 주세요. (시도가 너무 많습니다)', 'invalid');
    }
    if (res.status >= 500) {
      throw new AdminAuthError('로그인 서버에 문제가 있습니다. 잠시 후 다시 시도해 주세요.', 'network');
    }
    throw new AdminAuthError('아이디 또는 비밀번호가 틀렸습니다.', 'invalid');
  }

  const data = await res.json();
  // 로그인은 됐지만 관리자 표시가 없는 계정. 토큰을 버린다 — 들고 있어 봐야
  // DB 도 GAS 도 관리자로 안 본다.
  if (!isAdminUser(data.user)) {
    throw new AdminAuthError('관리자 권한이 없는 계정입니다.', 'not-admin');
  }
  writeSession(data);
  return true;
}

let refreshing = null;

async function refreshSession(session) {
  if (!session.refresh_token) return null;
  // 여러 요청이 한꺼번에 새로 받으려 들면 refresh_token 이 한 번만 유효해서 뒤엣것이 실패한다.
  if (!refreshing) {
    refreshing = (async () => {
      try {
        const res = await postToken('refresh_token', { refresh_token: session.refresh_token });
        if (!res.ok) { clearSession(); return null; }
        const data = await res.json();
        if (!isAdminUser(data.user)) { clearSession(); return null; }
        return writeSession(data);
      } catch {
        return null;   // 연결 실패 — 세션은 지우지 않는다 (잠깐 끊긴 것일 수 있다)
      } finally {
        refreshing = null;
      }
    })();
  }
  return refreshing;
}

/**
 * 지금 쓸 수 있는 관리자 토큰. 없으면 null.
 *
 * 만료가 가까우면 새로 받는다. DB(RPC) · GAS 에 보낼 때 이것을 쓴다.
 * 조회 화면(index.html)에서는 세션이 없으므로 늘 null 이다.
 */
export async function getAdminToken() {
  const session = readSession();
  if (!session) return null;
  if (session.expires_at_ms - Date.now() > REFRESH_MARGIN_MS) return session.access_token;
  const fresh = await refreshSession(session);
  return fresh ? fresh.access_token : null;
}

/**
 * 서버에 물어 확인한다 — 이 토큰이 살아 있고 관리자 것인가.
 *
 * @returns {'ok' | 'denied' | 'unknown'}
 *   denied  = 서버가 아니라고 했다 → 내보낸다
 *   unknown = 연결이 안 됐다 → 내보내지 않는다 (잠깐 끊긴 것으로 쫓아내면 작업을 잃는다.
 *             그 상태로는 어차피 DB · GAS 가 아무것도 안 준다)
 */
export async function verifyAdmin() {
  const token = await getAdminToken();
  if (!token) return hasAdminSession() ? 'unknown' : 'denied';
  let res;
  try {
    res = await fetch(`${AUTH}/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` },
    });
  } catch {
    return 'unknown';
  }
  if (res.status === 401 || res.status === 403) { clearSession(); return 'denied'; }
  if (!res.ok) return 'unknown';
  const user = await res.json().catch(() => null);
  if (!isAdminUser(user)) { clearSession(); return 'denied'; }
  return 'ok';
}

/** 로그아웃. 서버에도 알리지만, 실패해도 이쪽 세션은 지운다. */
export async function adminSignOut() {
  const session = readSession();
  clearSession();
  if (!session) return;
  try {
    await fetch(`${AUTH}/logout`, {
      method: 'POST',
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` },
    });
  } catch { /* 무시 */ }
}
