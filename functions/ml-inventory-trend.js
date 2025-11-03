import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { db } from "./firebase-config.js";

/**
 * Helper: Linear regression slope calculation
 */
function linearRegressionSlope(data) {
  const n = data.length;
  if (n < 2) return 0;
  const sumX = data.reduce((s, _, i) => s + i, 0);
  const sumY = data.reduce((s, d) => s + d.quantity, 0);
  const sumXY = data.reduce((s, d, i) => s + i * d.quantity, 0);
  const sumX2 = data.reduce((s, _, i) => s + i * i, 0);
  return ((n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)) || 0;
}

/**
 * Helper: Moving average smoothing
 */
function movingAverage(data, w = 3) {
  if (data.length < w) return data.map(d => d.quantity);
  const out = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - w + 1);
    const window = data.slice(start, i + 1).map(d => d.quantity);
    out.push(window.reduce((a, b) => a + b, 0) / window.length);
  }
  return out;
}

/**
 * Helper: Min-max normalization
 */
function normalize(data) {
  const q = data.map(d => d.quantity);
  const min = Math.min(...q), max = Math.max(...q);
  return data.map(d => ({ ...d, quantity: max === min ? 0.5 : (d.quantity - min) / (max - min) }));
}

/**
 * Segment history into time windows
 */
function segmentHistory(history, days) {
  const ms = 24 * 60 * 60 * 1000, now = Date.now();
  return history.filter(h => now - h.timestamp <= days * ms);
}

/**
 * Predict demand adjustment for multiple time windows.
 * Returns array of { window: string, trend: "↑"|"↓"|"→", slope: number, reason: string }
 */
export async function getInventoryTrendPrediction(uid, itemID) {
  const snap = await getDocs(collection(db, "users", uid, "inventoryHistory"));
  const history = [];
  snap.forEach(doc => {
    const d = doc.data();
    if (d.itemID === itemID) history.push({ quantity: Number(d.quantity), timestamp: d.timestamp });
  });
  if (history.length < 2) return null;
  history.sort((a, b) => a.timestamp - b.timestamp);

  // Define time windows in days
  const windows = [
    { name: "Week", days: 7 },
    { name: "Biweekly", days: 14 },
    { name: "Monthly", days: 28 },
    { name: "6 Weeks", days: 42 }
  ];

  return windows.map(win => {
    let seg = segmentHistory(history, win.days);
    if (seg.length < 2) return { window: win.name, trend: "→", slope: 0, reason: "Not enough data." };
    seg = normalize(seg);
    const smooth = movingAverage(seg);
    const slope = linearRegressionSlope(seg.map((d, i) => ({ quantity: smooth[i] })));
    const trend = slope > 0.1 ? "↑" : slope < -0.1 ? "↓" : "→";
    const reason = trend === "↑"
      ? `Usage increasing in last ${win.name.toLowerCase()}.`
      : trend === "↓"
        ? `Usage decreasing in last ${win.name.toLowerCase()}.`
        : `Usage stable in last ${win.name.toLowerCase()}.`;
    return { window: win.name, trend, slope: Number(slope.toFixed(2)), reason };
  });
}