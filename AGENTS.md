# AGENTS.md

CLPC Smith — an agentic development workspace for Craftland (Garena Free Fire), Electron + React desktop app over a Node core. npm workspaces monorepo (`apps/*`, `packages/*`), Node >= 20.

## Commands (run from repo root)

| Command | Notes |
| --- | --- |
| `npm run dev` | `predev` builds all packages first, then desktop dev (build main+preload, Vite renderer on `:5173`, Electron waits on it). Interactive GUI — not for CI-style verification. |
| `npm run build` | Builds all packages (`build:packages`) + desktop (Vite renderer, then `tsc` for main/preload). |
| `npm run typecheck` | `pretypecheck` builds packages first, then `tsc --noEmit` per workspace. Don't skip the build. |
| `npm run lint` | Eslint per workspace (no formatter/prettier exists; eslint is the only style gate). |
| `npm run test` | `vitest run` per workspace. |

- One package: `npm run test --workspace @clpc/core` (or `typecheck`/`lint`/`build`).
- One test file: from the package dir, `npx vitest run src/foo.test.ts`.
- Validation order that matters: `typecheck` requires a fresh `build:packages` (hook handles it). Lint/test do NOT need builds — cross-package imports resolve to TS source via each package's `vitest.config.ts` aliases.

## Architecture / layering (strict)

- `packages/types` — shared contracts (`Message`, `AgentSession`, `StreamingEvent`, providers); depends on nothing internal. Everything depends on it.
- `packages/core` — `AgentOrchestrator`, session state + persistence (`store.ts` `FileSessionStore`), tool invoker. Must know nothing about Craftland or any vendor/provider.
- `packages/model-providers` — `ModelProvider` interface + registry; new provider = implement interface + register in `registry.ts`, no runtime changes.
- `packages/tools`, `packages/mcp-client`, `packages/platform-craftland` — tool registry/invocation, generic MCP client (http/stdio transports), Craftland Studio discovery/MCP integration.
- Entrypoints: each package `src/index.ts`. App wiring: `apps/desktop/src/main/index.ts` (also `src/preload/index.ts`, `src/renderer/`).
- Desktop main/preload import cross-packages via their built `dist/` (`main` field); the renderer + Vite alias cross-packages to `packages/*/src/index.ts` (source). So after editing a package, rebuild packages before checking main-process behavior; renderer sees source immediately.

## Desktop app specifics

- Three tsconfigs: `tsconfig.json` (renderer + `vite.config.ts` + `electron.d.ts`), `tsconfig.main.json`, `tsconfig.preload.json`. Never assume a single build.
- IPC is namespaced `clpc:*` (send-message, get/open/create/delete/rename-session, sessions_updated, token, message_received, session_status, tool_started/progress/completed/failed, agent_error, window controls, get-platform, config, test-connection, craftland-status/retry). Window min/max/close are IPC handlers — no `window.close()` in renderer.
- Win32 uses `titleBarStyle: "hidden"` + `titleBarOverlay` (height 40); `.app.win .top-bar-actions { margin-right: 148px }` keeps buttons clear of the overlay controls — preserve when touching styles.
- Renderer API types are hand-written in `src/renderer/api.d.ts` to mirror the preload surface; keep in sync when adding channels.
- Config lives in Electron `userData/config.json`; sessions persist under `userData/sessions`. Secrets (api keys) must never be committed; renderer code never contains them.
- `marked` v18 is consumed via the token-based renderer core in `components/Markdown.tsx` — do not fall back to deprecated `innerHTML`/`html` modes.
- `@clpc/desktop` `test` script is still `echo "no tests yet"`: there is no renderer test harness. Verify desktop logic through the core suites and manual runs.

## Core runtime semantics (do not break)

- Task-state machine in `AgentOrchestrator`: `session_status` events carry a human `stage` (thinking / streaming / executing_tool / continuing / …). A session ends `completed` (or `failed` on provider throws + `agent_error` with a typed code: tool_validation, tool_execution, timeout, model, …).
- Overlapping sends throw `AgentBusyError`. Tools validate args up front; validation/timeout/execution failures are fed back to the model as a `tool` message with an error code so it can self-correct — keep that feedback contract.
- Persistence hook is fire-and-forget on `SessionManager`; `FileSessionStore` does atomic tmp+rename writes and is queue-serialized. Don't add sync/blocking writes.

## Testing

- Vitest 1.6, `environment: "node"` everywhere. Test location differs: platform-craftland uses `tests/*.test.ts`; every other package colocates `src/*.test.ts`.
- Unit tests must be hermetic (stub/`FakeProvider`-style providers). State-machine tests: `src/orchestrator.state.test.ts`; persistence: `src/store.test.ts` — extend these for runtime changes.
- Live probes (skip-style, need external services, keep tolerant):
  - `model-providers/src/integration.test.ts` hits `CLPC_TEST_PROVIDER_URL` (default `http://localhost:8237`, a DeepSeek/OpenAI-compatible proxy). It must skip (not fail) when the upstream is unreachable or slow — result-message skip regex intentionally matches timeouts and aborts.
  - `platform-craftland/tests/integration.test.ts` requires Craftland Studio's local MCP. Discovery identifies the Craftland Studio process, finds its listening TCP ports (`netstat`), and verifies candidates via `POST http://127.0.0.1:<port>/mcp` — never assume a fixed port. Self-skips when nothing is found; flakes under parallel full-suite load (`verifyTimeoutMs: 4000`, test timeout 30s) — re-run alone before blaming a change.
- Full `npm run test` is the gate; run the whole thing, not just one workspace, before reporting green.

## UI/UX directive

- CLPC Smith must feel native, dense, restrained, and desktop-first.
- When modifying the UI, preserve the existing visual language. Do not convert the application into a generic web/SaaS dashboard.
- Prefer: native desktop conventions > web conventions; information density > decoration; subtle states > flashy animations; structured panels > floating cards; compact controls > oversized controls; system typography > decorative typography.
- Before making substantial renderer/UI changes, read the local `ANTIGRAVITY_DESIGN_SKILL.md` and applicable files under `.antigravity/skills/`.
- Treat those files as the visual design authority for CLPC Smith.
- Preserve the established layout, spacing, typography, density, control sizing, and interaction patterns unless the task explicitly requests a visual redesign.
- Do not replace the existing visual system with generic Tailwind, SaaS, dashboard, or "modern AI app" styling.

## Gotchas

- Windows/PowerShell host: `&&` is unsupported (use `cmd1; if ($?) { cmd2 }`); PowerShell cmdlets preferred; for HTTP probes use `curl.exe` (Invoke-WebRequest mangles things). Long command output truncates — use `Select-Object -Last N`.
- `tsconfig.base.json` is strict with `noUnusedLocals`/`noUnusedParameters`; eslint errors unused vars except `_`-prefixed. Keep those clean.
- Visual design must stay original — do not copy Antigravity source/CSS/assets. Design tokens live in repo-root `ANTIGRAVITY_DESIGN_SKILL.md` and `.antigravity/skills/` (both gitignored but present locally); verify UI changes against them.
- Never commit, push, or create PRs unless asked; never commit secrets (config, `.env`, stray `userData` copies).