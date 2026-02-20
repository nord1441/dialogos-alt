import "dotenv/config";
import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import db from "./db";
import { PROVIDER_MODELS, fetchOllamaModels, streamChat, ModelInfo } from "./providers";

export function createApp(options?: { dataDir?: string }) {
  const app = express();
  const DATA_DIR = options?.dataDir || process.env.DATA_DIR || "./data";

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

  // Helper: get setting from DB
  function getSetting(key: string): string | undefined {
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  // Helper: set setting in DB
  function setSetting(key: string, value: string) {
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(key, value);
  }

  // Get settings
  app.get("/api/settings", (_req: Request, res: Response) => {
    const systemPrompt = getSetting("system_prompt");

    // Find avatar file
    const uploadsDir = path.join(DATA_DIR, "uploads");
    let avatarUrl: string | null = null;
    if (fs.existsSync(uploadsDir)) {
      const files = fs.readdirSync(uploadsDir).filter((f) => f.startsWith("avatar"));
      if (files.length > 0) {
        avatarUrl = `/uploads/${files[0]}`;
      }
    }

    // Provider settings
    const activeModel = getSetting("active_model");
    const enabledModels = getSetting("enabled_models");

    res.json({
      systemPrompt: systemPrompt || "You are a helpful assistant.",
      avatarUrl,
      activeModel: activeModel ? JSON.parse(activeModel) : { provider: "anthropic", model: "claude-opus-4-6" },
      enabledModels: enabledModels ? JSON.parse(enabledModels) : [],
      providerKeys: {
        anthropic: getSetting("anthropic_api_key") ? true : false,
        openai: getSetting("openai_api_key") ? true : false,
        gemini: getSetting("gemini_api_key") ? true : false,
      },
      ollamaBaseUrl: getSetting("ollama_base_url") || "http://localhost:11434",
    });
  });

  // Update system prompt
  app.post("/api/settings/system-prompt", (req: Request, res: Response) => {
    const { systemPrompt } = req.body;
    if (typeof systemPrompt !== "string") {
      res.status(400).json({ error: "systemPrompt must be a string" });
      return;
    }
    setSetting("system_prompt", systemPrompt);
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

  // Save provider API key
  app.post("/api/settings/provider-key", (req: Request, res: Response) => {
    const { provider, apiKey } = req.body;
    const validProviders = ["anthropic", "openai", "gemini"];
    if (!validProviders.includes(provider)) {
      res.status(400).json({ error: "Invalid provider" });
      return;
    }
    if (typeof apiKey !== "string") {
      res.status(400).json({ error: "apiKey must be a string" });
      return;
    }
    if (apiKey.trim()) {
      setSetting(`${provider}_api_key`, apiKey.trim());
    } else {
      db.prepare("DELETE FROM settings WHERE key = ?").run(`${provider}_api_key`);
    }
    res.json({ ok: true });
  });

  // Save Ollama base URL
  app.post("/api/settings/ollama-url", (req: Request, res: Response) => {
    const { baseUrl } = req.body;
    if (typeof baseUrl !== "string") {
      res.status(400).json({ error: "baseUrl must be a string" });
      return;
    }
    setSetting("ollama_base_url", baseUrl.trim() || "http://localhost:11434");
    res.json({ ok: true });
  });

  // Save enabled models
  app.post("/api/settings/enabled-models", (req: Request, res: Response) => {
    const { models } = req.body;
    if (!Array.isArray(models)) {
      res.status(400).json({ error: "models must be an array" });
      return;
    }
    setSetting("enabled_models", JSON.stringify(models));
    res.json({ ok: true });
  });

  // Save active model
  app.post("/api/settings/active-model", (req: Request, res: Response) => {
    const { provider, model } = req.body;
    if (typeof provider !== "string" || typeof model !== "string") {
      res.status(400).json({ error: "provider and model are required" });
      return;
    }
    setSetting("active_model", JSON.stringify({ provider, model }));
    res.json({ ok: true });
  });

  // Get available models (including Ollama dynamic fetch)
  app.get("/api/models", async (_req: Request, res: Response) => {
    const ollamaBaseUrl = getSetting("ollama_base_url") || "http://localhost:11434";
    const ollamaModels = await fetchOllamaModels(ollamaBaseUrl);

    const allModels: Record<string, ModelInfo[]> = {
      ...PROVIDER_MODELS,
      ollama: ollamaModels,
    };

    res.json(allModels);
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

    const systemPrompt =
      getSetting("system_prompt") || "You are a helpful assistant.";

    const apiMessages = history.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Get active model
    const activeModelStr = getSetting("active_model");
    const activeModel = activeModelStr
      ? JSON.parse(activeModelStr)
      : { provider: "anthropic", model: "claude-opus-4-6" };

    // Get provider config
    const providerConfig: { apiKey?: string; baseUrl?: string } = {};
    if (activeModel.provider === "anthropic") {
      providerConfig.apiKey =
        getSetting("anthropic_api_key") || process.env.ANTHROPIC_API_KEY;
    } else if (activeModel.provider === "openai") {
      providerConfig.apiKey =
        getSetting("openai_api_key") || process.env.OPENAI_API_KEY;
    } else if (activeModel.provider === "gemini") {
      providerConfig.apiKey =
        getSetting("gemini_api_key") || process.env.GEMINI_API_KEY;
    } else if (activeModel.provider === "ollama") {
      providerConfig.baseUrl =
        getSetting("ollama_base_url") || process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    }

    // Set up SSE
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      let fullResponse = "";

      const stream = streamChat({
        provider: activeModel.provider,
        model: activeModel.model,
        messages: apiMessages,
        systemPrompt,
        maxTokens: 4096,
        providerConfig,
      });

      for await (const text of stream) {
        fullResponse += text;
        res.write(`data: ${JSON.stringify({ type: "delta", text })}\n\n`);
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
