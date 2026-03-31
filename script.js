// 1. 설정 데이터
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbz1tpAmZB0NEHX0TppV-wrq7ud4IG5PmwukVNuZNT5y46tucKpSyRDnfjLosAyno90r2A/exec";

// 💡 로컬 스토리지 캐시 키 정의 (DG 전용)
const CACHE_KEY_DATA = "dg_member_data_v17";
const CACHE_KEY_MAP = "dg_location_map_v17";

let locationMapImages = {}; // 구글시트와 연동
let memberData = [];

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

// 3. 데이터 로드 (✨ 캐싱 및 UI 차단 기능 포함)
async function loadData() {
    try {
        // [1] 초기 버튼 상태: 서버 통신 대기
        elements.searchBtn.disabled = true;
        if (elements.searchBtnText) {
            elements.searchBtnText.textContent = "로딩중...";
        }

        // [2] 로컬 캐시에서 데이터 먼저 꺼내오기
        const cachedDataStr = localStorage.getItem(CACHE_KEY_DATA);
        const cachedMapStr = localStorage.getItem(CACHE_KEY_MAP);

        if (cachedDataStr) {
            memberData = JSON.parse(cachedDataStr);
            if (cachedMapStr) locationMapImages = JSON.parse(cachedMapStr);
            
            console.log("⚡ Cached Data Loaded: 즉시 활성화 됨");
            
            // 캐시 데이터가 있으면 사용자 대기 없이 버튼 즉시 활성화
            elements.searchBtn.disabled = false;
            if (elements.searchBtnText) elements.searchBtnText.textContent = "조 확인하기";
        } else {
            // 캐시가 없을 때만 로딩 문구 명시
            if (elements.searchBtnText) elements.searchBtnText.textContent = "데이터 로딩중... (최초 1회)";
        }

        // [3] 백그라운드에서 최신 데이터 가져와서 동기화
        const noCacheUrl = GAS_API_URL + "?t=" + new Date().getTime();
        
        const fetchPromise = fetch(noCacheUrl)
            .then(res => res.json())
            .then(result => {
                if (result.success) {
                    memberData = result.data;
                    if (result.locationMap) locationMapImages = result.locationMap;
                    
                    // 새 데이터를 캐시에 덮어쓰기
                    localStorage.setItem(CACHE_KEY_DATA, JSON.stringify(memberData));
                    localStorage.setItem(CACHE_KEY_MAP, JSON.stringify(locationMapImages));
                    
                    console.log("✅ Live Data Synced (백그라운드 최신화 완료)");
                    
                    // 만약 캐시가 없어서 비활성화 상태였다면 이제 활성화
                    elements.searchBtn.disabled = false;
                    if (elements.searchBtnText) elements.searchBtnText.textContent = "조 확인하기";
                }
            });

        // 💡 만약 캐시가 없었다면 (최초 접속), fetch가 완료될 때까지 await로 대기
        if (!cachedDataStr) {
            await fetchPromise;
        }

    } catch (error) {
        console.error("❌ Fetch Error:", error);
        if (memberData.length === 0) {
            alert("데이터를 불러오는 중 오류가 발생했습니다. 인터넷 연결을 확인해주세요.");
            if (elements.searchBtnText) elements.searchBtnText.textContent = "오류 발생";
        }
    }
}

// 4. 검색 로직
function searchMember() {
    const name = elements.nameInput.value.trim().replace(/\s/g, '');
    const phone = elements.phoneInput.value.trim().replace(/[^0-9]/g, '');
    const searchTarget = name + phone;

    if (!name || !phone) {
        showError("이름과 번호 4자리를 입력해주세요.");
        return;
    }

    const member = memberData.find(m => 
        String(m.id).replace(/\s/g, '') === searchTarget
    );

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
                    <a id="resultTelegramLink" href="" target="_blank" class="telegram-btn">
                        <span style="font-size: 1.1em;">✈️</span> 
                        <span id="telegramLinkText"></span>
                    </a>
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

    const pureLocation = member.location ? member.location.trim() : "";
    const mapUrl = locationMapImages[pureLocation];
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
        const teamMembers = memberData.filter(m => m.team === member.team);
        renderTeamMembers(teamMembers, member.team, member.role);
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

    listElement.innerHTML = sortedMembers.map((m, index) => {
        const lunchIcon = (m.lunch && m.lunch.toUpperCase() === 'O') ? '<span style="margin-left:4px;" title="김밥 대상자">🍙</span>' : '';
        const isChecked = (m.attendance && m.attendance.toUpperCase() === 'O') ? 'checked' : '';

        return `
            <div class="team-member-item">
                <div style="display: flex; align-items: center; gap: 10px;">
                    <input type="checkbox" ${isChecked} 
                        style="width: 18px; height: 18px; cursor: pointer;"
                        onclick="toggleAttendanceUI('${m.name}', '${m.phone}', this.checked, this)">
                    <span class="member-name">
                        ${m.name}(${m.phone}) ${lunchIcon}
                    </span>
                </div>
                <span class="member-role-tag">
                    ${m.role || '조원'}
                </span>
            </div>
        `;
    }).join('');
}

// ✨ 낙관적 업데이트 적용: 대기 시간 0.01초
async function toggleAttendanceUI(name, phone, checked, checkboxElement) {
    const status = checked ? 'O' : 'X';
    console.log(`[출석 변경 요청] ${name}(${phone}) -> ${status}`);

    // [1] 서버 응답 기다리지 않고 데이터 및 캐시 즉시 업데이트 (낙관적 UI)
    const memberIndex = memberData.findIndex(m => m.name === name && m.phone === phone);
    let originalStatus = 'X'; 
    
    if (memberIndex !== -1) {
        originalStatus = memberData[memberIndex].attendance || 'X';
        memberData[memberIndex].attendance = status;
        localStorage.setItem(CACHE_KEY_DATA, JSON.stringify(memberData));
    }

    // [2] 백그라운드 서버 전송
    try {
        const response = await fetch(GAS_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8',
            },
            body: JSON.stringify({
                name: name,
                phone: phone,
                status: status
            })
        });

        const result = await response.json();

        if (result.success) {
            console.log('업데이트 최종 성공:', result.message);
        } else {
            console.error('업데이트 실패:', result.message);
            alert('출석 처리에 실패하여 원래 상태로 되돌립니다: ' + result.message);
            rollbackAttendance(name, phone, originalStatus, checkboxElement);
        }
    } catch (error) {
        console.error('네트워크 오류:', error);
        alert('서버 통신 중 문제가 발생하여 체크가 원래 상태로 되돌아갑니다.');
        rollbackAttendance(name, phone, originalStatus, checkboxElement);
    }
}

// 실패 시 롤백 함수
function rollbackAttendance(name, phone, originalStatus, checkboxElement) {
    const memberIndex = memberData.findIndex(m => m.name === name && m.phone === phone);
    if (memberIndex !== -1) {
        memberData[memberIndex].attendance = originalStatus;
        localStorage.setItem(CACHE_KEY_DATA, JSON.stringify(memberData));
    }
    if (checkboxElement) {
        checkboxElement.checked = (originalStatus === 'O');
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
