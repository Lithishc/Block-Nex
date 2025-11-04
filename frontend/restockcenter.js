import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { collection, getDocs, doc, updateDoc, addDoc, query, where, getDoc, arrayUnion, setDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { createNotification } from "./notifications-helper.js";
import { showToast } from "./toast.js";
// FIX: frontend helper modules live under ./frontend/functions
import { getSeasonalDemand, getMarketDemand } from "./chatgpt-helper.js";
import { getInventoryTrendPrediction } from "./ml-inventory-trend.js";
import { generateStandardId } from "./id-utils.js";
// Removed: import { acceptRestockOnChain } from "./functions/blockchain.js";

const tableBody = document.querySelector('#procurement-table tbody');

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Please login to access procurement.");
    window.location.href = "./index.html";
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
    const itemNameCell = row.cells[1];
    if (!itemNameCell) return;
    const itemName = itemNameCell.textContent.trim();
    if (!itemName) return;

    const requestQtyCell = row.cells[5];
    if (!requestQtyCell) return;

    Array.from(requestQtyCell.querySelectorAll('.tag, .ai-demand-tag')).forEach(tag => tag.remove());

    // Fetch seasonal + market in parallel
    let seasonal, market;
    try {
      [seasonal, market] = await Promise.all([
        getSeasonalDemand(itemName),
        getMarketDemand(itemName)
      ]);
    } catch {}

    const showSeasonal = seasonal?.demand === true;
    const showMarket = market?.demand === true;

    // Only render when in demand/trending
    if (!showSeasonal && !showMarket) return;

    const aiTag = document.createElement('span');
    aiTag.className = 'ai-demand-tag';
    aiTag.style.marginLeft = '8px';
    aiTag.style.fontWeight = 'bold';
    aiTag.style.cursor = 'help';

    if (showSeasonal) {
      aiTag.textContent = "Increase";
      aiTag.title = seasonal?.reason || "";
      aiTag.style.color = "#1db954";
    } else {
      aiTag.textContent = "Trending";
      aiTag.title = market?.reason || "";
      aiTag.style.color = "#1db954";
    }

    requestQtyCell.appendChild(aiTag);
  }));
}

// Wait for DOM and table to be populated, then annotate
window.addEventListener('DOMContentLoaded', () => {
  setTimeout(annotateAIDemandTags, 600);
});

// popup with offers
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
              <button class="pill-btn accept"
                      onclick="this.disabled=true; window.acceptOffer('${uid}','${globalProcurementId}','${userRequestId}',${idx})"
                      style="background:#0b5ea8;color:#fff;border:none;padding:10px 16px;border-radius:24px;cursor:pointer;">Accept</button>
              <button class="pill-btn reject"
                      onclick="this.disabled=true; window.rejectOffer('${uid}','${globalProcurementId}','${userRequestId}',${idx})"
                      style="background:#d9534f;color:#fff;border:none;padding:10px 16px;border-radius:24px;cursor:pointer;">Reject</button>
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
        <button class="close-btn" onclick="document.getElementById('offers-popup').remove()" ">&times;</button>
        <div id="offers-content"></div>
      </div>
    `;
    document.body.appendChild(popup);
  }
  popup.querySelector('#offers-content').innerHTML = html;
  popup.style.display = 'flex';
};


// Accept supplier offer, confirm on-chain, and create order docs (same schema as before)
window.acceptOffer = async (uid, globalProcurementId, userRequestId, offerIdx) => {
  try {
    // Load user's request for details
    const userReqRef = doc(db, "users", uid, "procurementRequests", userRequestId);
    const userReqSnap = await getDoc(userReqRef);
    if (!userReqSnap.exists()) throw new Error("Request not found");
    const userReq = userReqSnap.data();

    // Idempotency
    if ((userReq.status === "ordered") && userReq.globalOrderId) {
      showToast(`Already ordered: ${userReq.globalOrderId}`, "info");
      return;
    }

    // Load global request (source of truth)
    const globalReqRef = doc(db, "globalProcurementRequests", globalProcurementId);
    const globalReqSnap = await getDoc(globalReqRef);
    if (!globalReqSnap.exists()) throw new Error("Global request not found");
    const globalReq = globalReqSnap.data();
    if (globalReq.status === "ordered" || globalReq.accepted) {
      showToast("An offer was already accepted for this request", "info");
      return;
    }

    const offer = (globalReq.supplierResponses || [])[offerIdx];
    if (!offer) throw new Error("Offer not found");

    // On-chain accept
    const procurementId = Number((userReq.blockchain || globalReq.blockchain || {}).procurementId || 0);
    const offerIdOnChain = Number((offer.blockchain || {}).offerId || 0);
    if (!procurementId || !offerIdOnChain) throw new Error("Missing blockchain IDs");

    const r = await fetch("http://localhost:3000/api/bc/offers/accept?fast=1", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ procurementId, offerId: offerIdOnChain, fast: 1 })
    });
    const j = await r.json();
    if (!r.ok || !j.txHash) throw new Error(j.error || "Blockchain accept failed");

    // Mark accepted + reject others
    const updatedOffers = (globalReq.supplierResponses || []).map((o, i) =>
      i === offerIdx
        ? { ...o, status: "accepted", blockchain: { ...(o.blockchain || {}), acceptTx: j.txHash, network: "sepolia" } }
        : { ...o, status: (o.status === "rejected" ? "rejected" : "rejected") }
    );
    const acceptedOffer = updatedOffers[offerIdx];

    await updateDoc(globalReqRef, {
      status: "ordered",
      accepted: true,
      acceptedOfferIdx: offerIdx,
      acceptedOffer,
      supplierResponses: updatedOffers,
      orderedAt: new Date()
    });
    await updateDoc(userReqRef, {
      status: "ordered",
      accepted: true,
      acceptedOfferIdx: offerIdx,
      supplierResponses: updatedOffers,
      orderedAt: new Date(),
      blockchain: { ...(userReq.blockchain || {}), procurementId }
    });

    // Build order (schema used by offers.js/order.js)
    const orderId = generateStandardId("order");
    const qty = Number(userReq.requestedQty || userReq.presetQty || 0);
    const priceNum = Number(acceptedOffer.price || 0);

    // GSTINs (best effort)
    let dealerGSTIN = "";
    try { const inf = await getDoc(doc(db, "info", uid)); dealerGSTIN = inf.exists() ? (inf.data().gstNumber || "") : ""; } catch {}
    let supplierGSTIN = "";
    try {
      if (acceptedOffer.supplierUid) {
        const inf2 = await getDoc(doc(db, "info", acceptedOffer.supplierUid));
        supplierGSTIN = inf2.exists() ? (inf2.data().gstNumber || "") : "";
      }
    } catch {}

    const orderDoc = {
      // IDs
      globalOrderId: orderId,
      procurementId: userRequestId,                     // FIX: was userReqId (undefined)
      globalProcurementId,
      offerId: acceptedOffer.offerId || null,

      // Parties
      dealerUid: uid,
      supplierUid: acceptedOffer.supplierUid || null,

      // Business fields (for UI/contract)
      itemID: globalReq.itemID,
      itemName: globalReq.itemName,
      quantity: qty,
      supplier: acceptedOffer.supplierName || "",
      price: priceNum,
      details: acceptedOffer.details || "",
      payment: acceptedOffer.payment || null,
      delivery: acceptedOffer.delivery || null,
      status: "ordered",
      tracking: [],
      createdAt: new Date(),

      // Contract/signatures
      dealerGSTIN,
      supplierGSTIN,
      contractSignatures: {},

      // Compatibility
      acceptedOffer: {
        supplierUid: acceptedOffer.supplierUid || null,
        offerId: acceptedOffer.offerId || null,
        price: priceNum,
        details: acceptedOffer.details || ""
      },

      // Blockchain refs
      blockchain: {
        network: "sepolia",
        procurementId,
        offerId: offerIdOnChain,
        acceptTx: j.txHash
      }
    };

    // Persist: global + buyer + supplier
    await setDoc(doc(db, "globalOrders", orderId), orderDoc, { merge: true });
    await setDoc(doc(db, "users", uid, "orders", orderId), { ...orderDoc, role: "buyer" }, { merge: true });
    if (acceptedOffer.supplierUid) {
      await setDoc(doc(db, "users", acceptedOffer.supplierUid, "orders", orderId), { ...orderDoc, role: "supplier" }, { merge: true });
      await setDoc(doc(db, "users", acceptedOffer.supplierUid, "orderFulfilment", orderId), { ...orderDoc, role: "supplier" }, { merge: true });
    }

    // Back-links
    await updateDoc(globalReqRef, { globalOrderId: orderId });
    await updateDoc(userReqRef, { globalOrderId: orderId, orderId });

    // Supplier offer doc
    if (acceptedOffer.supplierUid && acceptedOffer.offerId) {
      await updateDoc(doc(db, "users", acceptedOffer.supplierUid, "offers", acceptedOffer.offerId), {
        status: "accepted",
        globalOrderId: orderId,
        blockchain: { ...(acceptedOffer.blockchain || {}), acceptTx: j.txHash, network: "sepolia" }
      });
    }

    // Notifications
    await createNotification(acceptedOffer.supplierUid, {
      type: "offer_accepted",
      title: "Offer Accepted",
      body: `Your offer for ${globalReq.itemName} was accepted.`,
      related: { globalProcurementId, offerId: acceptedOffer.offerId, globalOrderId: orderId, itemID: globalReq.itemID }
    });
    await createNotification(uid, {
      type: "order_created",
      title: "Order Created",
      body: `${acceptedOffer.supplierName} supplying ${globalReq.itemName}.`,
      related: { globalProcurementId, offerId: acceptedOffer.offerId, globalOrderId: orderId, itemID: globalReq.itemID }
    });

    showToast("Offer accepted on‑chain and order created", "success");
    const popup = document.getElementById('offers-popup');
    if (popup) popup.remove();
    loadInventoryForProcurement(uid);
  } catch (e) {
    console.error(e);
    showToast(e.message || "Failed to accept", "error");
  }
};

// Minimal helper remains
async function acceptRestock(restockId, acceptedByUid) {
  try {
    await updateDoc(doc(db, "globalProcurementRequests", String(restockId)), {
      acceptedBy: acceptedByUid,
      acceptedAt: new Date()
    });
  } catch {}
}

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

