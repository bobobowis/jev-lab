/**
 * Harness selection through the lab's HTTP API, with PATH pointing at fake CLIs or at nothing.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
// @ts-ignore plain JS modules
import { server } from "../server/server.mjs";
// @ts-ignore
import { chooseHarness, harnessState } from "../server/drivers/index.mjs";
// @ts-ignore
import { getSession } from "../server/agent-session.mjs";

/** A PATH dir holding fake CLIs that answer --version and otherwise wait. */
function pathWith(...names: string[]) {
  const dir = mkdtempSync(join(tmpdir(), "jev-path-"));
  for (const name of names) {
    if (process.platform === "win32") writeFileSync(join(dir, `${name}.cmd`), `@"${process.execPath}" -e "setTimeout(()=>{},60000)"\r\n`);
    else { writeFileSync(join(dir, name), `#!/bin/sh\n[ "$1" = "--version" ] && echo 9.9.9 && exit 0\nexec "${process.execPath}" -e "setTimeout(()=>{},60000)"\n`); chmodSync(join(dir, name), 0o755); }
  }
  return dir;
}

const base = await new Promise<string>((resolve) => server.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server.address() as AddressInfo).port}`)));
test.after(() => server.close());

async function withPath<T>(dir: string, agent: string | undefined, fn: () => Promise<T>): Promise<T> {
  const saved = { PATH: process.env.PATH, JEV_AGENT: process.env.JEV_AGENT };
  process.env.PATH = dir;
  if (agent === undefined) delete process.env.JEV_AGENT; else process.env.JEV_AGENT = agent;
  try { return await fn(); } finally {
    process.env.PATH = saved.PATH;
    if (saved.JEV_AGENT === undefined) delete process.env.JEV_AGENT; else process.env.JEV_AGENT = saved.JEV_AGENT;
  }
}

const post = (path: string, body: unknown) => fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

test("chooseHarness: the request, then JEV_AGENT, then PATH order pi, claude, codex", () => {
  const both = pathWith("claude", "codex");
  assert.equal(chooseHarness("", { PATH: both }), "claude");
  assert.equal(chooseHarness("codex", { PATH: both }), "codex");
  assert.equal(chooseHarness("", { PATH: both, JEV_AGENT: "codex" }), "codex");
  assert.equal(chooseHarness("claude", { PATH: both, JEV_AGENT: "codex" }), "claude");
  assert.throws(() => chooseHarness("pi", { PATH: both }), /pi is not installed or not on PATH\. Install it with: pnpm add -g @earendil-works\/pi-coding-agent/);
  assert.throws(() => chooseHarness("cursor", { PATH: both }), /unknown harness "cursor"/);
  assert.deepEqual(harnessState({ PATH: both }).harnesses.map((h: any) => [h.name, h.available]), [["pi", false], ["claude", true], ["codex", true]]);
});

test("GET /api/state reports every harness and the one a session would use", async () => {
  const state = await withPath(pathWith("codex"), undefined, () => fetch(base + "/api/state").then((r) => r.json()));
  assert.equal(state.harness, "codex");
  assert.deepEqual(state.harnesses.map((h: any) => h.name), ["pi", "claude", "codex"]);
  assert.ok("provider" in state && "live" in state);
});

test("POST /api/agent/start with no agent installed names all three and how to install them", async () => {
  const r = await withPath(mkdtempSync(join(tmpdir(), "jev-empty-path-")), undefined, () => post("/api/agent/start", { level: 8, option: "A" }));
  assert.equal(r.status, 409);
  const { error } = await r.json();
  assert.match(error, /No coding agent found/);
  for (const n of ["pi", "claude", "codex"]) assert.match(error, new RegExp(`${n} \\(pnpm add -g`));
  assert.match(error, /Levels 1 to 5 work without one/);
});

test("POST /api/agent/start picks the requested harness and says so; Levels 1 to 5 are not agent levels", async () => {
  const dir = pathWith("claude", "codex");
  const r = await withPath(dir, "codex", () => post("/api/agent/start", { level: 8, option: "A", harness: "claude" }));
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.harness, "claude");
  assert.equal(body.model, process.env.JEV_AGENT_MODEL || "claude-haiku-5-5");
  getSession(body.id)?.close();
  const viaEnv = await withPath(dir, "codex", () => post("/api/agent/start", { level: 10, option: "A" }).then((x) => x.json()));
  assert.equal(viaEnv.harness, "codex");
  getSession(viaEnv.id)?.close();
  const notAgent = await post("/api/agent/start", { level: 3, option: "A" });
  assert.equal(notAgent.status, 404);
});

test("GET /api/level/:n carries each option's support per harness; Levels 1 to 5 carry none", async () => {
  const l7 = await fetch(base + "/api/level/7").then((r) => r.json());
  const c = l7.options.find((o: any) => o.key === "C");
  assert.equal(c.support.pi.status, "full");
  assert.equal(c.support.claude.status, "unavailable");
  assert.equal(l7.options.find((o: any) => o.key === "A").support.codex.status, "degraded");
  const l2 = await fetch(base + "/api/level/2").then((r) => r.json());
  assert.equal(l2.options[0].support, null);
});

test("POST /api/agent/start refuses an option the harness can't run, with the reason", async () => {
  const r = await withPath(pathWith("claude"), undefined, () => post("/api/agent/start", { level: 7, option: "C", harness: "claude" }));
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /Level 7 C doesn't run under claude: Claude Code doesn't let a hook choose where to cut/);
});
