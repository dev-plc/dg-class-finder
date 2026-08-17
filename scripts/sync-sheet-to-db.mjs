// 시트(GAS) → Supabase 동기화. GitHub Actions 에서 돈다.
//
// 사용법
//   node scripts/sync-sheet-to-db.mjs --dry-run     쓰기 없이 확인만
//   node scripts/sync-sheet-to-db.mjs               실제 반영
//   node scripts/sync-sheet-to-db.mjs --cohort=DG-2026
//
// 환경변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, GAS_API_URL
//
// 대체로 upsert 만 한다. 시트에서 지운 행은 DB 에 남는다.
// 인원은 지우지 않고 status='inactive' 로 내린다 — 이력을 잃지 않으려는 것.
//
// 김밥은 예외로 지운다. 신청을 취소했는데 계속 세면 그만큼 더 시키게 된다.
// 지금 명단에 있는 사람의 것만 지운다 (내려간 사람 이력은 그대로 둔다).

import { createClient } from '@supabase/supabase-js';

const args = process.argv.slice(2);
const getArg = (name) => {
  const hit = args.find(a => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : null;
};

const DRY_RUN = args.includes('--dry-run');
const COHORT_ARG = (getArg('cohort') || process.env.COHORT_ID || '').trim();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GAS_API_URL = process.env.GAS_API_URL;

for (const [k, v] of Object.entries({ SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY, GAS_API_URL })) {
  if (!v) {
    console.log(`❌ 환경변수 ${k} 가 없습니다.`);
    process.exit(1);
  }
}

// URL 은 로그에 그대로 남기지 않는다 (배포 ID 가 드러난다).
const maskGas = (url) => String(url).replace(/\/s\/[^/]+\//, '/s/***/');

const sb = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

const trim = (v) => (v == null ? '' : String(v).trim());
const toInt = (v) => {
  const n = parseInt(String(v ?? '').replace(/[^0-9-]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

console.log(`🔧 mode: ${DRY_RUN ? 'DRY RUN (쓰기 없음)' : 'LIVE'}`);
console.log(`🔗 GAS:  ${maskGas(GAS_API_URL)}\n`);

// ---------------------------------------------------------------- 시트 읽기
console.log('▶ 시트 읽기');
const res = await fetch(`${GAS_API_URL}?t=${Date.now()}`, { redirect: 'follow' });
if (!res.ok) {
  console.log(`❌ GAS 응답 ${res.status}.`);
  if (res.status === 404) {
    console.log('   URL 이 /exec 로 끝나는지 확인하세요. /dev 는 본인만 접근할 수 있어 Actions 에서 404 입니다.');
    console.log('   배포를 새로 만들면 URL 이 바뀝니다. "배포 관리 → ✏️ → 새 버전" 으로 올리면 URL 이 유지됩니다.');
  }
  process.exit(1);
}
const gas = await res.json();
if (!gas.success) {
  console.log(`❌ GAS 오류: ${gas.message}`);
  process.exit(1);
}

const rows = gas.data || [];
console.log(`   인원 ${rows.length}명`);
console.log(`   locationMap ${Object.keys(gas.locationMap || {}).length}건`);
console.log(`   teamLinkMap ${Object.keys(gas.teamLinkMap || {}).length}건`);

// ------------------------------------------------------------ 대상(기수) 결정
//
// 시트가 스스로 어느 대상인지 밝히게 하고, 지정값과 다르면 아무것도 쓰지 않는다.
// 엉뚱한 대상에 명단을 밀어넣으면 기존 인원이 통째로 inactive 가 된다.
const sheetCohort = trim(gas.cohortHint);

if (COHORT_ARG && sheetCohort && COHORT_ARG !== sheetCohort) {
  console.log(`❌ 시트는 '${sheetCohort}' 인데 '${COHORT_ARG}' 로 동기화하려 합니다. 중단합니다.`);
  console.log(`   그대로 진행하면 '${sheetCohort}' 명단이 '${COHORT_ARG}' 로 들어가고,`);
  console.log(`   '${COHORT_ARG}' 의 기존 인원은 전부 inactive 가 됩니다.`);
  console.log(`   시트대로 넣으려면 대상을 비우거나 '${sheetCohort}' 로 지정하세요.`);
  process.exit(1);
}

let COHORT_ID = COHORT_ARG || sheetCohort;
if (!COHORT_ID) {
  console.log('❌ 대상을 정할 수 없습니다.');
  console.log('   시트 상단(윗 6행 안)에 \'DG-2026\' 같은 표식을 적고 GAS 가 cohortHint 로 반환하게 하거나,');
  console.log('   워크플로 입력에서 대상을 직접 지정하세요.');
  console.log('   (표식 없이 진행하면 엉뚱한 대상을 덮어쓰는 사고를 막을 수 없습니다.)');
  process.exit(1);
}
console.log(`🏷️  대상: ${COHORT_ID}${sheetCohort ? ' (시트 표식)' : ' (직접 지정)'}\n`);

// ---------------------------------------------------------------- 인원 정리
const members = [];
const skipped = [];
const seen = new Set();

for (const r of rows) {
  const name = trim(r.name);
  const phone = trim(r.phone);

  if (!name) {
    skipped.push(`(이름없음, id='${trim(r.id)}')`);
    continue;
  }

  const key = `${name}|${phone}`;
  if (seen.has(key)) {
    skipped.push(`${name}${phone} (중복)`);
    continue;
  }
  seen.add(key);

  members.push({
    _id: `${name}${phone}`,
    cohort_id: COHORT_ID,
    name,
    // null 로 두면 unique (cohort_id, name, phone) 가 걸리지 않아
    // 동기화할 때마다 같은 사람의 새 행이 쌓인다.
    phone,
    team: trim(r.team),
    team_no: toInt(r['no.'] ?? r.team_no),
    // 시트에서 몇 번째 줄인가. 명단 차례를 시트와 똑같이 맞추는 데 쓴다.
    // GAS v26 부터 온다. 없으면 null 이고, 그때는 team_no 로 정렬한다.
    sheet_row: toInt(r.sheetRow),
    location: trim(r.location),
    role: trim(r.role),
    age: toInt(r.age),
    lunch: trim(r.lunch),
    status: 'active',
  });
}

console.log(`▶ 인원 ${members.length}명 정리`);
if (skipped.length) {
  // 이름 없이 건수만 찍으면 누구인지 몰라 원인을 못 찾는다.
  console.log(`   ⚠️ 건너뜀 ${skipped.length}명: ${skipped.join(', ')}`);
}

// ID 열은 '이름 + 전화 뒷4자리' 여야 한다. 여기에 역할이나 메모가 섞이면
// 건너뛰지 않고 조용히 잘못 쪼개진다 ('이민재6550 서브튜터' → phone='터').
// 그대로 넣으면 아무도 조회되지 않으므로 반영 전에 잡는다.
const badPhone = members.filter(m => !/^\d{4}$/.test(m.phone));
if (badPhone.length) {
  console.log(`   ⚠️ 전화 4자리가 아닌 ${badPhone.length}명: ` +
              badPhone.map(m => `${m.name}[${m.phone}]`).join(', '));
  console.log('      ID 열에 역할·메모가 섞이면 이름/전화가 어긋납니다. 시트를 고친 뒤 다시 돌리세요.');
}

const noTeam = members.filter(m => !m.team);
if (noTeam.length) {
  console.log(`   ⚠️ 조 없음 ${noTeam.length}명: ${noTeam.map(m => `${m.name}${m.phone}`).join(', ')}`);
}

// ------------------------------------------------------------------ 위치·링크
const locations = Object.entries(gas.locationMap || {})
  .filter(([loc]) => trim(loc) && !loc.endsWith('링크'))
  .map(([loc, url]) => ({
    location: trim(loc),
    image_url: trim(url),
    detail_url: trim((gas.locationMap || {})[`${loc}링크`]) || null,
  }));

const teamLinks = Object.entries(gas.teamLinkMap || {})
  .filter(([team]) => trim(team))
  .map(([team, url]) => ({
    cohort_id: COHORT_ID,
    team: trim(team),
    chat_url: trim(url),
  }));

console.log(`▶ 위치 ${locations.length}건 · 안내방 ${teamLinks.length}건`);

// -------------------------------------------------------------------- 출석
//
// GAS 가 회차별 출석을 주면 전부, 오늘치만 주면 오늘 것만 반영한다.
// 어느 쪽도 없으면 출석은 건너뛴다 (조회 기능에는 지장 없다).
const MMDD = /^(\d{1,2})\/(\d{1,2})$/;

// 'MM/DD' → 'YYYY-MM-DD'. Date 로 파싱하기 전에 형태를 먼저 확인한다
// (형태를 안 보고 new Date(값).toISOString() 을 부르면 RangeError 로 죽는다).
function toISODate(mmdd, year) {
  const m = String(mmdd || '').trim().match(MMDD);
  if (!m) return null;
  const mm = String(m[1]).padStart(2, '0');
  const dd = String(m[2]).padStart(2, '0');
  const iso = `${year}-${mm}-${dd}`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

// 회차마다 연도를 붙인다.
//
// 시트 헤더에는 MM/DD 뿐이라 연도가 없다. 전부 같은 해로 찍으면 11월에 시작해
// 1월에 끝나는 학기가 뒤집힌다 (01/25 가 11/02 보다 앞서고, 11·12월이 미래가 된다).
// 열 순서를 시간순으로 보고, 달이 작아지는 지점에서 해가 바뀐 것으로 본다.
function buildSessionDates(keys, startYear) {
  const out = new Map();
  let year = startYear;
  let prevMonth = null;
  for (const key of keys) {
    const m = String(key || '').trim().match(MMDD);
    if (!m) continue;
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    if (prevMonth !== null && month < prevMonth) year++;   // 12 → 01
    prevMonth = month;
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    // 형태를 확인하고 쓴다. 안 보고 Date 로 넘기면 엉뚱한 값에서 죽는다.
    if (!Number.isNaN(Date.parse(iso))) out.set(key, iso);
  }
  return out;
}

const START_YEAR = toInt(getArg('start-year')) || toInt(process.env.START_YEAR)
  || new Date().getFullYear();
const attendanceBySheetId = [];
const sessionRows = [];   // dg_sessions 에 넣을 회차 목록

if (Array.isArray(gas.sessions) && gas.sessions.length) {
  // GAS v19+ — 연도까지 확정된 회차를 준다. 여기서 추측하지 않는다.
  // 판단이 두 곳에 있으면 반드시 갈라지므로 GAS 한 곳으로 모았다.
  const isoList = gas.sessions.map(s => s.date);
  console.log(`▶ 회차 ${isoList.length}개: ${isoList[0]} ~ ${isoList[isoList.length - 1]} (GAS 확정)`);

  for (const s of gas.sessions) {
    sessionRows.push({
      cohort_id: COHORT_ID,
      session_date: s.date,
      label: trim(s.key),
      // 시트 날짜 헤더 윗줄의 강의명. 없으면 빈 값이다.
      name: trim(s.label) || null,
    });
  }
  const named = sessionRows.filter(s => s.name).length;
  const fromSheet = gas.sessionNamesFromSheet;
  if (fromSheet) {
    console.log(`   회차 이름 ${named}/${sessionRows.length}개 — 시트 날짜 헤더 윗줄에서 읽음`);
  } else {
    // 이 시트에는 '자유교제' 처럼 강의가 아닌 주가 섞여 있다. 순번으로 매기면
    // 그 뒤 회차가 통째로 한 칸씩 밀리고, 과제가 엉뚱한 회차에 붙는다.
    console.log(`   ⚠️ 회차 이름을 순서대로 매겼습니다 ('1강'…${named}개).`);
    console.log('      강의가 아닌 주(자유교제 등)가 날짜 열에 섞여 있으면 번호가 밀려');
    console.log('      과제가 엉뚱한 회차에 붙습니다. 시트 날짜 헤더 윗줄에 강의명을 적으세요.');
  }

  for (const r of rows) {
    const id = `${trim(r.name)}${trim(r.phone)}`;
    const map = r.attendanceByDate || {};
    for (const iso of isoList) {
      const status = trim(map[iso]);
      if (!status) continue;
      attendanceBySheetId.push({ _id: id, session_date: iso, status });
    }
  }
  console.log(`▶ 출석 ${attendanceBySheetId.length}건`);
} else if (Array.isArray(gas.sessionDates) && gas.sessionDates.length) {
  // GAS v18 이하 — MM/DD 만 준다. 연도를 여기서 붙인다.
  const dateOf = buildSessionDates(gas.sessionDates, START_YEAR);
  const isoList = [...dateOf.values()];

  console.log(`▶ 회차 ${dateOf.size}개: ${isoList[0]} ~ ${isoList[isoList.length - 1]}`);
  console.log(`   (시작 연도 ${START_YEAR}. 틀리면 --start-year=YYYY 로 지정하세요)`);
  console.log('   GAS 를 v19 로 올리면 연도를 GAS 가 확정해 줍니다.');

  for (const r of rows) {
    const id = `${trim(r.name)}${trim(r.phone)}`;
    const map = r.attendanceByDate || {};
    for (const key of gas.sessionDates) {
      const iso = dateOf.get(key);
      if (!iso) continue;
      const status = trim(map[key]);
      if (!status) continue;
      attendanceBySheetId.push({ _id: id, session_date: iso, status });
    }
  }
  console.log(`▶ 출석 ${attendanceBySheetId.length}건`);
} else if (trim(gas.todayKey)) {
  const iso = toISODate(gas.todayKey, START_YEAR);
  if (iso) {
    for (const r of rows) {
      const status = trim(r.attendance);
      if (!status) continue;
      attendanceBySheetId.push({ _id: `${trim(r.name)}${trim(r.phone)}`, session_date: iso, status });
    }
    console.log(`▶ 출석 ${attendanceBySheetId.length}건 (오늘 ${gas.todayKey} 만)`);
  }
} else {
  console.log('▶ 출석 건너뜀 — GAS 가 sessionDates·todayKey 중 아무것도 주지 않았습니다.');
}

console.log('');

// -------------------------------------------------------------------- 쓰기
async function upsert(table, data, onConflict) {
  if (!data.length) return [];

  // 같은 배치에 conflict 키가 중복되면 Postgres 가 거부한다.
  // 뒤에 오는 행을 최신으로 보고 앞의 것을 덮어쓴다.
  if (onConflict) {
    const cols = onConflict.split(',').map(c => c.trim());
    const byKey = new Map();
    for (const row of data) byKey.set(cols.map(c => row[c] ?? '').join('||'), row);
    if (byKey.size !== data.length) {
      console.log(`   ℹ️ ${table}: 배치 내 중복 ${data.length - byKey.size}건 제거`);
      data = [...byKey.values()];
    }
  }

  const out = [];
  for (let i = 0; i < data.length; i += 500) {
    const batch = data.slice(i, i + 500).map(({ _id, ...rest }) => rest);
    const { data: ret, error } = await sb.from(table).upsert(batch, { onConflict }).select();
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(ret || []));
  }
  return out;
}

if (DRY_RUN) {
  console.log('🔍 DRY RUN — 아무것도 쓰지 않았습니다. 위 건수가 맞는지 확인하세요.');
  const sample = members[0];
  if (sample) {
    // 실명이 로그에 남지 않도록 필드 이름만 보여준다.
    console.log(`   인원 레코드 필드: ${Object.keys(sample).filter(k => k !== '_id').join(', ')}`);
  }
  process.exit(0);
}

// sheet_row 열이 아직 없을 수 있다 (supabase/dg_sheet_row.sql 을 안 돌렸을 때).
// 그대로 밀면 동기화 전체가 실패한다. 빼고 진행하고 크게 알린다 —
// 동기화가 멈추는 것보다 명단 차례가 어긋나는 편이 낫다.
const { error: probeErr } = await sb.from('dg_members').select('sheet_row').limit(1);
if (probeErr) {
  console.log('⚠️ dg_members.sheet_row 열이 없습니다 — 명단 차례가 시트와 어긋날 수 있습니다.');
  console.log('   supabase/dg_sheet_row.sql 을 Supabase SQL Editor 에서 한 번 실행하세요.');
  for (const m of members) delete m.sheet_row;
}

console.log('▶ dg_members');
const saved = await upsert('dg_members', members, 'cohort_id,name,phone');
console.log(`   ${saved.length}명 반영`);

// 시트에서 사라진 인원은 지우지 않고 내린다.
const activeIds = new Set(members.map(m => `${m.name}|${m.phone}`));
const { data: existing, error: exErr } = await sb
  .from('dg_members').select('id,name,phone,status').eq('cohort_id', COHORT_ID);
if (exErr) throw new Error(`기존 인원 조회 실패: ${exErr.message}`);

const toDeactivate = (existing || [])
  .filter(m => m.status === 'active' && !activeIds.has(`${m.name}|${m.phone || ''}`));
if (toDeactivate.length) {
  const { error } = await sb.from('dg_members')
    .update({ status: 'inactive' })
    .in('id', toDeactivate.map(m => m.id));
  if (error) throw new Error(`inactive 처리 실패: ${error.message}`);
  console.log(`   ⚠️ 시트에 없어 inactive 처리 ${toDeactivate.length}명: ` +
              toDeactivate.map(m => `${m.name}${m.phone || ''}`).join(', '));
}

console.log('▶ dg_locations');
await upsert('dg_locations', locations, 'location');
console.log(`   ${locations.length}건 반영`);

console.log('▶ dg_team_links');
await upsert('dg_team_links', teamLinks, 'cohort_id,team');
console.log(`   ${teamLinks.length}건 반영`);

// 회차 목록. 조원 화면이 본인 출석 그리드를 그릴 때 쓴다 —
// 출석 기록만으로는 '기록 없는 회차' 와 '수업 없던 날' 을 구분할 수 없다.
if (sessionRows.length) {
  console.log('▶ dg_sessions');
  await upsert('dg_sessions', sessionRows, 'cohort_id,session_date');
  console.log(`   ${sessionRows.length}건 반영`);
}

// -------------------------------------------------------------------- 김밥
{
  const uuidById = new Map(saved.map(m => [`${m.name}${m.phone || ''}`, m.id]));
  const lunchRows = [];
  const appliedByDate = new Map();      // 'YYYY-MM-DD' → Set(uuid)
  for (const r of rows) {
    const uuid = uuidById.get(`${trim(r.name)}${trim(r.phone)}`);
    if (!uuid) continue;
    for (const [date, val] of Object.entries(r.lunchByDate || {})) {
      if (!trim(val)) continue;
      lunchRows.push({
        cohort_id: COHORT_ID, member_id: uuid, session_date: date, applied: true,
      });
      if (!appliedByDate.has(date)) appliedByDate.set(date, new Set());
      appliedByDate.get(date).add(uuid);
    }
  }

  // 시트에서 읽은 회차 목록. GAS v25 부터 준다. 없으면 신청이 있는 회차만
  // 아는 셈이라, 전원이 취소한 회차는 비우지 못한다.
  const lunchDates = Array.isArray(gas.lunchDates) && gas.lunchDates.length
    ? gas.lunchDates
    : [...appliedByDate.keys()];

  if (lunchRows.length) {
    console.log('▶ dg_lunch');
    await upsert('dg_lunch', lunchRows, 'cohort_id,member_id,session_date');
    console.log(`   ${lunchRows.length}건 반영`);
  } else {
    console.log('▶ 김밥 건너뜀 — GAS 가 lunchByDate 를 주지 않았습니다 (v21 로 재배포 필요)');
  }

  // 시트에서 지운 신청은 DB 에서도 지운다.
  //
  // upsert 만 하면 한 번 신청한 것은 영영 남는다. 취소했는데 계속 세어져
  // 김밥을 그만큼 더 시키게 된다. 원본은 시트이므로 시트에 없으면 없는 것이다.
  //
  // 다만 **지금 명단에 있는 사람만** 건드린다. 시트에서 내려간 사람(inactive)의
  // 옛 신청까지 지우면 이력이 사라진다 — 그건 시트가 '취소' 라고 말한 적이 없다.
  // (DRY RUN 은 위에서 이미 끝났다. 여기까지 왔으면 실제로 쓴다.)
  const rosterIds = new Set(saved.map(m => m.id));
  if (lunchDates.length) {
    let removed = 0;
    for (const date of lunchDates) {
      const { data: have, error } = await sb.from('dg_lunch')
        .select('member_id').eq('cohort_id', COHORT_ID).eq('session_date', date);
      if (error) throw new Error(`dg_lunch 조회 실패(${date}): ${error.message}`);

      const keep = appliedByDate.get(date) || new Set();
      const stale = (have || []).map(r => r.member_id)
        .filter(id => rosterIds.has(id) && !keep.has(id));

      // 한 번에 다 싣지 않는다. uuid 250개면 주소가 9KB 를 넘는다.
      for (let i = 0; i < stale.length; i += 100) {
        const { error: delErr } = await sb.from('dg_lunch').delete()
          .eq('cohort_id', COHORT_ID).eq('session_date', date)
          .in('member_id', stale.slice(i, i + 100));
        if (delErr) throw new Error(`dg_lunch 정리 실패(${date}): ${delErr.message}`);
      }
      removed += stale.length;
    }
    if (removed) console.log(`   🧹 시트에서 지워진 신청 ${removed}건 삭제`);
  }

  if (!Array.isArray(gas.lunchDates)) {
    console.log('   ℹ️ GAS 가 lunchDates 를 주지 않습니다 (v25 로 재배포하면 ' +
                '전원이 취소한 회차도 비웁니다).');
  }
}

// -------------------------------------------------------------------- 과제
if (Array.isArray(gas.homework) && gas.homework.length) {
  console.log('▶ dg_homework');
  const uuidById = new Map(saved.map(m => [`${m.name}${m.phone || ''}`, m.id]));

  const rows = [];
  const unknown = [];
  for (const h of gas.homework) {
    const uuid = uuidById.get(trim(h.id));
    if (!uuid) { unknown.push(trim(h.id)); continue; }
    rows.push({
      cohort_id: COHORT_ID,
      member_id: uuid,
      lecture: trim(h.lecture),
      kind: trim(h.kind),
      content: trim(h.content) || null,
      // 형태를 확인하고 넣는다. 날짜가 아니면 비워 둔다.
      submitted_at: Date.parse(trim(h.submittedAt)) ? trim(h.submittedAt) : null,
    });
  }

  if (unknown.length) {
    const uniq = [...new Set(unknown)];
    console.log(`   ⚠️ 명단에 없어 무시 ${uniq.length}명: ${uniq.join(', ')}`);
    console.log('      폼에 적은 이름·연락처가 명단과 다르면 여기 나옵니다.');
  }

  await upsert('dg_homework', rows, 'cohort_id,member_id,lecture,kind');
  console.log(`   ${rows.length}건 반영`);
}

if (attendanceBySheetId.length) {
  console.log('▶ dg_attendance');
  const uuidById = new Map(saved.map(m => [`${m.name}${m.phone || ''}`, m.id]));
  const attRows = [];
  const orphans = [];
  for (const a of attendanceBySheetId) {
    const uuid = uuidById.get(a._id);
    if (!uuid) { orphans.push(a._id); continue; }
    attRows.push({ member_id: uuid, session_date: a.session_date, status: a.status });
  }
  if (orphans.length) {
    const uniq = [...new Set(orphans)];
    console.log(`   ⚠️ 명단에 없어 무시 ${uniq.length}명: ${uniq.join(', ')}`);
  }
  await upsert('dg_attendance', attRows, 'member_id,session_date');
  console.log(`   ${attRows.length}건 반영`);
}

console.log('\n✅ 동기화 완료');
