/**
 * jev setup: wire the Jev hooks and MCP server into a project's Claude Code or Codex config.
 */
import { parseArgs } from "node:util";
import { relative } from "node:path";
import { toPosix } from "../files/read-state.ts";
import { apply, describeSelection, plan, SetupError, type SetupHarness } from "../setup/index.ts";
import type { Guard } from "../hooks/handle.ts";
import { list, type Io } from "./common.ts";

export const SETUP_HELP = `Usage: jev setup --harness claude|codex [options]

Writes or merges the Jev entries into the project's agent config, leaving everything else alone.
Claude Code: .mcp.json and .claude/settings.json. Codex: a marked block in .codex/config.toml.
Each run sets the whole selection: running it again replaces only what it set up before.

Options:
  --harness <name>    claude or codex
  --guards <list>     bash,write,result: the Level 6 hooks
  --tools <list>      Jev tools to serve over MCP, for example ask_jev,ask_jev_files
  --compact           the Level 7 advisor hooks
  --level <n>         a lab level: 6 guards, 7 advisor, 8 to 10 their tools
  --out <dir>         the project directory (default: the current one)
  --command <cmd>     how to run jev in the hooks and the MCP entry (default: node and this package's bin)
  --hook-args <args>  extra jev hook flags, for example "--lines 60000,120000,180000"
  --dry-run           print what would change, write nothing
`;

export async function setup(argv: string[], io: Io): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({
      args: argv, strict: true,
      options: {
        harness: { type: "string" }, guards: { type: "string" }, tools: { type: "string" }, compact: { type: "boolean" },
        level: { type: "string" }, out: { type: "string" }, command: { type: "string" }, "hook-args": { type: "string" },
        "dry-run": { type: "boolean" }, help: { type: "boolean", short: "h" },
      },
    }));
  } catch (err: any) {
    io.stderr.write(`jev setup: ${err.message}\n\n${SETUP_HELP}`);
    return 2;
  }
  if (values.help) { io.stdout.write(SETUP_HELP); return 0; }
  const harness = values.harness as SetupHarness;
  if (harness !== "claude" && harness !== "codex") { io.stderr.write("jev setup: --harness must be claude or codex\n"); return 2; }
  const dir = values.out ?? process.cwd();
  try {
    const selection = {
      guards: values.guards ? (list(values.guards) as Guard[]) : undefined,
      tools: values.tools ? list(values.tools) : undefined,
      compact: values.compact,
      level: values.level !== undefined ? Number(values.level) : undefined,
    };
    const changes = plan({
      harness, dir, ...selection,
      command: values.command ? values.command.split(/\s+/).filter(Boolean) : undefined,
      hookArgs: values["hook-args"] ? values["hook-args"].split(/\s+/).filter(Boolean) : undefined,
    });
    const changed = changes.filter((c) => c.changed);
    if (values["dry-run"]) {
      for (const c of changes) io.stdout.write(`--- ${toPosix(relative(dir, c.path) || c.path)}${c.changed ? "" : " (unchanged)"}\n${c.after}`);
      return 0;
    }
    apply(changes);
    io.stdout.write(changed.length ? `jev setup: wrote ${changed.map((c) => toPosix(relative(dir, c.path))).join(", ")}\n` : "jev setup: no changes\n");
    io.stdout.write(`jev setup: on: ${describeSelection(selection)}. Running it again replaces this selection.\n`);
    return 0;
  } catch (err: any) {
    io.stderr.write(`jev setup: ${err instanceof SetupError ? err.message : err?.message ?? err}\n`);
    return 1;
  }
}
