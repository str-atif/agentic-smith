import { useEffect, useMemo, useState } from "react";
import type {
  ModelConnectionTestResult,
  ModelProviderPresetInfo,
  ProviderPresetDraft,
  ProviderPresetView,
} from "@clpc/types";

export interface ConfigDrawerProps {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface PresetInputs {
  displayName: string;
  providerId: string;
  modelName: string;
  baseUrl: string;
  apiKey: string;
  orgId: string;
  projectId: string;
  timeoutMs: number;
  streaming: boolean;
  headersText: string;
}

const emptyInputs: PresetInputs = {
  displayName: "",
  providerId: "openai-compatible",
  modelName: "",
  baseUrl: "",
  apiKey: "",
  orgId: "",
  projectId: "",
  timeoutMs: 15000,
  streaming: true,
  headersText: "{}",
};

function toDraft(inputs: PresetInputs, id: string | undefined): ProviderPresetDraft {
  let headers: Record<string, string> | undefined;
  try {
    const parsed = JSON.parse(inputs.headersText || "{}");
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      headers = parsed as Record<string, string>;
    }
  } catch {
    headers = undefined;
  }
  return {
    id,
    displayName: inputs.displayName,
    providerId: inputs.providerId,
    modelName: inputs.modelName,
    baseUrl: inputs.baseUrl || undefined,
    apiKey: inputs.apiKey || undefined,
    orgId: inputs.orgId || undefined,
    projectId: inputs.projectId || undefined,
    timeoutMs: inputs.timeoutMs,
    streaming: inputs.streaming,
    ...(headers ? { headers } : {}),
  };
}

function inputsFromView(view: ProviderPresetView): PresetInputs {
  return {
    displayName: view.displayName,
    providerId: view.providerId,
    modelName: view.modelName,
    baseUrl: view.baseUrl ?? "",
    apiKey: "",
    orgId: view.orgId ?? "",
    projectId: view.projectId ?? "",
    timeoutMs: view.timeoutMs ?? 15000,
    streaming: view.streaming ?? true,
    headersText: JSON.stringify(view.headers ?? {}, null, 2),
  };
}

export default function ConfigDrawer({ open, onClose, onSaved }: ConfigDrawerProps) {
  const [known, setKnown] = useState<ModelProviderPresetInfo[]>([]);
  const [providers, setProviders] = useState<ProviderPresetView[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | undefined>(undefined);
  const [inputs, setInputs] = useState<PresetInputs>(emptyInputs);
  const [result, setResult] = useState<ModelConnectionTestResult | null>(null);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setResult(null);
    void window.api.getProviders().then(setKnown);
    void window.api
      .getConfig()
      .then((config) => {
        setProviders(config.providers);
        setActiveId(config.activeProviderId);
        const active = config.providers.find((p) => p.id === config.activeProviderId);
        setEditingId(active?.id);
        setInputs(
          active
            ? inputsFromView(active)
            : { ...emptyInputs, providerId: "openai-compatible" }
        );
      });
  }, [open]);

  const activePreset = useMemo(
    () => providers.find((p) => p.id === editingId) ?? null,
    [providers, editingId]
  );

  const selectPreset = (id: string) => {
    const preset = providers.find((p) => p.id === id);
    if (!preset) return;
    setEditingId(id);
    setInputs(inputsFromView(preset));
    setResult(null);
  };

  const newPreset = () => {
    setEditingId(undefined);
    setInputs({ ...emptyInputs, providerId: "openai-compatible" });
    setResult(null);
  };

  const applyKnown = (providerId: string) => {
    const knownProvider = known.find((k) => k.id === providerId);
    const model = defaultModelFor(knownProvider);
    setInputs((prev) => ({
      ...prev,
      providerId,
      baseUrl: knownProvider?.baseUrl ?? prev.baseUrl,
      modelName: model || prev.modelName,
    }));
  };

  const set = <K extends keyof PresetInputs>(key: K, value: PresetInputs[K]) => {
    setInputs((prev) => ({ ...prev, [key]: value }));
    setResult(null);
  };

  const onTest = async () => {
    setTesting(true);
    setResult(null);
    try {
      const res = await window.api.testConnection(toDraft(inputs, editingId));
      setResult(res);
    } catch (error) {
      setResult({
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setTesting(false);
    }
  };

  const onSave = async () => {
    setSaving(true);
    try {
      await window.api.saveConfig({
        activeProviderId: editingId ?? activeId ?? "",
        preset: toDraft(inputs, editingId),
      });
      onSaved();
      onClose();
    } finally {
      setSaving(false);
    }
  };

  if (!open) return null;

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="config-drawer"
        role="dialog"
        aria-label="Provider configuration"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="drawer-header">
          <h2>Configure</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <span className="material-symbols-outlined text-sm">close</span>
          </button>
        </header>

        <div className="drawer-body">
          <label className="field-label">Preset</label>
          <div className="preset-row">
            <select
              value={activePreset?.id ?? ""}
              onChange={(event) => {
                if (event.target.value) selectPreset(event.target.value);
              }}
            >
              <option value="" disabled>
                Select a preset…
              </option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.displayName}
                </option>
              ))}
            </select>
            <button className="ghost-btn" onClick={newPreset}>
              New
            </button>
          </div>

          <label className="field-label">Display name</label>
          <input
            type="text"
            value={inputs.displayName}
            onChange={(event) => set("displayName", event.target.value)}
            placeholder="e.g. Local Ollama"
          />

          <label className="field-label">Compatible API</label>
          <select value={inputs.providerId} onChange={(event) => applyKnown(event.target.value)}>
            {known.map((k) => (
              <option key={k.id} value={k.id}>
                {k.displayName}
              </option>
            ))}
          </select>

          <label className="field-label">Base URL</label>
          <input
            type="text"
            value={inputs.baseUrl}
            onChange={(event) => set("baseUrl", event.target.value)}
            placeholder="http://localhost:11434/v1"
          />

          <label className="field-label">Model</label>
          <input
            type="text"
            value={inputs.modelName}
            onChange={(event) => set("modelName", event.target.value)}
            placeholder="e.g. deepseek-chat"
          />

          <label className="field-label">
            API key {activePreset?.hasApiKey ? <em>(saved; leave blank to keep)</em> : ""}
          </label>
          <input
            type="password"
            value={inputs.apiKey}
            onChange={(event) => set("apiKey", event.target.value)}
            placeholder={activePreset?.hasApiKey ? "•••••••• (unchanged)" : "sk-… (optional)"}
          />

          <div className="field-grid">
            <div>
              <label className="field-label">Organization</label>
              <input
                type="text"
                value={inputs.orgId}
                onChange={(event) => set("orgId", event.target.value)}
              />
            </div>
            <div>
              <label className="field-label">Project</label>
              <input
                type="text"
                value={inputs.projectId}
                onChange={(event) => set("projectId", event.target.value)}
              />
            </div>
          </div>

          <div className="field-grid">
            <div>
              <label className="field-label">Timeout (ms)</label>
              <input
                type="number"
                value={inputs.timeoutMs}
                onChange={(event) => set("timeoutMs", Number(event.target.value))}
              />
            </div>
            <div className="check-field">
              <label className="check-label">
                <input
                  type="checkbox"
                  checked={inputs.streaming}
                  onChange={(event) => set("streaming", event.target.checked)}
                />
                Enable streaming
              </label>
            </div>
          </div>

          <label className="field-label">Custom headers (JSON)</label>
          <textarea
            rows={3}
            value={inputs.headersText}
            onChange={(event) => set("headersText", event.target.value)}
            spellCheck={false}
          />

          {result ? (
            <div className={`test-result ${result.ok ? "ok" : "fail"}`}>
              <div className="test-result-line">
                {result.ok ? "✓ Connected" : "✕ Failed"}
                {result.latencyMs !== undefined ? (
                  <span className="test-result-meta">{result.latencyMs}ms</span>
                ) : null}
              </div>
              <div className="test-result-message">{result.message}</div>
              {result.streaming !== undefined ? (
                <div className="test-result-meta">
                  {result.streaming ? "Streaming: working" : "Streaming: unavailable"}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <footer className="drawer-footer">
          <button className="ghost-btn" onClick={onTest} disabled={testing || saving}>
            {testing ? "Testing…" : "Test connection"}
          </button>
          <button className="primary-btn" onClick={onSave} disabled={saving}>
            {saving ? "Saving…" : "Save provider"}
          </button>
        </footer>
      </aside>
    </div>
  );
}

function defaultModelFor(knownProvider: ModelProviderPresetInfo | undefined): string {
  switch (knownProvider?.id) {
    case "openai":
      return "gpt-4o";
    case "deepseek":
      return "deepseek-chat";
    case "ollama":
      return "llama3.1";
    case "lmstudio":
      return "local-model";
    default:
      return "";
  }
}