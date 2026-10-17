/**
 * Context usage from a harness's own transcript, read at the end of a turn.
 *   Claude Code: the last assistant message's input plus cache tokens. The window is not recorded.
 *   Codex: the last `token_count` event, which also carries the model's context window.
 */
import { readFileSync } from "node:fs";
import type { Usage } from "../compact/should-compact.ts";

function lines(path: string): unknown[] {
  let text: string;
  try { text = readFileSync(path, "utf8"); } catch { return []; }
  const out: unknown[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* a line still being written */ }
  }
  return out;
}

const pctOf = (tokens: number, window: number | null) => (window && window > 0 ? (tokens / window) * 100 : null);

export function claudeUsage(transcriptPath: string, window: number | null = null): Usage | null {
  const all = lines(transcriptPath) as any[];
  for (let i = all.length - 1; i >= 0; i--) {
    const u = all[i]?.type === "assistant" ? all[i]?.message?.usage : null;
    if (!u) continue;
    const tokens = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    return { tokens, pct: pctOf(tokens, window) };
  }
  return null;
}

/** Codex's last context reading: input tokens of the last model call, and the model's window. */
export function codexTokenCount(transcriptPath: string): { tokens: number; window: number | null } | null {
  const all = lines(transcriptPath) as any[];
  for (let i = all.length - 1; i >= 0; i--) {
    const p = all[i]?.payload;
    if (all[i]?.type !== "event_msg" || p?.type !== "token_count" || !p.info?.last_token_usage) continue;
    return { tokens: p.info.last_token_usage.input_tokens ?? 0, window: p.info.model_context_window ?? null };
  }
  return null;
}

export function codexUsage(transcriptPath: string, window: number | null = null): Usage | null {
  const c = codexTokenCount(transcriptPath);
  return c ? { tokens: c.tokens, pct: pctOf(c.tokens, window ?? c.window) } : null;
}
