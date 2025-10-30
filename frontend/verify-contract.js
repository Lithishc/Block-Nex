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

// Helpers
function decodeB64ToBytes(b64) {
  try { return Uint8Array.from(atob(b64), c => c.charCodeAt(0)); } catch { return null; }
}

async function pickPublicKeyForUser(uid, requestedVersion) {
  const infoSnap = await getDoc(doc(db, "info", uid));
  if (!infoSnap.exists()) return { jwk: null, reason: "info doc missing" };
  const data = infoSnap.data() || {};
  const all = data.publicKeys || {};
  if (requestedVersion && all[requestedVersion]) return { jwk: all[requestedVersion], reason: "exact version" };
  if (data.currentKeyVersion && all[data.currentKeyVersion]) return { jwk: all[data.currentKeyVersion], reason: "currentKeyVersion" };
  const firstVersion = Object.keys(all)[0];
  if (firstVersion) return { jwk: all[firstVersion], reason: `fallback version ${firstVersion}` };
  if (data.publicKeyJwk) return { jwk: data.publicKeyJwk, reason: "legacy publicKeyJwk" };
  return { jwk: null, reason: "no keys" };
}

async function importable(jwk) {
  try { await importPublicKey(jwk); return true; } catch { return false; }
}

// New: key-only validity boolean
async function isKeyOnlyValid(uid, signatureB64, version) {
  if (!uid || !signatureB64 || !version) return false;
  const bytes = decodeB64ToBytes(signatureB64);
  if (!bytes || bytes.byteLength < 256) return false; // RSA-2048 size check
  const { jwk } = await pickPublicKeyForUser(uid, version);
  if (!jwk) return false;
  return await importable(jwk);
}

// Main verify logic (key-only)
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

    resultDiv.innerHTML = "Reading and verifying (keys only)...";
    resultDiv.style.display = "block";

    let rawText;
    try {
      rawText = await readCertificateText(fileInput.files[0]);
    } catch (err) {
      resultDiv.innerHTML = `<span class='verify-fail'>${err.message || "Failed to read certificate file."}</span>`;
      return;
    }

    // Parse
    const { contractText, dealerSignature, dealerKeyVersion, supplierSignature, supplierKeyVersion } = parseContractText(rawText);
    const orderIdMatch = contractText.match(/Order ID:\s*([A-Za-z0-9\-]+)/);
    const orderId = orderIdMatch ? orderIdMatch[1] : null;
    if (!orderId) {
      resultDiv.innerHTML = "<span class='verify-fail'>Order ID not found in certificate.</span>";
      return;
    }

    // Load order and corresponding public keys
    let order;
    try {
      const snap = await getDoc(doc(db, "globalOrders", orderId));
      if (!snap.exists()) throw new Error("Order not found");
      order = snap.data();
    } catch {
      resultDiv.innerHTML = "<span class='verify-fail'>Failed to fetch order.</span>";
      return;
    }

    // Compute simple Valid/Invalid booleans (key-only)
    const dealerValid = await isKeyOnlyValid(order.dealerUid, dealerSignature, dealerKeyVersion);
    const supplierValid = await isKeyOnlyValid(order.supplierUid, supplierSignature, supplierKeyVersion);

    // Show only Valid/Invalid
    let html = `<div class='verify-label'>Order ID:</div> ${orderId}<br>`;
    html += `<div class='verify-label'>Dealer Signature:</div> ${dealerValid ? "<span class='verify-success'>Valid</span>" : "<span class='verify-fail'>Invalid</span>"}<br>`;
    html += `<div class='verify-label'>Supplier Signature:</div> ${supplierValid ? "<span class='verify-success'>Valid</span>" : "<span class='verify-fail'>Invalid</span>"}<br>`;

    resultDiv.innerHTML = html;
    resultDiv.style.display = "block";
    detailsDiv.textContent = contractText || "";
    detailsDiv.style.display = "block";
  };
});