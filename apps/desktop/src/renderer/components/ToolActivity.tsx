import { memo, useMemo, useState } from "react";

export interface ToolRun {
  callId: string;
  toolName: string;
  status: "running" | "finished" | "failed" | "queued";
  detail?: string;
  output?: string;
  error?: string;
  code?: string;
  durationMs?: number;
}

const COLLAPSE_LIMIT = 1400;

export function prettyToolName(name: string): string {
  const cleaned = name.replace(/^mcp_[^_]+_/, "").replace(/_/g, " ");
  const words = cleaned.split(" ").filter(Boolean);
  if (words.length === 0) return name;
  const title = words
    .slice(0, 5)
    .map((word) => (word.length > 2 ? word[0].toUpperCase() + word.slice(1) : word))
    .join(" ");
  return words.length > 5 ? `${title} (+${words.length - 5})` : title;
}

const STATUS_LABEL: Record<ToolRun["status"], string> = {
  running: "Running…",
  finished: "Completed",
  failed: "Failed",
  queued: "Queued",
};

function RawOutput({
  raw,
  label,
}: {
  raw: string;
  label: string;
}): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const truncated = raw.length > COLLAPSE_LIMIT;
  const shown = expanded ? raw : raw.slice(0, COLLAPSE_LIMIT);

  const copy = (): void => {
    void navigator.clipboard.writeText(raw);
  };

  return (
    <div className="activity-raw">
      <div className="activity-raw-head">
        <span className="activity-raw-label">{label}</span>
        <span className="activity-raw-actions">
          {truncated ? (
            <button className="raw-btn" onClick={() => setExpanded((v) => !v)}>
              {expanded ? "Show less" : `Show more (${(raw.length / 1024).toFixed(1)} KB)`}
            </button>
          ) : null}
          <button className="raw-btn" onClick={copy}>
            Copy
          </button>
          <button className="raw-btn" onClick={() => setModalOpen(true)}>
            Open raw output
          </button>
        </span>
      </div>
      <pre className="activity-raw-pre">
        {shown}
        {truncated && !expanded ? "…" : ""}
      </pre>

      {modalOpen ? (
        <div className="raw-modal-backdrop" onClick={() => setModalOpen(false)}>
          <div className="raw-modal" role="dialog" onClick={(event) => event.stopPropagation()}>
            <div className="raw-modal-head">
              <span>{label}</span>
              <span className="activity-raw-actions">
                <button className="raw-btn" onClick={copy}>
                  Copy
                </button>
                <button className="icon-btn" onClick={() => setModalOpen(false)} aria-label="Close">
                  <span className="material-symbols-outlined text-sm">close</span>
                </button>
              </span>
            </div>
            <pre className="raw-modal-body">{raw}</pre>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ToolActivity({
  run,
  raw,
}: {
  run: ToolRun;
  raw?: string;
}): JSX.Element | null {
  if (!run) return null;
  const [open, setOpen] = useState(false);
  const statusClass = run.status || "finished";
  const summary = useMemo(() => {
    if (run.error) return run.error.split("\n").find((line) => line.trim().length > 0) ?? run.error;
    const first = run.detail ?? run.output ?? "";
    return first.split("\n").find((line) => line.trim().length > 0) ?? "";
  }, [run.error, run.detail, run.output]);

  const toolName = run.toolName ?? "tool";

  return (
    <div className={`activity-step activity-step-${statusClass}`}>
      <button type="button" className="activity-step-head" onClick={() => setOpen((v) => !v)}>
        <span className={`activity-step-icon activity-step-icon-${statusClass}`}>
          {statusClass === "running" ? (
            <span className="material-symbols-outlined text-xs activity-spin">progress_activity</span>
          ) : statusClass === "failed" ? (
            <span className="material-symbols-outlined text-xs text-danger">error</span>
          ) : (
            <span className="material-symbols-outlined text-xs">terminal</span>
          )}
        </span>
        <span className="activity-step-name">{prettyToolName(toolName)}</span>
        {summary ? (
          <span className="activity-step-summary" title={summary}>
            {summary}
          </span>
        ) : null}
        {run.durationMs !== undefined && statusClass !== "running" ? (
          <span className="activity-step-time">{run.durationMs}ms</span>
        ) : null}
        {raw ? (
          <span className={`activity-step-chevron ${open ? "open" : ""}`}>
            <span className="material-symbols-outlined text-xs">expand_more</span>
          </span>
        ) : null}
      </button>

      {open && raw ? (
        <RawOutput raw={raw} label={`Output · ${prettyToolName(toolName)}`} />
      ) : null}
    </div>
  );
}

export function AgentWorkAccordion({
  runs = [],
  rawOutputs = {},
}: {
  runs?: ToolRun[];
  rawOutputs?: Record<string, string>;
}): JSX.Element | null {
  const safeRuns = (runs ?? []).filter((r) => Boolean(r && (r.callId || r.toolName)));
  if (safeRuns.length === 0) return null;

  const hasRunning = safeRuns.some((r) => r.status === "running");
  const [userToggled, setUserToggled] = useState<boolean | null>(null);

  // While working, default to expanded so live steps show nested; when done, collapse into Worked for Xs
  const open = userToggled !== null ? userToggled : hasRunning;

  const totalDurationMs = useMemo(() => {
    return safeRuns.reduce((acc, run) => acc + (run.durationMs ?? 0), 0);
  }, [safeRuns]);

  const durationSec = Math.max(1, Math.round(totalDurationMs / 1000));

  return (
    <div className="agent-work-accordion">
      <button
        type="button"
        className="work-accordion-head"
        onClick={() => setUserToggled((prev) => (prev !== null ? !prev : !open))}
      >
        <span className="work-accordion-title">
          {hasRunning ? "Working…" : `Worked for ${durationSec}s`}
        </span>
        <span className={`work-accordion-chevron ${open ? "open" : ""}`}>
          <span className="material-symbols-outlined text-xs">expand_more</span>
        </span>
      </button>

      {open ? (
        <div className="work-accordion-body">
          {safeRuns.map((run, idx) => (
            <ToolActivity key={run.callId || `run_${idx}`} run={run} raw={rawOutputs?.[run.callId]} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default memo(ToolActivity);
export { RawOutput };