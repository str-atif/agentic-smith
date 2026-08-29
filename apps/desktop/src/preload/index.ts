import { contextBridge, ipcRenderer } from "electron";
import type { IpcRendererEvent } from "electron";

const subscribe = <T>(channel: string) => (callback: (data: T) => void): (() => void) => {
  const listener = (_event: IpcRendererEvent, data: T): void => callback(data);
  ipcRenderer.on(channel, listener);
  return () => {
    ipcRenderer.removeListener(channel, listener);
  };
};

const api = {
  platform: process.platform,

  sendMessage: (content: string, clientMessageId?: string): Promise<void> =>
    ipcRenderer.invoke("clpc:send-message", content, clientMessageId),

  getSession: (): Promise<unknown> => ipcRenderer.invoke("clpc:get-session"),

  listSessions: (): Promise<Array<{
    id: string;
    title: string;
    modelId: string;
    modelName: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
  }>> => ipcRenderer.invoke("clpc:list-sessions"),

  createSession: (): Promise<unknown> => ipcRenderer.invoke("clpc:create-session"),

  openSession: (id: string): Promise<unknown> =>
    ipcRenderer.invoke("clpc:open-session", id),

  deleteSession: (id: string): Promise<unknown> =>
    ipcRenderer.invoke("clpc:delete-session", id),

  renameSession: (id: string, title: string): Promise<void> =>
    ipcRenderer.invoke("clpc:rename-session", id, title),

  windowMinimize: (): Promise<void> => ipcRenderer.invoke("clpc:window-minimize"),
  windowMaximize: (): Promise<void> => ipcRenderer.invoke("clpc:window-maximize"),
  windowClose: (): Promise<void> => ipcRenderer.invoke("clpc:window-close"),

  getConfig: (): Promise<{
    activeProviderId: string | null;
    providers: Array<{
      id: string;
      displayName: string;
      providerId: string;
      modelName: string;
      baseUrl?: string;
      orgId?: string;
      projectId?: string;
      headers?: Record<string, string>;
      timeoutMs?: number;
      streaming?: boolean;
      hasApiKey: boolean;
    }>;
  }> => ipcRenderer.invoke("clpc:get-config"),

  saveConfig: (input: {
    activeProviderId: string;
    preset: {
      id?: string;
      displayName: string;
      providerId: string;
      modelName: string;
      baseUrl?: string;
      apiKey?: string;
      orgId?: string;
      projectId?: string;
      headers?: Record<string, string>;
      timeoutMs?: number;
      streaming?: boolean;
    };
  }): Promise<{ ok: boolean; id: string }> =>
    ipcRenderer.invoke("clpc:save-config", input),

  getProviders: (): Promise<
    Array<{
      id: string;
      displayName: string;
      defaultModel: string;
      baseUrl?: string;
      apiKeyOptional?: boolean;
    }>
  > => ipcRenderer.invoke("clpc:get-providers"),

  testConnection: (draft: {
    id?: string;
    displayName: string;
    providerId: string;
    modelName: string;
    baseUrl?: string;
    apiKey?: string;
    orgId?: string;
    projectId?: string;
    headers?: Record<string, string>;
    timeoutMs?: number;
    streaming?: boolean;
  }): Promise<{
    ok: boolean;
    endpoint?: string;
    model?: string;
    latencyMs?: number;
    streaming?: boolean;
    message: string;
  }> => ipcRenderer.invoke("clpc:test-connection", draft),

  getCraftlandStatus: (): Promise<{
    state: string;
    pid?: number;
    port?: number;
    endpoint?: string;
    toolCount?: number;
    project?: string;
    scene?: string;
    serverName?: string;
    error?: string;
    lastUpdated?: string;
  }> => ipcRenderer.invoke("clpc:get-craftland-status"),

  craftlandRetry: (): Promise<{
    state: string;
    pid?: number;
    port?: number;
    endpoint?: string;
    toolCount?: number;
    project?: string;
    scene?: string;
    serverName?: string;
    error?: string;
    lastUpdated?: string;
  }> => ipcRenderer.invoke("clpc:craftland-retry"),

  onToken: subscribe<{ messageId: string; content: string }>("clpc:token"),
  onMessageReceived: subscribe<{
    id: string;
    role: string;
    content: string;
    timestamp: string;
    toolCallId?: string;
  }>("clpc:message_received"),
  onResponseComplete: subscribe<unknown>("clpc:response_complete"),
  onSessionStatus: subscribe<{ status: string; stage?: string }>("clpc:session_status"),
  onSessionsUpdated: subscribe<Array<{
    id: string;
    title: string;
    modelId: string;
    modelName: string;
    status: string;
    createdAt: string;
    updatedAt: string;
    messageCount: number;
  }>>("clpc:sessions_updated"),
  onToolStarted: subscribe<{ callId: string; toolName: string }>("clpc:tool_started"),
  onToolProgress: subscribe<{ callId: string; message: string }>("clpc:tool_progress"),
  onToolCompleted: subscribe<{ callId: string; result: unknown }>("clpc:tool_completed"),
  onToolFailed: subscribe<{ callId: string; error: string; code?: string }>("clpc:tool_failed"),
  onApprovalRequested: subscribe<{
    approvalId: string;
    toolName: string;
    reason: string;
  }>("clpc:approval_requested"),
  onCraftlandStatus: subscribe<{
    state: string;
    pid?: number;
    port?: number;
    endpoint?: string;
    toolCount?: number;
    project?: string;
    scene?: string;
    serverName?: string;
    error?: string;
    lastUpdated?: string;
  }>("clpc:craftland_status"),
  onAgentError: subscribe<{
    sessionId: string;
    code: string;
    kind: string;
    message: string;
    detail?: unknown;
  }>("clpc:agent_error"),
  onError: subscribe<{ message: string }>("clpc:error"),
};

contextBridge.exposeInMainWorld("api", api);

export type Api = typeof api;