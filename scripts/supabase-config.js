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

const PAGE_SIZE = 1000;

/**
 * PostgREST 조회.
 *
 * PostgREST 는 한 번에 1000행만 준다. **조용히 잘린다** — 오류도 안 나서
 * 화면은 "출석 0" 인데 DB 는 값이 있는 앞뒤 안 맞는 상태가 된다.
 * 인원 × 회차는 금방 1000을 넘으므로 끝까지 나눠 받는다.
 *
 * order 가 없으면 페이지마다 순서가 흔들려 행이 빠지거나 겹친다.
 * 호출부가 order 를 안 넣었으면 여기서 넣어 준다.
 *
 * @param {string} path 테이블 이름과 쿼리스트링 (예: 'dg_members?select=*&cohort_id=eq.DG-2026')
 */
export async function sbSelect(path) {
  // 나눠 받으려면 정렬 기준이 있어야 한다. 테이블마다 어떤 열이 있는지는
  // 여기서 알 수 없으므로 (dg_attendance 에는 id 가 없다) 호출부가 정한다.
  // limit 을 직접 지정했다면 호출부의 뜻을 존중해 한 번만 받는다.
  const paginate = /[?&]order=/.test(path) && !/[?&]limit=/.test(path);

  if (!paginate) {
    const res = await fetch(`${REST}/${path}`, { headers: baseHeaders });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Supabase 조회 실패 (${res.status}): ${body.slice(0, 200)}`);
    }
    const rows = await res.json();
    if (rows.length === PAGE_SIZE) {
      console.log(`⚠️ ${path.split('?')[0]} 가 정확히 ${PAGE_SIZE}행입니다 — ` +
                  '잘렸을 수 있습니다. order 를 넣어 나눠 받으세요.');
    }
    return rows;
  }

  const out = [];
  let offset = 0;
  for (;;) {
    const res = await fetch(`${REST}/${path}&limit=${PAGE_SIZE}&offset=${offset}`,
                            { headers: baseHeaders });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Supabase 조회 실패 (${res.status}): ${body.slice(0, 200)}`);
    }
    const rows = await res.json();
    out.push(...rows);
    if (rows.length < PAGE_SIZE) return out;
    offset += PAGE_SIZE;
  }
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
