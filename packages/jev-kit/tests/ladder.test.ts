/**
 * The Level 4 ladder on the hooks: the bash gate's ask and allow, the MCP gate, and how each
 * reaches Claude Code and Codex. Verdicts use a fake decider so they are exact.
 */
import test from "node:test";
import assert from "node:assert/strict";
import type { Decider } from "../src/events/index.ts";
import { bashVerdict, mcpToolName, mcpVerdict, type BashGateAnswers, type McpGateAnswers } from "../src/guards/index.ts";
import { runHarnessHook, type HarnessHookOptions } from "../src/hooks/index.ts";

const pick = (choice: string, confidence: number) => ({ type: "choice" as const, choice, confidence, probabilities: {} });
const yes = (noul: number) => ({ type: "noul" as const, noul });
const bash = (choice: string, confidence: number, destructive: number): BashGateAnswers => ({ effect: pick(choice, confidence), destructive_intent: yes(destructive) });
const mcp = (choice: string, confidence: number, outward: number): McpGateAnswers => ({ effect: pick(choice, confidence), outward: yes(outward) });

const fake = (answers: unknown): Decider => async () => ({ answers: answers as any, usage: { input_tokens: 1, output_tokens: 1 }, model: "fake", ms: 1 });
const opts = (decide: Decider, extra: Partial<HarnessHookOptions> = {}) => {
  const events: [string, Record<string, unknown>][] = [];
  return { events, o: { harness: "claude" as const, decide, report: (k: string, p: Record<string, unknown>) => events.push([k, p]), ...extra } };
};
const pre = (tool_name: string, tool_input: unknown) => ({ hook_event_name: "PreToolUse", tool_name, tool_input, cwd: "/work", session_id: "s" });

test("bash ladder: blocks stay blocks, the unsure middle asks, a sure read is approved", () => {
  const ladder = { ask: true, allowReadOnly: true };
  assert.equal(bashVerdict(bash("irreversible", 0.95, 0.9), ladder).verdict, "deny");
  assert.equal(bashVerdict(bash("irreversible", 0.95, 0.9), ladder).block, true);
  // the shadow-test rm -rf: irreversible at confidence 0.33 passed before; now it asks
  assert.match(bashVerdict(bash("irreversible", 0.33, 0.3), ladder).reason, /unsure/);
  assert.equal(bashVerdict(bash("irreversible", 0.55, 0.3), ladder).verdict, "ask");
  assert.equal(bashVerdict(bash("reversible", 0.8, 0.5), ladder).verdict, "ask");
  assert.equal(bashVerdict(bash("read_only", 0.97, 0.02), ladder).verdict, "allow");
  assert.equal(bashVerdict(bash("read_only", 0.8, 0.02), ladder).verdict, "pass");
  assert.equal(bashVerdict(bash("reversible", 0.9, 0.05), ladder).verdict, "pass");
});

test("bash ladder: off, the middle passes and nothing is approved, as gateBash", () => {
  assert.equal(bashVerdict(bash("irreversible", 0.33, 0.3)).verdict, "pass");
  assert.equal(bashVerdict(bash("read_only", 0.99, 0.01)).verdict, "pass");
  assert.equal(bashVerdict(bash("read_only", 0.99, 0.01), { ask: true }).verdict, "pass");
});

test("mcp ladder: destructive, outward, and unsure calls ask; it never denies; reads are approved only when asked to", () => {
  assert.equal(mcpVerdict(mcp("destructive", 0.99, 0.1)).verdict, "ask");
  assert.equal(mcpVerdict(mcp("destructive", 0.99, 0.1)).block, false);
  assert.match(mcpVerdict(mcp("reversible", 0.9, 0.8)).reason, /reaches outside/);
  assert.match(mcpVerdict(mcp("read_only", 0.4, 0.0)).reason, /unsure/);
  assert.equal(mcpVerdict(mcp("reversible", 0.9, 0.1)).verdict, "pass");
  assert.equal(mcpVerdict(mcp("read_only", 0.95, 0.0)).verdict, "pass");
  assert.equal(mcpVerdict(mcp("read_only", 0.95, 0.0), { allowReadOnly: true }).verdict, "allow");
  assert.deepEqual(mcpToolName("mcp__Neon__delete_branch"), { server: "Neon", tool: "delete_branch" });
  assert.equal(mcpToolName("Bash"), null);
});

test("claude PreToolUse Bash with --ask: an unsure command comes back as ask with the reason", async () => {
  const { o, events } = opts(fake(bash("irreversible", 0.33, 0.3)), { guards: ["bash"], ladder: { ask: true } });
  const r = await runHarnessHook("PreToolUse", pre("Bash", { command: "rm -rf build" }), o);
  assert.equal(r!.hookSpecificOutput.permissionDecision, "ask");
  assert.match(String(r!.hookSpecificOutput.permissionDecisionReason), /^jev-guard asks before this command: Jev is unsure/);
  assert.equal(events.at(-1)![1].verdict, "ask");
});

test("claude PreToolUse Bash with --allow-read-only: a sure read is allowed", async () => {
  const { o } = opts(fake(bash("read_only", 0.98, 0.01)), { guards: ["bash"], ladder: { allowReadOnly: true } });
  const r = await runHarnessHook("PreToolUse", pre("Bash", { command: "git status" }), o);
  assert.equal(r!.hookSpecificOutput.permissionDecision, "allow");
});

test("claude PreToolUse MCP: the mcp guard asks before a destructive call and sees the tool and its input", async () => {
  const states: any[] = [];
  const decide: Decider = async (_l, state) => { states.push(state); return { answers: mcp("destructive", 0.97, 0.1) as any, usage: { input_tokens: 1, output_tokens: 1 }, model: "f", ms: 1 }; };
  const { o } = opts(decide, { guards: ["mcp"] });
  const r = await runHarnessHook("PreToolUse", pre("mcp__Neon__delete_branch", { branch_id: "br-main" }), o);
  assert.equal(r!.hookSpecificOutput.permissionDecision, "ask");
  assert.match(String(r!.hookSpecificOutput.permissionDecisionReason), /mcp__Neon__delete_branch call: destructive/);
  assert.deepEqual(states[0], { tool: "delete_branch", server: "Neon", input: '{"branch_id":"br-main"}' });
});

test("PreToolUse MCP: off by default, and jev's own tools are never gated", async () => {
  let calls = 0;
  const counting: Decider = async () => { calls++; return { answers: mcp("destructive", 0.99, 0.9) as any, usage: { input_tokens: 1, output_tokens: 1 }, model: "f", ms: 1 }; };
  assert.equal(await runHarnessHook("PreToolUse", pre("mcp__Neon__delete_branch", {}), opts(counting).o), null);
  assert.equal(await runHarnessHook("PreToolUse", pre("mcp__jev__ask_jev", {}), opts(counting, { guards: ["mcp"] }).o), null);
  assert.equal(calls, 0);
});

test("codex: ask and allow pass to Codex's own approvals, deny still denies", async () => {
  const codex = { harness: "codex" as const, guards: ["bash" as const, "mcp" as const], ladder: { ask: true, allowReadOnly: true } };
  assert.equal(await runHarnessHook("PreToolUse", pre("Bash", { command: "rm -rf build" }), opts(fake(bash("irreversible", 0.33, 0.3)), codex).o), null);
  assert.equal(await runHarnessHook("PreToolUse", pre("mcp__Neon__delete_branch", {}), opts(fake(mcp("destructive", 0.99, 0.1)), codex).o), null);
  const r = await runHarnessHook("PreToolUse", pre("Bash", { command: "git push --force" }), opts(fake(bash("irreversible", 0.95, 0.9)), codex).o);
  assert.equal(r!.hookSpecificOutput.permissionDecision, "deny");
});

test("a Jev error on the MCP gate fails open", async () => {
  const broken: Decider = async () => { throw new Error("boom"); };
  const { o, events } = opts(broken, { guards: ["mcp"] });
  assert.equal(await runHarnessHook("PreToolUse", pre("mcp__Neon__run_sql", { sql: "drop table x" }), o), null);
  assert.equal(events.at(-1)![0], "error");
});

test("bash ladder: with ask, a command that reaches outside asks, and is never approved as a read", () => {
  const outward = { ...bash("read_only", 0.97, 0.02), outward: yes(0.8) };
  assert.match(bashVerdict(outward, { ask: true, allowReadOnly: true }).reason, /reaches outside/);
  assert.equal(bashVerdict(outward, { allowReadOnly: true }).verdict, "pass");
});

test("bash gate: the outward question is sent only when the ladder asks", async () => {
  const { gateBashCommand } = await import("../src/guards/index.ts");
  const asked: string[][] = [];
  const decide = async (_s: unknown, q: Record<string, unknown>) => { asked.push(Object.keys(q)); return { answers: bash("reversible", 0.9, 0.1) as any }; };
  await gateBashCommand("npm publish", "/work", decide);
  await gateBashCommand("npm publish", "/work", decide, { allowReadOnly: true });
  await gateBashCommand("npm publish", "/work", decide, { ask: true });
  assert.deepEqual(asked, [["effect", "destructive_intent"], ["effect", "destructive_intent"], ["effect", "destructive_intent", "outward"]]);
});
