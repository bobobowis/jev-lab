/**
 * The Jev tools over MCP: newline-delimited JSON-RPC 2.0 on stdio, the subset a tool server needs.
 * initialize, notifications/initialized, tools/list, tools/call, ping. Unknown methods get -32601,
 * unknown tools -32602, and a failing tool is an `isError` result, never a crash.
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Decider } from "../events/index.ts";
import { emptyLedger, record, summarize } from "../ledger.ts";
import { HOOK_LINES } from "../hooks/harness.ts";
import { readState, stateDir } from "../hooks/state.ts";
import { ASK_JEV_NUDGE } from "../tools/ask-jev.ts";
import type { CompactionSource, JevTool, ToolContext } from "../tools/types.ts";

/** Protocol revisions whose tools subset this server speaks. A client's revision is echoed when known. */
export const PROTOCOL_VERSIONS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

export interface ServerOptions {
  tools: JevTool[];
  cwd: string;
  decide: Decider;
  report(kind: string, payload: Record<string, unknown>): void;
  version?: string;
}

type Message = { jsonrpc?: string; id?: string | number | null; method?: string; params?: any };
type Reply = Record<string, unknown>;

/** The Level 7 hooks' notes for the most recent session in the project, for should_i_compact. */
export function latestSessionSource(cwd: string): CompactionSource {
  return {
    action: "ask_user",
    input: () => {
      const dir = stateDir(cwd);
      let newest: { name: string; at: number } | null = null;
      try {
        for (const name of readdirSync(dir)) {
          const m = name.match(/^session-(.+)\.json$/);
          if (!m) continue;
          const at = statSync(join(dir, name)).mtimeMs;
          if (!newest || at > newest.at) newest = { name: m[1], at };
        }
      } catch { return null; }
      if (!newest) return null;
      const s = readState(dir, newest.name);
      if (!s.requests.length) return null;
      return { requests: s.requests, recentTurn: "", toolsThisTurn: [], usage: null, compactable: true, lines: HOOK_LINES };
    },
  };
}

export function instructionsFor(tools: JevTool[]): string {
  const lines = ["Jev answers typed questions (yes or no, pick one, a score) about files, a command's output, or your own state, in about 300 ms for a fraction of a cent. Prefer it to reasoning a judgment call out yourself."];
  if (tools.some((t) => t.name === "ask_jev")) lines.push(ASK_JEV_NUDGE);
  if (tools.some((t) => t.name.startsWith("ask_jev_file"))) lines.push("The ask_jev_file tools judge one file without loading it into your context; use read when you need the code itself.");
  return lines.join("\n\n");
}

/** Handle one message. Returns the reply to send, or null for notifications. */
export function createHandler(opts: ServerOptions) {
  let ledger = emptyLedger();
  const ctx: ToolContext = {
    cwd: opts.cwd, harness: "mcp", decide: opts.decide, report: opts.report,
    compaction: latestSessionSource(opts.cwd),
  };
  const ok = (id: Message["id"], result: unknown): Reply => ({ jsonrpc: "2.0", id: id ?? null, result });
  const err = (id: Message["id"], code: number, message: string): Reply => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });

  return async function handle(msg: Message): Promise<Reply | null> {
    const isRequest = msg.id !== undefined && msg.id !== null;
    switch (msg.method) {
      case "initialize": {
        const asked = String(msg.params?.protocolVersion ?? "");
        return ok(msg.id, {
          protocolVersion: PROTOCOL_VERSIONS.includes(asked) ? asked : PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: "jev", version: opts.version ?? "0.0.0" },
          instructions: instructionsFor(opts.tools),
        });
      }
      case "ping":
        return isRequest ? ok(msg.id, {}) : null;
      case "tools/list":
        return ok(msg.id, { tools: opts.tools.map((t) => ({ name: t.name, title: t.label, description: t.description, inputSchema: t.parameters })) });
      case "tools/call": {
        const name = String(msg.params?.name ?? "");
        const tool = opts.tools.find((t) => t.name === name);
        if (!tool) return err(msg.id, -32602, `Unknown tool: ${name}. This server has ${opts.tools.map((t) => t.name).join(", ")}.`);
        const r = await tool.execute(msg.params?.arguments ?? {}, ctx);
        if (tool.name === "ask_jev" && !r.isError) {
          const p = r.payload as { answers: Record<string, unknown>; usage?: any };
          ledger = record(ledger, p.usage, Object.keys(p.answers).length);
          opts.report("ledger", { ...ledger, summary: summarize(ledger, 0) });
        }
        const result: Record<string, unknown> = { content: [{ type: "text", text: r.text }], isError: r.isError ?? false };
        if (!r.isError && r.payload && typeof r.payload === "object" && !Array.isArray(r.payload)) result.structuredContent = r.payload;
        return ok(msg.id, result);
      }
      default:
        if (msg.method?.startsWith("notifications/") || !isRequest) return null;
        return err(msg.id, -32601, `Method not found: ${msg.method}`);
    }
  };
}

/** Serve until stdin closes. Calls run concurrently; replies go out as each one finishes. */
export async function serve(opts: ServerOptions, input: NodeJS.ReadableStream = process.stdin, output: { write(s: string): unknown } = process.stdout): Promise<void> {
  const handle = createHandler(opts);
  const send = (reply: Reply | null) => { if (reply) output.write(JSON.stringify(reply) + "\n"); };
  const pending = new Set<Promise<void>>();
  for await (const line of createInterface({ input, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let msg: Message;
    try { msg = JSON.parse(line); } catch { send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }); continue; }
    const p: Promise<void> = handle(msg)
      .then(send)
      .catch((e: any) => send(msg.id !== undefined ? { jsonrpc: "2.0", id: msg.id, error: { code: -32603, message: e?.message ?? String(e) } } : null))
      .finally(() => pending.delete(p));
    pending.add(p);
  }
  await Promise.all(pending);
}
