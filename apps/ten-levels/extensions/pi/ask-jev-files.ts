/**
 * Level 9 on pi: files at scale. The package's ask_jev_files and pick_first_file tools.
 */
import { askJevFiles, pickFirstFileTool } from "@bobobowis/jev-kit/tools";
import { registerJevTool, type PiTypes } from "../report.ts";

export function install(pi: any, Type: PiTypes) {
  for (const tool of [askJevFiles, pickFirstFileTool]) registerJevTool(pi, Type, tool);
}
