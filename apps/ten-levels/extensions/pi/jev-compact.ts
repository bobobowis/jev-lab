/**
 * Level 7 on pi: should I compact.
 *
 *   turn_end   build the session view, one Jev call, decide the tier, report it
 *   context    inject the tier message as a transient custom message, only when not silent
 *   tools      should_i_compact (the package's tool) returns the verdict on demand; compact_now wraps ctx.compact
 *   session_before_compact   asks Jev which turn starts the live work and folds it into the instructions
 *
 * compact_now, the injection, and the cut point are pi-only: no other harness lets a tool compact.
 */
import {
  DEFAULT_LINES, cutPointInstructions, cutPointQuestion,
  type Evaluation, type Lines, type TurnInput, type TurnSummary,
} from "@bobobowis/jev-kit/compact";
import { handleHook } from "@bobobowis/jev-kit/hooks";
import { shouldICompact } from "@bobobowis/jev-kit/tools";
import { decide, levelConfig, registerJevTool, report, type PiTypes } from "../report.ts";

const GUIDANCE = "jev-compact-guidance";
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
const textOf = (m: any): string =>
  (Array.isArray(m?.content) ? m.content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n") : String(m?.content ?? "")).trim();

export interface CompactDeps {
  Type: PiTypes & { Object(props: Record<string, unknown>): unknown; String(opts?: unknown): unknown };
  /** pi cannot compact what fits in keepRecentTokens. The sandbox sets it low in .pi/settings.json. */
  keepRecentTokens(cwd: string): number;
}

export function install(pi: any, deps: CompactDeps) {
  const cfg = levelConfig<{ lines: Lines }>({ lines: DEFAULT_LINES });
  const lines: Lines = { ...DEFAULT_LINES, ...(cfg.lines ?? {}) };

  const userMessages: string[] = [];
  let lastSummary = "";
  let turn = 0;
  let pendingCompaction = false; // compact_now was called; quiet until pi compacts
  let current: Pick<Evaluation, "decision" | "message"> | null = null;

  function usageOf(ctx: any): { tokens: number; window: number; pct: number } {
    const u = ctx.getContextUsage?.();
    const window = u?.contextWindow ?? ctx.model?.contextWindow ?? 0;
    const tokens = u?.tokens ?? 0;
    const pct = u?.percent ?? (window > 0 ? (tokens / window) * 100 : 0);
    return { tokens, window, pct };
  }

  function inputOf(ctx: any, event: any): TurnInput {
    const usage = usageOf(ctx);
    return {
      requests: [...userMessages],
      summary: lastSummary || undefined,
      recentTurn: textOf(event.message),
      toolsThisTurn: (event.toolResults ?? []).map((r: any) => r?.toolName ?? r?.name).filter(Boolean),
      usage,
      compactable: usage.tokens > deps.keepRecentTokens(ctx.cwd),
      lines,
      turn,
    };
  }

  const hookCtx = {
    decide: (source: string, s: any, q: any, extra?: Record<string, unknown>) => decide(pi, source, s, q, extra),
    report: (kind: string, payload: Record<string, unknown>) => report(pi, kind, payload),
  };

  pi.on("message_end", async (event: any) => {
    if (event.message?.role === "user") userMessages.push(textOf(event.message));
  });

  pi.on("session_compact", async (event: any) => {
    lastSummary = event.compactionEntry?.summary ?? lastSummary;
    current = null;
    pendingCompaction = false;
  });

  // A: the hook. Every turn, silently, then the agent hears nothing or a tier.
  pi.on("turn_end", async (event: any, ctx: any) => {
    turn++;
    const input = inputOf(ctx, event);
    if (pendingCompaction) {
      const decision = { tier: "silent" as const, reason: "compaction requested, waiting for pi to run it" };
      current = { decision, message: null };
      report(pi, "hook", { hook: "turn_end", turn, usage: input.usage, lines, compactable: input.compactable, tier: decision.tier, reason: decision.reason, message: null, skipped: true });
      return;
    }
    const r = await handleHook({ kind: "turn-end", input, action: "compact_now", cwd: ctx.cwd }, hookCtx);
    if (r.evaluation) current = r.evaluation;
  });

  // The tier message rides on the next LLM call as a transient message. Silent injects nothing.
  pi.on("context", async (event: any) => {
    const messages = event.messages.filter((m: any) => !(m.role === "custom" && m.customType === GUIDANCE));
    if (current?.message) {
      messages.push({ role: "custom", customType: GUIDANCE, content: current.message, display: false, timestamp: Date.now() });
    }
    return { messages };
  });

  // B: the same decision, on demand, through the package's tool.
  registerJevTool(pi, deps.Type, shouldICompact, {
    compaction: (ctx) => ({
      action: "compact_now",
      input: () => inputOf(ctx, { message: { content: [] }, toolResults: [] }),
      onEvaluation: (e) => { current = e; },
    }),
  });

  // The action. The note rides into the compaction instructions so it survives the summary.
  pi.registerTool({
    name: "compact_now",
    label: "Compact now",
    description:
      "Compact the conversation now. Pass a short note_to_self: what you were doing, what is done, what is next. " +
      "The note is kept in the summary so you can pick up where you left off.",
    parameters: deps.Type.Object({ note_to_self: deps.Type.String({ description: "Two to five lines: state of the work, next step." }) }),
    async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: any, ctx: any) {
      const usage = usageOf(ctx);
      report(pi, "compact", { note: params.note_to_self, usage });
      current = null;
      pendingCompaction = true;
      ctx.compact({
        customInstructions: `Keep this note from the agent verbatim at the top of the summary:\n${params.note_to_self}`,
        onComplete: () => report(pi, "compact-done", { usage: usageOf(ctx) }),
        onError: (error: any) => { pendingCompaction = false; report(pi, "error", { hook: "compact_now", message: error?.message ?? String(error) }); },
      });
      return { content: [{ type: "text", text: "Compaction started. Your note will lead the summary. Continue with the current request." }] };
    },
  });

  // C: which turn starts the live work. Folded into the compaction instructions.
  pi.on("session_before_compact", async (event: any, ctx: any) => {
    try {
      const turns: TurnSummary[] = userMessages.map((m, i) => ({ index: i, request: clip(m, 120) }));
      if (turns.length < 2) return;
      const { answers } = await decide(pi, "session_before_compact", { turns }, cutPointQuestion(turns), { context: usageOf(ctx) });
      const cut = cutPointInstructions(turns, answers.live_from as any);
      report(pi, "hook", { hook: "session_before_compact", liveFrom: cut.liveFrom, confidence: cut.confidence, instructions: cut.instructions });
      // Instructions only. pi still writes the summary; the pick tells it what to keep in detail.
      if (event.customInstructions !== undefined) event.customInstructions = `${event.customInstructions ?? ""}\n${cut.instructions}`.trim();
    } catch (err: any) {
      report(pi, "error", { hook: "session_before_compact", message: err?.message ?? String(err) });
    }
  });
}
