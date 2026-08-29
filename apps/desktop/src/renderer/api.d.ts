import type {
  AgentErrorEvent,
  SessionSummary,
} from "@clpc/core";
import type {
  AgentSession,
  CraftlandInfo,
  Message,
  ModelConnectionTestResult,
  ModelProviderPresetInfo,
  ProviderPresetDraft,
  ProviderPresetView,
} from "@clpc/types";

declare global {
  interface Window {
    api: {
      platform: string;
      sendMessage(content: string, clientMessageId?: string): Promise<void>;
      getSession(): Promise<AgentSession | null>;
      listSessions(): Promise<SessionSummary[]>;
      createSession(): Promise<AgentSession | null>;
      openSession(id: string): Promise<AgentSession | null>;
      deleteSession(id: string): Promise<AgentSession | null>;
      renameSession(id: string, title: string): Promise<void>;
      windowMinimize(): Promise<void>;
      windowMaximize(): Promise<void>;
      windowClose(): Promise<void>;
      getConfig(): Promise<{
        activeProviderId: string | null;
        providers: ProviderPresetView[];
      }>;
      saveConfig(input: {
        activeProviderId: string;
        preset: ProviderPresetDraft;
      }): Promise<{ ok: boolean; id: string }>;
      getProviders(): Promise<ModelProviderPresetInfo[]>;
      testConnection(draft: ProviderPresetDraft): Promise<ModelConnectionTestResult>;
      getCraftlandStatus(): Promise<CraftlandInfo>;
      craftlandRetry(): Promise<CraftlandInfo>;
      onToken(callback: (data: { messageId: string; content: string }) => void): () => void;
      onMessageReceived(callback: (data: Message) => void): () => void;
      onResponseComplete(callback: (data: Message) => void): () => void;
      onSessionStatus(callback: (data: { status: string; stage?: string }) => void): () => void;
      onSessionsUpdated(callback: (summaries: SessionSummary[]) => void): () => void;
      onToolStarted(callback: (data: { callId: string; toolName: string }) => void): () => void;
      onToolProgress(callback: (data: { callId: string; message: string }) => void): () => void;
      onToolCompleted(callback: (data: {
        callId: string;
        result: unknown;
      }) => void): () => void;
      onToolFailed(callback: (data: {
        callId: string;
        error: string;
        code?: string;
      }) => void): () => void;
      onApprovalRequested(callback: (data: {
        approvalId: string;
        toolName: string;
        reason: string;
      }) => void): () => void;
      onCraftlandStatus(callback: (info: CraftlandInfo) => void): () => void;
      onAgentError(callback: (event: AgentErrorEvent) => void): () => void;
      onError(callback: (data: { message: string }) => void): () => void;
    };
  }
}

export {};