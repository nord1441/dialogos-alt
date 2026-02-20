import "dotenv/config";
import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import Anthropic from "@anthropic-ai/sdk";
import db from "./db";

export function createApp(options?: { dataDir?: string }) {
  const app = express();
  const DATA_DIR = options?.dataDir || process.env.DATA_DIR || "./data";

  const client = new Anthropic();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, "../public")));
  app.use("/uploads", express.static(path.join(DATA_DIR, "uploads")));

  const upload = multer({
    storage: multer.diskStorage({
      destination: path.join(DATA_DIR, "uploads"),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname);
        cb(null, `avatar${ext}`);
      },
    }),
    fileFilter: (_req, file, cb) => {
      const allowed = /\.(jpg|jpeg|png|gif|webp|mp4|webm)$/i;
      if (allowed.test(path.extname(file.originalname))) {
        cb(null, true);
      } else {
        cb(new Error("Unsupported file type"));
      }
    },
    limits: { fileSize: 50 * 1024 * 1024 },
  });

  // Get settings
  app.get("/api/settings", (_req: Request, res: Response) => {
    const systemPrompt = db.prepare("SELECT value FROM settings WHERE key = ?").get("system_prompt") as
      | { value: string }
      | undefined;

    // Find avatar file
    const uploadsDir = path.join(DATA_DIR, "uploads");
    let avatarUrl: string | null = null;
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir).filter((f) => f.startsWith("avatar"));
      if (files.length > 0) {
        avatarUrl = `/uploads/${files[0]}`;
      }
    }

    res.json({
      systemPrompt: systemPrompt?.value || "You are a helpful assistant.",
      avatarUrl,
    });
  });

  // Update system prompt
  app.post("/api/settings/system-prompt", (req: Request, res: Response) => {
    const { systemPrompt } = req.body;
    if (typeof systemPrompt !== "string") {
      res.status(400).json({ error: "systemPrompt must be a string" });
      return;
    }
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
      "system_prompt",
      systemPrompt
    );
    res.json({ ok: true });
  });

  // Upload avatar
  app.post("/api/settings/avatar", upload.single("avatar"), (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }

    // Remove old avatar files with different extensions
    const uploadsDir = path.join(DATA_DIR, "uploads");
    const files = fs.readdirSync(uploadsDir).filter((f) => f.startsWith("avatar"));
    for (const f of files) {
      if (f !== req.file.filename) {
        fs.unlinkSync(path.join(uploadsDir, f));
      }
    }

    res.json({ avatarUrl: `/uploads/${req.file.filename}` });
  });

  // Delete avatar
  app.delete("/api/settings/avatar", (_req: Request, res: Response) => {
    const uploadsDir = path.join(DATA_DIR, "uploads");
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir).filter((f) => f.startsWith("avatar"));
      for (const f of files) {
        fs.unlinkSync(path.join(uploadsDir, f));
      }
    }
    res.json({ ok: true });
  });

  // Get messages
  app.get("/api/messages", (_req: Request, res: Response) => {
    const messages = db.prepare("SELECT id, role, content, created_at FROM messages ORDER BY id ASC").all();
    res.json(messages);
  });

  // Clear messages
  app.delete("/api/messages", (_req: Request, res: Response) => {
    db.prepare("DELETE FROM messages").run();
    res.json({ ok: true });
  });

  // Send message and stream response
  app.post("/api/chat", async (req: Request, res: Response) => {
    const { message } = req.body;
    if (typeof message !== "string" || !message.trim()) {
      res.status(400).json({ error: "message is required" });
      return;
    }

    // Save user message
    db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("user", message);

    // Build conversation history
    const history = db.prepare("SELECT role, content FROM messages ORDER BY id ASC").all() as {
      role: string;
      content: string;
    }[];

    const systemPrompt = (
      db.prepare("SELECT value FROM settings WHERE key = ?").get("system_prompt") as { value: string } | undefined
    )?.value || "You are a helpful assistant.";

    const apiMessages = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      let fullResponse = "";

      const stream = client.messages.stream({
        model: "claude-opus-4-6",
        max_tokens: 4096,
        system: systemPrompt,
        messages: apiMessages,
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          fullResponse += event.delta.text;
          res.write(`data: ${JSON.stringify({ type: "delta", text: event.delta.text })}\n\n`);
        }
      }

      // Save assistant response
      if (fullResponse) {
        db.prepare("INSERT INTO messages (role, content) VALUES (?, ?)").run("assistant", fullResponse);
      }

      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
      res.end();
    } catch (err: any) {
      const errorMsg = err?.message || "An error occurred";
      res.write(`data: ${JSON.stringify({ type: "error", error: errorMsg })}\n\n`);
      res.end();
    }
  });

  return app;
}

if (require.main === module) {
  const HOST = process.env.HOST || "0.0.0.0";
  const PORT = parseInt(process.env.PORT || "3000", 10);
  const app = createApp();
  app.listen(PORT, HOST, () => {
    console.log(`dialogos running at http://${HOST}:${PORT}`);
  });
}
