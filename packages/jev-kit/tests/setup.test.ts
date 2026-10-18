import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { isJevHookCommand, plan, apply, SetupError } from "../src/setup/index.ts";
import { main } from "../src/cli/main.ts";

const CMD = ["node", "/opt/jev/dist/cli/index.js"];
const project = () => mkdtempSync(join(tmpdir(), "jev-setup-"));
const read = (dir: string, f: string) => JSON.parse(readFileSync(join(dir, f), "utf8"));
const io = () => {
  const out: string[] = [], err: string[] = [];
  return { out, err, io: { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => err.push(s) }, stdin: Readable.from([]) } };
};

test("claude: guards become PreToolUse and PostToolUse hooks with the right matchers", () => {
  const dir = project();
  apply(plan({ harness: "claude", dir, guards: ["bash", "write", "result"], command: CMD }));
  const s = read(dir, ".claude/settings.json");
  assert.equal(s.hooks.PreToolUse[0].matcher, "Bash|Write|Edit|MultiEdit|NotebookEdit");
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, "node /opt/jev/dist/cli/index.js hook --harness claude --event PreToolUse --guards bash,write");
  assert.equal(s.hooks.PostToolUse[0].matcher, "Read|Bash");
  assert.equal(s.hooks.PreToolUse[0].hooks[0].timeout, 10);
  assert.equal(existsSync(join(dir, ".mcp.json")), false);
});

test("claude: tools become the jev MCP server, level 7 adds the advisor hooks", () => {
  const dir = project();
  apply(plan({ harness: "claude", dir, level: 7, tools: ["ask_jev"], command: CMD }));
  assert.deepEqual(read(dir, ".mcp.json").mcpServers.jev, { command: "node", args: ["/opt/jev/dist/cli/index.js", "mcp", "--tools", "ask_jev,should_i_compact"] });
  const hooks = read(dir, ".claude/settings.json").hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ["PreCompact", "Stop", "UserPromptSubmit"]);
  assert.match(hooks.Stop[0].hooks[0].command, /--event Stop --compact$/);
});

test("claude: existing settings, hooks, and servers are kept", () => {
  const dir = project();
  mkdirSync(join(dir, ".claude"));
  writeFileSync(join(dir, ".claude/settings.json"), JSON.stringify({
    permissions: { allow: ["Bash(pnpm test)"] },
    hooks: { PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "./audit.sh" }] }] },
  }));
  writeFileSync(join(dir, ".mcp.json"), JSON.stringify({ mcpServers: { db: { command: "db-mcp" } } }));
  apply(plan({ harness: "claude", dir, guards: ["bash"], tools: ["ask_jev_files"], command: CMD }));
  const s = read(dir, ".claude/settings.json");
  assert.deepEqual(s.permissions, { allow: ["Bash(pnpm test)"] });
  assert.equal(s.hooks.PreToolUse.length, 2);
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, "./audit.sh");
  assert.ok(isJevHookCommand(s.hooks.PreToolUse[1].hooks[0].command));
  assert.deepEqual(Object.keys(read(dir, ".mcp.json").mcpServers).sort(), ["db", "jev"]);
});

test("claude: a second run reports no changes, a different selection replaces only our entries", () => {
  const dir = project();
  mkdirSync(join(dir, ".claude"));
  writeFileSync(join(dir, ".claude/settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: "notify-send done" }] }] } }));
  apply(plan({ harness: "claude", dir, guards: ["bash", "write"], compact: true, command: CMD }));
  assert.ok(plan({ harness: "claude", dir, guards: ["bash", "write"], compact: true, command: CMD }).every((c) => !c.changed));
  apply(plan({ harness: "claude", dir, guards: ["bash"], command: CMD }));
  const hooks = read(dir, ".claude/settings.json").hooks;
  assert.deepEqual(Object.keys(hooks).sort(), ["PreToolUse", "Stop"]);
  assert.deepEqual(hooks.Stop, [{ hooks: [{ type: "command", command: "notify-send done" }] }]);
  assert.equal(hooks.PreToolUse[0].matcher, "Bash");
});

test("claude: unparseable JSON is refused and nothing is written", () => {
  const dir = project();
  mkdirSync(join(dir, ".claude"));
  writeFileSync(join(dir, ".claude/settings.json"), "{ \"hooks\": { oops ");
  assert.throws(() => plan({ harness: "claude", dir, guards: ["bash"], command: CMD }), SetupError);
  assert.equal(readFileSync(join(dir, ".claude/settings.json"), "utf8"), "{ \"hooks\": { oops ");
  assert.equal(existsSync(join(dir, ".mcp.json")), false);
});

test("bad selections are errors: nothing chosen, unknown guard, unknown tool, level without setup", () => {
  const dir = project();
  assert.throws(() => plan({ harness: "claude", dir, command: CMD }), /nothing to set up/);
  assert.throws(() => plan({ harness: "claude", dir, guards: ["net" as any], command: CMD }), /unknown guard net/);
  assert.throws(() => plan({ harness: "claude", dir, tools: ["ask_gpt"], command: CMD }), /unknown tool ask_gpt/);
  assert.throws(() => plan({ harness: "claude", dir, level: 3, command: CMD }), /level 3 has nothing/);
});

test("jev setup CLI: dry run writes nothing, a real run says what it wrote, the second says no changes", async () => {
  const dir = project();
  const dry = io();
  assert.equal(await main(["setup", "--harness", "claude", "--guards", "bash", "--out", dir, "--command", "jev", "--dry-run"], dry.io), 0);
  assert.match(dry.out.join(""), /--- \.claude\/settings\.json\n/);
  assert.equal(existsSync(join(dir, ".claude")), false);
  const first = io();
  assert.equal(await main(["setup", "--harness", "claude", "--guards", "bash", "--out", dir, "--command", "jev"], first.io), 0);
  assert.equal(first.out.join(""), "jev setup: wrote .claude/settings.json\njev setup: on: guards bash. Running it again replaces this selection.\n");
  assert.equal(read(dir, ".claude/settings.json").hooks.PreToolUse[0].hooks[0].command, "jev hook --harness claude --event PreToolUse --guards bash");
  const second = io();
  await main(["setup", "--harness", "claude", "--guards", "bash", "--out", dir, "--command", "jev"], second.io);
  assert.match(second.out.join(""), /^jev setup: no changes\n/);
  const bad = io();
  assert.equal(await main(["setup", "--harness", "claude", "--out", dir], bad.io), 1);
  assert.match(bad.err.join(""), /nothing to set up/);
});

test("codex: a marked block at the end of .codex/config.toml, the rest of the file untouched", () => {
  const dir = project();
  mkdirSync(join(dir, ".codex"));
  const mine = 'model = "gpt-6.1-sol"\n\n[mcp_servers.db]\ncommand = "db-mcp"\n';
  writeFileSync(join(dir, ".codex/config.toml"), mine);
  apply(plan({ harness: "codex", dir, guards: ["bash", "write"], tools: ["ask_jev"], command: CMD }));
  const text = readFileSync(join(dir, ".codex/config.toml"), "utf8");
  assert.ok(text.startsWith(mine.trimEnd() + "\n\n# >>> jev setup"));
  assert.match(text, /\[\[hooks\.PreToolUse\]\]\nmatcher = "Bash\|apply_patch"\n\[\[hooks\.PreToolUse\.hooks\]\]\ntype = "command"\ncommand = "node \/opt\/jev\/dist\/cli\/index\.js hook --harness codex --event PreToolUse --guards bash,write"\ntimeout = 10/);
  assert.match(text, /\[mcp_servers\.jev\]\ncommand = "node"\nargs = \["\/opt\/jev\/dist\/cli\/index\.js", "mcp", "--tools", "ask_jev"\]\ndefault_tools_approval_mode = "approve"\nenv_vars = \["TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "JEV_EVENT_DIR", "JEV_STATE_DIR"\]\n# <<< jev setup\n$/);
  assert.ok(plan({ harness: "codex", dir, guards: ["bash", "write"], tools: ["ask_jev"], command: CMD }).every((c) => !c.changed));
  apply(plan({ harness: "codex", dir, guards: ["result"], command: CMD }));
  const again = readFileSync(join(dir, ".codex/config.toml"), "utf8");
  assert.equal(again.split("# >>> jev setup").length, 2);
  assert.doesNotMatch(again, /mcp_servers\.jev/);
  assert.match(again, /\[\[hooks\.PostToolUse\]\]\nmatcher = "Bash"/);
  assert.ok(again.startsWith(mine.trimEnd()));
});

test("codex: a broken block or a foreign [mcp_servers.jev] is refused, nothing written", () => {
  const dir = project();
  mkdirSync(join(dir, ".codex"));
  writeFileSync(join(dir, ".codex/config.toml"), "# >>> jev setup: managed by `jev setup`; this block is replaced on every run\n[x]\n");
  assert.throws(() => plan({ harness: "codex", dir, guards: ["bash"], command: CMD }), /broken jev setup block/);
  writeFileSync(join(dir, ".codex/config.toml"), "[mcp_servers.jev]\ncommand = \"other\"\n");
  assert.throws(() => plan({ harness: "codex", dir, tools: ["ask_jev"], command: CMD }), /already defines \[mcp_servers\.jev\]/);
});
