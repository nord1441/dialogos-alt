import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";

export interface ModelInfo {
  id: string;
  name: string;
  provider: string;
}

export interface ProviderConfig {
  apiKey?: string;
  baseUrl?: string;
}

export interface ChatOptions {
  provider: string;
  model: string;
  messages: { role: string; content: string }[];
  systemPrompt: string;
  maxTokens: number;
  providerConfig: ProviderConfig;
}

export const PROVIDER_MODELS: Record<string, ModelInfo[]> = {
  anthropic: [
    { id: "claude-opus-4-6", name: "Claude Opus 4.6", provider: "anthropic" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", provider: "anthropic" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5", provider: "anthropic" },
  ],
  openai: [
    { id: "gpt-4o", name: "GPT-4o", provider: "openai" },
    { id: "gpt-4o-mini", name: "GPT-4o Mini", provider: "openai" },
    { id: "o1", name: "O1", provider: "openai" },
    { id: "o3-mini", name: "O3 Mini", provider: "openai" },
  ],
  gemini: [
    { id: "gemini-2.0-flash", name: "Gemini 2.0 Flash", provider: "gemini" },
    { id: "gemini-2.0-pro", name: "Gemini 2.0 Pro", provider: "gemini" },
    { id: "gemini-1.5-pro", name: "Gemini 1.5 Pro", provider: "gemini" },
    { id: "gemini-1.5-flash", name: "Gemini 1.5 Flash", provider: "gemini" },
  ],
  ollama: [],
};

export async function fetchOllamaModels(baseUrl: string): Promise<ModelInfo[]> {
  try {
    const res = await fetch(`${baseUrl}/api/tags`);
    if (!res.ok) return [];
    const data = (await res.json()) as { models?: { name: string }[] };
    return (data.models || []).map((m) => ({
      id: m.name,
      name: m.name,
      provider: "ollama",
    }));
  } catch {
    return [];
  }
}

async function* streamAnthropic(options: ChatOptions): AsyncGenerator<string> {
  const client = new Anthropic({ apiKey: options.providerConfig.apiKey });
  const stream = client.messages.stream({
    model: options.model,
    max_tokens: options.maxTokens,
    system: options.systemPrompt,
    messages: options.messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  });
  for await (const event of stream) {
    if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
      yield event.delta.text;
    }
  }
}

async function* streamOpenAI(options: ChatOptions): AsyncGenerator<string> {
  const client = new OpenAI({ apiKey: options.providerConfig.apiKey });
  const stream = await client.chat.completions.create({
    model: options.model,
    max_tokens: options.maxTokens,
    messages: [
      { role: "system" as const, content: options.systemPrompt },
      ...options.messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ],
    stream: true,
  });
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield text;
  }
}

async function* streamGemini(options: ChatOptions): AsyncGenerator<string> {
  const genAI = new GoogleGenerativeAI(options.providerConfig.apiKey || "");
  const model = genAI.getGenerativeModel({
    model: options.model,
    systemInstruction: options.systemPrompt,
  });

  const history = options.messages.slice(0, -1).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const chat = model.startChat({ history });
  const lastMessage = options.messages[options.messages.length - 1];
  const result = await chat.sendMessageStream(lastMessage.content);

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) yield text;
  }
}

async function* streamOllama(options: ChatOptions): AsyncGenerator<string> {
  const baseUrl = options.providerConfig.baseUrl || "http://localhost:11434";
  const client = new OpenAI({
    apiKey: "ollama",
    baseURL: `${baseUrl}/v1`,
  });
  const stream = await client.chat.completions.create({
    model: options.model,
    messages: [
      { role: "system" as const, content: options.systemPrompt },
      ...options.messages.map((m) => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
    ],
    stream: true,
  });
  for await (const chunk of stream) {
    const text = chunk.choices[0]?.delta?.content;
    if (text) yield text;
  }
}

export function streamChat(options: ChatOptions): AsyncGenerator<string> {
  switch (options.provider) {
    case "anthropic":
      return streamAnthropic(options);
    case "openai":
      return streamOpenAI(options);
    case "gemini":
      return streamGemini(options);
    case "ollama":
      return streamOllama(options);
    default:
      throw new Error(`Unknown provider: ${options.provider}`);
  }
}
