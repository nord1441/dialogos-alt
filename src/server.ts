import "dotenv/config";
import express, { Request, Response } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import db from "./db";
import { PROVIDER_MODELS, PROVIDER_DEFAULTS, fetchOllamaModels, streamChat, ModelInfo } from "./providers";

const ALL_PROVIDERS = ["anthropic", "openai", "gemini", "ollama"];

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

  // Helper: delete setting from DB
  function deleteSetting(key: string) {
    db.prepare("DELETE FROM settings WHERE key = ?").run(key);
  }

  // Helper: resolve provider config (DB > env > default)
  function resolveProviderConfig(provider: string): { apiKey?: string; baseUrl?: string } {
    const envPrefix = provider.toUpperCase();
    const apiKey =
      getSetting(`${provider}_api_key`) ||
      process.env[`${envPrefix}_API_KEY`] ||
      undefined;
    const baseUrl =
      getSetting(`${provider}_base_url`) ||
      process.env[`${envPrefix}_BASE_URL`] ||
      undefined;
    return { apiKey, baseUrl };
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

    // Build providers config status
    const providers: Record<string, { hasApiKey: boolean; baseUrl: string }> = {};
    for (const p of ALL_PROVIDERS) {
      const resolved = resolveProviderConfig(p);
      providers[p] = {
        hasApiKey: !!resolved.apiKey,
        baseUrl: getSetting(`${p}_base_url`) || "",
      };
    }

    res.json({
      systemPrompt: systemPrompt || "You are a helpful assistant.",
      avatarUrl,
      activeModel: activeModel ? JSON.parse(activeModel) : { provider: "anthropic", model: "claude-opus-4-6" },
      enabledModels: enabledModels ? JSON.parse(enabledModels) : [],
      providers,
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

  // Save provider configuration (API key and/or base URL)
  app.post("/api/settings/provider", (req: Request, res: Response) => {
    const { provider, apiKey, baseUrl } = req.body;
    if (!ALL_PROVIDERS.includes(provider)) {
      res.status(400).json({ error: "Invalid provider" });
      return;
    }

    // API key
    if (typeof apiKey === "string") {
      if (apiKey.trim()) {
        setSetting(`${provider}_api_key`, apiKey.trim());
      } else {
        deleteSetting(`${provider}_api_key`);
      }
    }

    // Base URL
    if (typeof baseUrl === "string") {
      if (baseUrl.trim()) {
        setSetting(`${provider}_base_url`, baseUrl.trim());
      } else {
        deleteSetting(`${provider}_base_url`);
      }
    }

    res.json({ ok: true });
  });

  // Test provider connection
  app.post("/api/settings/provider/test", async (req: Request, res: Response) => {
    const { provider } = req.body;
    if (!ALL_PROVIDERS.includes(provider)) {
      res.status(400).json({ error: "Invalid provider" });
      return;
    }

    const config = resolveProviderConfig(provider);

    try {
      if (provider === "anthropic") {
        const Anthropic = (await import("@anthropic-ai/sdk")).default;
        const clientOpts: { apiKey?: string; baseURL?: string } = {};
        if (config.apiKey) clientOpts.apiKey = config.apiKey;
        if (config.baseUrl) clientOpts.baseURL = config.baseUrl;
        const client = new Anthropic(clientOpts);
        await client.models.list({ limit: 1 });
        res.json({ ok: true, message: "connected" });
      } else if (provider === "openai") {
        const OpenAI = (await import("openai")).default;
        const clientOpts: { apiKey?: string; baseURL?: string } = {};
        if (config.apiKey) clientOpts.apiKey = config.apiKey;
        if (config.baseUrl) clientOpts.baseURL = config.baseUrl;
        const client = new OpenAI(clientOpts);
        await client.models.list();
        res.json({ ok: true, message: "connected" });
      } else if (provider === "gemini") {
        const { GoogleGenerativeAI } = await import("@google/generative-ai");
        const genAI = new GoogleGenerativeAI(config.apiKey || "");
        const requestOptions: { baseUrl?: string } = {};
        if (config.baseUrl) requestOptions.baseUrl = config.baseUrl;
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" }, requestOptions);
        await model.countTokens("test");
        res.json({ ok: true, message: "connected" });
      } else if (provider === "ollama") {
        const baseUrl = config.baseUrl || PROVIDER_DEFAULTS.ollama.baseUrl;
        const tagRes = await fetch(`${baseUrl}/api/tags`);
        if (!tagRes.ok) throw new Error(`HTTP ${tagRes.status}`);
        res.json({ ok: true, message: "connected" });
      }
    } catch (err: any) {
      const msg = err?.message || "connection failed";
      res.json({ ok: false, message: msg });
    }
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
    const ollamaConfig = resolveProviderConfig("ollama");
    const ollamaBaseUrl = ollamaConfig.baseUrl || PROVIDER_DEFAULTS.ollama.baseUrl;
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

    // Get provider config (DB > env > undefined)
    const providerConfig = resolveProviderConfig(activeModel.provider);

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
