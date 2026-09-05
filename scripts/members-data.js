// scripts/members-data.js
//
// 데이터 접근 계층. UI 는 이 파일의 함수만 쓰고 백엔드를 알지 못한다.
// 백엔드를 또 바꾸더라도 화면 코드는 건드리지 않는다.
//
// 원본 분담
//   조회(명단·조·위치·배치도·안내방)  Supabase 가 원본. 시트에서 일 1회 동기화된다.
//   출석                              시트가 원본. 쓰기는 GAS 로 가고, DB 는 비추기만 한다.
//
// 출석만 GAS 를 계속 쓰는 이유: DB 값은 시트보다 뒤처진다 (워크플로 2시간).
// 조장이 조원 명단을 열 때는 시트에서 바로 읽어와야 방금 체크한 것이 보인다.

// import 에 붙은 ?v= 는 캐시 무효화용이다. 이 파일들을 고치면 번호를 함께 올린다.
import { matches as hangulMatches } from './hangul.js?v=118';
import { sbSelect, getActiveCohortId, getCachedCohortId } from './supabase-config.js?v=118';

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
/**
 * 안내방 링크는 조 이름으로 찾는다. 그런데 그 이름을 두 사람이 각각 손으로
 * 적는다 — 명단은 출석부 탭에, 링크는 DG링크 탭에. 'o1' 과 'O1', 'O 1' 은
 * 같은 조인데 글자로는 다르다.
 *
 * 딱 맞는 것을 먼저 찾고, 없으면 공백을 지우고 대문자로 맞춰 한 번 더 찾는다.
 * 못 찾으면 그 조원 화면에서 안내방 버튼이 통째로 사라지는데, 오류가 나지
 * 않아서 아무도 알아채지 못한다.
 */
function normTeamKey(v) {
  return String(v ?? '').replace(/\s+/g, '').toUpperCase();
}

function makeTeamLinkLookup(teamLinks) {
  const index = {};
  for (const [k, v] of Object.entries(teamLinks || {})) {
    const key = normTeamKey(k);
    if (key && !(key in index)) index[key] = v;   // 먼저 적힌 줄이 이긴다
  }
  return (team) => {
    if (!team) return '';
    return teamLinks?.[team] || index[normTeamKey(team)] || '';
  };
}

function buildMemberRow(m, linkOf, attByMember) {
  return {
    id: `${m.name}${m.phone || ''}`,
    _uuid: m.id,
    name: m.name,
    phone: m.phone || '',
    team: m.team || '',
    team_no: m.team_no ?? '',
    // 출석부 시트의 줄 번호. 명단 차례를 시트와 똑같이 맞추는 데 쓴다.
    sheet_row: m.sheet_row ?? null,
    location: m.location || '',
    role: m.role || '',
    pastor: m.pastor || '',
    age: m.age ?? '',
    lunch: m.lunch || '',
    telegramLink: linkOf(m.team),
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

  const [members, teamLinkRows, locationRows, attendance, sessionRows] = await Promise.all([
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
    // 회차 목록. 조원 화면이 본인 출석 그리드를 그릴 때 쓴다.
    // 조장은 뒤에 GAS 에서 더 최신인 것으로 덮어쓴다.
    sbSelect(`dg_sessions?select=session_date,label,name&cohort_id=eq.${enc}&order=session_date`),
  ]);

  const teamLinks = {};
  for (const t of teamLinkRows) if (t.team) teamLinks[t.team] = t.chat_url || '';
  const linkOf = makeTeamLinkLookup(teamLinks);

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

  const sessions = (sessionRows || []).map(s => ({
    date: s.session_date,
    key: s.label || String(s.session_date).slice(5).replace('-', '/'),
    name: s.name || '',
  }));

  return {
    members: members.map(m => buildMemberRow(m, linkOf, attByMember)),
    locationMap,
    teamLinks,
    sessions,
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

  // 시트에서 읽어 둔 회차별 출결(attendanceByDate)은 이 응답에 없다.
  // 그대로 갈아끼우면 화면이 붙들고 있던 회차별 값이 통째로 사라진다.
  //
  // 조장 화면은 곧바로 refreshAttendance() 를 다시 불러서 티가 안 났지만,
  // 관리자 출석 관리는 로드 시점 값을 스냅숏으로 떠 두기 때문에 여기서 비면
  // '아직 아무도 안 찍힘' 으로 보인다. 그 상태에서 일괄 버튼을 누르면
  // 시트에 있던 기록이 통째로 덮인다.
  //
  // 기수가 바뀌었으면 이전 값은 남의 것이므로 옮기지 않는다.
  if (previous === cohortId) {
    const prevAtt = new Map(
      state.members.filter(m => m.attendanceByDate).map(m => [m.id, m.attendanceByDate])
    );
    for (const m of fresh.members) {
      const att = prevAtt.get(m.id);
      if (!att) continue;
      m.attendanceByDate = att;
      if (state.session) m.attendance = att[state.session] || '';
    }
  }

  Object.assign(state, fresh, { cohortId, loaded: true });
  // 과제는 여기서 받아오지 않지만, 시트에서 새로 가져온 뒤라면 그것도 옛것이다.
  // 버려 두면 다음에 필요할 때 다시 받는다.
  homeworkAllCache = null;
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
  // 폰 자판에서 전각 숫자('５３２６')가 들어오는 일이 있다. 그대로 두면
  // 숫자가 아니라고 지워져 '번호를 안 넣었다' 는 오류가 난다.
  const half = (v) => String(v || '').replace(/[Ａ-Ｚａ-ｚ０-９]/g,
    (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const cleanName = half(name).trim().replace(/\s/g, '').normalize('NFC');
  const cleanPhone = half(phone).trim().replace(/[^0-9]/g, '');
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
  return makeTeamLinkLookup(state.teamLinks)(teamName) || null;
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
  //
  // GAS 의 label 이 강의명('18강')이고 key 가 'MM/DD' 다. Supabase 쪽은 이름이
  // 반대(label=MM/DD, name=강의명)라 여기서 맞춰 준다. 안 맞추면 조장 화면에서
  // 강의명이 통째로 사라지고 과제가 회차에 붙지 않는다.
  state.sessions = (result.sessions || []).map(s => ({
    key: s.key,
    date: s.date,
    name: s.label || '',
  }));
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
 * 본인의 회차별 출결. 조원이 자기 이력을 볼 때 쓴다.
 *
 * Supabase 에서 읽는다. 시트가 원본이지만 여기서 GAS 를 부르면 모든 조회에
 * 왕복이 붙어 조회를 빠르게 둔 의미가 없어진다. 10분 트리거가 DB 를 맞추고
 * 있어 지연은 그 정도다.
 *
 * @returns [{ date, key, status }] — 지나간 회차만, 오래된 것부터
 */
export async function getMyAttendance(member) {
  if (!member || !member._uuid) return [];

  const [attRows, lunchRows, hwRows] = await Promise.all([
    sbSelect(`dg_attendance?select=session_date,status&member_id=eq.${member._uuid}&order=session_date`),
    sbSelect(`dg_lunch?select=session_date,applied&member_id=eq.${member._uuid}&order=session_date`)
      .catch(() => []),
    // kind 까지 받는다. 과제만 낸 것과 과제+소감문을 낸 것은 다른 이야기다.
    sbSelect(`dg_homework?select=lecture,kind&member_id=eq.${member._uuid}&order=lecture`)
      .catch(() => []),
  ]);

  const byDate = new Map(attRows.map(r => [r.session_date, r.status ?? '']));
  const lunchSet = new Set(lunchRows.filter(r => r.applied).map(r => r.session_date));

  // 과제는 '몇 강' 이라 날짜가 없다. 회차에 이름이 적혀 있을 때만 붙인다.
  // 이름이 없으면 순서로 짐작해야 하는데, 그러면 엉뚱한 회차에 붙는다.
  //
  // 두 갈래로 나눈다 — 인정 대상(과제+소감문)과, 냈지만 종류가 모자란 것.
  // 뒤엣것도 '안 냈다' 가 아니므로 화면에 그대로 보여 준다.
  const hwNames = new Set();
  const hwKinds = new Map();
  for (const r of hwRows) {
    const k = normalizeLecture(r.lecture);
    if (!k) continue;
    if (isFullHomework(r.kind)) hwNames.add(k);
    if (!hwKinds.has(k)) hwKinds.set(k, []);
    hwKinds.get(k).push(r.kind || '');
  }
  const today = state.today || todayISO();

  return state.sessions
    .filter(s => s.date <= today)
    .map(s => ({
      date: s.date,
      key: s.key,
      name: s.name || '',
      status: byDate.get(s.date) || '',
      lunch: lunchSet.has(s.date),
      // homework = **인정 대상**. 종류가 모자란 제출은 kinds 로만 넘긴다.
      homework: !!(s.name && hwNames.has(normalizeLecture(s.name))),
      homeworkKinds: (s.name && hwKinds.get(normalizeLecture(s.name))) || [],
    }));
}

/**
 * **다가오는 회차의 김밥 신청.**
 *
 * 김밥 요약은 getMyAttendance 가 준 줄을 쓰는데, 그것은 **지나간 회차만** 담는다
 * (state.sessions 를 today 로 자른다). 그런데 결과 카드의 '김밥' 한 줄은 시트에서
 * **오늘 이후 가장 가까운 열**을 읽어 온 값이다 — 보는 곳이 서로 다르다.
 *
 * 그래서 이번에 명단에 올라온 사람은 지난 신청이 있을 리 없어 **카드 O · 요약
 * '신청 내역 없음'** 이 늘 난다. 실제로 그 제보가 왔다. 둘이 같은 이야기를
 * 하도록 다가오는 신청을 따로 읽는다.
 *
 * getMyAttendance 가 이미 이 사람의 dg_lunch 를 다 읽지만, 그 함수의 반환 모양을
 * 바꾸면 부르는 곳이 여럿이라(조회 화면·관리자) 여기서 따로 받는다. 한 줄짜리다.
 *
 * @returns { date, key } | null
 */
export async function getUpcomingLunch(member) {
  if (!member || !member._uuid) return null;
  const today = state.today || todayISO();

  const rows = await sbSelect(
    `dg_lunch?select=session_date&member_id=eq.${member._uuid}` +
    `&applied=is.true&session_date=gt.${encodeURIComponent(today)}` +
    '&order=session_date&limit=1'
  ).catch(() => []);

  const date = rows[0]?.session_date;
  if (!date) return null;

  // 회차 이름은 dg_sessions 가 안다. 김밥 탭에만 있는 날짜면 날짜로 적는다.
  const s = state.sessions.find(x => x.date === date);
  return { date, key: s?.key || String(date).slice(5).replace('-', '/') };
}

/**
 * 강의명을 견주기 좋게 다듬는다.
 *
 * 과제는 구글 폼으로 받고 회차 이름은 시트에서 온다. 두 곳에 사람이 따로
 * 적기 때문에 글자가 어긋난다. 그대로 비교하면 📝 가 한 번도 안 뜨는데,
 * 오류가 안 나서 알아채기 어렵다.
 *
 *   '18 강' · '제18강' · '18강 ' → '18강'
 *   '교재' → '교제'  (섞여 적힌다)
 */
export function normalizeLecture(v) {
  const raw = String(v || '').replace(/\s/g, '');
  const m = raw.match(/^제?(\d+)강/);
  if (m) return m[1] + '강';
  if (/^자유교재/.test(raw)) return '자유교제';
  if (/^교재/.test(raw)) return '교제';
  return raw.toLowerCase();
}

/**
 * 조 전체의 김밥·과제. 전체 출석표가 칸마다 🍙 · 📝 를 찍는 데 쓴다.
 *
 * 사람마다 따로 부르면 조원 수만큼 왕복이 생긴다. member_id 를 묶어 한 번에
 * 받는다 (조 하나라 목록이 길어질 일은 없다).
 *
 * @returns { lunch: Map(uuid → Set(YYYY-MM-DD)), homework: Map(uuid → Set(강의명)) }
 */
export async function getTeamExtras(members) {
  const empty = { lunch: new Map(), homework: new Map() };
  const ids = (members || []).map(m => m._uuid).filter(Boolean);
  if (!ids.length) return empty;

  const list = `(${ids.join(',')})`;

  const [lunchRows, hwRows] = await Promise.all([
    sbSelect(`dg_lunch?select=member_id,session_date&member_id=in.${list}` +
             `&applied=is.true&order=member_id,session_date`).catch(() => []),
    sbSelect(`dg_homework?select=member_id,lecture,kind&member_id=in.${list}` +
             `&order=member_id,lecture`).catch(() => []),
  ]);

  const lunch = new Map();
  for (const r of lunchRows) {
    if (!lunch.has(r.member_id)) lunch.set(r.member_id, new Set());
    lunch.get(r.member_id).add(r.session_date);
  }

  // homework = **인정 대상만**(과제+소감문). homeworkKinds = 실제로 낸 종류 그대로.
  // 화면이 '과제만 냈다' 를 말할 수 있어야 해서 둘 다 넘긴다.
  const homework = new Map();
  const homeworkKinds = new Map();
  for (const r of hwRows) {
    const key = normalizeLecture(r.lecture);
    if (!key) continue;
    if (isFullHomework(r.kind)) {
      if (!homework.has(r.member_id)) homework.set(r.member_id, new Set());
      homework.get(r.member_id).add(key);
    }
    if (!homeworkKinds.has(r.member_id)) homeworkKinds.set(r.member_id, new Map());
    const byLec = homeworkKinds.get(r.member_id);
    if (!byLec.has(key)) byLec.set(key, []);
    byLec.get(key).push(r.kind || '');   // 종류가 비어도 '냈다' 는 사실은 남긴다
  }

  return { lunch, homework, homeworkKinds };
}

/**
 * 조원 명단 차례 — **시트의 출석부 순서와 같게.**
 *
 * 종이 출석부와 시트를 나란히 놓고 짚어 가며 대조하는 것이 이 앱의 주 용도다.
 * 두 순서가 다르면 한 사람을 찾을 때마다 명단 전체를 훑게 되고, 그러다 옆줄에
 * 체크한다.
 *
 * 'No.' 열(team_no)로 정렬하던 것을 시트 줄 번호(sheet_row)로 바꿨다. No. 는
 * 비어 있거나 조를 다시 짜면서 어긋난 칸이 있어서, 그 사람만 명단 끝으로 밀렸다.
 * sheet_row 가 아직 없는 데이터(동기화 전)에서는 예전 규칙으로 물러난다.
 */
export function compareMemberOrder(a, b) {
  const n = (v) => {
    const x = Number(v);
    return v === null || v === undefined || v === '' || !Number.isFinite(x) ? Infinity : x;
  };
  return n(a.sheet_row) - n(b.sheet_row)
      || n(a.team_no) - n(b.team_no)
      || String(a.name || '').localeCompare(String(b.name || ''), 'ko');
}

/** 회차 이름이 강의인지 (수료에 들어가는지). '자유교제' 같은 주는 아니다. */
export function isClassSession(name) {
  return /^\d+강$/.test(normalizeLecture(name));
}

// 과제는 회차 날짜가 없고 강의명만 있다. 회차를 바꿀 때마다 다시 받을 이유가
// 없으므로 한 번 받아 두고 강의명으로 걸러 쓴다.
//
// 두 가지를 지켜야 한다.
//   1. **실패를 캐시하지 않는다.** 못 받은 것을 빈 배열로 넣어 두면 그 뒤로는
//      조회조차 하지 않아, 과제 칸이 영영 비는데 오류도 안 난다.
//   2. **시트에서 새로 가져오면 버린다.** 안 그러면 동기화를 해도 옛 과제가
//      그대로 남는다 — refresh() 가 지운다.
let homeworkAllCache = null;

/**
 * 한 회차의 김밥·과제를 **전 인원**에 대해 받는다. 출석부 출력이 쓴다.
 *
 * getTeamExtras 와 달리 member_id 목록을 URL 에 싣지 않는다. 조 하나면 몰라도
 * 전 인원(229명)이면 uuid 목록만 8KB 가 넘어 주소가 감당하지 못한다.
 * 회차로 좁히면 인원수만큼의 행이라 그럴 필요가 없다.
 *
 * 과제가 왜 안 붙었는지도 같이 돌려준다. 빈 칸만 보여 주면 아무도 원인을
 * 알 수 없다 — 회차 이름이 없는 것과, 폼에 다르게 적힌 것은 손볼 곳이 다르다.
 *
 * @returns { lunch: Set(uuid), homework: Set(uuid),
 *            hwLoaded: boolean,          // 과제를 실제로 읽었는가
 *            hwTotal: number,            // 전체 과제 건수
 *            hwNear: [{lecture, n}] }    // 숫자는 같은데 표기가 다른 것
 */
export async function getSessionExtras(sessionDate, lectureName) {
  const empty = { lunch: new Set(), homework: new Set(), homeworkKinds: new Map(),
                  hwLoaded: false, hwTotal: 0, hwNear: [] };
  if (!sessionDate) return empty;

  const lunchRows = await sbSelect(
    `dg_lunch?select=member_id&session_date=eq.${encodeURIComponent(sessionDate)}` +
    `&applied=is.true&order=member_id`
  ).catch(() => []);

  let hwLoaded = true;
  if (!homeworkAllCache) {
    try {
      homeworkAllCache = await sbSelect(
        'dg_homework?select=member_id,lecture,kind&order=member_id,lecture'
      );
    } catch (err) {
      console.log('과제 조회 실패:', err);
      hwLoaded = false;      // 캐시에 남기지 않는다 — 다음에 다시 받는다
    }
  }
  const hwRows = homeworkAllCache || [];

  // 강의명은 시트와 폼에 따로 적혀 글자가 어긋난다. 정규화한 뒤에 견준다.
  const key = normalizeLecture(lectureName);
  const mine = key ? hwRows.filter(r => normalizeLecture(r.lecture) === key) : [];
  // **인정 대상만** homework 다. 종이 출석부에 '냈음' 이 찍히면 현장에서
  // 되돌릴 길이 없으므로 여기서는 종류를 반드시 본다.
  const homework = new Set(mine.filter(r => isFullHomework(r.kind)).map(r => r.member_id));
  // 종류가 모자란 제출. '안 냈다' 와는 다른 이야기라 따로 넘긴다.
  const homeworkKinds = new Map();
  for (const r of mine) {
    if (!homeworkKinds.has(r.member_id)) homeworkKinds.set(r.member_id, []);
    homeworkKinds.get(r.member_id).push(r.kind || '');
  }

  return {
    lunch: new Set(lunchRows.map(r => r.member_id)),
    homework,
    homeworkKinds,
    hwLoaded,
    hwTotal: hwRows.length,
    // '이 강의로 낸 사람이 아무도 없다' 일 때만 강의명 힌트를 준다.
    // homework(인정 대상)로 재면 안 된다 — 전원이 과제만 냈을 때 엉뚱하게
    // '강의명이 어긋났나' 를 묻게 된다. 그건 종류 문제이지 이름 문제가 아니다.
    hwNear: mine.length ? [] : nearbyLectures(hwRows, lectureName),
  };
}

/**
 * 누가 어느 강의의 과제를 냈는지 한 번에 받는다.
 *
 * 하차 검토가 쓴다 — 공지 규칙상 '예습과제와 소감문을 낸 결석' 은 한 달에
 * 한 번까지 출석으로 인정되므로, 결석 회차마다 과제가 있었는지 알아야 한다.
 *
 * 강의명 정규화를 밖으로 내보내지 않는 이유: 시트('18강')와 폼('제18강')이
 * 따로 적히기 때문에 견주는 규칙이 한 곳에만 있어야 한다. 화면은 회차 이름을
 * 그대로 넘기고 판단은 여기서 한다.
 *
 * @returns { loaded, has(uuid, lectureName) }
 *          loaded=false 는 '안 냈다' 가 아니라 '모른다' 다 — 화면이 구별해서
 *          말해야 한다. 못 받아 온 것을 미제출로 세면 없는 결석을 만든다.
 */
export async function getHomeworkChecker() {
  let loaded = true;
  if (!homeworkAllCache) {
    try {
      homeworkAllCache = await sbSelect(
        'dg_homework?select=member_id,lecture,kind&order=member_id,lecture');
    } catch (err) {
      console.log('과제 조회 실패:', err);
      loaded = false;      // 실패는 캐시하지 않는다 — 다음에 다시 받는다
    }
  }

  // byMember  = **인정 대상**(과제+소감문)을 낸 강의
  // kindMember = 종류에 상관없이 낸 것 — 강의별 실제 종류 목록
  const byMember = new Map();
  const kindMember = new Map();
  for (const r of homeworkAllCache || []) {
    const key = normalizeLecture(r.lecture);
    if (!key) continue;
    if (isFullHomework(r.kind)) {
      if (!byMember.has(r.member_id)) byMember.set(r.member_id, new Set());
      byMember.get(r.member_id).add(key);
    }
    if (!kindMember.has(r.member_id)) kindMember.set(r.member_id, new Map());
    const byLec = kindMember.get(r.member_id);
    if (!byLec.has(key)) byLec.set(key, []);
    byLec.get(key).push(r.kind || '');   // 종류가 비어도 '냈다' 는 사실은 남긴다
  }

  const count = new Map();
  for (const r of homeworkAllCache || []) {
    count.set(r.member_id, (count.get(r.member_id) || 0) + 1);
  }

  return {
    loaded,
    /**
     * 그 강의를 **출석으로 인정받을 수 있게** 냈는가.
     *
     * 종류가 '과제+소감문' 인 것만이다. 예전에는 제출 기록이 하나라도 있으면
     * true 였고, 그래서 과제만 낸 사람이 '과제+소감문 제출' 로 읽혔다.
     */
    has(uuid, lectureName) {
      const key = normalizeLecture(lectureName);
      return !!key && !!byMember.get(uuid)?.has(key);
    },
    /**
     * 그 강의에 실제로 낸 종류. 화면은 이것을 **그대로** 찍는다.
     *
     * '소감문이 빠졌다' 처럼 적으려면 폼 선택지가 정확히 무엇인지 알아야 하는데
     * 코드는 모른다. 낸 것을 그대로 보여 주고 기준은 따로 알린다.
     */
    kinds(uuid, lectureName) {
      const key = normalizeLecture(lectureName);
      return (key && kindMember.get(uuid)?.get(key)) || [];
    },
    /**
     * 그 사람이 지금까지 낸 과제 현황.
     *
     * 심방 전에 확인할 값이다 — 규칙 1번이 '결석자 심방시 반드시 과제 제출을
     * 확인할 것' 이라고 말한다. 결석했어도 과제로 공부가 이어졌는지가
     * 다음 참석의 조건이기 때문이다.
     *
     * total 은 제출 건수(같은 강의 예습과제·소감문은 따로 센다),
     * latest 는 강 번호가 가장 큰 것 — '9강' 과 '19강' 을 문자열로 견주면
     * 9강이 뒤로 간다.
     */
    stats(uuid) {
      // latest 는 종류를 안 가린다 — '몇 강까지 냈나' 를 보는 값이다.
      const lectures = kindMember.get(uuid);
      if (!lectures) return { total: 0, latest: '' };
      let latest = '', latestNo = -1;
      for (const key of lectures.keys()) {
        const no = Number(key.match(/^(\d+)강$/)?.[1] ?? -1);
        if (no > latestNo) { latestNo = no; latest = key; }
      }
      return { total: count.get(uuid) || 0, latest };
    },
  };
}

/**
 * 붙지 않은 이유를 화면이 말할 수 있게, 숫자는 같은데 표기가 다른 것을 모은다.
 *
 *   회차 '18강' · 폼 '18과' → [{ lecture: '18과', n: 3 }]
 *
 * 정규화가 '제18강' · '18 강' 까지는 흡수하므로, 여기 걸리는 것은 사람이
 * 시트나 폼에서 직접 고쳐야 하는 것들이다.
 */
function nearbyLectures(rows, lectureName) {
  const num = String(lectureName || '').match(/\d+/)?.[0];
  if (!num) return [];

  const key = normalizeLecture(lectureName);
  const count = new Map();
  for (const r of rows) {
    const raw = String(r.lecture || '').trim();
    if (!raw || normalizeLecture(raw) === key) continue;
    if (!raw.includes(num)) continue;
    count.set(raw, (count.get(raw) || 0) + 1);
  }

  return [...count.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([lecture, n]) => ({ lecture, n }));
}

/**
 * 본인이 낸 과제 목록.
 *
 * '몇 강' 은 회차 날짜로 바꾸지 않는다 — 몇 번째 회차가 몇 강인지 시트가
 * 말해주지 않아서, 순서로 짐작하면 엉뚱한 회차에 붙는다. 적힌 그대로 보여준다.
 *
 * @returns [{ lecture, kind, content, submittedAt }] — 최근 낸 것부터
 */
export async function getMyHomework(member) {
  if (!member || !member._uuid) return [];

  const rows = await sbSelect(
    `dg_homework?select=lecture,kind,content,submitted_at` +
    // 시각이 비어 있는 건이 섞여도 순서가 흔들리지 않게 lecture 를 보조로 둔다.
    `&member_id=eq.${member._uuid}&order=submitted_at.desc.nullslast,lecture.desc`);

  // 강 번호가 큰 것부터. DB 정렬만으로는 어긋난다 — 문자열로 견주면 '9강' 이
  // '19강' 보다 뒤로 가고, 제출 시각이 비어 있는 건이 섞이면 그 사이에서
  // 차례가 흔들린다. 사람이 보는 기준은 '몇 강' 이므로 여기서 다시 세운다.
  const lectureNo = (v) => {
    const m = normalizeLecture(v).match(/^(\d+)강$/);
    return m ? Number(m[1]) : -1;      // '자유교제' 처럼 번호가 없는 것은 뒤로
  };

  return rows
    .map(r => ({
      lecture: r.lecture || '',
      kind: r.kind || '',
      content: r.content || '',
      submittedAt: r.submitted_at || '',
    }))
    .sort((a, b) =>
      lectureNo(b.lecture) - lectureNo(a.lecture)
      // 같은 강이면 늦게 낸 것부터 (재제출이 위로)
      || String(b.submittedAt).localeCompare(String(a.submittedAt))
      || String(a.kind).localeCompare(String(b.kind), 'ko'));
}

/**
 * 제출 칸 하나에 든 링크를 낱개로 가른다.
 *
 * 파일을 두 개 이상 올리면 폼이 한 칸에 쉼표로 이어 붙인다.
 *
 *   https://drive.google.com/open?id=AAA, https://drive.google.com/open?id=BBB
 *
 * 통째로 href 에 넣으면 두 번째 주소까지 한 주소로 읽혀 열리지 않는다.
 * 쉼표로 자르지 않고 `http(s)://` 로 시작하는 덩어리를 찾는 이유는, 구분자가
 * 쉼표일 때도 줄바꿈일 때도 있고 사이에 '1번,' 같은 말이 끼기도 해서다.
 *
 * 주소가 하나도 없으면 링크는 빈 배열이고 적은 글이 text 로 남는다 —
 * 손으로 소감문을 적어 낸 사람이 있다.
 *
 * @returns { links: string[], text: string }
 */
export function splitSubmissionLinks(content) {
  const raw = String(content == null ? '' : content).trim();
  if (!raw) return { links: [], text: '' };

  const links = [];
  // 공백·쉼표는 주소에 들어가지 않는다. 뒤에 붙은 문장부호는 따로 떼어낸다.
  for (const m of raw.matchAll(/https?:\/\/[^\s,]+/gi)) {
    const url = m[0].replace(/[.,;)\]}]+$/, '');
    if (url && !links.includes(url)) links.push(url);   // 같은 파일을 두 번 낸 칸도 있다
  }

  const text = raw.replace(/https?:\/\/[^\s,]+/gi, ' ')
                  .replace(/[\s,]+/g, ' ')
                  .trim();

  return { links, text };
}

/**
 * 회차 목록. 아직 지나지 않은 회차는 뺀다 —
 * 미래 회차에 O/X 가 들어가면 결석 수가 부풀려진다.
 */
/**
 * 회차 목록.
 *
 * 기본은 **지난 회차만**. 조회 화면(튜터용)이 미리 찍히면 결석 수가 부풀려진다.
 * 관리자 화면은 지난 주차 정정이 주 업무라 { all: true } 로 전 주차를 받는다.
 * 두 화면의 정책이 다르다는 것을 알고 쓸 것.
 */
export function getSessions({ all = false, throughNext = false } = {}) {
  if (all) return state.sessions.slice();
  const today = state.today || todayISO();
  const past = state.sessions.filter(s => s.date <= today);
  if (!throughNext) return past;

  // 다가오는 회차 하나만 더. 전체 출석표가 쓴다 — 다음 주에 무엇을 하는지 보여야
  // 조장이 준비를 한다. state.sessions 는 시간순이라 첫 미래 회차가 다음 회차다.
  //
  // ⚠️ 기본값(인자 없이 부르기)은 절대 이걸 포함하면 안 된다. 회차 선택칸이
  // 그 값을 쓰는데, 예정 주차를 미리 찍으면 GAS 가 거부해서 저장이 실패한다.
  const next = state.sessions.find(s => s.date > today);
  return next ? [...past, next] : past;   // 마지막 회차 뒤라면 지금과 똑같다
}

/** GAS 가 확정한 오늘 (YYYY-MM-DD). 미래 회차를 가려내는 데 쓴다. */
export function getToday() {
  return state.today || todayISO();
}

/**
 * **지난 회차인가** — 지금 진행 중인 회차보다 앞선 회차인가.
 *
 * 화면이 들고 있는 명단은 늘 **오늘의 명단**이다. 그것을 기준으로 지난 회차를
 * 저장하면 그때 명단에 없던 사람에게까지 결석(X)이 나간다. 실제로 그렇게 찍혔다 —
 * 이번에 처음 합류한 사람들이 18·19강 결석으로 남은 것이 이 경로다.
 *
 * 막지는 않는다. 그 주에 저장을 깜빡하고 다음 주에 채우는 일이 있기 때문이다.
 * 대신 저장 직전에 한 번 묻는다 (script.js · admin.js).
 *
 * '지금 진행 중인 회차' = 지나간 회차 중 마지막. getSessions() 가 기본으로
 * 지난 회차만 주므로 그 끝을 쓴다.
 */
export function isPastSession(date) {
  if (!date) return false;
  const done = getSessions();
  return done.length > 0 && date < done[done.length - 1].date;
}

/**
 * 한 회차의 출결만 DB 에서 읽어 온다.
 *
 * 관리자 출석 관리가 쓴다. 예전에는 refreshAttendance() 로 GAS 를 불렀는데,
 * 그건 시트 전체(229명 × 39회차)를 읽어 통째로 내려주기 때문에 화면을 열 때도
 * 주차를 바꿀 때도 몇 초씩 걸렸다. 정작 화면이 쓰는 건 한 회차뿐이다.
 *
 * DB 는 시트보다 뒤처질 수 있지만 그 폭이 정해져 있다 —
 * GAS 10분 트리거가 시트와 DB 를 맞추고, 앱에서 저장한 것은 저장하는 그 자리에서
 * 밀어넣는다. 시트를 손으로 고친 직후가 급하면 '시트에서 지금 가져오기' 를 쓴다.
 *
 * 덮어쓰기 보호는 어차피 서버에서 한 번 더 걸린다 — GAS 가 시트의 현재 값을
 * 보고 O/X 가 아닌 칸이면 거부(kept)하므로, DB 가 뒤처져 있어도 '◎' 가 O/X 로
 * 덮이는 일은 없다.
 */
export async function loadAttendanceForSession(date) {
  if (!date) return new Map();

  const rows = await sbSelect(
    `dg_attendance?select=member_id,status&session_date=eq.${encodeURIComponent(date)}&order=member_id`
  );
  const byUuid = new Map(rows.map(r => [r.member_id, r.status ?? '']));

  for (const m of state.members) {
    m.attendanceByDate = m.attendanceByDate || {};
    m.attendanceByDate[date] = byUuid.get(m._uuid) ?? '';
  }
  if (date === state.session) {
    for (const m of state.members) m.attendance = m.attendanceByDate[date] || '';
  }

  notify({ type: 'session-attendance-loaded', session: date });
  return byUuid;
}

/**
 * 지나간 회차 전체의 출결을 한 번에 받는다. 결석 현황이 쓴다.
 *
 * 회차마다 따로 부르면 20회차면 20번 왕복이다. 한 번에 받아 사람별로 접는다.
 * 인원 250명 × 20회차 = 5000행 정도라 order 를 붙여 나눠 받으면 된다.
 *
 * 기수를 dg_members 로 좁힌다 — 지난 기수 행까지 세면 결석 수가 부풀어
 * 엉뚱한 사람이 하차 대상으로 올라온다.
 *
 * @returns Map(uuid → Map('YYYY-MM-DD' → status))
 */
export async function getAttendanceHistory() {
  const cohortId = state.cohortId || await getActiveCohortId();
  const enc = encodeURIComponent(cohortId);

  const rows = await sbSelect(
    `dg_attendance?select=member_id,session_date,status,` +
    `dg_members!inner(cohort_id)&dg_members.cohort_id=eq.${enc}` +
    `&order=member_id,session_date`
  );

  const out = new Map();
  for (const r of rows) {
    if (!out.has(r.member_id)) out.set(r.member_id, new Map());
    out.get(r.member_id).set(r.session_date, String(r.status ?? '').trim());
  }
  return out;
}

/**
 * 출결 표기가 '결석' 인가.
 *
 * X 만 결석이다. 빈칸은 '아직 안 찍음' 이지 결석이 아니고, ◎(지난 기수 이수) ·
 * −(수업 없음) · 돌봄 도 결석이 아니다. 여기서 빈칸을 결석으로 세면 이번 주
 * 출석을 아직 안 찍은 조가 통째로 하차 대상으로 올라온다.
 */
export function isAbsent(status) {
  return String(status ?? '').trim().toUpperCase() === 'X';
}

/**
 * 시트가 '과제' 로 인정해 준 칸.
 *
 * 출석부(DB) 시트에 붙은 GAS(`과제제출.gs`)가, 과제+소감문을 낸 사람의
 * 결석 칸(X)을 '과제' 로 바꿔 놓는다. 사람이 확인하고 찍은 값이므로 앱이
 * 다시 따지지 않는다. 자세한 것은 docs/RULES.md.
 */
export const MAKEUP_STATUS = '과제';

export function isMakeup(status) {
  return String(status ?? '').trim() === MAKEUP_STATUS;
}

/**
 * 출석으로 세는가. O 와 '과제'.
 *
 * 화면 네 곳이 저마다 `=== 'O'` 를 쓰고 있었다. 한 곳만 고치면 같은 사람의
 * 출석 수가 화면마다 달라진다 — 여기 하나만 본다.
 */
export function isPresent(status) {
  return String(status ?? '').trim().toUpperCase() === 'O' || isMakeup(status);
}

/**
 * 현장에 안 왔는가. 결석(X) + 과제 인정.
 *
 * 결석자 명단이 보는 것이 이것이다. 교역자 출석관리 원칙 1·3 — 결석자
 * 심방 때 과제·소감문 제출을 확인해야 하므로, **과제를 냈어도 명단에서
 * 빠지면 안 된다.** 출석 인정(isPresent)과 현장 참석은 다른 물음이다.
 */
export function isMissing(status) {
  return isAbsent(status) || isMakeup(status);
}

/**
 * 돌봄으로 섬긴 주.
 *
 * 출석 집계에서는 여전히 '그 외' 다 — isPresent 에 넣으면 조 요약·결석 현황·
 * 하차 검토가 한꺼번에 바뀐다. 여기서 따로 두는 까닭은 **과제 안내 하나** 때문이다:
 * 그 자리에 있었으니 예습과제는 묻고, 소감문은 안 묻는다 (homeworkRule).
 *
 * 시트에 적힌 그대로 견준다 — isMakeup('과제') 과 같은 규칙이다.
 */
export const CARE_STATUS = '돌봄';

export function isCare(status) {
  return String(status ?? '').trim() === CARE_STATUS;
}

/**
 * 출석 인정 대상인 제출인가 — 과제 **종류**를 본다.
 *
 * 폼의 '어떤 과제인가요?' 값이 `dg_homework.kind` 로 들어온다. 과제만 낸 것과
 * 과제+소감문을 낸 것은 다른 이야기인데, 앱은 오랫동안 `select=lecture` 만 해서
 * **그 강의에 제출이 하나라도 있으면** 인정으로 쳤다. 과제만 낸 사람이 화면에서
 * '과제+소감문 제출' 로 읽히던 것이 그것이다.
 *
 * ⚠️ 시트에 붙은 GAS(`scripts/gas/sheet-bound/과제제출.gs`)와 **같은 규칙**이다.
 *      if (String(assignment).indexOf('과제+소감문') === -1) return;
 * 공백을 지우거나 대소문자를 맞추지 않는다 — GAS 가 안 하기 때문이다.
 * **한쪽만 바꾸면** 시트는 '과제' 로 안 바꿨는데 화면은 인정하는 어긋남이 난다.
 */
export const HOMEWORK_FULL = '과제+소감문';

export function isFullHomework(kind) {
  return String(kind ?? '').indexOf(HOMEWORK_FULL) !== -1;
}

/**
 * 그 회차에 **무엇을 요구하는가.** 출결 표기가 정한다.
 *
 *   'full' 과제+소감문이라야 인정 — 결석(X)을 메우는 제출이다 (공지 규칙 5)
 *   'any'  예습과제만 내면 끝. 종류를 안 가린다
 *   'none' 아무것도 묻지 않는다
 *
 * **빈칸이 'none' 인 것이 핵심이다.** 빈칸은 아래 셋 중 하나인데 앱은 구별할
 * 수 없고, 셋 다 요구할 근거가 없다.
 *   · 합류 전      — 명단에 들어오기 전 회차
 *   · 하차 기간    — 나갔다가 돌아온 사람의 그 사이. DG 는 재합류가 있다.
 *                    7월 합류 → 8월 하차 → 10월 재합류이면 8~9월은 비어 있다.
 *   · 아직 저장 전 — 조장이 그 회차를 아직 안 찍었다
 *
 * **돌봄은 'any' 다.** 그 자리에 있었으므로 예습과제는 낼 수 있고, 내야 한다.
 * 소감문은 결석을 메우는 것이라 묻지 않는다.
 *
 * −(수업 없음) · ◎(지난 기수 이수) 는 사람이 시트에 일부러 넣은 예외 표기다.
 * 예외라고 적어 둔 칸에 과제를 묻지 않는다. 뜻을 모르는 그 밖의 표기도 같다.
 *
 * ⚠️ 예전에는 '첫 기록이 찍힌 회차부터 센다' 는 창으로 가렸다. 그것은 하차를
 *    담지 못했고(첫 기록은 7월이라 8~9월이 딸려 나왔다), 빈칸→X 저장이
 *    지난 회차를 채우면 창 자체가 1주차로 밀려 무력해졌다.
 */
export function homeworkRule(status) {
  if (isAbsent(status)) return 'full';                      // X
  if (isPresent(status) || isCare(status)) return 'any';    // O · 과제 · 돌봄
  return 'none';                                            // 빈칸 · − · ◎
}

/** 낸 종류를 화면에 적을 글자로. 종류가 비어 있는 옛 기록도 있다. */
export function homeworkKindLabel(kinds) {
  const named = (kinds || []).filter(Boolean);
  return named.length ? named.join(' · ') : '종류 미기재';
}

/**
 * 앱이 쓸 수 있는 출결 값인가.
 *
 * '◎'(지난 기수 이수) · '−'(집계 제외) · '돌봄' 같은 표기는 사람이 시트에
 * 직접 넣은 것이고 앱은 그 뜻을 모른다. 화면에서 덮어쓸 수 있게 두면
 * 무심코 누른 한 번에 지난 기수 기록이 사라진다. 고쳐야 하면 시트에서 고친다.
 *
 * GAS 의 DG_ALLOWED_STATUS 와 같은 규칙이다 — 한쪽만 바꾸면 저장이 조용히
 * 거부되거나(kept) 화면과 시트가 어긋난다.
 */
export function isEditableStatus(v) {
  const s = String(v || '').trim().toUpperCase();
  return s === '' || s === 'O' || s === 'X';
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

  // 시트에 이미 다른 표기가 있어 두고 온 사람(kept)과, 시트에서 행을 못 찾은
  // 사람(missing)은 실제로 저장되지 않았다. 화면에 반영하면 저장된 것처럼
  // 보이고, 다음 갱신 때 조용히 옛 값으로 되돌아간다.
  const keptIds = new Set((result.kept || []).map(s => String(s).replace(/\(.*\)$/, '')));
  const missingIds = new Set((result.missing || []).map(String));

  for (const c of changes) {
    const m = state.members.find(x => x.name === c.name && x.phone === c.phone);
    if (!m || keptIds.has(m.id) || missingIds.has(m.id)) continue;
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

/**
 * 시트 → DB 동기화를 지금 실행한다 (GitHub Actions).
 *
 * 명단·편성·위치·과제는 2시간마다 도는 워크플로로만 DB 에 들어온다. 수업 직전에
 * 장소를 옮기거나 인원을 추가하면 그때까지 앱에 안 나오는데, 지금까지는 관리자가
 * GitHub 에 들어가 워크플로를 손으로 돌리는 것 말고 방법이 없었다.
 *
 * 워크플로 실행에는 토큰이 필요하고 그 토큰은 앱에 둘 수 없다. GAS 를 거친다.
 */
export async function requestSheetSync() {
  const res = await fetch(GAS_API_URL, {
    method: 'POST',
    // application/json 으로 보내면 preflight 때문에 CORS 로 막힌다.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'sync' }),
  });
  const result = await res.json();
  return { success: !!result.success, message: result.message || '' };
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

// ============================================================================
// 자동 새로고침 (Polling)
//
// 무엇을 보는가가 전부다.
//
// 예전에는 dg_members.updated_at 을 봤다. 그런데 동기화는 dg_members 를
// **맨 먼저** 쓰고 dg_attendance 를 **맨 마지막**에 쓴다. 게다가 dg_members
// 에는 BEFORE UPDATE 트리거가 있어 값이 안 바뀌어도 시각이 튄다. 그래서
//
//   1. 첫 표가 끝나는 순간 "바뀌었다" 고 보고 새로 읽었고
//   2. 그때 출석·과제·김밥은 아직 하나도 안 들어와 있었으며
//   3. 폴링이 그 시각을 이미 본 것으로 올려 버려 **두 번째 새로고침이
//      영영 오지 않았다.** 다음 동기화(2시간 뒤)까지 옛 값을 붙들었다.
//
// 그래서 지금은 동기화가 **다 끝나고** 남기는 dg_sync_log 한 줄만 본다.
// 그 표가 아직 없으면(마이그레이션 전) dg_attendance.updated_at 으로
// 물러난다 — 그것도 맨 마지막에 쓰이고 트리거가 있어 upsert 마다 튄다.
// ============================================================================
const POLL_INTERVAL_MS = 120000;   // 평상시 2분
let lastSyncMark = null;           // 마지막으로 '읽었다' 고 확인한 표시
let pollTimer = null;
let pollBusy = false;              // 새로고침 중에 또 들어오지 않게
let pollGen = 0;                   // 다시 걸 때마다 올린다 (옛 루프가 살아남지 않게)
let pollUnloadHooked = false;

/**
 * 동기화가 끝났다는 표시. 없으면 null 을 돌려주고 폴링은 조용히 쉰다.
 *
 * 표가 아직 없을 수 있으므로(supabase/dg_sync_log.sql 미실행) 실패하면
 * dg_attendance 로 물러난다. dg_attendance 에는 cohort_id 열이 없어서
 * getAttendanceHistory() 가 이미 쓰는 dg_members!inner 조인을 그대로 쓴다.
 */
async function fetchSyncMark(cohortId) {
  const enc = encodeURIComponent(cohortId);
  try {
    const rows = await sbSelect(
      `dg_sync_log?select=finished_at&cohort_id=eq.${enc}` +
      '&order=finished_at.desc&limit=1');
    if (rows && rows.length) return rows[0].finished_at || null;
    // 줄이 하나도 없다 = 표는 있는데 아직 동기화가 안 돌았다. 물러난다.
  } catch {
    // 표가 없다(404). 아래로.
  }
  try {
    const rows = await sbSelect(
      'dg_attendance?select=updated_at,dg_members!inner(cohort_id)' +
      `&dg_members.cohort_id=eq.${enc}&order=updated_at.desc&limit=1`);
    if (rows && rows.length) return rows[0].updated_at || null;
  } catch {
    // 둘 다 못 읽으면 폴링은 아무것도 하지 않는다.
  }
  return null;
}

/**
 * 데이터가 바뀌면 저절로 다시 읽는다.
 *
 * @param {object|number} opts  숫자를 주면 intervalMs 로 본다 (옛 호출부 호환).
 * @param {number} opts.intervalMs  폴링 간격. 기본 2분.
 * @param {number} opts.burstMs     이 시간 동안만 intervalMs 로 촘촘히 보고,
 *                                  지나면 평상시 간격으로 돌아온다.
 *                                  '시트에서 가져오기' 직후에 쓴다.
 */
export function startAutoRefresh(opts = {}) {
  const { intervalMs = POLL_INTERVAL_MS, burstMs = 0 } =
    (typeof opts === 'number') ? { intervalMs: opts } : (opts || {});

  stopAutoRefresh();
  // 돌고 있던 tick 이 await 중이면 그 finally 가 타이머를 다시 건다.
  // 세대를 올려 두면 옛 루프는 거기서 스스로 멈춘다 (안 그러면 둘이 같이 돈다).
  const gen = ++pollGen;

  const burstUntil = burstMs > 0 ? Date.now() + burstMs : 0;

  // setInterval 이 아니라 타이머를 다시 거는 방식이다. 한 번의 새로고침이
  // 간격보다 오래 걸려도 겹쳐 들어오지 않는다.
  const tick = async () => {
    pollTimer = null;
    if (gen !== pollGen) return;
    try {
      // 배경 탭에서는 쉰다. 돌아오면 다음 차례에 알아서 따라잡는다.
      if (typeof document !== 'undefined' && document.hidden) return;
      if (pollBusy) return;

      const cohortId = state.cohortId || await getActiveCohortId();
      if (!cohortId) return;

      const mark = await fetchSyncMark(cohortId);
      if (!mark) return;

      if (lastSyncMark === null) { lastSyncMark = mark; return; }
      if (mark === lastSyncMark) return;

      // ⚠️ 깃발은 **새로고침이 성공한 뒤에** 올린다. 먼저 올리면 한 번
      // 실패했을 때 다시 시도할 근거가 사라진다 (예전 버그가 그랬다).
      pollBusy = true;
      try {
        await ensureLoaded({ forceRefresh: true });
        lastSyncMark = mark;
      } finally {
        pollBusy = false;
      }
    } catch (err) {
      console.log('자동 새로고침 실패 — 다음 차례에 다시 시도합니다:', err);
    } finally {
      if (gen === pollGen) {
        const next = (burstUntil && Date.now() < burstUntil) ? intervalMs : POLL_INTERVAL_MS;
        pollTimer = setTimeout(tick, next);
      }
    }
  };

  pollTimer = setTimeout(tick, intervalMs);

  if (!pollUnloadHooked && typeof window !== 'undefined') {
    pollUnloadHooked = true;
    window.addEventListener('beforeunload', stopAutoRefresh);
  }
}

/** 폴링을 멈춘다. 다시 부르려면 startAutoRefresh(). */
export function stopAutoRefresh() {
  pollGen++;
  if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
}
