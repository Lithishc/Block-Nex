import { db } from "./firebase-config.js";
import {
  collection, getDocs, doc, updateDoc, arrayUnion, getDoc, query, where, addDoc, setDoc
} from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { getAuth, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { createNotification } from "./notifications-helper.js";
import { showToast } from "./toast.js";
import { generateStandardId } from "./id-utils.js";

const auth = getAuth();

let prefill = { name: "", location: "" };

async function getInventoryItems(uid) {
  const invSnap = await getDocs(collection(db, "users", uid, "inventory"));
  const items = {};
  invSnap.forEach(docSnap => {
    const d = docSnap.data();
    items[d.itemName?.toLowerCase()] = d.quantity;
  });
  return items;
}

// --- ChatGPT API call for seasonal demand ---
// Return null on any failure instead of letting errors bubble up.
async function getSeasonalDemand(itemName) {
  try {
    const response = await fetch(`http://localhost:3000/api/chatgpt-seasonal-demand?item=${encodeURIComponent(itemName)}`, { cache: "no-store" });
    if (!response.ok) return null;
    return await response.json();
  } catch (err) {
    // service offline or network error -> return null so UI remains functional
    console.warn("Seasonal demand fetch failed:", err);
    return null;
  }
}

async function loadOpenRequests(supplierUid) {
  const marketplaceList = document.querySelector('.marketplace-list');
  if (!marketplaceList) return;
  marketplaceList.innerHTML = "";

  const inventory = await getInventoryItems(supplierUid);

  const reqSnap = await getDocs(collection(db, "globalProcurementRequests"));

  // Render requests immediately (no await on ChatGPT). Then asynchronously
  // enrich cards with seasonal tag if API is available.
  for (const docSnap of reqSnap.docs) {
    const req = docSnap.data();
    if (req.status === "open" && req.userUid !== supplierUid) {
      const dealerName =
        req.dealerCompanyName ||
        req.companyName ||
        req.requesterCompanyName ||
        req.dealerName ||
        req.name ||
        req.username ||
        (req.userUid ? `User ${req.userUid.slice(0, 6)}` : "Unknown Dealer");

      const locAddr = [
        req.location,
        req.dealerAddress,
        req.companyAddress,
        req.address
      ].filter(v => v && String(v).trim().length).join(", ") || "N/A";

      // Recommendation tag (computed from supplier inventory) — add immediately
      let recTagHtml = "";
      let recReason = "";
      const invQty = inventory[req.itemName?.toLowerCase()];
      if (invQty && invQty >= req.requestedQty) {
        recTagHtml = `<span class="rec-tag" title="You have ${invQty} units in inventory. Recommended to sell.">Recommended to Sell</span>`;
        recReason = `You have ${invQty} units of ${req.itemName} in inventory. Market demand is high.`;
        // Send notification (once per request)
        await createNotification(supplierUid, {
          type: "recommendation",
          title: "Sell Recommendation",
          body: recReason,
          related: { globalProcurementId: docSnap.id, itemID: req.itemID }
        });
      }

      // Build card DOM and append immediately
      const card = document.createElement('div');
      card.className = 'deal-card';
      card.dataset.reqId = docSnap.id;
      card.innerHTML = `
        <div class="deal-details">
          <div class="deal-title">
            ${req.itemName}
            ${recTagHtml}
            <span class="seasonal-placeholder"></span>
          </div>
          <div class="deal-meta"><span><b>Requested Qty:</b> ${req.requestedQty}</span></div>
          <div class="deal-meta"><span><b>Requested By:</b> ${dealerName}</span></div>
          <div class="deal-meta"><span><b>Location/Address:</b> ${locAddr}</span></div>
        </div>
        <button class="pill-btn" onclick="window.showOfferPopup('${docSnap.id}')">Send Offer</button>
      `;
      marketplaceList.appendChild(card);

      // Asynchronously try to fetch seasonal tag. If available, update the card in-place.
      (async () => {
        const seasonal = await getSeasonalDemand(req.itemName);
        if (seasonal?.demand) {
          const seasonalTagHtml = `<span class="seasonal-tag" title="${seasonal.reason}">${seasonal.recommendation}</span>`;
          // find the inserted card and append the tag
          const insertedCard = marketplaceList.querySelector(`.deal-card[data-req-id="${docSnap.id}"]`);
          if (insertedCard) {
            const placeholder = insertedCard.querySelector('.seasonal-placeholder');
            if (placeholder) placeholder.outerHTML = seasonalTagHtml;
          }
          // send notification about seasonal recommendation
          await createNotification(supplierUid, {
            type: "seasonal_recommendation",
            title: "Seasonal Demand",
            body: seasonal.reason,
            related: { globalProcurementId: docSnap.id, itemID: req.itemID }
          });
        }
      })().catch(err => {
        // ignore; we already warned inside getSeasonalDemand
      });
    }
  }
}

let currentReqId = null;

window.showOfferPopup = function (reqId) {
  currentReqId = reqId;
  const popup = document.getElementById('offer-popup');
  const form = document.getElementById('offer-form');
  form.supplierName.value = prefill.name || "";
  form.location.value = prefill.location || "";
  popup.style.display = 'flex';
};

window.closeOfferPopup = function () {
  document.getElementById('offer-popup').style.display = 'none';
  document.getElementById('offer-form').reset();
  currentReqId = null;
};

// Close on overlay click + Esc
document.addEventListener('click', (e) => {
  const overlay = document.getElementById('offer-popup');
  if (overlay && e.target === overlay) window.closeOfferPopup();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.closeOfferPopup();
});

document.getElementById('offer-form').addEventListener('submit', async function (e) {
  e.preventDefault();
  const form = e.target;

  const supplierName = form.supplierName.value;
  const location = form.location.value;
  const price = Number(form.price.value);
  const details = form.details.value;
  const paymentMethod = form.paymentMethod.value;
  const paymentTerms = form.paymentTerms.value;
  const deliveryMethod = form.deliveryMethod.value;
  const deliveryDays = Number(form.deliveryDays.value);

  const supplierUid = auth.currentUser ? auth.currentUser.uid : null;
  if (!supplierUid) {
    alert("You must be logged in as a supplier to send an offer.");
    return;
  }

  const offerData = {
    globalProcurementId: currentReqId,
    supplierName,
    location,
    price,
    details,
    payment: { method: paymentMethod, terms: paymentTerms },
    delivery: { method: deliveryMethod, days: deliveryDays },
    supplierUid,
    createdAt: new Date(),
    status: "pending"
  };

  // Use friendly offer id instead of Firestore auto-id
  const offerId = generateStandardId("offer");
  offerData.offerId = offerId;
  await setDoc(doc(db, "users", supplierUid, "offers", offerId), offerData);

  // Append into global request
  const reqRef = doc(db, "globalProcurementRequests", currentReqId);
  await updateDoc(reqRef, { supplierResponses: arrayUnion(offerData) });

  // Append into request owner's user subcollection doc(s)
  const reqSnap = await getDoc(reqRef);
  if (reqSnap.exists()) {
    const reqData = reqSnap.data();
    const userUid = reqData.userUid;
    const globalProcurementId = reqSnap.id;

    const userReqQuery = query(
      collection(db, "users", userUid, "procurementRequests"),
      where("globalProcurementId", "==", globalProcurementId),
      where("status", "==", "open")
    );
    const userReqSnap = await getDocs(userReqQuery);
    for (const userDoc of userReqSnap.docs) {
      await updateDoc(
        doc(db, "users", userUid, "procurementRequests", userDoc.id),
        { supplierResponses: arrayUnion(offerData) }
      );
    }

    const dealerUid = reqData.userUid;
    await createNotification(dealerUid, {
      type: "offer_received",
      title: "New Offer Received",
      body: `${supplierName} offered ₹${price} for ${reqData.itemName}`,
      related: { globalProcurementId: currentReqId, offerId: offerData.offerId, itemID: reqData.itemID }
    });
  }
  showToast("Offer sent", "success");
  window.closeOfferPopup();
  loadOpenRequests(supplierUid);
});

// Wait for authentication, prefetch supplier details for prefill, then load requests
onAuthStateChanged(auth, async (user) => {
  if (user) {
    // Try Supplier Details in 'suppliers/{uid}' first; fallback to 'info/{uid}'
    try {
      let sDoc = await getDoc(doc(db, "suppliers", user.uid));
      if (!sDoc.exists()) sDoc = await getDoc(doc(db, "info", user.uid));

      if (sDoc.exists()) {
        const d = sDoc.data();
        prefill.name = d.companyName || d.contactPerson || d.name || "";
        prefill.location = d.companyAddress || d.location || "";
      }
    } catch (e) {
      console.warn("Unable to prefill supplier details:", e);
    }
    loadOpenRequests(user.uid);
  }
});