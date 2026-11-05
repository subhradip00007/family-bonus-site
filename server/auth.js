import express from "express";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { OAuth2Client } from "google-auth-library";
import db from "./db.js";

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const sessionLifetimeMs = 7 * 24 * 60 * 60 * 1000;
const googleLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (_req, res) => res.status(429).json({ error: "Too many sign-in attempts. Please wait and try again." }),
});

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
    picture: user.picture,
    role: user.role,
    familyId: user.family_id,
    needsUsername: !user.username,
  };
}

function attachPendingRoles(user) {
  const pendingRoles = db.prepare(
    "SELECT id, family_id, role FROM pending_member_roles WHERE email = ? COLLATE NOCASE"
  ).all(user.email);
  if (pendingRoles.length === 0) return;

  db.transaction(() => {
    for (const pending of pendingRoles) {
      db.prepare(`
        INSERT INTO family_members (family_id, user_id) VALUES (?, ?)
        ON CONFLICT (family_id, user_id) DO NOTHING
      `).run(pending.family_id, user.id);
      const membership = db.prepare(
        "SELECT id FROM family_members WHERE family_id = ? AND user_id = ?"
      ).get(pending.family_id, user.id);
      db.prepare(`
        INSERT INTO member_roles (membership_id, role) VALUES (?, ?)
        ON CONFLICT (membership_id, role) DO NOTHING
      `).run(membership.id, pending.role);
      db.prepare("DELETE FROM pending_member_roles WHERE id = ?").run(pending.id);
    }
  })();
}

router.post("/google", googleLoginLimiter, async (req, res) => {
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

    const picture = payload.picture || null;
    db.prepare("UPDATE users SET picture = ? WHERE id = ?").run(picture, user.id);
    user.picture = picture;
    attachPendingRoles(user);

    const sessionId = randomUUID();
    const expiresAt = Date.now() + sessionLifetimeMs;
    const token = jwt.sign({ userId: user.id, sessionId }, process.env.JWT_SECRET, {
      expiresIn: "7d",
    });
    db.prepare("DELETE FROM auth_sessions WHERE expires_at <= ? OR revoked_at IS NOT NULL").run(Date.now());
    db.prepare("INSERT INTO auth_sessions (id, user_id, expires_at) VALUES (?, ?, ?)")
      .run(sessionId, user.id, expiresAt);
    res.cookie("token", token, cookieOptions);
    res.json({ user: publicUser(user) });
  } catch (err) {
    res.status(401).json({ error: "Google sign-in failed" });
  }
});
function requireAuth(req, res, next) {
  try {
    const { userId, sessionId } = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
    if (typeof sessionId !== "string") return res.status(401).json({ error: "Not logged in" });
    const session = db.prepare(`
      SELECT id FROM auth_sessions WHERE id = ? AND user_id = ?
        AND revoked_at IS NULL AND expires_at > ?
    `).get(sessionId, userId, Date.now());
    if (!session) return res.status(401).json({ error: "Not logged in" });
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
  try {
    const claims = jwt.verify(req.cookies.token, process.env.JWT_SECRET);
    if (typeof claims.sessionId === "string") {
      db.prepare(`
        UPDATE auth_sessions SET revoked_at = ?
        WHERE id = ? AND user_id = ? AND revoked_at IS NULL
      `).run(Date.now(), claims.sessionId, claims.userId);
    }
  } catch {
    // Clear invalid or expired cookies too; no active server session can be revoked.
  }
  res.clearCookie("token", cookieOptions);
  res.json({ ok: true });
});

export { requireAuth };

export default router;
