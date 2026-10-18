# AGENTS.md

Orientation and setup for any coding agent working in this repo: Claude Code, Codex, pi, or another.
Claude Code's `/install` and `/prime` point here and add a few Claude-specific checks.

## What this is

Ten levels of [Jev](https://typesafe.ai), TypeSafe AI's System One decision model: a state and typed
questions in, typed answers with probabilities out, in about 300 ms. Levels 1 to 5 call Jev from
code. Levels 6 to 10 put Jev inside a coding agent: hooks first (6 and 7), then tools the agent
calls (8 to 10).

```
packages/jev-kit/    @bobobowis/jev-kit: the client, guards, file reads, agent tools, hooks, MCP server, and the `jev` command
apps/ten-levels/     the lab: levels in src/levels/, the API and agent drivers in server/, the Vue app in web/, the sandbox repo in sandbox/
scripts/run.mjs      every task, behind the npm scripts in the root package.json
.claude/skills/hyper-jev/   a skill that teaches an agent to build with Jev (its src/core is synced from the package)
openspec/            specs and changes
```

Start reading at `packages/jev-kit/src/core/` (the wire types and the client), one code level such
as `apps/ten-levels/src/levels/level02/`, and one agent level such as `level07/` with
`apps/ten-levels/server/drivers/`.

## Setup

1. **Node 22.18 or later** (24 recommended): `node --version`. The levels run as TypeScript natively.
2. **Install at the root:** `npm install`. It links the workspace and builds `packages/jev-kit`.
   Nothing is installed at runtime; TypeScript is dev-only.
3. **The Vue lab's dependencies**, only for `npm run web` and `npm run dev`:
   `cd apps/ten-levels/web && bun install` ([bun](https://bun.sh)).
4. **A Jev key** for live runs: `OPENROUTER_API_KEY` (or `TYPESAFE_API_KEY`, which takes
   precedence) in the shell or in a root `.env` (copy `.env.sample`). Never print its value; check
   only that it is set.
5. **Offline tests:** `npm test`. The package's tests, then the lab's, on the deterministic mock,
   with no key and no network. Expect 0 failures and 10 live tests skipped.

`cd apps/ten-levels/sandbox && npm test` should fail exactly one test, the proration test. That
bug is on purpose; do not fix it in the pristine sandbox.

## Which agent unlocks what

Levels 1 to 5 need no agent. Levels 6 to 10 run in the lab under whichever of these is installed
(the lab's picker, `JEV_AGENT`, or the first on PATH in this order):

| Harness | Install | Credentials | Default model |
|---|---|---|---|
| pi 0.85.1+ | `npm install -g @earendil-works/pi-coding-agent` | `OPENROUTER_API_KEY` for the default model, or the key of the provider in `JEV_AGENT_MODEL` | `openrouter/google/gemini-3.8-flash` |
| Claude Code 2.1.302+ | `npm install -g @anthropic-ai/claude-code` | your `claude` login, or `ANTHROPIC_API_KEY` | `claude-haiku-5-5` |
| Codex 0.162+ | `npm install -g @openai/codex` | your `codex login`, or `OPENAI_API_KEY` | the account default |

`JEV_AGENT_MODEL` overrides the model. pi is the reference harness: everything runs there. Under
Claude Code and Codex, Level 6 C and Level 7 are degraded and Level 7 C is unavailable; the table
in `README.md` ("Which harness runs what") is generated from `packages/jev-kit/src/capabilities.ts`.
Do not install an agent the user didn't ask for; report which levels are unavailable and continue.

The lab never reads or writes your own agent config. Each session gets a throwaway copy of the
sandbox with its own settings, hooks, and MCP entry.

## Commands

```bash
npm test                 # offline: package, then lab
npm run test:live        # 10 live tests against real Jev (needs a key)
npm run level -- 4 b     # one level (1 to 10), optionally one option, in the terminal
npm run demo             # every level and option on the mock
npm run web              # build the lab and open http://127.0.0.1:4399 (stops an older lab on the port first)
npm run dev              # Vite with hot reload on 5173; needs npm run web running for the API
npm run lint             # oxlint over the Vue app
npm run docs             # regenerate the README capability tables
npm run sync-skill       # copy the package core into the hyper-jev starter
npm run mcp -- --level 8 # the Jev tools over stdio MCP
```

npm is the only task runner, and every command above works the same on Windows, macOS, and Linux.
On Windows PowerShell with scripts disabled, `npm` fails with an execution policy error: use
`npm.cmd`, or ask the user before running `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

## Using Jev from your own harness

`jev setup --harness claude|codex --guards bash,write --tools ask_jev` writes the hooks and the MCP
entry into a project's agent config, merging with what is there. See `packages/jev-kit/README.md`.

## Conventions

- Zero runtime dependencies in the package and the lab server. Node built-ins only.
- The package imports nothing from outside `packages/jev-kit/` (a test enforces it).
- Without a key, calls fail with an error; nothing falls back to the mock silently. Tests inject
  the mock or a fake client.
- Hooks fail open and never exit 2.
- After editing `packages/jev-kit/src/core/`, run `npm run sync-skill`; after editing
  `capabilities.ts`, run `npm run docs`. Tests fail until you do.
- Keep tests offline and fast; live checks go in `tests/live.test.ts` behind `JEV_LIVE=1`.
