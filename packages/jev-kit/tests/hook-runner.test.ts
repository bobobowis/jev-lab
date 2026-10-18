/**
 * jev hook against the payloads captured from Claude Code 2.1.302 (tests/fixtures/claude/hooks.jsonl).
 * Verdicts use a fake decider so they are exact; the CLI wiring runs on the mock.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { Decider } from "../src/events/index.ts";
import { patchTargets, runHarnessHook, type HarnessHookOptions } from "../src/hooks/index.ts";
import { main } from "../src/cli/main.ts";

const captured = readFileSync(new URL("./fixtures/claude/hooks.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const fixture = (event: string, tool?: string) => structuredClone(captured.find((c) => c.event === event && (!tool || c.payload.tool_name === tool))!.payload);

const fake = (answers: Record<string, unknown>): Decider => async () => ({ answers: answers as any, usage: { input_tokens: 1, output_tokens: 1 }, model: "fake", ms: 1 });
const IRREVERSIBLE = { effect: { type: "choice", choice: "irreversible", confidence: 0.99, probabilities: {} }, destructive_intent: { type: "noul", noul: 0.9 } };
const READ_ONLY = { effect: { type: "choice", choice: "read_only", confidence: 1, probabilities: {} }, destructive_intent: { type: "noul", noul: 0.01 } };

function opts(decide: Decider, extra: Partial<HarnessHookOptions> = {}) {
  const events: [string, Record<string, unknown>][] = [];
  return { events, o: { harness: "claude" as const, decide, report: (k: string, p: Record<string, unknown>) => events.push([k, p]), ...extra } };
}

test("PreToolUse Bash: a force push is denied with the guard's reason", async () => {
  const p = fixture("PreToolUse", "Bash");
  p.tool_input.command = "git push --force origin main";
  const { o, events } = opts(fake(IRREVERSIBLE));
  const r = await runHarnessHook("PreToolUse", p, o);
  assert.equal(r!.hookSpecificOutput.hookEventName, "PreToolUse");
  assert.equal(r!.hookSpecificOutput.permissionDecision, "deny");
  assert.match(String(r!.hookSpecificOutput.permissionDecisionReason), /^jev-guard blocked this command: irreversible/);
  assert.equal(events.at(-1)![1].hook, "PreToolUse");
});

test("PreToolUse Bash: ls is allowed with no output", async () => {
  const { o } = opts(fake(READ_ONLY));
  assert.equal(await runHarnessHook("PreToolUse", fixture("PreToolUse", "Bash"), o), null);
});

test("PreToolUse Write: the captured write is checked by the write gate, a credential is denied", async () => {
  const p = fixture("PreToolUse", "Write");
  const seen: unknown[] = [];
  const secret: Decider = async (_s, state) => { seen.push(state); return { answers: { kind: { type: "choice", choice: "config", confidence: 0.9, probabilities: {} }, contains_secret: { type: "noul", noul: 0.96 } } as any, usage: { input_tokens: 1, output_tokens: 1 }, model: "f", ms: 1 }; };
  const r = await runHarnessHook("PreToolUse", p, opts(secret).o);
  assert.match(String(r!.hookSpecificOutput.permissionDecisionReason), /^jev-guard blocked this Write: contains a credential/);
  assert.equal((seen[0] as any).path, p.tool_input.file_path);
});

test("PreToolUse Edit and MultiEdit: the new text is what the gate sees", async () => {
  const states: any[] = [];
  const clean: Decider = async (_s, state) => { states.push(state); return { answers: { kind: { type: "choice", choice: "source_code", confidence: 0.9, probabilities: {} }, contains_secret: { type: "noul", noul: 0.01 } } as any, usage: { input_tokens: 1, output_tokens: 1 }, model: "f", ms: 1 }; };
  const base = fixture("PreToolUse", "Write");
  await runHarnessHook("PreToolUse", { ...base, tool_name: "Edit", tool_input: { file_path: base.tool_input.file_path, old_string: "a", new_string: "NEW" } }, opts(clean).o);
  await runHarnessHook("PreToolUse", { ...base, tool_name: "MultiEdit", tool_input: { file_path: base.tool_input.file_path, edits: [{ new_string: "ONE" }, { new_string: "TWO" }] } }, opts(clean).o);
  assert.deepEqual(states.map((s) => s.content), ["NEW", "ONE\nTWO"]);
});

test("PreToolUse: tools that are neither shell nor writes make no call", async () => {
  let calls = 0;
  const { o } = opts(async () => { calls++; return null as any; });
  assert.equal(await runHarnessHook("PreToolUse", fixture("PreToolUse", "Read"), o), null);
  assert.equal(await runHarnessHook("PreToolUse", fixture("PreToolUse", "mcp__fixture__echo"), o), null);
  assert.equal(calls, 0);
});

test("PostToolUse Read: the file content is screened and a banner comes back as additionalContext", async () => {
  const p = fixture("PostToolUse", "Read");
  const states: any[] = [];
  const flag: Decider = async (_s, state) => { states.push(state); return { answers: { injection: { type: "noul", noul: 0.9 } } as any, usage: { input_tokens: 1, output_tokens: 1 }, model: "f", ms: 1 }; };
  const r = await runHarnessHook("PostToolUse", p, opts(flag).o);
  assert.equal(r!.hookSpecificOutput.hookEventName, "PostToolUse");
  assert.match(String(r!.hookSpecificOutput.additionalContext), /^\[jev-guard\] This content contains instructions/);
  assert.equal(states[0].content, p.tool_response.file.content);
  assert.equal(states[0].tool, "Read");
});

test("PostToolUse Bash: stdout and stderr are screened, clean output adds nothing", async () => {
  const states: any[] = [];
  const clean: Decider = async (_s, state) => { states.push(state); return { answers: { injection: { type: "noul", noul: 0.01 } } as any, usage: { input_tokens: 1, output_tokens: 1 }, model: "f", ms: 1 }; };
  assert.equal(await runHarnessHook("PostToolUse", fixture("PostToolUse", "Bash"), opts(clean).o), null);
  assert.equal(states[0].content, "math.ts");
});

test("Level 7: the first request is silent, a later gear switch is injected once on the next prompt", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-state-"));
  process.env.JEV_STATE_DIR = dir;
  const transcript = join(dir, "t.jsonl");
  writeFileSync(transcript, JSON.stringify({ type: "assistant", message: { usage: { input_tokens: 2, cache_creation_input_tokens: 60_000, cache_read_input_tokens: 100_000 } } }) + "\n");
  const switched = fake({
    switched_gears: { type: "noul", noul: 0.95 }, at_boundary: { type: "noul", noul: 0.9 },
    needs_history: { type: "score", score: 0, legend: { 0: "a", 1: "b", 2: "c" } }, mid_operation: { type: "noul", noul: 0.05 },
  });
  const { o, events } = opts(switched, { compact: true, window: 1_000_000 });
  const prompt = fixture("UserPromptSubmit");
  const stop = { ...fixture("Stop"), transcript_path: transcript };

  assert.equal(await runHarnessHook("UserPromptSubmit", { ...prompt, prompt: "fix the billing test" }, o), null);
  assert.equal(await runHarnessHook("Stop", stop, o), null);
  assert.equal(events.at(-1)![1].skipped, true);

  await runHarnessHook("UserPromptSubmit", { ...prompt, prompt: "now write the README" }, o);
  await runHarnessHook("Stop", stop, o);
  const tier = events.at(-1)![1];
  assert.equal(tier.tier, "request");
  assert.deepEqual(tier.usage, { tokens: 160_002, pct: 16.0002 });

  const injected = await runHarnessHook("UserPromptSubmit", { ...prompt, prompt: "ok" }, o);
  assert.match(String(injected!.hookSpecificOutput.additionalContext), /ask the user to run \/compact/);
  assert.equal(await runHarnessHook("UserPromptSubmit", { ...prompt, prompt: "again" }, o), null);
  delete process.env.JEV_STATE_DIR;
});

test("Level 7 off: prompts and stops do nothing", async () => {
  let calls = 0;
  const { o } = opts(async () => { calls++; return null as any; });
  assert.equal(await runHarnessHook("UserPromptSubmit", fixture("UserPromptSubmit"), o), null);
  assert.equal(await runHarnessHook("Stop", fixture("Stop"), o), null);
  assert.equal(calls, 0);
});

test("PreCompact is reported only", async () => {
  const p = captured.find((c) => c.event === "PreCompact")!.payload;
  const { o, events } = opts(fake({}));
  assert.equal(await runHarnessHook("PreCompact", p, o), null);
  assert.deepEqual(events, [["hook", { hook: "PreCompact", trigger: "manual", custom_instructions: "keep the file names" }]]);
});

test("apply_patch targets: every file section with its added lines", () => {
  assert.deepEqual(patchTargets("*** Begin Patch\n*** Add File: notes.txt\n+done\n*** Update File: src/a.ts\n@@\n-old\n+new\n*** Delete File: gone.ts\n*** End Patch"), [
    { path: "notes.txt", content: "done\n" }, { path: "src/a.ts", content: "new\n" }, { path: "gone.ts", content: "" },
  ]);
});

// The CLI, end to end on the mock.
function io(stdin: string) {
  const out: string[] = [], err: string[] = [];
  return { out, err, io: { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => err.push(s) }, stdin: Readable.from([stdin]) } };
}

test("jev hook: answers on stdout with exit 0, and fails open on a bad payload", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-cli-events-"));
  process.env.JEV_EVENT_DIR = dir;
  const ok = io(JSON.stringify(fixture("PreToolUse", "Bash")));
  assert.equal(await main(["hook", "--harness", "claude", "--event", "PreToolUse", "--mock"], ok.io), 0);
  assert.ok(ok.out.join("") === "" || JSON.parse(ok.out.join("")).hookSpecificOutput);
  const bad = io("{not json");
  assert.equal(await main(["hook", "--harness", "claude", "--event", "PreToolUse", "--mock"], bad.io), 0);
  assert.equal(bad.out.join(""), "");
  delete process.env.JEV_EVENT_DIR;
});

test("jev hook: a slow Jev call times out and allows", async () => {
  const slow = io(JSON.stringify(fixture("PreToolUse", "Bash")));
  const original = globalThis.fetch;
  process.env.JEV_EVENT_DIR = mkdtempSync(join(tmpdir(), "jev-slow-"));
  process.env.OPENROUTER_API_KEY = "test-key-not-real";
  process.env.JEV_LIVE = "1";
  // Never answers on its own; only the client's abort ends it, as a hung endpoint would.
  globalThis.fetch = ((_url: unknown, init?: RequestInit) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(init.signal!.reason)))) as typeof fetch;
  try {
    const started = Date.now();
    assert.equal(await main(["hook", "--harness", "claude", "--event", "PreToolUse", "--timeout-ms", "50"], slow.io), 0);
    assert.equal(slow.out.join(""), "");
    assert.ok(Date.now() - started < 2000);
  } finally {
    globalThis.fetch = original;
    delete process.env.OPENROUTER_API_KEY;
    delete process.env.JEV_LIVE;
    delete process.env.JEV_EVENT_DIR;
  }
});

test("jev hook: bad options exit 1, never 2", async () => {
  for (const args of [["--harness", "cursor", "--event", "Stop"], ["--harness", "claude"], ["--harness", "claude", "--event", "Stop", "--guards", "net"], ["--nope"]]) {
    const r = io("{}");
    assert.equal(await main(["hook", ...args], r.io), 1, args.join(" "));
  }
});

// Codex, against the payloads captured from codex-cli 0.162.1 (tests/fixtures/codex/).
const codexCaptured = readFileSync(new URL("./fixtures/codex/hooks.jsonl", import.meta.url), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const codexFixture = (event: string, tool?: string) => structuredClone(codexCaptured.find((c) => c.event === event && (!tool || c.payload.tool_name === tool))!.payload);

test("codex PreToolUse Bash: the captured payload maps to the bash gate and a deny", async () => {
  const p = codexFixture("PreToolUse", "Bash");
  p.tool_input.command = "rm -rf src";
  const states: any[] = [];
  const decide: Decider = async (_s, state) => { states.push(state); return { answers: IRREVERSIBLE as any, usage: { input_tokens: 1, output_tokens: 1 }, model: "f", ms: 1 }; };
  const r = await runHarnessHook("PreToolUse", p, { harness: "codex", decide, report: () => {} });
  assert.equal(r!.hookSpecificOutput.permissionDecision, "deny");
  assert.deepEqual(states[0], { command: "rm -rf src", cwd: p.cwd });
});

test("codex PreToolUse apply_patch: each file in the patch is write-gated with its added lines", async () => {
  const p = codexFixture("PreToolUse", "apply_patch");
  const states: any[] = [];
  const decide: Decider = async (_s, state) => { states.push(state); return { answers: { kind: { type: "choice", choice: "docs", confidence: 0.9, probabilities: {} }, contains_secret: { type: "noul", noul: 0.01 } } as any, usage: { input_tokens: 1, output_tokens: 1 }, model: "f", ms: 1 }; };
  assert.equal(await runHarnessHook("PreToolUse", p, { harness: "codex", decide, report: () => {} }), null);
  assert.deepEqual(states, [{ path: "notes.txt", content: "done\n" }]);
  p.tool_input.command = "*** Begin Patch\n*** Add File: ../../etc/evil\n+x\n*** End Patch";
  const r = await runHarnessHook("PreToolUse", p, { harness: "codex", decide, report: () => {} });
  assert.match(String(r!.hookSpecificOutput.permissionDecisionReason), /^jev-guard blocked this apply_patch: outside the repo/);
});

test("codex PostToolUse Bash: the string response is screened", async () => {
  const states: any[] = [];
  const decide: Decider = async (_s, state) => { states.push(state); return { answers: { injection: { type: "noul", noul: 0.95 } } as any, usage: { input_tokens: 1, output_tokens: 1 }, model: "f", ms: 1 }; };
  const r = await runHarnessHook("PostToolUse", codexFixture("PostToolUse", "Bash"), { harness: "codex", decide, report: () => {} });
  assert.equal(states[0].content, "math.ts\n");
  assert.match(String(r!.hookSpecificOutput.additionalContext), /^\[jev-guard\]/);
});

test("codex Stop: usage and the window come from the rollout's last token_count", async () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-codex-state-"));
  process.env.JEV_STATE_DIR = dir;
  const rollout = join(dir, "rollout.jsonl");
  writeFileSync(rollout, readFileSync(new URL("./fixtures/codex/rollout-token-count.jsonl", import.meta.url)));
  const events: [string, Record<string, unknown>][] = [];
  const decide = fake({
    switched_gears: { type: "noul", noul: 0.9 }, at_boundary: { type: "noul", noul: 0.9 },
    needs_history: { type: "score", score: 0, legend: { 0: "a", 1: "b", 2: "c" } }, mid_operation: { type: "noul", noul: 0.1 },
  });
  const o = { harness: "codex" as const, compact: true, lines: { notice: 1000, recommend: 2000, request: 100_000 }, decide, report: (k: string, p: Record<string, unknown>) => events.push([k, p]) };
  await runHarnessHook("UserPromptSubmit", { ...codexFixture("UserPromptSubmit"), prompt: "first" }, o);
  await runHarnessHook("UserPromptSubmit", { ...codexFixture("UserPromptSubmit"), prompt: "second" }, o);
  await runHarnessHook("Stop", { ...codexFixture("Stop"), transcript_path: rollout }, o);
  const tier = events.at(-1)![1];
  assert.deepEqual(tier.usage, { tokens: 15_401, pct: (15_401 / 475_000) * 100 });
  assert.equal(tier.tier, "recommend");
  delete process.env.JEV_STATE_DIR;
});
