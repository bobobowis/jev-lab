/**
 * The event channel every tool, hook, and CLI run reports on.
 *
 * With JEV_EVENT_DIR set, each process appends JSON lines to its own file, `<dir>/<harness>-<pid>.jsonl`,
 * so no two processes share a file and large events never tear. Without it, events go to stderr as
 * `JEV_EVENT {json}` lines, unless the reporter is quiet (the general CLI keeps stderr readable).
 * A failed write falls back to stderr and never fails the caller.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { sharedJev, type JevClient } from "../core/client.ts";
import { validateQuestions, type Answer, type Questions, type State, type SystemOneUsage } from "../core/types.ts";

export const EVENT_PREFIX = "JEV_EVENT ";

export interface JevEventLine {
  kind: string;
  at: number;
  harness: string;
  [field: string]: unknown;
}

export interface Reporter {
  readonly harness: string;
  /** Where events go: the file path, "stderr", or "off". */
  readonly target: string;
  report(kind: string, payload?: Record<string, unknown>): void;
}

export interface ReporterOptions {
  /** Names who produced the events: pi, claude, codex, mcp, cli, ... */
  harness: string;
  /** Defaults to JEV_EVENT_DIR. */
  dir?: string;
  /** No event directory means no events, instead of stderr lines. */
  quiet?: boolean;
  /** Also called with every event, for a harness's own record (pi session entries). Errors are ignored. */
  onEvent?: (kind: string, payload: Record<string, unknown>) => void;
  stderr?: { write(chunk: string): unknown };
}

export function createReporter(opts: ReporterOptions): Reporter {
  const stderr = opts.stderr ?? process.stderr;
  const dir = opts.dir ?? process.env.JEV_EVENT_DIR?.trim() ?? "";
  let file = dir ? join(dir, `${opts.harness}-${process.pid}.jsonl`) : "";
  let ready = false;

  const toStderr = (line: string) => {
    try { stderr.write(EVENT_PREFIX + line + "\n"); } catch { /* nowhere left to report */ }
  };

  return {
    harness: opts.harness,
    get target() { return file || (opts.quiet ? "off" : "stderr"); },
    report(kind, payload = {}) {
      const line = JSON.stringify({ kind, at: Date.now(), harness: opts.harness, ...payload });
      try { opts.onEvent?.(kind, payload); } catch { /* optional record */ }
      if (file) {
        try {
          if (!ready) { mkdirSync(dir, { recursive: true }); ready = true; }
          appendFileSync(file, line + "\n");
          return;
        } catch (err) {
          file = "";
          toStderr(JSON.stringify({ kind: "error", at: Date.now(), harness: opts.harness, hook: "events", message: `cannot write ${dir}: ${(err as Error).message}; reporting on stderr` }));
        }
      }
      if (!opts.quiet) toStderr(line);
    },
  };
}

export interface Decision {
  answers: Record<string, Answer>;
  usage: SystemOneUsage;
  model: string;
  ms: number;
}

/** One Jev call that validates, calls, times, and reports. `source` names who asked, a hook or a tool. */
export type Decider = (source: string, state: State, questions: Questions, extra?: Record<string, unknown>) => Promise<Decision>;

/**
 * `extra` must not use the keys the report already sets: source, state, questions, answers, usage, model, ms.
 * The client defaults to the shared, auto-selected one.
 */
export function createDecider(reporter: Reporter, client: () => Pick<JevClient, "systemOne"> = sharedJev): Decider {
  return async (source, state, questions, extra = {}) => {
    validateQuestions(questions);
    const started = performance.now();
    const result = await client().systemOne(state, questions);
    const out: Decision = { answers: result.answers, usage: result.usage, model: result.model, ms: Math.round(performance.now() - started) };
    reporter.report("jev", { source, state, questions, answers: out.answers, usage: out.usage, model: out.model, ms: out.ms, ...extra });
    return out;
  };
}

/** Parse one `JEV_EVENT ` stderr line, or null when the line is something else. */
export function parseEventLine(line: string): JevEventLine | null {
  if (!line.startsWith(EVENT_PREFIX)) return null;
  try { return JSON.parse(line.slice(EVENT_PREFIX.length)); } catch { return null; }
}
