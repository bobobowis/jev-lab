/**
 * The Codex driver against the exec JSONL captured from codex-cli 0.162.1 (tests/fixtures/codex/).
 * A fake `codex` on PATH prints the first capture for `exec` and the second for `exec resume`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
// @ts-ignore plain JS modules
import { createTranslator, findRollout, plainCommand, plan } from "../server/drivers/codex.mjs";
// @ts-ignore
import { getSession, start } from "../server/agent-session.mjs";

const FIXTURES = fileURLToPath(new URL("./fixtures/codex/", import.meta.url));
const KIT_FIXTURES = fileURLToPath(new URL("../../../packages/jev-kit/tests/fixtures/codex/", import.meta.url));
const lines = (name: string) => readFileSync(join(FIXTURES, name), "utf8").trim().split("\n").map((l) => JSON.parse(l));
const THREAD = "01a14ad3-3608-7ac2-a573-e28a3ea80660";

test("plan: hooks and the MCP server as -c overrides, approvals off, env forwarded to the server", () => {
  const { args } = plan({ level: 10, tools: ["read", "bash", "ask_jev"], config: {}, model: "gpt-6.1-sol", cwd: "/sbx" });
  const overrides = args.filter((_: string, i: number) => args[i - 1] === "-c");
  assert.ok(args.includes("--ignore-user-config") && args.includes("--dangerously-bypass-hook-trust"));
  assert.equal(args[args.indexOf("-m") + 1], "gpt-6.1-sol");
  assert.ok(overrides.includes('approval_policy="never"'));
  assert.ok(overrides.includes('mcp_servers.jev.default_tools_approval_mode="approve"'));
  assert.ok(overrides.some((o: string) => o.startsWith("mcp_servers.jev.env_vars=[") && o.includes('"TYPESAFE_API_KEY"')));
  assert.ok(overrides.some((o: string) => o.startsWith("mcp_servers.jev.args=[") && o.endsWith('"mcp","--tools","ask_jev","--cwd","/sbx"]')));
  const six = plan({ level: 6, tools: ["read", "bash", "edit", "write"], config: { gates: ["A", "B"] }, model: "", cwd: "/sbx" }).args;
  assert.ok(six.some((o: string) => /^hooks\.PreToolUse=\[\{matcher="Bash\|apply_patch",hooks=\[\{type="command",command=".* hook --harness codex --event PreToolUse --guards bash,write",timeout=10\}\]\}\]$/.test(o)));
  assert.equal(six.includes("-m"), false);
});

test("translator: the captured runs become tool rows named as Codex names them, messages, and stats", () => {
  const events: [string, any][] = [];
  let thread = null;
  const translate = createTranslator((e: string, d: any) => events.push([e, d]), { onThread: (id: string) => { thread ??= id; }, usage: () => ({ tokens: 15401, window: 475000, pct: 3.24 }) });
  for (const name of ["exec-first.jsonl", "exec-resume.jsonl"]) for (const m of lines(name)) translate(m);
  const of = (e: string) => events.filter(([n]) => n === e).map(([, d]) => d);
  assert.equal(thread, THREAD);
  assert.deepEqual(of("tool_execution_start").map((d) => [d.toolName, d.args.command ?? d.args.text ?? d.args.path]), [
    ["Bash", "ls"], ["Bash", "cat math.ts"], ["mcp__fixture__echo", "hi"], ["apply_patch", "/work/notes.txt"],
  ]);
  assert.equal(of("tool_execution_end").length, 4);
  assert.ok(of("tool_execution_end").every((d) => d.isError === false));
  assert.equal(of("error").length, 0, "the hook-trust notices are dropped");
  assert.equal(of("stats").length, 2);
  assert.equal(of("stats")[0].cost, null);
  assert.deepEqual(of("stats")[1].contextUsage, { tokens: 15401, contextWindow: 475000, percent: 3.24 });
  assert.equal(of("agent_settled").length, 2);
  assert.equal(of("message_end").at(-1).message.content[0].text, "math.ts");
  assert.deepEqual(of("log").map((d) => d.text), ["clamping SessionEnd hook timeout to 3s in /<session-flags>/config.toml"], "a Codex notice, not an error");
});

test("plainCommand strips the shell wrapper Codex shows", () => {
  assert.equal(plainCommand("/bin/bash -lc 'cat math.ts'"), "cat math.ts");
  assert.equal(plainCommand("/bin/bash -lc ls"), "ls");
  assert.equal(plainCommand("pnpm test"), "pnpm test");
  assert.equal(plainCommand(`/bin/bash -lc "pwd; rg --files -g 'AGENTS.md'"`), "pwd; rg --files -g 'AGENTS.md'");
  assert.equal(plainCommand(`/bin/bash -lc "echo \\"hi\\""`), 'echo "hi"');
});

test("findRollout looks under CODEX_HOME/sessions for the thread's file", () => {
  const home = mkdtempSync(join(tmpdir(), "jev-codex-home-"));
  mkdirSync(join(home, "sessions", "2026", "10", "17"), { recursive: true });
  const file = join(home, "sessions", "2026", "10", "17", `rollout-2026-10-17T19-05-18-${THREAD}.jsonl`);
  writeFileSync(file, readFileSync(join(KIT_FIXTURES, "rollout-token-count.jsonl")));
  assert.equal(findRollout(THREAD, { CODEX_HOME: home }), file);
  assert.equal(findRollout("nope", { CODEX_HOME: home }), null);
});

function fakeCodex(log: string) {
  const dir = mkdtempSync(join(tmpdir(), "jev-fake-codex-"));
  const script = join(dir, "codex.mjs");
  writeFileSync(script, `
    import { appendFileSync, readFileSync } from "node:fs";
    const argv = process.argv.slice(2);
    let input = "";
    process.stdin.on("data", (c) => (input += c));
    process.stdin.on("end", () => {
      appendFileSync(${JSON.stringify(log)}, JSON.stringify({ argv, input }) + "\\n");
      if (input.includes("HANG")) { setInterval(() => {}, 1000); return; }
      const file = argv[1] === "resume" ? "exec-resume.jsonl" : "exec-first.jsonl";
      process.stdout.write(readFileSync(${JSON.stringify(FIXTURES)} + file, "utf8"));
    });
  `);
  if (process.platform === "win32") writeFileSync(join(dir, "codex.cmd"), `@"${process.execPath}" "${script}" %*\r\n`);
  else { writeFileSync(join(dir, "codex"), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`); chmodSync(join(dir, "codex"), 0o755); }
  return dir;
}

test("end to end: the prompt goes over stdin, the follow up resumes the thread, abort kills the run", async () => {
  const log = join(mkdtempSync(join(tmpdir(), "jev-codex-log-")), "calls.jsonl");
  const bin = fakeCodex(log);
  const path = process.env.PATH;
  const codexHome = process.env.CODEX_HOME;
  process.env.PATH = `${bin}${delimiter}${path}`;
  process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), "jev-codex-empty-home-")); // never read the real ~/.codex
  const sandbox = mkdtempSync(join(tmpdir(), "jev-sbx-codex-"));
  writeFileSync(join(sandbox, "math.ts"), "export const add = 1;\n");
  let sessionId = "";
  try {
    const s = start({ level: 10, option: "A", extension: "unused", tools: ["read", "bash", "ask_jev"], cwd: sandbox, config: {}, harness: "codex" });
    sessionId = s.id;
    const items: any[] = [];
    s.subscribe((i: any) => items.push(i));
    const waitFor = async (pred: () => boolean) => {
      for (let i = 0; i < 200 && !pred(); i++) await sleep(20);
      assert.ok(pred(), JSON.stringify(items.map((i) => [i.event, JSON.stringify(i.data).slice(0, 160)])));
    };
    const settled = () => items.filter((i) => i.event === "agent_settled").length;

    await s.prompt("do the five steps, with 'quotes' & ampersands");
    await waitFor(() => settled() === 1);
    await s.prompt("which file did you cat?");
    await waitFor(() => settled() === 2);
    const calls = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    assert.equal(calls[0].input, "do the five steps, with 'quotes' & ampersands");
    assert.equal(calls[0].argv[0], "exec");
    assert.deepEqual(calls[1].argv.slice(0, 2), ["exec", "resume"]);
    assert.deepEqual(calls[1].argv.slice(-2), [THREAD, "-"]);
    assert.equal(calls[0].argv.includes("--sandbox"), false, "resume rejects --sandbox, so neither run uses it");

    await s.prompt("HANG please");
    await waitFor(() => s.streaming);
    await s.abort();
    await waitFor(() => settled() === 3);
    assert.equal(items.filter((i) => i.event === "agent_settled").at(-1).data.subtype, "killed");
    assert.equal(items.filter((i) => i.event === "error").length, 0);
    assert.equal(items.filter((i) => i.event === "stats")[0].data.contextUsage, null, "no rollout in an empty CODEX_HOME");
  } finally {
    getSession(sessionId)?.close();
    process.env.PATH = path;
    if (codexHome === undefined) delete process.env.CODEX_HOME; else process.env.CODEX_HOME = codexHome;
  }
});
