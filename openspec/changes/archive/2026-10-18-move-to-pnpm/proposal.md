# Proposal

## Why

The repo ran on two package managers: npm workspaces with `package-lock.json` for the package and the lab, and bun with its own `bun.lock` for the Vue app, which was outside the workspace and needed a second install step. That is two tools to install, two lockfiles to keep in step, and a setup path that differs from the one every other command uses. One package manager, one install, and one lockfile is simpler for users and for CI.

## What Changes

- **BREAKING**: pnpm replaces npm and bun. Every recipe is a `pnpm run` script at the repo root; `npm run …` and `bun install` are no longer documented or tested.
- One pnpm workspace (`pnpm-workspace.yaml`) holds `packages/jev-kit`, `apps/ten-levels`, and `apps/ten-levels/web`, with a single `pnpm-lock.yaml`. `package-lock.json` and `bun.lock` are removed. The root pins pnpm with `packageManager`, and the lab depends on the package with `workspace:*`.
- `scripts/run.mjs` starts vite and oxlint through node by their `package.json` bin instead of through bun, so Windows needs no `.cmd` shims, and drops a leading `--` that pnpm passes through to scripts.
- CI installs pnpm with `pnpm/action-setup`, installs with `--frozen-lockfile`, packs with `pnpm --filter @bobobowis/jev-kit pack`, and checks the tarball in an empty project with `pnpm add` and `pnpm exec jev`.
- Docs, the sandbox, the level examples and agent prompts, the agent install hints (`pnpm add -g`, with a `pnpm setup` note), the hyper-jev starter, and the Level 6 and Level 10 diagrams say pnpm.
- Out of scope: publishing the package to the npm registry.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `cross-platform-tooling`: pnpm becomes the only package manager and task runner, the repo is one pnpm workspace with one lockfile, and the scripts accept arguments with or without a leading `--`.

## Impact

- Root `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/ten-levels/package.json`, `scripts/run.mjs`, `.github/workflows/ci.yml`.
- `AGENTS.md`, the READMEs, `.claude/commands/install.md`, `.env.sample`, the hyper-jev cookbook and starter.
- The sandbox README, `server/scenarios.mjs`, the agent install hints in `server/drivers/`, `src/level.ts`, `src/demo.ts`, and the tests that carry those strings.
- `images/08_level_06_bash_gate.png`, `images/13_level_10_agentic_jev.png`.
