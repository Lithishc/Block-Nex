import { auth, db } from "../../functions/firebase-config.js";
import {
  doc, getDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import {
  onAuthStateChanged,updateEmail
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";

// DOM Elements
const form = document.getElementById("profile-form");
const inputs = {
  name: document.getElementById("name"),
  email: document.getElementById("email"),
  phone: document.getElementById("phone"),
  organization: document.getElementById("organization"),
  location: document.getElementById("location"),
  role: document.getElementById("role"),
};
const editBtn = document.getElementById("edit-btn");
const saveBtn = document.getElementById("save-btn");
const cancelBtn = document.getElementById("cancel-btn");

let uid = null;
let originalData = {};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Please login to view your profile.");
    window.location.href = "../frontend/login.html";
    return;
  }

  uid = user.uid;
  const profileRef = doc(db, "users", uid);
  const snap = await getDoc(profileRef);

  let profileData = {};
  if (snap.exists()) {
    profileData = snap.data();
  }

  // Always take email from Firebase Auth
  profileData.email = user.email;

  // Optional: save it to Firestore once if not present
  if (!snap.exists() || !snap.data().email) {
    await setDoc(profileRef, { email: user.email }, { merge: true });
  }

  originalData = profileData;
  fillForm(profileData);
});
// Fill form with data
function fillForm(data) {
  for (const key in inputs) {
    if (inputs[key]) inputs[key].value = data[key] || "";
  }
}

// Enable or disable fields
function toggleEdit(enable) {
  for (const key in inputs) {
    if (key !== "email") inputs[key].disabled = !enable;
  }
  editBtn.style.display = enable ? "none" : "inline-block";
  saveBtn.style.display = enable ? "inline-block" : "none";
  cancelBtn.style.display = enable ? "inline-block" : "none";
}

// Edit button
editBtn.addEventListener("click", () => toggleEdit(true));

// Cancel button
cancelBtn.addEventListener("click", () => {
  fillForm(originalData);
  toggleEdit(false);
});

// Save button (form submit)
form.addEventListener("submit", async (e) => {
  e.preventDefault();

  const data = {};
  for (const key in inputs) {
    data[key] = inputs[key].value;
  }

  try {
    // 1. Update email in Firebase Auth (if changed)
    const currentEmail = auth.currentUser.email;
    const newEmail = data.email;

    if (newEmail !== currentEmail) {
      try {
        await updateEmail(auth.currentUser, newEmail);
        console.log("Email updated in Firebase Auth.");
      } catch (emailErr) {
        console.error("Email update failed:", emailErr.message);

        // Common: needs re-authentication
        if (emailErr.code === "auth/requires-recent-login") {
          alert("Please log in again to change your email.");
        } else if (emailErr.code === "auth/email-already-in-use") {
          alert("This email is already used by another account.");
        } else {
          alert("Email update failed: " + emailErr.message);
        }

        return; // Cancel saving to Firestore if email update fails
      }
    }

    // 2. Save updated profile to Firestore (merge = avoid overwriting others)
    const profileRef = doc(db, "users", uid);
    await setDoc(profileRef, data, { merge: true });

    originalData = data;
    alert("Profile updated successfully!");
    toggleEdit(false);
  } catch (err) {
    console.error("Error saving profile:", err);
    alert("Failed to save profile. Please try again.");
  }
});

