import Database from "better-sqlite3";

const db = new Database("bonus.db");

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

const columns = db.prepare("PRAGMA table_info(users)").all();
if (!columns.some((column) => column.name === "picture")) {
  db.exec("ALTER TABLE users ADD COLUMN picture TEXT");
}

export default db;