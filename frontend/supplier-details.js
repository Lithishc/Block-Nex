import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { app } from "./firebase-config.js";

const auth = getAuth(app);
const db = getFirestore(app);

const form = document.getElementById('supplier-form');
const infoDiv = document.getElementById('supplier-info');

let currentUid = null;
let isEditing = false;

// Load supplier details if logged in
onAuthStateChanged(auth, async (user) => {
  if (user) {
    currentUid = user.uid;
    const docRef = doc(db, "info", currentUid);
    const docSnap = await getDoc(docRef);
    if (docSnap.exists()) {
      showSupplierInfo(docSnap.data());
      fillForm(docSnap.data());
      setFormDisabled(true);
      showEditButton();
    } else {
      setFormDisabled(false);
      showUpdateButton("Save Details");
    }
  }
});

function setFormDisabled(disabled) {
  Array.from(form.elements).forEach(el => {
    if (el.type !== "button" && el.type !== "submit") el.disabled = disabled;
  });
}

function showEditButton() {
  removeFormButtons();
  const editBtn = document.createElement("button");
  editBtn.type = "button";
  editBtn.className = "pill-btn";
  editBtn.textContent = "Edit";
  editBtn.onclick = () => {
    setFormDisabled(false);
    showUpdateButton("Update Details");
    isEditing = true;
  };
  form.appendChild(editBtn);
}

function showUpdateButton(text) {
  removeFormButtons();
  const updateBtn = document.createElement("button");
  updateBtn.type = "submit";
  updateBtn.className = "pill-btn";
  updateBtn.textContent = text;
  form.appendChild(updateBtn);
}

function removeFormButtons() {
  Array.from(form.querySelectorAll(".pill-btn")).forEach(btn => btn.remove());
}

// Save/Update supplier details
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!currentUid) return;
  const data = Object.fromEntries(new FormData(form).entries());
  await setDoc(doc(db, "info", currentUid), data);
  showSupplierInfo(data);
  setFormDisabled(true);
  showEditButton();
  isEditing = false;
});

function showSupplierInfo(data) {
  infoDiv.innerHTML = `
    <h3>Saved Supplier Details</h3>
    <ul>
      <li><strong>Company Name:</strong> ${data.companyName}</li>
      <li><strong>Contact Person:</strong> ${data.contactPerson}</li>
      <li><strong>Contact Number:</strong> ${data.contactNumber}</li>
      <li><strong>Email:</strong> ${data.email}</li>
      <li><strong>Company Address:</strong> ${data.companyAddress}</li>
      <li><strong>GST / Tax ID:</strong> ${data.gstNumber}</li>
      <li><strong>Business Registration Number:</strong> ${data.registrationNumber}</li>
      <li><strong>Industry Category:</strong> ${data.industryCategory}</li>
    </ul>
  `;
}

function fillForm(data) {
  for (const key in data) {
    if (form[key]) form[key].value = data[key];
  }
}