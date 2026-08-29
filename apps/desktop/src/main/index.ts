import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import fs from "fs";
import {
  AgentOrchestrator,
  AutoApproveGate,
  FileSessionStore,
  SessionStore,
} from "@clpc/core";
import { ToolRegistry, ToolLifecycleEvent } from "@clpc/tools";
import {
  createProviderFromPreset,
  testProviderConnection,
} from "@clpc/model-providers";
import { CraftlandIntegration } from "@clpc/platform-craftland";
import {
  AgentSession,
  CraftlandInfo,
  Message,
  ModelConnectionTestResult,
  ProviderPreset,
  ProviderPresetDraft,
  ProviderPresetView,
  SessionSummary,
} from "@clpc/types";
import type {
  AgentErrorEvent,
  ApprovalRequestEvent,
  SessionStatusEvent,
  TokenEvent,
} from "@clpc/core";

let mainWindow: BrowserWindow | null = null;
let orchestrator: AgentOrchestrator | null = null;
let craftland: CraftlandIntegration | null = null;
let toolRegistry: ToolRegistry | null = null;
let sessionStore: SessionStore | null = null;

interface AppConfig {
  activeProviderId?: string;
  providers?: ProviderPreset[];
}

const configDir = () => path.join(app.getPath("userData"), "config.json");

const sessionsDir = () => path.join(app.getPath("userData"), "sessions");

function loadConfig(): AppConfig {
  try {
    return JSON.parse(fs.readFileSync(configDir(), "utf-8")) as AppConfig;
  } catch {
    return {};
  }
}

function saveConfig(config: AppConfig): void {
  fs.mkdirSync(path.dirname(configDir()), { recursive: true });
  fs.writeFileSync(configDir(), JSON.stringify(config, null, 2));
}

function sanitizePreset(preset: ProviderPreset): ProviderPresetView {
  const { apiKey, ...rest } = preset;
  return { ...rest, hasApiKey: Boolean(apiKey) };
}

function resolveActivePreset(config: AppConfig): ProviderPreset | null {
  const providers = config.providers ?? [];
  if (providers.length === 0) return null;
  const active =
    providers.find((provider) => provider.id === config.activeProviderId) ??
    providers[0];
  return active;
}

function buildToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();

  registry.register({
    name: "get_current_time",
    description:
      "Returns the current date and time in ISO-8601 format. Requires no arguments.",
    parameters: { type: "object", properties: {} },
    requiresApproval: false,
    async execute() {
      return {
        ok: true,
        output: new Date().toISOString(),
        durationMs: 0,
      };
    },
  });

  registry.register({
    name: "reverse_text",
    description:
      "Reverses a given string. Use for text manipulation demos.",
    parameters: {
      type: "object",
      properties: {
        text: { type: "string", description: "The text to reverse" },
      },
      required: ["text"],
    },
    requiresApproval: false,
    async execute(call) {
      const text = String((call.arguments ?? {}).text ?? "");
      return { ok: true, output: [...text].reverse().join(""), durationMs: 0 };
    },
  });

  registry.register({
    name: "send_notification",
    description:
      "Sends a notification to the user. Requires approval before running.",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Message body" },
      },
      required: ["message"],
    },
    requiresApproval: true,
    async execute(call) {
      const message = String((call.arguments ?? {}).message ?? "");
      return { ok: true, output: `Notification sent: ${message}`, durationMs: 0 };
    },
  });

  return registry;
}

function applyProvider(preset: ProviderPreset | null): void {
  let provider;
  if (preset) {
    provider = createProviderFromPreset(preset);
  } else {
    provider = createProviderFromPreset({
      id: "default-openai",
      displayName: "openai",
      providerId: "openai",
      modelName: "gpt-4o",
    });
  }
  if (orchestrator) {
    orchestrator.setProvider(provider);
  } else {
    orchestrator = new AgentOrchestrator({
      provider,
      toolRegistry: toolRegistry ?? undefined,
      approvalGate: new AutoApproveGate(),
      store: sessionStore ?? undefined,
    });
  }
}

function createProviderFromConfig(): void {
  const preset = resolveActivePreset(loadConfig());
  applyProvider(preset);
}

function send(event: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(event, payload);
  }
}

function createWindow(): void {
  const isWin32 = process.platform === "win32";
  mainWindow = new BrowserWindow({
    width: 1240,
    height: 820,
    minWidth: 940,
    minHeight: 600,
    title: "CLPC Smith",
    backgroundColor: "#14161a",
    show: false,
    titleBarStyle: isWin32 ? "hidden" : "default",
    titleBarOverlay: isWin32
      ? { color: "#14161a", symbolColor: "#9aa3b2", height: 40 }
      : undefined,
    webPreferences: {
      preload: path.join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  const devUrl = process.env.NODE_ENV === "development"
    ? "http://localhost:5173"
    : null;

  if (devUrl) {
    mainWindow.loadURL(devUrl);
  } else {
    mainWindow.loadFile(path.join(__dirname, "../renderer/index.html"));
  }
}

function sendSessionsList(): void {
  send("clpc:sessions_updated", orchestrator?.listSessions() ?? []);
}

function wireOrchestratorEvents(): void {
  if (!orchestrator) return;
  const bus = orchestrator.getEventBus();

  bus.on("token", (data: TokenEvent) => send("clpc:token", data));
  bus.on("message_received", (data: Message) =>
    send("clpc:message_received", data)
  );
  bus.on("response_complete", (data: Message) =>
    send("clpc:response_complete", data)
  );
  bus.on("session_status", (data: SessionStatusEvent) =>
    send("clpc:session_status", data)
  );
  bus.on("session_updated", () => sendSessionsList());
  bus.on("tool_started", (data: ToolLifecycleEvent) => send("clpc:tool_started", data));
  bus.on("tool_progress", (data: ToolLifecycleEvent) => send("clpc:tool_progress", data));
  bus.on("tool_completed", (data: ToolLifecycleEvent) => send("clpc:tool_completed", data));
  bus.on("tool_failed", (data: ToolLifecycleEvent) => send("clpc:tool_failed", data));
  bus.on("approval_requested", (data: ApprovalRequestEvent) =>
    send("clpc:approval_requested", data)
  );
  bus.on("agent_error", (data: AgentErrorEvent) => send("clpc:agent_error", data));
  bus.on("error", (data: { sessionId: string; message: string }) =>
    send("clpc:error", data)
  );
}

function wireCraftland(): void {
  if (!toolRegistry) return;
  craftland = new CraftlandIntegration({
    registry: toolRegistry,
    pollIntervalMs: 4000,
  });
  craftland.onStatus((info: CraftlandInfo) => send("clpc:craftland_status", info));
  void craftland.start();
}

app.whenReady().then(async () => {
  toolRegistry = buildToolRegistry();
  sessionStore = new FileSessionStore(sessionsDir());

  try {
    createProviderFromConfig();
  } catch {
    applyProvider(null);
  }

  await orchestrator?.loadSessionsFromStore();

  wireOrchestratorEvents();
  wireCraftland();
  createWindow();

  ipcMain.handle(
    "clpc:send-message",
    async (_event, content: string, clientMessageId?: string) => {
      if (!orchestrator) return;
      await orchestrator.sendMessage(content, clientMessageId);
    }
  );

  ipcMain.handle("clpc:get-session", (): AgentSession | null =>
    orchestrator?.getSession() ?? null
  );

  ipcMain.handle("clpc:list-sessions", (): SessionSummary[] =>
    orchestrator?.listSessions() ?? []
  );

  ipcMain.handle("clpc:create-session", async (): Promise<AgentSession | null> => {
    const session = await orchestrator?.createSession();
    sendSessionsList();
    return session ?? null;
  });

  ipcMain.handle("clpc:open-session", async (_event, id: string): Promise<AgentSession | null> => {
    const session = await orchestrator?.openSession(id);
    sendSessionsList();
    return session ?? null;
  });

  ipcMain.handle("clpc:delete-session", async (_event, id: string): Promise<AgentSession | null> => {
    await orchestrator?.deleteSession(id);
    sendSessionsList();
    return orchestrator?.getSession() ?? null;
  });

  ipcMain.handle("clpc:rename-session", async (_event, id: string, title: string) => {
    await orchestrator?.renameSession(id, title);
    sendSessionsList();
  });

  ipcMain.handle("clpc:window-minimize", () => mainWindow?.minimize());
  ipcMain.handle("clpc:window-maximize", () => {
    if (!mainWindow) return;
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });
  ipcMain.handle("clpc:window-close", () => mainWindow?.close());
  ipcMain.handle("clpc:get-platform", (): string => process.platform);

  ipcMain.handle("clpc:get-config", () => {
    const config = loadConfig();
    return {
      activeProviderId: config.activeProviderId ?? null,
      providers: (config.providers ?? []).map(sanitizePreset),
    };
  });

  ipcMain.handle("clpc:get-providers", async () => {
    const mod = await import("@clpc/model-providers");
    return mod.knownProviders;
  });

  ipcMain.handle("clpc:save-config", (_event, input: {
    activeProviderId: string;
    preset: ProviderPresetDraft;
  }) => {
    const config = loadConfig();
    const providers = config.providers ?? [];
    const index = providers.findIndex((provider) => provider.id === input.preset.id);
    const existing = index >= 0 ? providers[index] : undefined;
    const merged: ProviderPreset = {
      id: input.preset.id ?? existing?.id ?? crypto.randomUUID(),
      displayName: input.preset.displayName,
      providerId: input.preset.providerId,
      modelName: input.preset.modelName || existing?.modelName || "gpt-4o",
      baseUrl: input.preset.baseUrl ?? existing?.baseUrl,
      orgId: input.preset.orgId ?? existing?.orgId,
      projectId: input.preset.projectId ?? existing?.projectId,
      headers: input.preset.headers ?? existing?.headers,
      timeoutMs: input.preset.timeoutMs ?? existing?.timeoutMs,
      streaming: input.preset.streaming ?? existing?.streaming,
      apiKey: input.preset.apiKey ?? existing?.apiKey,
    };
    if (index >= 0) {
      providers[index] = merged;
    } else {
      providers.push(merged);
    }
    config.providers = providers;
    config.activeProviderId = input.activeProviderId || merged.id;
    saveConfig(config);
    createProviderFromConfig();
    return { ok: true, id: merged.id };
  });

  ipcMain.handle("clpc:test-connection", async (_event, draft: ProviderPresetDraft) => {
    const config = loadConfig();
    const existing = draft.id
      ? (config.providers ?? []).find((provider) => provider.id === draft.id)
      : undefined;
    const preset: ProviderPreset = {
      id: draft.id ?? existing?.id ?? crypto.randomUUID(),
      displayName: draft.displayName,
      providerId: draft.providerId,
      modelName: draft.modelName || existing?.modelName || "gpt-4o",
      baseUrl: draft.baseUrl ?? existing?.baseUrl,
      orgId: draft.orgId ?? existing?.orgId,
      projectId: draft.projectId ?? existing?.projectId,
      headers: draft.headers ?? existing?.headers,
      timeoutMs: draft.timeoutMs ?? existing?.timeoutMs,
      streaming: draft.streaming ?? existing?.streaming,
      apiKey: draft.apiKey ?? existing?.apiKey,
    };
    try {
      const provider = createProviderFromPreset(preset);
      const result = await testProviderConnection(provider, {
        timeoutMs: preset.timeoutMs ?? 15_000,
        testStreaming: true,
      });
      return result;
    } catch (error) {
      const result: ModelConnectionTestResult = {
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      };
      return result;
    }
  });

  ipcMain.handle("clpc:get-craftland-status", (): CraftlandInfo =>
    craftland?.current ?? {
      state: "unavailable",
      lastUpdated: new Date().toISOString(),
    }
  );

  ipcMain.handle("clpc:craftland-retry", async (): Promise<CraftlandInfo> => {
    await craftland?.retry();
    return craftland?.current ?? {
      state: "unavailable",
      lastUpdated: new Date().toISOString(),
    };
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  void craftland?.stop();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});