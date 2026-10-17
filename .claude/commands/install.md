---
description: Install 10 Levels of Jev — prerequisites, the web dependencies, the OpenRouter key, pi for the agentic levels, and a first offline test run
---

# Install 10 Levels of Jev

## Purpose

Set up the 10 Levels of Jev lab for development. Checks the toolchain (Node 22.18+, bun, pi), installs the workspace and the Vue lab's dependencies, confirms the Jev credential without displaying it, verifies the sandbox and the pi settings the agentic levels depend on, and runs the offline suite. This is an interactive, agentic process — ask the user when choices are needed.

## Variables

SOURCE_REPO: The directory this command is running from
APP_DIR: `apps/ten-levels`
WEB_DIR: `apps/ten-levels/web`
SANDBOX_DIR: `apps/ten-levels/sandbox`
EXTENSIONS_DIR: `apps/ten-levels/extensions`
ENV_FILE: `.env` at the repo root (loaded by `scripts/run.mjs`)
ENV_SAMPLE: `.env.sample`

## Codebase Structure

```
apps/ten-levels/
├── src/core/          # the Jev wire contract and client (mock, OpenRouter, TypeSafe)
├── src/levels/        # level01 .. level10, one file per option
├── extensions/        # pi extensions for levels 6 to 10, plus report.ts
├── sandbox/           # the repo the agents work in; .pi/settings.json sets keepRecentTokens
├── server/            # the API and the pi session manager, node:http only
├── web/               # the Vue lab; bun installs its dependencies
└── tests/             # 201 offline tests on the mock, 10 live tests
package.json           # every recipe as an npm script over scripts/run.mjs; loads .env
```

## Instructions

- Run every check via Bash — do not assume anything is installed.
- Show a status line immediately after each check (pass or fail).
- For auto-installable items (the web dependencies), install without asking.
- For items requiring user input (the API key), ask the user with sensible defaults.
- Do NOT read or display API key values — only confirm they are set.
- Never start `npm run web` or `npm run dev` from this command; only verify readiness.
- The app itself has zero runtime dependencies. `npm install` at the root links the workspace and builds `packages/jev-kit`; `web/` needs `bun install`.
- Levels 1 to 5 work offline on the mock. Levels 6 to 10 need both `pi` and an OpenRouter key; if either is missing, say so and continue, the rest of the lab still works.

## Workflow

### Step 1 — Check Prerequisites

Gate on the first one; stop and guide the user if it is missing.

1. **Node 22.18 or later**: `command -v node && node --version`. The levels run as TypeScript natively, which needs Node 22.18 or later, and 24 is recommended. Missing or older: install from https://nodejs.org or `nvm install 24`.
2. **npm**: `npm --version`. It ships with Node and runs every recipe.

Then the standard tools:

3. **bun**: `command -v bun`. Builds and serves the Vue lab. Missing: `curl -fsSL https://bun.sh/install | bash`.
4. **git**: `command -v git`. Each agent session initializes a git copy of the sandbox so `git diff` works inside it.
5. **pi 0.85.1 or later**: `command -v pi && pi --version`. Runs levels 6 to 10. Missing: `npm install -g @earendil-works/pi-coding-agent`, docs at https://github.com/earendil-works/pi-mono. Not a gate; report it and continue.

### Step 2 — Check Environment

6. Check whether `OPENROUTER_API_KEY` is set in the shell or in `ENV_FILE`: `grep -q '^OPENROUTER_API_KEY=' .env 2>/dev/null || [ -n "$OPENROUTER_API_KEY" ]`. Report set or not set, never the value.
7. If not set, ask the user whether they have an OpenRouter key (https://openrouter.ai/keys). If yes, ask them to paste it into `ENV_FILE` themselves, or copy `ENV_SAMPLE` to `ENV_FILE` for them and tell them which line to fill. If no, say that levels 1 to 5 run offline on the mock and levels 6 to 10 stay unavailable until a key exists.
8. Optionally note `TYPESAFE_API_KEY` (direct TypeSafe backend, takes precedence over OpenRouter) and `JEV_AGENT_MODEL` (the pi model for levels 6 to 10, default `openrouter/google/gemini-3.8-flash`). Do not ask for them.

### Step 3 — Install Dependencies

9. Run `npm install` at the repo root (links the workspace, builds `packages/jev-kit`), then `cd WEB_DIR && bun install`. Report the count of packages from bun's output.

### Step 4 — Verify Configuration

10. `SANDBOX_DIR/.pi/settings.json` exists and contains `keepRecentTokens`. Without it Level 7's compaction never has material.
11. `EXTENSIONS_DIR` contains six files: `report.ts`, `jev-guard.ts`, `jev-compact.ts`, `ask-jev-file.ts`, `ask-jev-files.ts`, `ask-jev.ts`. List any missing.
12. `SANDBOX_DIR/src/domain/billing.ts` contains `Math.floor` on the prorate line. That is the failing test on purpose; if it reads `Math.round` someone fixed the pristine sandbox and levels 7, 9, and 10 lose their bug. Report it, do not change it.
13. `apps/ten-levels/web/public/heroes/` contains ten `level-N.svg` files; if not, note that `npm run heroes` regenerates them.

### Step 5 — Verify Readiness

14. Run `npm test` from the repo root. It runs the package's tests, then the lab's; expect 0 failures and 10 live tests skipped, and report the pass counts. This uses the mock and needs no key.
15. Run `cd SANDBOX_DIR && npm test` and expect exactly one failure, the proration test. Report pass and fail counts.
16. Confirm `npm run` lists `web`, `dev`, `level`, `test`, `test:live`, `demo`, `heroes`, `lint`, `mcp`. Do not run `web` or `dev`.
17. If pi is installed, run `pi --version` once more and confirm it prints 0.85.1 or later.

### Step 6 — Report

Show a status table with one row per check above, pass or fail, and one line per item that needs the user's action. Then the ready count, for example `16 of 17 ready`.

Next steps, as commands the user can paste:

```bash
npm run web            # build and serve the lab on http://127.0.0.1:4399, opens the browser
npm run level -- 1     # one level in the terminal, 1 through 10; add a, b, or c for one option (npm run level -- 4 b)
npm run test:live      # 10 live tests against real Jev, needs OPENROUTER_API_KEY
npm run demo           # every level, every option, on the mock
```

If pi or the key is missing, say which levels are unavailable and what to install to unlock them.
