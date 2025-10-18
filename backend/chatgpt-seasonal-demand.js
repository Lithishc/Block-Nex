import express from "express";
import fetch from "node-fetch";

const router = express.Router();

router.get("/api/chatgpt-seasonal-demand", async (req, res) => {
  const item = req.query.item;
  if (!item) return res.status(400).json({ error: "Missing item" });

  const prompt = `This month in India, is "${item}" in high demand due to any festival, holiday, or season? Reply ONLY with "increase" if yes, or "no increase" if no. Then, in a new line, explain the reason.`;

  try {
    const hfRes = await fetch("https://api-inference.huggingface.co/models/google/gemma-2b", {
      method: "POST",
      headers: {
        "Authorization": "Bearer YOUR_HUGGINGFACE_API_KEY", // Get a free key from https://huggingface.co/settings/tokens
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ inputs: prompt })
    });
    const data = await hfRes.json();
    const answer = Array.isArray(data) ? data[0]?.generated_text : data.generated_text || "";
    // Parse as before
    const firstLine = answer.split('\n')[0].trim().toLowerCase();
    let demand = false;
    let recommendation = "Seasonal ↓";
    if (firstLine === "increase") {
      demand = true;
      recommendation = "Seasonal ↑";
    }
    const reason = answer.split('\n').slice(1).join(' ').trim();
    res.json({ demand, reason: reason || answer, recommendation });
  } catch (err) {
    res.status(500).json({ error: "HF API error", details: err.message });
  }
});

export default router;