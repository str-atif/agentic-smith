import { ModelConnectionTestResult, ModelProvider } from "@clpc/types";

export interface TestConnectionOptions {
  timeoutMs?: number;
  testStreaming?: boolean;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Request timed out after ${ms}ms`));
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

function friendlyError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function truncate(text: string, max = 60): string {
  const sanitized = text.replace(/\s+/g, " ").trim();
  return sanitized.length > max ? `${sanitized.slice(0, max)}…` : sanitized;
}

export async function testProviderConnection(
  provider: Pick<
    ModelProvider,
    "complete" | "stream" | "modelName" | "id" | "supportsStreaming" | "displayName"
  >,
  options: TestConnectionOptions = {}
): Promise<ModelConnectionTestResult> {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const startedAt = Date.now();

  try {
    const response = await withTimeout(
      provider.complete({
        messages: [
          {
            id: crypto.randomUUID(),
            role: "user",
            content: "Reply with the single word: ping",
            timestamp: new Date().toISOString(),
          },
        ],
        modelId: provider.id,
        stream: false,
      }),
      timeoutMs
    );

    let streaming: boolean | undefined;
    if (options.testStreaming) {
      if (!provider.supportsStreaming) {
        streaming = false;
      } else {
        try {
          let gotData = false;
          await withTimeout(
            (async () => {
              const events = provider.stream({
                messages: [
                  {
                    id: crypto.randomUUID(),
                    role: "user",
                    content: "Reply with the single word: ping",
                    timestamp: new Date().toISOString(),
                  },
                ],
                modelId: provider.id,
                stream: true,
              });
              for await (const event of events) {
                if (event.type === "token" || event.type === "tool_call") {
                  gotData = true;
                  break;
                }
              }
            })(),
            timeoutMs
          );
          streaming = gotData;
        } catch {
          streaming = false;
        }
      }
    }

    return {
      ok: true,
      endpoint: provider.displayName,
      model: response.modelId || provider.modelName,
      latencyMs: Date.now() - startedAt,
      streaming,
      message: response.content
        ? `Connected. Model replied: "${truncate(response.content)}"`
        : "Connected. Authentication and model accepted.",
    };
  } catch (error) {
    return {
      ok: false,
      endpoint: provider.displayName,
      latencyMs: Date.now() - startedAt,
      message: friendlyError(error),
    };
  }
}