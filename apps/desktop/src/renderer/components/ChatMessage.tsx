import { memo } from "react";
import type { Message } from "@clpc/types";
import Markdown from "./Markdown";
import ToolActivity, { AgentWorkAccordion, ToolRun, prettyToolName } from "./ToolActivity";

interface ChatMessageProps {
  message: Message;
  streaming: boolean;
  stage?: string;
  toolStates: Record<string, ToolRun>;
  toolOutputsFromMessages?: Record<string, string>;
}

function formatTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ChatMessageInner({
  message,
  streaming,
  stage,
  toolStates = {},
  toolOutputsFromMessages = {},
}: ChatMessageProps): JSX.Element | null {
  if (!message) return null;

  // Tool output messages are nested inside the assistant's Worked for Xs accordion, not rendered as standalone messages
  if (message.role === "tool") {
    return null;
  }

  const isAssistant = message.role === "assistant";
  const toolCalls = isAssistant ? (message.toolCalls ?? []) : [];
  const safeToolStates = toolStates ?? {};
  const safeOutputs = toolOutputsFromMessages ?? {};

  const runs: ToolRun[] = toolCalls.map((call, idx) => {
    const callId = call?.id ?? `call_${idx}`;
    const toolName = call?.name ?? "tool";
    const live = safeToolStates[callId];
    const historicalOutput = safeOutputs[callId];
    if (live) return live;
    if (historicalOutput !== undefined) {
      return {
        callId,
        toolName,
        status: "finished",
        output: historicalOutput,
      };
    }
    return {
      callId,
      toolName,
      status: "finished",
    };
  });

  const rawOutputs: Record<string, string> = {};
  for (const run of runs) {
    if (!run || !run.callId) continue;
    const raw = run.output ?? run.error ?? safeOutputs[run.callId];
    if (raw) {
      rawOutputs[run.callId] = raw;
    }
  }

  return (
    <div className={`message ${isAssistant ? "message-assistant" : "message-user"}`}>
      {isAssistant ? (
        <div className="message-role">
          <span className="material-symbols-outlined text-xs" style={{ fontSize: "13px", verticalAlign: "-2px", marginRight: "4px", color: "var(--accent)" }}>auto_awesome</span>
          Agent
        </div>
      ) : (
        <div className="message-role">
          <span className="material-symbols-outlined text-xs" style={{ fontSize: "13px", verticalAlign: "-2px", marginRight: "4px" }}>person</span>
          You
        </div>
      )}

      {isAssistant && runs.length > 0 ? (
        <AgentWorkAccordion runs={runs} rawOutputs={rawOutputs} />
      ) : null}

      <div className={`message-bubble ${streaming ? "is-streaming" : ""}`}>
        {message.content || streaming ? (
          <div className="message-content">
            {message.content ? (
              <Markdown source={message.content} />
            ) : streaming ? (
              <span className="thinking-blocks" aria-label={stage ?? "Thinking…"}>
                <span className="thinking-block" />
                <span className="thinking-block" />
                <span className="thinking-block" />
              </span>
            ) : null}
            {streaming && message.content ? <span className="cursor" /> : null}
          </div>
        ) : null}
      </div>

      <div className="message-meta">
        <span className="message-timestamp">{formatTime(message.timestamp)}</span>
      </div>
    </div>
  );
}

function suffix(count: number): string {
  return count === 1 ? "" : "s";
}

const ChatMessage = memo(ChatMessageInner);
export default ChatMessage;
export type { ToolRun };
export { prettyToolName };