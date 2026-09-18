import "dotenv/config";
import express from "express";
import { optimizeEnergyHandler } from "./routes/optimizeEnergy.js";

const app = express();

app.use(express.json({ limit: "2mb" }));

// Malformed JSON bodies land here as a SyntaxError from express.json() —
// respond 400 instead of letting Express's default HTML error page leak.
app.use((err, req, res, next) => {
  if (err instanceof SyntaxError && "body" in err) {
    return res.status(400).json({ error: "invalid_request", details: ["malformed JSON body"] });
  }
  next(err);
});

app.get("/health", (req, res) => {
  res.status(200).json({ status: "ok" });
});

app.post("/optimize-energy", optimizeEnergyHandler);

// Final safety net: never leak stack traces / secrets to the client.
app.use((err, req, res, next) => {
  console.error("Unhandled error:", err);
  res.status(500).json({ error: "internal_error" });
});

const port = process.env.PORT || 8080;
app.listen(port, "0.0.0.0", () => {
  console.log(`GridWise LLM API listening on 0.0.0.0:${port}`);
});
