/**
 * jev hook: run as a Claude Code or Codex hook. Reads the hook payload on stdin, writes the
 * harness's response on stdout. Fails open: a Jev error, a timeout, or a bad payload allows the
 * action. Never exits 2, which both harnesses read as "block".
 */
import { parseArgs } from "node:util";
import { ALL_GUARDS, LEVEL6_GUARDS, runHarnessHook, HOOK_LINES, type Guard, type Harness } from "../hooks/index.ts";
import { deciderFor, list, readAll, withDeadline, type Io } from "./common.ts";

export const HOOK_HELP = `Usage: jev hook --harness claude|codex --event <HookEvent> [options]

Reads the hook payload on stdin and answers on stdout. Exit 0 always, except 1 for bad options.

Options:
  --harness <name>     claude or codex
  --event <name>       PreToolUse, PostToolUse, UserPromptSubmit, Stop, PreCompact
  --guards <list>      bash,write,result,mcp (default: bash,write,result)
  --ask                the bash and mcp gates ask you when Jev is unsure or leans destructive (Claude Code)
  --allow-read-only    the bash and mcp gates approve what Jev is sure only reads (Claude Code)
  --compact            run the Level 7 advisor on UserPromptSubmit and Stop
  --lines <n,n,n>      notice, recommend, request lines in context tokens (default ${HOOK_LINES.notice},${HOOK_LINES.recommend},${HOOK_LINES.request})
  --window <tokens>    the model's context window, for percentages
  --timeout-ms <ms>    give up and allow after this long (default 8000)
  --mock               use the offline mock instead of a Jev key
`;

export async function hook(argv: string[], io: Io): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv, strict: true,
      options: {
        harness: { type: "string" }, event: { type: "string" }, guards: { type: "string" }, compact: { type: "boolean" },
        ask: { type: "boolean" }, "allow-read-only": { type: "boolean" },
        lines: { type: "string" }, window: { type: "string" }, "timeout-ms": { type: "string" }, mock: { type: "boolean" }, help: { type: "boolean", short: "h" },
      },
    }));
  } catch (err: any) {
    io.stderr.write(`jev hook: ${err.message}\n\n${HOOK_HELP}`);
    return 1;
  }
  if (values.help) { io.stdout.write(HOOK_HELP); return 0; }
  const harness = values.harness as Harness;
  if (harness !== "claude" && harness !== "codex") { io.stderr.write(`jev hook: --harness must be claude or codex\n`); return 1; }
  if (!values.event) { io.stderr.write(`jev hook: --event is required\n`); return 1; }
  const guards = values.guards ? (list(values.guards) as Guard[]) : LEVEL6_GUARDS;
  const unknown = guards.filter((g) => !ALL_GUARDS.includes(g));
  if (unknown.length) { io.stderr.write(`jev hook: unknown guard ${unknown.join(", ")}; known: ${ALL_GUARDS.join(", ")}\n`); return 1; }
  let lines = HOOK_LINES;
  if (values.lines) {
    const [notice, recommend, request] = list(values.lines).map(Number);
    if (![notice, recommend, request].every((n) => Number.isFinite(n) && n > 0) || !(notice < recommend && recommend < request)) {
      io.stderr.write(`jev hook: --lines needs three increasing token counts, for example 50000,100000,150000\n`);
      return 1;
    }
    lines = { notice, recommend, request };
  }
  const window = values.window ? Number(values.window) : null;
  const timeoutMs = values["timeout-ms"] ? Number(values["timeout-ms"]) : 8000;

  const { reporter, decide } = deciderFor(harness, { mock: values.mock, stderr: io.stderr, timeoutMs, client: io.client });
  let payload: unknown;
  try {
    payload = JSON.parse(await readAll(io.stdin));
  } catch (err: any) {
    reporter.report("error", { hook: values.event, message: `unreadable hook payload: ${err?.message ?? err}` });
    return 0;
  }

  const response = await withDeadline(
    runHarnessHook(values.event, payload, { harness, guards, ladder: { ask: values.ask, allowReadOnly: values["allow-read-only"] }, compact: values.compact, lines, window, decide, report: (k, p) => reporter.report(k, p) })
      .catch((err) => { reporter.report("error", { hook: values.event, message: err?.message ?? String(err) }); return null; }),
    timeoutMs,
    () => { reporter.report("error", { hook: values.event, message: `timed out after ${timeoutMs} ms; allowed` }); return null; },
  );
  if (response) io.stdout.write(JSON.stringify(response));
  return 0;
}
