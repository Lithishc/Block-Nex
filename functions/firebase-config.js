import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-app.js";
import { getAuth, createUserWithEmailAndPassword } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { getFirestore, doc, setDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { getAnalytics } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-analytics.js";
export { app };
// Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyBOD0KPqIsu5YFc3Xh2vOADYC_Gjkr6y88",
  authDomain: "smartsupplychain-86c30.firebaseapp.com",
  projectId: "smartsupplychain-86c30",
  storageBucket: "smartsupplychain-86c30.firebasestorage.app",
  messagingSenderId: "603011149038",
  appId: "1:603011149038:web:8365a389e553d8bce497ff",
  measurementId: "G-CF1HMZQVH4"
};

const app = initializeApp(firebaseConfig);
const analytics = getAnalytics(app);
export const auth = getAuth(app);
export const db = getFirestore(app);