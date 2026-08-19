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
import { ensureLoaded, getMembers, subscribe } from './scripts/members-data.js?v=89';

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
    if (event.type !== 'refresh' && event.type !== 'cohort-changed') return;
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
    const sortedTeams = Object.values(teamGroups).sort((a, b) => {
        const PREFERRED_ORDER = ['새', '남', '여', 'DG', 'C', 'O', 'V', 'Y', 'M', 'W'];
        
        const getPrefix = (str) => (str.match(/^[가-힣A-Za-z]+/)?.[0] || '');
        const getNum = (str) => {
            const match = str.match(/\d+/);
            return match ? parseInt(match[0], 10) : 0;
        };

        const prefA = getPrefix(a.name);
        const prefB = getPrefix(b.name);

        if (prefA !== prefB) {
            const idxA = PREFERRED_ORDER.indexOf(prefA);
            const idxB = PREFERRED_ORDER.indexOf(prefB);
            
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            
            return prefA.localeCompare(prefB, 'ko');
        }

        const numA = getNum(a.name);
        const numB = getNum(b.name);
        if (numA !== numB) return numA - numB;

        return a.name.localeCompare(b.name, 'ko', { numeric: true });
    });
    
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



