import { useCallback, useEffect, useState } from "react";
import type { CraftlandInfo } from "@clpc/types";

const STATE_LABEL: Record<CraftlandInfo["state"], string> = {
  unavailable: "Craftland Studio not running",
  detecting: "Detecting Craftland Studio…",
  connecting: "Connecting to MCP…",
  connected: "Connected",
  disconnected: "Disconnected",
  reconnecting: "Reconnecting…",
  error: "Connection error",
};

const STATE_HINT: Record<CraftlandInfo["state"], string> = {
  unavailable: "Launch Craftland Studio to enable its agent tools.",
  detecting: "Scanning for the Craftland Studio process.",
  connecting: "Verifying the MCP endpoint at /mcp.",
  connected: "Tools are registered and ready to use.",
  disconnected: "The connection was closed.",
  reconnecting: "Craftland restarted. Re-discovering the port.",
  error: "",
};

export default function CraftlandPanel({ initial }: { initial: CraftlandInfo }) {
  const [info, setInfo] = useState<CraftlandInfo>(initial);

  useEffect(() => {
    const unsubscribe = window.api.onCraftlandStatus((next) => setInfo(next));
    return () => unsubscribe();
  }, []);

  const onRetry = useCallback(() => {
    void window.api.craftlandRetry().then(setInfo);
  }, []);

  const busy = info.state === "detecting" || info.state === "connecting" || info.state === "reconnecting";
  const connected = info.state === "connected";

  return (
    <section className={`craftland-panel ${info.state}`}>
      <div className="craftland-head">
        <span className="craftland-title">Craftland Studio</span>
        {info.state !== "unavailable" && info.state !== "connected" ? (
          <button className="craftland-retry" onClick={onRetry} title="Retry discovery">
            Retry
          </button>
        ) : null}
      </div>

      <div className="craftland-status">{STATE_LABEL[info.state]}</div>

      {info.state === "unavailable" || info.state === "error" ? (
        <p className="craftland-hint">{STATE_HINT[info.state]}</p>
      ) : null}

      {info.error ? <p className="craftland-error">{info.error}</p> : null}

      {connected || busy ? (
        <dl className="craftland-meta">
          {info.pid ? (
            <>
              <dt>PID</dt>
              <dd>{info.pid}</dd>
            </>
          ) : null}
          {info.port ? (
            <>
              <dt>Port</dt>
              <dd>{info.port}</dd>
            </>
          ) : null}
          <dt>MCP</dt>
          <dd>{info.endpoint ?? "/mcp"}</dd>
          {info.toolCount !== undefined ? (
            <>
              <dt>Tools</dt>
              <dd>{info.toolCount}</dd>
            </>
          ) : null}
          {info.project ? (
            <>
              <dt>Project</dt>
              <dd>{info.project}</dd>
            </>
          ) : null}
          {info.scene ? (
            <>
              <dt>Scene</dt>
              <dd>{info.scene}</dd>
            </>
          ) : null}
        </dl>
      ) : null}
    </section>
  );
}