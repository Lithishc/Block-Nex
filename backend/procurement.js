import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { collection, getDocs, doc, updateDoc, addDoc, query, where, getDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

const tableBody = document.querySelector('#procurement-table tbody');

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Please login to access procurement.");
    window.location.href = "../login.html";
    return;
  }
  loadInventoryForProcurement(user.uid);
});

async function loadInventoryForProcurement(uid) {
  tableBody.innerHTML = "";
  const inventorySnap = await getDocs(collection(db, "users", uid, "inventory"));
  for (const itemDoc of inventorySnap.docs) {
    const item = itemDoc.data();
    const presetMode = item.presetMode || false;
    const presetQty = Number(item.presetQty) || 0;
    const requestQty = Number(item.requestQty) || 0; // This is the user-set request quantity
    const quantity = Number(item.quantity) || 0;

    // Check if procurement request already exists for this item and is open
    let existingRequest = null;
    let offersHtml = "-";
    let requestStatus = "-";
    let requestId = null;
    let offerCount = 0;

    // Find the latest procurement request for this item
    const reqQuery = query(
      collection(db, "users", uid, "procurementRequests"),
      where("itemID", "==", item.itemID)
    );
    const reqSnap = await getDocs(reqQuery);

    let lastRequest = null;
    let lastglobalProcurementId = null;
    reqSnap.forEach(docRef => {
      const data = docRef.data();
      // Find the latest request (by createdAt)
      if (!lastRequest || (data.createdAt && data.createdAt > lastRequest.createdAt)) {
        lastRequest = data;
        requestId = docRef.id;
        lastglobalProcurementId = data.globalProcurementId;
        existingRequest = data.status === "open" ? data : existingRequest;
      }
    });

    

    if (existingRequest && Array.isArray(existingRequest.supplierResponses)) {
      // Only count non-rejected offers
      const nonRejectedOffers = existingRequest.supplierResponses.filter(
        offer => offer.status !== "rejected"
      );
      offerCount = nonRejectedOffers.length;
      if (offerCount > 0) {
        offersHtml = `
          <button onclick="window.viewOffers('${uid}','${lastglobalProcurementId}','${requestId}')">
            View Offers (${offerCount})
          </button>
        `;
        requestStatus = "Offers Received";
      } else {
        offersHtml = "No offers yet";
        requestStatus = "Requested";
      }
    } else if (existingRequest) {
      requestStatus = "Requested";
      offersHtml = "No offers yet";
    }

    tableBody.innerHTML += `
      <tr>
       <td>${item.itemID}</td>
        <td>${item.itemName}</td>
        <td>${item.quantity}</td>
        <td>
          <input type="checkbox" ${presetMode ? "checked" : ""} 
            onchange="window.togglePreset('${itemDoc.id}', this.checked)">
        </td>
        <td>
          <input type="number" min="1" value="${item.presetQty || ""}" style="width:60px;"
            onchange="window.setPresetQty('${itemDoc.id}', this.value)">
        </td>
        <td>
          <input type="number" min="1" value="${item.requestQty || ""}" style="width:60px;"
            onchange="window.setRequestQty('${itemDoc.id}', this.value)">
        </td>
        <td>${requestStatus}</td>
        <td>${offersHtml}</td>
      </tr>
    `;
  }
}

// popup or section to show offers
window.viewOffers = async (uid, globalProcurementId, userRequestId) => {
  // Always use global request for offers
  const reqRef = doc(db, "globalProcurementRequests", globalProcurementId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) return;
  const reqData = reqSnap.data();
  // Only show offers that are not rejected
  const offers = (reqData.supplierResponses || []).filter(offer => offer.status !== "rejected");
  let html = `<h3>Supplier Offers</h3>`;
  if (offers.length === 0) {
    html += "<p>No offers yet.</p>";
  } else {
    offers.forEach((offer, idx) => {
      html += `
        <div class="offer-card">
          <div class="offer-header">
            <span class="offer-label">Supplier Name:</span>
            <span class="offer-value">${offer.supplierName}</span>
          </div>
          <div class="offer-row">
            <span class="offer-label">Price:</span>
            <span class="offer-value">₹${offer.price}</span>
          </div>
          <div class="offer-row">
            <span class="offer-label">Details:</span>
            <span class="offer-value">${offer.details}</span>
          </div>
          <div class="offer-actions">
            <button class="pill-btn accept" onclick="window.acceptOffer('${uid}','${globalProcurementId}','${userRequestId}',${idx})">Accept</button>
            <button class="pill-btn reject" onclick="window.rejectOffer('${uid}','${globalProcurementId}','${userRequestId}',${idx})">Reject</button>
          </div>
        </div>
      `;
    });
  }
  // Show in a popup or a div (for demo, use alert or a simple div)
  let popup = document.getElementById('offers-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'offers-popup';
    popup.className = 'popup';
    popup.innerHTML = `
      <div class="popup-content">
        <button class="close-btn" onclick="document.getElementById('offers-popup').remove()">&times;</button>
        <div id="offers-content"></div>
      </div>
    `;
    document.body.appendChild(popup);
  }
  popup.querySelector('#offers-content').innerHTML = html;
  popup.style.display = 'flex';
};


// Accept supplier offer and create order for both dealer and supplier
window.acceptOffer = async (uid, globalProcurementId, userRequestId, offerIdx) => {
  // Get the accepted offer from global
  const globalReqRef = doc(db, "globalProcurementRequests", globalProcurementId);
  const globalReqSnap = await getDoc(globalReqRef);
  if (!globalReqSnap.exists()) return;
  const reqData = globalReqSnap.data();
  const offers = reqData.supplierResponses || [];
  
  // Update offer statuses
  const updatedOffers = offers.map((offer, idx) => ({
    ...offer,
    status: idx === offerIdx ? "accepted" : "rejected"
  }));
  const acceptedOffer = updatedOffers[offerIdx];

  // Update status in global request
  await updateDoc(globalReqRef, {
    status: "ordered",
    acceptedOffer,
    accepted: true,
    supplierResponses: updatedOffers
  });

  // Update user's procurementRequests
  const userReqRef = doc(db, "users", uid, "procurementRequests", userRequestId);
  await updateDoc(userReqRef, {
    status: "ordered",
    acceptedOffer,
    accepted: true,
    supplierResponses: updatedOffers
  });

  // Add order for dealer (include offerId)
  await addDoc(collection(db, "users", uid, "orders"), {
    procurementId: userRequestId,
    globalProcurementId,
    offerId: acceptedOffer.offerId,
    orderID: reqData.itemID,
    itemName: reqData.itemName,
    quantity: reqData.requestedQty,
    supplier: acceptedOffer.supplierName,
    price: acceptedOffer.price,
    details: acceptedOffer.details,
    status: "ordered",
    createdAt: new Date()
  });

  // Add order for supplier (if supplierUid is present, include offerId)
  if (acceptedOffer.supplierUid) {
    await addDoc(collection(db, "users", acceptedOffer.supplierUid, "orders"), {
      globalProcurementId,
      offerId: acceptedOffer.offerId,
      itemID: reqData.itemID,
      itemName: reqData.itemName,
      quantity: reqData.requestedQty,
      dealer: uid,
      price: acceptedOffer.price,
      details: acceptedOffer.details,
      status: "accepted",
      createdAt: new Date()
    });
  }

  // Update supplier's offer status in their offers collection
  if (acceptedOffer.supplierUid && acceptedOffer.offerId) {
    const supplierOfferRef = doc(db, "users", acceptedOffer.supplierUid, "offers", acceptedOffer.offerId);
    await updateDoc(supplierOfferRef, { status: "accepted" });
  }

  alert("Offer accepted and order created!");
  document.getElementById('offers-popup').remove();
  loadInventoryForProcurement(uid);
};

// Reject supplier offer
window.rejectOffer = async (uid, globalProcurementId, userRequestId, offerIdx) => {
  // Update global procurementRequests
  const globalReqRef = doc(db, "globalProcurementRequests", globalProcurementId);
  const globalReqSnap = await getDoc(globalReqRef);
  if (!globalReqSnap.exists()) return;
  const globalData = globalReqSnap.data();
  const offers = globalData.supplierResponses || [];
  offers[offerIdx] = { ...offers[offerIdx], status: "rejected" };
  await updateDoc(globalReqRef, { supplierResponses: offers });

  // Also update the user's procurementRequests
  const userReqRef = doc(db, "users", uid, "procurementRequests", userRequestId);
  const userReqSnap = await getDoc(userReqRef);
  if (userReqSnap.exists()) {
    const userData = userReqSnap.data();
    const userOffers = Array.isArray(userData.supplierResponses) ? [...userData.supplierResponses] : [];
    userOffers[offerIdx] = { ...userOffers[offerIdx], status: "rejected" };
    await updateDoc(userReqRef, { supplierResponses: userOffers });
  }

  // Also update the supplier's offer status in their offers collection
  const globalOffer = offers[offerIdx];
  if (globalOffer.supplierUid && globalOffer.offerId) {
    const supplierOfferRef = doc(db, "users", globalOffer.supplierUid, "offers", globalOffer.offerId);
    await updateDoc(supplierOfferRef, { status: "rejected" });
  }

  alert("Offer rejected.");
  document.getElementById('offers-popup').remove();
  loadInventoryForProcurement(uid);
};

window.togglePreset = async (itemDocId, checked) => {
  const user = auth.currentUser;
  if (!user) return;
  const itemRef = doc(db, "users", user.uid, "inventory", itemDocId);
  await updateDoc(itemRef, { presetMode: checked });
  loadInventoryForProcurement(user.uid);
};

window.setPresetQty = async (itemDocId, qty) => {
  const user = auth.currentUser;
  if (!user) return;
  const itemRef = doc(db, "users", user.uid, "inventory", itemDocId);
  await updateDoc(itemRef, { presetQty: qty });
  loadInventoryForProcurement(user.uid);
};

// Save request quantity to Firestore
window.setRequestQty = async (itemDocId, qty) => {
  const user = auth.currentUser;
  if (!user) return;
  const itemRef = doc(db, "users", user.uid, "inventory", itemDocId);
  await updateDoc(itemRef, { requestQty: Number(qty) });
  loadInventoryForProcurement(user.uid);
};

