// 1. 데이터 계층
//
// 화면은 아래 함수들만 쓴다. 어디서 데이터가 오는지(Supabase·시트)는 알지 못한다.
import {
    ensureLoaded,
    findMember,
    getTeamMembers,
    getLocationImage,
    getTeamLink,
    refreshAttendance,
    setAttendance,
} from './scripts/members-data.js?v=7';

// 2. DOM 요소 선택
const elements = {
    nameInput: document.getElementById('name'),
    phoneInput: document.getElementById('phone'),
    searchBtn: document.getElementById('searchBtn'),
    searchBtnText: document.querySelector('#searchBtn .btn-text'),
    resultContainer: document.getElementById('resultContainer'),
    errorMessage: document.getElementById('errorMessage'),
    errorText: document.getElementById('errorText'),
    closeBtn: document.getElementById('closeBtn'),
    resultName: document.getElementById('resultName'),
    resultTeam: document.getElementById('resultTeam'),
    resultLocation: document.getElementById('resultLocation'),
    resultLunch: document.getElementById('resultLunch'),
    mapContainer: document.getElementById('mapContainer'),
    mapImage: document.getElementById('mapImage'),
    themeToggle: document.getElementById('themeToggle'),
    adminBtn: document.getElementById('adminBtn'),
    adminModal: document.getElementById('adminLoginModal'),
    adminClose: document.getElementById('adminLoginClose'),
    adminForm: document.getElementById('adminLoginForm')
};

// 3. 데이터 로드
//
// 캐시가 있으면 즉시 버튼을 열고 뒤에서 갱신한다.
// 처음 들어온 사람만 받아올 때까지 기다린다.
async function loadData() {
    try {
        elements.searchBtn.disabled = true;
        if (elements.searchBtnText) elements.searchBtnText.textContent = "로딩중...";

        const { cacheHit } = await ensureLoaded({
            onBackgroundRefreshError: (err) => console.log("백그라운드 갱신 실패:", err),
        });

        console.log(cacheHit ? "⚡ 캐시로 즉시 활성화" : "✅ 최신 데이터 로드 완료");

        elements.searchBtn.disabled = false;
        if (elements.searchBtnText) elements.searchBtnText.textContent = "조 확인하기";
    } catch (error) {
        console.log("❌ 데이터 로드 실패:", error);
        alert("데이터를 불러오는 중 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
        if (elements.searchBtnText) elements.searchBtnText.textContent = "오류 발생";
    }
}

// 4. 검색 로직
function searchMember() {
    const name = elements.nameInput.value.trim().replace(/\s/g, '');
    const phone = elements.phoneInput.value.trim().replace(/[^0-9]/g, '');

    if (!name || !phone) {
        showError("이름과 번호 4자리를 입력해주세요.");
        return;
    }

    const member = findMember(name, phone);

    if (member) {
        displayResult(member);
    } else {
        showError("일치하는 정보를 찾을 수 없습니다.<br>입력 내용을 확인해주세요.");
    }
}

// 5. 검색 결과 표시
function toggleRow(row, value, target) {
    if (value && value.trim() !== "") {
        target.textContent = value;
        if (row) row.style.display = 'flex';
    } else {
        if (row) row.style.display = 'none';
    }
}

function displayResult(member) {
    elements.errorMessage.style.display = 'none';
    
    const memberListContainer = document.getElementById('teamMemberListContainer');
    if (memberListContainer) memberListContainer.style.display = 'none';

    const nameRow = elements.resultName ? elements.resultName.closest('.info-row') : null;
    const teamRow = elements.resultTeam ? elements.resultTeam.closest('.info-row') : null;
    const locationRow = elements.resultLocation ? elements.resultLocation.closest('.info-row') : null;
    const lunchRow = elements.resultLunch ? elements.resultLunch.closest('.info-row') : null;

    toggleRow(nameRow, member.name, elements.resultName);
    toggleRow(teamRow, member.team, elements.resultTeam);
    toggleRow(locationRow, member.location, elements.resultLocation);
    
    const lunchStatus = (member.lunch && String(member.lunch).trim().toUpperCase() === 'O') ? 'O' : 'X';
    toggleRow(lunchRow, lunchStatus, elements.resultLunch);

    // ✨ 텔레그램 링크 동적 렌더링
    let telegramRow = document.getElementById('telegramRow');
    if (!telegramRow && teamRow) {
        telegramRow = teamRow.cloneNode(true);
        telegramRow.id = 'telegramRow';

        if (telegramRow.children.length >= 2) {
            const label = telegramRow.children[0];
            if(label) label.textContent = '안내방';

            const valueContainer = telegramRow.children[1];
            if(valueContainer) {
                valueContainer.innerHTML = `
                    <div style="display: flex; flex-direction: column; gap: 8px; align-items: stretch;">
                        <a id="resultTelegramLink" href="" target="_blank" class="telegram-btn">
                            <span style="font-size: 1.1em;">✈️</span>
                            <span id="telegramLinkText"></span>
                        </a>
                        <a id="resultGroupTelegramLink" href="" target="_blank" class="telegram-btn" style="display: none;">
                            <span style="font-size: 1.1em;">✈️</span>
                            <span id="groupTelegramLinkText"></span>
                        </a>
                    </div>
                `;
                valueContainer.id = '';
            }
        }
        teamRow.parentNode.insertBefore(telegramRow, teamRow.nextSibling);
    }

    const telegramLinkEl = document.getElementById('resultTelegramLink');
    const telegramTextEl = document.getElementById('telegramLinkText');
    if (telegramRow && telegramLinkEl && telegramTextEl) {
        if (member.telegramLink && member.team) {
            telegramLinkEl.href = member.telegramLink;
            telegramTextEl.textContent = `${member.team}조 방 입장하기`;
            telegramRow.style.display = 'flex';
        } else {
            telegramRow.style.display = 'none';
        }
    }

    // 조 이름 앞 접두사에 따라 소속 그룹 안내방 버튼 추가
    const GROUP_PREFIX_MAP = [
        { prefix: 'Y', group: '청년부' },
        { prefix: 'O', group: '온라인' },
        { prefix: 'C', group: '청년부부' },
        { prefix: '남', group: '남장년부' },
        { prefix: '여', group: '여장년부' }
    ];

    const groupTelegramLinkEl = document.getElementById('resultGroupTelegramLink');
    const groupTelegramTextEl = document.getElementById('groupTelegramLinkText');
    if (groupTelegramLinkEl && groupTelegramTextEl) {
        let matchedGroup = null;
        const teamName = member.team ? member.team.trim() : '';
        if (teamName) {
            for (const { prefix, group } of GROUP_PREFIX_MAP) {
                if (teamName.startsWith(prefix) && teamName !== group) {
                    matchedGroup = group;
                    break;
                }
            }
        }

        if (matchedGroup) {
            const groupLink = getTeamLink(matchedGroup);
            if (groupLink) {
                groupTelegramLinkEl.href = groupLink;
                groupTelegramTextEl.textContent = `${matchedGroup} 방 입장하기`;
                groupTelegramLinkEl.style.display = '';
            } else {
                groupTelegramLinkEl.style.display = 'none';
            }
        } else {
            groupTelegramLinkEl.style.display = 'none';
        }
    }

    const mapUrl = getLocationImage(member.location);
    if (mapUrl) {
        elements.mapImage.src = mapUrl;
        elements.mapContainer.style.display = 'block';
    } else {
        elements.mapContainer.style.display = 'none';
    }

    const isTutor = member.role && (
        member.role.includes('조장') ||
        member.role.includes('서브튜터') ||
        member.role.includes('관리자')
    );

    if (isTutor && member.team && memberListContainer) {
        renderTeamMembers(getTeamMembers(member.team), member.team, member.role);

        // 출석은 하루 한 번 동기화라 DB 값이 그날 안에 뒤처진다.
        // 조원 명단을 열 때는 원본에서 다시 읽어 방금 체크한 것이 보이게 한다.
        refreshAttendance()
            .then(() => renderTeamMembers(getTeamMembers(member.team), member.team, member.role))
            .catch(err => console.log("출석 최신화 실패, 마지막 값 표시:", err));
    }

    elements.resultContainer.style.display = 'block';
    elements.resultContainer.scrollIntoView({ behavior: 'smooth' });
}

// 6. 직책별 우선순위 설정
const rolePriority = {
    "관리자": 1,
    "조장": 2,
    "서브튜터": 3,
    "조원": 4,
    "": 4
};

// 7. 조원 목록 그리기
function renderTeamMembers(members, teamName, role) {
    const listElement = document.getElementById('teamMemberList');
    const titleElement = document.getElementById('teamListTitle');
    const container = document.getElementById('teamMemberListContainer'); 
    
    if (!listElement || !titleElement || !container) return;

    if (!role || role.trim() === '') {
        container.style.display = 'none';
        return;
    }

    container.style.display = 'block';
    
    const kimbapCount = members.filter(m => m.lunch && m.lunch.toUpperCase() === 'O').length;
    
    titleElement.textContent = `👥 ${teamName} 조원 명단 (총 ${members.length}명 / 🍙 김밥 ${kimbapCount}개)`;
    
    const sortedMembers = [...members].sort((a, b) => {
        const priorityA = rolePriority[a.role] || 4;
        const priorityB = rolePriority[b.role] || 4;
        
        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }
        return a.name.localeCompare(b.name, 'ko');
    });

    listElement.innerHTML = sortedMembers.map((m) => {
        const lunchIcon = (m.lunch && m.lunch.toUpperCase() === 'O') ? '<span style="margin-left:4px;" title="김밥 대상자">🍙</span>' : '';
        const isChecked = (m.attendance && m.attendance.toUpperCase() === 'O') ? 'checked' : '';

        return `
            <div class="team-member-item">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="checkbox" ${isChecked}
                        class="attendance-check"
                        data-name="${escapeAttr(m.name)}" data-phone="${escapeAttr(m.phone)}"
                        style="width: 18px; height: 18px; cursor: pointer;">
                    <span class="member-name">
                        ${escapeHtml(m.name)}(${escapeHtml(m.phone)}) ${lunchIcon}
                    </span>
                </div>
                <span class="member-role-tag">
                    ${escapeHtml(m.role || '조원')}
                </span>
            </div>
        `;
    }).join('');
}

function escapeHtml(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
    ));
}
const escapeAttr = escapeHtml;

// ✨ 낙관적 업데이트: 체크는 바로 반영하고, 실패하면 되돌린다
async function toggleAttendanceUI(name, phone, checked, checkboxElement) {
    const status = checked ? 'O' : 'X';
    const originalStatus = checked ? 'X' : 'O';

    try {
        await setAttendance(name, phone, status);
    } catch (error) {
        console.log('출석 저장 실패:', error);
        alert('출석 처리에 실패하여 원래 상태로 되돌립니다: ' + error.message);
        if (checkboxElement) checkboxElement.checked = (originalStatus === 'O');
    }
}

// 8. 에러 표시 함수
function showError(msg) {
    elements.errorText.innerHTML = msg;
    elements.errorMessage.style.display = 'flex';
    elements.resultContainer.style.display = 'none';
}

// 9. 이벤트 리스너 및 모달 제어
function initEventListeners() {
    elements.searchBtn.addEventListener('click', searchMember);
    elements.closeBtn.addEventListener('click', () => { elements.resultContainer.style.display = 'none'; });
    elements.themeToggle.addEventListener('click', () => { document.body.classList.toggle('dark-mode'); });
    elements.adminBtn.addEventListener('click', () => { elements.adminModal.classList.add('active'); });
    elements.adminClose.addEventListener('click', () => { elements.adminModal.classList.remove('active'); });
    elements.adminForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const id = document.getElementById('adminId').value;
        const pw = document.getElementById('adminPassword').value;
        if (id === 'plc' && pw === 'plc1234') {
            alert("로그인 성공!");
            sessionStorage.setItem('adminLoggedIn', 'true'); 
            window.location.href = 'admin.html'; 
        } else {
            const errorElement = document.getElementById('adminLoginError');
            errorElement.style.display = 'block';
            errorElement.textContent = "아이디 또는 비밀번호가 틀렸습니다.";
        }
    });
    elements.phoneInput.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && !elements.searchBtn.disabled) searchMember();
    });

    // 조원 명단은 다시 그려지므로 목록 자체에 한 번만 걸어 둔다.
    const teamList = document.getElementById('teamMemberList');
    if (teamList) {
        teamList.addEventListener('change', (e) => {
            const box = e.target.closest('.attendance-check');
            if (!box) return;
            toggleAttendanceUI(box.dataset.name, box.dataset.phone, box.checked, box);
        });
    }
}

function initModal() {
    const imageModal = document.getElementById('imageModal');
    const modalImage = document.getElementById('modalImage');
    const mapImage = document.getElementById('mapImage');
    const modalClose = document.getElementById('modalClose');
    if (!mapImage) return;
    mapImage.addEventListener('click', () => {
        modalImage.src = mapImage.src;
        imageModal.classList.add('active');
        document.body.style.overflow = 'hidden';
    });
    function closeModal() {
        if(imageModal) {
            imageModal.classList.remove('active');
            document.body.style.overflow = 'auto';
        }
    }
    if (imageModal) imageModal.addEventListener('click', closeModal);
    if (modalClose) modalClose.addEventListener('click', (e) => { e.stopPropagation(); closeModal(); });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

// 10. 실행
window.addEventListener('load', () => {
    loadData();
    initEventListeners();
    initModal();
});
