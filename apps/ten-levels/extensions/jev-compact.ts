/**
 * Level 7 extension: should I compact.
 *
 * The entry pi loads. The adapter is ./pi/jev-compact.ts, over @bobobowis/jev-kit; this file only hands it pi's own modules.
 * Load: pi -e extensions/jev-compact.ts --tools read,bash,edit,write,compact_now,should_i_compact
 */
import { Type } from "typebox";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { install } from "./pi/jev-compact.ts";

const keepRecentTokens = (cwd: string) => {
  try { return SettingsManager.create(cwd).getCompactionKeepRecentTokens(); } catch { return 20_000; }
};

export default function (pi: any) {
  install(pi, { Type, keepRecentTokens });
}
