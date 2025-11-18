import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { collection, getDocs, doc, updateDoc, getDoc, setDoc, query, where, collectionGroup } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { createNotification } from "./notifications-helper.js";
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

function generateContractText(order, retailerGSTIN, supplierGSTIN) {
  // Prefer transaction hashes only; do NOT show numeric IDs as a fallback.
  const procurementTx = order.blockchain?.txHash || order.blockchain?.procurementTx || order.procurementTx || null;
  const acceptTx = order.blockchain?.acceptTx || order.acceptTx || order.blockchain?.offerAcceptTx || order.acceptedOffer?.blockchain?.txHash || null;

  return `Digital Supply Contract

Order ID: ${order.globalOrderId || "-"}
Item: ${order.itemName}
Quantity: ${order.quantity}
Supplier: ${order.supplier}
Supplier GSTIN: ${supplierGSTIN}
Retailer: ${order.retailer || order.retailerName || "-"}
Retailer GSTIN: ${retailerGSTIN}
Procurement (on-chain) Tx: ${procurementTx || "-"}
Accepted Offer (on-chain) Tx: ${acceptTx || "-"}
Price: Rs.${order.price}
Details: ${order.details}
Date: ${(order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt)).toLocaleString()}

By signing, both parties agree to the above terms.`;
}

async function saveContractSignature(globalOrderId, who, signaturePayload) {
  try {
    const globalOrderRef = doc(db, "globalOrders", globalOrderId);
    await updateDoc(globalOrderRef, { [`contractSignatures.${who}`]: signaturePayload });

    const ordersQuery = query(collectionGroup(db, "orders"), where("globalOrderId", "==", globalOrderId));
    const ordersSnap = await getDocs(ordersQuery);
    for (const docSnap of ordersSnap.docs) {
      await updateDoc(docSnap.ref, { [`contractSignatures.${who}`]: signaturePayload });
    }

    const fulfilQuery = query(collectionGroup(db, "orderFulfilment"), where("globalOrderId", "==", globalOrderId));
    const fulfilSnap = await getDocs(fulfilQuery);
    for (const docSnap of fulfilSnap.docs) {
      await updateDoc(docSnap.ref, { [`contractSignatures.${who}`]: signaturePayload });
    }
    return true;
  } catch (err) {
    console.error("saveContractSignature error:", err);
    return false;
  }
}

const tableBody = document.querySelector('#orders-table tbody');

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Please login to view orders.");
    window.location.href = "./index.html";
    return;
  }
  loadOrders(user.uid);
});

async function loadOrders(uid) {
  tableBody.innerHTML = "";
  const ordersSnap = await getDocs(collection(db, "users", uid, "orders"));
  if (ordersSnap.empty) {
    tableBody.innerHTML = `<tr><td colspan="8">No orders found.</td></tr>`;
    return;
  }

  // Use for..of so we can await global status fetch per row
  for (const docSnap of ordersSnap.docs) {
    const order = docSnap.data();
    const orderId = order.globalOrderId || docSnap.id; // Always use globalOrderId
    const date = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
    let globalProcurementId = order.globalProcurementId || (order.acceptedOffer && order.acceptedOffer.globalProcurementId) || null;
    let quantity = order.quantity ?? order.requestedQty ?? (order.acceptedOffer && order.acceptedOffer.requestedQty) ?? "-";

    // Pull latest status from globalOrders (authoritative)
    let latestStatus = order.status || "-";
    let retailerSigned = false, supplierSigned = false;
    try {
      if (orderId) {
        const gSnap = await getDoc(doc(db, "globalOrders", orderId));
        if (gSnap.exists()) {
          const g = gSnap.data();
          latestStatus = g.status || latestStatus;

          // Check digital contract signatures
          const sigs = g.contractSignatures || {};
          retailerSigned = !!(sigs.retailer && sigs.retailer.sig);
          supplierSigned = !!(sigs.supplier && sigs.supplier.sig);
        }
      }
    } catch (e) {
      console.warn("Failed to fetch global order status for", orderId, e);
    }

    // Show "Contract Sign Awaiting" until both parties sign
    const displayStatus = (retailerSigned && supplierSigned) ? latestStatus : "Contract Sign Awaiting";

    let statusCell = `
      <span class="status-text">${displayStatus}</span>
      <button class="pill-btn" onclick="window.showTracking('${uid}', '${orderId}', '${globalProcurementId}')">Track</button>
    `;

    tableBody.innerHTML += `
      <tr>
        <td>${orderId}</td>
        <td>${order.itemName}</td>
        <td>${quantity}</td>
        <td>${order.supplier}</td>
        <td>₹${order.price}</td>
        <td>${order.details}</td>
        <td class="status-cell">${statusCell}</td>
        <td>${date.toLocaleString()}</td>
      </tr>
    `;
  }
}

window.markProcurementFulfilled = async (uid, globalOrderId, globalProcurementId) => {
  // 1. Mark as fulfilled / completed in globalProcurementRequests
  const globalQuery = query(
    collection(db, "globalProcurementRequests"),
    where("globalProcurementId", "==", globalProcurementId)
  );
  const globalSnap = await getDocs(globalQuery);
  for (const globalDoc of globalSnap.docs) {
    await updateDoc(doc(db, "globalProcurementRequests", globalDoc.id), {
      fulfilled: true,
      status: "completed",
      completedAt: new Date()
    });
  }

  // 2. Mark as fulfilled / completed in user's procurementRequests
  const userReqQuery = query(
    collection(db, "users", uid, "procurementRequests"),
    where("globalProcurementId", "==", globalProcurementId)
  );
  const userReqSnap = await getDocs(userReqQuery);
  let itemID = null;
  for (const userDoc of userReqSnap.docs) {
    await updateDoc(doc(db, "users", uid, "procurementRequests", userDoc.id), {
      fulfilled: true,
      status: "completed",
      completedAt: new Date()
    });
    itemID = userDoc.data().itemID || itemID;
  }

  // 3. Update inventory
  if (itemID) {
    const newQty = prompt("Enter new stock quantity after procurement:");
    if (newQty) {
      const inventoryQuery = query(collection(db, "users", uid, "inventory"), where("itemID", "==", itemID));
      const invSnap = await getDocs(inventoryQuery);
      for (const docRef of invSnap.docs) {
        await updateDoc(doc(db, "users", uid, "inventory", docRef.id), { quantity: Number(newQty) });
      }
    }
  }

  // 4. Mark as fulfilled in globalOrders
  if (globalOrderId) {
    await updateDoc(doc(db, "globalOrders", globalOrderId), {
      status: "fulfilled",
      fulfilledAt: new Date()
    });

    // 4b. Also update supplier's orderFulfilment entries (if used)
    const fulfilQuery = query(
      collectionGroup(db, "orderFulfilment"),
      where("globalOrderId", "==", globalOrderId)
    );
    const fulfilSnap = await getDocs(fulfilQuery);
    for (const fDoc of fulfilSnap.docs) {
      await updateDoc(fDoc.ref, { status: "fulfilled", fulfilledAt: new Date() });
    }
  }

  // 5. Mark as fulfilled in user's orders
  const ordersQuery2 = query(
    collection(db, "users", uid, "orders"),
    where("globalOrderId", "==", globalOrderId)
  );
  const ordersSnap2 = await getDocs(ordersQuery2);
  for (const orderDoc of ordersSnap2.docs) {
    await updateDoc(doc(db, "users", uid, "orders", orderDoc.id), { status: "fulfilled", fulfilledAt: new Date() });
  }
  window.showTracking(uid, globalOrderId, globalProcurementId);
  createNotification("Procurement marked completed and inventory updated", "success");
  loadOrders(uid);
};

window.showTracking = async (uid, globalOrderId, globalProcurementId) => {
  const globalOrderRef = doc(db, "globalOrders", globalOrderId);
  const globalOrderSnap = await getDoc(globalOrderRef);
  if (!globalOrderSnap.exists()) return;
  const order = globalOrderSnap.data();

  let tracking = order.tracking || [];
  let status = order.status;

  // --- Digital Contract Section ---
  let contractSection = "";
  let canSign = false;
  let canDownload = false;
  let retailerSigned = false;
  let supplierSigned = false;
  let contractText = "";
  let retailerGSTIN = order.retailerGSTIN || "";
  let supplierGSTIN = order.supplierGSTIN || "";
  let contractSignatures = order.contractSignatures || {};
  let currentUserUid = uid;
  let isRetailer = (order.retailerUid === currentUserUid);
  let isSupplier = (order.supplierUid === currentUserUid);

  // Try to get GSTINs if not present
  if (!retailerGSTIN && order.retailerUid) {
    retailerGSTIN = order.retailerUid;
  }
  if (!supplierGSTIN && order.supplierUid) {
    supplierGSTIN = await getSupplierGSTIN(order.supplierUid);
  }

  contractText = generateContractText(order, retailerGSTIN, supplierGSTIN);
  retailerSigned = !!(contractSignatures && contractSignatures.retailer && contractSignatures.retailer.sig);
  supplierSigned = !!(contractSignatures && contractSignatures.supplier && contractSignatures.supplier.sig);

  // Retailer signs first, then supplier
  if (isRetailer && !retailerSigned) {
    canSign = true;
  } else if (isSupplier && retailerSigned && !supplierSigned) {
    canSign = true;
  }
  if (retailerSigned && supplierSigned) {
    canDownload = true;
  }

  // Compute tx hashes (used for explorer links placed outside the DS box)
  const procurementTx = order.blockchain?.txHash || order.blockchain?.procurementTx || order.procurementTx || null;
  const acceptTx = order.blockchain?.acceptTx || order.acceptTx || order.blockchain?.offerAcceptTx || order.acceptedOffer?.blockchain?.txHash || null;

  // Show compact View/Download when both have signed; otherwise show full contract and sign controls
  if (retailerSigned && supplierSigned) {
    const inlineContractWithSigs = contractText + `\n\nRetailer Signed: ${retailerSigned ? "✅" : "❌"}\nSupplier Signed: ${supplierSigned ? "✅" : "❌"}`;

    contractSection = `
      <div style="margin:16px 0;padding:12px;border:1px solid #aaa; border-radius: 20px;background:#f9f9f9;">
        <h3>Digital Contract</h3>
        <div style="margin:8px 0 0 0; display:flex; gap:8px; align-items:center;">
          <button id="view-contract-btn" class="pill-btn" style="margin-right:8px;">View Contract</button>
          <button id="download-contract-btn">Download Certificate (.txt)</button>
        </div>
        <div id="contract-inline-text" style="display:none;margin-top:12px;">
          <pre id="contract-inline-pre" style="white-space:pre-wrap;font-size:0.95em;overflow-wrap:anywhere;word-break:break-all;">${inlineContractWithSigs}</pre>
        </div>
      </div>
    `;
  } else {
    contractSection = `
      <div style="margin:16px 0;padding:12px;border:1px solid #aaa; border-radius: 20px;background:#f9f9f9;">
        <h3>Digital Contract</h3>
        <pre style="white-space:pre-wrap;font-size:0.95em;overflow-wrap:anywhere;word-break:break-all;">${contractText}</pre>
        <div style="margin:8px 0;">
          <b>Retailer Signed:</b> ${retailerSigned ? "✅" : "❌"} <br>
          <b>Supplier Signed:</b> ${supplierSigned ? "✅" : "❌"}
        </div>
        <div style="margin:8px 0 0 0;">
          ${canSign ? `<button id="sign-contract-btn" class="pill-btn" style="margin-right:8px;">Sign Contract</button>` : ""}
          ${canDownload ? `<button id="download-contract-btn">Download Certificate (.txt)</button>` : ""}
        </div>
        <div style="color:#e0103a;font-size:0.95em;margin-top:6px;">
          ${!retailerSigned ? "Retailer must sign first." : (!supplierSigned && isSupplier ? "Please sign to proceed." : "")}
        </div>
      </div>
    `;
  }

  // Only allow supplier to update status after both have signed
  let markFulfilledBtn = "";
  if ((status === "delivered" || status === "Delivered") && globalProcurementId && retailerSigned && supplierSigned) {
    markFulfilledBtn = `
      <div style="margin-top:14px;">
        <button class="pill-btn accept" onclick="window.markProcurementFulfilled('${uid}','${globalOrderId}','${globalProcurementId}')">
          Mark as Fulfilled & Update Inventory
        </button>
      </div>
    `;
  }

  let html = `
    <div class="popup-content" style="max-height:80vh;overflow-y:auto;">
      <button class="close-btn" onclick="document.getElementById('order-tracking-popup').remove()">&times;</button>
      <h2>Order Tracking</h2>
      <div style="margin-bottom:16px;">
        <b>Order ID:</b> ${globalOrderId}<br>
        <b>Item:</b> ${order.itemName}<br>
        <b>Current Status:</b> ${status}
        ${markFulfilledBtn}
      </div>
      <div id="contract-section">
        ${contractSection}
      </div>
      ${ (procurementTx || acceptTx) ? `<div style="margin:8px 0;display:flex;gap:8px;flex-wrap:wrap;">
              ${procurementTx ? `<button class="pill-btn" style="background:#E7F1FF;color:#0B5ED7;border:none;box-shadow:none;padding:8px 14px;border-radius:20px;" title="Verify on Sepolia (opens new tab)" onclick="window.open('https://sepolia.etherscan.io/tx/${procurementTx}','_blank')">Verify Procurement Tx</button>` : ''}
              ${acceptTx ? `<button class="pill-btn" style="background:#E7F1FF;color:#0B5ED7;border:none;box-shadow:none;padding:8px 14px;border-radius:20px;" title="Verify on Sepolia (opens new tab)" onclick="window.open('https://sepolia.etherscan.io/tx/${acceptTx}','_blank')">Verify Accept Tx</button>` : ''}
        </div>` : ''}
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

  // Add contract signing and download logic
  setTimeout(() => {
    const signBtn = document.getElementById('sign-contract-btn');
    const downloadBtn = document.getElementById('download-contract-btn');
    const viewBtn = document.getElementById('view-contract-btn');
    if (signBtn) {
      signBtn.onclick = async () => {
        const currentUid = auth.currentUser?.uid || uid;
        if (!currentUid) {
          alert("User not found. Please login again.");
          return;
        }
        // Sign with fresh keypair and store only public key (versioned)
        const { signature, keyVersion } = await signWithNewKey(currentUid, contractText);
        const payload = { v: keyVersion, sig: signature };

        if (isRetailer) {
          const success = await saveContractSignature(globalOrderId, 'retailer', payload);
          if (success) {
            if (order.supplierUid) {
              await createNotification(order.supplierUid, {
                type: "contract_sign",
                title: "Retailer Signed Contract",
                body: "Retailer has signed the contract. Please review and sign.",
                related: { globalOrderId }
              });
            }
            window.showTracking(uid, globalOrderId, globalProcurementId);
          }
        } else if (isSupplier) {
          const success = await saveContractSignature(globalOrderId, 'supplier', payload);
          if (success) {
            if (order.retailerUid) {
              await createNotification(order.retailerUid, {
                type: "contract_sign",
                title: "Supplier Signed Contract",
                body: "Supplier has signed the contract.",
                related: { globalOrderId }
              });
            }
            window.showTracking(uid, globalOrderId, globalProcurementId);
          }
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
          const retailer = sigs.retailer || null;
          const supplier = sigs.supplier || null;

          const certText =
            contractText +
            `

Retailer Signature (v:${retailer?.v ?? "-" }):
${retailer?.sig ?? "-"}

Supplier Signature (v:${supplier?.v ?? "-"}):
${supplier?.sig ?? "-"}`;

          downloadText(`Order_${globalOrderId}_Certificate.txt`, certText);
        } catch (e) {
          console.error("Download certificate failed", e);
          alert("Could not fetch latest signatures. Please refresh and try again.");
        }
      };
    }
    if (viewBtn) {
      viewBtn.onclick = () => {
        const el = document.getElementById('contract-inline-text');
        if (!el) return;
        if (el.style.display === 'none' || el.style.display === '') {
          el.style.display = 'block';
          viewBtn.textContent = 'Hide Contract';
        } else {
          el.style.display = 'none';
          viewBtn.textContent = 'View Contract';
        }
      };
      // Ensure inline pre contains latest signature markers in case signatures changed since popup build
      const pre = document.getElementById('contract-inline-pre');
      if (pre) {
        pre.textContent = contractText + "\n\nRetailer Signed: " + (retailerSigned ? "✅" : "❌") + "\nSupplier Signed: " + (supplierSigned ? "✅" : "❌");
      }
    }
  }, 100);
};