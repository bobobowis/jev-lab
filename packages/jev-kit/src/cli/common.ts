/**
 * What every subcommand shares: the client, the reporter, list flags, stdin, and a deadline.
 */
import { JevClient, sharedJev } from "../core/client.ts";
import { createDecider, createReporter, type Decider, type Reporter } from "../events/index.ts";

export interface Io {
  stdout: { write(s: string): unknown };
  stderr: { write(s: string): unknown };
  stdin: AsyncIterable<string | Buffer>;
  /** Tests inject a client; commands otherwise build one from --mock and the keys. */
  client?: () => Pick<JevClient, "systemOne">;
}

export const processIo = (): Io => ({ stdout: process.stdout, stderr: process.stderr, stdin: process.stdin });

/**
 * `--mock` selects the offline mock explicitly; otherwise the client picks TypeSafe or OpenRouter
 * from the keys. A deadline gets its own client, so a call cut off by it is aborted, not left running.
 */
export function clientFor(mock: boolean | undefined, timeoutMs?: number): () => Pick<JevClient, "systemOne"> {
  if (!mock && !timeoutMs) return sharedJev;
  let client: JevClient | undefined;
  return () => (client ??= new JevClient(mock ? { provider: "mock" } : { timeoutMs }));
}

export function deciderFor(harness: string, opts: { mock?: boolean; quiet?: boolean; stderr?: Io["stderr"]; timeoutMs?: number; client?: Io["client"] }): { reporter: Reporter; decide: Decider } {
  const reporter = createReporter({ harness, quiet: opts.quiet, stderr: opts.stderr });
  return { reporter, decide: createDecider(reporter, opts.client ?? clientFor(opts.mock, opts.timeoutMs)) };
}

export const list = (raw: string | undefined): string[] => (raw ?? "").split(",").map((s) => s.trim()).filter(Boolean);

export async function readAll(stdin: Io["stdin"]): Promise<string> {
  let text = "";
  for await (const chunk of stdin) text += typeof chunk === "string" ? chunk : chunk.toString("utf8");
  return text;
}

/** Resolve with the work, or with `fallback` once `ms` pass. The work keeps running but nobody waits. */
export async function withDeadline<T>(work: Promise<T>, ms: number, fallback: () => T): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const late = new Promise<T>((resolve) => { timer = setTimeout(() => resolve(fallback()), ms); });
  try {
    return await Promise.race([work, late]);
  } finally {
    clearTimeout(timer);
  }
}

export class UsageError extends Error {}
