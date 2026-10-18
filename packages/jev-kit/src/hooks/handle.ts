/**
 * The hooks, over one normalized event, for every harness. An adapter translates its harness's
 * hook payload into a HookEvent and the outcome back into the harness's response. The guards and
 * the compaction advisor make the same decisions under pi, Claude Code, and Codex.
 *
 *   shell          before a shell command runs: the bash gate
 *   write          before a file is created or changed: the write gate
 *   read-result    after a read returns: the result screen
 *   shell-result   after a shell command returns: the result screen
 *   turn-end       after a turn: the should-compact tier, to deliver on the next turn
 *
 * Every handler fails open: a Jev error allows the action and reports an `error` event.
 */
import type { Decider } from "../events/index.ts";
import { BLOCK_NOTICE, gateBashCommand } from "../guards/bash-gate.ts";
import { gateWriteCall } from "../guards/write-gate.ts";
import { screenToolResult } from "../guards/result-screen.ts";
import { evaluateCompaction, type Evaluation, type TurnInput } from "../compact/evaluate.ts";
import type { CompactAction } from "../compact/should-compact.ts";

export type Guard = "bash" | "write" | "result";
export const ALL_GUARDS: Guard[] = ["bash", "write", "result"];

interface Base {
  cwd: string;
  /** The harness's own name for the event, used in reports: tool_call, PreToolUse, ... */
  hook?: string;
}

export type HookEvent =
  | (Base & { kind: "shell"; tool: string; command: string })
  | (Base & { kind: "write"; tool: string; path: string; content: string })
  | (Base & { kind: "read-result" | "shell-result"; tool: string; text: string })
  | (Base & { kind: "turn-end"; input: TurnInput; action: CompactAction });

export interface HookOutcome {
  /** Deny the action; `reason` is what the agent reads. */
  block?: boolean;
  reason?: string;
  /** For results: a banner to show above, or alongside, the content. */
  banner?: string;
  /** For turn ends: a message for the agent's next turn. */
  inject?: string;
  /** For turn ends: the full evaluation, for harnesses that keep it. */
  evaluation?: Evaluation;
}

export interface HookContext {
  decide: Decider;
  report(kind: string, payload: Record<string, unknown>): void;
  /** Which guards are on. Defaults to all. */
  guards?: Guard[];
}

const DEFAULT_HOOK: Record<HookEvent["kind"], string> = {
  shell: "tool_call", write: "tool_call", "read-result": "tool_result", "shell-result": "tool_result", "turn-end": "turn_end",
};

/** The text the agent reads when a guard blocks. */
export const blockMessage = (what: string, reason: string) => `jev-guard blocked this ${what}: ${reason}. ${BLOCK_NOTICE}`;

export async function handleHook(event: HookEvent, ctx: HookContext): Promise<HookOutcome> {
  const on = (g: Guard) => (ctx.guards ?? ALL_GUARDS).includes(g);
  const hook = event.hook ?? DEFAULT_HOOK[event.kind];
  try {
    switch (event.kind) {
      case "shell": {
        if (!on("bash")) return {};
        const d = await gateBashCommand(event.command, event.cwd, (s, q) => ctx.decide(`${hook} ${event.tool}`, s, q));
        ctx.report("hook", { hook, tool: event.tool, command: event.command, block: d.block, reason: d.reason });
        return d.block ? { block: true, reason: blockMessage("command", d.reason) } : {};
      }
      case "write": {
        if (!on("write")) return {};
        const d = await gateWriteCall(event.path, event.content, event.cwd, (s, q) => ctx.decide(`${hook} ${event.tool}`, s, q));
        ctx.report("hook", { hook, tool: event.tool, path: event.path, block: d.block, reason: d.reason });
        return d.block ? { block: true, reason: blockMessage(event.tool, d.reason) } : {};
      }
      case "read-result":
      case "shell-result": {
        if (!on("result")) return {};
        const d = await screenToolResult(event.tool, event.text, (s, q) => ctx.decide(`${hook} ${event.tool}`, s, q));
        ctx.report("hook", { hook, tool: event.tool, flag: d.flag, noul: d.noul, banner: d.banner });
        return d.flag && d.banner ? { banner: d.banner } : {};
      }
      case "turn-end": {
        const evaluation = await evaluateCompaction(event.input, hook, ctx.decide, ctx.report, event.action);
        return evaluation.message ? { inject: evaluation.message, evaluation } : { evaluation };
      }
    }
  } catch (err: any) {
    ctx.report("error", { hook, message: err?.message ?? String(err) });
    return {};
  }
}
