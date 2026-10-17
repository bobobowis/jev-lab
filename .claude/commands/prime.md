---
description: Prime Claude with the 10 Levels of Jev codebase, a lab and terminal runner that teach agentic engineers Jev, TypeSafe AI's decision model, from one smart if statement to Jev inside a coding agent
---

# Purpose

Orient yourself in this repository: thirty tested Jev use cases arranged as ten levels. Levels 1 to 5 call Jev from plain code and run as one call in a Vue lab. Levels 6 to 10 put Jev inside the pi coding agent harness, hooks first then tools, and run as real pi sessions in a sandbox repo with an agent chat window. Plus a per level terminal runner and a portable skill that teaches an agent to build with Jev.

## Workflow

1. Run `git ls-files` to see the tracked tree. The app is `apps/ten-levels/`, `.claude/skills/hyper-jev/` is the skill (cookbook plus starter template) you hand an agent to build with Jev, and `images/` holds the video's diagrams the README uses.
2. Read `README.md` and the root `package.json` for the recipes, each an npm script over `scripts/run.mjs`: `npm run web` builds and serves the lab on 4399, `npm run dev` is Vite with hot reload on 5173 (needs `npm run web` running for the API, and shift reload only resets the landing page on 4399), `npm run level -- 1` through `npm run level -- 10` run one level in the terminal (add `a`, `b`, or `c` for one option), `npm test`, `npm run test:live`, `npm run heroes`, `npm run lint`.
3. Read `apps/ten-levels/README.md` for the ladder, the ten rules the code follows, mock versus live, and the paragraph on levels 6 to 10.
4. Read the core contract: `apps/ten-levels/src/core/types.ts` (wire types, validation, limits), `client.ts` (mock, OpenRouter, and TypeSafe backends, event stream), `helpers.ts` (noul, choice, score builders), `mock.ts` (offline stand in that decides by word overlap).
5. Read one code level end to end, `apps/ten-levels/src/levels/level02/`: one file per option (A, B, C) plus `index.ts`. Levels 1 to 5 follow that shape.
6. Read one agentic level end to end: `apps/ten-levels/src/levels/level07/` (the decision code: four questions, tiers, the cut point) and `apps/ten-levels/extensions/jev-compact.ts` (the pi extension that calls it from the turn end hook). Then skim `extensions/report.ts`, the side channel every extension reports on, and the other four extensions: `jev-guard.ts` (L6 tool call and tool result hooks), `ask-jev-file.ts` (L8, three flat tools), `ask-jev-files.ts` (L9, one call per file in parallel), `ask-jev.ts` (L10, one tool over state, paths, and a command).
7. Read `apps/ten-levels/server/scenarios.mjs` (the thirty options: file, input sets, call template, run for 1 to 5, extension and tool allowlist for 6 to 10), `server/server.mjs` (the API: `/api/level/:n`, `/api/run/:n` as SSE, `/api/agent/*` for pi sessions, static serving of `web/dist`), and `server/agent-session.mjs` (one pi RPC process per session in its own git initialized copy of `sandbox/`).
8. Skim `apps/ten-levels/sandbox/`: the small billing service the agents work in, with one failing test on purpose in `src/domain/billing.ts`, and `.pi/settings.json` for the low keep recent tokens that lets compaction happen in a short session.
9. Skim the Vue app in `apps/ten-levels/web/src/`: `views/LevelView.vue` and `components/LiveExample.vue` (use case cards, input sets, Sent and Received, answers with polarity aware confidence colors, cost table for 1 to 5), `components/AgentChat.vue` (the agent window for 6 to 10: rows, detail modal, Go and Stop, model, LLM and Jev cost, context in tokens, the files not read table), `components/RunVisual.vue` (the animated run modal, levels 1 to 5 only), `lib/hero-scenes.mjs` (hero drawings, also used by `scripts/build-heroes.mjs`), `lib/cost.ts` (model prices and o200k token counting), `lib/highlight.ts` (TypeScript and JSON highlighting), `styles.css` (the dark glass theme, 18px floor, no em dashes).
10. Skim `apps/ten-levels/src/level.ts` (the terminal runner behind `npm run level`, canned states for 6 to 10) and `apps/ten-levels/tests/` (201 offline tests on the mock, 10 live tests against real Jev).
11. Summarize your understanding of the project: purpose, stack, structure, key files, and entry points.
