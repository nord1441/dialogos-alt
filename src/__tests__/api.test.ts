import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import express from "express";
import db from "../db";

// Mock Anthropic SDK to avoid real API calls
vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = {
        stream: () => {
          const events = [
            { type: "content_block_delta", delta: { type: "text_delta", text: "Hello " } },
            { type: "content_block_delta", delta: { type: "text_delta", text: "world" } },
          ];
          return {
            [Symbol.asyncIterator]: async function* () {
              for (const event of events) {
                yield event;
              }
            },
          };
        },
      };
    },
  };
});

// Import after mock
import { createApp } from "../server";

describe("API endpoints", () => {
  let app: express.Express;

  beforeEach(() => {
    // Clean database state
    db.prepare("DELETE FROM messages").run();
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
