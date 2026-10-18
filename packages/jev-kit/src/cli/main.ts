/**
 * The `jev` command: one bin, one subcommand per delivery surface.
 */
import { hook, HOOK_HELP } from "./hook.ts";
import { setup } from "./setup.ts";
import { mcp } from "./mcp.ts";
import { ask, files, gate, guard } from "./ask.ts";
import type { Io } from "./common.ts";

type Run = (argv: string[], io: Io) => Promise<number>;

const SUBCOMMANDS: [name: string, summary: string, run: Run][] = [
  ["ask", "Ask a question block about a state, files, or a command's output; JSON on stdout", ask],
  ["files", "Ask the same question block about each file, in parallel", files],
  ["gate", "One yes or no question; exit 0 yes, 1 no, 2 usage, 3 Jev error", gate],
  ["guard", "Check a shell command or a file write with the Level 6 gates; exit 0 allow, 1 block", guard],
  ["setup", "Write or merge the Jev hooks and MCP server into a project's Claude Code or Codex config", setup],
  ["hook", "Run as a Claude Code or Codex hook: guards and the compaction advisor", hook],
  ["mcp", "Serve the Jev tools over stdio MCP", mcp],
];

export { HOOK_HELP };

export function helpText(): string {
  const width = Math.max(...SUBCOMMANDS.map(([n]) => n.length));
  return [
    "Usage: jev <command> [options]",
    "",
    "Commands:",
    ...SUBCOMMANDS.map(([n, s]) => `  ${n.padEnd(width)}  ${s}`),
    "",
    "Run `jev <command> --help` for a command's options.",
  ].join("\n");
}

export async function main(argv: string[], io: Io): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "--help" || command === "-h" || command === "help") {
    io.stdout.write(helpText() + "\n");
    return 0;
  }
  const entry = SUBCOMMANDS.find(([n]) => n === command);
  if (!entry) {
    io.stderr.write(`jev: unknown command "${command}".\n\n${helpText()}\n`);
    return 2;
  }
  return entry[2](rest, io);
}
