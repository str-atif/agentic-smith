import { app, BrowserWindow, ipcMain } from "electron";
import path from "path";
import fs from "fs";
import {
  AgentOrchestrator,
  AutoApproveGate,
} from "@clpc/core";
import { ToolRegistry, ToolLifecycleEvent } from "@clpc/tools";
import { createProvider } from "@clpc/model-providers";
import { AgentSession, Message } from "@clpc/types";
import type {
  ApprovalRequestEvent,
  SessionStatusEvent,
  TokenEvent,
} from "@clpc/core";

let mainWindow: BrowserWindow | null = null;
let orchestrator: AgentOrchestrator | null = null;

const configDir = () => path.join(app.getPath("userData"), "config.json");

function loadConfig(): { apiKey?: string; modelName?: string; providerId?: string } {
  try {
    return JSON.parse(fs.readFileSync(configDir(), "utf-8"));
  } catch {
    return {};
  }
}

function saveConfig(config: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(configDir()), { recursive: true });
  fs.writeFileSync(configDir(), JSON.stringify(config, null, 2));
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

function createProviderFromConfig(): void {
  const config = loadConfig();
  if (!config.apiKey) {
    throw new Error("No API key configured. Use the settings dialog to add one.");
  }
  const provider = createProvider({
    providerId: config.providerId || "openai",
    apiKey: config.apiKey,
    modelName: config.modelName || "gpt-4o",
  });
  if (orchestrator) {
    orchestrator.setProvider(provider);
  } else {
    orchestrator = new AgentOrchestrator({
      provider,
      toolRegistry: buildToolRegistry(),
      approvalGate: new AutoApproveGate(),
    });
  }
}

function send(event: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(event, payload);
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "CLPC Smith",
    show: false,
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
  bus.on("tool_started", (data: ToolLifecycleEvent) => send("clpc:tool_started", data));
  bus.on("tool_progress", (data: ToolLifecycleEvent) => send("clpc:tool_progress", data));
  bus.on("tool_completed", (data: ToolLifecycleEvent) => send("clpc:tool_completed", data));
  bus.on("tool_failed", (data: ToolLifecycleEvent) => send("clpc:tool_failed", data));
  bus.on("approval_requested", (data: ApprovalRequestEvent) =>
    send("clpc:approval_requested", data)
  );
  bus.on("error", (data: { sessionId: string; message: string }) =>
    send("clpc:error", data)
  );
}

app.whenReady().then(() => {
  try {
    createProviderFromConfig();
  } catch {
    orchestrator = new AgentOrchestrator({
      provider: createProvider({ providerId: "openai", apiKey: "", modelName: "gpt-4o" }),
      toolRegistry: buildToolRegistry(),
      approvalGate: new AutoApproveGate(),
    });
  }

  wireOrchestratorEvents();
  createWindow();

  ipcMain.handle("clpc:send-message", async (_event, content: string) => {
    if (!orchestrator) return;
    await orchestrator.sendMessage(content);
  });

  ipcMain.handle("clpc:get-session", (): AgentSession | null =>
    orchestrator?.getSession() ?? null
  );

  ipcMain.handle("clpc:get-config", () => loadConfig());

  ipcMain.handle("clpc:get-providers", () =>
    import("@clpc/model-providers").then((mod) => mod.knownProviders)
  );

  ipcMain.handle(
    "clpc:save-config",
    (_event, config: { apiKey: string; modelName: string; providerId: string }) => {
      saveConfig({ ...loadConfig(), ...config });
      createProviderFromConfig();
      return { ok: true };
    }
  );

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});