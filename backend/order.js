import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { collection, getDocs, doc, updateDoc, getDoc, query, where, collectionGroup } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { createNotification } from "./notifications-helper.js";

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
  return `Digital Supply Contract\n\nOrder ID: ${order.globalOrderId || "-"}\nItem: ${order.itemName}\nQuantity: ${order.quantity}\nSupplier: ${order.supplier}\nSupplier GSTIN: ${supplierGSTIN}\nDealer GSTIN: ${dealerGSTIN}\nPrice: ₹${order.price}\nDetails: ${order.details}\nDate: ${(order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt)).toLocaleString()}\n\nBy signing, both parties agree to the above terms.`;
}

async function saveContractSignature(globalOrderId, who, signature) {
  // Update in globalOrders
  const globalOrderRef = doc(db, "globalOrders", globalOrderId);
  await updateDoc(globalOrderRef, { [`contractSignatures.${who}`]: signature });

  // Update in all user orders referencing this globalOrderId
  const ordersQuery = query(collectionGroup(db, "orders"), where("globalOrderId", "==", globalOrderId));
  const ordersSnap = await getDocs(ordersQuery);
  for (const docSnap of ordersSnap.docs) {
    await updateDoc(docSnap.ref, { [`contractSignatures.${who}`]: signature });
  }
  // Update in supplier's orderFulfilment
  const fulfilQuery = query(collectionGroup(db, "orderFulfilment"), where("globalOrderId", "==", globalOrderId));
  const fulfilSnap = await getDocs(fulfilQuery);
  for (const docSnap of fulfilSnap.docs) {
    await updateDoc(docSnap.ref, { [`contractSignatures.${who}`]: signature });
  }
}

function downloadCertificate(filename, text) {
  // Create a temporary anchor element for download
  const file = new File([text], filename, { type: "text/plain" });
  const tempUrl = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.style.display = "none";
  anchor.href = tempUrl;
  anchor.setAttribute("download", filename);
  document.body.appendChild(anchor);
  anchor.click();
  setTimeout(() => {
    document.body.removeChild(anchor);
    URL.revokeObjectURL(tempUrl);
  }, 100);
}

const tableBody = document.querySelector('#orders-table tbody');

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    alert("Please login to view orders.");
    window.location.href = "../index.html";
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
      status: "completed",         // <-- set status to completed so UI treats it as closed
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
      status: "completed",        // <-- important: move from "ordered" -> "completed"
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

  createNotification("Procurement marked completed and inventory updated", "success");
  loadOrders(uid);
};

window.showTracking = async (uid, globalOrderId, globalProcurementId) => {
  // Fetch order from globalOrders
  const globalOrderRef = doc(db, "globalOrders", globalOrderId);
  const globalOrderSnap = await getDoc(globalOrderRef);
  if (!globalOrderSnap.exists()) return;
  const order = globalOrderSnap.data();

  // Fetch tracking from globalOrders
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
  dealerSigned = !!(contractSignatures && contractSignatures.dealer);
  supplierSigned = !!(contractSignatures && contractSignatures.supplier);

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
        ${canDownload ? `<button id="download-contract-btn">Download Certificate</button>` : ""}
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
        // --- NEW: True Digital Signature ---
        let privateKeyJwk = JSON.parse(localStorage.getItem("privateKeyJwk"));
        if (!privateKeyJwk) {
          alert("Private key not found. Please import or generate your key pair.");
          return;
        }
        let signature = await signContractText(contractText, privateKeyJwk);
        if (isDealer) {
          await saveContractSignature(globalOrderId, 'dealer', signature);
          // Notify supplier to sign
          if (order.supplierUid) {
            await createNotification(order.supplierUid, {
              type: "contract_sign",
              title: "Dealer Signed Contract",
              body: "Dealer has signed the contract. Please review and sign.",
              related: { globalOrderId }
            });
          }
        } else if (isSupplier) {
          await saveContractSignature(globalOrderId, 'supplier', signature);
          // Notify dealer that supplier signed
          if (order.dealerUid) {
            await createNotification(order.dealerUid, {
              type: "contract_sign",
              title: "Supplier Signed Contract",
              body: "Supplier has signed the contract.",
              related: { globalOrderId }
            });
          }
        }
      };
    }
    if (downloadBtn) {
      downloadBtn.onclick = () => {
        let certText = contractText + `\n\nDealer Signature: ${contractSignatures.dealer || "-"}\nSupplier Signature: ${contractSignatures.supplier || "-"}`;
        downloadCertificate(`Order_${globalOrderId}_Certificate.txt`, certText);
      };
    }
  }, 100);
};

// --- Digital Signature Helpers (Web Crypto API) ---
async function importPublicKey(jwk) {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["verify"]
  );
}
async function importPrivateKey(jwk) {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"]
  );
}
async function signContractText(contractText, privateKeyJwk) {
  const privateKey = await importPrivateKey(privateKeyJwk);
  const encoder = new TextEncoder();
  const data = encoder.encode(contractText);
  const signature = await window.crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    data
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}
async function verifyContractSignature(contractText, signatureBase64, publicKeyJwk) {
  const publicKey = await importPublicKey(publicKeyJwk);
  const encoder = new TextEncoder();
  const data = encoder.encode(contractText);
  const signature = Uint8Array.from(atob(signatureBase64), c => c.charCodeAt(0));
  return await window.crypto.subtle.verify(
    { name: "RSASSA-PKCS1-v1_5" },
    publicKey,
    signature,
    data
  );
}

// Generate a new key pair and store them
async function generateAndStoreKeyPair() {
  const keyPair = await window.crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    collectionGroup(db, "orders"),
    where("globalOrderId", "==", globalOrderId)
  );
  const ordersSnap = await getDocs(ordersQuery);
  for (const docSnap of ordersSnap.docs) {
    await updateDoc(docSnap.ref, {
      status: globalOrder.status,
      tracking: globalOrder.tracking
    });
  }

  // Also update supplier's orderFulfilment if you use it
  const fulfilQuery = query(
    collectionGroup(db, "orderFulfilment"),
    where("globalOrderId", "==", globalOrderId)
  );
  const fulfilSnap = await getDocs(fulfilQuery);
  for (const docSnap of fulfilSnap.docs) {
    await updateDoc(docSnap.ref, {
      status: globalOrder.status,
      tracking: globalOrder.tracking
    });
  }
}

onAuthStateChanged(auth, async (user) => {
  if (user) {
    let privateKeyJwk = localStorage.getItem("privateKeyJwk");
    let publicKeyJwk = localStorage.getItem("publicKeyJwk");
    if (!privateKeyJwk || !publicKeyJwk) {
      // Generate new key pair
      const keyPair = await window.crypto.subtle.generateKey(
        {
          name: "RSASSA-PKCS1-v1_5",
          modulusLength: 2048,
          publicExponent: new Uint8Array([1, 0, 1]),
          hash: "SHA-256"
        },
        true,
      );
      const privateJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
      const publicJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);
      localStorage.setItem("privateKeyJwk", JSON.stringify(privateJwk));
      localStorage.setItem("publicKeyJwk", JSON.stringify(publicJwk));
      // Upload public key to Firestore under user's info
      await updateDoc(doc(db, "info", user.uid), { publicKeyJwk: publicJwk });
    }
  }
});
