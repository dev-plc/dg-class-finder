// 관리자 화면.
//
// 데이터는 index 와 같은 계층(members-data.js)에서 온다. 예전에는 '웹에 게시'
// 된 구글시트 CSV 를 직접 읽었는데, 그 URL 은 인증 없이 누구나 열 수 있어
// 명단 전체가 공개돼 있었다. 게다가 index 와 원본이 달라 두 화면이 서로 다른
// 값을 보여줄 수 있었다.
//
// ⚠️ 아래 로그인 확인은 화면 전환일 뿐 보호 장치가 아니다. 콘솔에서
//    sessionStorage 한 줄이면 통과한다. 이 화면이 보여주는 값은 모두 anon 키로
//    읽히는 것이라, 진짜로 가리려면 Supabase Auth 로 경로를 나눠야 한다.
//
// ⚠️ 이 화면은 이제 출결을 **쓴다**. 위 로그인 확인이 보호 장치가 아니라는 것이
//    한층 더 문제가 된다 — URL 을 아는 사람은 누구나 전 인원 출결을 한 번에
//    바꿀 수 있다. 진짜로 막으려면 Supabase Auth 가 필요하다.
//
// 쓰기는 DB 로 곧장 가지 않는다. 출결의 원본은 시트이고, 바뀐 사람만 모아
// GAS 로 보내면 GAS 가 시트에 쓴 뒤 DB 에 밀어넣는다 (members-data.js 참고).
import {
    ensureLoaded,
    getMembers,
    getSessions,
    getToday,
    isEditableStatus,
    refreshAttendance,
    saveAttendance,
    subscribe,
} from './scripts/members-data.js?v=50';

// 로그인 확인
if (!sessionStorage.getItem('adminLoggedIn')) {
    window.location.href = 'index.html';
}

// 데이터 저장 변수
let memberData = [];

// DOM 요소
const themeToggle = document.getElementById('themeToggle');
const logoutBtn = document.getElementById('logoutBtn');
const tabBtns = document.querySelectorAll('.tab-btn');
const tabContents = document.querySelectorAll('.tab-content');

// 검색 모드 요소
const searchNameInput = document.getElementById('searchName');
const adminSearchBtn = document.getElementById('adminSearchBtn');
const duplicateContainer = document.getElementById('duplicateContainer');
const duplicateList = document.getElementById('duplicateList');
const searchResultContainer = document.getElementById('searchResultContainer');
const searchCloseBtn = document.getElementById('searchCloseBtn');
const searchErrorMessage = document.getElementById('searchErrorMessage');
const searchErrorText = document.getElementById('searchErrorText');

// 조별/개인별 보기 요소
const teamsGrid = document.getElementById('teamsGrid');
const membersGrid = document.getElementById('membersGrid');
const teamModal = document.getElementById('teamModal');
const teamModalClose = document.getElementById('teamModalClose');
const teamModalTitle = document.getElementById('teamModalTitle');
const teamMembersList = document.getElementById('teamMembersList');
const teamFilter = document.getElementById('teamFilter');
const memberFilter = document.getElementById('memberFilter');

async function loadData() {
    try {
        // 캐시가 있으면 즉시 그리고 뒤에서 갱신한다.
        await ensureLoaded({
            onBackgroundRefreshError: (err) => console.log('백그라운드 갱신 실패:', err),
        });

        memberData = getMembers();
        console.log('✅ 데이터 로드 완료:', memberData.length, '명');

        renderTeamsView();
        renderMembersView();
    } catch (error) {
        console.log('❌ 데이터 로드 실패:', error);
        alert('데이터를 불러오는 중 오류가 발생했습니다. 인터넷 연결을 확인해주세요.');
    }
}

// 캐시로 먼저 그렸다면 갱신이 끝났을 때 다시 그려야 한다.
// 안 그리면 화면에는 옛 값이 남고, 보는 사람은 그것이 옛것인 줄 모른다.
subscribe((event) => {
    if (event.type !== 'refresh' && event.type !== 'cohort-changed'
        && event.type !== 'attendance-refresh') return;
    memberData = getMembers();
    renderTeamsView(teamFilter ? teamFilter.value : '');
    renderMembersView(memberFilter ? memberFilter.value : '');
    if (searchNameInput && searchNameInput.value.trim()) {
        try {
            searchMember();
        } catch (e) {
            console.log('자동 재검색 무시:', e);
        }
    }

    // 출석 관리 탭만 값을 스냅숏으로 떠 놓는다. 목록 화면은 그릴 때마다 최신을
    // 읽지만 여기는 로드 시점 값을 붙들고 있어, 새 데이터가 와도 모른다.
    //
    // 옛 값을 붙들고 있으면 사고가 난다 — DB 에는 ◎ 가 있는데 화면에는 빈칸으로
    // 보이고, 그 상태로 '빈칸 → 결석' 을 누르면 이수자가 결석으로 저장된다.
    // 그렇다고 편집 중에 덮으면 입력하던 것이 날아간다. **덮지 말고 알린다.**
    if (!attReady) return;
    if (attChanges().length === 0) {
        attSnapshot();
        renderAttList();
    } else {
        attStale = true;
        updateAttSummary();
    }
});
// 테마 토글
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
});

// 로그아웃
if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
        if (confirm("로그아웃 하시겠습니까?")) {
            // 세션 정보 삭제
            sessionStorage.removeItem('adminLoggedIn');
            // 로그인 페이지(index.html)로 이동
            window.location.href = 'index.html';
        }
    });
}

// 탭 전환
tabBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const tabName = btn.dataset.tab;
        
        // 모든 탭 버튼과 콘텐츠 비활성화
        tabBtns.forEach(b => b.classList.remove('active'));
        tabContents.forEach(c => c.classList.remove('active'));
        
        // 선택된 탭 활성화
        btn.classList.add('active');
        document.getElementById(`${tabName}Tab`).classList.add('active');

        // 출결은 시트에서 읽어야 해서 왕복이 붙는다. 탭을 열 때 한 번만 부른다.
        if (tabName === 'attendance') loadAttendance();
    });
});

// ==================== 검색 모드 ====================

// 검색 함수
function searchMember() {
    const name = searchNameInput.value.trim();
    
    if (!name) {
        showSearchError('이름을 입력해주세요.');
        searchNameInput.focus();
        return;
    }
    
    // 이름으로 검색
    const results = memberData.filter(m => m.name === name);
    
    if (results.length === 0) {
        showSearchError('일치하는 정보를 찾을 수 없습니다.');
    } else if (results.length === 1) {
        // 한 명만 있으면 바로 표시
        showSearchResult(results[0]);
    } else {
        // 동명이인이 있으면 선택 화면 표시
        showDuplicateSelection(results);
    }
}

// 동명이인 선택 화면
function showDuplicateSelection(members) {
    hideSearchError();
    searchResultContainer.style.display = 'none';
    
    duplicateList.innerHTML = '';
    members.forEach(member => {
        const item = document.createElement('div');
        item.className = 'duplicate-item';
        const phoneDisplay = member.phone ? ` (${member.phone})` : '';
        const ageDisplay = member.age ? ` · ${member.age}세` : '';
        item.innerHTML = `
            <div class="duplicate-item-id">${member.name}${phoneDisplay}</div>
            <div class="duplicate-item-info">${member.team} · ${member.location}${ageDisplay}</div>
        `;
        item.addEventListener('click', () => {
            showSearchResult(member);
            duplicateContainer.style.display = 'none';
        });
        duplicateList.appendChild(item);
    });
    
    duplicateContainer.style.display = 'block';
    setTimeout(() => {
        duplicateContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

// 검색 결과 표시
function showSearchResult(member) {
    hideSearchError();
    duplicateContainer.style.display = 'none';
    
    const phoneDisplay = member.phone ? ` (${member.phone})` : '';
    document.getElementById('searchResultName').textContent = `${member.name}${phoneDisplay}`;
    document.getElementById('searchResultTeam').textContent = member.team;
    document.getElementById('searchResultLocation').textContent = member.location;
    
    searchResultContainer.style.display = 'block';
    setTimeout(() => {
        searchResultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

// 검색 에러 표시
function showSearchError(message) {
    searchErrorText.textContent = message;
    searchErrorMessage.style.display = 'flex';
    searchResultContainer.style.display = 'none';
    duplicateContainer.style.display = 'none';
    
    setTimeout(() => {
        searchErrorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

// 검색 에러 숨기기
function hideSearchError() {
    searchErrorMessage.style.display = 'none';
}

// 검색 결과 닫기
function closeSearchResult() {
    searchResultContainer.style.display = 'none';
    duplicateContainer.style.display = 'none';
    searchNameInput.value = '';
    searchNameInput.focus();
}

// 검색 이벤트 리스너
adminSearchBtn.addEventListener('click', searchMember);
searchCloseBtn.addEventListener('click', closeSearchResult);
searchNameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchMember();
    }
});
searchNameInput.addEventListener('input', hideSearchError);

// ==================== 조별 보기 ====================

let allTeams = []; // 전체 조 데이터 저장

// 조 이름 자연 정렬. 출석 관리 탭도 같은 순서를 써야 두 화면이 어긋나지 않는다.
const TEAM_PREFERRED_ORDER = ['새', '남', '여', 'DG', 'C', 'O', 'V', 'Y', 'M', 'W'];

function compareTeamName(a, b) {
    const getPrefix = (str) => (String(str).match(/^[가-힣A-Za-z]+/)?.[0] || '');
    const getNum = (str) => {
        const match = String(str).match(/\d+/);
        return match ? parseInt(match[0], 10) : 0;
    };

    const prefA = getPrefix(a);
    const prefB = getPrefix(b);

    if (prefA !== prefB) {
        const idxA = TEAM_PREFERRED_ORDER.indexOf(prefA);
        const idxB = TEAM_PREFERRED_ORDER.indexOf(prefB);

        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
        if (idxA !== -1) return -1;
        if (idxB !== -1) return 1;

        return prefA.localeCompare(prefB, 'ko');
    }

    const numA = getNum(a);
    const numB = getNum(b);
    if (numA !== numB) return numA - numB;

    return String(a).localeCompare(String(b), 'ko', { numeric: true });
}

function renderTeamsView(filterText = '') {
    // 조별로 그룹화
    const teamGroups = {};
    memberData.forEach(member => {
        if (!teamGroups[member.team]) {
            teamGroups[member.team] = {
                name: member.team,
                location: member.location,
                members: []
            };
        }
        teamGroups[member.team].members.push(member);
    });
    
    // 조 이름 오름차순 정렬 (새1, 새2, ..., 남1, 남2, ..., C1, C2, O1, O2, V1, Y1, ...)
    const sortedTeams = Object.values(teamGroups).sort((a, b) => compareTeamName(a.name, b.name));

    allTeams = sortedTeams;
    
    // 필터링
    const filteredTeams = filterText 
        ? sortedTeams.filter(team => 
            team.name.toLowerCase().includes(filterText.toLowerCase()) ||
            team.location.toLowerCase().includes(filterText.toLowerCase())
          )
        : sortedTeams;
    
    // 카드 렌더링
    teamsGrid.innerHTML = '';
    if (filteredTeams.length === 0) {
        teamsGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-light); font-size: 16px;">검색 결과가 없습니다.</div>';
        return;
    }
    
    filteredTeams.forEach(team => {
        const card = document.createElement('div');
        card.className = 'team-card';
        const lunchCount = team.members.filter(m => (m.lunch && String(m.lunch).trim().toUpperCase() === 'O')).length;
        card.innerHTML = `
            <div class="team-card-header">
                <div class="team-card-name">${team.name}</div>
                <div class="team-card-count">${team.members.length}명</div>
            </div>
            <div class="team-card-location">${team.location}</div>
            <div class="team-card-lunch" style="font-size: 0.88em; margin-top: 6px; color: #166534; font-weight: 600;">
                🍱 김밥 ${lunchCount}개 (${team.members.length}명 중)
            </div>
        `;
        card.addEventListener('click', () => showTeamMembers(team));
        teamsGrid.appendChild(card);
    });
}

// 조별 보기 필터
teamFilter.addEventListener('input', (e) => {
    renderTeamsView(e.target.value.trim());
});

// 조원 목록 모달 표시
function showTeamMembers(team) {
    const lunchTotal = team.members.filter(m => (m.lunch && String(m.lunch).trim().toUpperCase() === 'O')).length;
    teamModalTitle.textContent = `${team.name} (${team.members.length}명 / 🍱 김밥 ${lunchTotal}개) · ${team.location}`;
    
    teamMembersList.innerHTML = '';
    team.members.forEach(member => {
        const card = document.createElement('div');
        card.className = 'team-member-card';
        const phoneDisplay = member.phone ? ` (${member.phone})` : '';
        const ageDisplay = member.age ? `${member.age}세` : '';
        const isLunchO = member.lunch && String(member.lunch).trim().toUpperCase() === 'O';
        const lunchBadge = isLunchO
            ? '<span class="badge-lunch-yes">🍱 김밥 O</span>'
            : '<span class="badge-lunch-no">김밥 X</span>';
        card.innerHTML = `
            <div class="team-member-id">${member.name}${phoneDisplay}${lunchBadge}</div>
            <div class="team-member-age">${ageDisplay}</div>
        `;
        teamMembersList.appendChild(card);
    });
    
    teamModal.classList.add('active');
    document.body.style.overflow = 'hidden';
}

// 조원 목록 모달 닫기
function closeTeamModal() {
    teamModal.classList.remove('active');
    document.body.style.overflow = 'auto';
}

teamModalClose.addEventListener('click', closeTeamModal);
teamModal.addEventListener('click', (e) => {
    if (e.target === teamModal) {
        closeTeamModal();
    }
});

// ==================== 개인별 보기 ====================

function renderMembersView(filterText = '') {
    // 이름순 정렬
    const sortedMembers = [...memberData].sort((a, b) => {
        return a.name.localeCompare(b.name, 'ko');
    });
    
    // 필터링
    const filteredMembers = filterText
        ? sortedMembers.filter(member =>
            member.name.toLowerCase().includes(filterText.toLowerCase()) ||
            (member.name + (member.phone || '')).toLowerCase().includes(filterText.toLowerCase()) ||
            member.team.toLowerCase().includes(filterText.toLowerCase()) ||
            member.location.toLowerCase().includes(filterText.toLowerCase())
          )
        : sortedMembers;
    
    membersGrid.innerHTML = '';
    if (filteredMembers.length === 0) {
        membersGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; padding: 40px; color: var(--text-light); font-size: 16px;">검색 결과가 없습니다.</div>';
        return;
    }
    
    filteredMembers.forEach(member => {
        const card = document.createElement('div');
        card.className = 'member-card';
        const phoneDisplay = member.phone ? ` (${member.phone})` : '';
        card.innerHTML = `
            <div class="member-card-id">${member.name}${phoneDisplay}</div>
            <div class="member-card-info">
                <div class="member-card-row">
                    <span class="member-card-label">조</span>
                    <span class="member-card-value team">${member.team}</span>
                </div>
                ${member.age ? `
                <div class="member-card-row">
                    <span class="member-card-label">나이</span>
                    <span class="member-card-value">${member.age}세</span>
                </div>` : ''}
                <div class="member-card-row">
                    <span class="member-card-label">위치</span>
                    <span class="member-card-value">${member.location}</span>
                </div>
            </div>
        `;
        membersGrid.appendChild(card);
    });
}

// 개인별 보기 필터
memberFilter.addEventListener('input', (e) => {
    renderMembersView(e.target.value.trim());
});

// ==================== 출석 관리 ====================
//
// 화면은 두 개의 Map 으로 돌아간다.
//
//   attBaseline : 시트에 저장돼 있는 값
//   attDraft    : 화면에서 고른 값
//
// 저장할 때 둘을 비교해 **다른 사람만** 보낸다. 전원을 보내면 사람이 시트에
// 직접 넣은 표기가 한 번에 지워진다.
//
// 앱이 쓰는 값은 O · X · 빈칸 뿐이다. '◎'(지난 기수 이수) · '−'(집계 제외) ·
// '돌봄' 같은 표기는 앱이 만든 것이 아니고 뜻도 모른다. 그런 칸은 baseline/draft
// 에 아예 넣지 않는다 — 넣으면 일괄 버튼 한 번에 지난 기수 기록이 날아간다.
// GAS 도 같은 규칙으로 그런 칸을 거부한다(kept). 한쪽만 바꾸면 어긋난다.

const ATT_PREFS_KEY = 'dg_admin_att_v1';
const ATT_STATES = [
    { value: 'O', label: 'O', title: '출석' },
    { value: 'X', label: 'X', title: '결석' },
];

const attSessionPicker = document.getElementById('attSessionPicker');
const attTeamPicker = document.getElementById('attTeamPicker');
const attSessionInfo = document.getElementById('attSessionInfo');
const attStaleNotice = document.getElementById('attStaleNotice');
const attReloadBtn = document.getElementById('attReloadBtn');
const attSummary = document.getElementById('attSummary');
const attList = document.getElementById('attList');
const attSaveInfo = document.getElementById('attSaveInfo');
const attSaveBtn = document.getElementById('attSaveBtn');

let attSessionDate = null;
let attTeam = '';                 // '' = 전체
let attBaseline = new Map();      // uuid → 시트 값 (O · X · '')
let attDraft = new Map();         // uuid → 화면에서 고른 값
let attLocked = new Map();        // uuid → 시트 표기 (앱이 못 건드리는 값)
let attSaving = false;
let attStale = false;             // 편집 중에 새 데이터가 도착했다
let attReady = false;             // 시트에서 출결을 받아왔는가
let attLoading = false;

function attEsc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function attChanges() {
    const out = [];
    for (const [uuid, status] of attDraft) {
        if (attBaseline.get(uuid) !== status) out.push({ uuid, status });
    }
    return out;
}

function attReadOnly() {
    return !!attSessionDate && attSessionDate > getToday();
}

function attNamesOf(uuids) {
    const byUuid = new Map(memberData.map(m => [m._uuid, m]));
    const names = uuids.map(u => byUuid.get(u)?.name).filter(Boolean);
    return names.length > 12
        ? names.slice(0, 12).join(', ') + ` 외 ${names.length - 12}명`
        : names.join(', ');
}

function attRoster() {
    const rows = attTeam ? memberData.filter(m => m.team === attTeam) : memberData.slice();
    return rows.filter(m => m._uuid);
}

// 고른 주차·조를 기억한다. 매번 처음부터 고르게 하면 안 된다.
function attSavePrefs() {
    try {
        localStorage.setItem(ATT_PREFS_KEY, JSON.stringify({ session: attSessionDate, team: attTeam }));
    } catch { /* 무시 */ }
}

function attLoadPrefs() {
    try {
        return JSON.parse(localStorage.getItem(ATT_PREFS_KEY) || '{}') || {};
    } catch { return {}; }
}

// 시트 값을 baseline/draft 로 떠 놓는다. 여기서부터는 스냅숏이다.
function attSnapshot() {
    attBaseline = new Map();
    attDraft = new Map();
    attLocked = new Map();
    if (!attSessionDate) return;

    for (const m of attRoster()) {
        const raw = (m.attendanceByDate || {})[attSessionDate] ?? '';
        if (!isEditableStatus(raw)) {
            attLocked.set(m._uuid, String(raw).trim());
            continue;
        }
        const v = String(raw).trim().toUpperCase();
        attBaseline.set(m._uuid, v);
        attDraft.set(m._uuid, v);
    }
    attStale = false;
}

function renderAttSessionPicker() {
    if (!attSessionPicker) return;
    // 관리자는 전 주차를 본다 — 지난 주차 정정이 주 업무다.
    // (조회 화면은 지난 주차만 본다. 미리 찍히면 결석 수가 부풀려진다.)
    const sessions = getSessions({ all: true });
    const today = getToday();
    attSessionPicker.innerHTML = [...sessions].reverse().map(s => {
        const future = s.date > today ? ' (예정)' : '';
        const label = `${s.key}${s.name ? ' · ' + s.name : ''}${future}`;
        return `<option value="${attEsc(s.date)}"${s.date === attSessionDate ? ' selected' : ''}>${attEsc(label)}</option>`;
    }).join('');
}

function renderAttTeamPicker() {
    if (!attTeamPicker) return;
    const teams = [...new Set(memberData.map(m => m.team).filter(Boolean))].sort(compareTeamName);
    const opts = [`<option value=""${attTeam === '' ? ' selected' : ''}>전체 (${memberData.length}명)</option>`];
    for (const t of teams) {
        const n = memberData.filter(m => m.team === t).length;
        opts.push(`<option value="${attEsc(t)}"${t === attTeam ? ' selected' : ''}>${attEsc(t)} (${n}명)</option>`);
    }
    attTeamPicker.innerHTML = opts.join('');
}

function updateAttSummary() {
    if (!attSummary) return;

    let present = 0, absent = 0, unmarked = 0;
    for (const v of attDraft.values()) {
        if (v === 'O') present++;
        else if (v === 'X') absent++;
        else unmarked++;
    }

    // 미기록은 결석이 아니다. 수업 전에 열면 결석이 인원수만큼 나온다.
    const parts = [
        `<span class="att-stat present">출석 ${present}</span>`,
        `<span class="att-stat absent">결석 ${absent}</span>`,
        `<span class="att-stat unmarked">미기록 ${unmarked}</span>`,
    ];

    if (attLocked.size) {
        const byMark = new Map();
        for (const v of attLocked.values()) byMark.set(v || '(빈)', (byMark.get(v || '(빈)') || 0) + 1);
        const marks = [...byMark].map(([k, n]) => `${attEsc(k)} ${n}`).join(' · ');
        parts.push(`<span class="att-stat locked" title="시트에서 직접 수정해야 하는 값">🔒 ${marks}</span>`);
    }

    attSummary.innerHTML = parts.join('');
    if (attStaleNotice) attStaleNotice.style.display = attStale ? 'flex' : 'none';
}

function refreshAttSaveBar() {
    if (!attSaveBtn || !attSaveInfo) return;
    const n = attChanges().length;
    const readOnly = attReadOnly();

    attSaveBtn.disabled = attSaving || n === 0 || readOnly;
    attSaveBtn.textContent = attSaving ? '저장 중...' : n ? `${n}명 저장` : '저장';
    attSaveInfo.textContent = readOnly
        ? '아직 지나지 않은 회차라 저장할 수 없습니다'
        : n ? `${n}명 변경됨` : '변경 사항 없음';
}

function renderAttList() {
    if (!attList) return;

    if (!attReady) {
        attList.innerHTML = `<div class="att-empty">${attLoading ? '시트에서 출결을 불러오는 중...' : '출결을 불러오지 못했습니다.'}</div>`;
        updateAttSummary();
        refreshAttSaveBar();
        return;
    }

    const roster = attRoster();
    if (!roster.length) {
        attList.innerHTML = '<div class="att-empty">해당하는 조원이 없습니다.</div>';
        updateAttSummary();
        refreshAttSaveBar();
        return;
    }

    const readOnly = attReadOnly();

    // 조를 '전체' 로 두면 조별로 묶는다. 조를 옮겨 다니지 않고 한 번에 찍는 게
    // 이 화면의 존재 이유다.
    const groups = new Map();
    for (const m of roster) {
        const key = m.team || '(조 없음)';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(m);
    }

    const html = [...groups.keys()].sort(compareTeamName).map(team => {
        const rows = groups.get(team)
            .sort((a, b) => (Number(a.team_no) || 999) - (Number(b.team_no) || 999)
                            || a.name.localeCompare(b.name, 'ko'))
            .map(m => {
                const locked = attLocked.has(m._uuid);
                const cur = attDraft.get(m._uuid) ?? '';
                const changed = !locked && attBaseline.get(m._uuid) !== cur;
                const cls = ['att-row',
                             locked ? 'locked' : '',
                             !locked && cur === '' ? 'unmarked' : '',
                             changed ? 'changed' : ''].filter(Boolean).join(' ');

                const controls = locked
                    ? `<span class="att-lock" title="앱이 고칠 수 없는 표기입니다. 시트에서 직접 수정하세요.">🔒 ${attEsc(attLocked.get(m._uuid) || '')}</span>`
                    : ATT_STATES.map(s => `
                        <button type="button"
                                class="att-state ${cur === s.value ? 'on' : ''}"
                                data-uuid="${attEsc(m._uuid)}" data-status="${attEsc(s.value)}"
                                title="${attEsc(s.title)}"${readOnly ? ' disabled' : ''}>${attEsc(s.label)}</button>`).join('');

                return `
                    <div class="${cls}">
                        <div class="att-who">
                            <span class="att-name">${attEsc(m.name)}</span>
                            <span class="att-meta">${attEsc(m.phone || '')}${m.role ? ' · ' + attEsc(m.role) : ''}</span>
                        </div>
                        <div class="att-states">${controls}</div>
                    </div>`;
            }).join('');

        return `
            <div class="att-group">
                <div class="att-group-head">${attEsc(team)} <span class="att-group-count">${groups.get(team).length}명</span></div>
                ${rows}
            </div>`;
    }).join('');

    attList.innerHTML = html;
    updateAttSummary();
    refreshAttSaveBar();
}

// 같은 버튼을 다시 누르면 미기록(빈칸)으로 돌아간다. 잘못 찍은 것을 되돌릴
// 방법이 없으면 안 된다.
if (attList) {
    attList.addEventListener('click', (e) => {
        const btn = e.target.closest('.att-state');
        if (!btn || attSaving || attReadOnly()) return;
        const uuid = btn.dataset.uuid;
        if (!attDraft.has(uuid)) return;
        attDraft.set(uuid, attDraft.get(uuid) === btn.dataset.status ? '' : btn.dataset.status);
        renderAttList();
    });
}

// ---- 일괄 버튼 ------------------------------------------------------------
// 무엇이 몇 개 바뀌는지 보여주고 묻는다. 조용히 바꾸면 되돌릴 수 없다.

function attGuard() {
    if (attSaving) return false;
    if (attReadOnly()) { alert('아직 지나지 않은 회차입니다.'); return false; }
    return true;
}

document.getElementById('attAllPresentBtn')?.addEventListener('click', () => {
    if (!attGuard()) return;
    const targets = [...attDraft].filter(([, v]) => v !== 'O').map(([u]) => u);
    if (!targets.length) return alert('이미 전원 출석입니다.');
    if (!confirm(`${targets.length}명을 출석(O)으로 바꿉니다.\n\n${attNamesOf(targets)}`)) return;
    for (const u of targets) attDraft.set(u, 'O');
    renderAttList();
});

document.getElementById('attBlankAbsentBtn')?.addEventListener('click', () => {
    if (!attGuard()) return;
    const blanks = [...attDraft].filter(([, v]) => v === '').map(([u]) => u);
    if (!blanks.length) return alert('미기록인 사람이 없습니다.');
    // '모르는 것' 을 '결석' 으로 바꾸는 동작이다. 안 나와도 되는 사람이 섞인다.
    if (!confirm(
        `미기록 ${blanks.length}명을 결석(X)으로 처리합니다.\n\n${attNamesOf(blanks)}\n\n` +
        `안 나와도 되는 분이 섞여 있으면 취소하고,\n시트에서 ◎ 나 − 로 먼저 표시하세요.`)) return;
    for (const u of blanks) attDraft.set(u, 'X');
    renderAttList();
});

document.getElementById('attClearBtn')?.addEventListener('click', () => {
    if (!attGuard()) return;
    const marked = [...attDraft].filter(([, v]) => v !== '').map(([u]) => u);
    if (!marked.length) return alert('지울 기록이 없습니다.');
    if (!confirm(
        `${marked.length}명의 출결 기록을 지웁니다 (미기록으로).\n\n${attNamesOf(marked)}\n\n` +
        `저장하면 시트의 값도 지워집니다.`)) return;
    for (const u of marked) attDraft.set(u, '');
    renderAttList();
});

// '되돌리기' 가 아니라 '마지막 저장 상태로' 다. 저장한 뒤에는 baseline 이
// 새 값으로 바뀌므로 저장 전으로는 못 돌아간다.
document.getElementById('attRevertBtn')?.addEventListener('click', () => {
    if (attSaving) return;
    if (!attChanges().length) return alert('되돌릴 변경이 없습니다.');
    if (!confirm('저장하지 않은 변경을 버리고 마지막 저장 상태로 되돌립니다.')) return;
    for (const [u, v] of attBaseline) attDraft.set(u, v);
    renderAttList();
});

attReloadBtn?.addEventListener('click', () => {
    if (attChanges().length &&
        !confirm('저장하지 않은 변경이 있습니다. 버리고 새로 불러올까요?')) return;
    loadAttendance({ force: true });
});

// ---- 저장 ----------------------------------------------------------------

async function saveAttChanges() {
    if (attSaving || attReadOnly()) return;
    const changes = attChanges();
    if (!changes.length) return;

    const byUuid = new Map(memberData.map(m => [m._uuid, m]));

    // ◎ 는 baseline 에 들어오지 않으므로 여기서 나올 수 없지만, 규칙이 바뀌어
    // 들어오게 되면 조용히 지나가지 않도록 남겨 둔다.
    const demoted = changes.filter(c => attBaseline.get(c.uuid) === '◎' && c.status === 'X');
    if (demoted.length && !confirm(
        `지난 기수 이수(◎) ${demoted.length}명을 결석으로 바꿉니다. 계속할까요?`)) return;

    const payload = [];
    for (const c of changes) {
        const m = byUuid.get(c.uuid);
        if (!m) continue;
        payload.push({ name: m.name, phone: m.phone, status: c.status });
    }
    if (!payload.length) return;

    attSaving = true;
    refreshAttSaveBar();

    try {
        const result = await saveAttendance(attSessionDate, payload);

        // 저장된 것만 반영된다. kept(다른 표기가 있어 두고 온 칸)·missing(시트에
        // 행이 없는 사람)은 실제로 안 바뀌었으므로, 화면을 시트 기준으로 다시 뜬다.
        attSnapshot();
        renderAttList();

        const notes = [];
        if (result.kept?.length) notes.push(`시트에 다른 표기가 있어 두었습니다: ${result.kept.join(', ')}`);
        if (result.missing?.length) notes.push(`시트에서 찾지 못했습니다: ${result.missing.join(', ')}`);
        if (attSaveInfo) attSaveInfo.textContent = `✅ ${result.saved}건 저장 완료`;
        if (notes.length) alert(notes.join('\n'));
    } catch (err) {
        console.log('출결 저장 실패:', err);
        alert('출결 저장에 실패했습니다: ' + err.message);
    } finally {
        attSaving = false;
        refreshAttSaveBar();
    }
}

attSaveBtn?.addEventListener('click', saveAttChanges);

// ---- 주차·조 전환 ---------------------------------------------------------

function attConfirmDiscard() {
    const n = attChanges().length;
    if (!n) return true;
    return confirm(`저장하지 않은 변경이 ${n}명 있습니다. 버리고 이동할까요?`);
}

attSessionPicker?.addEventListener('change', (e) => {
    if (!attConfirmDiscard()) { e.target.value = attSessionDate; return; }
    attSessionDate = e.target.value;
    attSavePrefs();
    attSnapshot();
    renderAttList();
    renderAttSessionInfo();
});

attTeamPicker?.addEventListener('change', (e) => {
    if (!attConfirmDiscard()) { e.target.value = attTeam; return; }
    attTeam = e.target.value;
    attSavePrefs();
    attSnapshot();
    renderAttList();
});

function renderAttSessionInfo() {
    if (!attSessionInfo) return;
    const s = getSessions({ all: true }).find(x => x.date === attSessionDate);
    if (!s) { attSessionInfo.textContent = ''; return; }
    const future = s.date > getToday();
    attSessionInfo.innerHTML = `<b>${attEsc(s.key)}</b>${s.name ? ' · ' + attEsc(s.name) : ''}` +
        (future ? ' <span class="att-future">아직 지나지 않은 회차 — 저장할 수 없습니다</span>' : '');
}

// ---- 초기화 ---------------------------------------------------------------

async function loadAttendance({ force = false } = {}) {
    if (attLoading) return;
    if (attReady && !force) return;

    attLoading = true;
    renderAttList();
    try {
        // 출결의 원본은 시트다. DB 는 동기화 간격만큼 뒤처지므로 원본을 읽는다.
        await refreshAttendance();
        memberData = getMembers();
        attReady = true;
        initAttendanceTab();
    } catch (err) {
        console.log('출결 불러오기 실패:', err);
        attReady = false;
        renderAttList();
    } finally {
        attLoading = false;
    }
}

function initAttendanceTab() {
    const sessions = getSessions({ all: true });
    if (!sessions.length) { renderAttList(); return; }

    const known = new Set(sessions.map(s => s.date));
    const teams = new Set(memberData.map(m => m.team).filter(Boolean));
    const prefs = attLoadPrefs();

    // 기본값은 가장 최근 지난 강의. 방금 끝난 수업을 바로 찍는 게 주 용도다.
    const today = getToday();
    const lastPast = [...sessions].reverse().find(s => s.date <= today);
    attSessionDate = (prefs.session && known.has(prefs.session))
        ? prefs.session
        : (lastPast?.date || sessions[sessions.length - 1].date);
    attTeam = (prefs.team && teams.has(prefs.team)) ? prefs.team : '';

    renderAttSessionPicker();
    renderAttTeamPicker();
    renderAttSessionInfo();
    attSnapshot();
    renderAttList();
}

// 저장하지 않고 창을 닫는 것을 막는다.
window.addEventListener('beforeunload', (e) => {
    if (attChanges().length > 0) { e.preventDefault(); e.returnValue = ''; }
});

// ESC 키로 모달 닫기
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && teamModal.classList.contains('active')) {
        closeTeamModal();
    }
});

// 안전한 초기화 함수
function initAdmin() {
    loadData();
    if (searchNameInput) {
        searchNameInput.focus();
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAdmin);
} else {
    initAdmin();
}

// Service Worker 등록 및 갱신 감지
function registerServiceWorker() {
    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', async () => {
        try {
            const hadController = !!navigator.serviceWorker.controller;
            const registration = await navigator.serviceWorker.register('./sw.js');

            registration.addEventListener('updatefound', () => {
                const newSW = registration.installing;
                if (!newSW) return;
                newSW.addEventListener('statechange', () => {
                    if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                        newSW.postMessage({ type: 'SKIP_WAITING' });
                    }
                });
            });

            setInterval(() => registration.update(), 30 * 60 * 1000);
            document.addEventListener('visibilitychange', () => {
                if (document.visibilityState === 'visible') registration.update();
            });

            let reloading = false;
            navigator.serviceWorker.addEventListener('controllerchange', () => {
                if (reloading) return;
                reloading = true;
                window.location.reload();
            });
        } catch (err) {
            console.log('SW 등록 실패:', err);
        }
    });
}
registerServiceWorker();



