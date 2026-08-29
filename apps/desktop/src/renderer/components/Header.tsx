import type { CraftlandInfo, ProviderPresetView, TaskStatus } from "@clpc/types";

const CRAFTLAND_SHORT: Record<CraftlandInfo["state"], string> = {
  unavailable: "Craftland off",
  detecting: "Detecting…",
  connecting: "Connecting…",
  connected: "Craftland connected",
  disconnected: "Craftland off",
  reconnecting: "Reconnecting…",
  error: "Craftland error",
};

export const STATUS_STAGE: Partial<Record<TaskStatus, string>> = {
  idle: "Idle",
  thinking: "Thinking…",
  streaming: "Generating response…",
  executing_tool: "Running tool…",
  waiting_for_tool: "Waiting for approval…",
  continuing: "Continuing…",
  completed: "Completed",
  failed: "Failed",
  error: "Error",
};

function Header({
  craftland,
  status,
  onConfigure,
}: {
  modelLabel?: string;
  presets?: ProviderPresetView[];
  activePresetId?: string | null;
  craftland?: CraftlandInfo;
  status?: TaskStatus;
  onModelChange?: (presetId: string) => void;
  onConfigure: () => void;
}): JSX.Element {
  return (
    <header className="top-bar">
      <div className="top-bar-title">
        <span className="brand-title font-semibold">CLPC Smith</span>
      </div>

      <div className="top-bar-actions">
        {status ? (
          <span className={`state-pill state-${status === "failed" || status === "error" ? "error" : status}`}>
            {STATUS_STAGE[status] ?? "Idle"}
          </span>
        ) : null}

        {craftland ? (
          <span className={`craftland-pill craftland-${craftland.state}`}>
            {CRAFTLAND_SHORT[craftland.state]}
          </span>
        ) : null}

        <button className="header-config-btn" onClick={onConfigure} title="Settings (Ctrl+B)">
          <span className="material-symbols-outlined text-sm">settings</span>
        </button>
      </div>
    </header>
  );
}

export default Header;