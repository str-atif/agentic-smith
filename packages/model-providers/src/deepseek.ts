import { OpenAICompatibleProvider } from "./openaiCompatible";

export interface DeepSeekProviderConfig {
  apiKey: string;
  modelName?: string;
  baseUrl?: string;
  label?: string;
}

const DEFAULT_MODEL = "deepseek-chat";

export class DeepSeekProvider extends OpenAICompatibleProvider {
  constructor(config: DeepSeekProviderConfig) {
    const modelName = config.modelName || DEFAULT_MODEL;
    super({
      id: "deepseek",
      displayName: config.label || modelName,
      modelName,
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || "https://api.deepseek.com/v1",
    });
  }
}