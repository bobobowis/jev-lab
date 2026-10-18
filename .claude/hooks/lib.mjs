// Shared plumbing for this repo's own Claude Code hooks. Each hook reads Claude Code's payload on
// stdin, asks Jev through the jev command, and answers with JSON on stdout. They fail open: any
// error, missing build, or missing key prints nothing and exits 0. They never exit 2.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ROOT = process.env.CLAUDE_PROJECT_DIR || process.cwd();
const CLI = join(ROOT, "packages/jev-kit/dist/cli/index.js");
const ENV_FILE = `--env-file-if-exists=${join(ROOT, ".env")}`;

export function payload() {
  try { return JSON.parse(readFileSync(0, "utf8")); } catch { return {}; }
}

/** `jev ask` with a question block; the parsed { answers, ... } or null when Jev could not answer. */
export function ask(questions, { state, paths = [], cwd = ROOT, timeout = 8000 } = {}) {
  if (!existsSync(CLI)) return null;
  const args = [ENV_FILE, CLI, "ask", "--questions", JSON.stringify(questions), "--cwd", cwd];
  if (state !== undefined) args.push("--state", typeof state === "string" ? state : JSON.stringify(state));
  for (const p of paths) args.push("--paths", p);
  if (process.env.JEV_HOOKS_MOCK === "1") args.push("--mock");
  const r = spawnSync(process.execPath, args, { cwd, encoding: "utf8", timeout });
  if (r.status !== 0) return null;
  try { return JSON.parse(r.stdout).answers; } catch { return null; }
}

/** Run a command for its output, trimmed to the last `keep` characters. */
export function run(command, { timeout = 120000, keep = 6000 } = {}) {
  const r = spawnSync(command, { cwd: ROOT, shell: true, encoding: "utf8", timeout, env: { ...process.env, CI: "1" } });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
  return { status: r.status, output: out.length > keep ? out.slice(-keep) : out };
}

/** A score answer as 0..1 against its own top level. */
export const normalized = (a) => {
  const top = Object.keys(a.legend).length - 1;
  return top > 0 ? a.score / top : 0;
};

export function reply(obj) {
  if (obj) process.stdout.write(JSON.stringify(obj));
  process.exit(0);
}

/** Wrap a hook so nothing it throws can block Claude. */
export function main(fn) {
  try { reply(fn(payload())); } catch { reply(null); }
}
