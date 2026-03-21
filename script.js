// 1. 설정 데이터
//const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTgWISi-dAcC5JBD22_g65W-ms7S1MdHZqI1LjjK8iIpZYs-rY4bu9NlfR9lY6R96fVku3iq5AUFo8A/pub?gid=0&single=true&output=csv';
//이미지 https://postimages.org/ 업로드해서 링크받기
/*
const locationMapImages = {
    "웨슬리": "https://lh3.googleusercontent.com/u/0/d/1dBML_CRlbFX-hLiYAT29MhtG6Hz0NlWb",
    //"칼빈": "https://lh3.googleusercontent.com/u/0/d/19ji7bvxmiqKCcvavyAehAxx3N4e-yIR_",
    "칼빈": "https://i.postimg.cc/hjTSJ8jD/1221-kalbin.jpg",
    "자모영아실": "https://lh3.googleusercontent.com/u/0/d/13EovQWAnk9bT6Jt6wo2KBc-Y2TdlldK2"
};
*/

// 발급받은 구글 스크립트 웹앱 URL을 아래에 붙여넣으세요.
const GAS_API_URL = "https://script.google.com/macros/s/AKfycbz1tpAmZB0NEHX0TppV-wrq7ud4IG5PmwukVNuZNT5y46tucKpSyRDnfjLosAyno90r2A/exec";

const locationMapImages = {
    "웨슬리": "https://drive.google.com/thumbnail?authuser=0&sz=w1000&id=1-lINYh9FSFffxWn-G66xCE4mI9wp49mH",
    "칼빈": "https://drive.google.com/thumbnail?authuser=0&sz=w1000&id=1TKKEIrej8kwfFINw4j1GQRbUUhCgV-DV",
    "자모영아실": "https://drive.google.com/thumbnail?authuser=0&sz=w1000&id=13EovQWAnk9bT6Jt6wo2KBc-Y2TdlldK2"
};
let memberData = [];

// 2. DOM 요소 선택
const elements = {
    nameInput: document.getElementById('name'),
    phoneInput: document.getElementById('phone'),
    searchBtn: document.getElementById('searchBtn'),
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

// 3. 데이터 로드 (실시간 구글 API 방식으로 변경)
async function loadData() {
    try {
        // 브라우저 캐싱 방지를 위해 URL 끝에 타임스탬프 추가
        const noCacheUrl = GAS_API_URL + "?t=" + new Date().getTime();
        
        const response = await fetch(noCacheUrl);
        if (!response.ok) throw new Error('네트워크 응답이 정상이 아닙니다.');
        
        const result = await response.json();
        
        if (result.success) {
            memberData = result.data;
            console.log("✅ Live Data Loaded:", memberData.length, "members");
        } else {
            throw new Error(result.message);
        }
    } catch (error) {
        console.error("❌ Fetch Error:", error);
        alert("데이터를 불러오는 중 오류가 발생했습니다. 페이지를 새로고침 해주세요.");
    }
}
/*
// 3. 데이터 로드 및 파싱 (보강된 버전)
async function loadData() {
    try {
        const response = await fetch(GOOGLE_SHEET_CSV_URL);
        if (!response.ok) throw new Error('데이터를 불러올 수 없습니다.');
        const csvText = await response.text();
        memberData = parseCSV(csvText);
        console.log("✅ Data Loaded:", memberData.length, "members");
    } catch (error) {
        console.error("❌ Fetch Error:", error);
        // 사용자에게 데이터 로드 실패를 알림 (선택 사항)
        alert("데이터를 불러오는 중 오류가 발생했습니다. 페이지를 새로고침 해주세요.");
    }
}

function parseCSV(csvText) {
    const lines = csvText.split('\n').filter(line => line.trim() !== "");
    if (lines.length < 2) return [];
    
    const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/"/g, ''));
    
    return lines.slice(1).map(line => {
        const values = line.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
        const obj = {};
        headers.forEach((header, i) => {
            obj[header] = values[i] ? values[i].trim().replace(/"/g, '') : "";
        });
        return obj;
    });
}
*/
// 4. 검색 로직
function searchMember() {
    const name = elements.nameInput.value.trim();
    const phone = elements.phoneInput.value.trim();

    if (!name || !phone) {
        showError("이름과 번호 4자리를 입력해주세요.");
        return;
    }

    const member = memberData.find(m => 
        String(m.name) === name && String(m.phone) === phone
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

    // 각 정보 행(row)을 찾아서 표시하거나 숨김
    // HTML 구조상 .info-row 가 존재해야 합니다.
    const nameRow = elements.resultName ? elements.resultName.closest('.info-row') : null;
    const teamRow = elements.resultTeam ? elements.resultTeam.closest('.info-row') : null;
    const locationRow = elements.resultLocation ? elements.resultLocation.closest('.info-row') : null;
    const lunchRow = elements.resultLunch ? elements.resultLunch.closest('.info-row') : null; // 🍙 추가

    toggleRow(nameRow, member.name, elements.resultName);
    toggleRow(teamRow, member.team, elements.resultTeam);
    toggleRow(locationRow, member.location, elements.resultLocation);
    // 🍙 김밥 여부 표시 추가 (O가 아니면 기본적으로 X로 표시)
    const lunchStatus = (member.lunch && String(member.lunch).trim().toUpperCase() === 'O') ? 'O' : 'X';
    toggleRow(lunchRow, lunchStatus, elements.resultLunch);

    // 이미지 및 팀원 목록
    const pureLocation = member.location ? member.location.trim() : "";
    const mapUrl = locationMapImages[pureLocation];
    if (mapUrl) {
        elements.mapImage.src = mapUrl;
        elements.mapContainer.style.display = 'block';
    } else {
        elements.mapContainer.style.display = 'none';
    }

    // 튜터 권한 확인 (member.role 인자 추가 전달)
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
// 6. 직책별 우선순위 설정 (숫자가 낮을수록 상단 노출)
const rolePriority = {
    "관리자": 1,
    "조장": 2,
    "서브튜터": 3,
    "조원": 4,
    "": 4 // 직책이 없는 경우
};

// 7. 조원 목록 그리기 (정렬 + 김밥🍱 + 출석 UI 추가)
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
    
    // 🍙 새로 추가된 부분: 김밥 신청자 수 계산
    const kimbapCount = members.filter(m => m.lunch && m.lunch.toUpperCase() === 'O').length;
    
    // 👥 타이틀 수정: 총 인원과 김밥 갯수 함께 표시
    titleElement.textContent = `👥 ${teamName} 조원 명단 (총 ${members.length}명 / 🍙 김밥 ${kimbapCount}개)`;
    
    // [정렬 로직] 관리자 > 튜터 > 서브튜터 > 조원 순, 이후 이름순
    const sortedMembers = [...members].sort((a, b) => {
        const priorityA = rolePriority[a.role] || 4;
        const priorityB = rolePriority[b.role] || 4;
        
        if (priorityA !== priorityB) {
            return priorityA - priorityB;
        }
        return a.name.localeCompare(b.name, 'ko');
    });

    listElement.innerHTML = sortedMembers.map((m, index) => {
        const borderStyle = index === 0 
            ? "border-top: 1px dashed #ddd;" 
            : "border-top: 1px solid #eee;";

        // 김밥 여부 표시
        const lunchIcon = (m.lunch && m.lunch.toUpperCase() === 'O') ? '<span style="margin-left:4px;" title="김밥 대상자">🍙</span>' : '';
        // 출석 여부 (UI 체크 상태)
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

async function toggleAttendanceUI(name, phone, checked, checkboxElement) {
    const status = checked ? 'O' : 'X';
    console.log(`[출석 변경 요청] ${name}(${phone}) -> ${status}`);

    // 통신 중 중복 클릭 방지를 위해 체크박스 임시 비활성화
    if (checkboxElement) {
        checkboxElement.disabled = true;
    }

    try {
        // fetch API를 사용해 구글 스크립트로 데이터 전송
        // (주의: GAS CORS 에러를 피하기 위해 Content-Type을 text/plain으로 보냅니다)
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

        // 결과 파싱
        const result = await response.json();

        if (result.success) {
            console.log('업데이트 성공:', result.message);
            if (checkboxElement) checkboxElement.disabled = false; // 체크박스 활성화
            
            // 💡 [여기가 추가된 핵심 코드!]
            // 구글 시트 업데이트가 성공하면, 현재 웹페이지가 기억하고 있는 memberData의 값도 변경합니다.
            // 이렇게 해야 새로고침(F5) 없이 다시 검색해도 출석 O/X 상태가 제대로 화면에 반영됩니다.
            const memberIndex = memberData.findIndex(m => m.name === name && m.phone === phone);
            if (memberIndex !== -1) {
                memberData[memberIndex].attendance = status;
            }

        } else {
            console.error('업데이트 실패:', result.message);
            alert('출석 실패: ' + result.message);
            // 실패 시 체크박스 상태 원래대로 롤백
            if (checkboxElement) {
                checkboxElement.checked = !checked; 
                checkboxElement.disabled = false;
            }
        }
    } catch (error) {
        console.error('네트워크 오류:', error);
        alert('서버와 통신하는 중 문제가 발생했습니다. (인터넷 연결 등을 확인하세요)');
        if (checkboxElement) {
            checkboxElement.checked = !checked;
            checkboxElement.disabled = false;
        }
    }
}

// 8. 에러 표시 함수 (누락되었던 부분 추가)
function showError(msg) {
    elements.errorText.innerHTML = msg;
    elements.errorMessage.style.display = 'flex';
    elements.resultContainer.style.display = 'none';
}

// 9. 이벤트 리스너 및 모달 제어 (기존과 동일)
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
    elements.phoneInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') searchMember(); });
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


