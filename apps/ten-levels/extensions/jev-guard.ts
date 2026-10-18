/**
 * Level 6 extension: guardrail hooks. The agent never knows Jev is here.
 *
 * The entry pi loads. The adapter is ./pi/jev-guard.ts, over @bobobowis/jev-kit; this file only hands it pi's own modules.
 * Load: pi -e extensions/jev-guard.ts --tools read,bash,edit,write
 */
import { install } from "./pi/jev-guard.ts";

export default function (pi: any) {
  install(pi);
}
