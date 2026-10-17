---
description: Prime Claude with the 10 Levels of Jev codebase by reading AGENTS.md and the key files it points to
---

# Purpose

Orient yourself in this repository: thirty tested Jev use cases arranged as ten levels, a lab that
runs them, the `@bobobowis/jev-kit` package they are built on, and a skill that teaches an agent to
build with Jev.

## Workflow

1. Read `AGENTS.md`: the layout, setup, which agent unlocks which levels, the commands, the conventions.
2. Run `git ls-files` for the tracked tree.
3. Read `README.md` for the ladder and the "Which harness runs what" table, and `packages/jev-kit/README.md` for the package, the `jev` command, hooks, and MCP.
4. Read the core: `packages/jev-kit/src/core/types.ts`, `client.ts`, `helpers.ts`, `mock.ts`. The lab's `apps/ten-levels/src/core/` re-exports it.
5. Read one code level end to end, `apps/ten-levels/src/levels/level02/`, and one agent level: `level07/` with `packages/jev-kit/src/compact/` and `packages/jev-kit/src/hooks/`.
6. Read how agent sessions run: `apps/ten-levels/server/agent-session.mjs` (the sandbox copy and event stream every harness shares) and `server/drivers/` (`pi.mjs`, `claude.mjs`, `codex.mjs`, `selection.mjs`).
7. Skim `apps/ten-levels/server/scenarios.mjs` (the thirty options) and `web/src/components/AgentChat.vue` and `LiveExample.vue` (the agent window and the harness picker).
8. Claude Code specifics: `packages/jev-kit/docs/NOTES-claude.md` is the stream-json and hook contract the Claude driver relies on, and `.claude/skills/hyper-jev/SKILL.md` is the skill.
9. Summarize the project: purpose, stack, structure, key files, and entry points.
