/**
 * One evaluation of the Level 7 decision from a harness-neutral view of the session: the user
 * requests so far, the last turn, and context usage when the harness reports it. pi builds the
 * input from its session; the Claude and Codex hooks build it from the transcript.
 */
import type { Decider } from "../events/index.ts";
import {
  COMPACT_QUESTIONS, decideTier, tierMessage,
  type CompactAction, type CompactAnswers, type CompactDecision, type CompactState, type Lines, type Usage,
} from "./should-compact.ts";

export interface TurnInput {
  /** Every user request so far, oldest first. */
  requests: string[];
  /** The last compaction summary, when there was one. */
  summary?: string;
  /** The assistant's last text, empty when the turn was tool calls only. */
  recentTurn: string;
  toolsThisTurn: string[];
  /** Null when the harness gives no reading. */
  usage: Usage | null;
  /** Whether there is anything the harness could compact. */
  compactable: boolean;
  lines: Lines;
  turn?: number;
}

export interface Evaluation {
  decision: CompactDecision;
  message: string | null;
  usage: Usage | null;
  answers: CompactAnswers | null;
  state: CompactState;
}

const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/** The state Jev sees. Built in code from the session, no LLM involved. */
export function buildCompactState(input: TurnInput): CompactState {
  const previous = [...input.requests.slice(0, -1).map((m) => clip(m, 200)), input.summary ? `Summary so far: ${clip(input.summary, 400)}` : ""].filter(Boolean).join("\n");
  return {
    current_request: clip(input.requests.at(-1) ?? "", 600),
    previous_work: previous || "(nothing before this request)",
    recent_turn: clip(input.recentTurn.trim() || `(tool calls only: ${input.toolsThisTurn.join(", ") || "none"})`, 600),
    tools_this_turn: input.toolsThisTurn,
  };
}

/**
 * Ask the four questions and decide the tier, reporting a `hook` event either way. The first
 * request is silent with no call: there is nothing to move on from yet.
 */
export async function evaluateCompaction(
  input: TurnInput,
  source: string,
  decide: Decider,
  report: (kind: string, payload: Record<string, unknown>) => void,
  action: CompactAction = "compact_now",
): Promise<Evaluation> {
  const state = buildCompactState(input);
  const base = { hook: source, turn: input.turn, usage: input.usage, usage_known: input.usage !== null, lines: input.lines, compactable: input.compactable };
  if (input.requests.length < 2) {
    const decision: CompactDecision = { tier: "silent", reason: "first request, nothing to move on from" };
    report("hook", { ...base, tier: decision.tier, reason: decision.reason, message: null, skipped: true });
    return { decision, message: null, usage: input.usage, answers: null, state };
  }
  const { answers } = await decide(source, state, COMPACT_QUESTIONS, { turn: input.turn, context: input.usage, lines: input.lines });
  const a = answers as unknown as CompactAnswers;
  const decision = decideTier(a, input.usage, input.compactable, input.lines, state);
  const message = tierMessage(decision, input.usage, action);
  report("hook", { ...base, tier: decision.tier, reason: decision.reason, message });
  return { decision, message, usage: input.usage, answers: a, state };
}
