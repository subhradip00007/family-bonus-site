import "dotenv/config";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import cookieParser from "cookie-parser";
import { URL } from "node:url";
import db from "./db.js";
import authRoutes from "./auth.js";
import devAdminRoutes from "./devAdmin.js";
import bonusPeriodRoutes from "./bonusPeriods.js";

const app = express();

if (process.env.NODE_ENV === "production") {
  const requiredEnv = ["GOOGLE_CLIENT_ID", "JWT_SECRET", "DEV_EMAIL", "CLIENT_URL"];
  const missingEnv = requiredEnv.filter((name) => !process.env[name]?.trim());
  if (missingEnv.length > 0) {
    throw new Error(`Missing required production environment variables: ${missingEnv.join(", ")}`);
  }
  if (Buffer.byteLength(process.env.JWT_SECRET) < 32) {
    throw new Error("JWT_SECRET must be at least 32 bytes in production");
  }
  const clientUrl = new URL(process.env.CLIENT_URL);
  if (clientUrl.protocol !== "https:" || clientUrl.origin !== process.env.CLIENT_URL) {
    throw new Error("CLIENT_URL must be the exact HTTPS origin, without a trailing slash");
  }
}

const trustedProxyHops = Number(process.env.TRUST_PROXY_HOPS || 0);
if (Number.isInteger(trustedProxyHops) && trustedProxyHops > 0) {
  app.set("trust proxy", trustedProxyHops);
}

app.use(helmet({ frameguard: { action: "deny" } }));
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use("/api", rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: "Too many requests. Please try again later." }),
}));
app.use(express.json({ limit: "2mb" }));
app.use(cookieParser());
app.use("/api/auth", authRoutes);
app.use("/api/dev-admin", devAdminRoutes);
app.use("/api", bonusPeriodRoutes);

app.get("/api/families", (_req, res) => {
  const families = db.prepare(`
    SELECT id, name, logo FROM families
    WHERE active = 1
    ORDER BY name COLLATE NOCASE
  `).all();
  res.json({ families });
});

app.get("/api/health", (req, res) => {
  res.json({ ok: true });
});

const PORT = Number(process.env.PORT || 5000);
const HOST = process.env.HOST || "127.0.0.1";
app.listen(PORT, HOST, () => console.log(`Server running on ${HOST}:${PORT}`));
