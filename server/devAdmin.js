import express from "express";
import db from "./db.js";
import { requireAuth } from "./auth.js";

const router = express.Router();
const allowedRoles = new Set(["Super Admin"]);

function recordRoleAudit(req, familyId, action, role, email) {
  db.prepare(`
    INSERT INTO family_audit_log (family_id, actor_user_id, actor_label, action, summary, details)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    familyId,
    req.user.id,
    req.user.username || req.user.email,
    action,
    `${role} ${action === "role_assigned" ? "assigned to" : "removed from"} ${email}`,
    JSON.stringify({ role, email }),
  );
}

router.use(requireAuth, (req, res, next) => {
  if (req.user.role !== "dev") {
    return res.status(403).json({ error: "Dev access required" });
  }
  next();
});

function getOverview() {
  const families = db.prepare(`
    SELECT f.id, f.name, f.logo, f.active, f.created_at AS createdAt,
      COUNT(DISTINCT fm.user_id) AS memberCount,
      COUNT(DISTINCT mr.id) + COUNT(DISTINCT pmr.id) AS assignmentCount
    FROM families f
    LEFT JOIN family_members fm ON fm.family_id = f.id
    LEFT JOIN member_roles mr ON mr.membership_id = fm.id
    LEFT JOIN pending_member_roles pmr ON pmr.family_id = f.id
    GROUP BY f.id
    ORDER BY f.name COLLATE NOCASE
  `).all();

  const assignments = db.prepare(`
    SELECT mr.id, u.email, u.username, f.id AS familyId, f.name AS familyName,
      mr.role, f.active, mr.created_at AS createdAt, 0 AS pending,
      'role-' || mr.id AS assignmentId
    FROM member_roles mr
    JOIN family_members fm ON fm.id = mr.membership_id
    JOIN users u ON u.id = fm.user_id
    JOIN families f ON f.id = fm.family_id
    UNION ALL
    SELECT pmr.id, pmr.email, NULL AS username, f.id AS familyId, f.name AS familyName,
      pmr.role, f.active, pmr.created_at AS createdAt, 1 AS pending,
      'pending-' || pmr.id AS assignmentId
    FROM pending_member_roles pmr
    JOIN families f ON f.id = pmr.family_id
    ORDER BY createdAt DESC, assignmentId DESC
  `).all();

  return { families, assignments };
}

router.get("/overview", (_req, res) => {
  res.json(getOverview());
});

router.post("/families", (req, res) => {
  const name = (req.body.name || "").trim();
  if (name.length < 2 || name.length > 40) {
    return res.status(400).json({ error: "Family name must be 2–40 characters" });
  }

  try {
    db.prepare("INSERT INTO families (name) VALUES (?)").run(name);
    res.status(201).json(getOverview());
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "A family with that name already exists" });
    }
    throw error;
  }
});

router.delete("/families/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Invalid family" });
  const family = db.prepare("SELECT id, name FROM families WHERE id = ?").get(id);
  if (!family) return res.status(404).json({ error: "Family not found" });

  db.transaction(() => {
    db.prepare("UPDATE users SET family_id = NULL WHERE family_id = ?").run(id);
    db.prepare("DELETE FROM families WHERE id = ?").run(id);
  })();

  res.json(getOverview());
});

router.patch("/families/:id", (req, res) => {
  const id = Number(req.params.id);
  const current = db.prepare("SELECT * FROM families WHERE id = ?").get(id);
  if (!current) return res.status(404).json({ error: "Family not found" });

  const name = req.body.name === undefined ? current.name : String(req.body.name).trim();
  const active = req.body.active === undefined ? current.active : Number(Boolean(req.body.active));
  const logo = Object.hasOwn(req.body, "logo") ? req.body.logo : current.logo;
  if (name.length < 2 || name.length > 40) {
    return res.status(400).json({ error: "Family name must be 2–40 characters" });
  }
  if (logo !== null && logo !== undefined) {
    const match = typeof logo === "string"
      ? logo.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/)
      : null;
    if (!match) return res.status(400).json({ error: "Logo must be a PNG, JPG, or WebP image" });
    if (Buffer.byteLength(match[2], "base64") > 1024 * 1024) {
      return res.status(413).json({ error: "Logo must be 1 MB or smaller" });
    }
  }

  try {
    db.prepare("UPDATE families SET name = ?, active = ?, logo = ? WHERE id = ?")
      .run(name, active, logo, id);
    res.json(getOverview());
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "A family with that name already exists" });
    }
    throw error;
  }
});

router.post("/assignments", (req, res) => {
  const familyId = Number(req.body.familyId);
  const email = String(req.body.email || "").trim().toLowerCase();
  const role = String(req.body.role || "");
  if (!Number.isInteger(familyId) || !email || !allowedRoles.has(role)) {
    return res.status(400).json({ error: "Choose a family, enter an email, and select a valid role" });
  }

  const family = db.prepare("SELECT * FROM families WHERE id = ?").get(familyId);
  if (!family) return res.status(404).json({ error: "Family not found" });
  if (!family.active) return res.status(409).json({ error: "Enable this family before assigning roles" });
  const user = db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(email);

  if (!user) {
    try {
      db.prepare("INSERT INTO pending_member_roles (family_id, email, role) VALUES (?, ?, ?)")
        .run(familyId, email, role);
      recordRoleAudit(req, familyId, "role_assigned", role, email);
      return res.status(201).json(getOverview());
    } catch (error) {
      if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
        return res.status(409).json({ error: "That player already has this role in this family" });
      }
      throw error;
    }
  }

  const addRole = db.transaction(() => {
    let membership = db.prepare(
      "SELECT id FROM family_members WHERE family_id = ? AND user_id = ?"
    ).get(familyId, user.id);
    if (!membership) {
      const result = db.prepare(
        "INSERT INTO family_members (family_id, user_id) VALUES (?, ?)"
      ).run(familyId, user.id);
      membership = { id: result.lastInsertRowid };
    }
    db.prepare("INSERT INTO member_roles (membership_id, role) VALUES (?, ?)").run(membership.id, role);
  });

  try {
    addRole();
    recordRoleAudit(req, familyId, "role_assigned", role, email);
    res.status(201).json(getOverview());
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "That player already has this role in this family" });
    }
    throw error;
  }
});

router.delete("/assignments/:id", (req, res) => {
  const [kind, rawId] = String(req.params.id).split("-");
  const id = Number(rawId ?? kind);
  const isPending = kind === "pending";
  if (!Number.isInteger(id)) return res.status(400).json({ error: "Invalid role assignment" });

  if (isPending) {
    const assignment = db.prepare("SELECT family_id AS familyId, email, role FROM pending_member_roles WHERE id = ? AND role = 'Super Admin'").get(id);
    const result = db.prepare("DELETE FROM pending_member_roles WHERE id = ? AND role = 'Super Admin'").run(id);
    if (!result.changes) return res.status(404).json({ error: "Role assignment not found" });
    recordRoleAudit(req, assignment.familyId, "role_removed", assignment.role, assignment.email);
    return res.json(getOverview());
  }

  const removeRole = db.transaction(() => {
    const assignment = db.prepare(`
      SELECT mr.membership_id AS membershipId, fm.family_id AS familyId, u.email, mr.role
      FROM member_roles mr
      JOIN family_members fm ON fm.id = mr.membership_id
      JOIN users u ON u.id = fm.user_id
      WHERE mr.id = ? AND mr.role = 'Super Admin'
    `).get(id);
    if (!assignment) return false;
    db.prepare("DELETE FROM member_roles WHERE id = ?").run(id);
    db.prepare(`
      DELETE FROM family_members
      WHERE id = ? AND NOT EXISTS (
        SELECT 1 FROM member_roles WHERE membership_id = ?
      )
    `).run(assignment.membershipId, assignment.membershipId);
    return assignment;
  });

  const assignment = removeRole();
  if (!assignment) return res.status(404).json({ error: "Role assignment not found" });
  recordRoleAudit(req, assignment.familyId, "role_removed", assignment.role, assignment.email);
  res.json(getOverview());
});

export default router;
