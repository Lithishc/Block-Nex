import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { collection, getDocs, doc, updateDoc, addDoc, query, where, getDoc, arrayUnion } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { createNotification } from "./notifications-helper.js";
import { showToast } from "./toast.js";
import { getSeasonalDemand } from "./chatgpt-helper.js";
import { getInventoryTrendPrediction } from "./ml-inventory-trend.js";

const tableBody = document.querySelector('#procurement-table tbody');

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Please login to access procurement.");
    window.location.href = "../index.html";
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

    // 1. ChatGPT Seasonal Demand
    let seasonalTag = "";
    try {
      const seasonal = await getSeasonalDemand(item.itemName);
      if (seasonal?.demand) {
        const recText = seasonal.recommendation || "Seasonal ↑";
        seasonalTag = `<span class="ai-tag seasonal-tag" title="${seasonal.reason}">${recText}</span>`;
      }
    } catch (e) {
      seasonalTag = "";
    }

    // 2. Local ML Trend
    let mlTag = "";
    try {
      const trend = await getInventoryTrendPrediction(uid, item.itemID);
      if (trend?.recommendation) {
        mlTag = `<span class="ai-tag ml-tag" title="${trend.reason}">${trend.recommendation}</span>`;
      }
    } catch (e) {
      mlTag = "";
    }

    // Render row with tags beside Request Qty
    tableBody.innerHTML += `
      <tr>
        <td>${item.itemID}</td>
        <td>${item.itemName}</td>
        <td>${item.quantity}</td>
        <td>
          <span class="toggle-switch" onclick="window.togglePreset('${itemDoc.id}', ${!item.presetMode})">
            <span class="toggle-track ${item.presetMode ? 'on' : ''}">
              <span class="toggle-knob"></span>
              <span class="toggle-label">${item.presetMode ? 'On' : 'Off'}</span>
            </span>
          </span>
        </td>
        <td>
          <input type="number" min="0" value="${item.presetQty || ""}" style="width:60px;" onchange="window.setPresetQty('${itemDoc.id}', this.value)">
        </td>
        <td>
          <input type="number" min="1" value="${requestQty || ""}" style="width:60px;" onchange="window.setRequestQty('${itemDoc.id}', this.value)">
          ${seasonalTag}
          ${mlTag}
        </td>
        <td>${item.requestStatus || "-"}</td>
        <td>${item.supplierOffers || "-"}</td>
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

  // Helpers
  const fmtPrice = (p) => {
    const n = Number(p);
    return isFinite(n) ? n.toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 2 }) : (p ?? "N/A");
  };
  const fmtDate = (ts) => {
    try {
      const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : null);
      return d ? d.toLocaleString() : "N/A";
    } catch {
      return "N/A";
    }
  };

  let html = `<h3>Supplier Offers</h3>`;
  if (offers.length === 0) {
    html += "<p>No offers yet.</p>";
  } else {
    offers.forEach((offer, idx) => {
      const payMethod = offer?.payment?.method || "N/A";
      const payTerms = offer?.payment?.terms || "N/A";
      const delMethod = offer?.delivery?.method || "N/A";
      const delDays = offer?.delivery?.days ?? "N/A";
      const location = offer?.location || "N/A";
      const createdAt = fmtDate(offer?.createdAt);

      html += `
        <div class="offer-card">
          <div class="offer-header">
            <span class="offer-label">Supplier:</span>
            <span class="offer-value">${offer.supplierName || "Unknown"}</span>
          </div>

          <div class="offer-row">
            <span class="offer-label">Location:</span>
            <span class="offer-value">${location}</span>
          </div>

          <div class="offer-row">
            <span class="offer-label">Price:</span>
            <span class="offer-value">${fmtPrice(offer.price)}</span>
          </div>

          <div class="offer-row">
            <span class="offer-label">Details:</span>
            <span class="offer-value">${offer.details || "-"}</span>
          </div>

          <div class="offer-row">
            <span class="offer-label">Payment Method:</span>
            <span class="offer-value">${payMethod}</span>
          </div>
          <div class="offer-row">
            <span class="offer-label">Payment Terms:</span>
            <span class="offer-value">${payTerms}</span>
          </div>

          <div class="offer-row">
            <span class="offer-label">Delivery Method:</span>
            <span class="offer-value">${delMethod}</span>
          </div>
          <div class="offer-row">
            <span class="offer-label">Delivery in (days):</span>
            <span class="offer-value">${delDays}</span>
          </div>

          <div class="offer-row">
            <span class="offer-label">Offered At:</span>
            <span class="offer-value">${createdAt}</span>
          </div>

          <div class="offer-actions">
            <button class="pill-btn accept" onclick="window.acceptOffer('${uid}','${globalProcurementId}','${userRequestId}',${idx})">Accept</button>
            <button class="pill-btn reject" onclick="window.rejectOffer('${uid}','${globalProcurementId}','${userRequestId}',${idx})">Reject</button>
          </div>
        </div>
      `;
    });
  }

  // Show in a popup
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

  // 1. Create global order FIRST and use its ID everywhere
  const globalOrderRef = await addDoc(collection(db, "globalOrders"), {
    dealerUid: uid,
    supplierUid: acceptedOffer.supplierUid,
    procurementId: userRequestId,
    globalProcurementId,
    offerId: acceptedOffer.offerId,
    itemID: reqData.itemID,
    itemName: reqData.itemName,
    quantity: reqData.requestedQty,
    supplier: acceptedOffer.supplierName,
    price: acceptedOffer.price,
    details: acceptedOffer.details,
    status: "ordered",
    tracking: [],
    createdAt: new Date()
  });
  const globalOrderId = globalOrderRef.id;

  // 2. Store reference in dealer's orders, using globalOrderId as the doc ID
  await setDoc(doc(db, "users", uid, "orders", globalOrderId), {
    globalOrderId,
    ...reqData,
    offerId: acceptedOffer.offerId,
    supplier: acceptedOffer.supplierName,
    price: acceptedOffer.price,
    details: acceptedOffer.details,
    status: "ordered",
    createdAt: new Date(),
    dealerUid: uid,
    supplierUid: acceptedOffer.supplierUid
  });

  // 3. Store reference in supplier's orderFulfilment, using globalOrderId as the doc ID
  if (acceptedOffer.supplierUid) {
    await setDoc(doc(db, "users", acceptedOffer.supplierUid, "orderFulfilment", globalOrderId), {
      globalOrderId,
      ...reqData,
      offerId: acceptedOffer.offerId,
      dealer: uid,
      price: acceptedOffer.price,
      details: acceptedOffer.details,
      status: "ordered",
      createdAt: new Date(),
      dealerUid: uid,
      supplierUid: acceptedOffer.supplierUid
    });
  }

  // 4. Update supplier's offer status in their offers collection
  if (acceptedOffer.supplierUid && acceptedOffer.offerId) {
    const supplierOfferRef = doc(db, "users", acceptedOffer.supplierUid, "offers", acceptedOffer.offerId);
    await updateDoc(supplierOfferRef, { status: "accepted", globalOrderId });
  }

  await createNotification(acceptedOffer.supplierUid, {
    type: "offer_accepted",
    title: "Offer Accepted",
    body: `Your offer for ${reqData.itemName} was accepted.`,
    related: { globalProcurementId, offerId: acceptedOffer.offerId, globalOrderId, itemID: reqData.itemID }
  });
  await createNotification(uid, {
    type: "order_created",
    title: "Order Created",
    body: `${acceptedOffer.supplierName} supplying ${reqData.itemName}.`,
    related: { globalProcurementId, offerId: acceptedOffer.offerId, globalOrderId, itemID: reqData.itemID }
  });
  showToast("Offer accepted & order created", "success");

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

  const rejected = offers[offerIdx];
  await createNotification(rejected.supplierUid, {
    type: "offer_rejected",
    title: "Offer Rejected",
    body: `Offer for ${globalData.itemName} was rejected.`,
    related: { globalProcurementId, offerId: rejected.offerId, itemID: globalData.itemID }
  });
  showToast("Offer rejected", "info");

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

