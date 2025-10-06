import express from "express";
import fetch from "node-fetch";
const router = express.Router();

router.get("/api/chatgpt-seasonal-demand", async (req, res) => {
  const item = req.query.item;
  if (!item) return res.status(400).json({ error: "Missing item" });

  // Improved prompt for clearer answers
  const prompt = `Is "${item}" in high demand in India this month due to any festival, holiday, or season? If yes, reply with "increase" and explain why. If no, reply with "no increase".`;

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
    console.log("ChatGPT answer:", answer); // Debug output

    // Improved demand detection
    let demand = false;
    let recommendation = "Seasonal ↓";
    if (/increase/i.test(answer)) {
      demand = true;
      recommendation = "Seasonal ↑";
    }
    res.json({ demand, reason: answer, recommendation });
  } catch (err) {
    res.status(500).json({ error: "OpenAI API error", details: err.message });
  }
});

export default router;