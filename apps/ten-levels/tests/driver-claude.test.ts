/**
 * The Claude Code driver against the stream-json captured from Claude Code 2.1.302
 * (tests/fixtures/claude/). A fake `claude` on PATH replays the capture: each line the driver
 * writes to stdin releases the recorded output up to the next recorded input.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
// @ts-ignore plain JS modules
import { createTranslator, plan } from "../server/drivers/claude.mjs";
// @ts-ignore
import { start } from "../server/agent-session.mjs";

const FIXTURES = fileURLToPath(new URL("./fixtures/claude/", import.meta.url));
const records = (name: string) => readFileSync(join(FIXTURES, name), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("plan: Level 8 gets its built-ins, ToolSearch, and the three tools over MCP, slash commands off", () => {
  const p = plan({ level: 8, tools: ["read", "bash", "ask_jev_file_bool", "ask_jev_file_choice", "ask_jev_file_score"], config: {}, model: "claude-haiku-5-5", home: "/h", cwd: "/sbx" });
  const flag = (f: string) => p.args[p.args.indexOf(f) + 1];
  assert.equal(flag("--tools"), "Read,Bash,ToolSearch");
  assert.equal(flag("--allowedTools"), "Read,Bash,ToolSearch,mcp__jev__ask_jev_file_bool,mcp__jev__ask_jev_file_choice,mcp__jev__ask_jev_file_score");
  assert.equal(flag("--setting-sources"), "");
  assert.ok(p.args.includes("--strict-mcp-config") && p.args.includes("--disable-slash-commands"));
  const mcp = p.files[join("/h", "claude", "mcp.json")];
  assert.deepEqual(mcp.mcpServers.jev.args.slice(-4), ["--tools", "ask_jev_file_bool,ask_jev_file_choice,ask_jev_file_score", "--cwd", "/sbx"]);
  assert.deepEqual(p.files[join("/h", "claude", "settings.json")].hooks, {});
});

test("plan: Level 6 gates become hooks, Level 7 keeps /compact and drops compact_now, Level 10 adds the nudge", () => {
  const six = plan({ level: 6, tools: ["read", "bash", "edit", "write"], config: { gates: ["A"] }, model: "m", home: "/h", cwd: "/s" });
  const hooks = six.files[join("/h", "claude", "settings.json")].hooks;
  assert.deepEqual(Object.keys(hooks), ["PreToolUse"]);
  assert.equal(hooks.PreToolUse[0].matcher, "Bash");
  assert.equal(six.args[six.args.indexOf("--tools") + 1], "Read,Bash,Edit,Write");

  const seven = plan({ level: 7, tools: ["read", "bash", "edit", "write", "compact_now", "should_i_compact"], config: { lines: { notice: 6000, recommend: 10000, request: 14000 } }, model: "m", home: "/h", cwd: "/s" });
  assert.equal(seven.args.includes("--disable-slash-commands"), false);
  assert.doesNotMatch(seven.args.join(" "), /compact_now/);
  const h7 = seven.files[join("/h", "claude", "settings.json")].hooks;
  assert.match(h7.Stop[0].hooks[0].command, /--event Stop --compact --lines 6000,10000,14000$/);

  const ten = plan({ level: 10, tools: ["read", "bash", "edit", "write", "ask_jev"], config: {}, model: "m", home: "/h", cwd: "/s" });
  assert.match(ten.args[ten.args.indexOf("--append-system-prompt") + 1], /You have ask_jev/);
});

test("translator: the captured session becomes tool rows, messages, stats, and a compaction", () => {
  const events: [string, any][] = [];
  const translate = createTranslator((e: string, d: any) => events.push([e, d]));
  for (const name of ["session-tools-interrupt.jsonl", "session-deny-compact.jsonl"]) for (const r of records(name)) if (r.line) translate(r.line);
  const of = (e: string) => events.filter(([n]) => n === e).map(([, d]) => d);
  const starts = of("tool_execution_start").map((d) => d.toolName);
  assert.deepEqual(starts.slice(0, 5), ["Bash", "Read", "ToolSearch", "mcp__fixture__echo", "Write"]);
  const ends = of("tool_execution_end");
  assert.equal(ends.length, starts.length);
  assert.ok(ends.some((d) => d.isError && /jev-guard blocked this command: FIXTURE-DENY-REASON/.test(d.result.content[0].text)));
  assert.deepEqual(of("state")[0].model, { provider: "anthropic", id: "claude-haiku-5-5" });
  const stats = of("stats");
  assert.equal(stats.length, of("agent_settled").length);
  assert.equal(stats[0].cost, 0.00370782);
  assert.equal(stats[0].contextUsage.contextWindow, 1_000_000);
  assert.ok(stats[0].contextUsage.tokens > 10_000);
  assert.deepEqual(of("compaction_end")[0].result, { tokensBefore: 17347, estimatedTokensAfter: 2106 });
  assert.ok(of("message_end").some((d) => d.message.content.some((c: any) => c.text === "math.ts")));
  assert.equal(of("log").length, 0, "every captured message type is handled");
});

/** A fake `claude` that replays a capture, one recorded input at a time. */
function fakeClaude(capture: string) {
  const dir = mkdtempSync(join(tmpdir(), "jev-fake-claude-"));
  const script = join(dir, "replay.mjs");
  writeFileSync(script, `
    import { readFileSync } from "node:fs";
    if (process.argv.includes("--version")) { console.log("2.1.302 (Claude Code)"); process.exit(0); }
    const recs = readFileSync(${JSON.stringify(join(FIXTURES, capture))}, "utf8").trim().split("\\n").map((l) => JSON.parse(l));
    let i = 0, buf = "";
    const release = () => { i++; while (i < recs.length && !recs[i].sent) process.stdout.write(JSON.stringify(recs[i++].line) + "\\n"); };
    while (i < recs.length && !recs[i].sent) i++;
    process.stdin.on("data", (c) => { buf += c; let n; while ((n = buf.indexOf("\\n")) >= 0) { buf = buf.slice(n + 1); release(); } });
    process.stdin.on("end", () => process.exit(0));
  `);
  if (process.platform === "win32") writeFileSync(join(dir, "claude.cmd"), `@"${process.execPath}" "${script}" %*\r\n`);
  else { writeFileSync(join(dir, "claude"), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`); chmodSync(join(dir, "claude"), 0o755); }
  return dir;
}

test("end to end: prompt, interrupt, follow up, and close, through the session and a replayed CLI", async () => {
  const bin = fakeClaude("session-tools-interrupt.jsonl");
  const path = process.env.PATH;
  process.env.PATH = `${bin}${delimiter}${path}`;
  const sandbox = mkdtempSync(join(tmpdir(), "jev-sbx-claude-"));
  writeFileSync(join(sandbox, "math.ts"), "export const add = (a: number, b: number) => a + b;\n");
  try {
    const s = start({ level: 8, option: "A", extension: "unused", tools: ["read", "bash", "ask_jev_file_bool"], cwd: sandbox, config: {}, harness: "claude" });
    const items: any[] = [];
    s.subscribe((i: any) => items.push(i));
    const waitFor = async (pred: () => boolean) => { for (let i = 0; i < 200 && !pred(); i++) await sleep(20); assert.ok(pred()); };
    const settledCount = () => items.filter((i) => i.event === "agent_settled").length;

    await s.prompt("do the five steps");
    await assert.rejects(s.prompt("too soon"), /Stop it first/);
    await waitFor(() => settledCount() === 1);
    assert.ok(items.some((i) => i.event === "tool_execution_start" && i.data.toolName === "mcp__fixture__echo"));

    await s.prompt("run sleep 40");
    await waitFor(() => items.some((i) => i.event === "tool_execution_start" && i.data.args?.command === "sleep 40"));
    await s.abort();
    await waitFor(() => settledCount() === 2);
    assert.equal(items.filter((i) => i.event === "abort").length, 1);

    await s.prompt("reply ready");
    await waitFor(() => settledCount() === 3);
    assert.ok(items.some((i) => i.event === "message_end" && i.data.message.content[0]?.text === "ready"));
    assert.equal(items.find((i) => i.event === "session").data.harness, "claude");
    s.close();
  } finally {
    process.env.PATH = path;
  }
});
