import express from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";
import 'dotenv/config';

const router = express.Router();

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

console.log("Gemini API Key:", GEMINI_API_KEY);

const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

async function askGemini(prompt) {
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
  const result = await model.generateContent(prompt);
  // Correct: get the text with await
  return await result.response.text();
}

router.get("/api/chatgpt-seasonal-demand", async (req, res) => {
  const item = req.query.item;
  const type = req.query.type;

  if (type === "list") {
    // Ask Gemini for a list of high-demand items in India right now
    const prompt = `List 5 items that are in high demand in India right now and give a short reason for each. Format: name - reason.`;
    try {
      const answer = await askGemini(prompt);
      console.log("Gemini raw answer:", answer); // <-- Add this line
      // Accept bullets, markdown, or dash-separated
      const items = answer
        .split('\n')
        .map(line => line.replace(/^[\-\*\d\.]+\s*/, '')) // remove bullets/numbers
        .map(line => {
          const [name, ...reasonArr] = line.split('-');
          return { name: name?.trim(), reason: reasonArr.join('-').trim() };
        })
        .filter(i => i.name && i.reason);
      return res.json({ items });
    } catch (err) {
      return res.status(500).json({ error: "Gemini API error", details: err.message });
    }
  }

  if (!item) return res.status(400).json({ error: "Missing item" });

  // For a single item: ask Gemini about demand
  let prompt;
  if (type === "market") {
    prompt = `Is "${item}" currently in high demand in India due to real-world factors such as festivals, holidays, or market trends? Reply ONLY with "yes" or "no" on the first line. Then, in a new line, explain the reason.`;
  } else {
    prompt = `This month in India, is "${item}" in high demand due to any festival, holiday, or season? Reply ONLY with "increase" if yes, or "no increase" if no. Then, in a new line, explain the reason.`;
  }

  try {
    const answer = await askGemini(prompt);
    console.log("Gemini raw answer:", answer); // <-- Add this line
    const lines = answer.split('\n').map(l => l.trim()).filter(Boolean);
    const firstLine = lines[0]?.toLowerCase();
    let demand = false;
    let recommendation = type === "market" ? "Recommended" : "Seasonal ↓";
    if (type === "market" && firstLine.includes("yes")) demand = true;
    if (type !== "market" && firstLine.includes("increase")) {
      demand = true;
      recommendation = "Seasonal ↑";
    }
    const reason = lines.slice(1).join(' ').trim();
    res.json({ demand, reason: reason || answer, recommendation });
  } catch (err) {
    res.status(500).json({ error: "Gemini API error", details: err.message });
  }
});

export default router;