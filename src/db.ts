import Database from "better-sqlite3";
import path from "path";
import fs from "fs";

export function initDb(dataDir?: string): Database.Database {
  const dir = dataDir || process.env.DATA_DIR || "./data";

  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, "uploads"), { recursive: true });

  const dbPath = dataDir === ":memory:" ? ":memory:" : path.join(dir, "dialogos.db");
  const db = new Database(dbPath);

  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Default system prompt
  const existing = db.prepare("SELECT value FROM settings WHERE key = ?").get("system_prompt");
  if (!existing) {
    db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
      "system_prompt",
      "You are a helpful assistant."
    );
  }

  return db;
}

const db = initDb();
export default db;
