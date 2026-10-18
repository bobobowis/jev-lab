/**
 * The MCP gate: the Level 4 account-actions ladder over an agent's MCP tool calls.
 * Before a tool from a connected server runs: does it only read, change something that can be
 * changed back, or destroy or reach outside? Destructive and outward calls ask the user, never run
 * on their own; an unsure call asks too; a call Jev is sure only reads can be approved. It never
 * denies: the user connected the server, so the user decides.
 */
import { jev } from "../core/client.ts";
import { choice, noul } from "../core/helpers.ts";
import type { ChoiceAnswer, NoulAnswer } from "../core/types.ts";
import { CONFIDENCE } from "../policy/index.ts";
import type { Decide, GateDecision, Ladder } from "./bash-gate.ts";

export const MCP_QUESTIONS = {
  effect: choice("What does calling the MCP tool `tool` with `input` do?", {
    read_only: "Reads, lists, searches, describes, explains, or fetches; nothing changes",
    reversible: "Creates or updates something that can be edited back or deleted again: a draft, a branch, a record",
    destructive: "Deletes, drops, revokes, resets, overwrites, or restores over existing data, with no way back",
  }),
  outward: noul("Does calling `tool` with `input` reach people or systems outside this work: send a message, publish, deploy, invite, charge money?", {
    true: "Sends email or chat, posts, publishes, deploys to production, changes billing or access for others",
    false: "Stays within the user's own data and environments",
  }),
};

export interface McpGateAnswers {
  effect: ChoiceAnswer;
  outward: NoulAnswer;
}

/** The outward Noul at which a call asks whatever its effect. */
export const MCP_OUTWARD = 0.5;
/** Inputs are cut to this many characters before they go to Jev. */
export const MCP_INPUT_CHARS = 4000;

/** Ask, approve, or pass; `block` is always false. */
export function mcpVerdict(a: McpGateAnswers, ladder: Ladder = {}): GateDecision {
  const floor = ladder.floor ?? CONFIDENCE.REVIEW_FLOOR, bar = ladder.bar ?? CONFIDENCE.DESTRUCTIVE_BAR;
  const c = a.effect.confidence.toFixed(2);
  if (a.effect.confidence < floor) return { block: false, verdict: "ask", reason: `Jev is unsure what this call does (${a.effect.choice} at ${c})` };
  if (a.effect.choice === "destructive") return { block: false, verdict: "ask", reason: `destructive (${c}): there is no way back` };
  if (a.outward.noul >= MCP_OUTWARD) return { block: false, verdict: "ask", reason: `reaches outside (${a.outward.noul.toFixed(2)}): it sends, publishes, deploys, or charges` };
  if (ladder.allowReadOnly && a.effect.choice === "read_only" && a.effect.confidence > bar) return { block: false, verdict: "allow", reason: `read only (${c})` };
  return { block: false, verdict: "pass", reason: `${a.effect.choice} (${c}), outward ${a.outward.noul.toFixed(2)}` };
}

/** `mcp__<server>__<tool>`, split; null for a name that isn't an MCP tool. */
export function mcpToolName(name: string): { server: string; tool: string } | null {
  const m = name.match(/^mcp__(.+?)__(.+)$/);
  return m ? { server: m[1], tool: m[2] } : null;
}

/** One call before the tool runs. */
export async function gateMcpCall(name: string, input: unknown, decide: Decide = (s, q) => jev.systemOne(s, q), ladder: Ladder = {}): Promise<GateDecision> {
  const parsed = mcpToolName(name);
  const json = JSON.stringify(input ?? {});
  const state = { tool: parsed?.tool ?? name, server: parsed?.server ?? "", input: json.length > MCP_INPUT_CHARS ? `${json.slice(0, MCP_INPUT_CHARS)}…` : json };
  const { answers } = await decide(state, MCP_QUESTIONS);
  return mcpVerdict(answers as unknown as McpGateAnswers, ladder);
}
