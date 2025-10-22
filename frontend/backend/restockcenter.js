import { auth, db } from "../../functions/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { collection, getDocs, doc, updateDoc, addDoc, query, where, getDoc, arrayUnion, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { createNotification } from "./notifications-helper.js";
import { showToast } from "./toast.js";
import { getSeasonalDemand } from "../../functions/chatgpt-helper.js";
import { getInventoryTrendPrediction } from "../../functions/ml-inventory-trend.js";
import { generateStandardId } from "./id-utils.js";

const tableBody = document.querySelector('#procurement-table tbody');

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Please login to access procurement.");
    window.location.href = "../frontend/index.html";
    return;
  }
  loadInventoryForProcurement(user.uid);
});

async function loadInventoryForProcurement(uid) {
  tableBody.innerHTML = "";
  const inventorySnap = await getDocs(collection(db, "users", uid, "inventory"));
  const items = [];
  for (const itemDoc of inventorySnap.docs) {
    const item = itemDoc.data();
    items.push({ item, itemDocId: itemDoc.id });
  }

  // Render all rows first, with placeholders for tags
  for (const { item, itemDocId } of items) {
    const presetMode = item.presetMode || false;
    const presetQty = Number(item.presetQty) || 0;
    const requestQty = Number(item.requestQty) || 0; // This is the user-set request quantity
    const quantity = Number(item.quantity) || 0;

    // Placeholders for tags
    let seasonalTag = `<span class="tag seasonal" data-itemid="${item.itemID}">⏳</span>`;
    let mlTag = `<span class="tag ml" data-itemid="${item.itemID}">⏳</span>`;

    // Check if procurement request already exists for this item and is active (open/pending/ordered)
    let existingRequest = null;
    let offersHtml = "-";
    let requestStatus = "-";
    let userReqId = null;
    let globalPid = null;

    // Query for active requests for this item (block re-orders while active)
    const requestsSnap = await getDocs(query(
      collection(db, "users", uid, "procurementRequests"),
      where("itemID", "==", item.itemID),
      where("status", "in", ["open", "pending", "ordered"])
    ));
    if (!requestsSnap.empty) {
      // pick the most recent active request if multiple
      const sorted = requestsSnap.docs.sort((a,b) => {
        const A = a.data().createdAt?.toDate ? a.data().createdAt.toDate().getTime() : (a.data().createdAt?.seconds || 0);
        const B = b.data().createdAt?.toDate ? b.data().createdAt.toDate().getTime() : (b.data().createdAt?.seconds || 0);
        return B - A;
      });
      const reqDoc = sorted[0];
      existingRequest = reqDoc.data();
      userReqId = reqDoc.id;
      globalPid = existingRequest.globalProcurementId || null;
      requestStatus = existingRequest.status || requestStatus;

      // show order id if present for ordered status
      if (existingRequest.status === "ordered" && (existingRequest.globalOrderId || existingRequest.orderId)) {
        const oid = existingRequest.globalOrderId || existingRequest.orderId;
        requestStatus = `Ordered (${oid})`;
      }

      const nonRejected = (existingRequest.supplierResponses || []).filter(o => o?.status !== "rejected");
      const offerCount = nonRejected.length;
      if (offerCount > 0) {
        offersHtml = `<button onclick="window.viewOffers('${uid}','${globalPid}','${userReqId}')">View Offers (${offerCount})</button>`;
      } else {
        offersHtml = "No offers yet";
      }
    }

    // Get the last closed/completed request for info if no active request
    let lastRequest = null;
    if (!existingRequest) {
      const closedRequestsSnap = await getDocs(query(
        collection(db, "users", uid, "procurementRequests"),
        where("itemID", "==", item.itemID),
        where("status", "in", ["closed", "completed", "delivered"])
      ));
      if (!closedRequestsSnap.empty) {
        lastRequest = closedRequestsSnap.docs[closedRequestsSnap.docs.length - 1].data();
      }
    }

    // If we found a lastRequest but it's not active, show its status as info
    if (lastRequest && !existingRequest) {
      if (lastRequest.status === "completed" || lastRequest.status === "delivered" || lastRequest.status === "fulfilled") {
        const oid = lastRequest.globalOrderId || lastRequest.orderId || lastRequest.globalProcurementId || "N/A";
        requestStatus = `Completed (Order: ${oid})`;
        offersHtml = "-";
      } else {
        requestStatus = lastRequest.status || requestStatus;
        offersHtml = "No offers yet";
      }
    }

    // Render row with tags beside Request Qty
    tableBody.innerHTML += `
      <tr>
        <td>${item.itemID}</td>
        <td>${item.itemName}</td>
        <td>
          <div class="input-with-unit">
            <input type="number" value="${item.quantity}" placeholder="e.g. 100" style="width:80px;" disabled>
            <span class="unit">KG/Ltr</span>
          </div>
        </td>
        <td>
          <span class="toggle-switch" onclick="window.togglePreset('${itemDocId}', ${!item.presetMode})">
            <span class="toggle-track ${item.presetMode ? 'on' : ''}">
              <span class="toggle-knob"></span>
              <span class="toggle-label">${item.presetMode ? 'On' : 'Off'}</span>
            </span>
          </span>
        </td>
        <td>
          <div class="input-with-unit">
            <input type="number" min="0" value="${item.presetQty || ""}" placeholder="e.g. 50" style="width:80px;" onchange="window.setPresetQty('${itemDocId}', this.value)">
            <span class="unit">KG/Ltr</span>
          </div>
        </td>
        <td>
          <div class="input-with-unit">
            <input type="number" min="1" value="${requestQty || ""}" placeholder="e.g. 20" style="width:80px;" onchange="window.setRequestQty('${itemDocId}', this.value)">
            <span class="unit">KG/Ltr</span>
          </div>
          ${seasonalTag}
          ${mlTag}
        </td>
        <td>${requestStatus || "-"}</td>
        <td>${offersHtml || "-"}</td>
      </tr>
    `;
  }

  // After rendering, annotate with AI tags
  annotateAIDemandTags();
}

// --- AI Demand Tag beside Request Qty ---
async function annotateAIDemandTags() {
  const tableBody = document.querySelector('#procurement-table tbody');
  if (!tableBody) return;
  const rows = Array.from(tableBody.querySelectorAll('tr'));

  await Promise.all(rows.map(async (row) => {
    // Use item name (column index 1)
    const itemNameCell = row.cells[1];
    if (!itemNameCell) return;
    const itemName = itemNameCell.textContent.trim();
    if (!itemName) return;

    // Find the Request Qty cell (index 5)
    const requestQtyCell = row.cells[5];
    if (!requestQtyCell) return;

    // Remove any existing AI/ML tags
    Array.from(requestQtyCell.querySelectorAll('.tag, .ai-demand-tag')).forEach(tag => tag.remove());

    // Create the AI demand tag span
    let aiTag = document.createElement('span');
    aiTag.className = 'ai-demand-tag';
    aiTag.style.marginLeft = '8px';

    // Fetch AI demand
    try {
      const data = await getSeasonalDemand(itemName);
      if (data && typeof data.demand === "boolean") {
        aiTag.textContent = data.demand ? "Increase" : "Decrease";
        aiTag.title = data.reason || "";
        aiTag.style.color = data.demand ? "#1db954" : "#d9534f";
        aiTag.style.fontWeight = "bold";
        aiTag.style.cursor = "help";
        requestQtyCell.appendChild(aiTag);
      }
    } catch {
      // Do not show anything if error
    }
  }));
}

// Wait for DOM and table to be populated, then annotate
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(annotateAIDemandTags, 600);
});

// popup or section to show offers (restored old UI but keep new logic)
window.viewOffers = async (uid, globalProcurementId, userRequestId) => {
  const reqRef = doc(db, "globalProcurementRequests", globalProcurementId);
  const reqSnap = await getDoc(reqRef);
  if (!reqSnap.exists()) return;
  const reqData = reqSnap.data();

  // DO NOT filter out offers here — show all and display their status explicitly
  const offers = (reqData.supplierResponses || []);

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

  const currentStatus = reqData.status || "-";
  let html = `<h3>Supplier Offers</h3>`;
  if (!offers.length) {
    html += "<p>No offers yet.</p>";
  } else {
    offers.forEach((offer, idx) => {
      const status = (offer && offer.status) ? offer.status : "pending";
      const payMethod = offer?.payment?.method || "N/A";
      const payTerms = offer?.payment?.terms || "N/A";
      const delMethod = offer?.delivery?.method || "N/A";
      const delDays = offer?.delivery?.days ?? "N/A";
      const location = offer?.location || "N/A";
      const createdAt = fmtDate(offer?.createdAt);

      // determine if buttons should be shown: only when request not already ordered and offer is pending
      const canAct = currentStatus !== "ordered" && currentStatus !== "closed" && !reqData.accepted;
      const offerPending = status === "pending";

      // status badge
      const badge = status === "accepted" ? `<span class="status-badge accepted">Accepted</span>`
                    : status === "rejected" ? `<span class="status-badge rejected">Rejected</span>`
                    : `<span class="status-badge pending">Pending</span>`;

      html += `
        <div class="offer-card" style="background:#fff;border-radius:12px;padding:18px;margin:12px 0;box-shadow:0 6px 18px rgba(0,0,0,0.06);max-width:520px;">
          <div style="font-weight:700;margin-bottom:8px;">
            <span style="color:#000;">Supplier:</span>
            <span style="margin-left:8px;color:#222;">${offer.supplierName || "Unknown"}</span>
            <span style="float:right;">${badge}</span>
          </div>

          <div style="margin-bottom:6px;"><strong>Location:</strong> ${location}</div>
          <div style="margin-bottom:6px;"><strong>Price:</strong> ${fmtPrice(offer.price)}</div>
          <div style="margin-bottom:6px;"><strong>Details:</strong> ${offer.details || "-"}</div>
          <div style="margin-bottom:6px;"><strong>Payment Method:</strong> ${payMethod}</div>
          <div style="margin-bottom:6px;"><strong>Payment Terms:</strong> ${payTerms}</div>
          <div style="margin-bottom:6px;"><strong>Delivery Method:</strong> ${delMethod}</div>
          <div style="margin-bottom:6px;"><strong>Delivery in (days):</strong> ${delDays}</div>
          <div style="margin-bottom:10px;"><strong>Offered At:</strong> ${createdAt}</div>

          <div style="display:flex;gap:12px;margin-top:10px;">
            ${ (canAct && offerPending) ? `
              <button class="pill-btn accept" onclick="this.disabled=true; window.acceptOffer('${uid}','${globalProcurementId}','${userRequestId}',${idx})" style="background:#0b5ea8;color:#fff;border:none;padding:10px 16px;border-radius:24px;cursor:pointer;">Accept</button>
              <button class="pill-btn reject" onclick="this.disabled=true; window.rejectOffer('${uid}','${globalProcurementId}','${userRequestId}',${idx})" style="background:#d9534f;color:#fff;border:none;padding:10px 16px;border-radius:24px;cursor:pointer;">Reject</button>
            ` : (status === "accepted" ? `<button disabled style="padding:10px 16px;border-radius:24px;background:#6aa84f;color:#fff;border:none;">Accepted</button>` :
                 status === "rejected" ? `<button disabled style="padding:10px 16px;border-radius:24px;background:#aaa;color:#fff;border:none;">Rejected</button>` :
                 `<button disabled style="padding:10px 16px;border-radius:24px;background:#ccc;color:#fff;border:none;">${currentStatus}</button>`)
            }
          </div>
        </div>
      `;
    });
  }

  let popup = document.getElementById('offers-popup');
  if (!popup) {
    popup = document.createElement('div');
    popup.id = 'offers-popup';
    popup.className = 'popup';
    popup.innerHTML = `
      <div class="popup-content" style="position:relative;max-width:640px;padding:22px;border-radius:16px;">
        <button class="close-btn" onclick="document.getElementById('offers-popup').remove()" style="position:absolute;right:14px;top:12px;border:none;background:#e9eef5;width:36px;height:36px;border-radius:50%;cursor:pointer;">✕</button>
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
  const globalReqRef = doc(db, "globalProcurementRequests", globalProcurementId);
  const globalReqSnap = await getDoc(globalReqRef);
  if (!globalReqSnap.exists()) return;
  const currentGlobal = globalReqSnap.data();

  // Guard: prevent double-accept / duplicate orders
  if (currentGlobal.status === "ordered" || currentGlobal.accepted) {
    showToast("An offer was already accepted for this request", "info");
    return;
  }

  const reqData = currentGlobal;
  const offers = reqData.supplierResponses || [];
  if (!offers[offerIdx]) {
    showToast("Offer not found", "error");
    return;
  }

  // Update offer statuses
  const updatedOffers = offers.map((offer, idx) => ({
    ...offer,
    status: idx === offerIdx ? "accepted" : (offer.status === "rejected" ? "rejected" : "rejected")
  }));
  const acceptedOffer = updatedOffers[offerIdx];

  // Update status in global request (mark ordered first to prevent races)
  await updateDoc(globalReqRef, {
    status: "ordered",
    acceptedOffer,
    accepted: true,
    supplierResponses: updatedOffers,
    orderedAt: new Date()
  });

  // Update user's procurementRequests (mark ordered)
  if (userRequestId) {
    const userReqRef = doc(db, "users", uid, "procurementRequests", userRequestId);
    await updateDoc(userReqRef, {
      status: "ordered",
      acceptedOffer,
      accepted: true,
      supplierResponses: updatedOffers,
      orderedAt: new Date()
    });
  }

  // Create global order and write its id back (use friendly id)
  const newOrderId = generateStandardId("order");
  await setDoc(doc(db, "globalOrders", newOrderId), {
    globalOrderId: newOrderId,
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
  const globalOrderId = newOrderId;

  // store globalOrderId into global request and user request so UI can show it
  await updateDoc(globalReqRef, { globalOrderId });
  if (userRequestId) await updateDoc(doc(db, "users", uid, "procurementRequests", userRequestId), { globalOrderId, orderId: globalOrderId });

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

  // ensure supplier offer doc is updated to accepted and has globalOrderId
  if (acceptedOffer.supplierUid && acceptedOffer.offerId) {
    const supplierOfferRef = doc(db, "users", acceptedOffer.supplierUid, "offers", acceptedOffer.offerId);
    await updateDoc(supplierOfferRef, { status: "accepted", globalOrderId });
  }

  // notifications & UI update
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

  // close popup and reload
  const popup = document.getElementById('offers-popup');
  if (popup) popup.remove();
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

