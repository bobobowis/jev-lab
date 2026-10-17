/**
 * Level 7, option B: should_i_compact on demand. The same four questions and tiers as the turn-end
 * hook, but the agent asks. The harness supplies the session view; without one the tool says so.
 */
import { compactVerdict } from "../compact/compact-on-demand.ts";
import { evaluateCompaction } from "../compact/evaluate.ts";
import type { CompactAnswers } from "../compact/should-compact.ts";
import { fail, ok, type JevTool } from "./types.ts";

const NO_SIGNALS = {
  switched_gears: { type: "noul", noul: 0 }, at_boundary: { type: "noul", noul: 0 },
  needs_history: { type: "score", score: 2 }, mid_operation: { type: "noul", noul: 0 },
} as unknown as CompactAnswers;

export const shouldICompact: JevTool = {
  name: "should_i_compact",
  label: "Should I compact",
  description:
    "Ask whether now is a good moment to compact the conversation. Returns should_compact, a tier " +
    "(silent, notice, recommend, request), the reason, and the current context percent. Cheap, call it freely.",
  parameters: { type: "object", properties: {} },
  async execute(_p, ctx) {
    try {
      const source = ctx.compaction;
      const input = source ? await source.input() : null;
      if (!source || !input) {
        return fail("should_i_compact error: no session history is available to this tool. Enable the Level 7 hooks (jev setup --level 7) so the session is recorded.");
      }
      const r = await evaluateCompaction(input, "should_i_compact", ctx.decide, ctx.report, source.action);
      source.onEvaluation?.(r);
      return ok(compactVerdict(r.decision, r.answers ?? NO_SIGNALS, r.usage, input.lines, source.action));
    } catch (err: any) {
      return fail(`should_i_compact error: ${err?.message ?? err}`);
    }
  },
};
