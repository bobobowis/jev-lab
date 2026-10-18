// PostToolUse on Write and Edit: reminders this repo's tests enforce, then Jev checks the edited
// source file against the two conventions a test can't catch early.
import { relative } from "node:path";
import { ask, main, ROOT } from "./lib.mjs";

main((p) => {
  const file = p.tool_input?.file_path ?? p.tool_input?.notebook_path;
  if (!file) return null;
  const rel = relative(ROOT, file).replaceAll("\\", "/");
  const notes = [];

  if (rel.startsWith("packages/jev-kit/src/core/")) notes.push("You edited the package core: run `pnpm run sync-skill`.");
  if (rel === "packages/jev-kit/src/capabilities.ts") notes.push("You edited capabilities.ts: run `pnpm run docs`.");

  const source = /^(packages\/jev-kit\/src|apps\/ten-levels\/server)\/.*\.(ts|mjs|js)$/.test(rel) && !rel.includes("/tests/");
  if (source) {
    const answers = ask({
      dependency: { type: "noul", instructions: `Does the file ${rel} import a package that is not a Node built-in (node:*) and not a relative path?` },
      fails_closed: { type: "noul", instructions: `Does the file ${rel} contain hook code that can exit with code 2, or block an action when Jev errors or times out?` },
    }, { paths: [rel] });
    if (answers?.dependency.noul >= 0.7) notes.push(`Jev: ${rel} seems to import a runtime dependency (${answers.dependency.noul.toFixed(2)}); this repo uses Node built-ins only.`);
    if (answers?.fails_closed.noul >= 0.7) notes.push(`Jev: ${rel} seems to fail closed or exit 2 (${answers.fails_closed.noul.toFixed(2)}); hooks must fail open.`);
  }

  if (!notes.length) return null;
  return { hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: notes.join("\n") } };
});
