import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { tailEventDir } from "../server/event-tail.mjs";

const fresh = () => mkdtempSync(join(tmpdir(), "jev-tail-"));

test("a line written in chunks is delivered once, after its newline", () => {
  const dir = fresh();
  const seen: unknown[] = [];
  const tail = tailEventDir(dir, (e) => seen.push(e), { pollMs: 10_000 });
  const file = join(dir, "claude-1.jsonl");
  const line = JSON.stringify({ kind: "hook", n: 1, big: "y".repeat(50_000) });
  appendFileSync(file, line.slice(0, 100));
  tail.flush();
  assert.equal(seen.length, 0);
  appendFileSync(file, line.slice(100, 30_000));
  tail.flush();
  assert.equal(seen.length, 0);
  appendFileSync(file, line.slice(30_000) + "\n" + JSON.stringify({ kind: "jev", n: 2 }) + "\n");
  tail.flush();
  assert.deepEqual(seen.map((e: any) => e.n), [1, 2]);
  tail.stop();
});

test("a file that appears mid-session is followed, and order holds per file", () => {
  const dir = fresh();
  const seen: [number, string][] = [];
  const tail = tailEventDir(dir, (e: any, file) => seen.push([e.n, file]), { pollMs: 10_000 });
  writeFileSync(join(dir, "pi-1.jsonl"), `{"n":1}\n{"n":2}\n`);
  tail.flush();
  writeFileSync(join(dir, "mcp-2.jsonl"), `{"n":3}\n`);
  appendFileSync(join(dir, "pi-1.jsonl"), `{"n":4}\n`);
  tail.flush();
  assert.deepEqual(seen.filter(([, f]) => f === "pi-1.jsonl").map(([n]) => n), [1, 2, 4]);
  assert.deepEqual(seen.filter(([, f]) => f === "mcp-2.jsonl").map(([n]) => n), [3]);
  tail.stop();
});

test("new lines arrive without an explicit flush, by watch or poll", async () => {
  const dir = fresh();
  const seen: unknown[] = [];
  const tail = tailEventDir(dir, (e) => seen.push(e), { pollMs: 20 });
  appendFileSync(join(dir, "codex-9.jsonl"), `{"kind":"hook"}\n`);
  for (let i = 0; i < 50 && !seen.length; i++) await sleep(20);
  assert.equal(seen.length, 1);
  tail.stop();
});

test("bad lines are reported and skipped, other files are ignored", () => {
  const dir = fresh();
  const seen: unknown[] = [];
  const errors: Error[] = [];
  writeFileSync(join(dir, "notes.txt"), `{"n":0}\n`);
  writeFileSync(join(dir, "pi-1.jsonl"), `not json\n{"n":1}\n`);
  const tail = tailEventDir(dir, (e) => seen.push(e), { pollMs: 10_000, onError: (e) => errors.push(e) });
  assert.deepEqual(seen, [{ n: 1 }]);
  assert.equal(errors.length, 1);
  tail.stop();
});

test("a missing directory is not an error until it exists", () => {
  const dir = join(fresh(), "later");
  const tail = tailEventDir(dir, () => {}, { pollMs: 10_000 });
  assert.doesNotThrow(() => tail.flush());
  tail.stop();
});

test("a multi-byte character split across writes arrives intact", () => {
  const dir = fresh();
  const seen: any[] = [];
  const tail = tailEventDir(dir, (e) => seen.push(e), { pollMs: 10_000 });
  const bytes = Buffer.from(JSON.stringify({ text: "café ✓ 日本" }) + "\n");
  const cut = bytes.indexOf(Buffer.from("✓")) + 1; // inside the 3-byte check mark
  appendFileSync(join(dir, "pi-1.jsonl"), bytes.subarray(0, cut));
  tail.flush();
  appendFileSync(join(dir, "pi-1.jsonl"), bytes.subarray(cut));
  tail.flush();
  assert.equal(seen[0].text, "café ✓ 日本");
  tail.stop();
});
