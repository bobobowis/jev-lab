import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { JevClient } from "../src/core/client.ts";
import { createDecider, createReporter, type Decider } from "../src/events/index.ts";
import { DEFAULT_LINES } from "../src/compact/should-compact.ts";
import {
  ALL_TOOLS, LEVEL_TOOLS, makeAskJev, selectTools, toolByName,
  type ToolContext, type CompactionSource,
} from "../src/tools/index.ts";

const repo = async () => {
  const dir = await mkdtemp(join(tmpdir(), "jev-tools-"));
  await writeFile(join(dir, "session.ts"), "export function validate(token: string) { return token.length > 0; }\n");
  await writeFile(join(dir, "plans.ts"), "export const PLANS = ['free', 'pro'];\n");
  return dir;
};

function context(cwd: string, decide?: Decider, compaction?: CompactionSource) {
  const events: [string, Record<string, unknown>][] = [];
  const reporter = createReporter({ harness: "test", dir: "", quiet: true, onEvent: (k, p) => events.push([k, p]) });
  const client = new JevClient({ provider: "mock" });
  const ctx: ToolContext = {
    cwd, harness: "test",
    decide: decide ?? createDecider(reporter, () => client),
    report: (k, p) => reporter.report(k, p),
    compaction,
  };
  return { ctx, events };
}

const run = (name: string, params: Record<string, unknown>, ctx: ToolContext) => toolByName(name)!.execute(params, ctx);

test("every tool has a name, a description, and an object schema whose required keys exist", () => {
  for (const t of ALL_TOOLS) {
    assert.match(t.name, /^[a-z_]+$/);
    assert.ok(t.description.length > 40, t.name);
    assert.equal(t.parameters.type, "object", t.name);
    for (const r of t.parameters.required ?? []) assert.ok(r in (t.parameters.properties ?? {}), `${t.name}.${r}`);
  }
});

test("tool sets: by level, by name, and errors for unknown ones", () => {
  assert.deepEqual(selectTools({ level: 8 }).map((t) => t.name), LEVEL_TOOLS[8]);
  assert.deepEqual(selectTools({ names: ["ask_jev", "ask_jev_files"] }).map((t) => t.name), ["ask_jev", "ask_jev_files"]);
  assert.equal(selectTools().length, ALL_TOOLS.length);
  assert.throws(() => selectTools({ level: 3 }), /no Jev tools for level 3/);
  assert.throws(() => selectTools({ names: ["ask_gpt"] }), /unknown tool ask_gpt/);
});

test("file tools return their payloads on the mock and report a jev event with the path", async () => {
  const cwd = await repo();
  const { ctx, events } = context(cwd);
  const bool = await run("ask_jev_file_bool", { path: "session.ts", question: "Does `content` validate tokens?" }, ctx);
  assert.ok(!bool.isError, bool.text);
  assert.deepEqual(Object.keys(bool.payload as object).sort(), ["answer", "noul", "path", "usage"]);
  assert.deepEqual(JSON.parse(bool.text), JSON.parse(JSON.stringify(bool.payload)));
  const choice = await run("ask_jev_file_choice", { path: "plans.ts", question: "Which layer is `content`?", options: { domain: "Business rules", http: "Routes" } }, ctx);
  assert.ok(["domain", "http", "other"].includes((choice.payload as any).choice));
  const score = await run("ask_jev_file_score", { path: "plans.ts", question: "How risky is a change?", levels: ["Isolated", "Some callers", "Everything"] }, ctx);
  assert.equal((score.payload as any).top, 2);
  const many = await run("ask_jev_files", { paths_or_globs: ["*.ts"], questions_json: JSON.stringify({ q: { type: "noul", instructions: "Does `content` export?" } }) }, ctx);
  assert.equal((many.payload as any).calls, 2);
  const pick = await run("pick_first_file", { question: "Which file handles tokens?", candidates: [{ path: "session.ts" }, { path: "plans.ts" }] }, ctx);
  assert.ok(!pick.isError);
  const jev = events.filter(([k]) => k === "jev");
  assert.equal(jev[0][1].source, "ask_jev_file_bool");
  assert.equal(jev[0][1].path, "session.ts");
});

test("a path outside the repo is an error result and no Jev call is made", async () => {
  const cwd = await repo();
  const { ctx, events } = context(cwd);
  const r = await run("ask_jev_file_bool", { path: "../secret.txt", question: "Is it secret?" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.text, /outside the repo: \.\.\/secret\.txt/);
  assert.equal(events.filter(([k]) => k === "jev").length, 0);
});

test("ask_jev: invalid questions_json is an error result, and the next call works", async () => {
  const cwd = await repo();
  const { ctx } = context(cwd);
  const bad = await run("ask_jev", { questions_json: "{not json", state: "hello" }, ctx);
  assert.equal(bad.isError, true);
  assert.match(bad.text, /questions_json is not valid JSON/);
  const good = await run("ask_jev", { questions_json: JSON.stringify({ q: { type: "noul", instructions: "Is `files` about auth?" } }), paths: ["session.ts"] }, ctx);
  assert.ok(!good.isError, good.text);
  assert.deepEqual((good.payload as any).state_summary.files, ["session.ts"]);
});

test("ask_jev: a command the bash gate blocks never runs", async () => {
  const cwd = await repo();
  const ran: string[] = [];
  const gateSaysIrreversible: Decider = async (source) => {
    assert.equal(source, "ask_jev command gate");
    return {
      answers: {
        effect: { type: "choice", choice: "irreversible", confidence: 0.97, probabilities: { irreversible: 0.97 } },
        destructive_intent: { type: "noul", noul: 0.95 },
      } as any, usage: { input_tokens: 1, output_tokens: 1 }, model: "fake", ms: 1,
    };
  };
  const { ctx, events } = context(cwd, gateSaysIrreversible);
  const tool = makeAskJev(async (command) => { ran.push(command); return { command, exit_code: 0, stdout: "", stderr: "" }; });
  const r = await tool.execute({ questions_json: JSON.stringify({ q: { type: "noul", instructions: "Did it pass?" } }), command: "rm -rf src" }, ctx);
  assert.equal(r.isError, true);
  assert.match(r.text, /refused by the bash gate/);
  assert.deepEqual(ran, []);
  assert.ok(events.some(([k, p]) => k === "hook" && p.hook === "ask_jev command" && p.block === true));
});

test("should_i_compact: without session history it says how to get one", async () => {
  const { ctx } = context(await repo());
  const r = await run("should_i_compact", {}, ctx);
  assert.equal(r.isError, true);
  assert.match(r.text, /no session history/);
});

test("should_i_compact: with history it returns a verdict and tells the harness", async () => {
  let told = 0;
  const source: CompactionSource = {
    action: "ask_user",
    input: () => ({ requests: ["fix the billing test", "now add a logout route"], recentTurn: "Tests pass.", toolsThisTurn: ["Bash"], usage: { tokens: 20_000, pct: 10 }, compactable: true, lines: DEFAULT_LINES }),
    onEvaluation: () => { told++; },
  };
  const { ctx } = context(await repo(), undefined, source);
  const r = await run("should_i_compact", {}, ctx);
  assert.ok(!r.isError, r.text);
  const v = r.payload as any;
  assert.ok(["silent", "notice", "recommend", "request"].includes(v.tier));
  assert.equal(v.context_tokens, 20_000);
  assert.equal(told, 1);
  if (v.should_compact) assert.match(v.next_step, /\/compact/);
});
