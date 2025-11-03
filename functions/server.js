import express from "express";
import cors from "cors";
import 'dotenv/config';

import blockchainRouter from "./blockchain-api.js";
import chatgptSeasonalRouter from "./chatgpt-seasonal-demand.js";

const app = express();
app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => res.json({ ok: true, service: "block-nex-functions" }));

// APIs
app.use(blockchainRouter);
app.use(chatgptSeasonalRouter);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});