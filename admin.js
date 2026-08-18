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
    compareMemberOrder,
    ensureLoaded,
    getAttendanceHistory,
    getMembers,
    getSessions,
    getSessionExtras,
    getToday,
    isAbsent,
    isClassSession,
    isEditableStatus,
    loadAttendanceForSession,
    refresh,
    requestSheetSync,
    saveAttendance,
    subscribe,
} from './scripts/members-data.js?v=85';

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

    // 결석 현황도 받아 둔 값이다. 새로 가져왔으면 다시 센다.
    if (abHistory) { abHistory = null; loadAbsence(); }

    // 출석부 출력도 스냅숏이다. 시트에서 새로 가져왔으면 **주차 목록부터**
    // 다시 세우고 김밥·과제를 다시 읽는다 — 이번 주 회차가 새로 생겼을 수도,
    // 옛 체크가 그대로 남아 있을 수도 있다.
    if (prSessionDate) {
        prSyncSessions();
        loadPrintData();
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

        // 출결·출석부 자료는 탭을 열 때 한 번만 받는다.
        if (tabName === 'attendance') loadAttendance();
        if (tabName === 'absence') openAbsenceTab();
        if (tabName === 'print') openPrintTab();
    });
});

// ==================== 시트 동기화 ====================
//
// 두 단계인 이유: 동기화가 끝나도 앱은 캐시를 들고 있다. 누군가는 다시 읽어야
// 하는데, 워크플로가 언제 끝나는지 앱은 모른다. 그래서 버튼을 나눠 둔다.

const syncBtn = document.getElementById('syncBtn');
const syncReloadBtn = document.getElementById('syncReloadBtn');
const syncInfo = document.getElementById('syncInfo');

function setSyncInfo(msg, kind = '') {
    if (!syncInfo) return;
    syncInfo.textContent = msg;
    syncInfo.className = 'sync-info' + (kind ? ' ' + kind : '');
}

syncBtn?.addEventListener('click', async () => {
    syncBtn.disabled = true;
    setSyncInfo('요청하는 중...');
    try {
        const res = await requestSheetSync();
        setSyncInfo(res.success
            ? res.message + ' 끝나면 [화면 새로 고침] 을 눌러 주세요.'
            : res.message, res.success ? 'ok' : 'fail');
    } catch (err) {
        console.log('동기화 요청 실패:', err);
        setSyncInfo('요청 실패: ' + err.message, 'fail');
    } finally {
        // 연타 방지. GAS 쪽에서도 1분을 막지만, 주소를 직접 부르는 경우가 남으므로
        // 양쪽에서 막는다.
        setTimeout(() => { syncBtn.disabled = false; }, 60000);
    }
});

syncReloadBtn?.addEventListener('click', async () => {
    syncReloadBtn.disabled = true;
    setSyncInfo('다시 읽는 중...');
    try {
        await refresh();
        if (attReady) await loadSessionAttendance();
        setSyncInfo('새 데이터를 읽었습니다.', 'ok');
    } catch (err) {
        console.log('화면 새로 고침 실패:', err);
        setSyncInfo('다시 읽지 못했습니다: ' + err.message, 'fail');
    } finally {
        syncReloadBtn.disabled = false;
    }
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
//
// 앞의 넷(Y 청년부 · C 청년부부 · 남 남장년부 · 여 여장년부)이 부서 차례다.
// 뒤의 것들은 여기 없는 접두어를 위한 자리로, 나오면 이 순서로 따라붙는다.
//
// 청년부가 YF · YM 으로 갈렸다. 접두어를 통째로 견주기 때문에 'YF' 를
// 여기 적어 두지 않으면 'Y' 로 읽히지 않고 **모르는 접두어**가 되어
// C · 남 · 여 뒤로 밀린다. 예전 Y 자리를 그대로 쓰게 둘 것.
// 'Y' 는 지난 기수 데이터에 남아 있어 자리를 비우지 않는다.
const TEAM_PREFERRED_ORDER = ['YF', 'YM', 'Y', 'C', '남', '여', 'O', '새', 'DG', 'V', 'M', 'W'];

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
    
    // 조 이름 차례 (YF1, YF2, ..., YM1, ..., C1, ..., 남1, ..., 여1, ...)
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
let attReady = false;             // 이 회차의 출결을 받아왔는가
let attLoading = false;
let attLoadedAtMs = 0;            // 마지막으로 읽은 시각

function attEsc(v) {
    return String(v ?? '').replace(/[&<>"']/g, (c) =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * 오늘과 가장 가까운 회차. 출석 관리·출석부 출력 둘 다 여기서 기본값을 잡는다.
 *
 * 거리가 같으면 이미 지난 쪽을 고른다 — 찍거나 정정할 것이 있는 쪽이다.
 */
function nearestSessionDate(sessions, today) {
    const day = (iso) => Date.parse(String(iso) + 'T00:00:00Z');
    const t = day(today);
    let best = null, bestDiff = Infinity, bestPast = 1;

    for (const s of sessions) {
        const diff = Math.abs(day(s.date) - t);
        const past = s.date <= today ? 0 : 1;
        if (diff < bestDiff || (diff === bestDiff && past < bestPast)) {
            best = s; bestDiff = diff; bestPast = past;
        }
    }
    return best ? best.date : null;
}

function attChanges() {
    const out = [];
    for (const [uuid, status] of attDraft) {
        if (attBaseline.get(uuid) !== status) out.push({ uuid, status });
    }
    return out;
}

/**
 * 손대지 않은 빈칸 = 결석.
 *
 * 출석부에 안 찍힌 사람은 결석이다. 예전에는 O 만 나가고 빈칸은 빈칸으로
 * 남아서, 결석자가 '기록 없음' 으로 쌓였다 — 수료 판정에서 출석도 결석도
 * 아닌 칸이 되어 나중에 한 명씩 되짚어야 했다.
 *
 * **사람이 일부러 지운 칸은 여기 들어오지 않는다.** 시트에 O 가 있던 것을
 * 화면에서 지웠다면 그건 '기록을 없애라' 는 뜻이므로 attChanges 쪽으로
 * 빈 값이 나간다 ('전체 지우기' 가 그 용도다).
 */
function attBlanks() {
    const out = [];
    for (const [uuid, status] of attDraft) {
        if (status === '' && (attBaseline.get(uuid) ?? '') === '') out.push({ uuid, status: 'X' });
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
    // 시트에 적힌 차례대로(오름차순) 보여준다. 목록을 훑는 사람이 회차 번호와
    // 같은 순서로 읽게 된다.
    attSessionPicker.innerHTML = sessions.map(s => {
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
    renderAttLoadedAt();
}

function refreshAttSaveBar() {
    if (!attSaveBtn || !attSaveInfo) return;
    const n = attChanges().length;
    const blanks = attBlanks().length;
    const readOnly = attReadOnly();

    // 빈칸도 함께 나가므로 버튼의 수가 실제로 쓰는 수여야 한다.
    // 버튼에 3 이라 적고 12명을 쓰면, 나중에 왜 결석이 늘었는지 알 수 없다.
    attSaveBtn.disabled = attSaving || n === 0 || readOnly;
    attSaveBtn.textContent = attSaving ? '저장 중...' : n ? `${n + blanks}명 저장` : '저장';
    attSaveInfo.textContent = readOnly
        ? '아직 지나지 않은 회차라 저장할 수 없습니다'
        : !n ? '변경 사항 없음'
        : blanks ? `${n}명 변경 · 빈칸 ${blanks}명은 결석(X)으로 함께 저장`
        : `${n}명 변경됨`;
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
        // 명단 차례는 시트의 출석부 순서와 같게 (compareMemberOrder 주석 참고)
        const rows = groups.get(team).slice().sort(compareMemberOrder)
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

function attReload() {
    if (attChanges().length &&
        !confirm('저장하지 않은 변경이 있습니다. 버리고 새로 불러올까요?')) return;
    loadSessionAttendance();
}
attReloadBtn?.addEventListener('click', attReload);
document.getElementById('attReloadBtn2')?.addEventListener('click', attReload);

// '몇 분 전 읽음' 이 멈춰 있으면 방금 읽은 값으로 착각한다.
setInterval(() => { if (attReady) renderAttLoadedAt(); }, 30000);

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
    for (const c of [...changes, ...attBlanks()]) {
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
    renderAttSessionInfo();
    // 회차마다 값이 다르므로 그 회차만 다시 읽는다.
    loadSessionAttendance();
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

// 고른 회차 하나만 DB 에서 읽는다.
//
// 예전에는 GAS 로 시트 전체를 읽었다. 화면을 열 때도 주차를 바꿀 때도 몇 초씩
// 걸렸는데, 정작 쓰는 건 한 회차뿐이다. 회차 하나면 인원수만큼의 행이라 빠르다.
async function loadSessionAttendance() {
    if (!attSessionDate) return;
    attLoading = true;
    renderAttList();
    try {
        await loadAttendanceForSession(attSessionDate);
        memberData = getMembers();
        attReady = true;
        attLoadedAtMs = Date.now();
        attSnapshot();
    } catch (err) {
        console.log('출결 불러오기 실패:', err);
        attReady = false;
    } finally {
        attLoading = false;
        renderAttList();
    }
}

// 화면이 스스로 다시 읽지 않으므로, 언제 읽은 값인지는 보여 줘야 한다.
// 안 보여주면 몇 시간 전 값을 지금 값으로 알고 저장한다.
function renderAttLoadedAt() {
    const el = document.getElementById('attLoadedAt');
    if (!el) return;
    if (!attLoadedAtMs) { el.textContent = ''; return; }
    const mins = Math.floor((Date.now() - attLoadedAtMs) / 60000);
    const when = mins < 1 ? '방금' : `${mins}분 전`;
    el.textContent = `${when} 읽음`;
    el.classList.toggle('stale', mins >= 10);
}

async function loadAttendance({ force = false } = {}) {
    if (attLoading) return;
    if (attReady && !force) return;
    initAttendanceTab();
    await loadSessionAttendance();
}

// 회차 목록·조 목록은 이미 받아 둔 DB 데이터로 만든다. 통신이 없다.
function initAttendanceTab() {
    const sessions = getSessions({ all: true });
    if (!sessions.length) { renderAttList(); return; }

    const known = new Set(sessions.map(s => s.date));
    const teams = new Set(memberData.map(m => m.team).filter(Boolean));
    const prefs = attLoadPrefs();

    // 기본값은 오늘과 가장 가까운 회차. 방금 끝난 수업을 바로 찍는 게 주 용도다.
    const today = getToday();
    attSessionDate = (prefs.session && known.has(prefs.session))
        ? prefs.session
        : (nearestSessionDate(sessions, today) || sessions[sessions.length - 1].date);
    attTeam = (prefs.team && teams.has(prefs.team)) ? prefs.team : '';

    renderAttSessionPicker();
    renderAttTeamPicker();
    renderAttSessionInfo();
}

// 저장하지 않고 창을 닫는 것을 막는다.
window.addEventListener('beforeunload', (e) => {
    if (attChanges().length > 0) { e.preventDefault(); e.returnValue = ''; }
});

// ==================== 결석 현황 ====================
//
// 두 가지를 본다.
//   이 주차 결석자   — 방금 끝난 수업에서 빠진 사람. 연락할 명단이다.
//   2회 이상 결석자  — 누적. 하차·상담 판단에 쓴다.
//
// 세는 규칙을 좁게 잡는다. 넓게 잡으면 엉뚱한 사람이 명단에 올라오고, 한 번
// 그런 일이 있으면 이 화면을 아무도 믿지 않는다.
//
//   결석 = X 만.  빈칸은 '아직 안 찍음' 이지 결석이 아니다.
//                 ◎(지난 기수 이수) · −(수업 없음) · 돌봄 도 아니다.
//   회차 = 지나간 강의 회차만. '자유교제' 처럼 수료에 안 들어가는 주는 뺀다
//          (전체 출석표에서 흐리게 칠하는 그 회차들이다).

const abSessionPicker = document.getElementById('abSessionPicker');
const abThresholds = document.getElementById('abThresholds');

let abSessionDate = null;
let abHistory = null;          // Map(uuid → Map(date → status))
let abMin = 2;                 // 몇 회 이상을 보여줄까
let abSort = 'team';           // 'team' | 'pastor'
let abLoading = false;
let abLoadedAtMs = 0;

/** 결석을 세는 회차 — 지나간 강의 회차만 */
function abClassSessions() {
    const today = getToday();
    return getSessions({ all: true }).filter(s => s.date <= today && isClassSession(s.name));
}

async function openAbsenceTab() {
    if (abLoading) return;
    const sessions = abClassSessions();
    if (!abSessionDate || !sessions.some(s => s.date === abSessionDate)) {
        abSessionDate = sessions.length
            ? (nearestSessionDate(sessions, getToday()) || sessions[sessions.length - 1].date)
            : null;
    }
    renderAbSessionPicker();
    if (!abHistory) await loadAbsence();
    else renderAbsence();
}

function renderAbSessionPicker() {
    if (!abSessionPicker) return;
    const sessions = abClassSessions();
    abSessionPicker.innerHTML = sessions.map(s =>
        `<option value="${attEsc(s.date)}"${s.date === abSessionDate ? ' selected' : ''}>` +
        `${attEsc(s.key)}${s.name ? ' · ' + attEsc(s.name) : ''}</option>`).join('');
}

async function loadAbsence() {
    abLoading = true;
    renderAbsence();
    try {
        abHistory = await getAttendanceHistory();
        abLoadedAtMs = Date.now();
    } catch (err) {
        console.log('결석 현황 조회 실패:', err);
        abHistory = null;
    } finally {
        abLoading = false;
        renderAbsence();
    }
}

/**
 * 고른 주차까지 몇 주 연속으로 빠졌는가.
 *
 * 연락할 때 이게 첫마디가 된다 — '지난주도 안 오셨죠' 와 '오랜만이에요' 는
 * 다른 말이다. 화면에도 붙이고 복사 명단에도 붙인다.
 */
function abStreak(m) {
    const byDate = abHistory?.get(m._uuid);
    if (!byDate) return 0;
    const upto = abClassSessions().filter(s => s.date <= abSessionDate);
    let n = 0;
    for (let i = upto.length - 1; i >= 0; i--) {
        if (!isAbsent(byDate.get(upto[i].date))) break;
        n++;
    }
    return n;
}

/**
 * 명단 차례.
 *
 * 기본은 조 순서다. '담당교역자' 를 고르면 교역자로 먼저 묶는다 — 하차·상담은
 * 교역자가 나눠 맡는데, 조 순서로만 나오면 자기 몫을 매번 눈으로 골라내야 한다.
 * 교역자가 비어 있는 사람은 맨 뒤로 보낸다 (중간에 끼면 묶음이 끊어져 보인다).
 */
function abCompare(a, b) {
    if (abSort === 'pastor') {
        const pa = (a.pastor || '').trim();
        const pb = (b.pastor || '').trim();
        if (pa !== pb) {
            if (!pa) return 1;
            if (!pb) return -1;
            return pa.localeCompare(pb, 'ko');
        }
    }
    return compareTeamName(a.team, b.team) || compareMemberOrder(a, b);
}

/** 사람별 결석 회차 목록 (강의 회차만, 결석 많은 순) */
function abCounts() {
    const sessions = abClassSessions();
    const out = [];
    for (const m of memberData) {
        if (!m._uuid) continue;
        const byDate = abHistory?.get(m._uuid);
        if (!byDate) continue;
        const dates = sessions.filter(s => isAbsent(byDate.get(s.date))).map(s => s.key);
        if (dates.length) out.push({ m, dates });
    }
    // 교역자별로 볼 때는 교역자가 먼저다. 그 안에서 결석 많은 순.
    return out.sort((a, b) => (abSort === 'pastor'
        ? (abCompare(a.m, b.m) || b.dates.length - a.dates.length)
        : (b.dates.length - a.dates.length || abCompare(a.m, b.m))));
}

function abRow(m, extra = '') {
    // 교역자는 있을 때만 적는다. 빈 칸을 자리만 잡아 두면 줄이 성글어 보인다.
    const pastor = (m.pastor || '').trim();
    return `<div class="ab-row">
                <span class="ab-team">${attEsc(m.team || '-')}</span>
                <span class="ab-name">${attEsc(m.name)}<span class="ab-phone">${attEsc(m.phone || '')}</span>
                    ${pastor ? `<span class="ab-pastor">${attEsc(pastor)}</span>` : ''}</span>
                <span class="ab-extra">${extra}</span>
            </div>`;
}

function renderAbsence() {
    const weekList = document.getElementById('abWeekList');
    const weekCount = document.getElementById('abWeekCount');
    const weekNote = document.getElementById('abWeekNote');
    const totalList = document.getElementById('abTotalList');
    const totalCount = document.getElementById('abTotalCount');
    const totalNote = document.getElementById('abTotalNote');
    if (!weekList || !totalList) return;

    const loadedAt = document.getElementById('abLoadedAt');
    if (loadedAt) {
        loadedAt.textContent = abLoadedAtMs
            ? `${Math.max(0, Math.round((Date.now() - abLoadedAtMs) / 60000))}분 전 읽음`.replace('0분 전', '방금')
            : '';
    }

    if (abLoading || !abHistory) {
        const msg = abLoading ? '불러오는 중...' : '불러오지 못했습니다.';
        weekList.innerHTML = `<div class="att-empty">${msg}</div>`;
        totalList.innerHTML = '';
        if (weekCount) weekCount.textContent = '';
        if (totalCount) totalCount.textContent = '';
        if (weekNote) weekNote.textContent = '';
        if (totalNote) totalNote.textContent = '';
        return;
    }

    const sessions = abClassSessions();
    const cur = sessions.find(s => s.date === abSessionDate);

    // ---- 이 주차 ----
    const roster = memberData.filter(m => m._uuid);
    const marked = roster.filter(m => String(abHistory.get(m._uuid)?.get(abSessionDate) ?? '').trim() !== '');
    const absentees = roster
        .filter(m => isAbsent(abHistory.get(m._uuid)?.get(abSessionDate)))
        .sort(abCompare);

    if (weekCount) weekCount.textContent = cur ? `${cur.key} · ${absentees.length}명` : '';

    // '전원 출석' 과 '아직 안 찍음' 은 다른 이야기다. 안 찍은 회차를 '결석 0명' 으로
    // 보여주면 없는 사실을 만들어 내는 것이다.
    const unmarked = roster.length - marked.length;
    if (weekNote) {
        weekNote.textContent = !marked.length
            ? '⚠️ 이 주차는 아직 출석을 찍지 않았습니다 (기록 0건).'
            : unmarked ? `※ ${unmarked}명은 아직 기록이 없습니다 — 결석으로 세지 않았습니다.`
            : '';
        weekNote.classList.toggle('warn', !marked.length);
    }

    weekList.innerHTML = absentees.length
        ? absentees.map(m => {
            const st = abStreak(m);
            return abRow(m, st > 1 ? `<b class="ab-streak">${st}주 연속</b>` : '');
        }).join('')
        : `<div class="att-empty">${marked.length ? '이 주차 결석자가 없습니다.' : ''}</div>`;

    // ---- 누적 ----
    const all = abCounts();
    const hit = all.filter(r => r.dates.length >= abMin);
    if (totalCount) totalCount.textContent = `${hit.length}명`;
    if (totalNote) {
        totalNote.textContent = `강의 ${sessions.length}회차 기준 · 결석(X)만 셉니다`
            + ` (빈칸 · ◎ · − · 돌봄 은 제외)`;
    }

    totalList.innerHTML = hit.length
        ? hit.map(r => abRow(r.m,
            `<b class="ab-n">${r.dates.length}회</b>`
            + `<span class="ab-dates">${r.dates.map(d => `<span class="ab-chip">${attEsc(d)}</span>`).join('')}</span>`)).join('')
        : `<div class="att-empty">${abMin}회 이상 결석한 사람이 없습니다.</div>`;
}

/** 카톡에 붙일 명단. 화면에서 눈으로 옮겨 적게 하지 않는다. */
async function abCopy(rows, title) {
    if (!rows.length) return alert('복사할 명단이 없습니다.');
    const text = `${title}\n` + rows.map(r => {
        const m = r.m || r;
        // 누적이면 회차를, 이 주차면 몇 주 연속인지를 붙인다.
        // 화면에 보이는 것이 복사본에 없으면 옮겨 적을 때 빠진다.
        const streak = r.dates ? 0 : abStreak(m);
        const tail = r.dates ? ` (${r.dates.length}회: ${r.dates.join(' ')})`
                   : streak > 1 ? ` (${streak}주 연속)` : '';
        // 교역자는 정렬과 상관없이 늘 붙인다. 그대로 나눠 보내는 명단이라,
        // 조 순서로 보고 복사했다고 해서 누가 맡은 사람인지 빠지면 안 된다.
        const head = (m.pastor || '').trim() ? `[${m.pastor.trim()}] ` : '';
        return `${head}${m.team} ${m.name}${tail}`;
    }).join('\n');
    try {
        await navigator.clipboard.writeText(text);
        alert(`${rows.length}명을 복사했습니다.`);
    } catch {
        // 클립보드가 막힌 브라우저에서도 옮겨 적게 두지 않는다
        prompt('복사해서 쓰세요 (Ctrl+C)', text.replace(/\n/g, ' / '));
    }
}

abSessionPicker?.addEventListener('change', (e) => {
    abSessionDate = e.target.value;
    renderAbsence();
});

document.getElementById('abSortPicker')?.addEventListener('change', (e) => {
    abSort = e.target.value === 'pastor' ? 'pastor' : 'team';
    renderAbsence();
});

document.getElementById('abReloadBtn')?.addEventListener('click', () => {
    abHistory = null;
    loadAbsence();
});

abThresholds?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-min]');
    if (!btn) return;
    abMin = Number(btn.dataset.min) || 2;
    abThresholds.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === btn));
    renderAbsence();
});

document.getElementById('abWeekCopyBtn')?.addEventListener('click', () => {
    const roster = memberData.filter(m => m._uuid);
    const rows = roster
        .filter(m => isAbsent(abHistory?.get(m._uuid)?.get(abSessionDate)))
        .sort(abCompare);
    const cur = abClassSessions().find(s => s.date === abSessionDate);
    abCopy(rows, `${cur ? cur.key + ' ' : ''}결석자 ${rows.length}명`);
});

document.getElementById('abTotalCopyBtn')?.addEventListener('click', () => {
    if (!abHistory) return alert('복사할 명단이 없습니다.');
    const hit = abCounts().filter(r => r.dates.length >= abMin);
    abCopy(hit, `${abMin}회 이상 결석 ${hit.length}명`);
});

// ==================== 출석부 출력 ====================
//
// 지금까지 스프레드시트로 만들어 인쇄하던 조별 출석부를 앱에서 낸다.
// 현장에서 손으로 체크하는 종이 양식이므로 **아는 값은 미리 찍고 받을 값은 비운다.**
//
//   번호·이름·김밥·과제 = 데이터        출석·김밥신청·메모 = 빈칸

const prSessionPicker = document.getElementById('prSessionPicker');
const prScopePicker = document.getElementById('prScopePicker');
const prPreview = document.getElementById('prPreview');
const prPickList = document.getElementById('prPickList');
const prPickToggle = document.getElementById('prPickToggleBtn');
const prCount = document.getElementById('prCount');

let prSessionDate = null;
let prSessionTouched = false;     // 사람이 주차를 직접 골랐는가
let prScope = 'all';              // 'all' | 'loc:웨슬리홀' | 'team:Y1'
let prSkip = new Set();           // 출력에서 뺀 조
let prLunchSet = new Set();
let prHwSet = new Set();
// 과제가 왜 안 붙었는지 — 화면이 이유를 말하는 데 쓴다
let prExtras = { hwLoaded: false, hwTotal: 0, hwNear: [] };
let prReady = false;
let prLoading = false;
// 사람이 '김밥신청' 을 직접 토글하면 그 뜻을 존중한다. 주차를 바꿔도 되돌리지
// 않는다. 자동 판단이 사람 판단을 덮으면 신뢰를 잃는다.
//
// 이 값은 화면을 새로 열면 초기화된다 — 아래 prSaveCols 참고.
let prLunchReqTouched = false;

/**
 * 표시할 칸을 기억한다. 매번 다시 체크하게 하면 안 된다.
 *
 * '김밥신청' 만 뺀다. 그 칸은 '이 주차가 그 달의 마지막 수업인가' 로 자동으로
 * 정해지는데, 한 번 손댄 것을 영구히 기억해 버리면 그 판단이 영영 죽는다.
 * 다음 달 마지막 주에 칸이 안 나오고, 왜 안 나오는지도 알 수 없다.
 *
 * 그래서 김밥신청은 화면을 열 때마다 자동 판단으로 시작하고, 그 화면을 보는
 * 동안 직접 토글한 것만 지킨다.
 */
const PR_COLS_KEY = 'dg_admin_print_cols_v1';
const PR_SAVED_COLS = [
    ['prColLunch', 'lunch'],
    ['prColHw', 'hw'],
    ['prColMemo', 'memo'],
    ['prColSummary', 'summary'],
];

function prSaveCols() {
    try {
        const out = {};
        for (const [id, key] of PR_SAVED_COLS) {
            const el = document.getElementById(id);
            if (el) out[key] = el.checked;
        }
        localStorage.setItem(PR_COLS_KEY, JSON.stringify(out));
    } catch { /* 무시 */ }
}

/**
 * 출력에서 뺀 조를 기억한다. 매번 다시 고르게 하면 안 된다.
 *
 * 조 이름으로 기억하므로 주차나 범위를 바꿔도 뜻이 살아 있다 — 범위 밖으로
 * 나간 조는 그냥 안 그려질 뿐이고, 다시 범위에 들어오면 뺀 채로 나온다.
 */
const PR_SKIP_KEY = 'dg_admin_print_skip_v1';

function prSaveSkip() {
    try {
        localStorage.setItem(PR_SKIP_KEY, JSON.stringify([...prSkip]));
    } catch { /* 무시 */ }
}

function prLoadSkip() {
    try {
        const arr = JSON.parse(localStorage.getItem(PR_SKIP_KEY) || '[]');
        if (Array.isArray(arr)) prSkip = new Set(arr.filter(v => typeof v === 'string'));
    } catch { /* 무시 */ }
}

function prLoadCols() {
    try {
        const saved = JSON.parse(localStorage.getItem(PR_COLS_KEY) || 'null');
        if (!saved) return;
        for (const [id, key] of PR_SAVED_COLS) {
            const el = document.getElementById(id);
            if (el && typeof saved[key] === 'boolean') el.checked = saved[key];
        }
    } catch { /* 무시 */ }
}

const prCol = {
    lunch: () => document.getElementById('prColLunch')?.checked,
    lunchReq: () => document.getElementById('prColLunchReq')?.checked,
    hw: () => document.getElementById('prColHw')?.checked,
    memo: () => document.getElementById('prColMemo')?.checked,
    summary: () => document.getElementById('prColSummary')?.checked,
};

// A4 세로 297 - 인쇄 여백 24 = 273mm
// 제목·주차·인원 18mm + 표 머리글 8mm + 여유 4mm = 30mm
// 종이 안쪽 여백(위아래 각 5mm)도 빼야 마지막 줄이 밑변에 붙지 않는다.
const PR_PAGE_PAD_MM = 5;
const PR_AVAIL_MM = 273 - 30 - PR_PAGE_PAD_MM * 2;

// 표 아래 '특이사항' 상자. 사람마다가 아니라 그날 조 전체에 대해 적는 자리다.
const PR_NOTE_MIN_MM = 12;
const PR_NOTE_MAX_MM = 40;
const PR_NOTE_GAP_MM = 3;      // 표와 상자 사이

const round1 = (v) => Math.round(v * 10) / 10;

// 조마다 인원이 달라(12명 ~ 1명) 고정 줄 높이로는 아래가 휑하거나 넘친다.
// 상한 22mm 가 필요하다 — 5명짜리 조를 꽉 채우려면 한 줄이 40mm 가 되는데
// 그건 표가 아니라 빈 상자다. 인원이 적은 조는 아래가 남는 게 맞다.
//
// 특이사항 칸 자리를 먼저 떼어 두고 나눈다. 안 떼면 인원이 많은 조에서 표가
// 한 줄만큼 넘쳐 빈 종이가 한 장 더 나온다.
function prRowHeightMm(count) {
    if (!count) return 9;
    const usable = PR_AVAIL_MM - PR_NOTE_MIN_MM - PR_NOTE_GAP_MM;
    // 내림한다. 0.05mm 라도 올림하면 인원수만큼 곱해져 한 줄이 넘친다.
    return Math.floor(Math.min(22, Math.max(8, usable / count)) * 10) / 10;
}

/**
 * 집계표 줄 높이. 조가 많으면 한 장을 넘긴다 —
 * 33개 조면 9mm × 34줄(합계 포함) = 306mm 로 A4(233mm)를 훌쩍 넘는다.
 * 화면에서는 .pr-page 가 늘어나 한 장처럼 보이지만 인쇄하면 두 장으로 갈린다.
 *
 * 특이사항 상자가 없으니 233mm 를 통째로 나눠 쓴다. 아래로는 막지 않는다 —
 * 넘치는 것보다 얇은 게 낫다. (글자 높이가 실질 하한이라 그 아래로는 안 간다)
 */
function prSummaryRowMm(rowCount) {
    if (!rowCount) return 9;
    return Math.floor(Math.min(12, PR_AVAIL_MM / rowCount) * 10) / 10;
}

// 남는 높이를 특이사항 상자가 먹는다. 다만 한없이 키우지는 않는다 —
// 5명짜리 조에서 100mm 짜리 상자가 되면 그것대로 이상하다.
function prNoteHeightMm(count) {
    const left = PR_AVAIL_MM - PR_NOTE_GAP_MM - prRowHeightMm(count) * count;
    return round1(Math.min(PR_NOTE_MAX_MM, Math.max(PR_NOTE_MIN_MM, left)));
}

// 그 주차가 해당 월의 마지막 수업이면 다음 달 김밥을 그때 받는다.
function prIsLastClassOfMonth(date) {
    const ym = String(date).slice(0, 7);
    const same = getSessions({ all: true })
        .filter(s => String(s.date).slice(0, 7) === ym)
        .map(s => s.date)
        .sort();
    return same.length > 0 && same[same.length - 1] === date;
}

function prTeams() {
    const groups = new Map();
    for (const m of memberData) {
        const t = m.team || '(조 없음)';
        if (!groups.has(t)) groups.set(t, { name: t, location: m.location || '', members: [] });
        groups.get(t).members.push(m);
    }
    // 종이 출석부를 시트와 나란히 놓고 짚어 갈 수 있어야 한다 — 같은 차례로.
    for (const g of groups.values()) g.members.sort(compareMemberOrder);
    return [...groups.values()].sort((a, b) => compareTeamName(a.name, b.name));
}

function prScopedTeams() {
    const all = prTeams();
    if (prScope.startsWith('team:')) return all.filter(t => t.name === prScope.slice(5));
    if (prScope.startsWith('loc:')) return all.filter(t => t.location === prScope.slice(4));
    return all;
}

function renderPrPickers() {
    if (!prSessionPicker || !prScopePicker) return;

    const sessions = getSessions({ all: true });
    prSessionPicker.innerHTML = sessions.map(s =>
        `<option value="${attEsc(s.date)}"${s.date === prSessionDate ? ' selected' : ''}>` +
        `${attEsc(s.key)}${s.name ? ' · ' + attEsc(s.name) : ''}</option>`).join('');

    const teams = prTeams();
    const locations = [...new Set(teams.map(t => t.location).filter(Boolean))].sort(
        (a, b) => a.localeCompare(b, 'ko'));

    let html = `<option value="all"${prScope === 'all' ? ' selected' : ''}>전체 (${teams.length}개 조)</option>`;
    // 장소가 한 곳뿐이면 묶음을 숨긴다. 고를 것이 없는 목록은 방해만 된다.
    if (locations.length > 1) {
        html += '<optgroup label="장소별">';
        for (const loc of locations) {
            const n = teams.filter(t => t.location === loc).length;
            const v = 'loc:' + loc;
            html += `<option value="${attEsc(v)}"${prScope === v ? ' selected' : ''}>${attEsc(loc)} (${n}개 조)</option>`;
        }
        html += '</optgroup>';
    }
    html += '<optgroup label="조별">';
    for (const t of teams) {
        const v = 'team:' + t.name;
        html += `<option value="${attEsc(v)}"${prScope === v ? ' selected' : ''}>${attEsc(t.name)} (${t.members.length}명)</option>`;
    }
    html += '</optgroup>';
    prScopePicker.innerHTML = html;
}

function prSessionMeta() {
    return getSessions({ all: true }).find(s => s.date === prSessionDate) || null;
}

/**
 * 김밥·과제가 몇 명에게 붙었는지, 안 붙었으면 왜인지.
 *
 * 과제는 회차 날짜가 아니라 **강의명**으로 붙는다. 시트의 회차 이름과 폼에
 * 적은 강의명이 한 글자라도 다르면 한 명도 안 붙는데, 화면에는 그냥 빈 칸이라
 * 손볼 곳이 시트인지 폼인지 알 수가 없다. 여기서 말해 준다.
 */
function renderPrDataInfo() {
    const el = document.getElementById('prDataInfo');
    if (!el) return;

    if (!prReady) { el.innerHTML = ''; return; }

    const name = (prSessionMeta()?.name || '').trim();

    // 화면에 나온 장들과 같은 사람만 센다. DB 에는 지금 명단에 없는 사람의
    // 신청도 남아 있어서, 그냥 세면 집계표 합계와 어긋난다.
    const people = prScopedTeams().flatMap(t => t.members);
    const lunchN = people.filter(m => prLunchSet.has(m._uuid)).length;
    const hwN = people.filter(m => prHwSet.has(m._uuid)).length;
    const offList = prScope === 'all' ? prLunchSet.size - lunchN : 0;

    const info = `🍙 김밥 ${lunchN}명 · 📝 과제 ${hwN}명`
               + (name ? ` (‘${attEsc(name)}’ 기준)` : '')
               + (offList > 0 ? ` · 지금 명단에 없는 ${offList}명 제외` : '');

    let warn = '';
    if (!name) {
        warn = '⚠️ 이 주차는 시트에 회차 이름이 없어 과제를 붙일 수 없습니다. '
             + '시트의 회차 이름(예: 18강)을 채우고 다시 가져오세요.';
    } else if (!prExtras.hwLoaded) {
        warn = '⚠️ 과제를 불러오지 못했습니다. 주차를 다시 고르면 다시 시도합니다.';
    } else if (!hwN && prExtras.hwTotal) {
        warn = `⚠️ ‘${attEsc(name)}’ 으로 낸 과제가 없습니다.`;
        if (prExtras.hwNear.length) {
            warn += ' 폼에는 '
                 + prExtras.hwNear.map(x => `‘${attEsc(x.lecture)}’ ${x.n}건`).join(' · ')
                 + ' 로 적혀 있습니다. 시트나 폼의 표기를 맞춰 주세요.';
        }
    }

    el.innerHTML = `<span class="pr-data-count">${info}</span>`
                 + (warn ? `<span class="pr-data-warn">${warn}</span>` : '');
}

function renderPrPreview() {
    if (!prPreview) return;

    renderPrDataInfo();

    if (!prReady) {
        prPreview.innerHTML = `<div class="att-empty">${prLoading ? '불러오는 중...' : '불러오지 못했습니다.'}</div>`;
        renderPrPickList();
        updatePrCount();
        return;
    }

    const s = prSessionMeta();
    const teams = prScopedTeams();
    if (!teams.length) {
        prPreview.innerHTML = '<div class="att-empty">해당하는 조가 없습니다.</div>';
        renderPrPickList();
        updatePrCount();
        return;
    }

    const head = `${s ? attEsc(s.key) : ''}${s?.name ? ' ' + attEsc(s.name) : ''}`;

    const sheets = teams.map(t => {
        const rowMm = prRowHeightMm(t.members.length);
        const lunchCount = t.members.filter(m => prLunchSet.has(m._uuid)).length;

        const body = t.members.map((m, i) => `
            <tr>
                <td class="pr-c-no">${i + 1}</td>
                <td class="pr-name">
                    <span class="pr-nm">${attEsc(m.name)}<span class="pr-phone">${attEsc(m.phone || '')}</span></span>
                    ${prRoleLabel(m.role) ? `<span class="pr-role">${attEsc(prRoleLabel(m.role))}</span>` : ''}
                </td>
                ${prCol.lunch() ? `<td class="pr-c-mark">${prLunchSet.has(m._uuid) ? 'O' : ''}</td>` : ''}
                ${prCol.lunchReq() ? '<td class="pr-c-wide"></td>' : ''}
                <td class="pr-c-mark"></td>
                ${prCol.hw() ? `<td class="pr-c-mark">${prHwSet.has(m._uuid) ? '✓' : ''}</td>` : ''}
                ${prCol.memo() ? '<td class="pr-c-memo"></td>' : '<td class="pr-c-fill"></td>'}
            </tr>`).join('');

        return `
            <div class="pr-sheet${prSkip.has(t.name) ? ' pr-skip' : ''}"
                 data-team="${attEsc(t.name)}" data-label="${attEsc(t.name)}">
                <label class="pr-pick">
                    <input type="checkbox" data-team="${attEsc(t.name)}"${prSkip.has(t.name) ? '' : ' checked'}> 출력
                </label>
                <section class="pr-page" style="--pr-row: ${rowMm}mm; --pr-note: ${prNoteHeightMm(t.members.length)}mm">
                    <div class="pr-head">
                        <h2 class="pr-title">${attEsc(t.name)}</h2>
                        <span class="pr-when">${head}</span>
                    </div>
                    <div class="pr-sub">${attEsc(t.location || '-')} · 인원 ${t.members.length}명 · 김밥 ${lunchCount}명</div>
                    <div class="pr-table-wrap">
                    <table class="pr-table">
                        <thead>
                            <tr>
                                <th class="pr-c-no">No.</th>
                                <th class="pr-name">이름</th>
                                ${prCol.lunch() ? '<th class="pr-c-mark">김밥</th>' : ''}
                                ${prCol.lunchReq() ? '<th class="pr-c-wide">김밥신청</th>' : ''}
                                <th class="pr-c-mark">출석</th>
                                ${prCol.hw() ? '<th class="pr-c-mark">과제</th>' : ''}
                                ${prCol.memo() ? '<th class="pr-c-memo">메모</th>' : '<th class="pr-c-fill"></th>'}
                            </tr>
                        </thead>
                        <tbody>${body}</tbody>
                        </table>
                    </div>
                    <!-- 특이사항은 표에서 떼어 둔다. 표 안의 줄로 두면 사람마다
                         적는 칸으로 읽힌다 — 이건 조 전체에 대한 칸이다. -->
                    <div class="pr-note"><span class="pr-note-label">특이사항</span></div>
                </section>
            </div>`;
    }).join('');

    // 집계표가 맨 앞이다. 나눠 주는 사람이 먼저 보는 장이라 뒤에 있으면
    // 매번 끝까지 넘겨야 한다.
    prPreview.innerHTML = (prCol.summary() ? renderPrSummaries(teams, head) : '') + sheets;
    renderPrPickList();
    updatePrCount();
}

// 이름 밑에 붙일 직책. '조원' 은 대부분이라 적어 봐야 눈만 어지럽다 —
// 종이에서 찾아야 하는 건 조장·서브튜터가 누구인가다.
function prRoleLabel(role) {
    const r = String(role || '').trim();
    return (!r || r === '조원') ? '' : r;
}

// 집계표에 싣는 값. 과제는 넣지 않는다 — 조별 출석부의 과제 칸이 그 일을 한다.
function prTeamStat(t) {
    return {
        n: t.members.length,
        lunch: t.members.filter(m => prLunchSet.has(m._uuid)).length,
    };
}

/**
 * 집계표 — 전체 한 장, 그다음 장소별로 한 장씩.
 *
 * 전체는 전달할 사람이 한눈에 보는 장이고, 장소별은 웨슬리홀 담당과 온라인
 * 담당이 각자 들고 가는 장이다. 장소가 한 곳뿐이면 둘이 같은 내용이라
 * 전체만 낸다.
 */
function renderPrSummaries(teams, head) {
    const locOf = (t) => t.location || '(장소 없음)';

    const byLoc = new Map();
    for (const t of teams) {
        const l = locOf(t);
        if (!byLoc.has(l)) byLoc.set(l, []);
        byLoc.get(l).push(t);
    }

    if (byLoc.size <= 1) {
        const loc = [...byLoc.keys()][0] || '전체';
        return renderPrSummary(loc, loc, teams, head, false);
    }

    // 장 순서는 인원 많은 장소부터. 사람이 많은 곳이 먼저 나와야 한다.
    // (장 안의 조 차례는 조 이름 순 — 아래 renderPrSummary 참고)
    const sizeOf = (ts) => ts.reduce((n, t) => n + t.members.length, 0);
    const locs = [...byLoc.entries()].sort(
        (a, b) => sizeOf(b[1]) - sizeOf(a[1]) || a[0].localeCompare(b[0], 'ko'));

    return renderPrSummary('__all__', '전체', teams, head, true)
         + locs.map(([loc, ts]) => renderPrSummary(loc, loc, ts, head, false)).join('');
}

// showLocation — 여러 장소가 섞인 '전체' 장에서만 장소 열을 둔다.
// 장소별 장은 머리말에 이미 있어서 열로 두면 같은 값이 줄마다 반복된다.
function renderPrSummary(key, title, teams, head, showLocation) {
    // 표 안의 조는 이름 순(Y · C · 남 · 여). 인원순으로 섞으면 조별 출석부와
    // 차례가 어긋나 한 장씩 짚어 가며 대조할 수가 없다.
    // 인원 많은 순은 장 순서에만 쓴다 (위 renderPrSummaries 참고).
    const sorted = [...teams].sort((a, b) => compareTeamName(a.name, b.name));

    // 출석·과제 칸은 두지 않는다. 사람별로 따지는 것은 조별 출석부가 한다.
    // 메모는 조 단위로 적을 것이 있어서 남긴다.
    const rows = sorted.map((t, i) => {
        const s = prTeamStat(t);
        return `<tr>
            <td class="pr-c-no">${i + 1}</td>
            <td class="pr-sum-name">${attEsc(t.name)}</td>
            ${showLocation ? `<td class="pr-sum-loc">${attEsc(t.location || '-')}</td>` : ''}
            <td class="pr-c-mark">${s.n}</td>
            <td class="pr-c-mark">${s.lunch}</td>
            <td class="pr-c-memo"></td>
        </tr>`;
    }).join('');

    const sum = sorted.reduce((acc, t) => {
        const s = prTeamStat(t);
        return { n: acc.n + s.n, lunch: acc.lunch + s.lunch };
    }, { n: 0, lunch: 0 });

    const id = '__summary__:' + key;
    return `
        <div class="pr-sheet" data-team="${attEsc(id)}" data-label="집계표 · ${attEsc(title)}">
            <label class="pr-pick">
                <input type="checkbox" data-team="${attEsc(id)}"${prSkip.has(id) ? '' : ' checked'}> 출력
            </label>
            <!-- 합계 줄도 --pr-row 를 쓰므로 줄 수에 +1 -->
            <section class="pr-page" style="--pr-row: ${prSummaryRowMm(sorted.length + 1)}mm">
                <div class="pr-head">
                    <h2 class="pr-title">조별 집계표 · ${attEsc(title)}</h2>
                    <span class="pr-when">${head}</span>
                </div>
                <div class="pr-sub">${sorted.length}개 조 · 인원 ${sum.n}명</div>
                <div class="pr-table-wrap">
                <table class="pr-table pr-sum-table">
                    <thead><tr>
                        <th class="pr-c-no">No.</th>
                        <th class="pr-sum-name">조</th>
                        ${showLocation ? '<th class="pr-sum-loc">장소</th>' : ''}
                        <th class="pr-c-mark">인원</th><th class="pr-c-mark">김밥</th>
                        <th class="pr-c-memo">메모</th>
                    </tr></thead>
                    <tbody>${rows}</tbody>
                    <tfoot><tr class="pr-total">
                        <td class="pr-c-no"></td>
                        <td class="pr-sum-name">합계</td>
                        ${showLocation ? '<td class="pr-sum-loc"></td>' : ''}
                        <td class="pr-c-mark">${sum.n}</td><td class="pr-c-mark">${sum.lunch}</td>
                        <td class="pr-c-memo"></td>
                    </tr></tfoot>
                </table>
                </div>
            </section>
        </div>`;
}

function updatePrCount() {
    if (!prPreview) return;
    const all = prPreview.querySelectorAll('.pr-sheet').length;
    const live = prPreview.querySelectorAll('.pr-sheet:not(.pr-skip)').length;
    if (prCount) prCount.textContent = all ? `${all}장 중 ${live}장 출력` : '';
    updatePrPickToggle(all, all - live);
}

/**
 * '부분 선택' 버튼.
 *
 * 목록을 늘 펼쳐 두면 조가 33개일 때 그것만으로 화면을 먹는다. 그래서 접어 두고
 * 이 버튼으로 연다. 대신 **접혀 있는 동안 무엇이 빠졌는지 안 보이므로**
 * 버튼이 뺀 장 수를 대신 말한다 — 접어 놓은 채로 인쇄하고 나서 왜 세 장이
 * 안 나왔는지 찾게 만들면 안 된다.
 */
function updatePrPickToggle(all = 0, off = 0) {
    if (!prPickToggle) return;
    const open = !!prPickList && !prPickList.hidden;
    prPickToggle.disabled = !all;
    prPickToggle.classList.toggle('on', open);
    prPickToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    prPickToggle.textContent = open ? '▴ 목록 닫기'
        : (off ? `▾ 부분 선택 (${off}장 뺌)` : '▾ 부분 선택');
}

/**
 * 한 장을 넣거나 뺀다.
 *
 * 체크는 두 곳에 있다 — 상단 목록과 장 위. 어느 쪽을 눌러도 둘 다 맞춰 준다.
 * **다시 그리지는 않는다.** 다시 그리면 다른 장의 체크가 전부 초기화된다.
 */
function prApplySkip(team, skip) {
    if (skip) prSkip.add(team); else prSkip.delete(team);

    const sel = `[data-team="${CSS.escape(team)}"]`;
    const sheet = prPreview?.querySelector(`.pr-sheet${sel}`);
    if (sheet) {
        sheet.classList.toggle('pr-skip', skip);
        const box = sheet.querySelector('.pr-pick input');
        if (box) box.checked = !skip;
    }
    const chip = prPickList?.querySelector(`input${sel}`);
    if (chip) {
        chip.checked = !skip;
        chip.closest('.pr-pick-chip')?.classList.toggle('off', skip);
    }
}

function prOnPickChange(e) {
    const box = e.target.closest('input[type="checkbox"][data-team]');
    if (!box) return;
    prApplySkip(box.dataset.team, !box.checked);
    prSaveSkip();
    updatePrCount();
}

prPreview?.addEventListener('change', prOnPickChange);
prPickList?.addEventListener('change', prOnPickChange);

// 상단 장 목록. 33장을 넘겨 가며 하나씩 끄는 대신 여기서 바로 고른다.
function renderPrPickList() {
    if (!prPickList) return;
    const sheets = [...(prPreview?.querySelectorAll('.pr-sheet') || [])];
    if (!sheets.length) { prPickList.innerHTML = ''; return; }

    prPickList.innerHTML = sheets.map(sheet => {
        const team = sheet.dataset.team;
        const label = sheet.dataset.label || team;
        return `<label class="pr-pick-chip${prSkip.has(team) ? ' off' : ''}">
                    <input type="checkbox" data-team="${attEsc(team)}"${prSkip.has(team) ? '' : ' checked'}>
                    ${attEsc(label)}
                </label>`;
    }).join('');
}

function prSetAll(on) {
    if (!prPreview) return;
    prPreview.querySelectorAll('.pr-sheet').forEach(sheet => {
        prApplySkip(sheet.dataset.team, !on);
    });
    prSaveSkip();
    updatePrCount();
}

document.getElementById('prAllBtn')?.addEventListener('click', () => prSetAll(true));
document.getElementById('prNoneBtn')?.addEventListener('click', () => prSetAll(false));

// 열고 닫기만 한다. 연 상태를 기억하지는 않는다 — 늘 떠 있는 게 거슬려서
// 접은 것이므로, 화면을 새로 열면 다시 접힌 채로 시작하는 게 맞다.
prPickToggle?.addEventListener('click', () => {
    if (!prPickList) return;
    prPickList.hidden = !prPickList.hidden;
    updatePrCount();
});

document.getElementById('prPrintBtn')?.addEventListener('click', () => {
    if (!prPreview) return;
    // 마지막 장을 :last-child 로 잡으면 안 된다. 뺀 장은 숨겨질 뿐 DOM 상으로는
    // 여전히 마지막일 수 있어서, 그 뒤에 빈 종이가 한 장 나온다.
    const live = [...prPreview.querySelectorAll('.pr-sheet:not(.pr-skip)')];
    if (!live.length) { alert('출력할 장이 없습니다. 최소 한 조는 선택해 주세요.'); return; }
    prPreview.querySelectorAll('.pr-last').forEach(el => el.classList.remove('pr-last'));
    live[live.length - 1].classList.add('pr-last');
    window.print();
});

// 칸 토글 — 성격이 다른 칸을 한 체크박스로 묶지 않는다.
// '김밥 현황'(데이터)과 '김밥신청'(빈칸)을 묶었다가 신청 칸을 끄면 현황까지
// 사라지는 일이 있었다.
for (const [id] of PR_SAVED_COLS) {
    document.getElementById(id)?.addEventListener('change', () => {
        prSaveCols();
        renderPrPreview();
    });
}
// 김밥신청은 기억하지 않는다 (위 prSaveCols 주석 참고).
document.getElementById('prColLunchReq')?.addEventListener('change', () => {
    prLunchReqTouched = true;
    renderPrPreview();
});

// 주차·범위를 바꿔도 뺀 조는 그대로 둔다. 조 이름으로 기억하고 있어서
// 범위 밖으로 나가면 안 그려질 뿐이고, 다시 들어오면 뺀 채로 나온다.
prSessionPicker?.addEventListener('change', (e) => {
    prSessionDate = e.target.value;
    prSessionTouched = true;   // 사람이 고른 것은 새로 고쳐도 덮지 않는다
    prApplyAutoLunchReq();
    loadPrintData();
});

prScopePicker?.addEventListener('change', (e) => {
    prScope = e.target.value;
    renderPrPreview();
});

function prApplyAutoLunchReq() {
    if (prLunchReqTouched) return;
    const box = document.getElementById('prColLunchReq');
    if (box) box.checked = prIsLastClassOfMonth(prSessionDate);
}

async function loadPrintData() {
    if (!prSessionDate) return;
    prLoading = true;
    renderPrPreview();
    try {
        const s = prSessionMeta();
        const extras = await getSessionExtras(prSessionDate, s?.name || '');
        prLunchSet = extras.lunch;
        prHwSet = extras.homework;
        prExtras = { hwLoaded: extras.hwLoaded, hwTotal: extras.hwTotal, hwNear: extras.hwNear };
        prReady = true;
    } catch (err) {
        console.log('출석부 자료 조회 실패:', err);
        prReady = false;
    } finally {
        prLoading = false;
        renderPrPreview();
    }
}

function initPrintTab() {
    const sessions = getSessions({ all: true });
    if (!sessions.length) { renderPrPreview(); return; }

    // 기본값은 오늘과 가장 가까운 회차. 출석 관리와 같은 기준이라
    // 탭을 옮겨도 같은 주차를 보게 된다.
    prSessionDate = nearestSessionDate(sessions, getToday()) || sessions[sessions.length - 1].date;

    renderPrPickers();
    prLoadSkip();          // 지난번에 뺀 조
    prLoadCols();          // 기억해 둔 칸을 먼저 되살리고
    prApplyAutoLunchReq(); // 김밥신청은 그 위에 자동 판단으로 덮는다
}

/**
 * 주차 목록을 지금 데이터에 맞춘다.
 *
 * 주차는 탭을 처음 열 때 한 번 고르고 끝이었다. 그래서 시트에 이번 주 회차를
 * 새로 넣고 가져와도, 목록에는 그 주차가 아예 없고 지난 주차가 골라진 채로
 * 남았다 — 출석부를 뽑으면 지난주 것이 나온다.
 *
 * 사람이 직접 고른 주차는 건드리지 않는다. 다만 그 주차가 목록에서 사라졌다면
 * 붙들고 있을 수 없으므로 가장 가까운 회차로 돌아간다.
 *
 * @returns {boolean} 주차가 바뀌었는가 (바뀌었으면 다시 읽어야 한다)
 */
function prSyncSessions() {
    const sessions = getSessions({ all: true });
    if (!sessions.length) return false;

    const before = prSessionDate;
    if (!prSessionTouched || !sessions.some(s => s.date === prSessionDate)) {
        prSessionDate = nearestSessionDate(sessions, getToday()) || sessions[sessions.length - 1].date;
    }

    renderPrPickers();
    if (prSessionDate !== before) prApplyAutoLunchReq();
    return prSessionDate !== before;
}

async function openPrintTab() {
    if (prLoading) return;
    if (prReady) {
        // 다시 열 때도 맞춰 본다. 화면을 켜 둔 채 자정을 넘겼거나
        // 그사이 회차가 늘었을 수 있다.
        if (prSyncSessions()) await loadPrintData();
        return;
    }
    initPrintTab();
    await loadPrintData();
}

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
            let updateApplied = false;
            const registration = await navigator.serviceWorker.register('./sw.js');

            registration.addEventListener('updatefound', () => {
                const newSW = registration.installing;
                if (!newSW) return;
                newSW.addEventListener('statechange', () => {
                    // controller 가 있어야 '갱신'이다. null 이면 첫 방문이다.
                    if (newSW.state === 'installed' && navigator.serviceWorker.controller) {
                        updateApplied = true;
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
                // 첫 설치의 clients.claim() 도 이 이벤트를 일으킨다. 그때는 갱신이
                // 아니라 첫 방문이므로 리로드하지 않는다 — 처음 들어온 사람 화면이
                // 이유 없이 깜빡이고, 출석 관리 중이었다면 입력이 날아간다.
                // (index 쪽은 이미 이렇게 막아 뒀는데 여기만 빠져 있었다)
                if (!updateApplied && !hadController) return;
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



