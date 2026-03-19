// Firebase 설정 및 초기화
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js';
import { getFirestore, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc } from 'https://www.gstatic.com/firebasejs/10.7.1/firebase-firestore.js';

// Firebase 설정
const firebaseConfig = {
  apiKey: "AIzaSyDsWNA_Rf8PUPyVdtzhiI7hi_xogWaubME",
  authDomain: "pl-cafe-order.firebaseapp.com",
  projectId: "pl-cafe-order",
  storageBucket: "pl-cafe-order.firebasestorage.app",
  messagingSenderId: "469521788392",
  appId: "1:469521788392:web:f1f247a5016b87470dc85d",
  measurementId: "G-QNVW8G3JBD"
};

// Firebase 초기화
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// Firestore 함수들을 export
export { db, collection, addDoc, onSnapshot, query, orderBy, doc, updateDoc, deleteDoc };
