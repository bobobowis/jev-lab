# Proposal

## Why

The agentic levels (6 to 10) only run inside the pi coding agent: the Jev tools and hooks are pi extensions, the lab drives `pi --mode rpc`, and the web chat speaks pi's event names. The tooling also assumes macOS/Linux (`zsh -ic`, `open`, `lsof | xargs`, `VAR=x cmd` npm scripts), so the repo does not run on Windows and is awkward on WSL. The decision code in `src/levels/` is already harness-neutral; only thin glue is locked in. We want people to learn Jev with the agent they already use (Claude Code, Codex, pi, or anything that speaks MCP) on the OS they already have, and to take the same Jev utilities (client, guards, file reads, the ask tool) into their own projects without copying lab code. Today the Jev core already exists twice (the lab's `src/core/` and the hyper-jev skill's starter), identical for now but with nothing keeping them in step.

## What Changes

- Extract the reusable Jev layer into a standalone, publishable package, **`@bobobowis/jev-kit`**, in `packages/jev-kit/` of an npm workspace. It holds the client and wire types, question builders, policy helpers (normalize, weighted scores, confidence bands), file-to-state reading and pruning, state assembly with split suggestions, the guard and compaction decisions, the event channel, the spend ledger, the harness-neutral tool and hook definitions, and the capability matrix. It has zero runtime dependencies and never imports from the lab, so it can move to its own repository later without code changes.
- The lab (`apps/ten-levels`) consumes the package. Its `src/core/` and the shared level helpers become re-exports, so existing imports, tests, and doc paths keep working. The pi extensions become thin adapters over the package's tool and hook definitions; pi behavior is unchanged.
- The hyper-jev skill's starter keeps a self-contained copy of the core, now generated from the package by a sync script, with a test that fails when the copy drifts.
- The package ships one `jev` command whose subcommands are the delivery surfaces, built in this order:
  1. **`jev hook`**, a hook runner that implements Level 6 (bash gate, write gate, result screen) and Level 7 (should-compact advisory) for Claude Code `PreToolUse`/`PostToolUse`/`Stop`/`UserPromptSubmit` hooks, and for Codex hooks where Codex supports the event.
  2. **`jev mcp`**, a zero-dependency stdio MCP server that exposes the Level 7 to 10 tools (`should_i_compact`, `ask_jev_file_bool|choice|score`, `ask_jev_files`, `pick_first_file`, `ask_jev`), selected by level or by tool name. Usable from Claude Code, Codex, and any MCP client.
  3. **`jev ask`, `jev files`, `jev gate`, `jev guard`**, a general CLI for scripts, CI, and git hooks: typed answers as JSON, and shell exit codes for gates. Plus **`jev setup`**, which writes or merges the MCP and hook config for Claude Code or Codex into a project.
- Replace the stderr-only `JEV_EVENT` side channel with a channel that works across processes (per-process JSONL files in a session directory named by `JEV_EVENT_DIR`, with stderr kept as a fallback), so MCP servers, hook processes, and CLI runs still report to the lab.
- Make the lab's agent session manager pluggable: a driver per harness (`pi`, `claude`, `codex`) selected by `JEV_AGENT`, each translating its harness's stream into one normalized event vocabulary that `AgentChat.vue` renders. Per-session sandbox config (MCP config, hook settings, `CLAUDE.md`/`AGENTS.md`) is generated into the sandbox copy with `jev setup`.
- Document a **capability matrix** per level and harness, and degrade honestly where a harness lacks a feature (notably Level 7: Claude/Codex cannot compact on request from a tool, so the tier becomes advisory and `compact_now` is not offered).
- Make all tooling cross-platform: one Node task runner behind plain `npm run` scripts, replacing the shell-specific justfile (**BREAKING**: `just` recipes are removed; `npm run` is the only runner) and env-prefixed npm scripts, a portable "open browser" and "free port" helper, `node:path`-correct path handling with forward-slash output, and no reliance on `zsh`, `lsof`, `xargs`, or `open`.
- Update the `/install` and `/prime` commands, READMEs, the hyper-jev skill, and the sandbox to cover every supported agent and the package; add `AGENTS.md` for Codex and other agents.
- Out of scope: publishing the package to npm and moving it to its own repository. The change makes both a mechanical follow-up (a verified `npm pack` tarball, no imports out of `packages/jev-kit/`).

## Capabilities

### New Capabilities

- `jev-kit-package`: the standalone Jev package, its public API and command, its independence from the lab, and how the lab and the skill starter consume it.
- `jev-cli`: the general `jev` command for scripts, CI, and git hooks (ask, files, gate, guard) and the `jev setup` config writer.
- `jev-tool-server`: the harness-neutral Jev tool definitions and the MCP server that exposes them per level.
- `jev-harness-hooks`: the Level 6 guards and the Level 7 compaction advisor as hooks, with the behavior each harness must and may provide.
- `jev-event-channel`: how tools, hooks, and CLI runs in any process report Jev calls and hook decisions to the lab and to a permanent record.
- `lab-agent-drivers`: how the lab starts, prompts, aborts, and streams a session for a chosen harness, and the normalized event vocabulary the web chat renders.
- `cross-platform-tooling`: the runners, scripts, and setup flow that must work on Windows, macOS, and Linux with any supported agent.

### Modified Capabilities

None. No specs exist yet under `openspec/specs/`.

## Impact

- Code: new `packages/jev-kit/` (core, policy, files, guards, compaction, tools, hooks, event channel, ledger, capabilities, `mcp`, `hook`, CLI); `apps/ten-levels/src/core/*` and the shared helpers in `src/levels/level03`, `level04`, `level06`–`level10` become re-exports from the package; `apps/ten-levels/extensions/*` refactored into adapters; `server/agent-session.mjs` split into drivers; `server/server.mjs` and `scenarios.mjs` (tool allowlists per harness); `web/src/components/AgentChat.vue` and `web/src/lib/agent-api.ts` (normalized events); the package's file pruning skips `.claude`, `.codex`, `.jev` and outputs forward-slash paths.
- Skill: `.claude/skills/hyper-jev/templates/starter/src/core/` becomes a generated copy of the package core; `SKILL.md` and the cookbook mention the `jev` command, hooks, and MCP server.
- Tooling: a root `package.json` with npm workspaces (`apps/ten-levels`, `packages/jev-kit`), the `justfile` (removed), `apps/ten-levels/package.json` scripts, new `scripts/*.mjs` helpers (run, open-url, sync-skill-core).
- Config and docs: `sandbox/.pi/settings.json` plus generated `.mcp.json` / `.claude/settings.json` / Codex config per session, `.claude/commands/install.md`, `.claude/commands/prime.md`, `README.md`, `apps/ten-levels/README.md`, `packages/jev-kit/README.md`, new `AGENTS.md`.
- Dependencies: none added at runtime. The MCP server, hook runner, and CLI are hand-written over `node:` modules. TypeScript becomes a dev dependency of the package, used only to build its `dist/` (JavaScript and type declarations). Setup now starts with `npm install` at the repo root. External CLIs required only for the harness a user picks (`pi`, `claude`, or `codex`).
- Credentials: the agent model key depends on the harness (OpenRouter for pi, Anthropic login or key for Claude, OpenAI login or key for Codex); Jev still uses `OPENROUTER_API_KEY` or `TYPESAFE_API_KEY`, read by the package from the environment only.
