import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AgentSession,
  CraftlandInfo,
  Message,
  ProviderPresetView,
  SessionSummary,
  TaskStatus,
} from "@clpc/types";
import Sidebar, { EMPTY_CRAFTLAND } from "./components/Sidebar";
import Header, { STATUS_STAGE } from "./components/Header";
import ChatMessage from "./components/ChatMessage";
import type { ToolRun } from "./components/ToolActivity";
import { prettyToolName } from "./components/ToolActivity";
import Composer from "./components/Composer";
import ConfigDrawer from "./components/ConfigDrawer";
import EmptyState from "./components/EmptyState";

const BUSY_STATUSES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  "thinking",
  "streaming",
  "executing_tool",
  "waiting_for_tool",
  "continuing",
]);

function stringifyOutput(output: unknown): string {
  if (output == null) return "";
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function App(): JSX.Element {
  const [messages, setMessages] = useState<Message[]>([]);
  const [session, setSession] = useState<AgentSession | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<TaskStatus>("idle");
  const [stage, setStage] = useState<string>("Idle");
  const [showConfig, setShowConfig] = useState(false);
  const [hasAnyProvider, setHasAnyProvider] = useState(true);
  const [presets, setPresets] = useState<ProviderPresetView[]>([]);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [streamingMessageId, setStreamingMessageId] = useState<string | null>(null);
  const [toolStates, setToolStates] = useState<Record<string, ToolRun>>({});
  const [craftland, setCraftland] = useState<CraftlandInfo>(EMPTY_CRAFTLAND);
  const [errorNotice, setErrorNotice] = useState<{
    message: string;
    kind: string;
    code: string;
  } | null>(null);
  const [platform, setPlatform] = useState("win32");

  const messagesRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const isBusy = BUSY_STATUSES.has(status);

  const refreshSessions = useCallback(async () => {
    const list = await window.api.listSessions();
    setSessions(list);
  }, []);

  const applySession = useCallback((next: AgentSession | null) => {
    if (!next) return;
    setSession(next);
    setMessages(next.messages);
    setStatus(next.status as TaskStatus);
    setStage(STATUS_STAGE[next.status as TaskStatus] ?? "Idle");
    setStreamingMessageId(null);
    setToolStates({});
    setErrorNotice(null);
  }, []);

  useEffect(() => {
    let mounted = true;

    const loadInitial = async () => {
      if (mounted) setPlatform(window.api.platform || "win32");
      const [config, active] = await Promise.all([
        window.api.getConfig(),
        window.api.getSession(),
      ]);
      if (!mounted) return;
      setPresets(config.providers);
      setActivePresetId(config.activeProviderId);
      setHasAnyProvider(config.providers.length > 0);
      applySession(active);
      void refreshSessions();
    };
    void loadInitial();
    void window.api.getCraftlandStatus().then((info) => {
      if (mounted) setCraftland(info);
    });

    const unsubscribers = [
      window.api.onToken((data) => {
        setMessages((prev) => {
          const index = prev.findIndex((message) => message.id === data.messageId);
          if (index === -1) {
            return [
              ...prev,
              {
                id: data.messageId,
                role: "assistant" as const,
                content: data.content,
                timestamp: new Date().toISOString(),
              },
            ];
          }
          return prev.map((message) =>
            message.id === data.messageId
              ? { ...message, content: message.content + data.content }
              : message
          );
        });
        setStreamingMessageId(data.messageId);
      }),

      window.api.onMessageReceived((data) => {
        setMessages((prev) =>
          prev.some((message) => message.id === data.id)
            ? prev
            : [...prev, data as Message]
        );
        if (data.role === "assistant") {
          setStreamingMessageId(data.id);
        }
      }),

      window.api.onResponseComplete((message) => {
        setMessages((prev) =>
          prev.some((item) => item.id === message.id)
            ? prev.map((item) => (item.id === message.id ? (message as Message) : item))
            : [...prev, message as Message]
        );
        setStreamingMessageId((prev) => (prev === message.id ? null : prev));
        setToolStates((prev) => {
          const next: Record<string, ToolRun> = {};
          for (const run of Object.values(prev)) {
            if (run.status === "running") {
              next[run.callId] = { ...run, status: "finished" };
            } else {
              next[run.callId] = run;
            }
          }
          return next;
        });
      }),

      window.api.onSessionStatus((data) => {
        const nextStatus = data.status as TaskStatus;
        setStatus(nextStatus);
        setStage(data.stage ?? STATUS_STAGE[nextStatus] ?? "Idle");
      }),

      window.api.onSessionsUpdated((summaries) => setSessions(summaries)),

      window.api.onToolStarted((data) => {
        setToolStates((prev) => ({
          ...prev,
          [data.callId]: {
            callId: data.callId,
            toolName: data.toolName,
            status: "running",
          },
        }));
      }),

      window.api.onToolProgress((data) => {
        setToolStates((prev) => {
          const existing = prev[data.callId];
          return existing
            ? { ...prev, [data.callId]: { ...existing, detail: data.message } }
            : prev;
        });
      }),

      window.api.onToolCompleted((data) => {
        setToolStates((prev) => {
          const existing = prev[data.callId];
          if (!existing) return prev;
          const rendered = stringifyOutput(
            data.result && typeof data.result === "object"
              ? (data.result as { output?: unknown }).output
              : data.result
          );
          const durationMs =
            data.result && typeof data.result === "object"
              ? (data.result as { durationMs?: number }).durationMs
              : undefined;
          return {
            ...prev,
            [data.callId]: {
              ...existing,
              status: "finished",
              output: rendered,
              durationMs,
            },
          };
        });
      }),

      window.api.onToolFailed((data) => {
        setToolStates((prev) => {
          const existing = prev[data.callId];
          return existing
            ? {
                ...prev,
                [data.callId]: {
                  ...existing,
                  status: "failed",
                  error: data.error,
                  code: data.code,
                },
              }
            : prev;
        });
      }),

      window.api.onAgentError((event) => {
        if (event.detail && typeof event.detail === "object") {
          const callId = (event.detail as { toolCallId?: string }).toolCallId;
          if (callId) {
            setToolStates((prev) => {
              const existing = prev[callId];
              return existing
                ? {
                    ...prev,
                    [callId]: {
                      ...existing,
                      status: "failed",
                      error: event.message,
                      code: event.code,
                    },
                  }
                : prev;
            });
          }
        }
        setStatus((prev) => (BUSY_STATUSES.has(prev) ? "failed" : prev));
        if (event.kind !== "tool") {
          setErrorNotice({
            message: event.message,
            kind: event.kind,
            code: event.code,
          });
        }
      }),

      window.api.onCraftlandStatus((info) => setCraftland(info)),

      window.api.onError((data) => {
        setStreamingMessageId(null);
        setStatus((prev) => (BUSY_STATUSES.has(prev) ? "failed" : prev));
        setErrorNotice({ message: data.message, kind: "agent", code: "unknown" });
      }),
    ];

    return () => {
      mounted = false;
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [applySession, refreshSessions]);

  useEffect(() => {
    const container = messagesRef.current;
    if (!container) return;
    const distance =
      container.scrollHeight - container.scrollTop - container.clientHeight;
    if (distance < 140) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messages, toolStates, streamingMessageId]);

  const loadConfig = useCallback(async () => {
    const config = await window.api.getConfig();
    setPresets(config.providers);
    setActivePresetId(config.activeProviderId);
    setHasAnyProvider(config.providers.length > 0);
    return config;
  }, []);

  const handleSend = useCallback(
    async (contentOverride?: string) => {
      const content = (contentOverride ?? input).trim();
      if (!content || isBusy) return;

      setInput("");
      setToolStates({});
      setErrorNotice(null);
      setStreamingMessageId(null);

      const userMessage: Message = {
        id: crypto.randomUUID(),
        role: "user",
        content,
        timestamp: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMessage]);

      await window.api.sendMessage(content, userMessage.id);
    },
    [input, isBusy]
  );

  const handleNewTask = useCallback(async () => {
    const next = await window.api.createSession();
    applySession(next);
    void refreshSessions();
  }, [applySession, refreshSessions]);

  const handleOpenSession = useCallback(
    async (id: string) => {
      const next = await window.api.openSession(id);
      applySession(next);
      void refreshSessions();
    },
    [applySession, refreshSessions]
  );

  const handleDeleteSession = useCallback(
    async (id: string) => {
      if (!window.confirm("Delete this conversation?")) return;
      const next = await window.api.deleteSession(id);
      applySession(next);
      void refreshSessions();
    },
    [applySession, refreshSessions]
  );

  const handleRenameSession = useCallback(
    async (id: string, title: string) => {
      await window.api.renameSession(id, title);
      void refreshSessions();
    },
    [refreshSessions]
  );

  const onModelChange = useCallback(
    async (presetId: string) => {
      const preset = presets.find((item) => item.id === presetId);
      if (!preset) return;
      await window.api.saveConfig({ activeProviderId: presetId, preset });
      await loadConfig();
      const active = await window.api.getSession();
      applySession(active);
    },
    [presets, loadConfig, applySession]
  );

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (showConfig) {
        if (event.key === "Escape") setShowConfig(false);
        return;
      }
      if ((event.key === "b" && event.ctrlKey) || (event.key === "b" && event.metaKey)) {
        event.preventDefault();
        setShowConfig(true);
      } else if (event.key === "/" && !isBusy) {
        const target = event.target as HTMLElement;
        if (target.tagName !== "INPUT" && target.tagName !== "TEXTAREA") {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [showConfig, isBusy]);

  const activePreset = presets.find((preset) => preset.id === activePresetId) ?? presets[0] ?? null;
  const modelLabel = session?.modelName ?? activePreset?.displayName ?? "No provider";

  const runningTools = Object.values(toolStates).filter((run) => run.status === "running");

  const toolOutputsFromMessages = useMemo(() => {
    const map: Record<string, string> = {};
    for (const msg of messages) {
      if (msg.role === "tool" && msg.toolCallId) {
        map[msg.toolCallId] = msg.content;
      }
    }
    return map;
  }, [messages]);

  if (!hasAnyProvider) {
    return (
      <div className="app onboarding-mode">
        <main className="onboarding">
          <EmptyState
            craftlandConnected={craftland.state === "connected"}
            onPrompt={() => setShowConfig(true)}
          />
          <p className="onboarding-hint">
            You haven't configured a model provider yet.
          </p>
        </main>
        <ConfigDrawer
          open={showConfig}
          onClose={() => setShowConfig(false)}
          onSaved={() => {
            void loadConfig();
            void window.api.getSession().then(applySession);
          }}
        />
      </div>
    );
  }

  return (
    <div className={`app ${platform === "win32" ? "win" : ""}`}>
      <Sidebar
        sessions={sessions}
        activeId={session?.id ?? null}
        status={status}
        craftland={craftland}
        onNewTask={() => void handleNewTask()}
        onOpenSession={(id) => void handleOpenSession(id)}
        onDeleteSession={(id) => void handleDeleteSession(id)}
        onRenameSession={(id, title) => void handleRenameSession(id, title)}
        onConfigure={() => setShowConfig(true)}
      />

      <main className="chat-container">
        <Header
          modelLabel={modelLabel}
          presets={presets}
          activePresetId={activePresetId}
          craftland={craftland}
          status={status}
          onModelChange={(id) => void onModelChange(id)}
          onConfigure={() => setShowConfig(true)}
        />

        {errorNotice ? (
          <div className="error-banner" role="alert">
            <div className="error-banner-line">
              <span className="material-symbols-outlined text-sm error-banner-icon">error</span>
              <span className="error-banner-title">{kindLabel(errorNotice.code, errorNotice.kind)}</span>
              <button className="error-banner-close" onClick={() => setErrorNotice(null)}>
                <span className="material-symbols-outlined text-sm">close</span>
              </button>
            </div>
            <div className="error-banner-message">{errorNotice.message}</div>
          </div>
        ) : null}

        <div ref={messagesRef} className="messages">
          {messages.length === 0 ? (
            <EmptyState
              craftlandConnected={craftland.state === "connected"}
              onPrompt={(prompt) => void handleSend(prompt)}
            />
          ) : (
            messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message}
                streaming={message.id === streamingMessageId}
                stage={stage}
                toolStates={toolStates}
                toolOutputsFromMessages={toolOutputsFromMessages}
              />
            ))
          )}
        </div>

        <div className="composer-area">
          <Composer
            value={input}
            onChange={setInput}
            onSubmit={() => void handleSend()}
            disabled={isBusy}
            busy={isBusy}
            stage={stage}
            inputRef={inputRef}
            modelLabel={modelLabel}
            presets={presets}
            activePresetId={activePresetId}
            onModelChange={(id) => void onModelChange(id)}
          />
        </div>
      </main>

      <ConfigDrawer
        open={showConfig}
        onClose={() => setShowConfig(false)}
        onSaved={() => {
          void loadConfig();
          void window.api.getSession().then(applySession);
        }}
      />
    </div>
  );
}

function kindLabel(code: string, kind: string): string {
  switch (code) {
    case "timeout":
      return "Request timed out";
    case "tool_validation":
      return "Tool failed validation";
    case "tool_execution":
      return "Tool failed";
    case "mcp_connection":
      return "Craftland connection error";
    case "permission":
      return "Permission denied";
    case "model":
      return "Model error";
    default:
      return kind === "tool" ? "Tool failed" : "Something went wrong";
  }
}

export default App;