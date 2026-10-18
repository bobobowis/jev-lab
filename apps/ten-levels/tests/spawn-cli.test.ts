import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
// @ts-ignore plain JS module
import { commandLine, escapeCmdArg, killTree, resolveCommand, spawnCli } from "../server/spawn-cli.mjs";

const isWin = process.platform === "win32";

/** A fake CLI on a fresh PATH dir: prints its argv as JSON, or starts a sleeping child and waits. */
function fakeCli() {
  const dir = mkdtempSync(join(tmpdir(), "jev-fake-cli-"));
  const script = join(dir, "fake-agent.mjs");
  writeFileSync(script, `
    import { spawn } from "node:child_process";
    if (process.argv[2] === "--hang") {
      const kid = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      console.log(JSON.stringify({ kid: kid.pid }));
      setInterval(() => {}, 1000);
    } else console.log(JSON.stringify(process.argv.slice(2)));
  `);
  if (isWin) writeFileSync(join(dir, "fake-agent.cmd"), `@"${process.execPath}" "${script}" %*\r\n`);
  else { writeFileSync(join(dir, "fake-agent"), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`); chmodSync(join(dir, "fake-agent"), 0o755); }
  return { dir, env: { ...process.env, PATH: `${dir}${delimiter}${process.env.PATH}` } };
}

const output = (child: any) => new Promise<string>((resolve) => { let s = ""; child.stdout.on("data", (c: Buffer) => (s += c)); child.on("close", () => resolve(s)); });
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };

test("resolveCommand finds the CLI on PATH (with PATHEXT on Windows), and null when missing", () => {
  const { dir, env } = fakeCli();
  const found = resolveCommand("fake-agent", env);
  // Windows paths are case-insensitive, and PATHEXT lists .CMD in capitals.
  if (isWin) assert.equal(found.toLowerCase(), join(dir, "fake-agent.cmd").toLowerCase());
  else assert.equal(found, join(dir, "fake-agent"));
  assert.equal(resolveCommand("no-such-agent-xyz", env), null);
  assert.throws(() => spawnCli("no-such-agent-xyz", [], { env }), /no-such-agent-xyz is not installed or not on PATH/);
});

test("Windows shims go through cmd.exe with every metacharacter escaped", () => {
  const line = commandLine("C:\\Users\\a b\\AppData\\Roaming\\npm\\claude.cmd", ["--settings", 'C:\\x y\\s&"t".json'], "win32");
  assert.deepEqual(line.args.slice(0, 3), ["/d", "/s", "/c"]);
  assert.equal(line.verbatim, true);
  assert.match(line.args[3], /\^"C:\\x\^ y\\s\^&\\\^"t\\\^"\.json\^"/);
  assert.equal(escapeCmdArg("plain"), '^"plain^"');
  assert.deepEqual(commandLine("/usr/bin/claude", ["-p"], "linux"), { command: "/usr/bin/claude", args: ["-p"], verbatim: false });
});

test("arguments with spaces and quotes arrive intact", async () => {
  const { env } = fakeCli();
  const args = ["--model", "claude-haiku-5-5", "--note", 'a "quoted" value with spaces & more'];
  const child = spawnCli("fake-agent", args, { env, stdio: ["ignore", "pipe", "inherit"] });
  assert.deepEqual(JSON.parse(await output(child)), args);
});

test("killTree stops the CLI and the process it started", async () => {
  const { env } = fakeCli();
  const child = spawnCli("fake-agent", ["--hang"], { env, stdio: ["ignore", "pipe", "inherit"] });
  const first = await new Promise<string>((resolve) => child.stdout.once("data", (c: Buffer) => resolve(String(c))));
  const kid = JSON.parse(first).kid;
  assert.ok(alive(child.pid!) && alive(kid));
  const closed = new Promise((r) => child.on("close", r));
  killTree(child);
  await closed;
  for (let i = 0; i < 40 && alive(kid); i++) await sleep(50);
  assert.equal(alive(kid), false, "the grandchild outlived the kill");
  assert.doesNotThrow(() => killTree(child));
});
