import express from "express";
import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { ethers } from "ethers";
import "dotenv/config";

const router = express.Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load ABI (functions/abi then artifacts fallback)
const tryPaths = [
  path.join(__dirname, "abi", "BlockNexSupply.json"),
  path.join(__dirname, "..", "artifacts", "contracts", "BlockNexSupply.sol", "BlockNexSupply.json"),
];
let abiJson;
for (const p of tryPaths) {
  try { abiJson = JSON.parse(readFileSync(p, "utf-8")); break; } catch {}
}
if (!abiJson?.abi?.length) {
  throw new Error("ABI missing/empty. Re-copy artifact to functions/abi.");
}
const abi = abiJson.abi;

if (!process.env.SEPOLIA_RPC_URL) throw new Error("Missing SEPOLIA_RPC_URL");
if (!process.env.PRIVATE_KEY) throw new Error("Missing PRIVATE_KEY");
if (!process.env.CONTRACT_ADDRESS) throw new Error("Missing CONTRACT_ADDRESS");

const provider = new ethers.JsonRpcProvider(process.env.SEPOLIA_RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
const contract = new ethers.Contract(process.env.CONTRACT_ADDRESS, abi, wallet);

// Parse a receipt for known events
function parseReceiptFor(contractIface, receipt) {
  let parsed = { event: null, procurementId: null, offerId: null };
  for (const l of receipt.logs || []) {
    try {
      const ev = contractIface.parseLog(l);
      if (ev?.name === "ProcurementCreated") {
        parsed = { ...parsed, event: ev.name, procurementId: ev.args?.[0]?.toString() };
      } else if (ev?.name === "OfferSubmitted") {
        parsed = { ...parsed, event: ev.name, offerId: ev.args?.[0]?.toString() };
      } else if (ev?.name === "OfferAccepted") {
        parsed = { ...parsed, event: ev.name };
      }
    } catch {}
  }
  return parsed;
}

// GET /api/bc/receipt/:hash -> non-blocking poll
router.get("/api/bc/receipt/:hash", async (req, res) => {
  try {
    const hash = String(req.params.hash);
    const rcpt = await provider.getTransactionReceipt(hash);
    if (!rcpt) return res.json({ status: "pending" });
    const parsed = parseReceiptFor(contract.interface, rcpt);
    res.json({
      status: rcpt.status === 1 ? "confirmed" : "reverted",
      txHash: rcpt.transactionHash,
      ...parsed
    });
  } catch (e) {
    res.status(500).json({ status: "error", error: String(e.message || e) });
  }
});

// POST /api/bc/procurements[?fast=1]
router.post("/api/bc/procurements", async (req, res) => {
  try {
    const { dealerUid, skuId, qty } = req.body || {};
    if (!dealerUid || !skuId || qty === undefined) {
      return res.status(400).json({ error: "Missing fields: dealerUid, skuId, qty" });
    }
    const fast = String(req.query.fast || req.body.fast || "") === "1";
    const tx = await contract.createProcurement(String(dealerUid), String(skuId), Number(qty));
    if (fast) return res.json({ ok: true, txHash: tx.hash });
    const rcpt = await tx.wait();
    const parsed = parseReceiptFor(contract.interface, rcpt);
    res.json({ ok: true, procurementId: parsed.procurementId, txHash: rcpt.hash });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// POST /api/bc/offers[?fast=1]
router.post("/api/bc/offers", async (req, res) => {
  try {
    const { procurementId, supplierUid, price, details } = req.body || {};
    if (!procurementId || !supplierUid || price === undefined) {
      return res.status(400).json({ error: "Missing fields: procurementId, supplierUid, price" });
    }
    const fast = String(req.query.fast || req.body.fast || "") === "1";
    const tx = await contract.submitOffer(Number(procurementId), String(supplierUid), Number(price), String(details || ""));
    if (fast) return res.json({ ok: true, txHash: tx.hash });
    const rcpt = await tx.wait();
    const parsed = parseReceiptFor(contract.interface, rcpt);
    res.json({ ok: true, offerId: parsed.offerId, txHash: rcpt.hash });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

// POST /api/bc/offers/accept[?fast=1]
router.post("/api/bc/offers/accept", async (req, res) => {
  try {
    const { procurementId, offerId } = req.body || {};
    if (!procurementId || !offerId) {
      return res.status(400).json({ error: "Missing fields: procurementId, offerId" });
    }
    const fast = String(req.query.fast || req.body.fast || "") === "1";
    const tx = await contract.acceptOffer(Number(procurementId), Number(offerId));
    if (fast) return res.json({ ok: true, txHash: tx.hash });
    const rcpt = await tx.wait();
    res.json({ ok: true, txHash: rcpt.hash });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  }
});

export default router;