import { db } from "../functions/firebase-config.js";
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { importPublicKey } from "./backend/digital-signature.js";

// Read certificate text (.txt)
async function readCertificateText(file) {
  const isTxt = file.type === "text/plain" || /\.txt$/i.test(file.name);
  if (!isTxt) throw new Error("Please upload a .txt certificate file.");
  return await file.text();
}

// Extract contract details and signatures (+ versions) from text
function parseContractText(raw) {
  const text = raw.replace(/\r\n/g, "\n");
  const contractMatch = text.match(/Digital Supply Contract[\s\S]*By signing, both parties agree to the above terms\./);

  // Tolerant patterns (accept optional version and any spacing/newlines)
  const dealerMatch = text.match(/Dealer Signature\s*(?:\(v:\s*([0-9-]+)\s*\))?\s*:\s*([\s\S]*?)(?:\n{2,}|\r?\nSupplier Signature|\r?\n$)/i);
  const supplierMatch = text.match(/Supplier Signature\s*(?:\(v:\s*([0-9-]+)\s*\))?\s*:\s*([\s\S]*?)$/i);

  const dealerSignature = (dealerMatch ? dealerMatch[2] : "").replace(/\s+/g, "").trim();
  const dealerKeyVersion = dealerMatch && dealerMatch[1] && dealerMatch[1] !== "-" ? dealerMatch[1].trim() : null;

  const supplierSignature = (supplierMatch ? supplierMatch[2] : "").replace(/\s+/g, "").trim();
  const supplierKeyVersion = supplierMatch && supplierMatch[1] && supplierMatch[1] !== "-" ? supplierMatch[1].trim() : null;

  return {
    contractText: contractMatch ? contractMatch[0].trim() : "",
    dealerSignature,
    dealerKeyVersion,
    supplierSignature,
    supplierKeyVersion
  };
}

// Parse key fields from the contract text for cross-check (non-cryptographic)
function parseContractFields(contractText) {
  const get = (re) => {
    const m = contractText.match(re);
    return m ? m[1].trim() : null;
  };
  return {
    orderId: get(/Order ID:\s*([A-Za-z0-9\-]+)/),
    itemName: get(/Item:\s*(.+)/),
    quantity: get(/Quantity:\s*([0-9]+)/),
    supplier: get(/Supplier:\s*(.+)/),
    supplierGSTIN: get(/Supplier GSTIN:\s*(.+)/),
    dealerGSTIN: get(/Dealer GSTIN:\s*(.+)/),
    price: get(/Price:\s*Rs\.?(\d+(?:\.\d+)?)/),
    details: get(/Details:\s*(.*)/)
  };
}

// Helpers (key-only validity)
function decodeB64ToBytes(b64) {
  try { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); } catch { return null; }
}
async function pickPublicKeyForUser(uid, requestedVersion) {
  const infoSnap = await getDoc(doc(db, "info", uid));
  if (!infoSnap.exists()) return { jwk: null };
  const data = infoSnap.data() || {};
  const all = data.publicKeys || {};
  if (requestedVersion && all[requestedVersion]) return { jwk: all[requestedVersion] };
  if (data.currentKeyVersion && all[data.currentKeyVersion]) return { jwk: all[data.currentKeyVersion] };
  const firstVersion = Object.keys(all)[0];
  if (firstVersion) return { jwk: all[firstVersion] };
  if (data.publicKeyJwk) return { jwk: data.publicKeyJwk };
  return { jwk: null };
}
async function importable(jwk) {
  try { await importPublicKey(jwk); return true; } catch { return false; }
}
async function isKeyOnlyValid(uid, signatureB64, version) {
  if (!uid || !signatureB64 || !version) return false;
  const bytes = decodeB64ToBytes(signatureB64);
  if (!bytes || bytes.byteLength < 256) return false; // RSA-2048 size heuristic
  const { jwk } = await pickPublicKeyForUser(uid, version);
  if (!jwk) return false;
  return await importable(jwk);
}

// Main verify logic
window.addEventListener('DOMContentLoaded', () => {
  const verifyBtn = document.getElementById('verify-btn');
  verifyBtn.textContent = "Verify Certificate";

  verifyBtn.onclick = async () => {
    const fileInput = document.getElementById('pdf-upload'); // reuse existing input
    const resultDiv = document.getElementById('verify-result');
    const detailsDiv = document.getElementById('contract-details');
    resultDiv.style.display = "none";
    detailsDiv.style.display = "none";

    if (!fileInput.files[0]) {
      resultDiv.innerHTML = "<span class='verify-fail'>Please select a .txt certificate file.</span>";
      resultDiv.style.display = "block";
      return;
    }

    resultDiv.innerHTML = "Verifying...";
    resultDiv.style.display = "block";

    let rawText;
    try {
      rawText = await readCertificateText(fileInput.files[0]);
    } catch (err) {
      resultDiv.innerHTML = `<span class='verify-fail'>${err.message || "Failed to read certificate file."}</span>`;
      return;
    }

    // Parse signatures and contract text
    const { contractText, dealerSignature, dealerKeyVersion, supplierSignature, supplierKeyVersion } = parseContractText(rawText);
    const fields = parseContractFields(contractText);
    const orderId = fields.orderId;
    if (!orderId) {
      resultDiv.innerHTML = "<span class='verify-fail'>Order ID not found in certificate.</span>";
      return;
    }

    // Load order
    let order;
    try {
      const snap = await getDoc(doc(db, "globalOrders", orderId));
      if (!snap.exists()) throw new Error("Order not found");
      order = snap.data();
    } catch {
      resultDiv.innerHTML = "<span class='verify-fail'>Failed to fetch order.</span>";
      return;
    }

    // 1) Signature validity (key-only, same as before)
    const dealerValid = await isKeyOnlyValid(order.dealerUid, dealerSignature, dealerKeyVersion);
    const supplierValid = await isKeyOnlyValid(order.supplierUid, supplierSignature, supplierKeyVersion);

    // 2) Cross-verify contract details (string compare; does not affect Valid/Invalid)
    const normalize = (v) => (v === undefined || v === null) ? "" : String(v).trim();
    const compare = (a, b) => normalize(a) === normalize(b);

    const detailsChecks = [];
    detailsChecks.push(compare(fields.itemName, order.itemName));
    detailsChecks.push(compare(fields.quantity, order.quantity));
    detailsChecks.push(compare(fields.supplier, order.supplier));
    detailsChecks.push(compare(fields.price, order.price));
    detailsChecks.push(compare(fields.details, order.details));
    // GSTINs if present on order
    if (order.dealerGSTIN) detailsChecks.push(compare(fields.dealerGSTIN, order.dealerGSTIN));
    if (order.supplierGSTIN) detailsChecks.push(compare(fields.supplierGSTIN, order.supplierGSTIN));

    const detailsMatch = detailsChecks.every(Boolean);

    // Render result (signatures Valid/Invalid; details Match/Mismatch)
    let html = `<div class='verify-label'>Order ID:</div> ${orderId}<br>`;
    html += `<div class='verify-label'>Dealer Signature:</div> ${dealerValid ? "<span class='verify-success'>Valid</span>" : "<span class='verify-fail'>Invalid</span>"}<br>`;
    html += `<div class='verify-label'>Supplier Signature:</div> ${supplierValid ? "<span class='verify-success'>Valid</span>" : "<span class='verify-fail'>Invalid</span>"}<br>`;
    html += `<div class='verify-label'>Contract Details:</div> ${detailsMatch ? "<span class='verify-success'>Match</span>" : "<span class='verify-fail'>Mismatch</span>"}<br>`;

    resultDiv.innerHTML = html;
    resultDiv.style.display = "block";
    detailsDiv.textContent = contractText || "";
    detailsDiv.style.display = "block";
  };
});