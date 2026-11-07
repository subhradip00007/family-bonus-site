import express from "express";
import db from "./db.js";
import { requireAuth } from "./auth.js";

const router = express.Router();

function recordAudit(req, familyId, action, summary, details = {}, periodId = null) {
  db.prepare(`
    INSERT INTO family_audit_log (family_id, period_id, actor_user_id, actor_label, action, summary, details)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(familyId, periodId, req.user.id, req.user.username || req.user.email, action, summary, JSON.stringify(details));
}

function sheetSnapshot(sheet) {
  return {
    name: sheet.period.name,
    startDate: sheet.period.startDate,
    endDate: sheet.period.endDate,
    status: sheet.period.status,
    events: sheet.events.map((event) => ({ name: event.name, rate: event.rate })),
    players: sheet.players.map((player) => ({
      name: player.name,
      strikePercent: player.strikePercent,
      paidStatus: player.paidStatus,
      counts: Object.fromEntries(sheet.events.map((event) => [event.name, player.counts[event.id] || 0])),
    })),
  };
}

function getFamily(familyId) {
  return db.prepare("SELECT id, name, logo, active FROM families WHERE id = ?").get(familyId);
}

function getRole(user, familyId) {
  if (user.role === "dev") return "Dev";
  const roles = db.prepare(`
    SELECT mr.role
    FROM family_members fm
    JOIN member_roles mr ON mr.membership_id = fm.id
    WHERE fm.family_id = ? AND fm.user_id = ?
  `).all(familyId, user.id).map((row) => row.role);
  if (roles.includes("Super Admin")) return "Super Admin";
  if (roles.includes("Deputy")) return "Deputy";
  if (roles.includes("HC")) return "HC";
  return null;
}

function requireFamilyAccess(req, res) {
  const familyId = Number(req.params.familyId);
  const family = getFamily(familyId);
  if (!family || !family.active) {
    res.status(404).json({ error: "Family not found" });
    return null;
  }
  const role = getRole(req.user, familyId);
  if (!role) {
    res.status(403).json({ error: "You do not have access to this family" });
    return null;
  }
  return { family, role, familyId };
}

function requireManager(access, res) {
  if (access.role === "Dev" || access.role === "Super Admin" || access.role === "Deputy") return true;
  res.status(403).json({ error: "Super Admin or Deputy access required" });
  return false;
}

function canEditPeriod(access, status) {
  if (["Dev", "Super Admin", "Deputy"].includes(access.role)) return true;
  return access.role === "HC" && status === "active";
}

function lockPayload(lock) {
  return lock ? { owner: lock.owner_label, expiresAt: lock.expires_at } : null;
}

function requireSheetLock(req, res, familyId, periodId) {
  const lock = db.prepare("SELECT * FROM bonus_sheet_locks WHERE period_id = ? AND family_id = ?")
    .get(periodId, familyId);
  if (lock && lock.expires_at <= Date.now()) {
    db.prepare("DELETE FROM bonus_sheet_locks WHERE period_id = ? AND expires_at <= ?").run(periodId, Date.now());
  }
  if (lock && lock.expires_at > Date.now() && lock.user_id === req.user.id && lock.token === req.get("X-Sheet-Lock")) return true;
  res.status(423).json({
    error: lock && lock.expires_at > Date.now() ? `${lock.owner_label} is editing this sheet` : "Your edit lock expired. Reopen the sheet to continue editing.",
    lock: lock && lock.expires_at > Date.now() ? lockPayload(lock) : null,
  });
  return false;
}

function familyRoster(familyId) {
  const members = db.prepare(`
    SELECT fm.id AS membershipId, u.email, u.username,
      GROUP_CONCAT(mr.role, ',') AS roles
    FROM family_members fm
    JOIN users u ON u.id = fm.user_id
    LEFT JOIN member_roles mr ON mr.membership_id = fm.id
    WHERE fm.family_id = ?
    GROUP BY fm.id
    ORDER BY u.email COLLATE NOCASE
  `).all(familyId).map((member) => ({ ...member, roles: member.roles ? member.roles.split(",") : [] }));
  const pending = db.prepare(`
    SELECT id, email, role FROM pending_member_roles
    WHERE family_id = ? ORDER BY email COLLATE NOCASE, role
  `).all(familyId);
  return { members, pending };
}

function canGrantRole(actorRole, targetRole) {
  if (actorRole === "Dev") return targetRole === "Super Admin";
  if (actorRole === "Super Admin") return targetRole === "Deputy" || targetRole === "HC";
  if (actorRole === "Deputy") return targetRole === "HC";
  return false;
}

function canRevokeRole(actorRole, targetRole) {
  if (actorRole === "Dev") return targetRole === "Super Admin";
  if (actorRole === "Super Admin") return targetRole === "Deputy" || targetRole === "HC";
  if (actorRole === "Deputy") return targetRole === "HC";
  return false;
}

function loadSheet(periodId) {
  const period = db.prepare(`
    SELECT bp.id, bp.family_id AS familyId, bp.name, bp.start_date AS startDate,
      bp.end_date AS endDate, bp.status, bp.saved_at AS savedAt,
      bp.finished_at AS finishedAt, f.name AS familyName, f.logo AS familyLogo
    FROM bonus_periods bp
    JOIN families f ON f.id = bp.family_id
    WHERE bp.id = ?
  `).get(periodId);
  if (!period) return null;

  const events = db.prepare(`
    SELECT id, name, rate, position FROM bonus_period_events
    WHERE period_id = ? ORDER BY position, id
  `).all(periodId);
  const players = db.prepare(`
    SELECT id, player_name AS name, strike_percent AS strikePercent,
      paid_status AS paidStatus, position
    FROM bonus_period_players WHERE period_id = ? ORDER BY position, id
  `).all(periodId);
  const entries = db.prepare(`
    SELECT be.period_player_id AS playerId, be.event_id AS eventId, be.quantity
    FROM bonus_entries be
    JOIN bonus_period_players bpp ON bpp.id = be.period_player_id
    WHERE bpp.period_id = ?
  `).all(periodId);
  const entryMap = new Map(entries.map((entry) => [`${entry.playerId}:${entry.eventId}`, Number(entry.quantity)]));

  const computedPlayers = players.map((player) => {
    const counts = Object.fromEntries(events.map((event) => [event.id, entryMap.get(`${player.id}:${event.id}`) || 0]));
    const subtotal = events.reduce((sum, event) => sum + Number(event.rate) * counts[event.id], 0);
    const deduction = subtotal * Number(player.strikePercent) / 100;
    return { ...player, counts, subtotal, deduction, payout: subtotal - deduction };
  });
  const payoutTotal = computedPlayers.reduce((sum, player) => sum + player.payout, 0);

  return {
    family: { id: period.familyId, name: period.familyName, logo: period.familyLogo },
    period: {
      id: period.id,
      name: period.name,
      startDate: period.startDate,
      endDate: period.endDate,
      status: period.status,
      savedAt: period.savedAt,
      finishedAt: period.finishedAt,
    },
    events: events.map(({ id, name, rate }) => ({ id, name, rate: Number(rate) })),
    players: computedPlayers,
    payoutTotal,
    playersCount: computedPlayers.length,
  };
}

function periodList(familyId, includeUnsaved = false) {
  const rows = db.prepare(`
    SELECT id FROM bonus_periods
    WHERE family_id = ? ${includeUnsaved ? "" : "AND saved_at IS NOT NULL"}
    ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, start_date DESC, id DESC
  `).all(familyId);
  return rows.map((row) => {
    const sheet = loadSheet(row.id);
    return {
      id: sheet.period.id,
      name: sheet.period.name,
      startDate: sheet.period.startDate,
      endDate: sheet.period.endDate,
      status: sheet.period.status,
      savedAt: sheet.period.savedAt,
      finishedAt: sheet.period.finishedAt,
      playersCount: sheet.playersCount,
      payoutTotal: sheet.payoutTotal,
    };
  });
}

router.get("/families/:familyId/periods", (req, res) => {
  const family = getFamily(Number(req.params.familyId));
  if (!family || !family.active) return res.status(404).json({ error: "Family not found" });
  res.json({ family, periods: periodList(family.id) });
});

router.get("/families/:familyId/periods/:periodId", (req, res) => {
  const familyId = Number(req.params.familyId);
  const family = getFamily(familyId);
  if (!family || !family.active) return res.status(404).json({ error: "Family not found" });
  const sheet = loadSheet(Number(req.params.periodId));
  if (!sheet || sheet.family.id !== familyId) {
    return res.status(404).json({ error: "Saved bonus period not found" });
  }
  if (!sheet.period.savedAt) return res.status(404).json({ error: "This bonus period has not been saved yet" });
  res.json(sheet);
});

router.get("/family-admin/:familyId", requireAuth, (req, res) => {
  const access = requireFamilyAccess(req, res);
  if (!access) return;
  const canManage = ["Dev", "Super Admin", "Deputy"].includes(access.role);
  res.json({
    family: access.family,
    role: access.role,
    canManage,
    canAddData: ["Dev", "Super Admin", "Deputy", "HC"].includes(access.role),
    periods: periodList(access.familyId, true),
    roster: canManage ? familyRoster(access.familyId) : { members: [], pending: [] },
  });
});

router.post("/family-admin/:familyId/periods/:periodId/lock", requireAuth, (req, res) => {
  const access = requireFamilyAccess(req, res);
  if (!access) return;
  const periodId = Number(req.params.periodId);
  const period = db.prepare("SELECT id, status FROM bonus_periods WHERE id = ? AND family_id = ?")
    .get(periodId, access.familyId);
  if (!period) return res.status(404).json({ error: "Bonus period not found" });
  if (!canEditPeriod(access, period.status)) return res.status(403).json({ error: "You cannot edit this bonus period" });
  const token = String(req.body.token || "");
  if (!token || token.length > 120) return res.status(400).json({ error: "A valid edit lock token is required" });

  const now = Date.now();
  db.prepare("DELETE FROM bonus_sheet_locks WHERE period_id = ? AND expires_at <= ?").run(periodId, now);
  const existing = db.prepare("SELECT * FROM bonus_sheet_locks WHERE period_id = ?").get(periodId);
  if (existing) {
    if (existing.user_id !== req.user.id || existing.token !== token) {
      return res.status(423).json({ error: `${existing.owner_label} is editing this sheet`, lock: lockPayload(existing) });
    }
    db.prepare("UPDATE bonus_sheet_locks SET expires_at = ? WHERE period_id = ?")
      .run(now + 90_000, periodId);
  } else {
    db.prepare(`
      INSERT INTO bonus_sheet_locks (period_id, family_id, user_id, owner_label, token, expires_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(periodId, access.familyId, req.user.id, req.user.username || req.user.email, token, now + 90_000);
  }
  res.json({ locked: true, expiresAt: now + 90_000 });
});

router.patch("/family-admin/:familyId/periods/:periodId/lock", requireAuth, (req, res) => {
  const access = requireFamilyAccess(req, res);
  if (!access) return;
  const periodId = Number(req.params.periodId);
  const token = String(req.body.token || "");
  const lock = db.prepare("SELECT * FROM bonus_sheet_locks WHERE period_id = ? AND family_id = ?")
    .get(periodId, access.familyId);
  if (!lock || lock.expires_at <= Date.now() || lock.user_id !== req.user.id || lock.token !== token) {
    return res.status(423).json({ error: "Your edit lock expired or was released" });
  }
  const expiresAt = Date.now() + 90_000;
  db.prepare("UPDATE bonus_sheet_locks SET expires_at = ? WHERE period_id = ? AND token = ?")
    .run(expiresAt, periodId, token);
  res.json({ locked: true, expiresAt });
});

router.delete("/family-admin/:familyId/periods/:periodId/lock", requireAuth, (req, res) => {
  const periodId = Number(req.params.periodId);
  const token = String(req.body.token || "");
  db.prepare("DELETE FROM bonus_sheet_locks WHERE period_id = ? AND family_id = ? AND user_id = ? AND token = ?")
    .run(periodId, Number(req.params.familyId), req.user.id, token);
  res.json({ released: true });
});

router.get("/family-admin/:familyId/audit", requireAuth, (req, res) => {
  const access = requireFamilyAccess(req, res);
  if (!access) return;
  if (!requireManager(access, res)) return;
  const entries = db.prepare(`
    SELECT id, period_id AS periodId, actor_label AS actorLabel, action, summary, details, created_at AS createdAt
    FROM family_audit_log WHERE family_id = ? ORDER BY id DESC LIMIT 200
  `).all(access.familyId).map((entry) => ({ ...entry, details: JSON.parse(entry.details || "{}") }));
  res.json({ entries });
});

router.post("/family-admin/:familyId/roles", requireAuth, (req, res) => {
  const access = requireFamilyAccess(req, res);
  if (!access) return;
  const role = String(req.body.role || "");
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!canGrantRole(access.role, role)) return res.status(403).json({ error: "You cannot assign that family role" });
  if (!/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: "Enter a valid player email" });

  const user = db.prepare("SELECT id FROM users WHERE email = ? COLLATE NOCASE").get(email);
  try {
    if (!user) {
      db.prepare("INSERT INTO pending_member_roles (family_id, email, role) VALUES (?, ?, ?)")
        .run(access.familyId, email, role);
    } else {
      const assign = db.transaction(() => {
        let membership = db.prepare("SELECT id FROM family_members WHERE family_id = ? AND user_id = ?")
          .get(access.familyId, user.id);
        if (!membership) {
          const result = db.prepare("INSERT INTO family_members (family_id, user_id) VALUES (?, ?)")
            .run(access.familyId, user.id);
          membership = { id: result.lastInsertRowid };
        }
        db.prepare("INSERT INTO member_roles (membership_id, role) VALUES (?, ?)").run(membership.id, role);
      });
      assign();
    }
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "That email already has this role in the family" });
    throw error;
  }
  recordAudit(req, access.familyId, "role_assigned", `${role} assigned to ${email}`, { role, email });
  res.status(201).json({ roster: familyRoster(access.familyId) });
});

router.delete("/family-admin/:familyId/roles/:assignmentId", requireAuth, (req, res) => {
  const access = requireFamilyAccess(req, res);
  if (!access) return;
  const [kind, rawId] = String(req.params.assignmentId).split("-");
  const id = Number(rawId ?? kind);
  const role = String(req.query.role || "");
  if (!Number.isInteger(id) || !canRevokeRole(access.role, role)) {
    return res.status(403).json({ error: "You cannot remove that family role" });
  }

  if (kind === "pending") {
    const target = db.prepare("SELECT email FROM pending_member_roles WHERE id = ? AND family_id = ? AND role = ?")
      .get(id, access.familyId, role);
    const result = db.prepare("DELETE FROM pending_member_roles WHERE id = ? AND family_id = ? AND role = ?")
      .run(id, access.familyId, role);
    if (!result.changes) return res.status(404).json({ error: "Role assignment not found" });
    recordAudit(req, access.familyId, "role_removed", `${role} removed from ${target.email}`, { role, email: target.email });
  } else {
    const target = db.prepare(`
      SELECT u.email FROM family_members fm JOIN users u ON u.id = fm.user_id
      JOIN member_roles mr ON mr.membership_id = fm.id
      WHERE fm.id = ? AND fm.family_id = ? AND mr.role = ?
    `).get(id, access.familyId, role);
    const remove = db.transaction(() => {
      const membership = db.prepare(`
        SELECT fm.id FROM family_members fm
        JOIN member_roles mr ON mr.membership_id = fm.id
        WHERE fm.id = ? AND fm.family_id = ? AND mr.role = ?
      `).get(id, access.familyId, role);
      if (!membership) return false;
      db.prepare("DELETE FROM member_roles WHERE membership_id = ? AND role = ?").run(id, role);
      db.prepare(`
        DELETE FROM family_members WHERE id = ?
        AND NOT EXISTS (SELECT 1 FROM member_roles WHERE membership_id = ?)
      `).run(id, id);
      return true;
    });
    if (!remove()) return res.status(404).json({ error: "Role assignment not found" });
    recordAudit(req, access.familyId, "role_removed", `${role} removed from ${target.email}`, { role, email: target.email });
  }
  res.json({ roster: familyRoster(access.familyId) });
});

router.post("/family-admin/:familyId/periods", requireAuth, (req, res) => {
  const access = requireFamilyAccess(req, res);
  if (!access || !requireManager(access, res)) return;
  const lockToken = String(req.get("X-Sheet-Lock") || "");
  if (!lockToken || lockToken.length > 120) return res.status(400).json({ error: "A valid edit lock token is required" });
  const existing = db.prepare("SELECT id FROM bonus_periods WHERE family_id = ? AND status = 'active'").get(access.familyId);
  if (existing) return res.status(409).json({ error: "Finish the current period before starting another" });
  const result = db.prepare(`
    INSERT INTO bonus_periods (family_id, name, start_date)
    VALUES (?, 'New bonus period', ?)
  `).run(access.familyId, new Date().toISOString().slice(0, 10));
  db.prepare(`
    INSERT INTO bonus_sheet_locks (period_id, family_id, user_id, owner_label, token, expires_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(result.lastInsertRowid, access.familyId, req.user.id, req.user.username || req.user.email, lockToken, Date.now() + 90_000);
  recordAudit(req, access.familyId, "period_started", "Started a new bonus period", { periodName: "New bonus period" }, result.lastInsertRowid);
  res.status(201).json(loadSheet(result.lastInsertRowid));
});

router.get("/family-admin/:familyId/periods/:periodId", requireAuth, (req, res) => {
  const access = requireFamilyAccess(req, res);
  if (!access) return;
  const sheet = loadSheet(Number(req.params.periodId));
  if (!sheet || sheet.family.id !== access.familyId) return res.status(404).json({ error: "Bonus period not found" });
  res.json({ ...sheet, role: access.role, canManage: ["Dev", "Super Admin", "Deputy"].includes(access.role) });
});

router.put("/family-admin/:familyId/periods/:periodId", requireAuth, (req, res) => {
  const access = requireFamilyAccess(req, res);
  if (!access || !requireManager(access, res)) return;
  const periodId = Number(req.params.periodId);
  const current = db.prepare("SELECT * FROM bonus_periods WHERE id = ? AND family_id = ?").get(periodId, access.familyId);
  if (!current) return res.status(404).json({ error: "Bonus period not found" });
  if (!requireSheetLock(req, res, access.familyId, periodId)) return;
  const before = loadSheet(periodId);

  const name = String(req.body.name || "").trim();
  const startDate = String(req.body.startDate || "");
  const events = req.body.events;
  const players = req.body.players;
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: "Period name must be 2–80 characters" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !Number.isFinite(Date.parse(`${startDate}T00:00:00Z`))) {
    return res.status(400).json({ error: "Choose a valid period start date" });
  }
  if (!Array.isArray(events) || events.length < 1 || events.length > 40) {
    return res.status(400).json({ error: "A sheet needs 1–40 event columns" });
  }
  if (!Array.isArray(players) || players.length > 200) {
    return res.status(400).json({ error: "A sheet can have up to 200 player rows" });
  }

  const cleanEvents = [];
  const eventKeys = new Set();
  for (const [index, event] of events.entries()) {
    const key = String(event.clientId || index);
    const eventName = String(event.name || "").trim();
    const rate = Number(event.rate);
    if (eventKeys.has(key) || !eventName || eventName.length > 60 || !Number.isFinite(rate) || rate < 0) {
      return res.status(400).json({ error: "Check event names and rates" });
    }
    eventKeys.add(key);
    cleanEvents.push({ key, name: eventName, rate, position: index });
  }

  const cleanPlayers = [];
  for (const [index, player] of players.entries()) {
    const playerName = String(player.name || "").trim();
    const strikePercent = Number(player.strikePercent);
    const paidStatus = String(player.paidStatus || "Pending");
    if (!playerName || playerName.length > 60 || ![0, 10, 20, 30].includes(strikePercent) || !["Pending", "Paid"].includes(paidStatus)) {
      return res.status(400).json({ error: "Check player names, strikes, and payment statuses" });
    }
    const counts = {};
    for (const event of cleanEvents) {
      const quantity = Number(player.counts?.[event.key] ?? 0);
      if (!Number.isFinite(quantity) || quantity < 0 || quantity > 1000000000) {
        return res.status(400).json({ error: "Activity counts must be zero or higher" });
      }
      counts[event.key] = quantity;
    }
    cleanPlayers.push({ name: playerName, strikePercent, paidStatus, counts, position: index });
  }

  const finish = Boolean(req.body.finish);
  const save = db.transaction(() => {
    db.prepare("DELETE FROM bonus_period_events WHERE period_id = ?").run(periodId);
    db.prepare("DELETE FROM bonus_period_players WHERE period_id = ?").run(periodId);
    const addEvent = db.prepare("INSERT INTO bonus_period_events (period_id, name, rate, position) VALUES (?, ?, ?, ?)");
    const eventIds = new Map();
    for (const event of cleanEvents) {
      const result = addEvent.run(periodId, event.name, event.rate, event.position);
      eventIds.set(event.key, result.lastInsertRowid);
    }
    const addPlayer = db.prepare(`
      INSERT INTO bonus_period_players (period_id, player_name, strike_percent, paid_status, position)
      VALUES (?, ?, ?, ?, ?)
    `);
    const addEntry = db.prepare("INSERT INTO bonus_entries (period_player_id, event_id, quantity) VALUES (?, ?, ?)");
    for (const player of cleanPlayers) {
      const result = addPlayer.run(periodId, player.name, player.strikePercent, player.paidStatus, player.position);
      for (const event of cleanEvents) {
        addEntry.run(result.lastInsertRowid, eventIds.get(event.key), player.counts[event.key]);
      }
    }
    db.prepare(`
      UPDATE bonus_periods
      SET name = ?, start_date = ?,
        status = CASE WHEN ? THEN 'finished' ELSE status END,
        end_date = CASE WHEN ? THEN date('now') ELSE end_date END,
        finished_at = CASE WHEN ? THEN CURRENT_TIMESTAMP ELSE finished_at END,
        saved_at = CURRENT_TIMESTAMP
      WHERE id = ? AND family_id = ?
    `).run(name, startDate, finish ? 1 : 0, finish ? 1 : 0, finish ? 1 : 0, periodId, access.familyId);
    const after = loadSheet(periodId);
    recordAudit(
      req,
      access.familyId,
      finish ? "period_finished" : "sheet_saved",
      finish ? `Finished bonus period: ${name}` : `Saved changes to bonus period: ${name}`,
      { before: sheetSnapshot(before), after: sheetSnapshot(after) },
      periodId,
    );
  });

  save();
  res.json(loadSheet(periodId));
});

router.patch("/family-admin/:familyId/periods/:periodId/data", requireAuth, (req, res) => {
  const access = requireFamilyAccess(req, res);
  if (!access) return;
  const canAddData = ["Dev", "Super Admin", "Deputy", "HC"].includes(access.role);
  if (!canAddData) return res.status(403).json({ error: "Family data access required" });
  const periodId = Number(req.params.periodId);
  const period = db.prepare("SELECT id, status FROM bonus_periods WHERE id = ? AND family_id = ?").get(periodId, access.familyId);
  if (!period) return res.status(404).json({ error: "Bonus period not found" });
  if (period.status !== "active") return res.status(409).json({ error: "Activity data can only be added to the current period" });
  if (!requireSheetLock(req, res, access.familyId, periodId)) return;
  if (!Array.isArray(req.body.players)) return res.status(400).json({ error: "Player activity data is required" });
  const before = loadSheet(periodId);

  const update = db.transaction(() => {
    for (const player of req.body.players) {
      const exists = db.prepare("SELECT id FROM bonus_period_players WHERE id = ? AND period_id = ?").get(Number(player.id), periodId);
      if (!exists) continue;
      for (const [eventIdText, rawQuantity] of Object.entries(player.counts || {})) {
        const eventId = Number(eventIdText);
        const quantity = Number(rawQuantity);
        const event = db.prepare("SELECT id FROM bonus_period_events WHERE id = ? AND period_id = ?").get(eventId, periodId);
        if (!event || !Number.isFinite(quantity) || quantity < 0 || quantity > 1000000000) continue;
        db.prepare(`
          INSERT INTO bonus_entries (period_player_id, event_id, quantity) VALUES (?, ?, ?)
          ON CONFLICT (period_player_id, event_id) DO UPDATE SET quantity = excluded.quantity
        `).run(exists.id, eventId, quantity);
      }
    }
    db.prepare("UPDATE bonus_periods SET saved_at = CURRENT_TIMESTAMP WHERE id = ?").run(periodId);
    const after = loadSheet(periodId);
    recordAudit(
      req,
      access.familyId,
      "activity_saved",
      `Saved activity data for bonus period: ${after.period.name}`,
      { before: sheetSnapshot(before), after: sheetSnapshot(after) },
      periodId,
    );
  });
  update();
  res.json(loadSheet(periodId));
});

export default router;
