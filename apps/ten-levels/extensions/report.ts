/**
 * The pi side of the event channel, and the glue every pi adapter shares.
 *
 * Events go through @bobobowis/jev-kit/events: to `JEV_EVENT_DIR/pi-<pid>.jsonl` when the lab
 * names a directory, otherwise as `JEV_EVENT` lines on stderr. Each one is also appended to the pi
 * session as a custom entry, so the session file holds the permanent record.
 *
 * Nothing here imports pi or typebox, so the adapters are testable with a fake `pi`. The entry
 * files in this folder pass pi's `Type` in.
 */
import { JevClient, type Questions, type State } from "@bobobowis/jev-kit";
import { createDecider, createReporter, type Decision, type Reporter } from "@bobobowis/jev-kit/events";
import type { CompactionSource, JevTool, ToolContext, ToolResult } from "@bobobowis/jev-kit/tools";

let client: JevClient | undefined;
/** TypeSafe or OpenRouter, whichever key is set (TypeSafe first), like the rest of the lab; JEV_BACKEND picks one, or mock. */
export const jev = () => (client ??= new JevClient());

/** The level config the lab passed in, JEV_LEVEL_CONFIG as JSON. */
export function levelConfig<T extends object>(fallback: T): T {
  try {
    const raw = process.env.JEV_LEVEL_CONFIG;
    return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback;
  } catch {
    return fallback;
  }
}

const reporters = new WeakMap<object, Reporter>();
function reporterFor(pi: any): Reporter {
  let r = reporters.get(pi);
  if (!r) {
    r = createReporter({ harness: "pi", onEvent: (kind, payload) => pi.appendEntry?.(`jev-${kind}`, payload) });
    reporters.set(pi, r);
  }
  return r;
}

export function report(pi: any, kind: string, payload: Record<string, unknown>): void {
  reporterFor(pi).report(kind, payload);
}

export type { Decision };

/** One Jev call from inside the harness. `source` names who asked, a hook or a tool. */
export function decide(pi: any, source: string, state: State, questions: Questions, extra: Record<string, unknown> = {}): Promise<Decision> {
  return createDecider(reporterFor(pi), jev)(source, state, questions, extra);
}

export function toolContext(pi: any, cwd: string, compaction?: CompactionSource): ToolContext {
  return {
    cwd,
    harness: "pi",
    decide: (source, state, questions, extra) => decide(pi, source, state, questions, extra),
    report: (kind, payload) => report(pi, kind, payload),
    compaction,
  };
}

/** pi's tool result shape. */
export const toPi = (r: ToolResult) =>
  r.isError ? { content: [{ type: "text", text: r.text }], isError: true } : { content: [{ type: "text", text: r.text }], details: r.payload };

/** What the adapters need from pi's typebox: wrap a plain JSON Schema so pi's validator accepts it. */
export interface PiTypes {
  Unsafe(schema: unknown): unknown;
}

/** Register a package tool with pi. `after` sees every result, for a ledger. */
export function registerJevTool(pi: any, Type: PiTypes, tool: JevTool, opts: { compaction?: (ctx: any) => CompactionSource; after?: (r: ToolResult) => void } = {}): void {
  pi.registerTool({
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: Type.Unsafe(tool.parameters),
    async execute(_id: string, params: any, _signal: AbortSignal, _onUpdate: any, ctx: any) {
      const r = await tool.execute(params ?? {}, toolContext(pi, ctx?.cwd ?? process.cwd(), opts.compaction?.(ctx)));
      opts.after?.(r);
      return toPi(r);
    },
  });
}
