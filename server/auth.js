import express from "express";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";
import db from "./db.js";

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);

const cookieOptions = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  maxAge: 7 * 24 * 60 * 60 * 1000,
};

function publicUser(user) {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    role: user.role,
    familyId: user.family_id,
    needsUsername: !user.username,
  };
}

router.post("/google", async (req, res) => {
  try {
    const ticket = await googleClient.verifyIdToken({
      idToken: req.body.credential,
      audience: process.env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();

    if (!payload.email_verified) {
      return res.status(401).json({ error: "Email not verified" });
    }

    const email = payload.email.toLowerCase();
    const isDev = email === process.env.DEV_EMAIL?.toLowerCase();

    let user = db.prepare("SELECT * FROM users WHERE email = ?").get(email);

    if (!user) {
      const role = isDev ? "dev" : "none";
      const result = db
        .prepare("INSERT INTO users (email, role) VALUES (?, ?)")
        .run(email, role);
      user = db
        .prepare("SELECT * FROM users WHERE id = ?")
        .get(result.lastInsertRowid);
    } else if (isDev && user.role !== "dev") {
      db.prepare("UPDATE users SET role = 'dev' WHERE id = ?").run(user.id);
      user.role = "dev";
    }

    const token = jwt.sign({ userId: user.id }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    res.cookie("token", token, cookieOptions);
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(401).json({ error: "Google sign-in failed" });
  }
});
function requireAuth(req, res, next) {
  try {
    const { userId } = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
    const user = db.prepare("SELECT * FROM users WHERE id = ?").get(userId);
    if (!user) return res.status(401).json({ error: "Not logged in" });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Not logged in" });
  }
}

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: publicUser(req.user) });
});

router.post("/username", requireAuth, (req, res) => {
  const username = (req.body.username || "").trim();
  if (username.length < 2 || username.length > 30) {
    return res.status(400).json({ error: "Username must be 2-30 characters" });
  }
  db.prepare("UPDATE users SET username = ? WHERE id = ?").run(
    username,
    req.user.id
  );
  const user = db.prepare("SELECT * FROM users WHERE id = ?").get(req.user.id);
  res.json({ user: publicUser(user) });
});

router.post("/logout", (req, res) => {
  res.clearCookie("token", cookieOptions);
  res.json({ ok: true });
});

export { requireAuth };

export default router;