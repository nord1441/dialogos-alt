import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import db from "../db";

// プロバイダーモジュールをモック化してAPI通信なしでテスト可能にする
vi.mock("../providers", () => {
  return {
    PROVIDER_MODELS: {
      anthropic: [
        { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" },
      ],
      openai: [
        { id: "gpt-4o", name: "GPT-4o", provider: "openai" },
      ],
      gemini: [
        { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "gemini" },
      ],
      ollama: [],
    },
    PROVIDER_DEFAULTS: {
      anthropic: { baseUrl: "https://api.anthropic.com" },
      openai: { baseUrl: "https://api.openai.com/v1" },
      gemini: { baseUrl: "https://generativelanguage.googleapis.com" },
      ollama: { baseUrl: "http://localhost:11434" },
    },
    fetchOllamaModels: vi.fn().mockResolvedValue([]),
    streamChat: vi.fn().mockImplementation(function* () {
      yield "Hello ";
      yield "world";
    }),
  };
});

// Anthropic SDKのモック（importエラー回避用）
vi.mock("@anthropic-ai/sdk", () => {
  return { default: class MockAnthropic {} };
});

import { createApp } from "../server";
import { streamChat } from "../providers";

describe("API endpoints", () => {
  let app: express.Express;

  beforeEach(() => {
    // テストごとにDBをクリーンな状態にリセット
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM settings").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "system_prompt",
      "You are a helpful assistant."
    );
    vi.clearAllMocks();
    app = createApp();
  });

  // ========================================
  // GET /api/settings - 設定の取得
  // ========================================
  describe("GET /api/settings", () => {
    // 初期状態でデフォルト設定が全フィールド揃って返されるか確認
    it("should return default settings with all required fields", async () => {
      const res = await request(app).get("/api/settings");
      expect(res.status).toBe(200);
      expect(res.body.systemPrompt).toBe("You are a helpful assistant.");
      expect(res.body).toHaveProperty("avatarUrl");
      expect(res.body).toHaveProperty("activeModel");
      expect(res.body).toHaveProperty("enabledModels");
      expect(res.body).toHaveProperty("providers");
    });

    // 全4プロバイダー（anthropic, openai, gemini, ollama）の設定が含まれるか確認
    it("should include config for all 4 providers", async () => {
      const res = await request(app).get("/api/settings");
      expect(res.body.providers).toHaveProperty("anthropic");
      expect(res.body.providers).toHaveProperty("openai");
      expect(res.body.providers).toHaveProperty("gemini");
      expect(res.body.providers).toHaveProperty("ollama");
    });

    // 各プロバイダーのレスポンスにhasApiKeyとbaseUrlフィールドがあるか確認
    it("should return hasApiKey and baseUrl for each provider", async () => {
      const res = await request(app).get("/api/settings");
      for (const provider of ["anthropic", "openai", "gemini", "ollama"]) {
        expect(res.body.providers[provider]).toHaveProperty("hasApiKey");
        expect(res.body.providers[provider]).toHaveProperty("baseUrl");
      }
    });

    // DB更新後にシステムプロンプトの変更が反映されるか確認
    it("should return updated system prompt after change", async () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "system_prompt",
        "Custom prompt"
      );
      const res = await request(app).get("/api/settings");
      expect(res.status).toBe(200);
      expect(res.body.systemPrompt).toBe("Custom prompt");
    });

    // DBにAPIキーが設定されたプロバイダーのhasApiKeyがtrueになるか確認
    it("should show hasApiKey=true when provider API key is saved in DB", async () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "anthropic_api_key",
        "test-key"
      );
      const res = await request(app).get("/api/settings");
      expect(res.body.providers.anthropic.hasApiKey).toBe(true);
    });

    // APIキー未設定のプロバイダーのhasApiKeyがfalseになるか確認
    it("should show hasApiKey=false when provider API key is not set", async () => {
      const res = await request(app).get("/api/settings");
      expect(res.body.providers.openai.hasApiKey).toBe(false);
    });

    // DBに保存したベースURLが正しく返されるか確認
    it("should return saved base URL for a provider", async () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "openai_base_url",
        "https://custom.openai.example.com/v1"
      );
      const res = await request(app).get("/api/settings");
      expect(res.body.providers.openai.baseUrl).toBe("https://custom.openai.example.com/v1");
    });

    // ベースURL未設定時に空文字列が返されるか確認
    it("should return empty string for baseUrl when not configured", async () => {
      const res = await request(app).get("/api/settings");
      expect(res.body.providers.anthropic.baseUrl).toBe("");
    });

    // デフォルトのアクティブモデルが返されるか確認
    it("should return default active model when none is set", async () => {
      const res = await request(app).get("/api/settings");
      expect(res.body.activeModel).toEqual({ provider: "anthropic", model: "claude-opus-4-6" });
    });

    // DBに保存されたアクティブモデルが返されるか確認
    it("should return saved active model", async () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "active_model",
        JSON.stringify({ provider: "openai", model: "gpt-4o" })
      );
      const res = await request(app).get("/api/settings");
      expect(res.body.activeModel).toEqual({ provider: "openai", model: "gpt-4o" });
    });

    // 有効モデルリストが空配列で返されるか確認（未設定時）
    it("should return empty enabled models when not set", async () => {
      const res = await request(app).get("/api/settings");
      expect(res.body.enabledModels).toEqual([]);
    });

    // DBに保存した有効モデルリストが正しく返されるか確認
    it("should return saved enabled models list", async () => {
      const models = [{ provider: "anthropic", model: "claude-opus-4-6" }];
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "enabled_models",
        JSON.stringify(models)
      );
      const res = await request(app).get("/api/settings");
      expect(res.body.enabledModels).toEqual(models);
    });
  });

  // ========================================
  // POST /api/settings/system-prompt - システムプロンプト更新
  // ========================================
  describe("POST /api/settings/system-prompt", () => {
    // システムプロンプトが正常に更新され、DBにも反映されるか確認
    it("should update system prompt and persist to DB", async () => {
      const res = await request(app)
        .post("/api/settings/system-prompt")
        .send({ systemPrompt: "You are a pirate." });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("system_prompt") as {
        value: string;
      };
      expect(row.value).toBe("You are a pirate.");
    });

    // 数値など文字列以外のsystemPromptが400エラーになるか確認
    it("should reject non-string system prompt with 400", async () => {
      const res = await request(app)
        .post("/api/settings/system-prompt")
        .send({ systemPrompt: 123 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("systemPrompt must be a string");
    });

    // systemPromptフィールドが未指定のリクエストが400エラーになるか確認
    it("should reject missing system prompt field with 400", async () => {
      const res = await request(app)
        .post("/api/settings/system-prompt")
        .send({});
      expect(res.status).toBe(400);
    });

    // 空文字列でもシステムプロンプトを保存できるか確認
    it("should accept empty string as system prompt", async () => {
      const res = await request(app)
        .post("/api/settings/system-prompt")
        .send({ systemPrompt: "" });
      expect(res.status).toBe(200);

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("system_prompt") as {
        value: string;
      };
      expect(row.value).toBe("");
    });

    // 日本語を含むシステムプロンプトが正しく保存されるか確認
    it("should handle Japanese characters in system prompt", async () => {
      const res = await request(app)
        .post("/api/settings/system-prompt")
        .send({ systemPrompt: "あなたは親切なアシスタントです。" });
      expect(res.status).toBe(200);

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("system_prompt") as {
        value: string;
      };
      expect(row.value).toBe("あなたは親切なアシスタントです。");
    });
  });

  // ========================================
  // POST /api/settings/provider - プロバイダー設定（APIキー＋エンドポイント）
  // ========================================
  describe("POST /api/settings/provider", () => {
    // APIキーのみ保存できるか確認
    it("should save provider API key only", async () => {
      const res = await request(app)
        .post("/api/settings/provider")
        .send({ provider: "openai", apiKey: "sk-test-key" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("openai_api_key") as {
        value: string;
      };
      expect(row.value).toBe("sk-test-key");
    });

    // ベースURLのみ保存できるか確認
    it("should save provider base URL only", async () => {
      const res = await request(app)
        .post("/api/settings/provider")
        .send({ provider: "anthropic", baseUrl: "https://proxy.example.com" });
      expect(res.status).toBe(200);

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("anthropic_base_url") as {
        value: string;
      };
      expect(row.value).toBe("https://proxy.example.com");
    });

    // APIキーとベースURLを同時に保存できるか確認
    it("should save both API key and base URL in single request", async () => {
      const res = await request(app)
        .post("/api/settings/provider")
        .send({ provider: "gemini", apiKey: "AIza-test", baseUrl: "https://custom.gemini.example.com" });
      expect(res.status).toBe(200);

      const keyRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("gemini_api_key") as { value: string };
      const urlRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("gemini_base_url") as { value: string };
      expect(keyRow.value).toBe("AIza-test");
      expect(urlRow.value).toBe("https://custom.gemini.example.com");
    });

    // Ollamaプロバイダーでもキーとエンドポイント両方を設定できるか確認
    it("should accept ollama provider with both key and endpoint", async () => {
      const res = await request(app)
        .post("/api/settings/provider")
        .send({ provider: "ollama", baseUrl: "http://192.168.1.10:11434", apiKey: "custom-key" });
      expect(res.status).toBe(200);

      const keyRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("ollama_api_key") as { value: string };
      const urlRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("ollama_base_url") as { value: string };
      expect(keyRow.value).toBe("custom-key");
      expect(urlRow.value).toBe("http://192.168.1.10:11434");
    });

    // 全4プロバイダーが有効なprovider値として受け入れられるか確認
    it("should accept all 4 valid providers", async () => {
      for (const provider of ["anthropic", "openai", "gemini", "ollama"]) {
        const res = await request(app)
          .post("/api/settings/provider")
          .send({ provider, apiKey: `key-for-${provider}` });
        expect(res.status).toBe(200);
      }
    });

    // 未知のプロバイダー名が400エラーになるか確認
    it("should reject invalid provider name with 400", async () => {
      const res = await request(app)
        .post("/api/settings/provider")
        .send({ provider: "invalid", apiKey: "key" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid provider");
    });

    // 空文字列のAPIキーを送信するとDBからキーが削除されるか確認
    it("should delete API key from DB when empty string is sent", async () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "openai_api_key",
        "old-key"
      );
      const res = await request(app)
        .post("/api/settings/provider")
        .send({ provider: "openai", apiKey: "" });
      expect(res.status).toBe(200);

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("openai_api_key");
      expect(row).toBeUndefined();
    });

    // 空文字列のベースURLを送信するとDBからURLが削除されるか確認
    it("should delete base URL from DB when empty string is sent", async () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "openai_base_url",
        "https://old.example.com"
      );
      const res = await request(app)
        .post("/api/settings/provider")
        .send({ provider: "openai", baseUrl: "" });
      expect(res.status).toBe(200);

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("openai_base_url");
      expect(row).toBeUndefined();
    });

    // APIキーの前後の空白がトリムされるか確認
    it("should trim whitespace from API key", async () => {
      const res = await request(app)
        .post("/api/settings/provider")
        .send({ provider: "anthropic", apiKey: "  sk-ant-test  " });
      expect(res.status).toBe(200);

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("anthropic_api_key") as { value: string };
      expect(row.value).toBe("sk-ant-test");
    });

    // ベースURLの前後の空白がトリムされるか確認
    it("should trim whitespace from base URL", async () => {
      const res = await request(app)
        .post("/api/settings/provider")
        .send({ provider: "anthropic", baseUrl: "  https://proxy.example.com  " });
      expect(res.status).toBe(200);

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("anthropic_base_url") as { value: string };
      expect(row.value).toBe("https://proxy.example.com");
    });

    // apiKeyフィールドなしでもリクエストが成功するか確認（baseUrlのみ更新）
    it("should not modify API key when apiKey field is absent", async () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "anthropic_api_key",
        "existing-key"
      );
      await request(app)
        .post("/api/settings/provider")
        .send({ provider: "anthropic", baseUrl: "https://new-url.com" });

      // 既存キーはそのまま残る
      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("anthropic_api_key") as { value: string };
      expect(row.value).toBe("existing-key");
    });
  });

  // ========================================
  // POST /api/settings/provider/test - プロバイダー接続テスト
  // ========================================
  describe("POST /api/settings/provider/test", () => {
    // 無効なプロバイダー名で400エラーが返るか確認
    it("should reject invalid provider with 400", async () => {
      const res = await request(app)
        .post("/api/settings/provider/test")
        .send({ provider: "invalid" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("Invalid provider");
    });
  });

  // ========================================
  // POST /api/settings/active-model - アクティブモデル設定
  // ========================================
  describe("POST /api/settings/active-model", () => {
    // アクティブモデルが正常に保存されるか確認
    it("should save active model to DB", async () => {
      const res = await request(app)
        .post("/api/settings/active-model")
        .send({ provider: "openai", model: "gpt-4o" });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("active_model") as {
        value: string;
      };
      expect(JSON.parse(row.value)).toEqual({ provider: "openai", model: "gpt-4o" });
    });

    // modelフィールドが欠けているリクエストが400エラーになるか確認
    it("should reject request missing model field with 400", async () => {
      const res = await request(app)
        .post("/api/settings/active-model")
        .send({ provider: "openai" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("provider and model are required");
    });

    // providerフィールドが欠けているリクエストが400エラーになるか確認
    it("should reject request missing provider field with 400", async () => {
      const res = await request(app)
        .post("/api/settings/active-model")
        .send({ model: "gpt-4o" });
      expect(res.status).toBe(400);
    });

    // アクティブモデルの上書き更新が正しく動作するか確認
    it("should overwrite existing active model", async () => {
      await request(app)
        .post("/api/settings/active-model")
        .send({ provider: "anthropic", model: "claude-opus-4-6" });
      await request(app)
        .post("/api/settings/active-model")
        .send({ provider: "gemini", model: "gemini-2.0-flash" });

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("active_model") as {
        value: string;
      };
      expect(JSON.parse(row.value)).toEqual({ provider: "gemini", model: "gemini-2.0-flash" });
    });
  });

  // ========================================
  // POST /api/settings/enabled-models - 有効モデル一覧設定
  // ========================================
  describe("POST /api/settings/enabled-models", () => {
    // 複数プロバイダーのモデルリストが正しく保存されるか確認
    it("should save enabled models list to DB", async () => {
      const models = [
        { provider: "anthropic", model: "claude-opus-4-6" },
        { provider: "openai", model: "gpt-4o" },
      ];
      const res = await request(app)
        .post("/api/settings/enabled-models")
        .send({ models });
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("enabled_models") as {
        value: string;
      };
      expect(JSON.parse(row.value)).toEqual(models);
    });

    // 空配列で有効モデルをリセットできるか確認
    it("should accept empty array to clear enabled models", async () => {
      const res = await request(app)
        .post("/api/settings/enabled-models")
        .send({ models: [] });
      expect(res.status).toBe(200);

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("enabled_models") as {
        value: string;
      };
      expect(JSON.parse(row.value)).toEqual([]);
    });

    // 配列以外のmodelsフィールドが400エラーになるか確認
    it("should reject non-array models with 400", async () => {
      const res = await request(app)
        .post("/api/settings/enabled-models")
        .send({ models: "not-array" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("models must be an array");
    });
  });

  // ========================================
  // GET /api/models - 利用可能モデル一覧取得
  // ========================================
  describe("GET /api/models", () => {
    // 全4プロバイダーのモデルリストが返されるか確認
    it("should return models for all 4 providers", async () => {
      const res = await request(app).get("/api/models");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("anthropic");
      expect(res.body).toHaveProperty("openai");
      expect(res.body).toHaveProperty("gemini");
      expect(res.body).toHaveProperty("ollama");
    });

    // 静的プロバイダーのモデルが正しい数返されるか確認
    it("should return correct number of models for static providers", async () => {
      const res = await request(app).get("/api/models");
      expect(res.body.anthropic).toHaveLength(1);
      expect(res.body.openai).toHaveLength(1);
      expect(res.body.gemini).toHaveLength(1);
    });

    // 各モデルがid, name, providerフィールドを持つか確認
    it("should include id, name, and provider in each model entry", async () => {
      const res = await request(app).get("/api/models");
      const model = res.body.anthropic[0];
      expect(model).toHaveProperty("id");
      expect(model).toHaveProperty("name");
      expect(model).toHaveProperty("provider");
      expect(model.provider).toBe("anthropic");
    });

    // GET /api/models を呼ぶとfetchOllamaModelsが実行されるか確認
    it("should call fetchOllamaModels when fetching models", async () => {
      const { fetchOllamaModels } = await import("../providers");
      vi.mocked(fetchOllamaModels).mockClear();
      await request(app).get("/api/models");
      expect(fetchOllamaModels).toHaveBeenCalled();
    });
  });

  // ========================================
  // GET /api/messages - メッセージ履歴取得
  // ========================================
  describe("GET /api/messages", () => {
    // メッセージが存在しないときに空配列が返るか確認
    it("should return empty array when no messages exist", async () => {
      const res = await request(app).get("/api/messages");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    // メッセージがID順（時系列）で返されるか確認
    it("should return messages in chronological order", async () => {
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", "Hi");
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("assistant", "Hello");

      const res = await request(app).get("/api/messages");
      expect(res.status).toBe(200);
      expect(res.body).toHaveLength(2);
      expect(res.body[0].role).toBe("user");
      expect(res.body[0].content).toBe("Hi");
      expect(res.body[1].role).toBe("assistant");
      expect(res.body[1].content).toBe("Hello");
    });

    // 各メッセージにid, role, content, created_atフィールドがあるか確認
    it("should include id, role, content, and created_at in each message", async () => {
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", "Test");

      const res = await request(app).get("/api/messages");
      const msg = res.body[0];
      expect(msg).toHaveProperty("id");
      expect(msg).toHaveProperty("role");
      expect(msg).toHaveProperty("content");
      expect(msg).toHaveProperty("created_at");
    });
  });

  // ========================================
  // DELETE /api/messages - チャット履歴クリア
  // ========================================
  describe("DELETE /api/messages", () => {
    // 全メッセージが削除されるか確認
    it("should clear all messages from DB", async () => {
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", "Hi");
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("assistant", "Hello");

      const res = await request(app).delete("/api/messages");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const messages = db.prepare("SELECT * FROM messages").all();
      expect(messages).toHaveLength(0);
    });

    // メッセージが存在しない状態でDELETEしてもエラーにならないか確認
    it("should succeed even when no messages exist", async () => {
      const res = await request(app).delete("/api/messages");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  // ========================================
  // POST /api/chat - チャットメッセージ送信（SSEストリーミング）
  // ========================================
  describe("POST /api/chat", () => {
    // 空のメッセージが400エラーになるか確認
    it("should reject empty message with 400", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ message: "" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("message is required");
    });

    // messageフィールドが未指定のリクエストが400エラーになるか確認
    it("should reject missing message field with 400", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({});
      expect(res.status).toBe(400);
    });

    // 空白のみのメッセージが400エラーになるか確認
    it("should reject whitespace-only message with 400", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ message: "   " });
      expect(res.status).toBe(400);
    });

    // SSE形式でレスポンスがストリーミングされるか確認
    it("should stream response via Server-Sent Events", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ message: "Hello" });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");

      // SSEデータ行をパース
      const lines = res.text.split("\n").filter((l: string) => l.startsWith("data: "));
      const events = lines.map((l: string) => JSON.parse(l.slice(6)));

      // deltaイベントとdoneイベントが含まれるか
      const deltas = events.filter((e: any) => e.type === "delta");
      const doneEvents = events.filter((e: any) => e.type === "done");
      expect(deltas.length).toBeGreaterThan(0);
      expect(doneEvents).toHaveLength(1);
    });

    // ストリーミングされたテキストが連結して正しい応答になるか確認
    it("should concatenate streamed deltas to form complete response", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ message: "Hello" });

      const lines = res.text.split("\n").filter((l: string) => l.startsWith("data: "));
      const events = lines.map((l: string) => JSON.parse(l.slice(6)));
      const deltas = events.filter((e: any) => e.type === "delta");
      const fullText = deltas.map((e: any) => e.text).join("");
      expect(fullText).toBe("Hello world");
    });

    // ユーザーメッセージとアシスタント応答の両方がDBに保存されるか確認
    it("should save both user and assistant messages to DB", async () => {
      await request(app)
        .post("/api/chat")
        .send({ message: "Test message" });

      const messages = db.prepare("SELECT role, content FROM messages ORDER BY id ASC").all() as {
        role: string;
        content: string;
      }[];

      expect(messages).toHaveLength(2);
      expect(messages[0]).toEqual({ role: "user", content: "Test message" });
      expect(messages[1]).toEqual({ role: "assistant", content: "Hello world" });
    });

    // streamChatにシステムプロンプトが渡されるか確認
    it("should pass system prompt to streamChat", async () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "system_prompt",
        "Custom system prompt"
      );

      await request(app)
        .post("/api/chat")
        .send({ message: "Hi" });

      expect(streamChat).toHaveBeenCalledWith(
        expect.objectContaining({
          systemPrompt: "Custom system prompt",
        })
      );
    });

    // streamChatに正しいプロバイダーとモデルが渡されるか確認
    it("should pass active model provider and model to streamChat", async () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "active_model",
        JSON.stringify({ provider: "openai", model: "gpt-4o" })
      );

      await request(app)
        .post("/api/chat")
        .send({ message: "Hi" });

      expect(streamChat).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: "openai",
          model: "gpt-4o",
        })
      );
    });

    // DBに保存されたプロバイダーのAPIキーがstreamChatに渡されるか確認
    it("should pass provider config from DB to streamChat", async () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "anthropic_api_key",
        "sk-ant-db-key"
      );
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "anthropic_base_url",
        "https://proxy.example.com"
      );

      await request(app)
        .post("/api/chat")
        .send({ message: "Hi" });

      expect(streamChat).toHaveBeenCalledWith(
        expect.objectContaining({
          providerConfig: {
            apiKey: "sk-ant-db-key",
            baseUrl: "https://proxy.example.com",
          },
        })
      );
    });

    // 複数ターンの会話で全履歴がstreamChatに渡されるか確認
    it("should include full conversation history in streamChat call", async () => {
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", "First");
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("assistant", "Response 1");

      await request(app)
        .post("/api/chat")
        .send({ message: "Second" });

      expect(streamChat).toHaveBeenCalledWith(
        expect.objectContaining({
          messages: [
            { role: "user", content: "First" },
            { role: "assistant", content: "Response 1" },
            { role: "user", content: "Second" },
          ],
        })
      );
    });

    // streamChatがエラーを投げたときにSSEでerrorイベントが送信されるか確認
    it("should send SSE error event when streamChat throws", async () => {
      const { streamChat: mockStreamChat } = await import("../providers");
      vi.mocked(mockStreamChat).mockImplementationOnce(async function* () {
        throw new Error("API connection failed");
      });

      const res = await request(app)
        .post("/api/chat")
        .send({ message: "Hi" });

      const lines = res.text.split("\n").filter((l: string) => l.startsWith("data: "));
      const events = lines.map((l: string) => JSON.parse(l.slice(6)));
      const errorEvents = events.filter((e: any) => e.type === "error");
      expect(errorEvents).toHaveLength(1);
      expect(errorEvents[0].error).toBe("API connection failed");
    });
  });

  // ========================================
  // DELETE /api/settings/avatar - アバター削除
  // ========================================
  describe("DELETE /api/settings/avatar", () => {
    // アバターが存在しない状態で削除してもエラーにならないか確認
    it("should return ok even when no avatar exists", async () => {
      const res = await request(app).delete("/api/settings/avatar");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });

  // ========================================
  // 設定値の優先順位（DB > 環境変数）
  // ========================================
  describe("Provider config resolution priority", () => {
    // DB値が環境変数より優先されるか確認
    it("should prioritize DB value over environment variable for API key", async () => {
      // 環境変数にキーを設定
      process.env.ANTHROPIC_API_KEY = "env-key";
      // DB にもキーを設定
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "anthropic_api_key",
        "db-key"
      );

      await request(app)
        .post("/api/chat")
        .send({ message: "Hi" });

      // streamChat に渡される providerConfig が DB のキーであること
      expect(streamChat).toHaveBeenCalledWith(
        expect.objectContaining({
          providerConfig: expect.objectContaining({
            apiKey: "db-key",
          }),
        })
      );

      // テスト後に環境変数をクリーンアップ
      delete process.env.ANTHROPIC_API_KEY;
    });

    // DB値が環境変数より優先されるか確認（ベースURL）
    it("should prioritize DB value over environment variable for base URL", async () => {
      process.env.ANTHROPIC_BASE_URL = "https://env-url.example.com";
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "anthropic_base_url",
        "https://db-url.example.com"
      );

      await request(app)
        .post("/api/chat")
        .send({ message: "Hi" });

      expect(streamChat).toHaveBeenCalledWith(
        expect.objectContaining({
          providerConfig: expect.objectContaining({
            baseUrl: "https://db-url.example.com",
          }),
        })
      );

      delete process.env.ANTHROPIC_BASE_URL;
    });

    // DB未設定時に環境変数がフォールバックとして使われるか確認
    it("should fall back to environment variable when DB has no value", async () => {
      process.env.ANTHROPIC_API_KEY = "env-fallback-key";

      await request(app)
        .post("/api/chat")
        .send({ message: "Hi" });

      expect(streamChat).toHaveBeenCalledWith(
        expect.objectContaining({
          providerConfig: expect.objectContaining({
            apiKey: "env-fallback-key",
          }),
        })
      );

      delete process.env.ANTHROPIC_API_KEY;
    });
  });
});
