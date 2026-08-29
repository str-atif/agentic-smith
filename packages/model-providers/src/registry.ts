import {
  ModelProvider,
  ModelProviderConfig,
  ProviderPreset,
} from "@clpc/types";
import { OpenAIProvider } from "./openai";
import { DeepSeekProvider } from "./deepseek";
import { CustomOpenAIProvider } from "./custom";

export type ProviderFactory = (config: ModelProviderConfig) => ModelProvider;

const factoryRegistry: Map<string, ProviderFactory> = new Map();

export function registerProvider(
  providerId: string,
  factory: ProviderFactory
): void {
  factoryRegistry.set(providerId, factory);
}

export function createProvider(config: ModelProviderConfig): ModelProvider {
  const factory = factoryRegistry.get(config.providerId);
  if (!factory) {
    throw new Error(
      `No model provider registered for "${config.providerId}". ` +
        `Known providers: ${[...factoryRegistry.keys()].join(", ") || "openai, deepseek, openai-compatible"}`
    );
  }
  return factory(config);
}

export function createProviderFromPreset(preset: ProviderPreset): ModelProvider {
  const config: ModelProviderConfig = {
    providerId: preset.providerId,
    apiKey: preset.apiKey,
    modelName: preset.modelName,
    baseUrl: preset.baseUrl,
    label: preset.displayName,
    orgId: preset.orgId,
    projectId: preset.projectId,
    headers: preset.headers,
    timeoutMs: preset.timeoutMs,
    streaming: preset.streaming,
  };
  return createProvider(config);
}

registerProvider("openai", (cfg) =>
  new OpenAIProvider({
    apiKey: cfg.apiKey || "",
    modelName: cfg.modelName,
    baseUrl: cfg.baseUrl,
    label: cfg.label,
    orgId: cfg.orgId,
    projectId: cfg.projectId,
    headers: cfg.headers,
    timeoutMs: cfg.timeoutMs,
    streaming: cfg.streaming,
  })
);

registerProvider("deepseek", (cfg) =>
  new DeepSeekProvider({
    apiKey: cfg.apiKey || "",
    modelName: cfg.modelName,
    baseUrl: cfg.baseUrl,
    label: cfg.label,
    orgId: cfg.orgId,
    projectId: cfg.projectId,
    headers: cfg.headers,
    timeoutMs: cfg.timeoutMs,
    streaming: cfg.streaming,
  })
);

function customFactory(defaultBaseUrl?: string): ProviderFactory {
  return (cfg) =>
    new CustomOpenAIProvider({
      apiKey: cfg.apiKey,
      baseUrl: cfg.baseUrl || defaultBaseUrl || "",
      modelName: cfg.modelName,
      label: cfg.label,
      orgId: cfg.orgId,
      projectId: cfg.projectId,
      headers: cfg.headers,
      timeoutMs: cfg.timeoutMs,
      streaming: cfg.streaming,
    });
}

registerProvider("openai-compatible", customFactory());
registerProvider("openrouter", customFactory("https://openrouter.ai/api/v1"));
registerProvider("ollama", customFactory("http://localhost:11434/v1"));
registerProvider("lmstudio", customFactory("http://localhost:1234/v1"));

export interface KnownProvider {
  id: string;
  displayName: string;
  defaultModel: string;
  defaultBaseUrl?: string;
  apiKeyOptional?: boolean;
}

export const knownProviders: KnownProvider[] = [
  {
    id: "openai",
    displayName: "OpenAI",
    defaultModel: "gpt-4o",
    defaultBaseUrl: "https://api.openai.com/v1",
  },
  {
    id: "deepseek",
    displayName: "DeepSeek",
    defaultModel: "deepseek-chat",
    defaultBaseUrl: "https://api.deepseek.com/v1",
  },
  {
    id: "openrouter",
    displayName: "OpenRouter",
    defaultModel: "",
    defaultBaseUrl: "https://openrouter.ai/api/v1",
  },
  {
    id: "ollama",
    displayName: "Ollama",
    defaultModel: "llama3.1",
    defaultBaseUrl: "http://localhost:11434/v1",
    apiKeyOptional: true,
  },
  {
    id: "lmstudio",
    displayName: "LM Studio",
    defaultModel: "local-model",
    defaultBaseUrl: "http://localhost:1234/v1",
    apiKeyOptional: true,
  },
  {
    id: "openai-compatible",
    displayName: "Custom OpenAI Compatible",
    defaultModel: "",
    defaultBaseUrl: "http://localhost:8080/v1",
    apiKeyOptional: true,
  },
];