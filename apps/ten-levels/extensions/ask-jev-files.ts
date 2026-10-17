/**
 * Level 9 extension: files at scale, one call per file in parallel, then pick_first_file.
 *
 * The entry pi loads. The adapter is ./pi/ask-jev-files.ts, over @bobobowis/jev-kit; this file only hands it pi's own modules.
 * Load: pi -e extensions/ask-jev-files.ts --tools read,bash,ask_jev_files,pick_first_file
 */
import { Type } from "typebox";
import { install } from "./pi/ask-jev-files.ts";

export default function (pi: any) {
  install(pi, Type);
}
