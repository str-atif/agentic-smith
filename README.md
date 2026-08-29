# CLPC Smith

Your agentic workspace for Craftland.

CLPC Smith is an agentic development workspace for building, scripting, and
managing Garena Free Fire **Craftland** projects. It bridges you, an AI model
(remote or local), and development tools — with a workspace UI inspired by
agentic chat/artifact workflows rather than a traditional IDE.

## Architecture (high level)

```
UI (Electron renderer, React)
        ▲ IPC (contextBridge, type-safe channel surface)
        ▼
Agent runtime (packages/core) ──► Model providers (packages/model-providers)
                                            ▲
        ▼                                     │ one provider implemented in Phase 0
Tool system (future phases)                  │
  └─ MCP client (future)                     │
       └─ Craftland integration (future)     │
                                    OpenAI (streaming / chat completions)
```

Strictly separated layers:

- **UI / renderer** — React, runs sandboxed, no Node access.
- **Agent runtime** (`@clpc/core`) — session state + orchestration. Owns the
  streaming loop; knows nothing about Craftland or any specific vendor.
- **Model providers** (`@clpc/model-providers`) — `ModelProvider` interface +
  a small registry so new providers can be added without touching the runtime.
- **Type contracts** (`@clpc/types`) — shared types: `Message`, `AgentSession`,
  `ChatRequest`, `ChatResponse`, `StreamingEvent`, `ModelProvider`, config.

A provider is created from config (`providerId` → factory). The agent identity
follows the model: the sidebar shows the configured model id, not a hardcoded
personality.

## Phase 0 scope

What works today:

- Monorepo (npm workspaces): `apps/desktop`, `packages/types`,
  `packages/core`, `packages/model-providers`.
- Electron shell: main process, secure preload (`contextBridge`),
  `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`,
  CSP in the renderer.
- Workspace UI: sidebar (agent/model + status), chat list, prompt input,
  send button, empty state, config dialog.
- Streaming agent loop: renderer → IPC → `AgentOrchestrator` →
  `OpenAIProvider` → SSE stream → token events → renderer.
- Config stored in Electron `userData` (`config.json`) — never in the repo,
  never in renderer code or bundle.
- Build / typecheck / lint / test scripts for every workspace package.

## Prerequisites

- Node.js >= 20 (npm >= 10 for workspaces)

## Install

```bash
npm install
npm run build:packages
```

## Run (development)

```bash
npm run dev
```

This builds the packages, compiles the Electron main + preload, starts the
Vite renderer dev server, and launches Electron wired to it.

On first launch you will be prompted for your OpenAI API key (stored under
Electron `userData`, e.g. `%APPDATA%/<app>/config.json`).

## Scripts

| Command                | What it does                                  |
| ---------------------- | --------------------------------------------- |
| `npm run dev`          | Build packages, launch dev app                |
| `npm run build`        | Build packages + production desktop bundle    |
| `npm run typecheck`    | Type-check every package                      |
| `npm run lint`         | Lint every package                            |
| `npm run test`         | Run unit tests (model provider, runtime)      |

## Model configuration

Config lives in Electron `userData/config.json`:

```json
{
  "providerId": "openai",
  "apiKey": "sk-...",
  "modelName": "gpt-4o"
}
```

`packages/model-providers/src/registry.ts` maps `providerId` to a provider
factory. Adding a provider = implement `ModelProvider` + register it. No
runtime changes required.

## Not implemented yet (Phase 1+)

- Tool system (filesystem, command execution)
- MCP client and Craftland MCP discovery
- Craftland integration / project detection
- Plans, tasks, artifacts, walkthroughs
- Changes/diff viewer
- Sandbox and permission/approval system
- Local model providers
- Session persistence across restarts
- Packaging (installer, auto-update)

## Contributing

Open source (GitHub `agentic-smith`). Monitor typecheck, lint, and tests
before opening a PR. Do **not** commit API keys or proprietary Craftland
Studio code or assets.

## License

MIT (placeholder until the license file is added).