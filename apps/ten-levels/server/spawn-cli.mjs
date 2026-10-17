/**
 * Launch an agent CLI the same way on Windows, macOS, and Linux, and stop it with its children.
 *
 *   resolveCommand(name)       the full path on PATH, trying PATHEXT on Windows, or null
 *   spawnCli(name, args, opts) spawn it; a .cmd or .bat shim runs through cmd.exe with escaping
 *   killTree(child)            taskkill /T /F on Windows; the whole process group elsewhere
 *
 * Prompts go over stdin, never argv, so argv only ever holds fixed flags and paths. The escaping
 * still follows cross-spawn's rules, so a stray quote or & in a path cannot break out of cmd.exe.
 */
import { spawn, spawnSync } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { delimiter, extname, isAbsolute, join } from "node:path";

const isWin = process.platform === "win32";

export function resolveCommand(name, env = process.env, platform = process.platform) {
  const win = platform === "win32";
  const exts = win ? (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").filter(Boolean) : [""];
  const candidates = (dir) => (win && extname(name) ? [join(dir, name)] : exts.map((e) => join(dir, name + e)));
  const dirs = isAbsolute(name) ? [""] : (env.PATH ?? env.Path ?? "").split(win ? ";" : delimiter).filter(Boolean);
  for (const dir of dirs) {
    for (const file of isAbsolute(name) ? [name] : candidates(dir)) {
      try {
        if (!statSync(file).isFile()) continue;
        if (!win) accessSync(file, constants.X_OK);
        return file;
      } catch { /* next */ }
    }
  }
  return null;
}

const META = /([()\][%!^"`<>&|;, *?])/g;
const isNpmShim = (file) => /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(file);

/** cross-spawn's escaping for one argument passed through `cmd.exe /d /s /c`. */
export function escapeCmdArg(arg, doubleEscape = false) {
  let s = String(arg);
  s = s.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"');
  s = s.replace(/(?=(\\+?)?)\1$/, "$1$1");
  s = `"${s}"`;
  s = s.replace(META, "^$1");
  if (doubleEscape) s = s.replace(META, "^$1");
  return s;
}
export const escapeCmdCommand = (command) => String(command).replace(META, "^$1");

/** The command line spawn should run for `file args` on this platform. */
export function commandLine(file, args, platform = process.platform) {
  if (platform === "win32" && /\.(cmd|bat)$/i.test(file)) {
    const dbl = isNpmShim(file);
    const line = [escapeCmdCommand(file), ...args.map((a) => escapeCmdArg(a, dbl))].join(" ");
    return { command: process.env.ComSpec || "cmd.exe", args: ["/d", "/s", "/c", `"${line}"`], verbatim: true };
  }
  return { command: file, args, verbatim: false };
}

/** Spawn a CLI by name. Throws when it is not on PATH, naming it. */
export function spawnCli(name, args, opts = {}) {
  const file = resolveCommand(name, opts.env ?? process.env);
  if (!file) {
    const err = new Error(`${name} is not installed or not on PATH`);
    err.code = "ENOENT";
    throw err;
  }
  const { command, args: argv, verbatim } = commandLine(file, args);
  return spawn(command, argv, { ...opts, windowsVerbatimArguments: verbatim, detached: !isWin, windowsHide: true });
}

/** Stop a CLI and everything it started. Safe to call twice. */
export function killTree(child, signal = "SIGTERM") {
  if (!child?.pid || child.exitCode !== null) return;
  if (isWin) {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore", windowsHide: true });
    return;
  }
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* gone */ } }
}
