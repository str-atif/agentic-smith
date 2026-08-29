import type { KeyboardEvent, RefObject } from "react";

function Composer({
  value,
  onChange,
  onSubmit,
  disabled,
  busy,
  stage,
  inputRef,
  modelLabel,
  presets,
  activePresetId,
  onModelChange,
}: {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  disabled: boolean;
  busy: boolean;
  stage?: string;
  inputRef: RefObject<HTMLTextAreaElement>;
  modelLabel?: string;
  presets?: ProviderPresetView[];
  activePresetId?: string | null;
  onModelChange?: (presetId: string) => void;
}): JSX.Element {
  const canSend = value.trim().length > 0 && !disabled;

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (canSend) onSubmit();
    }
  };

  const autoGrow = (): void => {
    const element = inputRef.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  };

  return (
    <div className="composer-card">
      <textarea
        ref={inputRef}
        rows={1}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          autoGrow();
        }}
        onKeyDown={handleKeyDown}
        placeholder={
          busy ? "Agent is working…" : "Ask anything. @ to mention, / for actions"
        }
        disabled={disabled}
      />

      <div className="composer-toolbar">
        <div className="composer-toolbar-left">
          {presets && presets.length > 1 && onModelChange ? (
            <div className="model-select-wrapper">
              <span className="material-symbols-outlined text-xs">add</span>
              <select
                className="model-select-pill"
                value={activePresetId ?? undefined}
                onChange={(event) => onModelChange(event.target.value)}
                title="Switch agent model"
              >
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.displayName} · {preset.modelName}
                  </option>
                ))}
              </select>
              <span className="material-symbols-outlined text-xs">expand_more</span>
            </div>
          ) : (
            <div className="model-chip-pill">
              <span className="material-symbols-outlined text-xs">add</span>
              <span>{modelLabel ?? "Gemini 3.6 Flash Medium"}</span>
              <span className="material-symbols-outlined text-xs">expand_more</span>
            </div>
          )}
        </div>

        <div className="composer-toolbar-right">
          {busy || stage ? (
            <span className="composer-stage-badge">{stage ?? "Working…"}</span>
          ) : null}

          <button
            type="button"
            className={`send-circle-btn ${busy ? "busy" : ""}`}
            onClick={onSubmit}
            disabled={!canSend || busy}
            title={busy ? "Agent is busy" : "Send"}
          >
            {busy ? (
              <span className="send-spinner" aria-label="Working" />
            ) : (
              <span className="material-symbols-outlined text-sm" style={{ opacity: canSend ? 1 : 0.4 }}>arrow_forward</span>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

export default Composer;