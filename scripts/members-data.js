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
import { matches as hangulMatches } from './hangul.js?v=77';
import { sbSelect, getActiveCohortId, getCachedCohortId } from './supabase-config.js?v=77';

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
    age: m.age ?? '',
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
    members: members.map(m => buildMemberRow(m, teamLinks, attByMember)),
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
    sbSelect(`dg_homework?select=lecture&member_id=eq.${member._uuid}&order=lecture`)
      .catch(() => []),
  ]);

  const byDate = new Map(attRows.map(r => [r.session_date, r.status ?? '']));
  const lunchSet = new Set(lunchRows.filter(r => r.applied).map(r => r.session_date));

  // 과제는 '몇 강' 이라 날짜가 없다. 회차에 이름이 적혀 있을 때만 붙인다.
  // 이름이 없으면 순서로 짐작해야 하는데, 그러면 엉뚱한 회차에 붙는다.
  const hwNames = new Set(hwRows.map(r => normalizeLecture(r.lecture)).filter(Boolean));
  const today = state.today || todayISO();

  return state.sessions
    .filter(s => s.date <= today)
    .map(s => ({
      date: s.date,
      key: s.key,
      name: s.name || '',
      status: byDate.get(s.date) || '',
      lunch: lunchSet.has(s.date),
      homework: !!(s.name && hwNames.has(normalizeLecture(s.name))),
    }));
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
function normalizeLecture(v) {
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
    sbSelect(`dg_homework?select=member_id,lecture&member_id=in.${list}` +
             `&order=member_id,lecture`).catch(() => []),
  ]);

  const lunch = new Map();
  for (const r of lunchRows) {
    if (!lunch.has(r.member_id)) lunch.set(r.member_id, new Set());
    lunch.get(r.member_id).add(r.session_date);
  }

  const homework = new Map();
  for (const r of hwRows) {
    const key = normalizeLecture(r.lecture);
    if (!key) continue;
    if (!homework.has(r.member_id)) homework.set(r.member_id, new Set());
    homework.get(r.member_id).add(key);
  }

  return { lunch, homework };
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
  const empty = { lunch: new Set(), homework: new Set(),
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
        'dg_homework?select=member_id,lecture&order=member_id,lecture'
      );
    } catch (err) {
      console.log('과제 조회 실패:', err);
      hwLoaded = false;      // 캐시에 남기지 않는다 — 다음에 다시 받는다
    }
  }
  const hwRows = homeworkAllCache || [];

  // 강의명은 시트와 폼에 따로 적혀 글자가 어긋난다. 정규화한 뒤에 견준다.
  const key = normalizeLecture(lectureName);
  const homework = new Set(
    key ? hwRows.filter(r => normalizeLecture(r.lecture) === key).map(r => r.member_id) : []
  );

  return {
    lunch: new Set(lunchRows.map(r => r.member_id)),
    homework,
    hwLoaded,
    hwTotal: hwRows.length,
    hwNear: homework.size ? [] : nearbyLectures(hwRows, lectureName),
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

  return rows.map(r => ({
    lecture: r.lecture || '',
    kind: r.kind || '',
    content: r.content || '',
    submittedAt: r.submitted_at || '',
  }));
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
export function getSessions({ all = false } = {}) {
  if (all) return state.sessions.slice();
  const today = state.today || todayISO();
  return state.sessions.filter(s => s.date <= today);
}

/** GAS 가 확정한 오늘 (YYYY-MM-DD). 미래 회차를 가려내는 데 쓴다. */
export function getToday() {
  return state.today || todayISO();
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
 * 명단·편성·위치·과제는 하루 한 번 도는 워크플로로만 DB 에 들어온다. 수업 직전에
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
