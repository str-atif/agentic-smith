import { afterEach, describe, expect, it, vi } from "vitest";
import { DeepSeekProvider } from "./deepseek";
import { createProvider, knownProviders } from "./registry";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DeepSeekProvider", () => {
  it("identifies as deepseek with a default model", () => {
    const provider = new DeepSeekProvider({ apiKey: "test" });
    expect(provider.id).toBe("deepseek");
    expect(provider.modelName).toBe("deepseek-chat");
    expect(provider.displayName).toBe("deepseek-chat");
    expect(provider.supportsStreaming).toBe(true);
  });

  it("falls back to base streaming when the provider method returns no tokens", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            id: "ds-1",
            choices: [{ message: { content: "not used" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )
      )
    );

    const provider = new DeepSeekProvider({ apiKey: "test" });
    for await (const event of provider.stream({
      messages: [],
      modelId: "deepseek",
      stream: true,
    })) {
      expect(typeof event).toBe("object");
    }
  });
});

describe("provider registry", () => {
  it("creates a deepseek provider from config", () => {
    const provider = createProvider({
      providerId: "deepseek",
      apiKey: "sk-test",
      modelName: "deepseek-chat",
    });
    expect(provider.id).toBe("deepseek");
    expect(provider.displayName).toBe("deepseek-chat");
  });

  it("lists known providers including deepseek", () => {
    const ids = knownProviders.map((provider) => provider.id);
    expect(ids).toContain("openai");
    expect(ids).toContain("deepseek");
  });
});