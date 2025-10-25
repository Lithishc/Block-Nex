import { db } from "../functions/firebase-config.js";
import { getDoc, doc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// Helper: Extract text from PDF using PDF.js
async function extractPdfText(file) {
  // Wait for PDF.js to be available (poll for up to 5 seconds)
  let tries = 0;
  while (!window.pdfjsLib && tries < 100) {
    await new Promise(res => setTimeout(res, 50));
    tries++;
  }
  if (!window.pdfjsLib) throw new Error("PDF.js not loaded.");
  const pdfjsLib = window.pdfjsLib;
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://unpkg.com/pdfjs-dist@4.0.379/build/pdf.worker.js';
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let text = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map(item => item.str).join('\n') + '\n';
  }
  return text;
}

// Helper: Extract contract details and signatures from text
function parseContractText(text) {
  const contractMatch = text.match(/Digital Supply Contract[\s\S]*By signing, both parties agree to the above terms\./);
  const dealerSigMatch = text.match(/Dealer Signature:\s*([A-Za-z0-9+/=.-]*)/);
  const supplierSigMatch = text.match(/Supplier Signature:\s*([A-Za-z0-9+/=.-]*)/);

  return {
    contractText: contractMatch ? contractMatch[0].trim() : "",
    dealerSignature: dealerSigMatch ? dealerSigMatch[1].trim() : "",
    supplierSignature: supplierSigMatch ? supplierSigMatch[1].trim() : ""
  };
}

// Helper: Verify signature using Web Crypto API
async function importPublicKey(jwk) {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["verify"]
  );
}
async function verifyContractSignature(contractText, signatureBase64, publicKeyJwk) {
  try {
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
  } catch (err) {
    return false;
  }
}

// Main verify logic
window.addEventListener('DOMContentLoaded', () => {
  const verifyBtn = document.getElementById('verify-btn');
  verifyBtn.textContent = "Verify Contract";

  verifyBtn.onclick = async () => {
    const fileInput = document.getElementById('pdf-upload');
    const resultDiv = document.getElementById('verify-result');
    const detailsDiv = document.getElementById('contract-details');
    resultDiv.style.display = "none";
    detailsDiv.style.display = "none";

    if (!fileInput.files[0]) {
      resultDiv.innerHTML = "<span class='verify-fail'>Please select a PDF file.</span>";
      resultDiv.style.display = "block";
      return;
    }

    // Wait for PDF.js to be available (poll for up to 5 seconds)
    let tries = 0;
    while (!window.pdfjsLib && tries < 100) {
      resultDiv.innerHTML = "Loading PDF.js library, please wait...";
      resultDiv.style.display = "block";
      await new Promise(res => setTimeout(res, 50));
      tries++;
    }
    if (!window.pdfjsLib) {
      resultDiv.innerHTML = "<span class='verify-fail'>PDF.js is not loaded. Please reload the page.</span>";
      resultDiv.style.display = "block";
      return;
    }

    resultDiv.innerHTML = "Extracting and verifying...";
    resultDiv.style.display = "block";

    // Extract text from PDF
    let text;
    try {
      text = await extractPdfText(fileInput.files[0]);
    } catch (err) {
      resultDiv.innerHTML = "<span class='verify-fail'>Failed to read PDF file. PDF.js may not be loaded.</span>";
      return;
    }

    // Parse contract and signatures
    const { contractText, dealerSignature, supplierSignature } = parseContractText(text);

    if (!contractText) {
      resultDiv.innerHTML = "<span class='verify-fail'>Could not find contract details in PDF.</span>";
      return;
    }

    // Extract Order ID from contract text
    const orderIdMatch = contractText.match(/Order ID:\s*([A-Za-z0-9\-]+)/);
    const orderId = orderIdMatch ? orderIdMatch[1] : null;

    if (!orderId) {
      resultDiv.innerHTML = "<span class='verify-fail'>Order ID not found in contract.</span>";
      return;
    }

    // Fetch public keys from Firestore
    let dealerPublicKey = null, supplierPublicKey = null;
    let dealerUid = null, supplierUid = null;
    try {
      const globalOrderRef = doc(db, "globalOrders", orderId);
      const globalOrderSnap = await getDoc(globalOrderRef);
      if (!globalOrderSnap.exists()) throw new Error("Order not found.");
      const order = globalOrderSnap.data();
      dealerUid = order.dealerUid;
      supplierUid = order.supplierUid;

      // Fetch dealer public key
      if (dealerUid) {
        const dealerInfoRef = doc(db, "info", dealerUid);
        const dealerInfoSnap = await getDoc(dealerInfoRef);
        if (dealerInfoSnap.exists()) {
          dealerPublicKey = dealerInfoSnap.data().publicKeyJwk;
        }
      }
      // Fetch supplier public key
      if (supplierUid) {
        const supplierInfoRef = doc(db, "info", supplierUid);
        const supplierInfoSnap = await getDoc(supplierInfoRef);
        if (supplierInfoSnap.exists()) {
          supplierPublicKey = supplierInfoSnap.data().publicKeyJwk;
        }
      }
    } catch (err) {
      resultDiv.innerHTML = "<span class='verify-fail'>Failed to fetch order/public keys.</span>";
      return;
    }

    // Verify signatures
    let dealerValid = false, supplierValid = false;
    if (dealerSignature && dealerPublicKey) {
      dealerValid = await verifyContractSignature(contractText, dealerSignature, dealerPublicKey);
    }
    if (supplierSignature && supplierPublicKey) {
      supplierValid = await verifyContractSignature(contractText, supplierSignature, supplierPublicKey);
    }

    // Show results
    let html = `<div class='verify-label'>Order ID:</div> ${orderId}<br>`;
    html += `<div class='verify-label'>Dealer Signature:</div> ${dealerSignature ? (dealerValid ? "<span class='verify-success'>Valid</span>" : "<span class='verify-fail'>Invalid</span>") : "<span class='verify-fail'>Missing</span>"}<br>`;
    html += `<div class='verify-label'>Supplier Signature:</div> ${supplierSignature ? (supplierValid ? "<span class='verify-success'>Valid</span>" : "<span class='verify-fail'>Invalid</span>") : "<span class='verify-fail'>Missing</span>"}<br>`;

    resultDiv.innerHTML = html;
    resultDiv.style.display = "block";
    detailsDiv.textContent = contractText;
    detailsDiv.style.display = "block";
  };
});