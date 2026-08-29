import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import type { AgentSession, Message, ToolCallRequest } from "@clpc/types";

interface ProviderOption {
  id: string;
  displayName: string;
  defaultModel: string;
}

interface ToolState {
  callId: string;
  toolName: string;
  status: "running" | "finished" | "failed";
  detail?: string;
}

declare global {
  interface Window {
    api: {
      sendMessage: (content: string) => Promise<void>;
      getSession: () => Promise<unknown>;
      getConfig: () => Promise<{
        apiKey?: string;
        modelName?: string;
        providerId?: string;
      }>;
      getProviders: () => Promise<ProviderOption[]>;
      saveConfig: (config: {
        apiKey: string;
        modelName: string;
        providerId: string;
      }) => Promise<{ ok: boolean }>;
      onToken: (callback: (data: { messageId: string; content: string }) => void) => void;
      onMessageReceived: (callback: (data: { id: string; role: string; content: string }) => void) => void;
      onResponseComplete: (callback: (data: unknown) => void) => void;
      onSessionStatus: (callback: (data: { status: string }) => void) => void;
      onToolStarted: (callback: (data: { callId: string; toolName: string }) => void) => void;
      onToolProgress: (callback: (data: { callId: string; message: string }) => void) => void;
      onToolCompleted: (callback: (data: { callId: string; result: unknown }) => void) => void;
      onToolFailed: (callback: (data: { callId: string; error: string }) => void) => void;
      onApprovalRequested: (callback: (data: { approvalId: string; toolName: string; reason: string }) => void) => void;
      onError: (callback: (data: { message: string }) => void) => void;
    };
  }
}

function App() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [session, setSession] = useState<AgentSession | null>(null);
  const [showConfig, setShowConfig] = useState(false);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [config, setConfig] = useState({
    apiKey: "",
    modelName: "gpt-4o",
    providerId: "openai",
  });
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [toolStates, setToolStates] = useState<Record<string, ToolState>>({});
  const [pendingApproval, setPendingApproval] = useState<{
    approvalId: string;
    toolName: string;
    reason: string;
  } | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void loadSession();
    void loadConfig();
    void loadProviders();

    window.api.onToken((data) => {
      setMessages((prev) => {
        const exists = prev.some((m) => m.id === data.messageId);
        if (!exists) {
          return [
            ...prev,
            {
              id: data.messageId,
              role: "assistant",
              content: data.content,
              timestamp: new Date().toISOString(),
            },
          ];
        }
        return prev.map((m) =>
          m.id === data.messageId ? { ...m, content: m.content + data.content } : m
        );
      });
    });

    window.api.onMessageReceived((data) => {
      if (data.role !== "tool") return;
      setMessages((prev) =>
        prev.some((m) => m.id === data.id)
          ? prev
          : [
              ...prev,
              {
                id: data.id,
                role: "tool",
                content: data.content,
                timestamp: new Date().toISOString(),
              },
            ]
      );
    });

    window.api.onResponseComplete((data) => {
      const msg = data as Message;
      setMessages((prev) => {
        const exists = prev.some((m) => m.id === msg.id);
        return exists
          ? prev.map((m) => (m.id === msg.id ? msg : m))
          : [...prev, msg];
      });
      setStreamingMessageId(null);
      setIsLoading(false);
    });

    window.api.onSessionStatus((data) => {
      setSession((prev) => (prev ? { ...prev, status: data.status as AgentSession["status"] } : prev));
    });

    window.api.onToolStarted((data) => {
      setToolStates((prev) => ({
        ...prev,
        [data.callId]: { callId: data.callId, toolName: data.toolName, status: "running" },
      }));
    });

    window.api.onToolProgress((data) => {
      setToolStates((prev) => {
        const existing = prev[data.callId];
        return existing
          ? { ...prev, [data.callId]: { ...existing, detail: data.message } }
          : prev;
      });
    });

    window.api.onToolCompleted((data) => {
      setToolStates((prev) => {
        const existing = prev[data.callId];
        if (!existing) return prev;
        const output =
          data.result && typeof data.result === "object" && "output" in data.result
            ? String((data.result as { output?: unknown }).output)
            : "";
        return {
          ...prev,
          [data.callId]: { ...existing, status: "finished", detail: output },
        };
      });
    });

    window.api.onToolFailed((data) => {
      setToolStates((prev) => {
        const existing = prev[data.callId];
        return existing
          ? { ...prev, [data.callId]: { ...existing, status: "failed", detail: data.error } }
          : {
              ...prev,
              [data.callId]: {
                callId: data.callId,
                toolName: "unknown",
                status: "failed",
                detail: data.error,
              },
            };
      });
    });

    window.api.onApprovalRequested((data) => {
      setPendingApproval(data);
    });

    window.api.onError((data) => {
      void console.error("CLPC Smith error:", data.message);
      setStreamingMessageId(null);
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, toolStates]);

  const loadSession = async () => {
    const raw = await window.api.getSession();
    if (raw) {
      setSession(raw as AgentSession);
      setMessages((raw as AgentSession).messages);
    }
  };

  const loadConfig = async () => {
    const cfg = await window.api.getConfig();
    if (cfg.apiKey) {
      setConfig({
        apiKey: cfg.apiKey,
        modelName: cfg.modelName || "gpt-4o",
        providerId: cfg.providerId || "openai",
      });
    } else {
      setShowConfig(true);
    }
  };

  const loadProviders = async () => {
    setProviders(await window.api.getProviders());
  };

  const handleProviderChange = (providerId: string) => {
    const provider = providers.find((p) => p.id === providerId);
    setConfig({
      ...config,
      providerId,
      modelName: provider ? provider.defaultModel : config.modelName,
    });
  };

  const handleSaveConfig = async () => {
    await window.api.saveConfig(config);
    setShowConfig(false);
    await loadSession();
  };

  const handleSend = async () => {
    const content = input.trim();
    if (!content || isLoading) return;

    setInput("");
    setToolStates({});
    setPendingApproval(null);
    setIsLoading(true);

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content,
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, userMessage]);

    const assistantMessage: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      timestamp: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, assistantMessage]);
    setStreamingMessageId(assistantMessage.id);

    await window.api.sendMessage(content);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void handleSend();
    }
  };

  const statusClass = session?.status ?? "idle";
  const statusText =
    session?.status === "thinking"
      ? "Thinking..."
      : session?.status === "streaming"
        ? "Streaming..."
        : session?.status === "error"
          ? "Error"
          : "Idle";
  const agentLabel = session?.modelName || `${config.providerId} / ${config.modelName}`;

  if (showConfig) {
    return (
      <div className="config-modal">
        <div className="config-modal-content">
          <h2>Welcome to CLPC Smith</h2>
          <p className="config-hint">
            Your agentic workspace for Craftland. Add a provider API key to get started.
          </p>
          <label>Provider</label>
          <select
            value={config.providerId}
            onChange={(e) => handleProviderChange(e.target.value)}
          >
            {providers.map((provider) => (
              <option key={provider.id} value={provider.id}>
                {provider.displayName}
              </option>
            ))}
          </select>
          <label>API Key</label>
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => setConfig({ ...config, apiKey: e.target.value })}
            placeholder={config.providerId === "deepseek" ? "sk-..." : "sk-..."}
          />
          <label>Model</label>
          <input
            type="text"
            value={config.modelName}
            onChange={(e) => setConfig({ ...config, modelName: e.target.value })}
            placeholder={config.modelName}
          />
          <div className="config-actions">
            <button className="save-btn" onClick={() => void handleSaveConfig()}>
              Save &amp; Continue
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-title">CLPC Smith</div>
        <div className="sidebar-tagline">Your agentic workspace for Craftland.</div>

        <div className="sidebar-section">
          <div className="sidebar-label">Agent</div>
          <div className="model-display">
            <span className="model-name">{agentLabel}</span>
          </div>
          <div className="status-indicator">
            <span className={`status-dot ${statusClass}`} />
            {statusText}
          </div>
        </div>

        {pendingApproval && (
          <div className="approval-card">
            <div className="approval-title">Approval requested</div>
            <div className="approval-tool">{pendingApproval.toolName}</div>
            <div className="approval-reason">{pendingApproval.reason}</div>
            <div className="approval-actions">
              <span className="approval-pending">
                Auto-approval is enabled for this session.
              </span>
            </div>
          </div>
        )}

        <div className="sidebar-footer">
          <button className="configure-btn" onClick={() => setShowConfig(true)}>
            Configure
          </button>
        </div>
      </aside>

      <main className="chat-container">
        <div className="chat-header">
          <h2>Workspace</h2>
          <span className="chat-meta">{messages.length} messages</span>
        </div>

        <div className="messages">
          {messages.length === 0 ? (
            <div className="empty-state">
              <h1>CLPC Smith</h1>
              <p>Start a conversation with your agent.</p>
            </div>
          ) : (
            messages.map((msg) => {
              const bubbles: ToolCallRequest[] = msg.toolCalls ?? [];
              return (
                <div
                  key={msg.id}
                  className={`message ${
                    msg.role === "user"
                      ? "message-user"
                      : msg.role === "tool"
                        ? "message-tool"
                        : "message-assistant"
                  }`}
                >
                  {msg.content || null}
                  {msg.role === "assistant" && msg.id === streamingMessageId && (
                    <span className="cursor" />
                  )}
                  {bubbles.length > 0 && (
                    <div className="tool-calls">
                      {bubbles.map((call) => {
                        const state = toolStates[call.id];
                        return (
                          <div
                            key={call.id}
                            className={`tool-call tool-call-${state?.status ?? "running"}`}
                          >
                            <span className="tool-call-name">{call.name}</span>
                            {state?.detail ? (
                              <span className="tool-call-detail">{state.detail}</span>
                            ) : null}
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="message-timestamp">
                    {new Date(msg.timestamp).toLocaleTimeString()}
                  </div>
                </div>
              );
            })
          )}
          <div ref={messagesEndRef} />
        </div>

        <div className="input-area">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your agent..."
            disabled={isLoading}
          />
          <button onClick={() => void handleSend()} disabled={isLoading || !input.trim()}>
            {isLoading ? "..." : "Send"}
          </button>
        </div>
      </main>
    </div>
  );
}

export default App;