/**
 * The session core with a fake driver: the sandbox copy, the environment the agent sees, events
 * from the event directory, and the controls every harness shares.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
// @ts-ignore plain JS modules
import { agentEnv, closeAll, getSession, start } from "../server/agent-session.mjs";
// @ts-ignore
import { DRIVERS } from "../server/drivers/index.mjs";

const calls: string[] = [];
let current: any = null;
DRIVERS.fake = {
  name: "fake", defaultModel: "fake-model-1",
  credentialEnv: () => ({ names: ["FAKE_API_KEY"], prefixes: ["FAKE_CFG_"], set: { FAKE_SET: "1" } }),
  create: () => ({
    start(s: any) { current = s; calls.push("start"); },
    async prompt(m: string) { calls.push(`prompt ${m}`); current.push("agent_start", {}); },
    async abort() { calls.push("abort"); current.push("agent_settled", {}); },
    close() { calls.push("close"); },
  }),
};

const sandbox = () => {
  const dir = mkdtempSync(join(tmpdir(), "jev-sbx-"));
  writeFileSync(join(dir, "a.ts"), "export const a = 1;\n");
  return dir;
};
const until = async (fn: () => boolean, ms = 1500) => { for (let i = 0; i < ms / 25 && !fn(); i++) await sleep(25); };

test("agentEnv: shell basics, Jev keys, the harness's own credentials, JEV_*; nothing else", () => {
  const saved = { ...process.env };
  Object.assign(process.env, { AWS_SECRET_ACCESS_KEY: "nope", FAKE_API_KEY: "k", FAKE_CFG_X: "y", TYPESAFE_API_KEY: "t", JEV_FOO: "bar", APPDATA: "C:\\x", JEV_AGENT_ENV: "EXTRA_ONE", EXTRA_ONE: "1" });
  try {
    const env = agentEnv("m", { a: 1 }, DRIVERS.fake, { eventDir: "/e", stateDir: "/s" });
    assert.equal(env.AWS_SECRET_ACCESS_KEY, undefined);
    assert.equal(env.FAKE_API_KEY, "k");
    assert.equal(env.FAKE_CFG_X, "y");
    assert.equal(env.FAKE_SET, "1");
    assert.equal(env.TYPESAFE_API_KEY, "t");
    assert.equal(env.JEV_FOO, "bar");
    assert.equal(env.APPDATA, "C:\\x");
    assert.equal(env.EXTRA_ONE, "1");
    assert.equal(env.JEV_LEVEL_CONFIG, '{"a":1}');
    assert.deepEqual([env.JEV_EVENT_DIR, env.JEV_STATE_DIR], ["/e", "/s"]);
  } finally {
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test("a session copies the sandbox, names its harness, and folds the event directory into its stream", async () => {
  const s = start({ level: 8, option: "A", extension: "x", tools: [], cwd: sandbox(), config: {}, harness: "fake" });
  assert.equal(getSession(s.id), s);
  assert.ok(existsSync(join(s.cwd, "a.ts")));
  assert.ok(existsSync(join(s.cwd, ".git")));
  const items: any[] = [];
  s.subscribe((i: any) => items.push(i));
  assert.deepEqual(items[0].data, { id: s.id, level: 8, option: "A", model: "fake-model-1", harness: "fake", cwd: s.cwd });
  appendFileSync(join(s.eventDir, "mcp-1.jsonl"), JSON.stringify({ kind: "jev", source: "ask_jev", harness: "mcp" }) + "\n");
  await until(() => items.some((i) => i.event === "jev"));
  assert.equal(items.find((i) => i.event === "jev").data.source, "ask_jev");
  s.close();
});

test("controls: a prompt while running is refused, abort settles, close stops the driver and removes the copy", async () => {
  calls.length = 0;
  const s = start({ level: 6, option: "A", extension: "x", tools: [], cwd: sandbox(), config: {}, harness: "fake" });
  await s.prompt("fix the test");
  await assert.rejects(s.prompt("again"), /Stop it first/);
  await s.abort();
  await s.prompt("again");
  s.close();
  assert.deepEqual(calls, ["start", "prompt fix the test", "abort", "prompt again", "close"]);
  assert.equal(getSession(s.id), undefined);
  await until(() => !existsSync(s.cwd), 4000); // removal waits 2.5 s for the agent to let go of its files
  assert.equal(existsSync(s.cwd), false);
});

test("closeAll resolves once every copy is gone, so the lab can exit right after", async () => {
  const a = start({ level: 8, option: "A", extension: "x", tools: [], cwd: sandbox(), config: {}, harness: "fake" });
  const b = start({ level: 8, option: "B", extension: "x", tools: [], cwd: sandbox(), config: {}, harness: "fake" });
  a.ended(0); // a's agent already exited; b's never does, so b waits out the fallback
  await closeAll();
  assert.equal(existsSync(a.cwd), false);
  assert.equal(existsSync(b.cwd), false);
  assert.equal(a.close(), a.close(), "a second close returns the same promise");
});

test("an unknown harness is refused", () => {
  assert.throws(() => start({ level: 6, option: "A", extension: "x", tools: [], cwd: sandbox(), config: {}, harness: "cursor" }), /unknown harness cursor/);
});
