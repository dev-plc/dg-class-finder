// Firebase 설정 import
import { db, collection, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc } from './firebase-config.js';

// DOM 요소
const ordersListContainer = document.getElementById('ordersList');
const pendingCountElement = document.getElementById('pendingCount');
const preparingCountElement = document.getElementById('preparingCount');
const completedCountElement = document.getElementById('completedCount');
const filterButtons = document.querySelectorAll('.filter-btn');

let currentFilter = 'all';
let allOrders = []; // 모든 주문 데이터 저장

// 페이지 로드 시 실시간 주문 목록 구독
subscribeToOrders();

// 필터 버튼 이벤트
filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        filterButtons.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        renderOrders();
    });
});

// Firebase 실시간 주문 구독
function subscribeToOrders() {
    const ordersCollection = collection(db, 'orders');
    const ordersQuery = query(ordersCollection, orderBy('timestamp', 'desc'));
    
    // 실시간 업데이트 구독
    onSnapshot(ordersQuery, (snapshot) => {
        allOrders = [];
        snapshot.forEach((doc) => {
            allOrders.push({
                id: doc.id,
                ...doc.data()
            });
        });
        
        renderOrders();
    }, (error) => {
        console.error('주문 목록 불러오기 실패:', error);
    });
}

// 주문 목록 렌더링
function renderOrders() {
    // 통계 업데이트
    updateStats(allOrders);
    
    // 필터링
    let filteredOrders = allOrders;
    if (currentFilter !== 'all') {
        filteredOrders = allOrders.filter(order => order.status === currentFilter);
    }
    
    // 화면 렌더링
    if (filteredOrders.length === 0) {
        ordersListContainer.innerHTML = '<p class="empty-orders">주문이 없습니다</p>';
        return;
    }
    
    let html = '';
    filteredOrders.forEach(order => {
        html += createOrderCard(order);
    });
    
    ordersListContainer.innerHTML = html;
}

// 주문 카드 생성
function createOrderCard(order) {
    const statusText = {
        'pending': '대기중',
        'preparing': '준비중',
        'completed': '완료'
    };
    
    const time = new Date(order.timestamp);
    const timeString = `${time.getHours().toString().padStart(2, '0')}:${time.getMinutes().toString().padStart(2, '0')}`;
    
    let itemsHtml = '';
    order.items.forEach(item => {
        itemsHtml += `
            <div class="order-item">
                <span class="item-name">${item.icon} ${item.name} x${item.quantity}</span>
            </div>
        `;
    });
    
    let actionsHtml = '';
    if (order.status === 'pending') {
        actionsHtml = `
            <button class="btn-action btn-preparing" onclick="updateOrderStatus('${order.id}', 'preparing')">
                준비 시작
            </button>
            <button class="btn-action btn-cancel" onclick="cancelOrder('${order.id}')">
                취소
            </button>
        `;
    } else if (order.status === 'preparing') {
        actionsHtml = `
            <button class="btn-action btn-complete" onclick="updateOrderStatus('${order.id}', 'completed')">
                완료
            </button>
        `;
    }
    
    return `
        <div class="order-card">
            <div class="order-header">
                <div class="order-info">
                    <h3>${order.userName}</h3>
                    <div class="order-meta">
                        <span class="order-type">${order.userType}</span>
                        <span class="order-time">${timeString}</span>
                    </div>
                </div>
                <span class="order-status status-${order.status}">
                    ${statusText[order.status]}
                </span>
            </div>
            
            <div class="order-items">
                ${itemsHtml}
            </div>
            
            <div class="order-actions">
                ${actionsHtml}
            </div>
        </div>
    `;
}

// 주문 상태 업데이트 (Firebase)
async function updateOrderStatus(orderId, newStatus) {
    try {
        const orderRef = doc(db, 'orders', orderId);
        await updateDoc(orderRef, {
            status: newStatus
        });
        console.log('주문 상태가 업데이트되었습니다!');
    } catch (error) {
        console.error('주문 상태 업데이트 실패:', error);
        alert('주문 상태 업데이트에 실패했습니다.');
    }
}

// 주문 취소 (Firebase)
async function cancelOrder(orderId) {
    if (!confirm('정말 이 주문을 취소하시겠습니까?')) {
        return;
    }
    
    try {
        const orderRef = doc(db, 'orders', orderId);
        await deleteDoc(orderRef);
        console.log('주문이 취소되었습니다!');
    } catch (error) {
        console.error('주문 취소 실패:', error);
        alert('주문 취소에 실패했습니다.');
    }
}

// 통계 업데이트
function updateStats(orders) {
    const pending = orders.filter(o => o.status === 'pending').length;
    const preparing = orders.filter(o => o.status === 'preparing').length;
    const completed = orders.filter(o => o.status === 'completed').length;
    
    pendingCountElement.textContent = pending;
    preparingCountElement.textContent = preparing;
    completedCountElement.textContent = completed;
}

// 전역 함수로 등록 (HTML onclick에서 사용)
window.updateOrderStatus = updateOrderStatus;
window.cancelOrder = cancelOrder;

