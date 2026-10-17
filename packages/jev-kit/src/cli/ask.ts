/**
 * The general CLI, for scripts, CI, and git hooks:
 *   jev ask     a question block about a state, files, and a command's output; JSON on stdout
 *   jev files   the same question block about each file, in parallel
 *   jev gate    one yes or no question; the answer is the exit code
 *   jev guard   the Level 6 bash or write gate on a command or a file
 * Results go to stdout, diagnostics to stderr. Events only go to JEV_EVENT_DIR, when it is set.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { noul } from "../core/helpers.ts";
import { QuestionValidationError, type NoulAnswer } from "../core/types.ts";
import { AskStateError, assembleState } from "../files/assemble.ts";
import { gateBashCommand } from "../guards/bash-gate.ts";
import { gateWriteCall } from "../guards/write-gate.ts";
import { askJev } from "../tools/ask-jev.ts";
import { askJevFiles } from "../tools/file-tools.ts";
import { gatedRunner } from "../tools/run-command.ts";
import type { ToolContext } from "../tools/types.ts";
import { deciderFor, readAll, type Io } from "./common.ts";

const STATE_OPTIONS = {
  state: { type: "string" }, "state-file": { type: "string" }, paths: { type: "string", multiple: true },
  command: { type: "string" }, cwd: { type: "string" }, mock: { type: "boolean" }, help: { type: "boolean", short: "h" },
} as const;

const STATE_HELP = `  --state <text|json>  your own state, plain text or a JSON object
  --state-file <file>  the same, read from a file
  --paths <glob>       files for code to read into files["path"]; repeat for more (up to 20 files)
  --command <cmd>      a command for code to run; its result goes into output (passes the bash gate)
  --cwd <dir>          where paths resolve and the command runs (default: here)
  --mock               the offline mock instead of a Jev key`;

export const ASK_HELP = `Usage: jev ask --questions <json|@file> [state options]

Prints { answers, state_summary, usage, model } as JSON. Exit 0, 1 when the call is refused or fails, 2 for bad options.

  --questions <json|@file>  the question block, keyed by question id
${STATE_HELP}
`;

export const FILES_HELP = `Usage: jev files <glob|dir|file>... --questions <json|@file> [--recursive] [--cwd dir] [--mock]

Asks the question block once per file, in parallel. Prints { results, skipped, calls } as JSON.
`;

export const GATE_HELP = `Usage: jev gate "<yes or no question>" [state options] [--threshold 0.5] [--yes <text>] [--no <text>] [--json]

Exit 0 when the probability of yes is at or above the threshold, 1 below it, 2 for bad options or a
state that cannot be sent, 3 when Jev could not answer. The script chooses whether 3 fails open or closed.

  --threshold <0..1>   default 0.5
  --yes <text>         what counts as yes
  --no <text>          what counts as no
  --json               also print { noul, threshold, yes } on stdout
${STATE_HELP}
`;

export const GUARD_HELP = `Usage: jev guard bash "<command>" | jev guard write <path> < content   [--cwd dir] [--json] [--mock]

The Level 6 gates. Prints allow or block with the reason. Exit 0 allow, 1 block, 2 bad options, 3 Jev error.
`;

function parse<T extends Record<string, any>>(argv: string[], options: T, io: Io, help: string, name: string, positionals = false) {
  try {
    return parseArgs({ args: argv, options, strict: true, allowPositionals: positionals });
  } catch (err: any) {
    io.stderr.write(`jev ${name}: ${err.message}\n\n${help}`);
    return null;
  }
}

const readQuestions = (raw: string) => (raw.startsWith("@") ? readFileSync(raw.slice(1), "utf8") : raw);

function context(cwd: string, mock: boolean | undefined, io: Io): ToolContext {
  const { reporter, decide } = deciderFor("cli", { mock, quiet: true, stderr: io.stderr, client: io.client });
  return { cwd, harness: "cli", decide, report: (k, p) => reporter.report(k, p) };
}

function stateText(v: { state?: string; "state-file"?: string }): string | undefined {
  if (v["state-file"]) return readFileSync(v["state-file"], "utf8");
  return v.state;
}

export async function ask(argv: string[], io: Io): Promise<number> {
  const parsed = parse(argv, { ...STATE_OPTIONS, questions: { type: "string" } }, io, ASK_HELP, "ask");
  if (!parsed) return 2;
  const v = parsed.values as any;
  if (v.help) { io.stdout.write(ASK_HELP); return 0; }
  if (!v.questions) { io.stderr.write("jev ask: --questions is required\n"); return 2; }
  let questions;
  try { questions = readQuestions(v.questions); } catch (err: any) { io.stderr.write(`jev ask: cannot read ${v.questions}: ${err.message}\n`); return 2; }
  const ctx = context(resolve(v.cwd ?? process.cwd()), v.mock, io);
  const r = await askJev.execute({ questions_json: questions, state: stateText(v), paths: v.paths, command: v.command }, ctx);
  if (r.isError) { io.stderr.write(r.text + "\n"); return 1; }
  io.stdout.write(JSON.stringify(r.payload) + "\n");
  return 0;
}

export async function files(argv: string[], io: Io): Promise<number> {
  const parsed = parse(argv, { questions: { type: "string" }, recursive: { type: "boolean" }, cwd: { type: "string" }, mock: { type: "boolean" }, help: { type: "boolean", short: "h" } }, io, FILES_HELP, "files", true);
  if (!parsed) return 2;
  const v = parsed.values as any;
  if (v.help) { io.stdout.write(FILES_HELP); return 0; }
  if (!v.questions || !parsed.positionals.length) { io.stderr.write(`jev files: pass one or more globs and --questions\n\n${FILES_HELP}`); return 2; }
  let questions;
  try { questions = readQuestions(v.questions); } catch (err: any) { io.stderr.write(`jev files: cannot read ${v.questions}: ${err.message}\n`); return 2; }
  const ctx = context(resolve(v.cwd ?? process.cwd()), v.mock, io);
  const r = await askJevFiles.execute({ paths_or_globs: parsed.positionals, questions_json: questions, recursive: v.recursive ?? false }, ctx);
  if (r.isError) { io.stderr.write(r.text + "\n"); return 1; }
  io.stdout.write(JSON.stringify(r.payload) + "\n");
  return 0;
}

export async function gate(argv: string[], io: Io): Promise<number> {
  const parsed = parse(argv, { ...STATE_OPTIONS, threshold: { type: "string" }, yes: { type: "string" }, no: { type: "string" }, json: { type: "boolean" } }, io, GATE_HELP, "gate", true);
  if (!parsed) return 2;
  const v = parsed.values as any;
  if (v.help) { io.stdout.write(GATE_HELP); return 0; }
  const question = parsed.positionals.join(" ").trim();
  if (!question) { io.stderr.write(`jev gate: the question is required\n\n${GATE_HELP}`); return 2; }
  const threshold = v.threshold === undefined ? 0.5 : Number(v.threshold);
  if (!(threshold >= 0 && threshold <= 1)) { io.stderr.write("jev gate: --threshold must be between 0 and 1\n"); return 2; }
  const cwd = resolve(v.cwd ?? process.cwd());
  const ctx = context(cwd, v.mock, io);
  let assembled;
  try {
    assembled = await assembleState({ state: stateText(v), paths: v.paths, command: v.command }, cwd, gatedRunner(ctx));
  } catch (err: any) {
    io.stderr.write(`jev gate: ${err instanceof AskStateError ? err.message : `cannot build the state: ${err?.message ?? err}`}\n`);
    return err instanceof AskStateError ? 2 : 3;
  }
  const criteria = v.yes || v.no ? { true: v.yes, false: v.no } : undefined;
  let answer: NoulAnswer;
  try {
    const { answers } = await ctx.decide("gate", assembled.state, { gate: noul(question, criteria) });
    answer = answers.gate as NoulAnswer;
  } catch (err: any) {
    io.stderr.write(`jev gate: ${err?.message ?? err}\n`);
    return err instanceof QuestionValidationError ? 2 : 3;
  }
  const yes = answer.noul >= threshold;
  if (v.json) io.stdout.write(JSON.stringify({ noul: answer.noul, threshold, yes }) + "\n");
  return yes ? 0 : 1;
}

export async function guard(argv: string[], io: Io): Promise<number> {
  const parsed = parse(argv, { cwd: { type: "string" }, json: { type: "boolean" }, mock: { type: "boolean" }, help: { type: "boolean", short: "h" } }, io, GUARD_HELP, "guard", true);
  if (!parsed) return 2;
  const v = parsed.values as any;
  if (v.help) { io.stdout.write(GUARD_HELP); return 0; }
  const [kind, ...rest] = parsed.positionals;
  const target = rest.join(" ").trim();
  if ((kind !== "bash" && kind !== "write") || !target) { io.stderr.write(`jev guard: pass bash "<command>" or write <path>\n\n${GUARD_HELP}`); return 2; }
  const cwd = resolve(v.cwd ?? process.cwd());
  const ctx = context(cwd, v.mock, io);
  let d;
  try {
    d = kind === "bash"
      ? await gateBashCommand(target, cwd, (s, q) => ctx.decide("guard bash", s, q))
      : await gateWriteCall(target, await readAll(io.stdin), cwd, (s, q) => ctx.decide("guard write", s, q));
  } catch (err: any) {
    io.stderr.write(`jev guard: ${err?.message ?? err}\n`);
    return 3;
  }
  ctx.report("hook", { hook: `guard ${kind}`, [kind === "bash" ? "command" : "path"]: target, block: d.block, reason: d.reason });
  io.stdout.write(v.json ? JSON.stringify(d) + "\n" : `${d.block ? "block" : "allow"}: ${d.reason}\n`);
  return d.block ? 1 : 0;
}
