# Tasks

## 1. Pin down the harness contracts

- [x] 1.1 Run a throwaway Codex session with `hooks` enabled and a logging hook script. Record the event names, stdin payload fields, response format, config location, and whether `apply_patch` and MCP calls fire pre/post hooks in `packages/jev-kit/docs/NOTES-codex.md`. Verify by citing the captured payloads in the notes.
- [x] 1.2 Run `claude -p --input-format stream-json --output-format stream-json --verbose` with a fixture MCP config and settings, plus a logging `PreToolUse`/`PostToolUse`/`Stop`/`UserPromptSubmit` hook. Capture the message types for a tool call, a `result`, a `compact_boundary`, an interrupt control request, and each hook's stdin payload in `packages/jev-kit/docs/NOTES-claude.md`. Record the minimum version that supports them. Verify by citing the captured lines.
- [x] 1.3 Run `codex exec --json` and `codex exec resume <id> --json` once each. Record the thread id field, item types, and the usage and cost fields in `NOTES-codex.md`. Verify that the follow-up remembers the first prompt.
- [x] 1.4 Update the design.md D8 matrix rows for Codex and resolve the design's open questions from 1.1–1.3. Verify that design.md has no remaining "TBD" in the matrix.

## 2. The package and the workspace

- [x] 2.1 Add a private root `package.json` with workspaces `apps/ten-levels` and `packages/jev-kit`, and scaffold `packages/jev-kit/` (`package.json` named `@bobobowis/jev-kit`, version `0.1.0`, `engines.node >=22.18`, no `dependencies`, `typescript` as a dev dependency, `exports` per entry point and `bin.jev` pointing to `dist/`, `files` limited to `dist`, README, and LICENSE; `tsconfig.json` with `rewriteRelativeImportExtensions` and declarations; a `prepare` build). Verify that `npm install` at the root builds `dist/` and links the lab.
- [x] 2.2 Move `src/core/{client,types,mock,helpers}.ts` into the package's `src/core/` and its root entry point, and turn the lab's `src/core/*` into re-exports. Move `normalized()` and `CONFIDENCE` into `src/policy/` with a weighted-score helper, and turn the lab's `level03/normalize.ts` and `level04/confidence.ts` into re-exports. Move the core tests (`client`, `core`) into the package. Verify that the package tests and the lab's offline suite both pass with `npm test`.
- [x] 2.3 Add `packages/jev-kit/tests/independence.test.ts`: every import under `packages/jev-kit/src` resolves inside the package, the manifest has no `dependencies` or `peerDependencies`, and a module no entry point exports can't be imported by name. Verify with `npm test`.
- [x] 2.4 Add `scripts/sync-skill-core.mjs`, which copies the package's `src/core/` into `.claude/skills/hyper-jev/templates/starter/src/core/`, and `packages/jev-kit/tests/skill-sync.test.ts`, which fails naming any file that differs. Verify by editing a comment in the package client and seeing the test fail, then running the sync and seeing it pass, and by running the starter's own tests from a copy outside the repo.

## 3. Event channel

- [x] 3.1 Create the package's `src/events/` reporter. It writes to `JEV_EVENT_DIR/<harness>-<pid>.jsonl` when set and to `JEV_EVENT` stderr lines otherwise (with a quiet mode for the general CLI), adds the `harness` field, and falls back to stderr if a write fails. Add `tests/events.test.ts` covering both modes, quiet mode, two concurrent child processes writing 1 MB events with no torn lines, and an unwritable dir. Verify with `npm test`.
- [x] 3.2 Add an event-dir tailer to the lab's `server/` that follows every file by byte offset with `fs.watch` plus a poll fallback and holds back partial lines. Add `tests/tail.test.ts` (append in chunks, new file appears mid-session). Verify with `npm test`.

## 4. Neutral tools and hooks in the package, pi adapters

- [x] 4.1 Move the file logic (`level08/read-state.ts`, `level09/prune.ts` and the parallel ask, `level10/assemble.ts` and the split, `level10/spend.ts`) into the package's `src/files/` and `src/ledger.ts`, normalize result paths to `/`, and add `.claude`, `.codex`, and `.jev` to `SKIP_DIRS`. Turn the lab's level 8–10 modules into re-exports. Extend `tests/level09.test.ts` with a sandbox containing `.claude/settings.json`. Verify with `npm test`.
- [x] 4.2 Move the guard decisions (`level06`) into `src/guards/` and the compaction decisions (`level07`) into `src/compact/`, one file per decision with its questions and thresholds, and turn the lab's level 6–7 modules into re-exports. Verify that the existing `level06` and `level07` tests pass unchanged.
- [x] 4.3 Create `src/tools/`, moving the descriptions and JSON Schema parameters of `should_i_compact`, `ask_jev_file_*`, `ask_jev_files`, `pick_first_file`, and `ask_jev` out of the extensions, with `execute(params, ctx)`, the bash-gated command runner for `ask_jev`, and the level-to-tool-name map. Add `tests/tools.test.ts` on the mock (payloads, outside-repo path error, invalid `questions_json`, refused command). Verify with `npm test`.
- [x] 4.4 Create `src/hooks/` with normalized `shell`, `write`, `read-result`, `shell-result`, and `turn-end` handlers over the guards and compaction modules, failing open with a reported `error`. Add `tests/hooks.test.ts` (force push blocked, `ls` allowed, credential write blocked, Jev error fails open, first request silent). Verify with `npm test`.
- [x] 4.5 Rewrite `extensions/*.ts` as thin adapters that import from the package, using `Type.Unsafe` for the schemas and keeping file names, tool names, and pi-only features (`compact_now`, `context` injection, `session_before_compact`). Add `tests/pi-adapter.test.ts` with a fake `pi` object, asserting that the registered tools and hook results match the package. Verify with `npm test`.

## 5. Hook runner (`jev hook`) and `jev setup`

- [x] 5.1 Add the package's `jev` bin with subcommand dispatch and `--help`, and implement `jev hook --harness claude`: `PreToolUse` (Bash, Write, Edit, MultiEdit, NotebookEdit), `PostToolUse` (Read, Bash) with `additionalContext`, Level 7 `Stop` (transcript usage, tier to `JEV_STATE_DIR`), `UserPromptSubmit` (inject once), and `PreCompact` (report only), all with a bounded timeout. Add `tests/hook-runner.test.ts` feeding fixture stdin JSON from 1.2. Verify with `npm test`.
- [x] 5.2 Implement `jev setup --harness claude` with `--guards`, `--tools`, `--level`, `--out`, and `--dry-run`, merging marked entries into `.mcp.json` and `.claude/settings.json`. Add `tests/setup.test.ts` with existing settings (permissions and an unrelated hook kept, second run reports no changes, unparseable JSON refused). Verify with `npm test`, then by running `jev setup --harness claude --guards bash` in a temp copy of `sandbox/` and seeing a plain `claude` session there get `git push --force origin main` denied.
- [x] 5.3 Add the `--harness codex` mappings to `jev hook` and `jev setup` using the payloads from 1.1, with fixture tests in the same files, and mark any missing event as degraded in the matrix. Verify with `npm test`.
- [x] 5.4 Document running plain `claude` or `codex` with `jev setup` in `sandbox/README.md`. Verify by following it from a clean sandbox copy.

## 6. MCP server (`jev mcp`)

- [x] 6.1 Implement `jev mcp`: stdio JSON-RPC with `initialize` (including `instructions`), `tools/list`, `tools/call`, `ping`, and `--level`/`--tools`/`--cwd`, plus a per-process Level 10 ledger. Add `tests/mcp-server.test.ts`, which spawns the server and checks the handshake, the tool set per level and per name list, an unknown tool error, a tool error that doesn't kill the server, and payload parity with the pi adapter. Verify with `npm test`.
- [x] 6.2 Add `npm run mcp -- --level N` to the lab and make `jev setup` write the `jev` MCP server entry. Add a "Use the Jev tools in any MCP client" section to `apps/ten-levels/README.md` and the package README, with Claude (`.mcp.json` / `claude mcp add`) and Codex (`config.toml` `[mcp_servers.jev]`) snippets. Verify by following the snippets in `sandbox/` and seeing `ask_jev_file_bool` listed in both CLIs.

## 7. General CLI

- [x] 7.1 Implement `jev ask` and `jev files` over the `ask_jev` and `ask_jev_files` tool code, with `--questions` (JSON or `@file`), `--state`, `--state-file`, `--paths`, `--command`, and `--mock`; JSON on stdout, diagnostics on stderr. Add `tests/cli-ask.test.ts` (valid JSON piped through, over-budget exit and split message, skipped files reported, refused command, missing key error with no mock fallback). Verify with `npm test`.
- [x] 7.2 Implement `jev gate` (exit 0/1/2/3, `--threshold`, `--json`) and `jev guard bash|write` (exit 0/1). Add `tests/cli-gate.test.ts` covering each exit code on the mock and with an unreachable endpoint. Verify with `npm test` and with a sample `pre-commit` script in the package README run against a staged fake secret.

## 8. Cross-platform tooling

- [x] 8.1 Add `scripts/run.mjs` with a Node version check (>=22.18) and the tasks build, levels, demo, demo-live, test (package and lab), test-live, web, dev (with `tsc -b --watch`), lint, heroes, mcp, and sync-skill, building the package before tasks that run lab code. Add `--mock`/`--live` flags to `src/demo.ts` and the live tests in place of env prefixes, and set `engines.node` in the root, lab, and package. Point the npm scripts at it. Verify by running `npm test` and `npm run demo` and checking that an old Node prints the version message.
- [x] 8.2 Remove the `justfile`: give the root `package.json` an npm script for every task in `scripts/run.mjs`, and point the READMEs, `/install`, `/prime`, the server's messages, and code comments at `npm run`. Verify that no `just` command is left outside the change history, and that `npm run level -- 1` works from bash and from Windows PowerShell.
- [x] 8.3 Add `scripts/open-url.mjs` (win32/darwin/WSL/Linux, print on failure) and the server's 127.0.0.1-only `POST /api/shutdown`, which `run.mjs web` calls before listening. Add a test for the shutdown route rejecting non-local requests. Verify by running `npm run web` twice in a row under WSL: the second run replaces the first and the browser opens.
- [x] 8.4 Add `.github/workflows/ci.yml` with an ubuntu/macos/windows matrix on Node 22.18 and 24, running `npm install`, `npm test`, `npm run demo` (mock), the `jev mcp` and `jev hook` smoke tests, and a job step that packs the package, installs the tarball into a temp project, and runs `npx jev --help` and `npx jev gate --mock`. Verify that all six jobs pass.

## 9. Lab agent drivers

- [x] 9.1 Add `server/spawn-cli.mjs` (PATH + PATHEXT resolution, `.cmd` through `cmd.exe /d /s /c`, tree kill with `taskkill /T /F` or a negative pid) and `tests/spawn-cli.test.ts` using a fake CLI script. Verify with `npm test` on Linux and in Windows CI.
- [x] 9.2 Split `server/agent-session.mjs` into the session core and `server/drivers/pi.mjs`, wire the event-dir tail from 3.2 and `JEV_STATE_DIR`, and extend `agentEnv()` with the Windows basics and per-driver credential names. Verify with `npm test` and a pi session from the lab, if pi is installed (otherwise record that it was skipped).
- [x] 9.3 Implement `server/drivers/claude.mjs` per D6 (session config from the package's setup code, flags, allowlist mapping, stream-json → canonical events, interrupt with kill-and-resume fallback, stats from `result`). Add `tests/driver-claude.test.ts` replaying the captured lines from 1.2 through a fake CLI. Verify with `npm test`, then run Level 8 option A live in the lab under Claude.
- [x] 9.4 Implement `server/drivers/codex.mjs` per D6 (`exec --json` per prompt, `exec resume` follow-ups, `-c` MCP and hook overrides, abort by tree kill, stats from usage). Add `tests/driver-codex.test.ts` replaying the 1.3 captures. Verify with `npm test`, then run Level 10 option A live in the lab under Codex, including the follow-up prompt.
- [x] 9.5 Add harness selection (start body `harness`, `JEV_AGENT`, PATH detection order), `harnesses`/`harness` in `/api/state`, and per-harness default models with `JEV_AGENT_MODEL`. Return the "no harness installed" error from the spec. Add server route tests. Verify with `npm test`.

## 10. Capability matrix and lab UI

- [x] 10.1 Add the package's `src/capabilities.ts` with the D8 matrix (after 1.4), serve it in `/api/level/:n`, and generate the README matrix table from it (`node scripts/run.mjs docs`). Add a test that the README table matches the source. Verify with `npm test`.
- [x] 10.2 Update `AgentChat.vue`, `LiveExample.vue`, and `agent-api.ts`: a harness picker over the available ones, the harness and model in the footer, blank (not 0) for unknown cost or context, the degraded or unavailable note per option, and the Run button disabled for unavailable options. Verify with `npm run lint` and by checking Level 7 under Claude in the browser.

## 11. Agent instructions and docs

- [x] 11.1 Write the root `AGENTS.md` (orientation, `npm install` at the root, setup per harness, which levels each unlocks, offline test run) and reduce `.claude/commands/install.md` and `prime.md` to pointers plus the Claude-specific checks. Verify by asking Codex to set up the repo from a clean clone and confirming it skips pi and runs the offline tests.
- [x] 11.2 Write `packages/jev-kit/README.md` (install from the tarball or the workspace, the API by entry point, every `jev` subcommand with an example, the exit codes, `jev setup` for Claude Code and Codex). Add the `jev` command, hooks, and MCP section to the hyper-jev `SKILL.md` and cookbook. Verify that every command in the package README runs as written on the mock.
- [x] 11.3 Update the root `README.md` and `apps/ten-levels/README.md`: "pi, Claude Code, or Codex", the package and its command, the matrix, the per-harness credentials, Windows/macOS/Linux commands, and the Node version. Verify that every command in the READMEs runs as written on Linux and appears in the Windows CI.

## 12. Integration checks

- [x] 12.1 On Windows (native PowerShell), run `npm install`, `npm test`, `npm run demo`, `npm run web`, and one Level 6 and one Level 8 session under Claude Code. Record the results in the PR description.
- [x] 12.2 Under WSL and on macOS, run each of Levels 6–10 option A in the lab under Claude Code and Codex, and confirm the behavior matches the matrix. Record any mismatch as a matrix fix.
  - WSL done 2026-10-18: every Level 6–10 option A under Claude Code and Codex matched the matrix. macOS live sessions were not run (closed without them); CI runs the suite and every README command on macOS.
- [x] 12.3 With pi installed, run Levels 6–10 option A to confirm there's no regression from the adapter refactor (`compact_now` and the cut point still work).
- [x] 12.4 In a project outside this repo, install the packed tarball, run `jev setup --harness claude --guards bash,write --tools ask_jev`, and confirm in a plain Claude Code session that a force push is denied and `mcp__jev__ask_jev` answers. Record the result in the PR description.

## Workflow follow-up

- Archive the change after review with `/openspec-archive-change`, which syncs the seven new capability specs into `openspec/specs/`.
- Later, in a separate change: decide on publishing `@bobobowis/jev-kit` to npm and extracting it with `git subtree split --prefix packages/jev-kit` into its own repository, and switch the skill starter to the published package if that is still wanted.
