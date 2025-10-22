import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { db } from "./firebase-config.js";

/**
 * Advanced ML: Predict demand adjustment based on sales trend.
 * Returns { recommendation: "Trend ↑"|"Trend ↓", reason: string }
 */
export async function getInventoryTrendPrediction(uid, itemID) {
  const itemRef = doc(db, "users", uid, "inventory", itemID);
  const itemSnap = await getDoc(itemRef);
  if (itemSnap.exists() && itemSnap.data().mlTrend) {
    return itemSnap.data().mlTrend;
  }
  return null;
}