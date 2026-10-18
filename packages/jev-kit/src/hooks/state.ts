/**
 * What the Level 7 hooks remember between processes: the user requests seen so far and the tier
 * message waiting for the next prompt. One JSON file per session in JEV_STATE_DIR (default `.jev/`
 * in the project). Unreadable state reads as empty; a write failure never fails the hook.
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

export interface SessionState {
  requests: string[];
  /** The non-silent tier message to inject once on the next prompt. */
  pending: string | null;
}

export const stateDir = (cwd: string) => resolve(cwd, process.env.JEV_STATE_DIR?.trim() || ".jev");
const fileFor = (dir: string, session: string) => join(dir, `session-${session.replace(/[^A-Za-z0-9_-]/g, "_") || "default"}.json`);

export function readState(dir: string, session: string): SessionState {
  try {
    const s = JSON.parse(readFileSync(fileFor(dir, session), "utf8"));
    return { requests: Array.isArray(s.requests) ? s.requests.map(String) : [], pending: typeof s.pending === "string" ? s.pending : null };
  } catch {
    return { requests: [], pending: null };
  }
}

export function writeState(dir: string, session: string, state: SessionState): void {
  mkdirSync(dir, { recursive: true });
  const file = fileFor(dir, session);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state));
  renameSync(tmp, file); // two hook processes never see half a file
}
