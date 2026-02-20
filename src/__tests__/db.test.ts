import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";

/**
 * テスト用のインメモリDBを作成するヘルパー関数
 * 本番と同じスキーマを持つクリーンなDBインスタンスを返す
 */
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

  // ========================================
  // settings テーブル
  // ========================================
  describe("settings table", () => {
    // デフォルトのシステムプロンプトが初期データとして存在するか確認
    it("should have default system prompt", () => {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("system_prompt") as {
        value: string;
      };
      expect(row.value).toBe("You are a helpful assistant.");
    });

    // システムプロンプトを INSERT OR REPLACE で更新できるか確認
    it("should update system prompt via upsert", () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "system_prompt",
        "You are a cat."
      );
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("system_prompt") as {
        value: string;
      };
      expect(row.value).toBe("You are a cat.");
    });

    // 任意のキー・バリューペアを保存できるか確認
    it("should store arbitrary key-value settings", () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("theme", "dark");
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("theme") as {
        value: string;
      };
      expect(row.value).toBe("dark");
    });

    // プロバイダーのAPIキーをsettingsテーブルに保存・取得できるか確認
    it("should store provider API keys", () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "anthropic_api_key",
        "sk-ant-test-key"
      );
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("anthropic_api_key") as {
        value: string;
      };
      expect(row.value).toBe("sk-ant-test-key");
    });

    // プロバイダーのベースURLをsettingsテーブルに保存・取得できるか確認
    it("should store provider base URLs", () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "openai_base_url",
        "https://proxy.example.com/v1"
      );
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("openai_base_url") as {
        value: string;
      };
      expect(row.value).toBe("https://proxy.example.com/v1");
    });

    // 同一キーへの複数回書き込みで最後の値が残るか確認
    it("should overwrite value on repeated upsert for same key", () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("test_key", "first");
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("test_key", "second");
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("test_key") as {
        value: string;
      };
      expect(row.value).toBe("second");
    });

    // DELETE文で特定のキーだけを削除できるか確認
    it("should delete a specific setting by key", () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run("to_delete", "val");
      db.prepare("DELETE FROM settings WHERE key = ?").run("to_delete");
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("to_delete");
      expect(row).toBeUndefined();
    });

    // 存在しないキーに対してundefinedが返るか確認
    it("should return undefined for non-existent key", () => {
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("nonexistent");
      expect(row).toBeUndefined();
    });

    // JSON文字列（有効モデルリストなど）を保存・復元できるか確認
    it("should store and retrieve JSON values for enabled models", () => {
      const models = [
        { provider: "anthropic", model: "claude-opus-4-6" },
        { provider: "openai", model: "gpt-4o" },
      ];
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "enabled_models",
        JSON.stringify(models)
      );
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("enabled_models") as {
        value: string;
      };
      expect(JSON.parse(row.value)).toEqual(models);
    });

    // アクティブモデルのJSON保存・復元を確認
    it("should store and retrieve active model as JSON", () => {
      const activeModel = { provider: "gemini", model: "gemini-2.0-flash" };
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "active_model",
        JSON.stringify(activeModel)
      );
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("active_model") as {
        value: string;
      };
      expect(JSON.parse(row.value)).toEqual(activeModel);
    });
  });

  // ========================================
  // messages テーブル
  // ========================================
  describe("messages table", () => {
    // メッセージの挿入と取得が正しい順序で行えるか確認
    it("should insert and retrieve messages in order", () => {
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

    // IDが自動的にインクリメントされるか確認
    it("should auto-increment message IDs", () => {
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", "First");
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", "Second");

      const messages = db.prepare("SELECT id FROM messages ORDER BY id ASC").all() as {
        id: number;
      }[];

      expect(messages[0]!.id).toBe(1);
      expect(messages[1]!.id).toBe(2);
    });

    // 全メッセージの一括削除が動作するか確認
    it("should delete all messages at once", () => {
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", "Hello");
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("assistant", "Hi");

      db.prepare("DELETE FROM messages").run();

      const messages = db.prepare("SELECT * FROM messages").all();
      expect(messages).toHaveLength(0);
    });

    // created_atカラムが自動的に有効な日時文字列で設定されるか確認
    it("should set created_at automatically as valid datetime", () => {
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", "Test");
      const row = db.prepare("SELECT created_at FROM messages").get() as { created_at: string };
      expect(row.created_at).toBeTruthy();
      expect(new Date(row.created_at).toString()).not.toBe("Invalid Date");
    });

    // 複数ターンの会話履歴が正しい順序で保持されるか確認
    it("should preserve multi-turn conversation history in order", () => {
      const conversation = [
        { role: "user", content: "こんにちは" },
        { role: "assistant", content: "こんにちは！何かお手伝いできますか？" },
        { role: "user", content: "天気を教えて" },
        { role: "assistant", content: "今日は晴れです。" },
      ];

      for (const msg of conversation) {
        db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run(msg.role, msg.content);
      }

      const messages = db.prepare("SELECT role, content FROM messages ORDER BY id ASC").all() as {
        role: string;
        content: string;
      }[];

      expect(messages).toHaveLength(4);
      expect(messages).toEqual(conversation);
    });

    // メッセージが空のときに空配列が返るか確認
    it("should return empty array when no messages exist", () => {
      const messages = db.prepare("SELECT * FROM messages").all();
      expect(messages).toEqual([]);
    });
  });
});
