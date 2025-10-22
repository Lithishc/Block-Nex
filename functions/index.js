const functions = require("firebase-functions");
const express = require("express");
const cors = require("cors");
const admin = require("firebase-admin");

// Import your helpers (adjust paths if needed)
const { getSeasonalDemand } = require("../frontend/chatgpt-helper");
const { getInventoryTrendPrediction } = require("../frontend/ml-inventory-trend");

admin.initializeApp();
const app = express();
app.use(cors({ origin: true }));

// AI endpoint for seasonal demand
app.get("/chatgpt-seasonal-demand", async (req, res) => {
  const item = req.query.item;
  const type = req.query.type;
  try {
    // Optionally handle different types/prompts here
    if (type === "list" && req.method === "POST") {
      // For POST requests with a custom prompt
      const { prompt } = req.body;
      // You may need to adjust your helper to accept a prompt
      const result = await getSeasonalDemand(prompt);
      return res.json(result);
    }
    const result = await getSeasonalDemand(item);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "AI error" });
  }
});

// Example ML endpoint (if needed)
app.get("/ml-inventory-trend", async (req, res) => {
  const item = req.query.item;
  try {
    const result = await getInventoryTrendPrediction(item);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message || "ML error" });
  }
});

// Runs every 3 days at 2:00 AM UTC
exports.runInventoryMLTrend = functions.pubsub.schedule('0 2 */3 * *').onRun(async (context) => {
  const db = admin.firestore();
  const usersSnap = await db.collection("users").get();

  for (const userDoc of usersSnap.docs) {
    const uid = userDoc.id;
    const inventorySnap = await db.collection("users").doc(uid).collection("inventory").get();
    for (const itemDoc of inventorySnap.docs) {
      const itemID = itemDoc.data().itemID;
      // Get inventoryHistory for this item
      const histSnap = await db.collection("users").doc(uid).collection("inventoryHistory")
        .where("itemID", "==", itemID)
        .get();
      const sales = [];
      histSnap.forEach(doc => {
        const d = doc.data();
        if (d.type === "sale") {
          sales.push({ delta: Math.abs(Number(d.delta)), timestamp: d.timestamp });
        }
      });
      if (sales.length < 2) continue;
      sales.sort((a, b) => a.timestamp - b.timestamp);

      // Group sales by day
      const salesByDay = {};
      sales.forEach(s => {
        const day = new Date(s.timestamp).toISOString().slice(0, 10);
        salesByDay[day] = (salesByDay[day] || 0) + s.delta;
      });
      const days = Object.keys(salesByDay).sort();
      if (days.length < 2) continue;

      // Compare average sales per day: recent 3 days vs previous 3 days
      const recentDays = days.slice(-3);
      const prevDays = days.slice(-6, -3);
      const avgRecent = recentDays.reduce((sum, d) => sum + salesByDay[d], 0) / recentDays.length;
      const avgPrev = prevDays.length ? prevDays.reduce((sum, d) => sum + salesByDay[d], 0) / prevDays.length : 0;

      let recommendation = null, reason = "";
      if (avgRecent > avgPrev) {
        recommendation = "Trend ↑";
        reason = "Sales are increasing in recent days. Consider raising request quantity.";
      } else if (avgRecent < avgPrev) {
        recommendation = "Trend ↓";
        reason = "Sales are slowing down. Consider lowering request quantity.";
      }

      // Store the ML result in Firestore for this item
      if (recommendation) {
        await db.collection("users").doc(uid).collection("inventory").doc(itemDoc.id)
          .set({ mlTrend: { recommendation, reason, updatedAt: Date.now() } }, { merge: true });
      }
    }
  }
  return null;
});

exports.api = functions.https.onRequest(app);