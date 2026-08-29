import { contextBridge, ipcRenderer } from "electron";

const api = {
  sendMessage: (content: string): Promise<void> =>
    ipcRenderer.invoke("clpc:send-message", content),

  getSession: (): Promise<unknown> => ipcRenderer.invoke("clpc:get-session"),

  getConfig: (): Promise<{ apiKey?: string; modelName?: string; providerId?: string }> =>
    ipcRenderer.invoke("clpc:get-config"),

  getProviders: (): Promise<Array<{ id: string; displayName: string; defaultModel: string }>> =>
    ipcRenderer.invoke("clpc:get-providers"),

  saveConfig: (config: {
    apiKey: string;
    modelName: string;
    providerId: string;
  }): Promise<{ ok: boolean }> => ipcRenderer.invoke("clpc:save-config", config),

  onToken: (callback: (data: { messageId: string; content: string }) => void): void => {
    ipcRenderer.on("clpc:token", (_event, data) => callback(data));
  },

  onMessageReceived: (callback: (data: { id: string; role: string; content: string }) => void): void => {
    ipcRenderer.on("clpc:message_received", (_event, data) => callback(data));
  },

  onResponseComplete: (callback: (data: unknown) => void): void => {
    ipcRenderer.on("clpc:response_complete", (_event, data) => callback(data));
  },

  onSessionStatus: (callback: (data: { status: string }) => void): void => {
    ipcRenderer.on("clpc:session_status", (_event, data) => callback(data));
  },

  onToolStarted: (callback: (data: { callId: string; toolName: string }) => void): void => {
    ipcRenderer.on("clpc:tool_started", (_event, data) => callback(data));
  },

  onToolProgress: (callback: (data: { callId: string; message: string }) => void): void => {
    ipcRenderer.on("clpc:tool_progress", (_event, data) => callback(data));
  },

  onToolCompleted: (callback: (data: { callId: string; result: unknown }) => void): void => {
    ipcRenderer.on("clpc:tool_completed", (_event, data) => callback(data));
  },

  onToolFailed: (callback: (data: { callId: string; error: string }) => void): void => {
    ipcRenderer.on("clpc:tool_failed", (_event, data) => callback(data));
  },

  onApprovalRequested: (callback: (data: { approvalId: string; toolName: string; reason: string }) => void): void => {
    ipcRenderer.on("clpc:approval_requested", (_event, data) => callback(data));
  },

  onError: (callback: (data: { message: string }) => void): void => {
    ipcRenderer.on("clpc:error", (_event, data) => callback(data));
  },
};

contextBridge.exposeInMainWorld("api", api);