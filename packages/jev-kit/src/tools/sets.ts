/**
 * Which tools a surface exposes. The package speaks tool names; level numbers are the lab's alias.
 */
import { askJev } from "./ask-jev.ts";
import { shouldICompact } from "./compact-tool.ts";
import { askJevFileBool, askJevFileChoice, askJevFileScore, askJevFiles, pickFirstFileTool } from "./file-tools.ts";
import type { JevTool } from "./types.ts";

export const ALL_TOOLS: JevTool[] = [shouldICompact, askJevFileBool, askJevFileChoice, askJevFileScore, askJevFiles, pickFirstFileTool, askJev];

export const LEVEL_TOOLS: Record<number, string[]> = {
  7: ["should_i_compact"],
  8: ["ask_jev_file_bool", "ask_jev_file_choice", "ask_jev_file_score"],
  9: ["ask_jev_files", "pick_first_file"],
  10: ["ask_jev"],
};

export const toolByName = (name: string): JevTool | undefined => ALL_TOOLS.find((t) => t.name === name);

/** By level, by names, or all of them. Unknown names and levels are errors, not silent drops. */
export function selectTools(opts: { level?: number; names?: string[] } = {}): JevTool[] {
  if (opts.level !== undefined && opts.names?.length) throw new Error("pass a level or tool names, not both");
  if (opts.level !== undefined) {
    const names = LEVEL_TOOLS[opts.level];
    if (!names) throw new Error(`no Jev tools for level ${opts.level}; tools exist for levels ${Object.keys(LEVEL_TOOLS).join(", ")}`);
    return names.map((n) => toolByName(n)!);
  }
  if (opts.names?.length) {
    const unknown = opts.names.filter((n) => !toolByName(n));
    if (unknown.length) throw new Error(`unknown tool ${unknown.join(", ")}; known: ${ALL_TOOLS.map((t) => t.name).join(", ")}`);
    return opts.names.map((n) => toolByName(n)!);
  }
  return ALL_TOOLS;
}
