/**
 * Level 7, option B: should_i_compact on demand.
 * The same four questions and the same tiers, but the agent asks. The tool returns a typed verdict it can act on instead of a nudge it might miss.
 */
import type { CompactAction, CompactAnswers, CompactDecision, Lines, Usage } from "./should-compact.ts";

export interface CompactVerdict {
  should_compact: boolean;
  tier: CompactDecision["tier"];
  reason: string;
  context_tokens: number | null;
  context_percent: number | null;
  lines: Lines;
  signals: { switched_gears: number; at_boundary: number; needs_history: number; mid_operation: number };
  next_step: string;
}

/** The tool result the agent reads. Booleans and numbers first, prose last. */
export function compactVerdict(d: CompactDecision, a: CompactAnswers, usage: Usage | null, lines: Lines, action: CompactAction = "compact_now"): CompactVerdict {
  const should = d.tier === "recommend" || d.tier === "request";
  return {
    should_compact: should,
    tier: d.tier,
    reason: d.reason,
    context_tokens: usage ? usage.tokens : null,
    context_percent: usage && usage.pct !== null ? Number(usage.pct.toFixed(1)) : null,
    lines,
    signals: {
      switched_gears: a.switched_gears.noul,
      at_boundary: a.at_boundary.noul,
      needs_history: a.needs_history.score,
      mid_operation: a.mid_operation.noul,
    },
    next_step: action === "ask_user"
      ? should
        ? "Ask the user to run /compact with a one line note of what to keep, then continue the current request."
        : d.tier === "notice"
          ? "Optional. Continue, or suggest /compact to the user at a clean point."
          : "Continue. Nothing to do."
      : should
        ? "Call compact_now with a short note to yourself, then continue the current request."
        : d.tier === "notice"
          ? "Optional. Continue, or call compact_now if you are at a clean point."
          : "Continue. Nothing to do.",
  };
}
