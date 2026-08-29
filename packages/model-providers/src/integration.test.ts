import { describe, expect, it } from "vitest";
import { createProviderFromPreset } from "./registry";
import { testProviderConnection } from "./testConnection";

const TEST_PROVIDER_URL = process.env.CLPC_TEST_PROVIDER_URL ?? "http://localhost:8237";
const TEST_PROVIDER_KEY = process.env.CLPC_TEST_PROVIDER_KEY ?? "local-deepseek-key";
const TEST_MODEL = process.env.CLPC_TEST_MODEL ?? "deepseek-chat";

describe("live OpenAI-compatible provider", () => {
  it("connects to the local test provider when it is reachable", async () => {
    const provider = createProviderFromPreset({
      id: "live-test",
      displayName: "Local Test Provider",
      providerId: "openai-compatible",
      modelName: TEST_MODEL,
      baseUrl: TEST_PROVIDER_URL,
      apiKey: TEST_PROVIDER_KEY,
      timeoutMs: 8000,
      streaming: true,
    });

    const result = await testProviderConnection(provider, {
      timeoutMs: 8000,
      testStreaming: true,
    });

    if (!result.ok && /ECONNREFUSED|fetch failed|ENOTFOUND|Unable to connect|timed out|aborted/i.test(result.message)) {
      console.log(
        `[integration] test provider ${TEST_PROVIDER_URL} not reachable — skipping live check`
      );
      return;
    }

    expect(result.ok).toBe(true);
    expect(result.model).toBeTruthy();
    console.log(
      `[integration] ${TEST_PROVIDER_URL} -> ok, ${result.latencyMs}ms, model=${result.model}/streaming=${result.streaming}`
    );
  }, 20_000);
});