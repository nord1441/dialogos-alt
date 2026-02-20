import { describe, it, expect, vi, beforeEach } from "vitest";

// SDK モジュールをモックして実際のAPI通信を行わずにテスト
// コンストラクタとして new で呼ばれるため function 構文を使用
vi.mock("@anthropic-ai/sdk", () => {
  const MockAnthropic = vi.fn(function (this: any, opts: any) {
    this._opts = opts;
    this.messages = {
      stream: vi.fn().mockReturnValue({
        [Symbol.asyncIterator]: async function* () {
          yield { type: "content_block_delta", delta: { type: "text_delta", text: "anthropic-response" } };
        },
      }),
    };
  });
  return { default: MockAnthropic };
});

vi.mock("openai", () => {
  const MockOpenAI = vi.fn(function (this: any, opts: any) {
    this._opts = opts;
    this.chat = {
      completions: {
        create: vi.fn().mockReturnValue({
          [Symbol.asyncIterator]: async function* () {
            yield { choices: [{ delta: { content: "openai-response" } }] };
          },
        }),
      },
    };
  });
  return { default: MockOpenAI };
});

vi.mock("@google/generative-ai", () => {
  const MockGoogleGenerativeAI = vi.fn(function (this: any, _apiKey: string) {
    this.getGenerativeModel = vi.fn().mockReturnValue({
      startChat: vi.fn().mockReturnValue({
        sendMessageStream: vi.fn().mockImplementation(() =>
          Promise.resolve({
            stream: (async function* () {
              yield { text: () => "gemini-response" };
            })(),
          })
        ),
      }),
    });
  });
  return { GoogleGenerativeAI: MockGoogleGenerativeAI };
});

import {
  PROVIDER_MODELS,
  PROVIDER_DEFAULTS,
  streamChat,
  type ChatOptions,
  type ModelInfo,
} from "../providers";

describe("providers module", () => {

  // ========================================
  // PROVIDER_MODELS - 各プロバイダーの静的モデルリスト
  // ========================================
  describe("PROVIDER_MODELS", () => {
    // 全4プロバイダーのキーが定義されているか確認
    it("should define models for all 4 providers", () => {
      expect(PROVIDER_MODELS).toHaveProperty("anthropic");
      expect(PROVIDER_MODELS).toHaveProperty("openai");
      expect(PROVIDER_MODELS).toHaveProperty("gemini");
      expect(PROVIDER_MODELS).toHaveProperty("ollama");
    });

    // Anthropicモデルリストが1つ以上のモデルを含むか確認
    it("should have at least one Anthropic model", () => {
      expect(PROVIDER_MODELS.anthropic.length).toBeGreaterThan(0);
    });

    // OpenAIモデルリストが1つ以上のモデルを含むか確認
    it("should have at least one OpenAI model", () => {
      expect(PROVIDER_MODELS.openai.length).toBeGreaterThan(0);
    });

    // Geminiモデルリストが1つ以上のモデルを含むか確認
    it("should have at least one Gemini model", () => {
      expect(PROVIDER_MODELS.gemini.length).toBeGreaterThan(0);
    });

    // Ollamaのモデルリストが空配列（動的取得のため）か確認
    it("should have empty array for ollama (dynamically fetched)", () => {
      expect(PROVIDER_MODELS.ollama).toEqual([]);
    });

    // 各モデルエントリがid, name, providerの全フィールドを持つか確認
    it("should have id, name, and provider in every model entry", () => {
      for (const [provider, models] of Object.entries(PROVIDER_MODELS)) {
        for (const model of models) {
          expect(model).toHaveProperty("id");
          expect(model).toHaveProperty("name");
          expect(model).toHaveProperty("provider");
          expect(model.provider).toBe(provider);
        }
      }
    });

    // 同一プロバイダー内でモデルIDが重複していないか確認
    it("should not have duplicate model IDs within a provider", () => {
      for (const [_provider, models] of Object.entries(PROVIDER_MODELS)) {
        const ids = models.map((m: ModelInfo) => m.id);
        const uniqueIds = new Set(ids);
        expect(uniqueIds.size).toBe(ids.length);
      }
    });
  });

  // ========================================
  // PROVIDER_DEFAULTS - プロバイダーのデフォルト設定
  // ========================================
  describe("PROVIDER_DEFAULTS", () => {
    // 全4プロバイダーのデフォルト値が定義されているか確認
    it("should define defaults for all 4 providers", () => {
      expect(PROVIDER_DEFAULTS).toHaveProperty("anthropic");
      expect(PROVIDER_DEFAULTS).toHaveProperty("openai");
      expect(PROVIDER_DEFAULTS).toHaveProperty("gemini");
      expect(PROVIDER_DEFAULTS).toHaveProperty("ollama");
    });

    // 各プロバイダーにbaseUrlフィールドが存在するか確認
    it("should have baseUrl for every provider", () => {
      for (const [_provider, defaults] of Object.entries(PROVIDER_DEFAULTS)) {
        expect(defaults).toHaveProperty("baseUrl");
        expect(typeof defaults.baseUrl).toBe("string");
        expect(defaults.baseUrl.length).toBeGreaterThan(0);
      }
    });

    // Anthropicのデフォルトエンドポイントが正しいか確認
    it("should have correct default base URL for Anthropic", () => {
      expect(PROVIDER_DEFAULTS.anthropic.baseUrl).toBe("https://api.anthropic.com");
    });

    // OpenAIのデフォルトエンドポイントが正しいか確認
    it("should have correct default base URL for OpenAI", () => {
      expect(PROVIDER_DEFAULTS.openai.baseUrl).toBe("https://api.openai.com/v1");
    });

    // Geminiのデフォルトエンドポイントが正しいか確認
    it("should have correct default base URL for Gemini", () => {
      expect(PROVIDER_DEFAULTS.gemini.baseUrl).toBe("https://generativelanguage.googleapis.com");
    });

    // Ollamaのデフォルトエンドポイントが正しいか確認
    it("should have correct default base URL for Ollama", () => {
      expect(PROVIDER_DEFAULTS.ollama.baseUrl).toBe("http://localhost:11434");
    });
  });

  // ========================================
  // streamChat - プロバイダーディスパッチャー
  // ========================================
  describe("streamChat", () => {
    const baseChatOptions: Omit<ChatOptions, "provider" | "model"> = {
      messages: [{ role: "user", content: "Hello" }],
      systemPrompt: "You are helpful.",
      maxTokens: 100,
      providerConfig: { apiKey: "test-key" },
    };

    // Anthropicプロバイダーにリクエストが正しくルーティングされるか確認
    it("should route to Anthropic provider and return response", async () => {
      const gen = streamChat({
        ...baseChatOptions,
        provider: "anthropic",
        model: "claude-opus-4-6",
      });
      const chunks: string[] = [];
      for await (const text of gen) {
        chunks.push(text);
      }
      expect(chunks.join("")).toBe("anthropic-response");
    });

    // OpenAIプロバイダーにリクエストが正しくルーティングされるか確認
    it("should route to OpenAI provider and return response", async () => {
      const gen = streamChat({
        ...baseChatOptions,
        provider: "openai",
        model: "gpt-4o",
      });
      const chunks: string[] = [];
      for await (const text of gen) {
        chunks.push(text);
      }
      expect(chunks.join("")).toBe("openai-response");
    });

    // Geminiプロバイダーにリクエストが正しくルーティングされるか確認
    it("should route to Gemini provider and return response", async () => {
      const gen = streamChat({
        ...baseChatOptions,
        provider: "gemini",
        model: "gemini-2.0-flash",
      });
      const chunks: string[] = [];
      for await (const text of gen) {
        chunks.push(text);
      }
      expect(chunks.join("")).toBe("gemini-response");
    });

    // 未知のプロバイダー名でエラーが投げられるか確認
    it("should throw error for unknown provider", () => {
      expect(() =>
        streamChat({
          ...baseChatOptions,
          provider: "unknown",
          model: "some-model",
        })
      ).toThrow("Unknown provider: unknown");
    });

    // providerConfigにbaseUrlを渡した場合にAnthropicクライアントに伝搬されるか確認
    it("should pass baseUrl to Anthropic client when provided", async () => {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;

      const gen = streamChat({
        ...baseChatOptions,
        provider: "anthropic",
        model: "claude-opus-4-6",
        providerConfig: { apiKey: "test-key", baseUrl: "https://proxy.anthropic.example.com" },
      });
      // ストリームを消費
      for await (const _text of gen) {}

      expect(Anthropic).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "test-key",
          baseURL: "https://proxy.anthropic.example.com",
        })
      );
    });

    // providerConfigにbaseUrlを渡した場合にOpenAIクライアントに伝搬されるか確認
    it("should pass baseUrl to OpenAI client when provided", async () => {
      const OpenAI = (await import("openai")).default;

      const gen = streamChat({
        ...baseChatOptions,
        provider: "openai",
        model: "gpt-4o",
        providerConfig: { apiKey: "test-key", baseUrl: "https://proxy.openai.example.com" },
      });
      for await (const _text of gen) {}

      expect(OpenAI).toHaveBeenCalledWith(
        expect.objectContaining({
          apiKey: "test-key",
          baseURL: "https://proxy.openai.example.com",
        })
      );
    });

    // providerConfigにbaseUrlを渡した場合にGeminiのrequestOptionsに伝搬されるか確認
    it("should pass baseUrl to Gemini via requestOptions when provided", async () => {
      const { GoogleGenerativeAI } = await import("@google/generative-ai");

      const gen = streamChat({
        ...baseChatOptions,
        provider: "gemini",
        model: "gemini-2.0-flash",
        providerConfig: { apiKey: "test-key", baseUrl: "https://proxy.gemini.example.com" },
      });
      for await (const _text of gen) {}

      // GoogleGenerativeAI の最新のインスタンスを取得（前のテストで別インスタンスが生成されている場合がある）
      const instances = vi.mocked(GoogleGenerativeAI).mock.instances;
      const mockInstance = instances[instances.length - 1] as any;
      expect(mockInstance.getGenerativeModel).toHaveBeenCalledWith(
        expect.objectContaining({ model: "gemini-2.0-flash" }),
        expect.objectContaining({ baseUrl: "https://proxy.gemini.example.com" })
      );
    });

    // APIキーが未設定でもクライアントが生成されるか確認（SDKがデフォルト値を使用）
    it("should create client without apiKey when not provided", async () => {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;

      const gen = streamChat({
        ...baseChatOptions,
        provider: "anthropic",
        model: "claude-opus-4-6",
        providerConfig: {},
      });
      for await (const _text of gen) {}

      // apiKey が undefined の場合、オプションオブジェクトに含まれない
      const calls = vi.mocked(Anthropic).mock.calls;
      const callArgs = calls[calls.length - 1]?.[0] as Record<string, unknown> | undefined;
      expect(callArgs?.apiKey).toBeUndefined();
    });
  });

  // ========================================
  // fetchOllamaModels - Ollamaモデルの動的取得
  // ========================================
  describe("fetchOllamaModels", () => {
    beforeEach(() => {
      vi.restoreAllMocks();
    });

    // Ollama APIからモデルリストを正常に取得できるか確認
    it("should fetch and parse models from Ollama API", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            models: [
              { name: "llama3:latest" },
              { name: "codellama:7b" },
            ],
          }),
      }) as any;

      // モック解除して実際の関数をテスト
      const { fetchOllamaModels } = await vi.importActual<typeof import("../providers")>("../providers");
      const models = await fetchOllamaModels("http://localhost:11434");
      expect(models).toHaveLength(2);
      expect(models[0]).toEqual({ id: "llama3:latest", name: "llama3:latest", provider: "ollama" });
      expect(models[1]).toEqual({ id: "codellama:7b", name: "codellama:7b", provider: "ollama" });
    });

    // Ollama APIが空のモデルリストを返した場合に空配列になるか確認
    it("should return empty array when Ollama returns no models", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      }) as any;

      const { fetchOllamaModels } = await vi.importActual<typeof import("../providers")>("../providers");
      const models = await fetchOllamaModels("http://localhost:11434");
      expect(models).toEqual([]);
    });

    // Ollama APIがHTTPエラーを返した場合に空配列になるか確認
    it("should return empty array on HTTP error response", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
      }) as any;

      const { fetchOllamaModels } = await vi.importActual<typeof import("../providers")>("../providers");
      const models = await fetchOllamaModels("http://localhost:11434");
      expect(models).toEqual([]);
    });

    // Ollamaサーバーに接続できない場合に空配列になるか確認
    it("should return empty array on network error (connection refused)", async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED")) as any;

      const { fetchOllamaModels } = await vi.importActual<typeof import("../providers")>("../providers");
      const models = await fetchOllamaModels("http://localhost:11434");
      expect(models).toEqual([]);
    });

    // カスタムベースURLを使ってOllamaに接続するか確認
    it("should use provided base URL for the request", async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ models: [] }),
      }) as any;
      global.fetch = mockFetch;

      const { fetchOllamaModels } = await vi.importActual<typeof import("../providers")>("../providers");
      await fetchOllamaModels("http://192.168.1.10:11434");
      expect(mockFetch).toHaveBeenCalledWith("http://192.168.1.10:11434/api/tags");
    });
  });
});
