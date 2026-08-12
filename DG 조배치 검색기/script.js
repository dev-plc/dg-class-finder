// 데이터 저장 변수
let memberData = [];

// DOM 요소
const nameInput = document.getElementById('name');
const phoneInput = document.getElementById('phone');
const searchBtn = document.getElementById('searchBtn');
const resultContainer = document.getElementById('resultContainer');
const errorMessage = document.getElementById('errorMessage');
const closeBtn = document.getElementById('closeBtn');

// 결과 표시 요소
const resultName = document.getElementById('resultName');
const resultTeam = document.getElementById('resultTeam');
const resultLocation = document.getElementById('resultLocation');
const mapContainer = document.getElementById('mapContainer');
const mapImage = document.getElementById('mapImage');
const errorText = document.getElementById('errorText');

// 데이터 로드 함수
async function loadData() {
    try {
        const response = await fetch('data.json');
        memberData = await response.json();
        
        console.log('✅ 데이터 로드 완료:', memberData.length, '명');
    } catch (error) {
        console.error('❌ 데이터 로드 실패:', error);
        showError('데이터를 불러오는데 실패했습니다.');
    }
}

// 검색 함수
function searchMember() {
    const name = nameInput.value.trim();
    const phone = phoneInput.value.trim();
    
    // 입력 검증
    if (!name) {
        showError('이름을 입력해주세요.');
        nameInput.focus();
        return;
    }
    
    if (!phone) {
        showError('전화번호 뒷 4자리를 입력해주세요.');
        phoneInput.focus();
        return;
    }
    
    if (phone.length !== 4 || !/^\d{4}$/.test(phone)) {
        showError('전화번호 뒷 4자리를 정확히 입력해주세요.');
        phoneInput.focus();
        return;
    }
    
    // 데이터 검색
    const member = memberData.find(m => 
        m.name === name && m.phone === phone
    );
    
    if (member) {
        showResult(member);
    } else {
        showError('일치하는 정보를 찾을 수 없습니다.<br>이름과 전화번호를 다시 확인해주세요.<br><br>주변 교역자에게 문의하시거나<br>하단의 <strong>문의</strong> 또는 <strong>오류 신고</strong>를 이용해주세요.');
    }
}

// 결과 표시 함수
function showResult(member) {
    hideError();
    
    resultName.textContent = member.name;
    resultTeam.textContent = member.team;
    resultLocation.textContent = member.location;
    
    // 60세 이상이면 큰 글씨 모드
    if (member.age && member.age >= 60) {
        document.body.classList.add('large-text');
    } else {
        document.body.classList.remove('large-text');
    }
    
    // 배치도 이미지가 있는 경우
    if (member.mapImage) {
        mapImage.src = member.mapImage;
        mapContainer.style.display = 'block';
    } else {
        mapContainer.style.display = 'none';
    }
    
    resultContainer.style.display = 'block';
    
    // 결과로 스크롤
    setTimeout(() => {
        resultContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

// 에러 메시지 표시
function showError(message) {
    errorText.innerHTML = message;
    errorMessage.style.display = 'flex';
    resultContainer.style.display = 'none';
    
    setTimeout(() => {
        errorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }, 100);
}

// 에러 메시지 숨기기
function hideError() {
    errorMessage.style.display = 'none';
}

// 결과 닫기
function closeResult() {
    resultContainer.style.display = 'none';
    nameInput.value = '';
    phoneInput.value = '';
    nameInput.focus();
}

// 이벤트 리스너
searchBtn.addEventListener('click', searchMember);
closeBtn.addEventListener('click', closeResult);

// Enter 키로 검색
nameInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        phoneInput.focus();
    }
});

phoneInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        searchMember();
    }
});

// 전화번호 입력 시 숫자만 입력 가능
phoneInput.addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, '');
});

// 입력 시 에러 메시지 숨기기
nameInput.addEventListener('input', hideError);
phoneInput.addEventListener('input', hideError);

// 테마 전환 기능
const themeToggle = document.getElementById('themeToggle');

// 기본값은 항상 라이트 모드 (localStorage 무시)
// 페이지 로드 시 항상 라이트 모드로 시작
document.body.classList.remove('dark-mode');

// 테마 전환 버튼
themeToggle.addEventListener('click', () => {
    document.body.classList.toggle('dark-mode');
});

// 이미지 전체화면 모달
const imageModal = document.getElementById('imageModal');
const modalImage = document.getElementById('modalImage');
const modalClose = document.getElementById('modalClose');

// 배치도 이미지 클릭 시 전체화면
mapImage.addEventListener('click', () => {
    modalImage.src = mapImage.src;
    imageModal.classList.add('active');
    document.body.style.overflow = 'hidden'; // 스크롤 방지
});

// 모달 닫기
function closeModal() {
    imageModal.classList.remove('active');
    document.body.style.overflow = 'auto';
}

modalClose.addEventListener('click', closeModal);
imageModal.addEventListener('click', (e) => {
    if (e.target === imageModal) {
        closeModal();
    }
});


// 관리자 로그인 기능
const adminBtn = document.getElementById('adminBtn');
const adminLoginModal = document.getElementById('adminLoginModal');
const adminLoginClose = document.getElementById('adminLoginClose');
const adminLoginForm = document.getElementById('adminLoginForm');
const adminLoginError = document.getElementById('adminLoginError');
const adminIdInput = document.getElementById('adminId');
const adminPasswordInput = document.getElementById('adminPassword');

// 관리자 계정 정보
const ADMIN_CREDENTIALS = {
    username: 'plc',
    password: 'plc1234'
};

// 관리자 버튼 클릭
adminBtn.addEventListener('click', () => {
    adminLoginModal.classList.add('active');
    document.body.style.overflow = 'hidden';
    setTimeout(() => adminIdInput.focus(), 100);
});

// 로그인 모달 닫기
adminLoginClose.addEventListener('click', closeAdminLoginModal);
adminLoginModal.addEventListener('click', (e) => {
    if (e.target === adminLoginModal) {
        closeAdminLoginModal();
    }
});

function closeAdminLoginModal() {
    adminLoginModal.classList.remove('active');
    document.body.style.overflow = 'auto';
    adminLoginForm.reset();
    adminLoginError.style.display = 'none';
}

// 로그인 폼 제출
adminLoginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const username = adminIdInput.value.trim();
    const password = adminPasswordInput.value.trim();
    
    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        // 로그인 성공
        sessionStorage.setItem('adminLoggedIn', 'true');
        window.location.href = 'admin.html';
    } else {
        // 로그인 실패
        adminLoginError.textContent = '아이디 또는 비밀번호가 올바르지 않습니다.';
        adminLoginError.style.display = 'block';
        adminPasswordInput.value = '';
        adminPasswordInput.focus();
    }
});

// ESC 키로 모달 닫기
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (adminLoginModal.classList.contains('active')) {
            closeAdminLoginModal();
        } else if (imageModal.classList.contains('active')) {
            closeModal();
        }
    }
});

// 페이지 로드 시 데이터 로드
window.addEventListener('load', () => {
    loadData();
    nameInput.focus();
});

