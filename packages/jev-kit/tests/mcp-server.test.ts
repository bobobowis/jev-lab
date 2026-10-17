/**
 * jev mcp, spawned over stdio as a client would: handshake, tool sets, errors, and payloads equal
 * to the package's tools (the pi adapter test holds pi to the same payloads).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { JevClient } from "../src/core/client.ts";
import { createDecider, createReporter } from "../src/events/index.ts";
import { askJevFileChoice, LEVEL_TOOLS } from "../src/tools/index.ts";

const BIN = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));
const repo = () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-mcp-"));
  writeFileSync(join(dir, "plans.ts"), "export const PLANS = ['free', 'pro'];\n");
  return dir;
};

function start(args: string[], cwd: string) {
  const child = spawn(process.execPath, [BIN, "mcp", "--mock", ...args], { cwd, env: { ...process.env, JEV_EVENT_DIR: join(cwd, ".events") } }) as ChildProcessWithoutNullStreams;
  let buf = "";
  const waiting = new Map<number, (m: any) => void>();
  child.stdout.on("data", (c) => {
    buf += c;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const m = JSON.parse(buf.slice(0, i)); buf = buf.slice(i + 1);
      waiting.get(m.id)?.(m);
    }
  });
  let next = 1;
  const request = (method: string, params?: unknown) => new Promise<any>((resolve) => {
    const id = next++;
    waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
  });
  const notify = (method: string) => child.stdin.write(JSON.stringify({ jsonrpc: "2.0", method }) + "\n");
  const raw = (line: string) => child.stdin.write(line + "\n");
  const stop = () => new Promise<number | null>((r) => { child.on("exit", r); child.stdin.end(); });
  return { child, request, notify, raw, stop };
}

const init = { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "0" } };

test("handshake: initialize echoes a known protocol version, names the server, and carries the usage guidance", async () => {
  const s = start(["--level", "10"], repo());
  const r = await s.request("initialize", init);
  assert.equal(r.result.protocolVersion, "2025-06-18");
  assert.deepEqual(r.result.capabilities, { tools: { listChanged: false } });
  assert.equal(r.result.serverInfo.name, "jev");
  assert.match(r.result.instructions, /You have ask_jev/);
  s.notify("notifications/initialized");
  assert.deepEqual((await s.request("ping")).result, {});
  const unknownVersion = await s.request("initialize", { ...init, protocolVersion: "1999-01-01" });
  assert.equal(unknownVersion.result.protocolVersion, "2025-11-25");
  assert.equal(await s.stop(), 0);
});

test("tools/list: exactly the level's tools, or the named ones", async () => {
  const dir = repo();
  for (const [args, expected] of [[["--level", "8"], LEVEL_TOOLS[8]], [["--tools", "ask_jev,ask_jev_files"], ["ask_jev", "ask_jev_files"]]] as const) {
    const s = start([...args], dir);
    await s.request("initialize", init);
    const r = await s.request("tools/list");
    assert.deepEqual(r.result.tools.map((t: any) => t.name), expected);
    assert.equal(r.result.tools[0].inputSchema.type, "object");
    await s.stop();
  }
});

test("errors: an unknown tool and an unknown method are JSON-RPC errors, a bad line too, and the server keeps going", async () => {
  const s = start(["--level", "8"], repo());
  await s.request("initialize", init);
  const unknown = await s.request("tools/call", { name: "ask_gpt", arguments: {} });
  assert.equal(unknown.error.code, -32602);
  assert.match(unknown.error.message, /Unknown tool: ask_gpt/);
  assert.equal((await s.request("resources/list")).error.code, -32601);
  s.raw("{not json");
  assert.deepEqual((await s.request("ping")).result, {});
  await s.stop();
});

test("a failing tool is an isError result and the next call works", async () => {
  const s = start(["--level", "8"], repo());
  await s.request("initialize", init);
  const bad = await s.request("tools/call", { name: "ask_jev_file_bool", arguments: { path: "../secret.txt", question: "Secret?" } });
  assert.equal(bad.result.isError, true);
  assert.match(bad.result.content[0].text, /outside the repo/);
  const good = await s.request("tools/call", { name: "ask_jev_file_bool", arguments: { path: "plans.ts", question: "Does `content` list plans?" } });
  assert.equal(good.result.isError, false);
  assert.equal(good.result.structuredContent.path, "plans.ts");
  await s.stop();
});

test("payload parity: the MCP result equals the package tool's result", async () => {
  const dir = repo();
  const s = start(["--level", "8"], dir);
  await s.request("initialize", init);
  const args = { path: "plans.ts", question: "Which layer is `content`?", options: { domain: "Business rules", http: "Routes" } };
  const viaMcp = await s.request("tools/call", { name: "ask_jev_file_choice", arguments: args });
  await s.stop();
  const client = new JevClient({ provider: "mock" });
  const direct = await askJevFileChoice.execute(args, { cwd: dir, harness: "test", decide: createDecider(createReporter({ harness: "t", dir: "", quiet: true }), () => client), report: () => {} });
  assert.deepEqual(viaMcp.result.structuredContent, JSON.parse(JSON.stringify(direct.payload)));
  assert.equal(viaMcp.result.content[0].text, direct.text);
});

test("should_i_compact over MCP: without hook notes it explains, with them it answers", async () => {
  const dir = repo();
  const s = start(["--level", "7"], dir);
  await s.request("initialize", init);
  const none = await s.request("tools/call", { name: "should_i_compact", arguments: {} });
  assert.equal(none.result.isError, true);
  assert.match(none.result.content[0].text, /no session history/);
  const { mkdirSync } = await import("node:fs");
  mkdirSync(join(dir, ".jev"));
  writeFileSync(join(dir, ".jev", "session-abc.json"), JSON.stringify({ requests: ["fix the test", "now the README"], pending: null }));
  const some = await s.request("tools/call", { name: "should_i_compact", arguments: {} });
  assert.equal(some.result.isError, false, some.result.content[0].text);
  assert.equal(some.result.structuredContent.context_tokens, null);
  await s.stop();
});
