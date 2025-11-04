const API_BASE = "http://localhost:3000";

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function waitForEvent(txHash, expectedEvent, timeoutMs = 120000, intervalMs = 2000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(`${API_BASE}/api/bc/receipt/${txHash}`, { cache: "no-store" });
    const j = await r.json();
    if (j.status === "confirmed") {
      if (!expectedEvent || j.event === expectedEvent) return j;
      return j; // confirmed anyway
    }
    if (j.status === "reverted") throw new Error("Transaction reverted");
    await sleep(intervalMs);
  }
  throw new Error("Timeout waiting for confirmation");
}

export async function createRestockOnChain({ dealerUid, skuId, qty }) {
  const r = await fetch(`${API_BASE}/api/bc/procurements?fast=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dealerUid, skuId, qty: Number(qty), fast: 1 }),
  });
  const j = await r.json();
  if (!r.ok || !j.txHash) throw new Error(j.error || "Blockchain error");
  const rcpt = await waitForEvent(j.txHash, "ProcurementCreated");
  return { ok: true, procurementId: rcpt.procurementId, txHash: j.txHash };
}

export async function submitOnChainOffer({ procurementId, supplierUid, price, details }) {
  const r = await fetch(`${API_BASE}/api/bc/offers?fast=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ procurementId: Number(procurementId), supplierUid, price: Number(price), details: String(details || ""), fast: 1 }),
  });
  const j = await r.json();
  if (!r.ok || !j.txHash) throw new Error(j.error || "Blockchain error");
  const rcpt = await waitForEvent(j.txHash, "OfferSubmitted");
  return { ok: true, offerId: rcpt.offerId, txHash: j.txHash };
}

export async function acceptOnChainOffer({ procurementId, offerId }) {
  const r = await fetch(`${API_BASE}/api/bc/offers/accept?fast=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ procurementId: Number(procurementId), offerId: Number(offerId), fast: 1 }),
  });
  const j = await r.json();
  if (!r.ok || !j.txHash) throw new Error(j.error || "Blockchain accept failed");
  await waitForEvent(j.txHash, "OfferAccepted");
  return { ok: true, txHash: j.txHash };
}

// Aliases
export const createOfferOnChain = submitOnChainOffer;
export const acceptOfferOnChain = acceptOnChainOffer;