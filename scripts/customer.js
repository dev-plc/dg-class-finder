// Firebase 설정 import
import { db, collection, addDoc } from './firebase-config.js?v=51';

// 장바구니 상태 관리
let cart = []; // { name, price, quantity, icon }

// DOM 요소
const menuCards = document.querySelectorAll('.menu-card');
const cartItemsContainer = document.getElementById('cartItems');
const totalPriceElement = document.getElementById('totalPrice');
const btnOrder = document.getElementById('btnOrder');
const userNameInput = document.getElementById('userName');
const userTypeSelect = document.getElementById('userType');
const cartSection = document.querySelector('.cart-section');

// 메뉴 카드 클릭 이벤트
menuCards.forEach(card => {
    card.addEventListener('click', (e) => {
        const menuName = card.dataset.menu;
        const menuIcon = card.querySelector('.menu-icon').textContent;
        
        // 장바구니에 추가 (중복 가능)
        addToCart(menuName, menuIcon, card);
    });
});

// 장바구니에 추가
function addToCart(menuName, menuIcon, cardElement) {
    // 기존 아이템 찾기
    const existingItem = cart.find(item => item.name === menuName);
    
    if (existingItem) {
        // 수량 증가
        existingItem.quantity++;
    } else {
        // 새로 추가
        cart.push({
            name: menuName,
            quantity: 1,
            icon: menuIcon
        });
    }
    
    // 애니메이션 효과
    playAddAnimation(cardElement, menuIcon);
    
    // 장바구니 업데이트
    updateCart();
}

// 추가 애니메이션
function playAddAnimation(cardElement, icon) {
    // 카드 펄스 효과
    cardElement.style.animation = 'none';
    setTimeout(() => {
        cardElement.style.animation = 'pulse 0.4s ease';
    }, 10);
    
    // 아이콘 날아가는 효과
    const iconElement = cardElement.querySelector('.menu-icon');
    const iconClone = iconElement.cloneNode(true);
    iconClone.classList.add('flying-icon');
    
    // 시작 위치
    const rect = iconElement.getBoundingClientRect();
    iconClone.style.position = 'fixed';
    iconClone.style.left = rect.left + 'px';
    iconClone.style.top = rect.top + 'px';
    iconClone.style.zIndex = '9999';
    iconClone.style.fontSize = '2em';
    
    document.body.appendChild(iconClone);
    
    // 장바구니 위치 (화면 중앙 상단 정도)
    const cartRect = cartSection.getBoundingClientRect();
    const targetX = window.innerWidth / 2;
    const targetY = cartRect.top - 50; // 장바구니보다 위쪽에서 사라짐
    
    // 중간 지점 (위로 살짝만 올라갔다가)
    const midY = rect.top - 80;
    
    // 애니메이션 실행 (포물선)
    setTimeout(() => {
        // 1단계: 위로 올라가기
        iconClone.style.transition = 'all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
        iconClone.style.transform = `translate(${(targetX - rect.left) * 0.4}px, ${midY - rect.top}px) scale(1.3)`;
    }, 10);
    
    // 2단계: 중간쯤에서 사라지기
    setTimeout(() => {
        iconClone.style.transition = 'all 0.5s cubic-bezier(0.55, 0.085, 0.68, 0.53)';
        iconClone.style.transform = `translate(${(targetX - rect.left) * 0.6}px, ${targetY - rect.top}px) scale(0.5)`;
        iconClone.style.opacity = '0';
    }, 400);
    
    // 애니메이션 끝나면 제거
    setTimeout(() => {
        iconClone.remove();
        // 장바구니 흔들기
        cartSection.style.animation = 'shake 0.4s ease';
        setTimeout(() => {
            cartSection.style.animation = '';
        }, 400);
    }, 900);
    
    // 토스트 알림
    showToast(icon);
}

// 토스트 알림 표시
function showToast(icon) {
    // 기존 토스트 제거
    const existingToast = document.querySelector('.toast');
    if (existingToast) {
        existingToast.remove();
    }
    
    const toast = document.createElement('div');
    toast.className = 'toast';
    toast.innerHTML = `${icon} 추가되었습니다!`;
    document.body.appendChild(toast);
    
    // 표시
    setTimeout(() => {
        toast.classList.add('show');
    }, 10);
    
    // 숨기기
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300);
    }, 1500);
}

// 장바구니 업데이트
function updateCart() {
    if (cart.length === 0) {
        cartItemsContainer.innerHTML = '<p class="empty-cart">메뉴를 선택해주세요</p>';
        return;
    }
    
    let html = '';
    
    cart.forEach(item => {
        html += `
            <div class="cart-item">
                <div class="cart-item-info">
                    <div class="cart-item-name">${item.icon} ${item.name}</div>
                    <div class="cart-item-controls">
                        <button class="btn-quantity" onclick="decreaseQuantity('${item.name}')">-</button>
                        <span class="cart-item-quantity">${item.quantity}</span>
                        <button class="btn-quantity" onclick="increaseQuantity('${item.name}')">+</button>
                    </div>
                </div>
                <button class="btn-remove" onclick="removeFromCart('${item.name}')">삭제</button>
            </div>
        `;
    });
    
    cartItemsContainer.innerHTML = html;
}

// 수량 증가
function increaseQuantity(menuName) {
    const item = cart.find(item => item.name === menuName);
    if (item) {
        item.quantity++;
        updateCart();
    }
}

// 수량 감소
function decreaseQuantity(menuName) {
    const item = cart.find(item => item.name === menuName);
    if (item) {
        if (item.quantity > 1) {
            item.quantity--;
            updateCart();
        } else {
            // 수량이 1일 때 감소하면 삭제
            removeFromCart(menuName);
        }
    }
}

// 장바구니에서 항목 제거
function removeFromCart(menuName) {
    cart = cart.filter(item => item.name !== menuName);
    updateCart();
}

// 주문하기
btnOrder.addEventListener('click', async () => {
    const userName = userNameInput.value.trim();
    const userType = userTypeSelect.value;
    
    if (!userName) {
        alert('주문자 이름을 입력해주세요! 😊');
        userNameInput.focus();
        return;
    }
    
    if (cart.length === 0) {
        alert('메뉴를 선택해주세요! ☕');
        return;
    }
    
    // 주문 데이터 생성
    const order = {
        userName: userName,
        userType: userType,
        items: cart,
        status: 'pending',
        timestamp: new Date().toISOString()
    };
    
    // Firebase에 저장
    const orderId = await saveOrder(order);
    
    // 주문 상태 페이지로 이동
    window.location.href = `order-status.html?orderId=${orderId}`;
});

// 주문 저장 (Firebase)
async function saveOrder(order) {
    try {
        // Firestore에 주문 저장
        const ordersCollection = collection(db, 'orders');
        const docRef = await addDoc(ordersCollection, order);
        console.log('주문이 Firebase에 저장되었습니다!');
        return docRef.id; // 주문 ID 반환
    } catch (error) {
        console.error('주문 저장 실패:', error);
        alert('주문 저장에 실패했습니다. 다시 시도해주세요.');
        throw error;
    }
}

// 폼 초기화
function resetForm() {
    cart = [];
    userNameInput.value = '';
    userTypeSelect.value = '교역자';
    updateCart();
}
