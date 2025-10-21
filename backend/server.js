import express from "express";
import cors from "cors";
import chatgptSeasonalRouter from "./chatgpt-seasonal-demand.js";
import 'dotenv/config'; 

const app = express();
app.use(cors());
app.use(express.json());
app.use(chatgptSeasonalRouter);

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
});