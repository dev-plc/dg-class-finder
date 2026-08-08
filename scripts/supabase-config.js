// Supabase 접속 설정 (DGfinder).
//
// DGfinder 는 plc-class-finder 와 별개의 Supabase 프로젝트를 쓴다.
// 교육과정도 시트도 다르고, 무엇보다 한쪽의 service_role 키가 새더라도
// 다른 쪽 명단·출석에 닿지 않게 하려는 것이다.
//
// anon 키는 공개돼도 안전하다 — RLS 정책이 실제 접근을 제어한다.
// dg_* 테이블은 select 만 열려 있고 쓰기 정책이 없어 이 키로는 아무것도 못 쓴다.
//
// service_role 키는 여기에 넣지 않는다. GitHub Secrets 에만 둔다.

export const SUPABASE_URL = 'https://fcoqnyqykfuyhzatzoif.supabase.co';
export const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZjb3FueXF5a2Z1eWh6YXR6b2lmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODYxNzkzNTcsImV4cCI6MjEwMTc1NTM1N30.7YhVaSon-h1sg7Fbt1HzsVospx8PmdGRUF9nJrNhFVg';

// 시트가 대상을 밝히지 않았을 때만 쓰이는 폴백.
// 평소에는 DB 에 실제로 들어있는 cohort_id 를 따라간다.
export const DEFAULT_COHORT_ID = 'DG-2026';
const ACTIVE_COHORT_KEY = 'dg_active_cohort';

const REST = `${SUPABASE_URL}/rest/v1`;

const baseHeaders = {
  apikey: SUPABASE_ANON_KEY,
  Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
};

/**
 * PostgREST 조회.
 * @param {string} path 테이블 이름과 쿼리스트링 (예: 'dg_members?select=*&cohort_id=eq.DG-2026')
 */
export async function sbSelect(path) {
  const res = await fetch(`${REST}/${path}`, { headers: baseHeaders });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Supabase 조회 실패 (${res.status}): ${body.slice(0, 200)}`);
  }
  return res.json();
}

export function getCachedCohortId() {
  try { return localStorage.getItem(ACTIVE_COHORT_KEY); } catch { return null; }
}

/**
 * 지금 데이터가 들어있는 대상(기수) ID.
 *
 * DGfinder 는 기수 테이블을 따로 두지 않는다. dg_members 에 실제로 존재하는
 * cohort_id 중 가장 최근 갱신된 것을 쓴다 — 동기화가 새 대상을 넣으면
 * 앱이 배포 없이 따라온다.
 */
export async function getActiveCohortId() {
  try {
    const rows = await sbSelect(
      'dg_members?select=cohort_id&status=eq.active&order=updated_at.desc&limit=1');
    const id = rows?.[0]?.cohort_id;
    if (id) {
      try { localStorage.setItem(ACTIVE_COHORT_KEY, id); } catch { /* 무시 */ }
      return id;
    }
    console.log('dg_members 에 활성 인원이 없습니다.');
  } catch (e) {
    console.log('대상 조회 실패, 마지막 값 사용:', e);
  }
  return getCachedCohortId() || DEFAULT_COHORT_ID;
}
