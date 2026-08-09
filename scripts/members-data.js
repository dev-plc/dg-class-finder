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
import { matches as hangulMatches } from './hangul.js?v=14';
import { sbSelect, getActiveCohortId, getCachedCohortId } from './supabase-config.js?v=14';

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
  cohort:      `dg_cohort_v${CACHE_VERSION}`,
};

const state = {
  cohortId: null,
  members: [],
  locationMap: {},
  teamLinks: {},
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
    sbSelect(`dg_team_links?select=team,chat_url&cohort_id=eq.${enc}`),
    sbSelect('dg_locations?select=location,image_url,detail_url'),
    // 오늘 회차의 출석만 가져온다.
    //
    // 전 회차를 받아 '멤버별 가장 최근 행' 을 쓰면 안 된다. 동기화가 빈 값을
    // 건너뛰기 때문에 각자 마지막으로 출석한 회차의 O 가 남아, 오늘 아무도
    // 체크하지 않았는데 전원 출석한 것처럼 보인다.
    // 체크박스가 뜻하는 것은 언제나 '오늘' 이다.
    sbSelect(`dg_attendance?select=member_id,status,` +
             `dg_members!inner(cohort_id)&dg_members.cohort_id=eq.${enc}` +
             `&session_date=eq.${todayISO()}`),
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
// 공개 API — 출석
//
// 이번 범위에서 출석은 손대지 않는다. 원본은 시트이고 쓰기는 GAS 로 간다.
// 화면은 아래 두 함수만 쓰고 그 사실을 알 필요가 없다.
// ============================================================================

/**
 * 시트에서 오늘 출석을 다시 읽어 메모리 상태에 덮어쓴다.
 * DB 동기화는 하루 한 번이라, 조원 명단을 열 때는 이쪽이 최신이다.
 */
export async function refreshAttendance() {
  const res = await fetch(`${GAS_API_URL}?t=${Date.now()}`);
  const result = await res.json();
  if (!result.success) throw new Error(result.message || '출석 조회 실패');

  const byId = new Map();
  for (const r of result.data || []) {
    const id = String(r.id || `${r.name || ''}${r.phone || ''}`).replace(/\s/g, '');
    if (id) byId.set(id, r.attendance || '');
  }
  for (const m of state.members) {
    if (byId.has(m.id)) m.attendance = byId.get(m.id);
  }
  writeCacheSync();
  notify({ type: 'attendance-refresh' });
}

/**
 * 출석 저장. 성공하면 true, 실패하면 예외를 던진다.
 * 호출부가 낙관적 UI 를 쓰고 있어 되돌리기는 화면 쪽에서 한다.
 */
export async function setAttendance(name, phone, status) {
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ name, phone, status }),
  });
  const result = await res.json();
  if (!result.success) throw new Error(result.message || '출석 저장 실패');

  const m = state.members.find(x => x.name === name && x.phone === phone);
  if (m) {
    m.attendance = status;
    writeCacheSync();
  }
  return true;
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
