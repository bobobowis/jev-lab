import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createDecider, createReporter, EVENT_PREFIX, parseEventLine } from "../src/events/index.ts";
import { noul } from "../src/core/helpers.ts";
import { JevClient } from "../src/core/client.ts";

const sink = () => {
  const lines: string[] = [];
  return { lines, write: (chunk: string) => { lines.push(...chunk.split("\n").filter(Boolean)); } };
};
const tempDir = () => mkdtemp(join(tmpdir(), "jev-events-"));

test("without an event dir, events go to stderr as JEV_EVENT lines with the harness", () => {
  const err = sink();
  const r = createReporter({ harness: "pi", dir: "", stderr: err });
  r.report("hook", { hook: "tool_call", block: true });
  assert.equal(r.target, "stderr");
  assert.equal(err.lines.length, 1);
  assert.ok(err.lines[0].startsWith(EVENT_PREFIX));
  const e = parseEventLine(err.lines[0])!;
  assert.equal(e.kind, "hook");
  assert.equal(e.harness, "pi");
  assert.equal(e.block, true);
  assert.equal(typeof e.at, "number");
});

test("quiet reporters write nothing without an event dir", () => {
  const err = sink();
  const r = createReporter({ harness: "cli", dir: "", quiet: true, stderr: err });
  r.report("jev", { source: "gate" });
  assert.equal(r.target, "off");
  assert.deepEqual(err.lines, []);
});

test("with an event dir, each process appends to its own file and stderr stays clean", async () => {
  const dir = join(await tempDir(), "nested");
  const err = sink();
  const r = createReporter({ harness: "mcp", dir, stderr: err });
  r.report("jev", { n: 1 });
  r.report("hook", { n: 2 });
  assert.equal(r.target, join(dir, `mcp-${process.pid}.jsonl`));
  const lines = (await readFile(r.target, "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => [l.kind, l.n, l.harness]), [["jev", 1, "mcp"], ["hook", 2, "mcp"]]);
  assert.deepEqual(err.lines, []);
});

test("an unwritable event dir falls back to stderr and never throws", async () => {
  const blocker = join(await tempDir(), "file");
  await writeFile(blocker, "not a directory");
  const err = sink();
  const r = createReporter({ harness: "claude", dir: join(blocker, "events"), stderr: err });
  assert.doesNotThrow(() => r.report("hook", { hook: "PreToolUse" }));
  r.report("hook", { hook: "PostToolUse" });
  const events = err.lines.map(parseEventLine);
  assert.equal(events[0]!.kind, "error");
  assert.match(String(events[0]!.message), /cannot write/);
  assert.deepEqual(events.slice(1).map((e) => e!.hook), ["PreToolUse", "PostToolUse"]);
  assert.equal(r.target, "stderr");
});

test("onEvent receives every event, and its errors are ignored", () => {
  const seen: string[] = [];
  const r = createReporter({ harness: "pi", dir: "", quiet: true, onEvent: (kind) => { seen.push(kind); throw new Error("no session"); } });
  r.report("jev");
  r.report("ledger");
  assert.deepEqual(seen, ["jev", "ledger"]);
});

test("two processes writing 1 MB events at once leave only complete lines", async () => {
  const dir = await tempDir();
  const events = new URL("../src/events/index.ts", import.meta.url).href;
  const script = `
    import { createReporter } from ${JSON.stringify(events)};
    const r = createReporter({ harness: process.argv[1] });
    const big = "x".repeat(1024 * 1024);
    for (let i = 0; i < 8; i++) r.report("jev", { i, big });
  `;
  const run = (harness: string) => new Promise<number>((resolve, reject) => {
    const child = spawn(process.execPath, ["--input-type=module", "-e", script, harness], { env: { ...process.env, JEV_EVENT_DIR: dir }, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? -1));
  });
  assert.deepEqual(await Promise.all([run("claude"), run("mcp")]), [0, 0]);
  const files = (await readdir(dir)).sort();
  assert.equal(files.length, 2);
  for (const f of files) {
    const lines = (await readFile(join(dir, f), "utf8")).split("\n").filter(Boolean);
    assert.equal(lines.length, 8, f);
    const parsed = lines.map((l) => JSON.parse(l));
    assert.deepEqual(parsed.map((p) => p.i), [0, 1, 2, 3, 4, 5, 6, 7]);
    assert.ok(parsed.every((p) => p.big.length === 1024 * 1024 && p.harness === f.split("-")[0]));
  }
});

test("createDecider validates, calls, times, and reports one jev event", async () => {
  const err = sink();
  const reporter = createReporter({ harness: "pi", dir: "", stderr: err });
  const client = new JevClient({ provider: "mock" });
  const decide = createDecider(reporter, () => client);
  const d = await decide("tool_call bash", { command: "ls" }, { q: noul("Is it safe?") }, { tool: "bash" });
  assert.ok("q" in d.answers);
  assert.equal(typeof d.ms, "number");
  const e = parseEventLine(err.lines[0])!;
  assert.equal(e.kind, "jev");
  assert.equal(e.source, "tool_call bash");
  assert.equal(e.tool, "bash");
  await assert.rejects(decide("x", "s", { q: { type: "noul" } as any }));
});
