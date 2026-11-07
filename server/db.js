import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const defaultDatabasePath = fileURLToPath(new URL("./bonus.db", import.meta.url));
const databasePath = process.env.DATABASE_PATH ? resolve(process.env.DATABASE_PATH) : defaultDatabasePath;
mkdirSync(dirname(databasePath), { recursive: true });
const db = new Database(databasePath);
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE,
    username TEXT,
    role TEXT NOT NULL DEFAULT 'none',
    family_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS auth_sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    revoked_at INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS auth_sessions_user_id_idx ON auth_sessions (user_id);
`);

db.exec(`
  CREATE TABLE IF NOT EXISTS families (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    logo TEXT,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS family_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (family_id, user_id)
  );

  CREATE TABLE IF NOT EXISTS member_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    membership_id INTEGER NOT NULL REFERENCES family_members(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('Super Admin', 'Deputy', 'HC')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (membership_id, role)
  );

  CREATE TABLE IF NOT EXISTS pending_member_roles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    email TEXT NOT NULL COLLATE NOCASE,
    role TEXT NOT NULL CHECK (role IN ('Super Admin', 'Deputy', 'HC')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (family_id, email, role)
  );

  CREATE TABLE IF NOT EXISTS bonus_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'finished')),
    saved_at TEXT,
    finished_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bonus_period_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id INTEGER NOT NULL REFERENCES bonus_periods(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    rate REAL NOT NULL DEFAULT 0 CHECK (rate >= 0),
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bonus_period_players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id INTEGER NOT NULL REFERENCES bonus_periods(id) ON DELETE CASCADE,
    player_name TEXT NOT NULL,
    strike_percent INTEGER NOT NULL DEFAULT 0 CHECK (strike_percent IN (0, 10, 20, 30)),
    paid_status TEXT NOT NULL DEFAULT 'Pending' CHECK (paid_status IN ('Pending', 'Paid')),
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS bonus_entries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_player_id INTEGER NOT NULL REFERENCES bonus_period_players(id) ON DELETE CASCADE,
    event_id INTEGER NOT NULL REFERENCES bonus_period_events(id) ON DELETE CASCADE,
    quantity REAL NOT NULL DEFAULT 0 CHECK (quantity >= 0),
    UNIQUE (period_player_id, event_id)
  );

  CREATE TABLE IF NOT EXISTS family_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    period_id INTEGER REFERENCES bonus_periods(id) ON DELETE SET NULL,
    actor_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    actor_label TEXT NOT NULL,
    action TEXT NOT NULL,
    summary TEXT NOT NULL,
    details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS bonus_sheet_locks (
    period_id INTEGER PRIMARY KEY REFERENCES bonus_periods(id) ON DELETE CASCADE,
    family_id INTEGER NOT NULL REFERENCES families(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    owner_label TEXT NOT NULL,
    token TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );
`);

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_bonus_period_per_family
  ON bonus_periods (family_id) WHERE status = 'active'
`);

const familyColumns = db.prepare("PRAGMA table_info(families)").all();
if (!familyColumns.some((column) => column.name === "logo")) {
  db.exec("ALTER TABLE families ADD COLUMN logo TEXT");
}

const columns = db.prepare("PRAGMA table_info(users)").all();
if (!columns.some((column) => column.name === "picture")) {
  db.exec("ALTER TABLE users ADD COLUMN picture TEXT");
}

export default db;
