/**
 * Level 8 extension: cheap reads. Three tools, one file each, flat parameters.
 *
 * The entry pi loads. The adapter is ./pi/ask-jev-file.ts, over @bobobowis/jev-kit; this file only hands it pi's own modules.
 * Load: pi -e extensions/ask-jev-file.ts --tools read,bash,ask_jev_file_bool,ask_jev_file_choice,ask_jev_file_score
 */
import { Type } from "typebox";
import { install } from "./pi/ask-jev-file.ts";

export default function (pi: any) {
  install(pi, Type);
}
