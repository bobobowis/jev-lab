/**
 * Open a URL in the default browser on Windows, macOS, Linux, and WSL. Returns false, after
 * printing the URL, when no opener is found. Never throws.
 *   win32   rundll32 url.dll,FileProtocolHandler (no shell, so no quoting of & or ^)
 *   darwin  open
 *   WSL     wslview, else explorer.exe (detected from /proc/version)
 *   Linux   xdg-open
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

export function isWsl() {
  if (process.platform !== "linux") return false;
  try { return /microsoft/i.test(readFileSync("/proc/version", "utf8")); } catch { return false; }
}

export function openers(url, platform = process.platform, wsl = isWsl()) {
  if (platform === "win32") return [["rundll32", ["url.dll,FileProtocolHandler", url]]];
  if (platform === "darwin") return [["open", [url]]];
  if (wsl) return [["wslview", [url]], ["explorer.exe", [url]]];
  return [["xdg-open", [url]]];
}

function tryOne([command, args]) {
  return new Promise((resolve) => {
    let child;
    try { child = spawn(command, args, { stdio: "ignore", detached: true }); } catch { return resolve(false); }
    child.on("error", () => resolve(false));
    child.on("spawn", () => { child.unref(); resolve(true); });
  });
}

export async function openUrl(url) {
  for (const opener of openers(url)) {
    if (await tryOne(opener)) return true;
  }
  console.log(`Open ${url} in your browser.`);
  return false;
}
