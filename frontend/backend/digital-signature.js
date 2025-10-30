import { db } from "../../functions/firebase-config.js";
import { doc, setDoc, getDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";

// Canonicalize text to avoid newline/whitespace mismatches
export function canonicalizeText(input) {
  if (typeof input !== "string") return "";
  let s = input.replace(/\r\n/g, "\n");       // CRLF -> LF
  s = s.replace(/[ \t]+$/gm, "");             // trim trailing spaces per line
  s = s.replace(/\u00A0/g, " ");              // NBSP -> space
  s = s.replace(/\n+$/g, "");                 // drop trailing newlines
  return s;
}

// Always generate a new keypair for each signing
export async function generateSigningKeys(uid) {
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

  const privateKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicKeyJwk = await window.crypto.subtle.exportKey("jwk", keyPair.publicKey);

  const keyVersion = Date.now().toString();

  const infoRef = doc(db, "info", uid);
  await setDoc(
    infoRef,
    {
      [`publicKeys.${keyVersion}`]: publicKeyJwk,
      currentKeyVersion: keyVersion
    },
    { merge: true }
  );

  return { privateKeyJwk, publicKeyJwk, keyVersion };
}

// Import keys
export async function importPublicKey(jwk) {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["verify"]
  );
}
export async function importPrivateKey(jwk) {
  return await window.crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["sign"]
  );
}

// Signing
export async function signContractText(contractText, privateKeyJwk) {
  const privateKey = await importPrivateKey(privateKeyJwk);
  const encoder = new TextEncoder();
  const data = encoder.encode(canonicalizeText(contractText)); // canonicalize before signing
  const signature = await window.crypto.subtle.sign(
    { name: "RSASSA-PKCS1-v1_5" },
    privateKey,
    data
  );
  return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

// Verification with provided public JWK
export async function verifyContractSignature(contractText, signatureBase64, publicKeyJwk) {
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
  } catch {
    return false;
  }
}

// Helper: sign with a freshly generated key and return versioned signature payload
export async function signWithNewKey(uid, contractText) {
  const { privateKeyJwk, keyVersion } = await generateSigningKeys(uid);
  const signature = await signContractText(contractText, privateKeyJwk);
  return { signature, keyVersion };
}

// Helper: verify using uid + version (loads public key by version from Firestore)
export async function verifyWithUidVersion(uid, keyVersion, contractText, signatureBase64) {
  const infoRef = doc(db, "info", uid);
  const infoSnap = await getDoc(infoRef);
  if (!infoSnap.exists()) return false;
  const data = infoSnap.data();
  const publicKeyJwk = data?.publicKeys?.[keyVersion];
  if (!publicKeyJwk) return false;
  return await verifyContractSignature(contractText, signatureBase64, publicKeyJwk);
}

// Download text helper
export function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}