/**
 * Claude Code and Codex hooks over the neutral handlers. Both harnesses send the same payload
 * fields and read the same `hookSpecificOutput` responses (docs/NOTES-claude.md, NOTES-codex.md);
 * they differ in tool names and where context usage lives.
 *
 *   PreToolUse        Bash: bash gate. Write, Edit, MultiEdit, NotebookEdit, apply_patch: write gate. Deny on block.
 *                     mcp__*: the MCP gate, except the jev server's own tools. With a ladder, Claude Code
 *                     also gets ask and allow; Codex only reads deny, so there they pass.
 *   PostToolUse       Read, Bash: result screen. The banner goes back as additionalContext.
 *   UserPromptSubmit  Level 7: record the request; inject a waiting tier message once.
 *   Stop              Level 7: the four questions, the tier saved for the next prompt.
 *   PreCompact        reported only.
 */
import type { Decider } from "../events/index.ts";
import type { Lines } from "../compact/should-compact.ts";
import type { Ladder } from "../guards/bash-gate.ts";
import { LEVEL6_GUARDS, handleHook, type Guard, type HookContext, type HookOutcome } from "./handle.ts";
import { readState, stateDir, writeState } from "./state.ts";
import { claudeUsage, codexUsage } from "./transcript.ts";

export type Harness = "claude" | "codex";

/** Lines for real sessions, whose system prompt alone passes the lab's demo lines. */
export const HOOK_LINES: Lines = { notice: 50_000, recommend: 100_000, request: 150_000 };

export interface HarnessHookOptions {
  harness: Harness;
  guards?: Guard[];
  /** When the bash and MCP gates ask or approve instead of passing. */
  ladder?: Ladder;
  /** Run the Level 7 advisor on UserPromptSubmit and Stop. */
  compact?: boolean;
  lines?: Lines;
  /** The model's context window in tokens, when the transcript does not say. */
  window?: number | null;
  decide: Decider;
  report: HookContext["report"];
}

/** The JSON the harness reads on stdout, or null for "allow, add nothing". */
export type HookResponse = { hookSpecificOutput: Record<string, unknown> } | null;

interface WriteTarget { path: string; content: string }

/** apply_patch's targets: every Add, Update, or Delete File section with its added lines. */
export function patchTargets(patch: string): WriteTarget[] {
  const out: WriteTarget[] = [];
  let current: WriteTarget | null = null;
  for (const line of patch.split("\n")) {
    const m = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/) ?? line.match(/^\*\*\* Move to: (.+)$/);
    if (m) { current = { path: m[1].trim(), content: "" }; out.push(current); continue; }
    if (current && line.startsWith("+")) current.content += line.slice(1) + "\n";
  }
  return out;
}

function writeTargets(tool: string, input: any): WriteTarget[] | null {
  switch (tool) {
    case "Write": return [{ path: String(input?.file_path ?? ""), content: String(input?.content ?? "") }];
    case "Edit": return [{ path: String(input?.file_path ?? ""), content: String(input?.new_string ?? "") }];
    case "MultiEdit": return [{ path: String(input?.file_path ?? ""), content: (input?.edits ?? []).map((e: any) => String(e?.new_string ?? "")).join("\n") }];
    case "NotebookEdit": return [{ path: String(input?.notebook_path ?? ""), content: String(input?.new_source ?? "") }];
    case "apply_patch": return patchTargets(String(input?.command ?? input?.patch ?? input?.input ?? ""));
    default: return null;
  }
}

function resultText(tool: string, response: any): string | null {
  if (tool === "Read") return typeof response === "string" ? response : String(response?.file?.content ?? "");
  if (tool === "Bash") {
    if (typeof response === "string") return response;
    return [response?.stdout, response?.stderr].filter(Boolean).join("\n");
  }
  return null;
}

const deny = (reason: string): HookResponse => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } });
const decision = (permissionDecision: "ask" | "allow", reason: string): HookResponse => ({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision, permissionDecisionReason: reason } });
const context = (event: string, text: string): HookResponse => ({ hookSpecificOutput: { hookEventName: event, additionalContext: text } });

export async function runHarnessHook(event: string, payload: any, opts: HarnessHookOptions): Promise<HookResponse> {
  const ctx: HookContext = { decide: opts.decide, report: opts.report, guards: opts.guards ?? LEVEL6_GUARDS, ladder: opts.ladder };
  /** Codex hooks honor deny only; an ask or allow there passes to Codex's own approvals. */
  const pre = (r: HookOutcome): HookResponse =>
    r.block ? deny(r.reason!) : r.verdict && opts.harness === "claude" ? decision(r.verdict, r.reason!) : null;
  const cwd = String(payload?.cwd || process.cwd());
  const tool = String(payload?.tool_name ?? "");
  const session = String(payload?.session_id ?? "default");

  switch (event) {
    case "PreToolUse": {
      if (tool === "Bash") {
        const r = await handleHook({ kind: "shell", tool, command: String(payload?.tool_input?.command ?? ""), cwd, hook: event }, ctx);
        return pre(r);
      }
      if (tool.startsWith("mcp__")) {
        if (tool.startsWith("mcp__jev__")) return null; // Jev's own tools only read
        return pre(await handleHook({ kind: "mcp-call", tool, input: payload?.tool_input, cwd, hook: event }, ctx));
      }
      const targets = writeTargets(tool, payload?.tool_input);
      if (!targets) return null;
      for (const t of targets) {
        const r: HookOutcome = await handleHook({ kind: "write", tool, path: t.path, content: t.content, cwd, hook: event }, ctx);
        if (r.block) return deny(r.reason!);
      }
      return null;
    }
    case "PostToolUse": {
      const text = resultText(tool, payload?.tool_response);
      if (text === null) return null;
      const r = await handleHook({ kind: tool === "Read" ? "read-result" : "shell-result", tool, text, cwd, hook: event }, ctx);
      return r.banner ? context(event, r.banner) : null;
    }
    case "UserPromptSubmit": {
      if (!opts.compact) return null;
      const dir = stateDir(cwd);
      const state = readState(dir, session);
      state.requests.push(String(payload?.prompt ?? ""));
      const pending = state.pending;
      state.pending = null;
      try { writeState(dir, session, state); } catch (err: any) { opts.report("error", { hook: event, message: `cannot save state: ${err?.message ?? err}` }); }
      if (pending) opts.report("hook", { hook: event, injected: pending });
      return pending ? context(event, pending) : null;
    }
    case "Stop": {
      if (!opts.compact || payload?.stop_hook_active) return null;
      const dir = stateDir(cwd);
      const state = readState(dir, session);
      const transcript = String(payload?.transcript_path ?? "");
      const usage = transcript ? (opts.harness === "codex" ? codexUsage(transcript, opts.window ?? null) : claudeUsage(transcript, opts.window ?? null)) : null;
      const r = await handleHook({
        kind: "turn-end", cwd, hook: event, action: "ask_user",
        input: { requests: state.requests, recentTurn: String(payload?.last_assistant_message ?? ""), toolsThisTurn: [], usage, compactable: true, lines: opts.lines ?? HOOK_LINES },
      }, ctx);
      state.pending = r.inject ?? null;
      try { writeState(dir, session, state); } catch (err: any) { opts.report("error", { hook: event, message: `cannot save state: ${err?.message ?? err}` }); }
      return null;
    }
    case "PreCompact":
      opts.report("hook", { hook: event, trigger: payload?.trigger ?? null, custom_instructions: payload?.custom_instructions ?? null });
      return null;
    default:
      return null;
  }
}
