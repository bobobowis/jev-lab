// UserPromptSubmit: Jev picks which part of the repo the request is about and the hook adds where
// to start reading and the rules that part carries. Unclear or general prompts add nothing.
import { ask, main } from "./lib.mjs";

const AREAS = {
  core: ["The Jev client and wire types", "Start at packages/jev-kit/src/core/. After editing it, run `pnpm run sync-skill`; tests fail until you do."],
  guards: ["Guards, hooks, setup, or the jev command", "Start at packages/jev-kit/src/guards/, hooks/, setup/, cli/. Hooks fail open and never exit 2. Contracts: packages/jev-kit/docs/NOTES-claude.md and NOTES-codex.md."],
  tools: ["The agent tools, file reads, or the MCP server", "Start at packages/jev-kit/src/tools/, files/, mcp/. If support per harness changes, edit capabilities.ts and run `pnpm run docs`."],
  levels: ["One of the ten levels", "Levels live in apps/ten-levels/src/levels/levelNN/. Levels 6 to 10 run through apps/ten-levels/server/drivers/."],
  lab: ["The lab server, agent drivers, or the Vue app", "Server: apps/ten-levels/server/ (Node built-ins only). Vue: apps/ten-levels/web/ (`pnpm run lint`, `pnpm run dev`)."],
  sandbox: ["The sandbox repo the agents work in", "apps/ten-levels/sandbox/: its proration test fails on purpose. Do not fix it in the pristine sandbox."],
  other: ["Something else, or the whole repo", null],
};

main((p) => {
  const prompt = (p.prompt ?? "").trim();
  if (prompt.length < 15 || prompt.startsWith("/")) return null;

  const answers = ask({
    area: {
      type: "choice",
      instructions: "Which part of this repository is the request in prompt about?",
      criteria: Object.fromEntries(Object.entries(AREAS).map(([k, [d]]) => [k, d])),
    },
  }, { state: { prompt }, timeout: 5000 });
  const area = answers?.area;
  if (!area || area.confidence < 0.5) return null;
  const hint = AREAS[area.choice]?.[1];
  if (!hint) return null;
  return { hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: `Jev routing (${area.choice}, ${area.confidence.toFixed(2)}): ${hint}` } };
});
