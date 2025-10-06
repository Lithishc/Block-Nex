// Import Firebase modules from your config and Firestore functions from CDN
import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { collection, addDoc, getDocs, doc, deleteDoc, updateDoc, getDoc, query, where } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { createNotification } from "./notifications-helper.js";
import { showToast } from "./toast.js";

// DOM Elements
const popup = document.getElementById('fluid-popup');
const form = document.getElementById('add-item-form-popup');
const tableBody = document.querySelector('#inventory-table tbody');
let editingId = null;

// Show popup on add button click
document.getElementById('show-add-popup').onclick = function() {
  popup.style.display = 'flex';
  form.reset();
  editingId = null;
  form.querySelector('button[type="submit"]').textContent = "Add Item";
};

// Hide popup on close
document.querySelector('.close-btn').onclick = function() {
  popup.style.display = 'none';
  form.reset();
  editingId = null;
  form.querySelector('button[type="submit"]').textContent = "Add Item";
};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Please login to access your inventory.");
    window.location.href = "../index.html";
    return;
  }
  loadInventory(user.uid);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const item = {
      itemID: document.getElementById('item-ID').value,
      itemName: document.getElementById('item-name').value,
      description: document.getElementById('item-desc').value,
      category: document.getElementById('item-category').value,
      quantity: document.getElementById('item-qty').value,
      price: document.getElementById('item-price').value,
      supplier: document.getElementById('item-supplier').value,
      location: document.getElementById('item-location').value,
    };

    if (editingId) {
      // Update existing item
      await updateDoc(doc(db, "users", user.uid, "inventory", editingId), item);
      editingId = null;
      form.querySelector('button[type="submit"]').textContent = "Add Item";
    } else {
      // Add new item
      await addDoc(collection(db, "users", user.uid, "inventory"), item);
      await recordInventoryHistory(user.uid, item.itemID, item.quantity);
    }
    form.reset();
    popup.style.display = 'none';
    loadInventory(user.uid);
  });
});

// Function to load inventory for a user
async function loadInventory(uid) {
  tableBody.innerHTML = "";
  const querySnapshot = await getDocs(collection(db, "users", uid, "inventory"));
  querySnapshot.forEach((docSnap) => {
    const item = docSnap.data();
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${item.itemID}</td>
      <td>${item.itemName}</td>
      <td>${item.description}</td>
      <td>${item.category}</td>
      <td>
        <input type="number" class="editable-input" value="${item.quantity}" data-id="${docSnap.id}" data-field="quantity">
      </td>
      <td>
        <input type="number" class="editable-input" value="${item.price}" data-id="${docSnap.id}" data-field="price">
      </td>
      <td>${item.supplier}</td>
      <td>${item.location}</td>
      <td>
        <button class="edit-btn" data-id="${docSnap.id}">Edit</button>
        <button class="delete-btn" data-id="${docSnap.id}">Delete</button>
      </td>
    `;
    tableBody.appendChild(row);
  });

  // Attach event listeners for edit and delete
  document.querySelectorAll('.edit-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      const id = this.getAttribute('data-id');
      const docRef = doc(db, "users", auth.currentUser.uid, "inventory", id);
      const docSnap = await getDoc(docRef);
      if (docSnap.exists()) {
        const itemData = docSnap.data();
        document.getElementById('item-ID').value = itemData.itemID || "";
        document.getElementById('item-name').value = itemData.itemName || "";
        document.getElementById('item-desc').value = itemData.description || "";
        document.getElementById('item-category').value = itemData.category || "";
        document.getElementById('item-qty').value = itemData.quantity || "";
        document.getElementById('item-price').value = itemData.price || "";
        document.getElementById('item-supplier').value = itemData.supplier || "";
        document.getElementById('item-location').value = itemData.location || "";
        editingId = id;
        form.querySelector('button[type="submit"]').textContent = "Update Item";
        popup.style.display = 'flex';
      }
    });
  });

  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', async function() {
      const id = this.getAttribute('data-id');
      if (confirm("Are you sure you want to delete this item?")) {
        const itemRef = doc(db, "users", auth.currentUser.uid, "inventory", id);
        const itemSnap = await getDoc(itemRef);
        if (itemSnap.exists()) {
          const item = itemSnap.data();
          await deleteDoc(itemRef);
          loadInventory(auth.currentUser.uid);
          await recordInventoryHistory(user.uid, item.itemID, 0);
        }
      }
    });
  });

  // Attach event listeners for editable quantity and price
  document.querySelectorAll('.editable-input').forEach(input => {
    input.addEventListener('change', async function() {
      const id = this.getAttribute('data-id');
      const field = this.getAttribute('data-field');
      let value = this.value;
      if (field === "quantity") value = Number(value);

      await updateDoc(doc(db, "users", auth.currentUser.uid, "inventory", id), { [field]: value });

      // --- AUTOMATION: Instantly create procurement request if needed ---
      if (field === "quantity") {
        const itemRef = doc(db, "users", auth.currentUser.uid, "inventory", id);
        const itemSnap = await getDoc(itemRef);
        if (!itemSnap.exists()) return;
        const item = itemSnap.data();
        const presetMode = item.presetMode || false;
        const presetQty = Number(item.presetQty) || 0;
        const requestQty = Number(item.requestQty) || 0;
        const quantity = Number(value) || 0;

        // Only automate if automation enabled, presetQty set, and quantity below presetQty
        if (presetMode && presetQty > 0 && quantity < presetQty) {
          // Check for existing open procurement request
          const reqQuery = query(
            collection(db, "users", auth.currentUser.uid, "procurementRequests"),
            where("itemID", "==", item.itemID),
            where("status", "==", "open")
          );
          const reqSnap = await getDocs(reqQuery);
          if (reqSnap.empty) {
            const qtyToRequest = requestQty > 0 ? requestQty : presetQty;

            // NEW: read dealer company/location from Supplier Details (info/{uid})
            let dealerCompanyName = "";
            let dealerAddress = "";
            let dealerLocation = "";
            try {
              const infoRef = doc(db, "info", auth.currentUser.uid);
              const infoSnap = await getDoc(infoRef);
              if (infoSnap.exists()) {
                const info = infoSnap.data();
                dealerCompanyName = info.companyName || "";
                dealerAddress = info.companyAddress || "";
                dealerLocation = info.location || "";
              }
            } catch (err) {
              console.warn("Supplier details not found:", err);
            }

            const requestData = {
              itemID: item.itemID,
              itemName: item.itemName,
              requestedQty: qtyToRequest,
              currentQty: quantity,
              status: "open",
              supplierResponses: [],
              userUid: auth.currentUser.uid,
              dealerCompanyName,
              dealerAddress,
              location: dealerLocation || dealerAddress || "",
              createdAt: new Date(),
              fulfilled: false
            };

            // Add to global procurementRequests for suppliers
            const globalReqRef = await addDoc(collection(db, "globalProcurementRequests"), requestData);
            await updateDoc(globalReqRef, { globalProcurementId: globalReqRef.id });

            // Add to user's procurementRequests, store globalProcurementId
            const userReqRef = await addDoc(
              collection(db, "users", auth.currentUser.uid, "procurementRequests"),
              { ...requestData, globalProcurementId: globalReqRef.id }
            );
            await updateDoc(userReqRef, { requestId: userReqRef.id });
            
            await createNotification(auth.currentUser.uid, {
              type: "procurement_created",
              title: "Procurement Request Created",
              body: `${requestData.itemName} • Qty ${requestData.requestedQty}`,
              related: { globalProcurementId: globalReqRef.id, itemID: requestData.itemID }
            });
            showToast("Procurement request created", "success");
          }
        }
      }
    });
  });
}

// --- NEW FUNCTION: Record inventory history ---
async function recordInventoryHistory(uid, itemID, quantity) {
  await addDoc(collection(db, "users", uid, "inventoryHistory"), {
    itemID,
    quantity: Number(quantity),
    timestamp: Date.now()
  });
}