// PreToolUse on Bash: before a `git commit`, Jev scores the staged diff. A risky one turns the call
// into a permission prompt, so you see it before it lands. Anything else passes untouched.
import { ask, main, normalized, run } from "./lib.mjs";

const COMMIT = /(^|[;&|]\s*)git\s+commit\b/;

main((p) => {
  const command = p.tool_input?.command ?? "";
  if (p.tool_name !== "Bash" || !COMMIT.test(command)) return null;

  const all = /\s-[a-zA-Z]*a/.test(command) || /--all\b/.test(command);
  const diff = run(all ? "git diff HEAD" : "git diff --cached", { keep: 20000 }).output;
  if (!diff.trim()) return null;

  const answers = ask({
    risk: {
      type: "score",
      instructions: "How risky is the change in diff to ship as one commit in this repo?",
      criteria: [
        "Docs, comments, or tests only",
        "Contained code change with tests",
        "Behavior change in shared code (client, hooks, guards, setup) or one without tests",
        "Breaks a convention: a runtime dependency, a hook that can exit 2 or fail closed, a deleted test, a secret",
      ],
    },
    tested: { type: "noul", instructions: "Does diff add or update tests for the behavior it changes?" },
  }, { state: { command, diff } });
  if (!answers) return null;

  const risk = normalized(answers.risk);
  if (risk < 0.6) return null;
  const level = answers.risk.legend[String(Math.round(answers.risk.score))];
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "ask",
      permissionDecisionReason: `Jev rates this commit risky (${risk.toFixed(2)}: ${level}; tests ${answers.tested.noul >= 0.5 ? "included" : "missing"}).`,
    },
  };
});
