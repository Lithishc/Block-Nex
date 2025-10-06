import express from "express";
import fetch from "node-fetch";

const router = express.Router();

router.get("/api/chatgpt-seasonal-demand", async (req, res) => {
  const item = req.query.item;
  if (!item) return res.status(400).json({ error: "Missing item" });

  // Compose prompt for Indian holidays and seasonal demand
  const prompt = `Is there a seasonal or holiday demand for "${item}" in India this month? If yes, should the restock request quantity be increased or decreased? Explain the reason and mention the festival or season.`;

  try {
    const openaiRes = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer YOUR_OPENAI_API_KEY`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "gpt-3.5-turbo",
        messages: [{ role: "user", content: prompt }],
        max_tokens: 100
      })
    });
    const data = await openaiRes.json();
    const answer = data.choices?.[0]?.message?.content || "";
    let recommendation = "";
    if (/increase/i.test(answer)) recommendation = "Seasonal ↑";
    else if (/decrease/i.test(answer)) recommendation = "Seasonal ↓";
    res.json({ demand: !!recommendation, reason: answer, recommendation });
  } catch (err) {
    res.status(500).json({ error: "OpenAI API error", details: err.message });
  }
});

export default router;