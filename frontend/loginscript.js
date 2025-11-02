import { auth } from "./firebase-config.js";
import { signInWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { getFirestore, doc, getDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

console.log("loginscript.js loaded");

// Initialize Firestore
const db = getFirestore();

// DOM Elements
const loginForm = document.getElementById("loginForm");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const errorMessage = document.getElementById("errorMessage");
const forgotPasswordLink = document.getElementById("forgotPassword");
const createAccountLink = document.getElementById("createAccount");

// Handle Login
loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const email = emailInput.value.trim();
    const password = passwordInput.value.trim();

    if (!email || !password) {
        errorMessage.textContent = "Please enter both email and password.";
        return;
    }

    try {
        const userCredential = await signInWithEmailAndPassword(auth, email, password);
        const user = userCredential.user;
        console.log("Login Successful:", user);

        // Optional: Fetch user data if needed
        const userDoc = await getDoc(doc(db, "users", user.uid));
        if (!userDoc.exists()) {
            errorMessage.textContent = "User not found in database!";
            return;
        }

        // Redirect all users to the same dashboard
        window.location.href = "./dashboard.html";
    } catch (error) {
        errorMessage.textContent = "Invalid email or password.";
        console.error("Login error:", error);
    }
});

// Handle Password Reset
forgotPasswordLink.addEventListener("click", async (e) => {
    e.preventDefault();
    
    const email = prompt("Enter your email to reset password:");
    if (email) {
        try {
            await sendPasswordResetEmail(auth, email);
            alert("Password reset email sent! Check your inbox.");
        } catch (error) {
            alert("Error sending reset email. Make sure your email is correct.");
            console.error("Password reset error:", error);
        }
    }
});

// Redirect to Register Page
createAccountLink.addEventListener("click", (e) => {
    e.preventDefault();
    window.location.href = "./registry.html";
});

