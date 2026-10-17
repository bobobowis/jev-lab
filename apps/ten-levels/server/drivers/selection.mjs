/**
 * What a scenario option turns on, in the package's terms, for harnesses that take hooks and an
 * MCP server instead of a pi extension. Options keep pi's tool names; this maps them.
 *   Level 6: the guards named by config.gates (A bash, B write, C result).
 *   Level 7: the advisor hooks with config.lines, and should_i_compact. compact_now is pi only.
 *   Levels 8 to 10: the Jev tools the option lists, over MCP.
 */
import { resolveSelection } from "@bobobowis/jev-kit/setup";
import { ALL_TOOLS } from "@bobobowis/jev-kit/tools";

const GATE = { A: "bash", B: "write", C: "result" };
const JEV_TOOLS = new Set(ALL_TOOLS.map((t) => t.name));

export function selectionFor(level, tools, config = {}) {
  const guards = level === 6 ? (config.gates ?? ["A", "B", "C"]).map((g) => GATE[g]).filter(Boolean) : [];
  const jevTools = tools.filter((t) => JEV_TOOLS.has(t));
  const sel = resolveSelection({ guards, tools: jevTools, compact: level === 7 });
  const l = config.lines;
  const hookArgs = level === 7 && l ? ["--lines", [l.notice, l.recommend, l.request].join(",")] : [];
  return { sel, hookArgs, builtins: tools.filter((t) => !JEV_TOOLS.has(t) && t !== "compact_now") };
}
