// scripts/members-data.js
//
// 데이터 접근 계층. UI 는 이 파일의 함수만 쓰고 백엔드를 알지 못한다.
// 백엔드를 또 바꾸더라도 화면 코드는 건드리지 않는다.
//
// 원본 분담
//   조회(명단·조·위치·배치도·안내방)  Supabase 가 원본. 시트에서 일 1회 동기화된다.
//   출석                              시트가 원본. 쓰기는 GAS 로 가고, DB 는 비추기만 한다.
//
// 출석만 GAS 를 계속 쓰는 이유: 동기화가 하루 한 번이라 DB 값은 그날 안에 뒤처진다.
// 조장이 조원 명단을 열 때는 시트에서 바로 읽어와야 방금 체크한 것이 보인다.

// import 에 붙은 ?v= 는 캐시 무효화용이다. 이 파일들을 고치면 번호를 함께 올린다.
import { matches as hangulMatches } from './hangul.js?v=19';
import { sbSelect, getActiveCohortId, getCachedCohortId } from './supabase-config.js?v=19';

export const MODULE_VERSION = 'dg members-data v1 (Supabase 조회 + GAS 출석)';

// 출석 읽기·쓰기 전용. 조회 경로는 이 URL 을 타지 않는다.
const GAS_API_URL =
  'https://script.google.com/macros/s/AKfycbz1tpAmZB0NEHX0TppV-wrq7ud4IG5PmwukVNuZNT5y46tucKpSyRDnfjLosAyno90r2A/exec';

// ============================================================================
// 캐시
// ============================================================================
const CACHE_VERSION = 1;
const CK = {
  members:     `dg_members_v${CACHE_VERSION}`,
  locationMap: `dg_location_map_v${CACHE_VERSION}`,
  teamLinks:   `dg_team_links_v${CACHE_VERSION}`,
  sessions:    `dg_sessions_v${CACHE_VERSION}`,
  cohort:      `dg_cohort_v${CACHE_VERSION}`,
};

const state = {
  cohortId: null,
  members: [],
  locationMap: {},
  teamLinks: {},
  sessions: [],     // [{ key:'11/02', date:'2025-11-02' }] — 연도는 GAS 가 확정한다
  session: '',      // 지금 보고 있는 회차 (YYYY-MM-DD)
  today: '',        // GAS 기준 오늘. 미래 회차를 거르는 데 쓴다.
  loaded: false,
};
const subscribers = new Set();

function notify(event) {
  for (const cb of subscribers) {
    try { cb(event); } catch (e) { console.log('subscriber error', e); }
  }
}

function readCacheSync() {
  try {
    const m = localStorage.getItem(CK.members);
    if (!m) return false;
    const get = (k, fallback) => {
      const v = localStorage.getItem(k);
      return v ? JSON.parse(v) : fallback;
    };
    state.members     = JSON.parse(m);
    state.locationMap = get(CK.locationMap, {});
    state.teamLinks   = get(CK.teamLinks, {});
    state.sessions    = get(CK.sessions, []);
    state.cohortId    = localStorage.getItem(CK.cohort) || getCachedCohortId();
    state.loaded = true;
    return true;
  } catch (e) {
    console.log('캐시 읽기 실패, 무시:', e);
    return false;
  }
}

function writeCacheSync() {
  try {
    localStorage.setItem(CK.members,     JSON.stringify(state.members));
    localStorage.setItem(CK.locationMap, JSON.stringify(state.locationMap));
    localStorage.setItem(CK.teamLinks,   JSON.stringify(state.teamLinks));
    localStorage.setItem(CK.sessions,    JSON.stringify(state.sessions));
    if (state.cohortId) localStorage.setItem(CK.cohort, state.cohortId);
  } catch (e) {
    console.log('캐시 쓰기 실패, 무시:', e);
  }
}

// ============================================================================
// DB → UI 형태 변환
//
// 화면이 member.team · member.telegramLink 처럼 직접 읽고 있어
// 그 모양을 유지한다 (UI 변경을 피하려는 의도).
// ============================================================================
function buildMemberRow(m, teamLinks, attByMember) {
  return {
    id: `${m.name}${m.phone || ''}`,
    _uuid: m.id,
    name: m.name,
    phone: m.phone || '',
    team: m.team || '',
    team_no: m.team_no ?? '',
    location: m.location || '',
    role: m.role || '',
    lunch: m.lunch || '',
    telegramLink: teamLinks[m.team] || '',
    attendance: attByMember.get(m.id) || '',
  };
}

// ============================================================================
// 서버 통신
// ============================================================================
// 'YYYY-MM-DD' (로컬 기준). 시트도 같은 시간대를 쓴다.
function todayISO() {
  return new Date().toLocaleDateString('sv-SE');
}

async function fetchFromServer(cohortId) {
  const enc = encodeURIComponent(cohortId);

  const [members, teamLinkRows, locationRows, attendance] = await Promise.all([
    sbSelect(`dg_members?select=*&cohort_id=eq.${enc}&status=eq.active&order=team,team_no`),
    // order 가 있어야 sbSelect 가 1000행 넘게 나눠 받는다.
    sbSelect(`dg_team_links?select=team,chat_url&cohort_id=eq.${enc}&order=team`),
    sbSelect('dg_locations?select=location,image_url,detail_url&order=location'),
    // 오늘 회차의 출석만 가져온다.
    //
    // 전 회차를 받아 '멤버별 가장 최근 행' 을 쓰면 안 된다. 동기화가 빈 값을
    // 건너뛰기 때문에 각자 마지막으로 출석한 회차의 O 가 남아, 오늘 아무도
    // 체크하지 않았는데 전원 출석한 것처럼 보인다.
    // 체크박스가 뜻하는 것은 언제나 '오늘' 이다.
    sbSelect(`dg_attendance?select=member_id,status,` +
             `dg_members!inner(cohort_id)&dg_members.cohort_id=eq.${enc}` +
             `&session_date=eq.${todayISO()}&order=member_id`),
  ]);

  const teamLinks = {};
  for (const t of teamLinkRows) if (t.team) teamLinks[t.team] = t.chat_url || '';

  const locationMap = {};
  for (const l of locationRows) {
    if (!l.location) continue;
    locationMap[l.location] = l.image_url || '';
    if (l.detail_url) locationMap[`${l.location}링크`] = l.detail_url;
  }

  // 위에서 오늘 회차로 좁혀 왔으므로 멤버당 한 행이다.
  // 오늘 회차가 없으면 비어 있고, 체크박스는 전부 해제된 상태로 뜬다 (그게 맞다).
  const attByMember = new Map();
  for (const a of attendance) attByMember.set(a.member_id, a.status ?? '');

  return {
    members: members.map(m => buildMemberRow(m, teamLinks, attByMember)),
    locationMap,
    teamLinks,
  };
}

// ============================================================================
// 공개 API — 조회
// ============================================================================

export function loadCache() {
  return readCacheSync();
}

export async function refresh() {
  const cohortId = await getActiveCohortId();
  const previous = state.cohortId;
  const fresh = await fetchFromServer(cohortId);
  Object.assign(state, fresh, { cohortId, loaded: true });
  writeCacheSync();

  if (previous && previous !== cohortId) {
    console.log(`대상 전환 감지: ${previous} → ${cohortId}`);
    notify({ type: 'cohort-changed', from: previous, to: cohortId });
  }
  notify({ type: 'refresh' });
  return true;
}

/**
 * 캐시가 있으면 즉시 쓰고 뒤에서 갱신한다. 없으면 받아올 때까지 기다린다.
 */
export async function ensureLoaded({ forceRefresh = false, onBackgroundRefreshError } = {}) {
  const cacheHit = !forceRefresh && loadCache();
  if (cacheHit) {
    notify({ type: 'cache-hit' });
    refresh().catch(err => {
      console.log('백그라운드 refresh 실패:', err);
      onBackgroundRefreshError?.(err);
    });
    return { cacheHit: true, backgroundRefreshing: true };
  }
  await refresh();
  return { cacheHit: false, backgroundRefreshing: false };
}

export function getMembers() {
  return state.members;
}

export function getCohortId() {
  return state.cohortId;
}

/**
 * (name, phone) 로 단일 인원 조회.
 * 정확 매칭 우선, 실패하면 초성·부분 매칭 (전화번호는 정확 일치 필수).
 */
export function findMember(name, phone) {
  const cleanName = (name || '').trim().replace(/\s/g, '');
  const cleanPhone = (phone || '').trim().replace(/[^0-9]/g, '');
  if (!cleanName || !cleanPhone) return null;

  const target = cleanName + cleanPhone;
  const exact = state.members.find(m => m.id === target || (m.name + m.phone) === target);
  if (exact) return exact;

  return state.members.find(m => m.phone === cleanPhone && hangulMatches(m.name, cleanName)) || null;
}

export function getTeamMembers(teamName) {
  if (!teamName) return [];
  return state.members.filter(m => m.team === teamName);
}

export function getLocationImage(location) {
  if (!location) return null;
  return state.locationMap[String(location).trim()] || null;
}

export function getTeamLink(teamName) {
  if (!teamName) return null;
  return state.teamLinks[teamName] || null;
}

// ============================================================================
// 공개 API — 출결
//
// 출결의 원본은 시트다. 쓰기는 GAS 를 거쳐 시트로 가고, DB 는 비추기만 한다.
// 두 곳에서 쓰면 어느 쪽이 최신인지 판단할 근거가 사라지기 때문이다.
// 화면은 아래 함수들만 쓰고 그 사실을 알 필요가 없다.
// ============================================================================

/**
 * 시트에서 회차 목록과 출결을 통째로 다시 읽는다.
 *
 * 조장이 조원 명단을 열 때 한 번 부른다. DB 는 동기화 간격만큼 뒤처지므로
 * 방금 체크한 것을 보이게 하려면 원본을 읽어야 한다.
 * 회차 목록도 같이 오므로 GAS 왕복은 한 번이면 된다.
 */
export async function refreshAttendance() {
  const res = await fetch(`${GAS_API_URL}?t=${Date.now()}`);
  const result = await res.json();
  if (!result.success) throw new Error(result.message || '출결 조회 실패');

  // 회차 — 연도는 GAS 가 확정해서 준다. 여기서 추측하지 않는다.
  state.sessions = (result.sessions || []).map(s => ({ key: s.key, date: s.date }));
  state.today = result.today || todayISO();
  if (!state.session || !state.sessions.some(s => s.date === state.session)) {
    state.session = result.currentSession || '';
  }

  // 인원별 회차 출결
  const byId = new Map();
  for (const r of result.data || []) {
    const id = String(r.id || `${r.name || ''}${r.phone || ''}`).replace(/\s/g, '');
    if (id) byId.set(id, r.attendanceByDate || {});
  }
  for (const m of state.members) {
    m.attendanceByDate = byId.get(m.id) || {};
    m.attendance = m.attendanceByDate[state.session] || '';
  }

  writeCacheSync();
  notify({ type: 'attendance-refresh' });
}

/**
 * 회차 목록. 아직 지나지 않은 회차는 뺀다 —
 * 미래 회차에 O/X 가 들어가면 결석 수가 부풀려진다.
 */
export function getSessions() {
  const today = state.today || todayISO();
  return state.sessions.filter(s => s.date <= today);
}

/** 지금 화면이 보고 있는 회차 (YYYY-MM-DD). */
export function getSession() {
  return state.session;
}

/** 회차를 바꾸고 각 인원의 표시값을 그 회차 것으로 맞춘다. */
export function setSession(date) {
  if (!state.sessions.some(s => s.date === date)) return false;
  state.session = date;
  for (const m of state.members) {
    m.attendance = (m.attendanceByDate || {})[date] || '';
  }
  notify({ type: 'session-changed', session: date });
  return true;
}

/**
 * 출결 저장. **바뀐 사람만** 넘길 것.
 *
 * 전원을 present ? 'O' : 'X' 로 보내면 사람이 시트에 직접 넣은 다른 표기가
 * 한 번에 지워진다. 손대지 않은 사람은 목록에서 빼야 한다.
 *
 * @param {string} session  'YYYY-MM-DD'
 * @param {Array}  changes  [{ name, phone, status }, ...]
 */
export async function saveAttendance(session, changes) {
  if (!session) throw new Error('회차가 지정되지 않았습니다.');
  if (!changes || !changes.length) return { saved: 0, missing: [] };

  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    // application/json 으로 보내면 preflight 때문에 CORS 로 막힌다.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ session, batch: changes }),
  });
  const result = await res.json();
  if (!result.success) throw new Error(result.message || '출결 저장 실패');

  // 시트에 이미 다른 표기가 있어 두고 온 사람은 반영하지 않는다.
  const keptIds = new Set((result.kept || []).map(s => String(s).replace(/\(.*\)$/, '')));

  for (const c of changes) {
    const m = state.members.find(x => x.name === c.name && x.phone === c.phone);
    if (!m || keptIds.has(m.id)) continue;
    m.attendanceByDate = m.attendanceByDate || {};
    m.attendanceByDate[session] = c.status;
    if (session === state.session) m.attendance = c.status;
  }
  writeCacheSync();

  return {
    saved: result.saved || 0,
    kept: result.kept || [],
    missing: result.missing || [],
  };
}

// ============================================================================
// 구독·캐시 관리
// ============================================================================

export function subscribe(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function getCacheInfo() {
  return {
    loaded: state.loaded,
    cohortId: state.cohortId,
    memberCount: state.members.length,
    version: MODULE_VERSION,
  };
}

export function clearCache() {
  for (const k of Object.values(CK)) {
    try { localStorage.removeItem(k); } catch { /* 무시 */ }
  }
}
