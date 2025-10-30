import { auth, db } from "../../functions/firebase-config.js";
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
    window.location.href = "../frontend/index.html";
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
  ordersSnap.forEach((docSnap) => {
    const order = docSnap.data();
    const orderId = order.globalOrderId || docSnap.id; // Always use globalOrderId
    const date = order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt);
    let globalProcurementId = order.globalProcurementId || (order.acceptedOffer && order.acceptedOffer.globalProcurementId) || null;
    let quantity = order.quantity ?? order.requestedQty ?? (order.acceptedOffer && order.acceptedOffer.requestedQty) ?? "-";

    let statusCell = `
      <span class="status-text">${order.status}</span>
      <button class="pill-btn" onclick="window.showTracking('${uid}', '${orderId}', '${globalProcurementId}')">Track</button>
    `;
    if (order.status === "delivered" && globalProcurementId) {
      statusCell += ` <button onclick="window.markProcurementFulfilled('${uid}','${orderId}', '${globalProcurementId}')"
        style="margin-left:8px;">Mark as Fulfilled & Update Inventory</button>`;
    }

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
  });
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
  let dealerSigned = false;
  let supplierSigned = false;
  let contractText = "";
  let dealerGSTIN = order.dealerGSTIN || "";
  let supplierGSTIN = order.supplierGSTIN || "";
  let contractSignatures = order.contractSignatures || {};
  let currentUserUid = uid;
  let isDealer = (order.dealerUid === currentUserUid);
  let isSupplier = (order.supplierUid === currentUserUid);

  // Try to get GSTINs if not present
  if (!dealerGSTIN && order.dealerUid) {
    dealerGSTIN = order.dealerUid;
  }
  if (!supplierGSTIN && order.supplierUid) {
    supplierGSTIN = await getSupplierGSTIN(order.supplierUid);
  }

  contractText = generateContractText(order, dealerGSTIN, supplierGSTIN);
  dealerSigned = !!(contractSignatures && contractSignatures.dealer && contractSignatures.dealer.sig);
  supplierSigned = !!(contractSignatures && contractSignatures.supplier && contractSignatures.supplier.sig);

  // Dealer signs first, then supplier
  if (isDealer && !dealerSigned) {
    canSign = true;
  } else if (isSupplier && dealerSigned && !supplierSigned) {
    canSign = true;
  }
  if (dealerSigned && supplierSigned) {
    canDownload = true;
  }

  contractSection = `
    <div style="margin:16px 0;padding:12px;border:1px solid #aaa; border-radius: 20px;background:#f9f9f9;">
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
  let markFulfilledBtn = "";
  if ((status === "delivered" || status === "Delivered") && globalProcurementId && dealerSigned && supplierSigned) {
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

        if (isDealer) {
          const success = await saveContractSignature(globalOrderId, 'dealer', payload);
          if (success) {
            if (order.supplierUid) {
              await createNotification(order.supplierUid, {
                type: "contract_sign",
                title: "Dealer Signed Contract",
                body: "Dealer has signed the contract. Please review and sign.",
                related: { globalOrderId }
              });
            }
            window.showTracking(uid, globalOrderId, globalProcurementId);
          }
        } else if (isSupplier) {
          const success = await saveContractSignature(globalOrderId, 'supplier', payload);
          if (success) {
            if (order.dealerUid) {
              await createNotification(order.dealerUid, {
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
          const dealer = sigs.dealer || null;
          const supplier = sigs.supplier || null;

          const certText =
            contractText +
            `

Dealer Signature (v:${dealer?.v ?? "-" }):
${dealer?.sig ?? "-"}

Supplier Signature (v:${supplier?.v ?? "-" }):
${supplier?.sig ?? "-"}`;

          downloadText(`Order_${globalOrderId}_Certificate.txt`, certText);
        } catch (e) {
          console.error("Download certificate failed", e);
          alert("Could not fetch latest signatures. Please refresh and try again.");
        }
      };
    }
  }, 100);
};