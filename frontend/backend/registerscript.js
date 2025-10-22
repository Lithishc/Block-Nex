import { auth, db } from "../../functions/firebase-config.js";
import { createUserWithEmailAndPassword, sendEmailVerification, updateProfile } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { doc, setDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const registerForm = document.getElementById('registerForm');
const errorMessage = document.getElementById('errorMessage');
const successMessage = document.getElementById('successMessage');

registerForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  errorMessage.textContent = "";
  successMessage.textContent = "";

  const name = document.getElementById('name').value.trim();
  const email = document.getElementById('email').value.trim();
  const password = document.getElementById('password').value;
  const confirmPassword = document.getElementById('confirmPassword').value;

  if (!name || !email || !password || !confirmPassword) {
    errorMessage.textContent = "Please fill in all fields.";
    return;
  }

  if (password !== confirmPassword) {
    errorMessage.textContent = "Passwords do not match.";
    return;
  }

  try {
    // Create user
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;

    // Update display name
    await updateProfile(user, { displayName: name });

    // Save user info to Firestore (optional)
    await setDoc(doc(db, "users", user.uid), {
      name: name,
      email: email,
      createdAt: new Date()
    });

    // Send email verification
    await sendEmailVerification(user);

    errorMessage.textContent = ""; // Clear any previous error
    successMessage.textContent = "Account created! Please check your email to verify your account.";
    registerForm.reset();
  } catch (error) {
    if (error.code === "auth/email-already-in-use") {
      errorMessage.textContent = "This email is already in use.";
    } else if (error.code === "auth/invalid-email") {
      errorMessage.textContent = "Invalid email address.";
    } else if (error.code === "auth/weak-password") {
      errorMessage.textContent = "Password should be at least 6 characters.";
    } else {
      errorMessage.textContent = error.message;
    }
  }
});