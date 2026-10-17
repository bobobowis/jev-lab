/**
 * Level 10 extension: ask_jev on any situation.
 *
 * The entry pi loads. The adapter is ./pi/ask-jev.ts, over @bobobowis/jev-kit; this file only hands it pi's own modules.
 * Load: pi -e extensions/ask-jev.ts --tools read,bash,edit,write,ask_jev
 */
import { Type } from "typebox";
import { install } from "./pi/ask-jev.ts";

export default function (pi: any) {
  install(pi, Type);
}
