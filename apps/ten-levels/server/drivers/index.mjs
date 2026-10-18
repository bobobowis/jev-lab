/**
 * The harness drivers the lab can run a session in, and how a session's harness is chosen:
 * the start request's `harness`, then JEV_AGENT, then the first CLI on PATH in the order pi,
 * claude, codex.
 */
import * as claude from "./claude.mjs";
import * as codex from "./codex.mjs";
import * as pi from "./pi.mjs";
import { resolveCommand } from "../spawn-cli.mjs";

export const DRIVERS = { pi, claude, codex };
export const ORDER = ["pi", "claude", "codex"];

const INSTALL = {
  pi: "pnpm add -g @earendil-works/pi-coding-agent",
  claude: "pnpm add -g @anthropic-ai/claude-code",
  codex: "pnpm add -g @openai/codex",
};

export class HarnessError extends Error {}

export const available = (name, env = process.env) => Boolean(DRIVERS[name] && resolveCommand(DRIVERS[name].command, env));

export function harnesses(env = process.env) {
  return ORDER.map((name) => ({ name, available: available(name, env), install: INSTALL[name] }));
}

/** The harness for a new session, or a HarnessError that says what to install. */
export function chooseHarness(requested, env = process.env) {
  const wanted = requested || env.JEV_AGENT?.trim() || "";
  if (wanted) {
    if (!DRIVERS[wanted]) throw new HarnessError(`unknown harness "${wanted}"; the lab runs ${ORDER.join(", ")}`);
    if (!available(wanted, env)) throw new HarnessError(`${wanted} is not installed or not on PATH. Install it with: ${INSTALL[wanted]}`);
    return wanted;
  }
  const found = ORDER.find((name) => available(name, env));
  if (!found) {
    throw new HarnessError(`No coding agent found for levels 6 to 10. Install one of: ${ORDER.map((n) => `${n} (${INSTALL[n]})`).join(", ")}. Levels 1 to 5 work without one.`);
  }
  return found;
}

/** What /api/state reports: every harness, and the one a new session would use. */
export function harnessState(env = process.env) {
  let harness = null;
  try { harness = chooseHarness("", env); } catch { /* none installed */ }
  return { harnesses: harnesses(env), harness };
}
