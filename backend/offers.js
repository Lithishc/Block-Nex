import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { collection, getDocs, doc, getDoc, updateDoc, query,where,collectionGroup } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// Digital contract helpers (same as in order.js)
async function getSupplierGSTIN(supplierUid) {
  const infoRef = doc(db, "info", supplierUid);
  const infoSnap = await getDoc(infoRef);
  if (infoSnap.exists()) {
    return infoSnap.data().gstNumber || "";
  }
  return "";
}
function generateContractText(order, dealerGSTIN, supplierGSTIN) {
  return `Digital Supply Contract\n\nOrder ID: ${order.globalOrderId || "-"}\nItem: ${order.itemName}\nQuantity: ${order.quantity}\nSupplier: ${order.supplier}\nSupplier GSTIN: ${supplierGSTIN}\nDealer GSTIN: ${dealerGSTIN}\nPrice: ₹${order.price}\nDetails: ${order.details}\nDate: ${(order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt)).toLocaleString()}\n\nBy signing, both parties agree to the above terms.`;
}
async function saveContractSignature(orderRef, who, signature) {
  await updateDoc(orderRef, { [`contractSignatures.${who}`]: signature });
}
function downloadCertificate(filename, text) {
  const blob = new Blob([text], { type: 'text/plain' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
import { createNotification } from "./notifications-helper.js";
import { showToast } from "./toast.js";

const tableBody = document.querySelector('#offers-table tbody');

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Please login to view your offers.");
    window.location.href = "../index.html";
    return;
  }
  loadOffers(user.uid);
});

async function loadOffers(uid) {
  tableBody.innerHTML = "";
  const offersSnap = await getDocs(collection(db, "users", uid, "offers"));
  if (offersSnap.empty) {
    tableBody.innerHTML = `<tr><td colspan="7">No offers made yet.</td></tr>`;
    return;
  }
  for (const docSnap of offersSnap.docs) {
    const offer = docSnap.data();
    const offerId = docSnap.id; // Always use the document ID as offerId
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

    // --- Find related global order ---
    let orderStatus = "-";
    let globalOrderId = offer.globalOrderId || null;
    if (globalOrderId) {
      const globalOrderRef = doc(db, "globalOrders", globalOrderId);
      const globalOrderSnap = await getDoc(globalOrderRef);
      if (globalOrderSnap.exists()) {
        const globalOrder = globalOrderSnap.data();
        orderStatus = globalOrder.status || "-";
      }
    }

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
        <td>
          <span class="offer-status ${offer.status}">
            ${offer.status.charAt(0).toUpperCase() + offer.status.slice(1)}
          </span>
        </td>
        <td>${orderStatusCell}</td>
        <td>${date.toLocaleString()}</td>
      </tr>
    `;
  }

  // Add event listener for all order links (after table is populated)
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

  // Find index of current status
  const currentStatusIndex = statusOptions.indexOf(order.status);
  // Only allow statuses after the current one
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

  // Always fetch GSTINs
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
  dealerSigned = !!(contractSignatures && contractSignatures.dealer);
  supplierSigned = !!(contractSignatures && contractSignatures.supplier);

  // Fix: Allow dealer to sign if not signed, supplier to sign if dealer has signed and supplier hasn't
  if (isDealer && !dealerSigned) {
    canSign = true;
  } else if (isSupplier && dealerSigned && !supplierSigned) {
    canSign = true;
  }

  if (dealerSigned && supplierSigned) {
    canDownload = true;
  }

  contractSection = `
    <div style="margin:16px 0;padding:12px;border:1px solid #aaa;background:#f9f9f9;">
      <h3>Digital Contract</h3>
      <pre style="white-space:pre-wrap;font-size:0.95em;">${contractText}</pre>
      <div style="margin:8px 0;">
        <b>Dealer Signed:</b> ${dealerSigned ? "✅" : "❌"} <br>
        <b>Supplier Signed:</b> ${supplierSigned ? "✅" : "❌"}
      </div>
      <div style="margin:8px 0 0 0;">
        ${canSign ? `<button id="sign-contract-btn" style="margin-right:8px;">Sign Contract</button>` : ""}
        ${canDownload ? `<button id="download-contract-btn">Download Certificate</button>` : ""}
      </div>
      <div style="color:#e0103a;font-size:0.95em;margin-top:6px;">
        ${!dealerSigned ? "Dealer must sign first." : (!supplierSigned && isSupplier ? "Please sign to proceed." : "")}
      </div>
    </div>
  `;

  // Only allow supplier to update status after both have signed
  let statusSection = "";
  if (dealerSigned && supplierSigned) {
    statusSection = `<div style=\"margin-bottom:16px;\">
        <label for=\"status-select\">Update Status:</label>
        <select id=\"status-select\" ${availableStatuses.length === 0 ? "disabled" : ""}>
         ${availableStatuses.map(s => `<option value=\"${s}\">${s}</option>`).join("")}
        </select>
        <button id=\"update-status-btn\" ${availableStatuses.length === 0 ? "disabled" : ""}>Update</button>
      </div>`;
  } else {
    statusSection = `<div style=\"color:#e0103a;margin-bottom:16px;\">Both parties must sign the contract before updating status.</div>`;
  }

  let html = `
    <div>
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
      <button onclick="document.getElementById('order-tracking-popup').remove()">Close</button>
    </div>
  `;

  let popup = document.createElement('div');
  popup.id = 'order-tracking-popup';
  popup.innerHTML = html;
  document.body.appendChild(popup);

  // Add contract signing and download logic
  setTimeout(() => {
    const signBtn = document.getElementById('sign-contract-btn');
    const downloadBtn = document.getElementById('download-contract-btn');
    if (signBtn) {
      signBtn.onclick = async () => {
        let signature = "";
        if (isDealer) {
          signature = dealerGSTIN + "-signed-" + new Date().toISOString();
          await saveContractSignature(globalOrderRef, 'dealer', signature);
        } else if (isSupplier) {
          signature = supplierGSTIN + "-signed-" + new Date().toISOString();
          await saveContractSignature(globalOrderRef, 'supplier', signature);
        }
        alert('Contract signed successfully!');
        document.getElementById('order-tracking-popup').remove();
        window.UpdateTracking(uid, globalOrderId); // Refresh popup
      };
    }
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        let certText = contractText + `\n\nDealer Signature: ${contractSignatures.dealer || "-"}\nSupplier Signature: ${contractSignatures.supplier || "-"}`;
        downloadCertificate(`Order_${globalOrderId}_Certificate.txt`, certText);
      };
    }
  }, 100);

  // --- Fix: Hide update status section if status is not in allowed options ---
  const statusSelect = document.getElementById('status-select');
  const updateBtn = document.getElementById('update-status-btn');
  const statusLabel = document.querySelector('label[for="status-select"]');
  if (statusSelect && updateBtn && statusLabel) {
    const currentStatusIndex = statusOptions.indexOf(order.status);
    let availableStatuses = [];

    // Hide controls if status is "fulfilled" or "Delivered"
    if (order.status === "fulfilled" || order.status === "Delivered") {
      statusLabel.style.display = "none";
      statusSelect.style.display = "none";
      updateBtn.style.display = "none";
      return;
    }

    if (currentStatusIndex >= 0) {
      availableStatuses = statusOptions.slice(currentStatusIndex + 1);
    } else {
      availableStatuses = statusOptions.length ? [statusOptions[0]] : [];
    }

    statusSelect.innerHTML = availableStatuses.map(s => `<option value="${s}">${s}</option>`).join("");
    statusSelect.disabled = availableStatuses.length === 0;
    updateBtn.disabled = availableStatuses.length === 0;

    statusLabel.style.display = "";
    statusSelect.style.display = "";
    updateBtn.style.display = "";
  }

  // Add event listener for status update
  document.getElementById('update-status-btn').onclick = async () => {
    const newStatus = document.getElementById('status-select').value;
    const now = new Date();
    const newTracking = [
      ...(tracking || []),
      { status: newStatus, date: now, note: "" }
    ];

    // 1. Update in globalOrders
    await updateDoc(globalOrderRef, { status: newStatus, tracking: newTracking });

    // 2. Update in dealer's orders
    const dealerOrderQuery = query(
      collectionGroup(db, "orders"),
      where("globalOrderId", "==", globalOrderId)
    );
    const dealerOrderSnap = await getDocs(dealerOrderQuery);
    for (const docSnap of dealerOrderSnap.docs) {
      await updateDoc(docSnap.ref, { status: newStatus, tracking: newTracking });
    }

    // 3. Update in supplier's orderFulfilment
    const supplierOrderQuery = query(
      collectionGroup(db, "orderFulfilment"),
      where("globalOrderId", "==", globalOrderId)
    );
    const supplierOrderSnap = await getDocs(supplierOrderQuery);
    for (const docSnap of supplierOrderSnap.docs) {
      await updateDoc(docSnap.ref, { status: newStatus, tracking: newTracking });
    }

    // 4. (Optional) Update in globalProcurementRequests and procurementRequests
    if (order.globalProcurementId) {
      // globalProcurementRequests
      const globalReqQuery = query(
        collection(db, "globalProcurementRequests"),
        where("globalProcurementId", "==", order.globalProcurementId)
      );
      const globalReqSnap = await getDocs(globalReqQuery);
      for (const docRef of globalReqSnap.docs) {
        await updateDoc(doc(db, "globalProcurementRequests", docRef.id), {
          status: newStatus,
          tracking: newTracking
        });
      }
      // procurementRequests for dealer
      if (order.dealerUid) {
        const userReqQuery = query(
          collection(db, "users", order.dealerUid, "procurementRequests"),
          where("globalProcurementId", "==", order.globalProcurementId)
        );
        const userReqSnap = await getDocs(userReqQuery);
        for (const userDoc of userReqSnap.docs) {
          await updateDoc(doc(db, "users", order.dealerUid, "procurementRequests", userDoc.id), {
            status: newStatus,
            tracking: newTracking
          });
        }
      }
    }

    // Identify dealer & supplier from the global order
    const freshGlobal = (await getDoc(globalOrderRef)).data();
    if (freshGlobal.dealerUid) {
      await createNotification(freshGlobal.dealerUid, {
        type: "order_status",
        title: `Order Status: ${newStatus}`,
        body: `${freshGlobal.itemName} is now ${newStatus}`,
        related: { globalOrderId, globalProcurementId: freshGlobal.globalProcurementId, itemID: freshGlobal.itemID }
      });
    }
    if (freshGlobal.supplierUid) {
      await createNotification(freshGlobal.supplierUid, {
        type: "order_status",
        title: `Order Status: ${newStatus}`,
        body: `${freshGlobal.itemName} is now ${newStatus}`,
        related: { globalOrderId, globalProcurementId: freshGlobal.globalProcurementId, itemID: freshGlobal.itemID }
      });
    }
    showToast(`Order status updated to ${newStatus}`, "success");

    // --- Update the table below without closing the popup ---
    // Update the tracking array and status in the popup
    order.status = newStatus;
    tracking = newTracking;

    // Re-render the tracking table and status
    const currentStatusIndex = statusOptions.indexOf(order.status);
    const availableStatuses = statusOptions.slice(currentStatusIndex + 1);

    document.querySelector('#order-tracking-popup div').innerHTML = `
      <button class="close-btn" onclick="document.getElementById('order-tracking-popup').remove()">&times;</button>
      <h2>Order Tracking</h2>
      <div style="margin-bottom:16px;">
        <b>Order ID:</b> ${globalOrderId}<br>
        <b>Item:</b> ${order.itemName}<br>
        <b>Current Status:</b> ${order.status}
      </div>
      <div style="margin-bottom:16px;">
  <label for="status-select">Update Status:</label>
  <select id="status-select" ${availableStatuses.length === 0 ? "disabled" : ""}>
    ${availableStatuses.map(s => `<option value="${s}">${s}</option>`).join("")}
  </select>
  <button id="update-status-btn" ${availableStatuses.length === 0 ? "disabled" : ""}>Update</button>
</div>
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
      <button onclick="document.getElementById('order-tracking-popup').remove()">Close</button>
    `;

    document.getElementById('update-status-btn').onclick = arguments.callee;
  };
};