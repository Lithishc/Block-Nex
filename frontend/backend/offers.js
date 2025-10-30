import { auth, db } from "../../functions/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { collection, getDocs, doc, getDoc, updateDoc, query, where, collectionGroup } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { createNotification } from "./notifications-helper.js";
import { showToast } from "./toast.js";
import { signWithNewKey, downloadText } from "./digital-signature.js";

// Digital contract helpers
async function getSupplierGSTIN(supplierUid) {
  const infoRef = doc(db, "info", supplierUid);
  const infoSnap = await getDoc(infoRef);
  if (infoSnap.exists()) {
    return infoSnap.data().gstNumber || "";
  }
  return "";
}

function generateContractText(order, dealerGSTIN, supplierGSTIN) {
  return `Digital Supply Contract

Order ID: ${order.globalOrderId || "-"}
Item: ${order.itemName}
Quantity: ${order.quantity}
Supplier: ${order.supplier}
Supplier GSTIN: ${supplierGSTIN}
Dealer GSTIN: ${dealerGSTIN}
Price: Rs.${order.price}
Details: ${order.details}
Date: ${(order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt)).toLocaleString()}

By signing, both parties agree to the above terms.`;
}

async function saveContractSignature(globalOrderId, who, signaturePayload) {
  // Update in globalOrders
  const globalOrderRef = doc(db, "globalOrders", globalOrderId);
  await updateDoc(globalOrderRef, { [`contractSignatures.${who}`]: signaturePayload });

  // Update in all user orders referencing this globalOrderId
  const ordersQuery = query(collectionGroup(db, "orders"), where("globalOrderId", "==", globalOrderId));
  const ordersSnap = await getDocs(ordersQuery);
  for (const docSnap of ordersSnap.docs) {
    await updateDoc(docSnap.ref, { [`contractSignatures.${who}`]: signaturePayload });
  }
  // Update in supplier's orderFulfilment
  const fulfilQuery = query(collectionGroup(db, "orderFulfilment"), where("globalOrderId", "==", globalOrderId));
  const fulfilSnap = await getDocs(fulfilQuery);
  for (const docSnap of fulfilSnap.docs) {
    await updateDoc(docSnap.ref, { [`contractSignatures.${who}`]: signaturePayload });
  }
}

function downloadCertificateText(filename, text) {
  downloadText(filename, text);
}

const tableBody = document.querySelector('#offers-table tbody');

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Please login to view your offers.");
    window.location.href = "../frontend/index.html";
    return;
  }
  loadOffers(user.uid);
});

function badge(label, kind = "neutral") {
  const palette = {
    awaiting: { bg: "#FFF3CD", fg: "#7A5B00" },   // amber
    process:  { bg: "#E7F1FF", fg: "#0B5ED7" },   // blue
    fulfilled:{ bg: "#D1F3D5", fg: "#1B7D2B" },   // green
    accepted: { bg: "#E8F5E9", fg: "#1B7D2B" },   // green-light
    pending:  { bg: "#EFEFEF", fg: "#333" },      // gray
    rejected: { bg: "#FAD1D1", fg: "#9B1C1C" },   // red
    neutral:  { bg: "#EFEFEF", fg: "#333" }
  };
  const c = palette[kind] || palette.neutral;
  return `<span class="offer-status" style="background:${c.bg};color:${c.fg};padding:6px 10px;border-radius:12px;display:inline-block;min-width:140px;text-align:center;">${label}</span>`;
}

function derivePipelineStatus(offer, globalOrder) {
  // Default by offer state
  if (!offer || !offer.status) return { label: "-", kind: "neutral" };
  const st = (offer.status || "").toLowerCase();

  if (st === "rejected") return { label: "Rejected", kind: "rejected" };
  if (st === "pending") return { label: "Pending", kind: "pending" };

  // Accepted → check contract signatures and global order status
  if (st === "accepted") {
    if (!globalOrder) return { label: "Accepted", kind: "accepted" };

    const sigs = globalOrder.contractSignatures || {};
    const dealerSigned = !!(sigs.dealer && sigs.dealer.sig);
    const supplierSigned = !!(sigs.supplier && sigs.supplier.sig);

    if (!(dealerSigned && supplierSigned)) {
      return { label: "Contract Sign Awaiting", kind: "awaiting" };
    }

    const gos = (globalOrder.status || "").toLowerCase();
    const inProcessStates = [
      "preparing to ship",
      "preparing to deliver",
      "processing",
      "packed",
      "shipped",
      "in transit",
      "out for delivery"
    ];
    const fulfilledStates = ["delivered", "fulfilled", "completed"];

    if (fulfilledStates.includes(gos)) {
      return { label: "Fulfilled", kind: "fulfilled" };
    }
    if (inProcessStates.includes(gos)) {
      return { label: "In Process", kind: "process" };
    }
    // Fallback once signed but no mapped state
    return { label: "In Process", kind: "process" };
  }

  return { label: st.charAt(0).toUpperCase() + st.slice(1), kind: "neutral" };
}

async function loadOffers(uid) {
  tableBody.innerHTML = "";
  const offersSnap = await getDocs(collection(db, "users", uid, "offers"));
  if (offersSnap.empty) {
    tableBody.innerHTML = `<tr><td colspan="7">No offers made yet.</td></tr>`;
    return;
  }

  for (const docSnap of offersSnap.docs) {
    const offer = docSnap.data();
    const offerId = docSnap.id;
    const date = offer.createdAt?.toDate ? offer.createdAt.toDate() : new Date(offer.createdAt);

    // --- Get item name from global procurement request ---
    let itemName = "-";
    if (offer.globalProcurementId) {
      const globalReqRef = doc(db, "globalProcurementRequests", offer.globalProcurementId);
      const globalReqSnap = await getDoc(globalReqRef);
      if (globalReqSnap.exists()) {
        const globalReq = globalReqSnap.data();
        itemName = globalReq.itemName || "-";
      }
    }

    // --- Related global order (to derive pipeline status) ---
    let globalOrder = null;
    let globalOrderId = offer.globalOrderId || null;
    if (globalOrderId) {
      const globalOrderRef = doc(db, "globalOrders", globalOrderId);
      const globalOrderSnap = await getDoc(globalOrderRef);
      if (globalOrderSnap.exists()) {
        globalOrder = globalOrderSnap.data();
      }
    }

    const pipeline = derivePipelineStatus(offer, globalOrder);

    // --- Make orderId clickable if exists ---
    let orderStatusCell = globalOrderId
      ? `<a href="#" class="order-link" data-order-id="${globalOrderId}" data-global-id="${offer.globalProcurementId}" data-global-order-id="${globalOrderId}">${globalOrderId}</a>`
      : "-";

    tableBody.innerHTML += `
      <tr>
        <td>${offerId}</td>
        <td>${itemName}</td>
        <td>₹${offer.price}</td>
        <td>${offer.details}</td>
        <td>${badge(pipeline.label, pipeline.kind)}</td>
        <td>${orderStatusCell}</td>
        <td>${date.toLocaleString()}</td>
      </tr>
    `;
  }

  setTimeout(() => {
    document.querySelectorAll('.order-link').forEach(link => {
      link.addEventListener('click', function(e) {
        e.preventDefault();
        const globalOrderId = this.getAttribute('data-global-order-id');
        window.UpdateTracking(auth.currentUser.uid, globalOrderId);
      });
    });
  }, 100);
}

window.UpdateTracking = async (uid, globalOrderId) => {
  // Fetch global order
  const globalOrderRef = doc(db, "globalOrders", globalOrderId);
  const globalOrderSnap = await getDoc(globalOrderRef);
  if (!globalOrderSnap.exists()) return;
  const order = globalOrderSnap.data();

  // Fetch tracking history
  let tracking = order.tracking || [];
  const statusOptions = [
    "Preparing to Ship",
    "Shipped",
    "In Transit",
    "Delivered"
  ];

  const currentStatusIndex = statusOptions.indexOf(order.status);
  const availableStatuses = statusOptions.slice(currentStatusIndex + 1);

  // --- Digital Contract Section ---
  let contractSection = "";
  let canSign = false;
  let canDownload = false;
  let dealerSigned = false;
  let supplierSigned = false;
  let contractText = "";
  let dealerGSTIN = order.dealerGSTIN || "";
  let supplierGSTIN = order.supplierGSTIN || "";
  let contractSignatures = order.contractSignatures || {};
  let currentUserUid = uid;
  let isDealer = (order.dealerUid === currentUserUid);
  let isSupplier = (order.supplierUid === currentUserUid);

  if (!dealerGSTIN && order.dealerUid) {
    const dealerInfoRef = doc(db, "info", order.dealerUid);
    const dealerInfoSnap = await getDoc(dealerInfoRef);
    if (dealerInfoSnap.exists()) {
      dealerGSTIN = dealerInfoSnap.data().gstNumber || order.dealerUid;
    } else {
      dealerGSTIN = order.dealerUid;
    }
  }
  if (!supplierGSTIN && order.supplierUid) {
    supplierGSTIN = await getSupplierGSTIN(order.supplierUid);
  }
  contractText = generateContractText(order, dealerGSTIN, supplierGSTIN);
  dealerSigned = !!(contractSignatures && contractSignatures.dealer && contractSignatures.dealer.sig);
  supplierSigned = !!(contractSignatures && contractSignatures.supplier && contractSignatures.supplier.sig);

  if (isDealer && !dealerSigned) {
    canSign = true;
  } else if (isSupplier && dealerSigned && !supplierSigned) {
    canSign = true;
  }
  if (dealerSigned && supplierSigned) {
    canDownload = true;
  }

  contractSection = `
    <div style="margin:16px 0;padding:12px;border:1px solid #aaa;background:#f9f9f9; border-radius: 20px;">
      <h3>Digital Contract</h3>
      <pre style="white-space:pre-wrap;font-size:0.95em;">${contractText}</pre>
      <div style="margin:8px 0;">
        <b>Dealer Signed:</b> ${dealerSigned ? "✅" : "❌"} <br>
        <b>Supplier Signed:</b> ${supplierSigned ? "✅" : "❌"}
      </div>
      <div style="margin:8px 0 0 0;">
        ${canSign ? `<button id="sign-contract-btn" class="pill-btn" style="margin-right:8px;">Sign Contract</button>` : ""}
        ${canDownload ? `<button id="download-contract-btn">Download Certificate (.txt)</button>` : ""}
      </div>
      <div style="color:#e0103a;font-size:0.95em;margin-top:6px;">
        ${!dealerSigned ? "Dealer must sign first." : (!supplierSigned && isSupplier ? "Please sign to proceed." : "")}
      </div>
    </div>
  `;

  // Only allow supplier to update status after both have signed
  let statusSection = "";
  const statusLower = (order.status || "").toString().toLowerCase();
  const isFinalStatus = statusLower === "delivered" || statusLower === "fulfilled";

  if (isFinalStatus) {
    statusSection = "";
  } else if (dealerSigned && supplierSigned) {
    statusSection = `<div style="margin-bottom:16px;">
        <label for="status-select">Update Status:</label>
        <select id="status-select" ${availableStatuses.length === 0 ? "disabled" : ""}>
         ${availableStatuses.map(s => `<option value="${s}">${s}</option>`).join("")}
        </select>
        <button id="update-status-btn" ${availableStatuses.length === 0 ? "disabled" : ""}>Update</button>
      </div>`;
  } else {
    statusSection = `<div style="color:#e0103a;margin-bottom:16px;">Both parties must sign the contract before updating status.</div>`;
  }

  let html = `
    <div class="popup-content" style="max-height:80vh;overflow-y:auto;">
      <button class="close-btn" onclick="document.getElementById('order-tracking-popup').remove()">&times;</button>
      <h2>Order Tracking</h2>
      <div style="margin-bottom:16px;">
        <b>Order ID:</b> ${globalOrderId}<br>
        <b>Item:</b> ${order.itemName}<br>
        <b>Current Status:</b> ${order.status}
      </div>
      ${contractSection}
      ${statusSection}
      <h3>Updates:</h3>
      <table>
        <thead>
          <tr><th>Date</th><th>Status</th><th>Note</th></tr>
        </thead>
        <tbody>
          ${tracking.map(t => `
            <tr>
              <td>${t.date ? (t.date.toDate ? t.date.toDate().toLocaleString() : new Date(t.date).toLocaleString()) : "-"}</td>
              <td>${t.status}</td>
              <td>${t.note || ""}</td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
  
  let popup = document.createElement('div');
  popup.id = 'order-tracking-popup';
  popup.className = 'popup';
  popup.innerHTML = html;
  document.body.appendChild(popup);

  setTimeout(() => {
    const signBtn = document.getElementById('sign-contract-btn');
    const downloadBtn = document.getElementById('download-contract-btn');
    const updateStatusBtn = document.getElementById('update-status-btn');
    const statusSelect = document.getElementById('status-select');
    if (signBtn) {
      signBtn.onclick = async () => {
        try {
          const { signature, keyVersion } = await signWithNewKey(uid, contractText);
          const payload = { v: keyVersion, sig: signature };

          if (isDealer) {
            await saveContractSignature(globalOrderId, 'dealer', payload);
            if (order.supplierUid) {
              await createNotification(order.supplierUid, {
                type: "contract_sign",
                title: "Dealer Signed Contract",
                body: "Dealer has signed the contract. Please review and sign.",
                related: { globalOrderId }
              });
            }
          } else if (isSupplier) {
            await saveContractSignature(globalOrderId, 'supplier', payload);
            if (order.dealerUid) {
              await createNotification(order.dealerUid, {
                type: "contract_sign",
                title: "Supplier Signed Contract",
                body: "Supplier has signed the contract.",
                related: { globalOrderId }
              });
            }
          }
          showToast('Contract signed successfully!');
          location.reload();
        } catch (err) {
          console.error("Sign contract failed:", err);
          alert("Signing failed. See console for details.");
        }
      };
    }
    if (downloadBtn) {
      downloadBtn.onclick = async () => {
        try {
          // Always fetch the latest signatures before downloading
          const latestSnap = await getDoc(doc(db, "globalOrders", globalOrderId));
          const latest = latestSnap.exists() ? latestSnap.data() : order;
          const sigs = latest.contractSignatures || {};
          const dealer = sigs.dealer || null;
          const supplier = sigs.supplier || null;

          const certText =
            contractText +
            `

Dealer Signature (v:${dealer?.v ?? "-" }):
${dealer?.sig ?? "-"}

Supplier Signature (v:${supplier?.v ?? "-" }):
${supplier?.sig ?? "-"}`;

          downloadCertificateText(`Order_${globalOrderId}_Certificate.txt`, certText);
        } catch (e) {
          console.error("Download certificate failed", e);
          alert("Could not fetch latest signatures. Please refresh and try again.");
        }
      };
    }
    if (updateStatusBtn && statusSelect) {
      updateStatusBtn.onclick = async () => {
        const newStatus = statusSelect.value;
        if (!newStatus) return;

        // 1) Update global order status
        const globalOrderRef = doc(db, "globalOrders", globalOrderId);
        await updateDoc(globalOrderRef, { status: newStatus });

        // 2) Append tracking to global order
        const trackingUpdate = {
          date: new Date().toISOString(),
          status: newStatus,
          note: `${isSupplier ? "Supplier" : "Dealer"} updated status.`
        };
        const globalOrderSnap = await getDoc(globalOrderRef);
        if (globalOrderSnap.exists()) {
          const orderData = globalOrderSnap.data();
          const trackingArr = orderData.tracking || [];
          trackingArr.push(trackingUpdate);
          await updateDoc(globalOrderRef, { tracking: trackingArr });

          // 3) Propagate status to every user's orders doc referencing this global order
          const ordersCg = query(collectionGroup(db, "orders"), where("globalOrderId", "==", globalOrderId));
          const ordersCgSnap = await getDocs(ordersCg);
          for (const s of ordersCgSnap.docs) {
            await updateDoc(s.ref, { status: newStatus });
          }

          // 4) Propagate to supplier's orderFulfilment docs (if present)
          const fulfilCg = query(collectionGroup(db, "orderFulfilment"), where("globalOrderId", "==", globalOrderId));
          const fulfilCgSnap = await getDocs(fulfilCg);
          for (const f of fulfilCgSnap.docs) {
            await updateDoc(f.ref, { status: newStatus });
          }

          // 5) Notify parties
          if (orderData.dealerUid) {
            await createNotification(orderData.dealerUid, {
              type: "order_status",
              title: "Order Status Updated",
              body: `Order status changed to "${newStatus}".`,
              related: { globalOrderId }
            });
          }
          if (orderData.supplierUid) {
            await createNotification(orderData.supplierUid, {
              type: "order_status",
              title: "Order Status Updated",
              body: `Order status changed to "${newStatus}".`,
              related: { globalOrderId }
            });
          }
        }

        showToast('Order status updated!');
        document.getElementById('order-tracking-popup').remove();
        window.UpdateTracking(uid, globalOrderId); // Refresh popup
      };
    }
  }, 100);
};