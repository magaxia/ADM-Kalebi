import { initializeApp, getApps, getApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAcVPgUHbL4N9U1-H68klmGKWQF-YGleyc",
  authDomain: "vastbitloud-2872a.firebaseapp.com",
  projectId: "vastbitloud-2872a",
  storageBucket: "vastbitloud-2872a.firebasestorage.app",
  messagingSenderId: "952931184412",
  appId: "1:952931184412:web:ee2a0e38826c30dd0cd4d9",
  measurementId: "G-KWVQ0CFHW2"
};

const app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
export const auth = getAuth(app);
export const db = getFirestore(app);

console.log("[VIP5] Firebase inicializado. Projeto:", firebaseConfig.projectId);
