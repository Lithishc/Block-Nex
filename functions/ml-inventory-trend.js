import { collection, getDocs } from "https://www.gstatic.com/firebasejs/10.11.0/firebase-firestore.js";
import { db } from "./firebase-config.js";

/**
 * Helper: Linear regression slope calculation
 */
function linearRegressionSlope(data) {
  const n = data.length;
  if (n < 2) return 0;
  const sumX = data.reduce((sum, d, i) => sum + i, 0);
  const sumY = data.reduce((sum, d) => sum + d.quantity, 0);
  const sumXY = data.reduce((sum, d, i) => sum + i * d.quantity, 0);
  const sumX2 = data.reduce((sum, d, i) => sum + i * i, 0);
  return ((n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX)) || 0;
}

/**
 * Helper: Moving average smoothing
 */
function movingAverage(data, windowSize = 3) {
  if (data.length < windowSize) return data.map(d => d.quantity);
  const result = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - windowSize + 1);
    const window = data.slice(start, i + 1).map(d => d.quantity);
    result.push(window.reduce((a, b) => a + b, 0) / window.length);
  }
  return result;
}

/**
 * Helper: Min-max normalization
 */
function normalize(data) {
  const quantities = data.map(d => d.quantity);
  const min = Math.min(...quantities);
  const max = Math.max(...quantities);
  return data.map(d => ({
    ...d,
    quantity: max === min ? 0.5 : (d.quantity - min) / (max - min)
  }));
}

/**
 * Helper: Simple missing data interpolation (linear)
 */
function interpolateMissing(data) {
  // Assumes data sorted by timestamp
  for (let i = 1; i < data.length; i++) {
    if (data[i].quantity == null) {
      data[i].quantity = (data[i - 1].quantity + (data[i + 1]?.quantity || data[i - 1].quantity)) / 2;
    }
  }
  return data;
}

/**
 * Segment history into time windows
 */
function segmentHistory(history, days) {
  const msPerDay = 24 * 60 * 60 * 1000;
  const now = Date.now();
  return history.filter(h => now - h.timestamp <= days * msPerDay);
}

/**
 * Predict demand adjustment for multiple time windows.
 * Returns array of { window: string, trend: "↑"|"↓"|"→", slope: number, reason: string }
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

  // Define time windows in days
  const windows = [
    { name: "Week", days: 7 },
    { name: "Biweekly", days: 14 },
    { name: "Monthly", days: 28 },
    { name: "6 Weeks", days: 42 }
  ];

  const results = windows.map(win => {
    let segment = segmentHistory(history, win.days);
    if (segment.length < 2) return { window: win.name, trend: "→", slope: 0, reason: "Not enough data." };

    // Missing data handling
    segment = interpolateMissing(segment);

    // Normalization
    segment = normalize(segment);

    // Moving average smoothing
    const smoothedQuantities = movingAverage(segment);

    // Prepare data for regression
    const regressionData = segment.map((d, i) => ({
      quantity: smoothedQuantities[i],
      timestamp: d.timestamp
    }));

    // Model: Linear regression slope
    const slope = linearRegressionSlope(regressionData);

    let trend, reason;
    if (slope > 0.1) {
      trend = "↑";
      reason = `Inventory usage is increasing over the past ${win.name.toLowerCase()}. Consider raising request quantity.`;
    } else if (slope < -0.1) {
      trend = "↓";
      reason = `Inventory usage is decreasing over the past ${win.name.toLowerCase()}. Consider lowering request quantity.`;
    } else {
      trend = "→";
      reason = `Inventory usage is stable over the past ${win.name.toLowerCase()}.`;
    }

    // For advanced time series models (ARIMA, exponential smoothing), consider using a Python microservice or external library.

    return { window: win.name, trend, slope: Number(slope.toFixed(2)), reason };
  });

  return results;
}