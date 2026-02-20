import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";

function createTestDb(): Database.Database {
  const db = new Database(":memory:");
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
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?)").run(
    "system_prompt",
    "You are a helpful assistant."
  );
  return db;
}

describe("database", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  describe("settings table", () => {
    it("should have default system prompt", () => {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("system_prompt") as {
        value: string;
      };
      expect(row.value).toBe("You are a helpful assistant.");
    });

    it("should update system prompt", () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "system_prompt",
        "You are a cat."
      );
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("system_prompt") as {
        value: string;
      };
      expect(row.value).toBe("You are a cat.");
    });

    it("should store arbitrary settings", () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("theme", "dark");
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("theme") as {
        value: string;
      };
      expect(row.value).toBe("dark");
    });
  });

  describe("messages table", () => {
    it("should insert and retrieve messages", () => {
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", "Hello");
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("assistant", "Hi there");

      const messages = db.prepare("SELECT role, content FROM messages ORDER BY id ASC").all() as {
        role: string;
        content: string;
      }[];

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: "user", content: "Hello" });
      expect(messages[1]).toEqual({ role: "assistant", content: "Hi there" });
    });

    it("should auto-increment IDs", () => {
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", "First");
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", "Second");

      const messages = db.prepare("SELECT id FROM messages ORDER BY id ASC").all() as {
        id: number;
      }[];

      expect(messages[0]!.id).toBe(1);
      expect(messages[1]!.id).toBe(2);
    });

    it("should delete all messages", () => {
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", "Hello");
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("assistant", "Hi");

      db.prepare("DELETE FROM messages").run();

      const messages = db.prepare("SELECT * FROM messages").all();
      expect(messages).toHaveLength(0);
    });

    it("should set created_at automatically", () => {
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", "Test");
      const row = db.prepare("SELECT created_at FROM messages").get() as { created_at: string };
      expect(row.created_at).toBeTruthy();
      // Should be a valid date string
      expect(new Date(row.created_at).toString()).not.toBe("Invalid Date");
    });
  });
});
