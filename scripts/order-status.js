// Firebase 설정 import
import { db, collection, doc, onSnapshot, updateDoc } from './firebase-config.js?v=55';

// DOM 요소
const orderNumberElement = document.getElementById('orderNumber');
const customerNameElement = document.getElementById('customerName');
const statusMessageElement = document.getElementById('statusMessage');
const orderItemsElement = document.getElementById('orderItems');
const feedbackSection = document.getElementById('feedbackSection');
const starRating = document.getElementById('starRating');
const feedbackCommentInput = document.getElementById('feedbackComment');
const btnSubmitFeedback = document.getElementById('btnSubmitFeedback');

// 상태 단계 요소들
const stepPending = document.getElementById('step-pending');
const stepPreparing = document.getElementById('step-preparing');
const stepCompleted = document.getElementById('step-completed');
const connectors = document.querySelectorAll('.status-connector');

let currentOrderId = null;
let selectedRating = 0;

// URL에서 주문 ID 가져오기
function getOrderIdFromUrl() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('orderId');
}

// 주문 ID 초기화
currentOrderId = getOrderIdFromUrl();

if (!currentOrderId) {
    alert('주문 정보를 찾을 수 없습니다.');
    window.location.href = 'index.html';
} else {
    // 주문 정보 실시간 모니터링
    subscribeToOrder(currentOrderId);
}

// 주문 정보 실시간 구독
function subscribeToOrder(orderId) {
    const orderRef = doc(db, 'orders', orderId);
    
    onSnapshot(orderRef, (docSnapshot) => {
        if (docSnapshot.exists()) {
            const order = docSnapshot.data();
            updateOrderDisplay(order);
        } else {
            alert('주문 정보를 찾을 수 없습니다.');
            window.location.href = 'index.html';
        }
    }, (error) => {
        console.error('주문 정보 불러오기 실패:', error);
        alert('주문 정보를 불러올 수 없습니다.');
    });
}

// 주문 화면 업데이트
function updateOrderDisplay(order) {
    // 주문 번호 표시
    const shortId = currentOrderId.substring(0, 8).toUpperCase();
    orderNumberElement.textContent = shortId;
    
    // 고객 이름
    customerNameElement.textContent = order.userName;
    
    // 주문 아이템 표시
    displayOrderItems(order.items);
    
    // 상태에 따라 UI 업데이트
    updateStatusDisplay(order.status);
    
    // 피드백 표시 여부
    if (order.status === 'completed' && !order.feedback) {
        showFeedbackSection();
    }
}

// 주문 아이템 표시
function displayOrderItems(items) {
    let html = '';
    items.forEach(item => {
        html += `
            <div class="order-item">
                <span class="item-name">${item.icon} ${item.name}</span>
                <span class="item-quantity">x ${item.quantity}</span>
            </div>
        `;
    });
    orderItemsElement.innerHTML = html;
}

// 상태 표시 업데이트
function updateStatusDisplay(status) {
    // 모든 상태 초기화
    stepPending.classList.remove('active', 'completed');
    stepPreparing.classList.remove('active', 'completed');
    stepCompleted.classList.remove('active', 'completed');
    connectors.forEach(c => c.classList.remove('completed'));
    
    switch(status) {
        case 'pending':
            stepPending.classList.add('active');
            statusMessageElement.textContent = '주문이 접수되었습니다. 잠시만 기다려주세요!';
            break;
            
        case 'preparing':
            stepPending.classList.add('completed');
            stepPreparing.classList.add('active');
            connectors[0].classList.add('completed');
            statusMessageElement.textContent = '음료를 제조하고 있습니다! 🎉';
            break;
            
        case 'completed':
            stepPending.classList.add('completed');
            stepPreparing.classList.add('completed');
            stepCompleted.classList.add('active', 'completed');
            connectors[0].classList.add('completed');
            connectors[1].classList.add('completed');
            statusMessageElement.textContent = '주문이 완료되었습니다! 맛있게 드세요! 😊';
            break;
    }
}

// 피드백 섹션 표시
function showFeedbackSection() {
    feedbackSection.style.display = 'block';
    feedbackSection.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// 별점 클릭 이벤트
const stars = starRating.querySelectorAll('.star');
stars.forEach(star => {
    star.addEventListener('click', () => {
        const rating = parseInt(star.dataset.rating);
        selectedRating = rating;
        
        // 별 표시 업데이트
        stars.forEach((s, index) => {
            if (index < rating) {
                s.classList.add('active');
                s.textContent = '★';
            } else {
                s.classList.remove('active');
                s.textContent = '☆';
            }
        });
    });
    
    // 호버 효과
    star.addEventListener('mouseenter', () => {
        const rating = parseInt(star.dataset.rating);
        stars.forEach((s, index) => {
            if (index < rating) {
                s.textContent = '★';
            } else {
                s.textContent = '☆';
            }
        });
    });
});

// 마우스가 별 영역을 벗어날 때
starRating.addEventListener('mouseleave', () => {
    stars.forEach((s, index) => {
        if (index < selectedRating) {
            s.textContent = '★';
        } else {
            s.textContent = '☆';
        }
    });
});

// 피드백 제출
btnSubmitFeedback.addEventListener('click', async () => {
    if (selectedRating === 0) {
        alert('별점을 선택해주세요! ⭐');
        return;
    }
    
    const comment = feedbackCommentInput.value.trim();
    
    try {
        btnSubmitFeedback.disabled = true;
        btnSubmitFeedback.textContent = '제출 중...';
        
        // Firebase에 피드백 저장
        const orderRef = doc(db, 'orders', currentOrderId);
        await updateDoc(orderRef, {
            feedback: {
                rating: selectedRating,
                comment: comment,
                timestamp: new Date().toISOString()
            }
        });
        
        // 성공 메시지
        alert('피드백을 주셔서 감사합니다! 💖\n더 나은 서비스를 제공하겠습니다!');
        
        // 피드백 섹션 숨기기
        feedbackSection.style.display = 'none';
        
    } catch (error) {
        console.error('피드백 저장 실패:', error);
        alert('피드백 저장에 실패했습니다. 다시 시도해주세요.');
        btnSubmitFeedback.disabled = false;
        btnSubmitFeedback.textContent = '피드백 제출하기';
    }
});
