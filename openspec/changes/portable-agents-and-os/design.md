# Design

## Context

See proposal.md for motivation. Current state that shapes the approach:

- `src/levels/level06–10` already hold all decision logic as pure functions (`gateBashCommand`, `gateWriteCall`, `screenToolResult`, `decideTier`, `askFileBool`, `askFiles`, `assembleState`, …). Only `apps/ten-levels/extensions/*.ts` touch pi's API.
- `apps/ten-levels/src/core/{client,helpers,mock,types}.ts` and `.claude/skills/hyper-jev/templates/starter/src/core/` are byte-identical today. The starter's `levels/` are mostly different examples (its levels 6–10 are other use cases), so only `core/` is duplicated.
- There is no root `package.json`; the lab runs its `.ts` sources directly with Node's type stripping, and Node refuses to strip types for files under `node_modules`.
- The extensions import `typebox`, which is not in any `package.json`. It resolves only because pi loads them. `jev-compact.ts` also imports `SettingsManager` from pi.
- `server/agent-session.mjs` spawns `pi --mode rpc` and relays its JSONL. `AgentChat.vue` consumes pi's event names directly.
- `extensions/report.ts` reports by writing `JEV_EVENT` lines to stderr, which only works because pi's stderr is the lab's pipe.
- The project rule is zero runtime dependencies (node:http server, hand-written client).
- Installed CLIs checked during planning: Claude Code 2.1.302 (`-p`, `--input-format/--output-format stream-json`, `--mcp-config`, `--strict-mcp-config`, `--settings`, `--setting-sources`, `--tools`, `--allowedTools`, `--disable-slash-commands`) and Codex 0.162.1 (`exec --json`, `exec resume`, `--ignore-user-config`, `-c key=value`, `hooks` feature stable, app-server experimental). pi is not installed on this machine.

## Goals / Non-Goals

**Goals:**
- One implementation of every Jev utility, tool, and hook decision, in one package, with thin per-harness adapters and thin delivery surfaces (hook runner, MCP server, CLI).
- pi behavior and the lab's HTTP API stay as they are, so nothing regresses for pi users.
- Works by hand: a user can run plain `claude` or `codex` with the Jev server and hooks in the sandbox or in their own project, without the lab.
- The package can leave this repository later by moving one directory.

**Non-Goals:**
- Publishing to npm, and moving the package to its own repository. Both are deferred until the API settles; this change only proves the tarball installs and runs.
- Moving the lab's teaching examples (Levels 1–5 options) into the package. They stay lab code that imports the package.
- Recreating pi features a harness doesn't have, such as programmatic compaction under Claude or Codex, or rewriting built-in tool results under Claude.
- Adapters for other agents beyond pi, Claude Code, and Codex. Generic MCP clients get Levels 8–10 for free, but nothing more.
- Using the Claude Agent SDK or Codex SDK. Both would add runtime dependencies.

## Decisions

### D0. `@bobobowis/jev-kit` in `packages/jev-kit/`, an npm workspace member
- A root `package.json` (private) declares workspaces `apps/ten-levels` and `packages/jev-kit`. `npm install` at the root links the lab to the package.
- Layout: `src/core/` (client, types, mock, builders), `src/policy/` (normalize, weighted score, confidence bands), `src/files/` (read-state, expand and prune, assemble, split), `src/guards/` (bash gate, write gate, result screen), `src/compact/` (should-compact, cut point), `src/tools/`, `src/hooks/`, `src/events/`, `src/ledger.ts`, `src/capabilities.ts`, `src/cli/` (one `jev` bin: `ask`, `files`, `gate`, `guard`, `setup`, `hook`, `mcp`). Harness notes go in `packages/jev-kit/docs/`.
- The guard and compaction modules move from `src/levels/level06`, `level07` with their questions and thresholds kept together, one file per decision, so they still read like the lab's options. The lab's `src/levels/level06–10` modules and `src/core/*` become re-exports, so imports, tests, and doc paths keep working.
- **Build:** the package's `exports` and `bin` point to `dist/` (JavaScript plus `.d.ts`), built with `tsc` (`rewriteRelativeImportExtensions`). The workspace root's `prepare` builds it on `npm install`, and the package's `prepack` builds it before `npm pack` or a publish. The package itself has no install-time scripts, so consumers installing it see no install-script warning. The package's own tests run on `src/` directly. One resolution path for Node, pi's loader, the tarball, and the lab.
  - *Alternative:* `exports` pointing at `.ts` sources. Rejected: Node won't strip types under `node_modules`, so a packed install would break, and the tarball would differ from what the lab runs.
  - *Alternative:* a custom `source` export condition for in-repo use. Rejected: every runner (Node, pi, tests, hook configs) would need the flag, and pi's loader may not honor it.
- **Independence rules**, enforced by a test: no import in `packages/jev-kit/` resolves outside it, no `dependencies`, and its tests pass with `apps/` absent. Extraction later is `git subtree split --prefix packages/jev-kit`.
- **Skill starter:** `scripts/sync-skill-core.mjs` copies the package's `src/core/` into the starter, and `packages/jev-kit/tests/skill-sync.test.ts` fails on any difference. The starter stays self-contained, offline, and runs without the package.
  - *Alternative:* the starter depends on the package from npm. Rejected for now: the skill must work before publishing and without a network install.

### D1. Harness-neutral layer inside the package
- `src/tools/`: one `JevTool` per tool, with `{ name, label, description, parameters: JSONSchema, execute(params, ctx) }`. `ctx` is `{ cwd, decide, report, harness }`. Descriptions and schemas move here verbatim from the extensions. `src/tools/sets.ts` maps level numbers to tool names (7 → `should_i_compact`, 8 → the three `ask_jev_file_*`, …); the package's own API speaks tool names, and levels are an alias.
- `src/hooks/`: handlers over a normalized event, `{ kind: "shell" | "write" | "read-result" | "shell-result" | "turn-end", input, cwd }`, returning `{ block?, reason?, banner?, inject? }`.
- `src/events/`: replaces `extensions/report.ts` (see D5). `decide()` keeps its signature but takes a reporter instead of `pi`.
- The pi extensions become adapters that import from the package and keep their file names, so `scenarios.mjs` and the docs keep working. They wrap each JSON Schema with `Type.Unsafe(schema)` from pi's bundled typebox, so pi's validator still accepts it.
- *Alternative:* keep typebox as the schema source. Rejected, because the MCP server, hooks, and CLI run outside pi and typebox isn't a project dependency.

### D2. Hook runner, `jev hook` (built first among the surfaces)
- Usage: `jev hook --harness claude|codex --event <name> [--guards bash,write,result] [--compact]`. In the repo: `node packages/jev-kit/dist/cli/index.js hook …`. It reads the hook JSON on stdin, maps it to a D1 event, and writes the harness's response on stdout. It runs with a Jev timeout below the harness's hook timeout and fails open, as the spec requires.
- **Claude Code mapping:**
  - `PreToolUse`, matcher `Bash`: shell gate. Matcher `Write|Edit|MultiEdit|NotebookEdit`: write gate, reading `tool_input.file_path` and `content`/`new_string`/`edits[].new_string`. A deny returns `hookSpecificOutput.permissionDecision: "deny"` with a `permissionDecisionReason`.
  - `PostToolUse`, matcher `Read|Bash`: result screen. The banner goes in `hookSpecificOutput.additionalContext`.
  - Level 7, `Stop`: read `transcript_path`, collect user requests and the last assistant usage, ask the four questions, and save the tier to `$JEV_STATE_DIR/compact.json`.
  - Level 7, `UserPromptSubmit`: inject the saved non-silent tier as `additionalContext` once, then clear it.
  - Level 7, `PreCompact`: reported as an event only.
- **Codex mapping:** the same runner with `--harness codex`. Codex fires the same events with the same payload fields and accepts the same `hookSpecificOutput` responses (`docs/NOTES-codex.md`): `PreToolUse`/`PostToolUse` for `Bash`, `apply_patch`, and `mcp__*` tools, `Stop` with `last_assistant_message`, `UserPromptSubmit` with `additionalContext`. The write gate reads `apply_patch`'s paths and added lines from the patch text in `tool_input.command`. Context usage comes from the last `token_count` event in the rollout at `transcript_path`.
- **Claude Code details** (`docs/NOTES-claude.md`): `Read`'s result text is `tool_response.file.content`, `Bash`'s is `stdout` + `stderr`; `Stop`'s `last_assistant_message` is the recent turn, the transcript is read only for usage; user requests are recorded from `UserPromptSubmit`, which does not fire for `/compact`.
- Hook state between processes, such as user requests seen and the pending tier, lives in `JEV_STATE_DIR`. Each lab session sets its own; run by hand, it defaults to `.jev/` in the cwd.
- *Alternative:* evaluate Level 7 on every `PostToolUse` to match pi's per-turn cadence. Rejected for now, since it costs a Jev call per tool call. Stop is the natural turn boundary in both CLIs.

### D3. Hand-written stdio MCP server, `jev mcp`
- It speaks newline-delimited JSON-RPC 2.0 and handles `initialize` (echoing a supported `protocolVersion`, `capabilities.tools`, `serverInfo`, and `instructions`), `notifications/initialized`, `tools/list`, `tools/call`, and `ping`. Unknown methods get `-32601`. Tool errors come back as `{ isError: true, content: [...] }`.
- Usage: `jev mcp --level 8` or `jev mcp --tools ask_jev,ask_jev_files`. The server name is `jev`, so Claude shows `mcp__jev__ask_jev_file_bool`.
- `cwd` is `process.cwd()`, and the harness starts the server in the project. `--cwd` overrides it.
- Level 10's ledger is kept per process. It's reported after every call, and on Claude also from the Stop hook (D2).
- *Alternative:* `@modelcontextprotocol/sdk`. Rejected because of the dependency rule. The subset we need is about 150 lines.

### D4. General CLI: `jev ask`, `files`, `gate`, `guard`, `setup`
- Hand-written argument parsing over `node:util` `parseArgs`; no dependency.
- `ask` and `files` reuse the `ask_jev` and `ask_jev_files` tool `execute` functions, so validation, budget, split messages, pruning, and the bash gate on `--command` are identical. JSON on stdout, diagnostics on stderr.
- `gate` is the smart if for shells: one Noul, `--threshold` (default 0.5). Exit codes 0 yes, 1 no, 2 usage, 3 Jev error, so the caller chooses fail open or closed.
- `guard bash|write` runs the D1 hook handlers directly: 0 allow, 1 block.
- `setup --harness claude|codex [--tools …] [--guards …] [--level N] [--out dir] [--dry-run]` writes or merges `.mcp.json`, `.claude/settings.json` hooks, or the Codex config. Entries it writes carry a marker (the `jev` server name, and hook commands starting with `jev hook`), so a rerun updates only its own entries and leaves the rest alone. The lab's session setup calls the same code (D6).
- State input: `--state` text or JSON, `--state-file`, `--paths` (repeatable globs), `--command`; questions with `--questions` (JSON or `@file`) or, for `gate`, a positional question string.
- *Alternative:* separate `jev-hook` and `jev-mcp` bins. Rejected: one bin is one thing to install, document, and put on PATH.

### D5. Event channel: a directory with one file per process
- `JEV_EVENT_DIR` set: each process appends to `<dir>/<harness>-<pid>.jsonl`. The lab watches the directory with `fs.watch` plus a 250 ms poll fallback, since watch is unreliable on network and WSL mounts. It tails each file by byte offset and keeps any partial last line in a buffer.
- Not set: stderr `JEV_EVENT` lines, as today, for adapters, the MCP server, and the hook runner. The general CLI subcommands stay quiet on stderr unless an event directory is set. The pi driver also sets `JEV_EVENT_DIR`, so the lab has one ingestion path. pi `appendEntry` is kept inside the pi adapter.
- *Alternative:* one shared file with O_APPEND. Rejected: Jev events carry file contents, and appends that large aren't atomic across processes, especially on Windows.
- *Alternative:* a localhost socket. Rejected: it adds a port and lifecycle problems, and hooks run as short-lived processes.

### D6. Pluggable drivers in `server/drivers/`
- `agent-session.mjs` keeps the session lifecycle: sandbox copy, git baseline, event buffer, subscribers, idle kill, and the event-dir tail. It delegates to a driver with `{ name, detect(), defaultModel, start(session), prompt(text), abort(), close() }`. The driver emits normalized events through `session.push`. Claude and Codex drivers generate the sandbox copy's agent config with the package's `setup` code.
- **Canonical vocabulary = pi's current event names**, so `AgentChat.vue` barely changes. The only UI work is showing the harness name, leaving unknown cost or context empty, and the degraded note.
- **pi driver:** today's code, moved as is.
- **claude driver:** one long-lived `claude -p --input-format stream-json --output-format stream-json --verbose --model M --mcp-config <sess>/mcp.json --strict-mcp-config --settings <sess>/settings.json --setting-sources "" --tools <builtins> --allowedTools <builtins+mcp> --permission-mode bypassPermissions`, plus `--append-system-prompt` for the Level 10 nudge. Each prompt is one `{"type":"user",...}` line on stdin. `--disable-slash-commands` is added on every level but 7, where the user's `/compact` must work. MCP tools are deferred behind `ToolSearch`, so `<builtins>` includes it whenever the level has Jev tools.
  - Event mapping: the first output → `agent_start`. Assistant `tool_use` blocks → `tool_execution_start`. User `tool_result` blocks → `tool_execution_end`. Assistant text → `message_end`. `result` → `stats` then `agent_settled`. `system` `compact_boundary` → `compaction_end`.
  - Stats: `total_cost_usd` is cumulative for the session, so cost per turn is the difference from the last `result`. Context is the last assistant message's input plus cache tokens over `modelUsage[model].contextWindow`.
  - Abort: send the stream-json interrupt control request. If the turn doesn't settle within 3 s, kill the process and respawn with `--resume <session_id>`.
- **codex driver:** one `codex exec --json` process per prompt, stdin closed. Follow-ups use `codex exec resume <thread_id> --json`, which takes no `--sandbox` or `-C`: it gets `-c sandbox_mode=...` and is spawned in the session directory. Flags: `--ignore-user-config`, `--dangerously-bypass-hook-trust`, `--skip-git-repo-check`, `approval_policy="never"`, `-m M`, and `-c` overrides for `mcp_servers.jev` (command, args, cwd, `env_vars` for the Jev key and `JEV_*` dirs since Codex starts MCP servers without the environment, `enabled_tools`, `default_tools_approval_mode="approve"`) and for each hook as `hooks.<Event>=[...]`. A project `.codex/hooks.json` is not loaded, and the user's `$CODEX_HOME/hooks.json` is never written. Abort kills the process tree; the next prompt resumes the thread. JSONL items map to the same vocabulary: `command_execution`, `mcp_tool_call`, and `file_change` → tool start and end, `agent_message` → `message_end`, `turn.completed` → `stats` then `agent_settled`. The two hook-trust `error` items are dropped. A hook-blocked command has no item, so its row comes from the hook event only.
  - Stats: `turn.completed` usage is cumulative for the thread, so tokens per turn are differences. No cost is reported; the cost field stays empty.
  - *Alternative:* `codex app-server`, which would give a long-lived process and native interrupt. Deferred because it's still experimental. The driver interface allows swapping it in later.
- **Selection:** the start body's `harness` field wins, then `JEV_AGENT`, then the first CLI found on PATH (pi, claude, codex). `GET /api/state` gains `harnesses: [{ name, available }]` and `harness`.
- **Allowlists:** `scenarios.mjs` options keep `tools` in pi names. A per-driver map translates them: Claude `read→Read`, `bash→Bash`, `edit→Edit`, `write→Write`, and Jev tools → `mcp__jev__<name>`. Codex can't drop its built-in shell, so for Codex the allowlist only restricts MCP tools, and the matrix says so.
- **Environment:** `agentEnv()` gains each driver's credential names. Claude: `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL`, `CLAUDE_CODE_*`, plus the user's login dir through `HOME`/`USERPROFILE`. Codex: `OPENAI_API_KEY`, `CODEX_HOME`. Windows basics: `USERPROFILE`, `APPDATA`, `LOCALAPPDATA`, `SystemRoot`, `ComSpec`, `PATHEXT`, `TEMP`.
- **Default models:** pi keeps `openrouter/google/gemini-3.8-flash`. Claude uses `claude-haiku-5-5`. Codex uses its configured default unless `JEV_AGENT_MODEL` is set.

### D7. Cross-platform tooling
- `scripts/run.mjs` holds every recipe as a named task: level, demo, demo-live, test, test-live, web, dev, lint, heroes, mcp, build, sync-skill. Tasks that run lab code build the package first (incremental `tsc -b`, near-instant when unchanged); `dev` also runs `tsc -b --watch`. The root `package.json` maps each to an npm script (`npm run level -- 4 b`), and the lab's `package.json` calls the same tasks.
- The `justfile` is removed. npm is the only runner, so there is no second tool to install and nothing to keep in step. The Claude `/install` command is run from Claude Code directly instead of through `just install`.
  - *Alternative:* keep `just` as an optional front end. Rejected: a second runner adds an install step and a list to keep in sync, and npm already ships with Node.
- Env flags move into the code: `node src/demo.ts --mock` instead of `JEV_BACKEND=mock node …`, and live tests read `--live`. Wherever env is still needed, `run.mjs` sets it on the child process.
- `.env` loading: `node --env-file-if-exists=<repo>/.env` on every Node child the runner starts.
- Freeing the port: the server answers `POST /api/shutdown` from 127.0.0.1 only, with a lab-identifying header. `run.mjs web` calls it before listening, so `npm run web` twice replaces the first lab. A foreign process holding the port gets a clear message instead of a kill.
- Opening the browser: `scripts/open-url.mjs`. win32 → `rundll32 url.dll,FileProtocolHandler URL` (no shell, so no quoting). darwin → `open`. Linux → `wslview` or `explorer.exe` under WSL (detected from `/proc/version`), else `xdg-open`. On failure it prints the URL.
- Spawning agent CLIs: `server/spawn-cli.mjs` resolves the command on PATH with PATHEXT. A `.cmd`/`.bat` shim is run through `cmd.exe /d /s /c` with argument quoting. Prompts go over stdin, never argv, which avoids most quoting. Process trees are killed with `taskkill /T /F` on Windows, and on POSIX the child spawns `detached` and gets `process.kill(-pid)`.
- Paths: the package's pruning and the tool results normalize output with `.split(sep).join("/")`. `SKIP_DIRS` gains `.claude`, `.codex`, and `.jev`.
- Node: `engines.node` becomes `>=22.18` in the root, the lab, and the package, the first version with type stripping on by default. `run.mjs` (plain JS) checks the version first and exits with a message on older Node. Docs say "Node 22.18+ (24 recommended)".
- CI: a GitHub Actions matrix (ubuntu, macos, windows) runs `npm install`, `npm test` (package and lab), and `npm run demo` on the mock backend, a smoke test of `jev mcp` over stdio and of `jev hook` fed fixture JSON, and `npm pack` of the package installed into a temp project running `jev --help` and `jev gate --mock`. This checks the cross-OS and publishable claims with no keys and no agent CLIs.

### D8. Capability matrix
- `packages/jev-kit/src/capabilities.ts` declares, per level, option, and harness, a status of `full`, `degraded` (with a note), or `unavailable`. The lab serves it in `/api/level/:n`, and the README table is generated from it, so docs and UI can't disagree.
- Matrix, confirmed against the captures in task 1:

| Level | pi | Claude Code | Codex | Generic MCP |
|---|---|---|---|---|
| 6 A bash gate | full | full | full | unavailable |
| 6 B write gate | full | full | full (apply_patch read from the patch text) | unavailable |
| 6 C result screen | full | degraded (banner as context) | degraded (banner as context) | unavailable |
| 7 A turn end | full | degraded (per run, advisory, no compact_now) | degraded (per run, advisory, no compact_now) | unavailable |
| 7 B on demand | full | degraded (no compact_now) | degraded (no compact_now) | degraded |
| 7 C cut point | full | unavailable | unavailable | unavailable |
| 8, 9, 10 | full | full | full (built-in shell not removable) | full |

### D9. Instructions for agents
- A root `AGENTS.md` covers orientation (prime) and setup (install) for any agent. `.claude/commands/install.md` and `prime.md` become thin pointers that also run Claude-specific checks.
- The sandbox gets per-session generated files only: `.mcp.json` and `.claude/settings.json` for Claude when run by hand, and a Codex config snippet, all from `jev setup`. `sandbox/README.md` documents how to run plain `claude` or `codex` there by hand.
- The hyper-jev skill's `SKILL.md` and cookbook gain a short section on the `jev` command, `jev setup`, the hooks, and the MCP server as the ways to deliver a decision without writing code.

## Risks / Trade-offs

- [Stale `dist/` after editing the package] → `run.mjs` builds before every task that runs lab code, and `dev` watches. The package's own tests run on `src/`, and lab CI builds from clean.
- [Setup now needs `npm install` at the root, where the levels used to run with no install] → `/install`, `AGENTS.md`, and the README say so first; there are still no runtime dependencies, and TypeScript is dev-only.
- [`jev setup` corrupts a user's agent config] → It merges only its own marked entries, refuses to write invalid JSON it can't parse (it reports the problem instead), and has `--dry-run`; covered by fixture tests with existing settings.
- [The skill's copied core drifts] → The drift test runs in the package suite and CI; the fix is one `sync-skill` task.
- [The package API is not stable yet] → Stays unpublished in this change, and the version stays `0.x`. Extraction and publishing come later.
- [Codex hook events and payloads differ from Claude's, or don't cover apply_patch] → Task 1 spikes Codex hooks before building the codex adapter. The matrix records what's missing, and Levels 8–10 on Codex don't depend on it.
- [Claude stream-json interrupt or event shapes change between versions] → The driver tolerates unknown message types and logs them as `log`. A minimum Claude Code version is checked at start, and kill-and-resume is the abort fallback.
- [Level 7 under Claude and Codex teaches less than under pi] → Stated on the page and in the README. pi stays the reference harness for Level 7.
- [Account context reaches Claude sessions despite `--setting-sources ""` (the captures show the account email and a git status snapshot in context)] → The lab's isolation claim covers settings files, MCP servers, plugins, and the environment; the docs say account context still applies.
- [`--permission-mode bypassPermissions` lets the agent act freely] → It's confined to the throwaway sandbox copy with a minimal env, and the Level 6 hooks still run under bypass. The docs say this plainly.
- [Hook latency: a Jev call per Bash or Write adds about 300 ms] → Acceptable for the lab. Hooks time out and fail open.
- [fs.watch is unreliable on WSL and network drives] → A poll fallback reads by byte offset.
- [Windows `.cmd` quoting bugs] → Prompts go over stdin. Argv holds only fixed flags and paths, and those are covered by a Windows CI smoke test.
- [Large refactor of the extensions breaks pi while pi isn't installed here] → Extension behavior gets adapter-level tests with a fake `pi` object, comparing payloads to the neutral tools. A manual pi check is left as the last task.

## Migration Plan

1. Land the workspace and the package with the core moved, the lab and the skill starter consuming it, and the tests green.
2. Move the guards, compaction, file, and tool logic into the package with the event channel, and turn the pi extensions into adapters, keeping pi behavior identical.
3. Add `jev hook` (Claude Code first, then Codex) and `jev setup`, usable by hand.
4. Add `jev mcp`, then the general CLI (`ask`, `files`, `gate`, `guard`).
5. Do the cross-platform tooling and CI, including the tarball check.
6. Add the drivers behind `JEV_AGENT`. pi stays the default when installed. Then the matrix, UI, and docs.

Rollback: `JEV_AGENT=pi` restores today's path for the lab, and each step is a separate commit that can be reverted. Step 1 is reversible by restoring `src/core/` from git and dropping the workspace.

## Resolved in task 1

- Codex hooks: Claude Code's event names, payload fields, and response format; configured with `-c hooks.<Event>=[...]`; `apply_patch` is hookable. See `docs/NOTES-codex.md`.
- `codex exec --json` reports tokens only, cumulative per thread. No cost.
- Minimum Claude Code version: 2.1.302, where stream-json, the interrupt control request, and the hook responses were captured. See `docs/NOTES-claude.md`.
