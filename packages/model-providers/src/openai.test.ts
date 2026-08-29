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

function delayedSse(
  parts: Array<{ text: string; at: number }>,
  opts?: RequestInit,
  closeAfterLast = 50
): Response {
  const encoder = new TextEncoder();
  let emitter: ReadableStreamDefaultController<Uint8Array> | undefined;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      emitter = controller;
      opts?.signal?.addEventListener("abort", () => {
        controller.error(new DOMException("Aborted", "AbortError"));
      });
    },
  });
  for (const part of parts) {
    setTimeout(() => emitter?.enqueue(encoder.encode(part.text)), part.at);
  }
  const total = parts.length ? Math.max(...parts.map((p) => p.at)) + closeAfterLast : 10_000;
  setTimeout(() => emitter?.close(), total);
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
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

  it("does not abort a stream merely because it outlived the wall clock while data keeps arriving", async () => {
    const sse1 =
      "data: " + JSON.stringify({ id: "x", choices: [{ delta: { content: "He" }, finish_reason: null }] }) + "\n\n";
    const sse2 =
      "data: " + JSON.stringify({ id: "x", choices: [{ delta: { content: "llo" }, finish_reason: null }] }) + "\n\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, opts?: RequestInit) =>
        delayedSse(
          [
            { text: sse1, at: 20 },
            { text: sse2, at: 300 },
          ],
          opts
        )
      )
    );

    const provider = new OpenAIProvider({ apiKey: "sk-test", timeoutMs: 400 });
    const events: Array<{ type: string; content?: string }> = [];
    for await (const event of provider.stream(buildRequest())) {
      events.push(event as { type: string; content?: string });
    }
    expect(events.filter((e) => e.type === "token").map((e) => e.content).join("")).toBe(
      "Hello"
    );
    expect(events[events.length - 1].type).toBe("done");
  });

  it("times out an idle stream when no data arrives within timeoutMs", async () => {
    const sse =
      "data: " + JSON.stringify({ id: "x", choices: [{ delta: { content: "one" }, finish_reason: null }] }) + "\n\n";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, opts?: RequestInit) =>
        delayedSse([{ text: sse, at: 20 }], opts, 10_000)
      )
    );

    const provider = new OpenAIProvider({ apiKey: "sk-test", timeoutMs: 200 });
    await expect(async () => {
      for await (const _event of provider.stream(buildRequest())) {
        // consume nothing, just wait
      }
    }).rejects.toThrow(/timed out/);
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