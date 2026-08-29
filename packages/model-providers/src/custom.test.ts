import { afterEach, describe, expect, it, vi } from "vitest";
import { CustomOpenAIProvider } from "./custom";
import { buildChatCompletionsUrl } from "./openaiCompatible";
import { createProviderFromPreset, testProviderConnection } from "./index";

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("CustomOpenAIProvider", () => {
  it("identifies as openai-compatible with the configured model", () => {
    const provider = new CustomOpenAIProvider({
      baseUrl: "http://localhost:8080/v1",
      modelName: "my-model",
    });
    expect(provider.id).toBe("openai-compatible");
    expect(provider.modelName).toBe("my-model");
    expect(provider.supportsStreaming).toBe(true);
  });

  it("requires a base URL", () => {
    expect(() => new CustomOpenAIProvider({ baseUrl: "", modelName: "m" })).toThrow();
  });

  it("omits the Authorization header when no API key is set", async () => {
    let seenHeaders: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        seenHeaders = init.headers as Record<string, string>;
        return jsonResponse({
          id: "c-1",
          choices: [{ message: { content: "hello" } }],
        });
      })
    );

    const provider = new CustomOpenAIProvider({
      baseUrl: "http://localhost:8080/v1",
      modelName: "m",
    });
    const response = await provider.complete({
      messages: [],
      modelId: "custom",
      stream: false,
    });

    expect(seenHeaders["Authorization"]).toBeUndefined();
    expect(response.content).toBe("hello");
  });

  it("sends Bearer, org and project headers when configured", async () => {
    let seenUrl = "";
    let seenHeaders: Record<string, string> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string, init: RequestInit) => {
        seenUrl = url;
        seenHeaders = init.headers as Record<string, string>;
        return jsonResponse({
          id: "c-2",
          choices: [{ message: { content: "ok" } }],
        });
      })
    );

    const provider = new CustomOpenAIProvider({
      baseUrl: "http://company.local/v1",
      modelName: "m",
      apiKey: "sk-secret",
      orgId: "org-1",
      projectId: "proj-1",
      headers: { "X-Custom": "yes" },
    });

    await provider.complete({ messages: [], modelId: "custom" });

    expect(seenUrl).toBe("http://company.local/v1/chat/completions");
    expect(seenHeaders["Authorization"]).toBe("Bearer sk-secret");
    expect(seenHeaders["OpenAI-Organization"]).toBe("org-1");
    expect(seenHeaders["OpenAI-Project"]).toBe("proj-1");
    expect(seenHeaders["X-Custom"]).toBe("yes");
  });

  it("uses AbortSignal.timeout when timeoutMs is set", async () => {
    let signal: AbortSignal | null | undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        signal = init.signal;
        return jsonResponse({ id: "c-3", choices: [{ message: { content: "" } }] });
      })
    );

    const provider = new CustomOpenAIProvider({
      baseUrl: "http://localhost:8080/v1",
      modelName: "m",
      timeoutMs: 5000,
    });
    await provider.complete({ messages: [], modelId: "custom" });

    expect(signal).toBeDefined();
    expect(signal?.aborted).toBe(false);
  });

  it("supports streaming discontinuation via complete", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ id: "c-4", choices: [{ message: { content: "one shot" } }] })
      )
    );

    const provider = new CustomOpenAIProvider({
      baseUrl: "http://localhost:8080/v1",
      modelName: "m",
      streaming: false,
    });
    expect(provider.supportsStreaming).toBe(false);

    const tokens: string[] = [];
    for await (const event of provider.stream({ messages: [], modelId: "custom" })) {
      if (event.type === "token") tokens.push(event.content ?? "");
    }
    expect(tokens).toEqual(["one shot"]);
  });

  it("reports provider errors clearly", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({}, 401)));

    const provider = new CustomOpenAIProvider({
      baseUrl: "http://localhost:8080/v1",
      modelName: "m",
      apiKey: "bad",
    });
    await expect(
      provider.complete({ messages: [], modelId: "custom" })
    ).rejects.toThrow(/401/);
  });
});

describe("custom provider URL construction", () => {
  let seenUrl = "";

  function stubFetch() {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (url: string) => {
        seenUrl = url;
        return jsonResponse({ id: "u-1", choices: [{ message: { content: "ok" } }] });
      })
    );
  }

  it("appends /v1/chat/completions for a bare host:port base", async () => {
    stubFetch();
    const provider = new CustomOpenAIProvider({
      baseUrl: "http://localhost:8237",
      modelName: "deepseek-chat",
    });
    await provider.complete({ messages: [], modelId: "custom" });
    expect(seenUrl).toBe("http://localhost:8237/v1/chat/completions");
  });

  it("does not duplicate /v1 when the base already includes it", async () => {
    stubFetch();
    const provider = new CustomOpenAIProvider({
      baseUrl: "http://localhost:8237/v1",
      modelName: "deepseek-chat",
    });
    await provider.complete({ messages: [], modelId: "custom" });
    expect(seenUrl).toBe("http://localhost:8237/v1/chat/completions");
  });

  it("handles a base with a trailing slash", async () => {
    stubFetch();
    const provider = new CustomOpenAIProvider({
      baseUrl: "http://localhost:8237/v1/",
      modelName: "deepseek-chat",
    });
    await provider.complete({ messages: [], modelId: "custom" });
    expect(seenUrl).toBe("http://localhost:8237/v1/chat/completions");
  });

  it("does not double-append when a full endpoint is supplied", async () => {
    stubFetch();
    const provider = new CustomOpenAIProvider({
      baseUrl: "http://localhost:8237/v1/chat/completions",
      modelName: "deepseek-chat",
    });
    await provider.complete({ messages: [], modelId: "custom" });
    expect(seenUrl).toBe("http://localhost:8237/v1/chat/completions");
  });

  it("covers remaining helper edge cases", () => {
    expect(buildChatCompletionsUrl("http://host:9000")).toBe(
      "http://host:9000/v1/chat/completions"
    );
    expect(buildChatCompletionsUrl("http://host:9000/chat/completions")).toBe(
      "http://host:9000/chat/completions"
    );
    expect(buildChatCompletionsUrl("http://host:9000/v1/")).toBe(
      "http://host:9000/v1/chat/completions"
    );
  });
});

describe("createProviderFromPreset", () => {
  it("builds a custom provider from a preset", () => {
    const provider = createProviderFromPreset({
      id: "local-1",
      displayName: "Local",
      providerId: "openai-compatible",
      modelName: "qwen2.5",
      baseUrl: "http://localhost:11434/v1",
    });
    expect(provider.id).toBe("openai-compatible");
    expect(provider.modelName).toBe("qwen2.5");
  });

  it("prefills a known OpenRouter endpoint from the registry", () => {
    const provider = createProviderFromPreset({
      id: "router-1",
      displayName: "OpenRouter",
      providerId: "openrouter",
      modelName: "anthropic/claude-3.5-sonnet",
    });
    expect(provider.modelName).toBe("anthropic/claude-3.5-sonnet");
  });
});

describe("testProviderConnection", () => {
  it("returns ok with latency and a reply for a reachable endpoint", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({ id: "t-1", choices: [{ message: { content: "pong" } }] })
      )
    );

    const provider = new CustomOpenAIProvider({
      baseUrl: "http://localhost:8080/v1",
      modelName: "m",
    });
    const result = await testProviderConnection(provider, {
      timeoutMs: 2000,
      testStreaming: false,
    });
    expect(result.ok).toBe(true);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.message).toContain("pong");
  });

  it("returns ok:false with a friendly message on connection failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("fetch failed: ECONNREFUSED"))
    );

    const provider = new CustomOpenAIProvider({
      baseUrl: "http://127.0.0.1:1/v1",
      modelName: "m",
    });
    const result = await testProviderConnection(provider, {
      timeoutMs: 1500,
      testStreaming: false,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("ECONNREFUSED");
  });

  it("times out mid-flight when the endpoint hangs", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(
        () =>
          new Promise<Response>((_resolve, reject) => {
            setTimeout(() => reject(new Error("timed out")), 4000);
          })
      )
    );

    const provider = new CustomOpenAIProvider({
      baseUrl: "http://localhost:8080/v1",
      modelName: "m",
    });
    const result = await testProviderConnection(provider, {
      timeoutMs: 200,
      testStreaming: false,
    });
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/timed out|abort/i);
  });
});