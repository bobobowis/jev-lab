/**
 * jev mcp: serve the Jev tools over stdio MCP, by level or by tool name.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { serve } from "../mcp/server.ts";
import { selectTools } from "../tools/sets.ts";
import { deciderFor, list, type Io } from "./common.ts";

export const MCP_HELP = `Usage: jev mcp [--level 7..10 | --tools a,b] [--cwd dir] [--mock]

Serves the Jev tools over stdio MCP. Paths resolve against --cwd (default: where it was started).
With neither --level nor --tools it serves all of them.
`;

const version = () => {
  try { return JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version; } catch { return "0.0.0"; }
};

export async function mcp(argv: string[], io: Io): Promise<number> {
  let values;
  try {
    ({ values } = parseArgs({ args: argv, strict: true, options: { level: { type: "string" }, tools: { type: "string" }, cwd: { type: "string" }, mock: { type: "boolean" }, help: { type: "boolean", short: "h" } } }));
  } catch (err: any) {
    io.stderr.write(`jev mcp: ${err.message}\n\n${MCP_HELP}`);
    return 2;
  }
  if (values.help) { io.stdout.write(MCP_HELP); return 0; }
  let tools;
  try {
    tools = selectTools({ level: values.level !== undefined ? Number(values.level) : undefined, names: values.tools ? list(values.tools) : undefined });
  } catch (err: any) {
    io.stderr.write(`jev mcp: ${err.message}\n`);
    return 2;
  }
  const { reporter, decide } = deciderFor("mcp", { mock: values.mock, stderr: io.stderr, client: io.client });
  await serve({ tools, cwd: resolve(values.cwd ?? process.cwd()), decide, report: (k, p) => reporter.report(k, p), version: version() });
  return 0;
}
