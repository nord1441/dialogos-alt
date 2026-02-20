import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import db from "../db";

// Mock providers module
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

// Mock Anthropic SDK (still needed for import)
vi.mock("@anthropic-ai/sdk", () => {
  return { default: class MockAnthropic {} };
});

// Import after mock
import { createApp } from "../server";

describe("API endpoints", () => {
  let app: express.Express;

  beforeEach(() => {
    // Clean database state
    db.prepare("DELETE FROM messages").run();
    db.prepare("DELETE FROM settings").run();
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "system_prompt",
      "You are a helpful assistant."
    );
    app = createApp();
  });

  describe("GET /api/settings", () => {
    it("should return default settings", async () => {
      const res = await request(app).get("/api/settings");
      expect(res.status).toBe(200);
      expect(res.body.systemPrompt).toBe("You are a helpful assistant.");
      expect(res.body).toHaveProperty("avatarUrl");
      expect(res.body).toHaveProperty("activeModel");
      expect(res.body).toHaveProperty("enabledModels");
      expect(res.body).toHaveProperty("providers");
      expect(res.body.providers).toHaveProperty("anthropic");
      expect(res.body.providers).toHaveProperty("openai");
      expect(res.body.providers).toHaveProperty("gemini");
      expect(res.body.providers).toHaveProperty("ollama");
    });

    it("should return updated system prompt", async () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "system_prompt",
        "Custom prompt"
      );
      const res = await request(app).get("/api/settings");
      expect(res.status).toBe(200);
      expect(res.body.systemPrompt).toBe("Custom prompt");
    });

    it("should return provider key and url status", async () => {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "anthropic_api_key",
        "test-key"
      );
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        "openai_base_url",
        "https://custom.openai.example.com/v1"
      );
      const res = await request(app).get("/api/settings");
      expect(res.body.providers.anthropic.hasApiKey).toBe(true);
      expect(res.body.providers.openai.hasApiKey).toBe(false);
      expect(res.body.providers.openai.baseUrl).toBe("https://custom.openai.example.com/v1");
    });
  });

  describe("POST /api/settings/system-prompt", () => {
    it("should update system prompt", async () => {
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

    it("should reject non-string system prompt", async () => {
      const res = await request(app)
        .post("/api/settings/system-prompt")
        .send({ systemPrompt: 123 });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("systemPrompt must be a string");
    });

    it("should reject missing system prompt", async () => {
      const res = await request(app)
        .post("/api/settings/system-prompt")
        .send({});
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/settings/provider", () => {
    it("should save a provider API key", async () => {
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

    it("should save a provider base URL", async () => {
      const res = await request(app)
        .post("/api/settings/provider")
        .send({ provider: "anthropic", baseUrl: "https://proxy.example.com" });
      expect(res.status).toBe(200);

      const row = db.prepare("SELECT value FROM settings WHERE key = ?").get("anthropic_base_url") as {
        value: string;
      };
      expect(row.value).toBe("https://proxy.example.com");
    });

    it("should save both API key and base URL", async () => {
      const res = await request(app)
        .post("/api/settings/provider")
        .send({ provider: "gemini", apiKey: "AIza-test", baseUrl: "https://custom.gemini.example.com" });
      expect(res.status).toBe(200);

      const keyRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("gemini_api_key") as { value: string };
      const urlRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("gemini_base_url") as { value: string };
      expect(keyRow.value).toBe("AIza-test");
      expect(urlRow.value).toBe("https://custom.gemini.example.com");
    });

    it("should accept ollama provider", async () => {
      const res = await request(app)
        .post("/api/settings/provider")
        .send({ provider: "ollama", baseUrl: "http://192.168.1.10:11434", apiKey: "custom-key" });
      expect(res.status).toBe(200);

      const keyRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("ollama_api_key") as { value: string };
      const urlRow = db.prepare("SELECT value FROM settings WHERE key = ?").get("ollama_base_url") as { value: string };
      expect(keyRow.value).toBe("custom-key");
      expect(urlRow.value).toBe("http://192.168.1.10:11434");
    });

    it("should reject invalid provider", async () => {
      const res = await request(app)
        .post("/api/settings/provider")
        .send({ provider: "invalid", apiKey: "key" });
      expect(res.status).toBe(400);
    });

    it("should delete key when empty string", async () => {
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

    it("should delete base URL when empty string", async () => {
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
  });

  describe("POST /api/settings/active-model", () => {
    it("should save active model", async () => {
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

    it("should reject missing fields", async () => {
      const res = await request(app)
        .post("/api/settings/active-model")
        .send({ provider: "openai" });
      expect(res.status).toBe(400);
    });
  });

  describe("POST /api/settings/enabled-models", () => {
    it("should save enabled models", async () => {
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

    it("should reject non-array", async () => {
      const res = await request(app)
        .post("/api/settings/enabled-models")
        .send({ models: "not-array" });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/models", () => {
    it("should return available models", async () => {
      const res = await request(app).get("/api/models");
      expect(res.status).toBe(200);
      expect(res.body).toHaveProperty("anthropic");
      expect(res.body).toHaveProperty("openai");
      expect(res.body).toHaveProperty("gemini");
      expect(res.body).toHaveProperty("ollama");
      expect(res.body.anthropic).toHaveLength(1);
    });
  });

  describe("GET /api/messages", () => {
    it("should return empty array initially", async () => {
      const res = await request(app).get("/api/messages");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("should return messages in order", async () => {
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
  });

  describe("DELETE /api/messages", () => {
    it("should clear all messages", async () => {
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", "Hi");
      db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("assistant", "Hello");

      const res = await request(app).delete("/api/messages");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);

      const messages = db.prepare("SELECT * FROM messages").all();
      expect(messages).toHaveLength(0);
    });
  });

  describe("POST /api/chat", () => {
    it("should reject empty message", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ message: "" });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("message is required");
    });

    it("should reject missing message", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({});
      expect(res.status).toBe(400);
    });

    it("should stream response via SSE", async () => {
      const res = await request(app)
        .post("/api/chat")
        .send({ message: "Hello" });

      expect(res.status).toBe(200);
      expect(res.headers["content-type"]).toContain("text/event-stream");

      // Parse SSE data
      const lines = res.text.split("\n").filter((l: string) => l.startsWith("data: "));
      const events = lines.map((l: string) => JSON.parse(l.slice(6)));

      // Should have delta events and a done event
      const deltas = events.filter((e: any) => e.type === "delta");
      const doneEvents = events.filter((e: any) => e.type === "done");
      expect(deltas.length).toBeGreaterThan(0);
      expect(doneEvents).toHaveLength(1);

      // Concatenated text should be "Hello world"
      const fullText = deltas.map((e: any) => e.text).join("");
      expect(fullText).toBe("Hello world");
    });

    it("should save user and assistant messages to DB", async () => {
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
  });

  describe("DELETE /api/settings/avatar", () => {
    it("should return ok even with no avatar", async () => {
      const res = await request(app).delete("/api/settings/avatar");
      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
    });
  });
});
