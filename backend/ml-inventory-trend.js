import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { db } from "./firebase-config.js";

/**
 * Predict demand adjustment based on inventory history.
 * Returns { recommendation: "Trend ↑"|"Trend ↓", reason: string }
 */
export async function getInventoryTrendPrediction(uid, itemID) {
  const histSnap = await getDocs(collection(db, "users", uid, "inventoryHistory"));
  const history = [];
  histSnap.forEach(doc => {
    const d = doc.data();
    if (d.itemID === itemID) history.push({ quantity: Number(d.quantity), timestamp: d.timestamp });
  });
  if (history.length < 2) return null;
  history.sort((a, b) => a.timestamp - b.timestamp);
  const recent = history.slice(-5);
  const avgOld = recent.slice(0, 2).reduce((sum, h) => sum + h.quantity, 0) / 2;
  const avgNew = recent.slice(-2).reduce((sum, h) => sum + h.quantity, 0) / 2;
  if (avgNew > avgOld) {
    return { recommendation: "Trend ↑", reason: "Recent inventory usage is increasing. Consider raising request quantity." };
  } else if (avgNew < avgOld) {
    return { recommendation: "Trend ↓", reason: "Recent inventory usage is decreasing. Consider lowering request quantity." };
  }
  return null;
}