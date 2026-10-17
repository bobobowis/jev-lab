/**
 * Level 8 on pi: cheap reads. The package's three ask_jev_file tools, one file each, flat parameters.
 */
import { askJevFileBool, askJevFileChoice, askJevFileScore } from "@bobobowis/jev-kit/tools";
import { registerJevTool, type PiTypes } from "../report.ts";

export function install(pi: any, Type: PiTypes) {
  for (const tool of [askJevFileBool, askJevFileChoice, askJevFileScore]) registerJevTool(pi, Type, tool);
}
