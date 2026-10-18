# cross-platform-tooling Specification

## Purpose

Makes every way of running, testing, and setting up the lab work the same on Windows, macOS, and Linux (including WSL), from whichever coding agent or plain terminal the user prefers.

## Requirements

### Requirement: Every command runs on all three OSes
Every documented command (the `pnpm run` scripts for the levels, demo, tests, web, dev, lint, heroes, and the MCP server) SHALL run on Windows (PowerShell or cmd), macOS, and Linux without requiring zsh, bash, `lsof`, `xargs`, `open`, or inline `VAR=value` prefixes.

#### Scenario: Offline tests on Windows
- **WHEN** a user on Windows runs `pnpm test` in `apps/ten-levels`
- **THEN** the offline suite runs and passes with the mock backend

#### Scenario: Fresh clone setup
- **WHEN** a user on any of the three OSes runs `pnpm install` at the repo root of a fresh clone
- **THEN** the workspace links the lab to the package, installs the Vue app's dependencies, and builds the package, and `pnpm test` then passes

#### Scenario: Mock demo on Windows
- **WHEN** a user on Windows runs `pnpm run demo`
- **THEN** every level runs on the mock backend, as on macOS and Linux

### Requirement: pnpm is the only task runner
Every recipe SHALL be a `pnpm run` script at the repo root, and the repo SHALL NOT need npm, bun, `just`, `make`, or any other package manager or task runner. The scripts SHALL behave the same whether run from the repo root or from `apps/ten-levels`, and SHALL accept their arguments with or without a leading `--`.

#### Scenario: A machine with Node and nothing else
- **WHEN** a user with only Node, pnpm, and git runs `pnpm run level 4 b`, `pnpm run demo`, `pnpm test`, and `pnpm run web`
- **THEN** each runs, with no other tool to install

#### Scenario: npm-style arguments
- **WHEN** a user runs `pnpm run level -- 4 b`
- **THEN** it runs Level 4 B, the same as `pnpm run level 4 b`

### Requirement: Web lab starts cleanly anywhere
Starting the web lab SHALL build the app, free the port if a previous lab holds it, serve on 127.0.0.1:4399 (or `PORT`), and open the default browser using the platform's mechanism, including WSL. Failing to open a browser SHALL only print the URL.

#### Scenario: WSL
- **WHEN** `pnpm run web` runs under WSL
- **THEN** the lab is served and opened in the Windows browser, or the URL is printed if no opener is found

### Requirement: Paths are OS-neutral
Path handling in levels, tools, and the server SHALL work with either separator on input, SHALL show forward slashes in output, and SHALL treat any harness or Jev state directory (`.pi`, `.claude`, `.codex`, `.jev`) as skipped when scanning files.

#### Scenario: Glob skips agent config
- **WHEN** Level 9 expands `**/*` in a sandbox copy that contains `.claude/settings.json`
- **THEN** that file is not sent to Jev

#### Scenario: Agent config named explicitly
- **WHEN** a tool is given `.claude/settings.json`, or a glob that reaches into `.codex/` or `.jev/`
- **THEN** each matching file is reported as skipped with the reason, and not sent to Jev

### Requirement: Agent CLIs are launched portably
The lab SHALL locate and launch the selected agent CLI on every OS, including Windows command shims (`.cmd`), and SHALL stop it, including its child processes, on close.

#### Scenario: Windows shim
- **WHEN** `claude` is installed through npm or pnpm on Windows
- **THEN** the lab starts it and closing the session leaves no orphaned agent process

### Requirement: Setup works from any agent
The repo SHALL give setup and orientation instructions every supported agent picks up: Claude Code commands (`/install`, `/prime`) and an `AGENTS.md` for Codex and others, both checking only for the harness the user picks and reporting which levels each harness unlocks.

#### Scenario: Codex user installs
- **WHEN** a Codex user asks Codex to set up the repo
- **THEN** Codex follows `AGENTS.md`, checks Node, the Jev key, and Codex itself, skips pi, and runs the offline tests

#### Scenario: Missing harness is not a gate
- **WHEN** no agent CLI is installed
- **THEN** setup still completes for Levels 1 to 5 and says what to install for Levels 6 to 10

### Requirement: Node version stated once and enforced
The required Node version SHALL be the one that runs the TypeScript sources natively, stated in `engines` and in the docs, and the scripts SHALL fail with a clear message on an older Node.

#### Scenario: Old Node
- **WHEN** a user runs `pnpm test` on a Node version that cannot strip types
- **THEN** the run stops with a message naming the required version

### Requirement: One workspace, one lockfile
The package, the lab, and the Vue app SHALL be one pnpm workspace with a single committed `pnpm-lock.yaml`, and the root SHALL pin the pnpm version in `packageManager`. The lab SHALL depend on the package through the workspace, never the registry. The Vue app's tools SHALL run through node, not through a package manager's command shims.

#### Scenario: Frozen install
- **WHEN** CI runs `pnpm install --frozen-lockfile` on a fresh clone
- **THEN** it installs every workspace project from the one lockfile, or fails if the lockfile is out of date

#### Scenario: Lab uses the local package
- **WHEN** the workspace is installed
- **THEN** the lab's `@bobobowis/jev-kit` resolves to `packages/jev-kit`
