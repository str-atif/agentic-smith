import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenAIProvider } from "./openai";
import { createProvider } from "./registry";
import type { ChatRequest } from "@clpc/types";

function buildRequest(overrides?: Partial<ChatRequest>): ChatRequest {
  return {
    messages: [{ id: "1", role: "user", content: "hi", timestamp: new Date().toISOString() }],
    modelId: "openai",
    stream: true,
    ...overrides,
  };
}

function streamBody(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      chunks.forEach((c) => controller.enqueue(encoder.encode(c)));
      controller.close();
    },
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("OpenAIProvider", () => {
  it("identifies as openai", () => {
    const provider = new OpenAIProvider({ apiKey: "test" });
    expect(provider.id).toBe("openai");
    expect(provider.supportsStreaming).toBe(true);
    expect(provider.displayName).toBe("gpt-4o");
  });

  it("parses a non-streaming completion", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          id: "chatcmpl-123",
          choices: [{ message: { content: "hello there" } }],
        })
      )
    );

    const provider = new OpenAIProvider({ apiKey: "sk-test" });
    const result = await provider.complete(buildRequest({ stream: false }));
    expect(result.content).toBe("hello there");
    expect(result.id).toBe("chatcmpl-123");
  });

  it("yields tokens and then done for a stream", async () => {
    const sse = "data: " + JSON.stringify({ id: "x", choices: [{ delta: { content: "Hel" }, finish_reason: null }] }) + "\n\n" +
      "data: " + JSON.stringify({ id: "x", choices: [{ delta: { content: "lo" }, finish_reason: null }] }) + "\n\n" +
      "data: [DONE]\n\n";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(streamBody([sse]))));

    const provider = new OpenAIProvider({ apiKey: "sk-test" });
    const events = [];
    for await (const event of provider.stream(buildRequest())) {
      events.push(event);
    }
    expect(events.filter((e) => e.type === "token").map((e) => e.content).join("")).toBe("Hello");
    expect(events[events.length - 1].type).toBe("done");
  });

  it("throws an error when the API returns a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ error: "bad key" }, 401))
    );
    const provider = new OpenAIProvider({ apiKey: "wrong" });
    await expect(provider.complete(buildRequest({ stream: false }))).rejects.toThrow(
      /401/
    );
  });
});

describe("provider registry", () => {
  it("creates a provider for a known id", () => {
    const provider = createProvider({
      providerId: "openai",
      apiKey: "sk-test",
      modelName: "gpt-4o",
    });
    expect(provider.id).toBe("openai");
  });

  it("throws for unknown provider ids", () => {
    expect(() =>
      createProvider({ providerId: "claude", apiKey: "x", modelName: "x" })
    ).toThrow(/No model provider registered/);
  });
});