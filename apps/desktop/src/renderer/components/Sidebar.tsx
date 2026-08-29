import { useCallback, useEffect, useRef, useState } from "react";
import type { CraftlandInfo, SessionSummary, TaskStatus } from "@clpc/types";
import CraftlandPanel from "./CraftlandPanel";

const EMPTY_CRAFTLAND: CraftlandInfo = {
  state: "unavailable",
  lastUpdated: new Date().toISOString(),
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms) || ms < 0) return "";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function SessionItem({
  summary,
  active,
  busy,
  onOpen,
  onDelete,
  onRename,
}: {
  summary: SessionSummary;
  active: boolean;
  busy: boolean;
  onOpen: () => void;
  onDelete: () => void;
  onRename: (title: string) => void;
}): JSX.Element {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(summary.title);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = useCallback(() => {
    setEditing(false);
    const trimmed = text.trim();
    if (trimmed && trimmed !== summary.title) {
      onRename(trimmed);
    } else if (!trimmed) {
      setText(summary.title);
    }
  }, [text, summary.title, onRename]);

  return (
    <div className={`session-item ${active ? "active" : ""}`}>
      {editing ? (
        <input
          ref={inputRef}
          className="session-rename-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => {
            if (event.key === "Enter") commit();
            if (event.key === "Escape") {
              setEditing(false);
              setText(summary.title);
            }
          }}
        />
      ) : (
        <button
          className="session-open"
          onClick={onOpen}
          onDoubleClick={() => setEditing(true)}
          title="Open conversation (double-click to rename)"
        >
          <span className="session-title">{summary.title}</span>
          <span className="session-meta">
            {summary.modelName} · {summary.messageCount} msg · {relativeTime(summary.updatedAt)}
          </span>
        </button>
      )}

      <span className="session-actions">
        {!editing ? (
          <button
            className="session-action"
            title="Rename"
            disabled={busy}
            onClick={() => setEditing(true)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>edit</span>
          </button>
        ) : null}
        <button
          className="session-action danger"
          title="Delete"
          disabled={busy}
          onClick={onDelete}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "14px" }}>delete</span>
        </button>
      </span>
    </div>
  );
}

function Sidebar({
  sessions,
  activeId,
  status,
  craftland,
  onNewTask,
  onOpenSession,
  onDeleteSession,
  onRenameSession,
  onConfigure,
}: {
  sessions: SessionSummary[];
  activeId: string | null;
  status: TaskStatus;
  craftland: CraftlandInfo;
  onNewTask: () => void;
  onOpenSession: (id: string) => void;
  onDeleteSession: (id: string) => void;
  onRenameSession: (id: string, title: string) => void;
  onConfigure: () => void;
}): JSX.Element {
  const busy =
    status === "thinking" ||
    status === "streaming" ||
    status === "executing_tool" ||
    status === "waiting_for_tool" ||
    status === "continuing";

  return (
    <aside className="sidebar">
      <button
        className="new-conversation-btn"
        disabled={busy}
        onClick={onNewTask}
        title={busy ? "Wait for current task" : "Start a new conversation"}
      >
        <span className="material-symbols-outlined text-base">add</span>
        New Conversation
      </button>

      <div className="sidebar-section session-section">
        <div className="section-label-row">
          <span className="section-label">Conversations</span>
          <button className="icon-action-btn" onClick={onNewTask} title="New conversation">
            <span className="material-symbols-outlined text-xs">add</span>
          </button>
        </div>

        <div className="session-list">
          {sessions.length === 0 ? (
            <div className="session-empty">No conversations yet.</div>
          ) : (
            sessions.map((summary) => (
              <SessionItem
                key={summary.id}
                summary={summary}
                active={summary.id === activeId}
                busy={busy}
                onOpen={() => onOpenSession(summary.id)}
                onDelete={() => onDeleteSession(summary.id)}
                onRename={(title) => onRenameSession(summary.id, title)}
              />
            ))
          )}
        </div>
      </div>

      <CraftlandPanel initial={craftland} />

      <div className="sidebar-footer">
        <button className="configure-btn" onClick={onConfigure}>
          <span className="material-symbols-outlined text-sm">settings</span>
          Settings
        </button>
      </div>
    </aside>
  );
}

export default Sidebar;
export { EMPTY_CRAFTLAND };