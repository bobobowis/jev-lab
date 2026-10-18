/**
 * Level 6, option A: bash gate.
 * In the tool_call hook, before any bash command runs: what does it do to the machine, and does it mean to destroy something? Irreversible or destructive blocks. The agent only sees the reason.
 */
import { jev } from "../core/client.ts";
import { choice, noul } from "../core/helpers.ts";
import type { ChoiceAnswer, NoulAnswer, Questions, State } from "../core/types.ts";
import { CONFIDENCE } from "../policy/index.ts";

export const BASH_QUESTIONS = {
  effect: choice("What does running `command` in `cwd` do to the machine?", {
    read_only: "Lists, reads, searches, tests, builds into a scratch directory; nothing durable changes",
    reversible: "Changes files or state that git or a reinstall can restore: edits, installs, generated output",
    irreversible: "Deletes or overwrites things with no way back: removing directories, force pushing, dropping data, rewriting history",
  }),
  destructive_intent: noul("Does `command` aim to remove or wipe something rather than build or inspect?", {
    true: "rm -rf, drop, purge, force, reset --hard, truncate, overwriting real data",
    false: "Reading, listing, testing, installing, generating, or editing in place",
  }),
};

export interface BashGateAnswers {
  effect: ChoiceAnswer;
  destructive_intent: NoulAnswer;
  /** Asked only with a ladder that asks. */
  outward?: NoulAnswer;
}

/** With `ask`, one more question: a command can change nothing here and still publish or deploy. */
export const BASH_LADDER_QUESTIONS = {
  ...BASH_QUESTIONS,
  outward: noul("Does `command` reach people or systems outside this machine: publish, deploy, push to production, send, or run code downloaded from the internet?", {
    true: "npm publish, kubectl apply, terraform apply, a migration against a remote database, curl ... | sh, sending email",
    false: "Works only on this machine and this repository, or only downloads dependencies through the package manager",
  }),
};
/** The outward Noul at which a laddered command asks. */
export const BASH_OUTWARD = 0.5;

export interface BashThresholds {
  /** Confidence the irreversible pick needs before it blocks on its own. */
  irreversible: number;
  /** The destructive Noul above which the command blocks whatever the effect pick. */
  destructive: number;
}
export const BASH_THRESHOLDS: BashThresholds = { irreversible: 0.6, destructive: 0.7 };

/**
 * What a hook does with a call, on the Level 4 ladder: deny it, ask the user, approve it without
 * the harness's own prompt, or pass it to the harness's usual permissions.
 */
export type Verdict = "deny" | "ask" | "allow" | "pass";

export interface Ladder {
  /** Ask the user, instead of passing, when Jev is unsure or leans destructive without blocking. */
  ask?: boolean;
  /** Approve what Jev is sure only reads, so the harness doesn't prompt for it. */
  allowReadOnly?: boolean;
  /** Below this confidence a human decides. */
  floor?: number;
  /** Above this confidence a read-only pick is approved. */
  bar?: number;
}

export interface GateDecision {
  block: boolean;
  reason: string;
  /** Set when a ladder was given; `block` is then `verdict === "deny"`. */
  verdict?: Verdict;
}

/** What the agent reads after every block. The block is the answer, not a puzzle to route around. */
export const BLOCK_NOTICE =
  "This block is final. Do not try to work around it with another command, another tool, a different path, or an encoding that does the same thing. Stop and tell the user what was blocked and why.";

/** Block or allow. A hook has no third option, so the middle ground allows and says why. */
export function gateBash(a: BashGateAnswers, t: BashThresholds = BASH_THRESHOLDS): GateDecision {
  if (a.effect.choice === "irreversible" && a.effect.confidence >= t.irreversible) {
    return { block: true, reason: `irreversible (${a.effect.confidence.toFixed(2)}): nothing would restore what this removes or overwrites` };
  }
  if (a.destructive_intent.noul >= t.destructive) {
    return { block: true, reason: `destructive intent (${a.destructive_intent.noul.toFixed(2)}): this command aims to wipe something` };
  }
  return { block: false, reason: `${a.effect.choice} (${a.effect.confidence.toFixed(2)}), destructive ${a.destructive_intent.noul.toFixed(2)}` };
}

/** Bash read below the destructive line, where a ladder asks rather than passes. */
const LEANS_DESTRUCTIVE = 0.4;
/** The most destructive intent a command may show and still be approved as read-only. */
const READ_ONLY_INTENT = 0.1;

/**
 * The bash gate on the Level 4 ladder. Blocks stay blocks. Below them, an irreversible pick, a
 * destructive lean, or confidence under the floor asks the user; a read-only pick above the bar is
 * approved. Without `ask` or `allowReadOnly` this is gateBash.
 */
export function bashVerdict(a: BashGateAnswers, ladder: Ladder = {}, t: BashThresholds = BASH_THRESHOLDS): GateDecision {
  const d = gateBash(a, t);
  if (d.block) return { ...d, verdict: "deny" };
  const floor = ladder.floor ?? CONFIDENCE.REVIEW_FLOOR, bar = ladder.bar ?? CONFIDENCE.DESTRUCTIVE_BAR;
  if (ladder.ask) {
    if (a.effect.confidence < floor) return { block: false, verdict: "ask", reason: `Jev is unsure what this does (${a.effect.choice} at ${a.effect.confidence.toFixed(2)})` };
    if (a.effect.choice === "irreversible") return { block: false, verdict: "ask", reason: `may be irreversible (${a.effect.confidence.toFixed(2)})` };
    if (a.destructive_intent.noul >= LEANS_DESTRUCTIVE) return { block: false, verdict: "ask", reason: `leans destructive (${a.destructive_intent.noul.toFixed(2)})` };
    if (a.outward && a.outward.noul >= BASH_OUTWARD) return { block: false, verdict: "ask", reason: `reaches outside this machine (${a.outward.noul.toFixed(2)}): it publishes, deploys, sends, or runs downloaded code` };
  }
  if (ladder.allowReadOnly && a.effect.choice === "read_only" && a.effect.confidence > bar && a.destructive_intent.noul < READ_ONLY_INTENT && (a.outward?.noul ?? 0) < BASH_OUTWARD) {
    return { block: false, verdict: "allow", reason: `read only (${a.effect.confidence.toFixed(2)})` };
  }
  return { ...d, verdict: "pass" };
}

export type Decide = (state: State, questions: Questions) => Promise<{ answers: Record<string, unknown> }>;

/**
 * A: one call before the command runs. `decide` defaults to the shared client; the extension passes a reporting one.
 * With a ladder the decision carries a verdict.
 */
export async function gateBashCommand(command: string, cwd: string, decide: Decide = (s, q) => jev.systemOne(s, q), ladder?: Ladder): Promise<GateDecision> {
  const { answers } = await decide({ command, cwd }, ladder?.ask ? BASH_LADDER_QUESTIONS : BASH_QUESTIONS);
  return ladder ? bashVerdict(answers as unknown as BashGateAnswers, ladder) : gateBash(answers as unknown as BashGateAnswers);
}
