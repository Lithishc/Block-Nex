import { auth, db } from "../../functions/firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-auth.js";
import { collection, getDocs, doc, updateDoc, getDoc, setDoc, query, where, collectionGroup } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
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
  return `Digital Supply Contract\n\nOrder ID: ${order.globalOrderId || "-"}\nItem: ${order.itemName}\nQuantity: ${order.quantity}\nSupplier: ${order.supplier}\nSupplier GSTIN: ${supplierGSTIN}\nDealer GSTIN: ${dealerGSTIN}\nPrice: Rs.${order.price}\nDetails: ${order.details}\nDate: ${(order.createdAt?.toDate ? order.createdAt.toDate() : new Date(order.createdAt)).toLocaleString()}\n\nBy signing, both parties agree to the above terms.`;
}

async function saveContractSignature(globalOrderId, who, signature) {
  try {
    const globalOrderRef = doc(db, "globalOrders", globalOrderId);
    await updateDoc(globalOrderRef, { [`contractSignatures.${who}`]: signature });

    const ordersQuery = query(collectionGroup(db, "orders"), where("globalOrderId", "==", globalOrderId));
    const ordersSnap = await getDocs(ordersQuery);
    for (const docSnap of ordersSnap.docs) {
      await updateDoc(docSnap.ref, { [`contractSignatures.${who}`]: signature });
    }

    const fulfilQuery = query(collectionGroup(db, "orderFulfilment"), where("globalOrderId", "==", globalOrderId));
    const fulfilSnap = await getDocs(fulfilQuery);
    for (const docSnap of fulfilSnap.docs) {
      await updateDoc(docSnap.ref, { [`contractSignatures.${who}`]: signature });
    }
    return true;
  } catch (err) {
    console.error("saveContractSignature error:", err);
    return false;
  }
}

function downloadCertificate(filename, text) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();

  // Title
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text('Digital Supply Contract Certificate', 105, 20, { align: 'center' });

  // Subtitle
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(15);
  doc.text('Digital Supply Contract', 20, 32);

  // Use Times font for contract details to support ₹ symbol
  doc.setFont('times', 'normal');
  doc.setFontSize(12);
  let y = 42;
  const contractLines = text.split('\n');
  for (let line of contractLines) {
    // Stop before signatures
    if (line.startsWith('Dealer Signature:') || line.startsWith('Supplier Signature:')) break;
    doc.text(line, 20, y, { align: 'left' });
    y += 7;
  }

  // Add a gap before signatures
  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text('Signatures:', 20, y);
  y += 9;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);

  // Extract and wrap signatures
  const dealerSig = text.match(/Dealer Signature: (.*)/)?.[1] || "-";
  const supplierSig = text.match(/Supplier Signature: (.*)/)?.[1] || "-";

  // Dealer Signature
  doc.setFont('helvetica', 'bold');
  doc.text('Dealer Signature:', 20, y);
  doc.setFont('helvetica', 'normal');
  y += 7;
  const dealerSigLines = doc.splitTextToSize(dealerSig, 170);
  dealerSigLines.forEach(line => {
    doc.text(line, 24, y);
    y += 7;
  });

  y += 5;
  doc.setFont('helvetica', 'bold');
  doc.text('Supplier Signature:', 20, y);
  doc.setFont('helvetica', 'normal');
  y += 7;
  const supplierSigLines = doc.splitTextToSize(supplierSig, 170);
  supplierSigLines.forEach(line => {
    doc.text(line, 24, y);
    y += 7;
  });

  doc.save(filename.replace('.txt', '.pdf'));
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
  window.showTracking(uid, globalOrderId, globalProcurementId);
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
        const currentUid = auth.currentUser?.uid || uid;
        if (!currentUid) {
          alert("User not found. Please login again.");
          return;
        }
        const { privateKeyJwk } = await ensureUserKeys(currentUid);
        let signature = await signContractText(contractText, privateKeyJwk);
        if (isDealer) {
          const success = await saveContractSignature(globalOrderId, 'dealer', signature);
          if (success) {
            // Notify supplier to sign
            if (order.supplierUid) {
              await createNotification(order.supplierUid, {
                type: "contract_sign",
                title: "Dealer Signed Contract",
                body: "Dealer has signed the contract. Please review and sign.",
                related: { globalOrderId }
              });
            }
            // Refresh UI
            window.showTracking(uid, globalOrderId, globalProcurementId);
          }
        } else if (isSupplier) {
          const success = await saveContractSignature(globalOrderId, 'supplier', signature);
          if (success) {
            // Notify dealer that supplier signed
            if (order.dealerUid) {
              await createNotification(order.dealerUid, {
                type: "contract_sign",
                title: "Supplier Signed Contract",
                body: "Supplier has signed the contract.",
                related: { globalOrderId }
              });
            }
            // Refresh UI
            window.showTracking(uid, globalOrderId, globalProcurementId);
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

// ensure keypair helper (private stored locally, public stored in Firestore info/{uid})
async function ensureUserKeys(uid) {
  let privateKeyJwk = null;
  let publicKeyJwk = null;
  try {
    privateKeyJwk = JSON.parse(localStorage.getItem(`privateKeyJwk_${uid}`) || "null");
    publicKeyJwk = JSON.parse(localStorage.getItem(`publicKeyJwk_${uid}`) || "null");
    if (privateKeyJwk && publicKeyJwk) return { privateKeyJwk, publicKeyJwk };

    // Generate new keypair
    const keyPair = await window.crypto.subtle.generateKey(
      {
        name: "RSASSA-PKCS1-v1_5",
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: "SHA-256"
      },
      true,
      ["sign", "verify"]
    );
    privateKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
    publicKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);

    // Store locally with UID
    localStorage.setItem(`privateKeyJwk_${uid}`, JSON.stringify(privateKeyJwk));
    localStorage.setItem(`publicKeyJwk_${uid}`, JSON.stringify(publicKeyJwk));

    // Store public key in Firestore
    await updateDoc(doc(db, "info", uid), { publicKeyJwk: publicKeyJwk });

    return { privateKeyJwk, publicKeyJwk };
  } catch (err) {
    console.error("ensureUserKeys error:", err);
    throw err;
  }
}
