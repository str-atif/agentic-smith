import { ModelProvider, ModelProviderConfig } from "@clpc/types";
import { OpenAIProvider } from "./openai";
import { DeepSeekProvider } from "./deepseek";

export type ProviderFactory = (config: ModelProviderConfig) => ModelProvider;

const factoryRegistry: Map<string, ProviderFactory> = new Map();

export function registerProvider(
  providerId: string,
  factory: ProviderFactory
): void {
  factoryRegistry.set(providerId, factory);
}

export function createProvider(config: ModelProviderConfig): ModelProvider {
  const factory =
    factoryRegistry.get(config.providerId) ||
    createDefaultFactory(config.providerId);
  return factory(config);
}

function createDefaultFactory(providerId: string): ProviderFactory {
  switch (providerId) {
    case "openai":
      return (cfg) =>
        new OpenAIProvider({
          apiKey: cfg.apiKey || "",
          modelName: cfg.modelName,
          baseUrl: cfg.baseUrl,
          label: cfg.label,
        });
    case "deepseek":
      return (cfg) =>
        new DeepSeekProvider({
          apiKey: cfg.apiKey || "",
          modelName: cfg.modelName,
          baseUrl: cfg.baseUrl,
          label: cfg.label,
        });
    default:
      throw new Error(
        `No model provider registered for "${providerId}". ` +
          `Known providers: ${[...factoryRegistry.keys()].join(", ") || "openai, deepseek"}`
      );
  }
}

registerProvider("openai", (cfg) =>
  new OpenAIProvider({
    apiKey: cfg.apiKey || "",
    modelName: cfg.modelName,
    baseUrl: cfg.baseUrl,
    label: cfg.label,
  })
);

registerProvider("deepseek", (cfg) =>
  new DeepSeekProvider({
    apiKey: cfg.apiKey || "",
    modelName: cfg.modelName,
    baseUrl: cfg.baseUrl,
    label: cfg.label,
  })
);

export interface KnownProvider {
  id: string;
  displayName: string;
  defaultModel: string;
}

export const knownProviders: KnownProvider[] = [
  { id: "openai", displayName: "OpenAI", defaultModel: "gpt-4o" },
  { id: "deepseek", displayName: "DeepSeek", defaultModel: "deepseek-chat" },
];