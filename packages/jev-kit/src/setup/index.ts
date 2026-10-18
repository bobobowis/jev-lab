/**
 * Wire Jev into a project's agent config: the MCP server for the tools, hook entries for the guards
 * and the compaction advisor. Merges into what is there. Entries it wrote before are recognized by
 * their marker (the `jev` server name, hook commands running `hook --harness <name>`) and replaced;
 * everything else is left as it was. A file that is not valid JSON is refused, never overwritten.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_GUARDS, LEVEL6_GUARDS, type Guard } from "../hooks/handle.ts";
import { LEVEL_TOOLS, selectTools } from "../tools/sets.ts";

export type SetupHarness = "claude" | "codex";

export interface SetupOptions {
  harness: SetupHarness;
  /** The project directory. */
  dir: string;
  guards?: Guard[];
  tools?: string[];
  /** Run the Level 7 advisor hooks. */
  compact?: boolean;
  /** The bash and MCP gates ask the user when Jev is unsure or leans destructive. Claude Code only. */
  ask?: boolean;
  /** The bash and MCP gates approve what Jev is sure only reads. Claude Code only. */
  allowReadOnly?: boolean;
  /** A lab level: 6 means the guards, 7 the advisor and should_i_compact, 8 to 10 their tools. */
  level?: number;
  /** How the harness runs this package's bin. Defaults to node and its absolute path. */
  command?: string[];
  /** Extra `jev hook` flags, for example --lines or --window. */
  hookArgs?: string[];
  /** Hook timeout in seconds, as the harness counts it. */
  timeoutSec?: number;
}

export interface FileChange {
  path: string;
  before: string | null;
  after: string;
  changed: boolean;
}

export class SetupError extends Error {}

/** npx and pnpm dlx unpack into a cache they may clear, so a path into one would stop working. */
const EPHEMERAL = /[\\/](_npx|dlx)[\\/]/;

/**
 * The bin this module ships with: dist/cli/index.js next to dist/setup/. Run through npx or
 * pnpm dlx, it is `npx -y` on this exact version instead, which outlives the cache.
 */
export const defaultCommand = (bin = fileURLToPath(new URL(`../cli/index.${import.meta.url.endsWith(".ts") ? "ts" : "js"}`, import.meta.url))): string[] => {
  if (!EPHEMERAL.test(bin)) return [process.execPath, bin];
  const pkg = JSON.parse(readFileSync(resolve(dirname(bin), "../../package.json"), "utf8"));
  return ["npx", "-y", `${pkg.name}@${pkg.version}`];
};

const quote = (s: string) => (/^[A-Za-z0-9_./:@=,+-]+$/.test(s) ? s : JSON.stringify(s));
const MARKER = /\shook --harness (claude|codex)(\s|$)/;
export const isJevHookCommand = (command: unknown) => typeof command === "string" && MARKER.test(command);

export interface Resolved { guards: Guard[]; tools: string[]; compact: boolean; ask?: boolean; allowReadOnly?: boolean }

type Selection = Pick<SetupOptions, "guards" | "tools" | "compact" | "level" | "ask" | "allowReadOnly"> & { harness?: SetupHarness };

export function resolveSelection(o: Selection): Resolved {
  const guards = new Set<Guard>(o.guards ?? []);
  const tools = new Set<string>(o.tools ?? []);
  let compact = o.compact ?? false;
  if (o.level !== undefined) {
    if (o.level === 6) LEVEL6_GUARDS.forEach((g) => guards.add(g));
    else if (LEVEL_TOOLS[o.level]) { LEVEL_TOOLS[o.level].forEach((t) => tools.add(t)); if (o.level === 7) compact = true; }
    else throw new SetupError(`level ${o.level} has nothing to set up; levels 6 to 10 do`);
  }
  for (const g of guards) if (!ALL_GUARDS.includes(g)) throw new SetupError(`unknown guard ${g}; known: ${ALL_GUARDS.join(", ")}`);
  try { selectTools({ names: [...tools] }); } catch (err: any) { throw new SetupError(err.message); }
  if (!guards.size && !tools.size && !compact) throw new SetupError("nothing to set up: pass --guards, --tools, --compact, or --level");
  const ladder = o.ask || o.allowReadOnly;
  if (ladder && !guards.has("bash") && !guards.has("mcp")) throw new SetupError("--ask and --allow-read-only apply to the bash and mcp guards; add one of them to --guards");
  if (o.harness === "codex" && (ladder || guards.has("mcp"))) {
    throw new SetupError("Codex hooks can only deny, so the mcp guard, --ask, and --allow-read-only are Claude Code only");
  }
  return { guards: [...guards], tools: [...tools], compact, ...(o.ask ? { ask: true } : {}), ...(o.allowReadOnly ? { allowReadOnly: true } : {}) };
}

interface HookGroup { matcher?: string; hooks: { type: "command"; command: string; timeout?: number }[] }

/** The hook entries, by event, that a selection needs. Same shape for Claude Code and Codex. */
export function hookGroups(harness: SetupHarness, sel: Resolved, command: string[], extra: string[] = [], timeoutSec = 10): Record<string, HookGroup[]> {
  const run = (event: string, flags: string[]) => ({ type: "command" as const, command: [...command, "hook", "--harness", harness, "--event", event, ...flags, ...extra].map(quote).join(" "), timeout: timeoutSec });
  const out: Record<string, HookGroup[]> = {};
  const guardFlag = (gs: Guard[]) => ["--guards", gs.join(",")];
  const ladder = [...(sel.ask ? ["--ask"] : []), ...(sel.allowReadOnly ? ["--allow-read-only"] : [])];
  const pre: string[] = [];
  if (sel.guards.includes("bash")) pre.push("Bash");
  if (sel.guards.includes("write")) pre.push(...(harness === "codex" ? ["apply_patch"] : ["Write", "Edit", "MultiEdit", "NotebookEdit"]));
  const preGuards = sel.guards.filter((g) => g === "bash" || g === "write");
  if (pre.length) out.PreToolUse = [{ matcher: pre.join("|"), hooks: [run("PreToolUse", [...guardFlag(preGuards), ...(sel.guards.includes("bash") ? ladder : [])])] }];
  if (sel.guards.includes("mcp")) (out.PreToolUse ??= []).push({ matcher: "mcp__.*", hooks: [run("PreToolUse", [...guardFlag(["mcp"]), ...ladder])] });
  if (sel.guards.includes("result")) out.PostToolUse = [{ matcher: harness === "codex" ? "Bash" : "Read|Bash", hooks: [run("PostToolUse", guardFlag(["result"]))] }];
  if (sel.compact) {
    out.UserPromptSubmit = [{ hooks: [run("UserPromptSubmit", ["--compact"])] }];
    out.Stop = [{ hooks: [run("Stop", ["--compact"])] }];
    out.PreCompact = [{ hooks: [run("PreCompact", [])] }];
  }
  return out;
}

/** Drop every hook this tool wrote before, then add the new groups. Unrelated hooks stay in place. */
export function mergeHooks(existing: Record<string, HookGroup[]> | undefined, ours: Record<string, HookGroup[]>): Record<string, HookGroup[]> {
  const merged: Record<string, HookGroup[]> = {};
  for (const [event, groups] of Object.entries(existing ?? {})) {
    const kept = (Array.isArray(groups) ? groups : [])
      .map((g) => ({ ...g, hooks: (g?.hooks ?? []).filter((h) => !isJevHookCommand(h?.command)) }))
      .filter((g) => g.hooks.length);
    if (kept.length) merged[event] = kept;
  }
  for (const [event, groups] of Object.entries(ours)) merged[event] = [...(merged[event] ?? []), ...groups];
  return merged;
}

function readJson(path: string): { text: string | null; value: Record<string, any> } {
  if (!existsSync(path)) return { text: null, value: {} };
  const text = readFileSync(path, "utf8");
  if (!text.trim()) return { text, value: {} };
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("not a JSON object");
    return { text, value };
  } catch (err: any) {
    throw new SetupError(`${path} is not valid JSON (${err.message}); fix or move it, then run jev setup again. Nothing was written.`);
  }
}

const change = (path: string, before: string | null, value: unknown): FileChange => {
  const after = JSON.stringify(value, null, 2) + "\n";
  return { path, before, after, changed: before === null ? true : JSON.stringify(JSON.parse(before)) !== JSON.stringify(value) };
};

/** Claude Code: `.mcp.json` for the tools, `.claude/settings.json` for the hooks. */
export function planClaude(o: SetupOptions): FileChange[] {
  const sel = resolveSelection(o);
  const command = o.command ?? defaultCommand();
  const dir = resolve(o.dir);
  const out: FileChange[] = [];

  const mcpPath = join(dir, ".mcp.json");
  const mcp = readJson(mcpPath);
  const servers = { ...(mcp.value.mcpServers ?? {}) };
  if (sel.tools.length) servers.jev = { command: command[0], args: [...command.slice(1), "mcp", "--tools", sel.tools.join(",")] };
  else delete servers.jev;
  if (sel.tools.length || mcp.text !== null) out.push(change(mcpPath, mcp.text, { ...mcp.value, mcpServers: servers }));

  const settingsPath = join(dir, ".claude", "settings.json");
  const settings = readJson(settingsPath);
  const hooks = mergeHooks(settings.value.hooks, hookGroups("claude", sel, command, o.hookArgs, o.timeoutSec));
  const next = { ...settings.value };
  if (Object.keys(hooks).length) next.hooks = hooks; else delete next.hooks;
  if (Object.keys(hooks).length || settings.text !== null) out.push(change(settingsPath, settings.text, next));
  return out;
}

const BLOCK_START = "# >>> jev setup: managed by `jev setup`; this block is replaced on every run";
const BLOCK_END = "# <<< jev setup";
/** What the MCP server needs from the agent's environment. */
export const MCP_ENV_VARS = ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "JEV_EVENT_DIR", "JEV_STATE_DIR"];
const tomlString = (s: string) => JSON.stringify(s); // JSON escapes are valid TOML basic-string escapes
const tomlArray = (xs: string[]) => `[${xs.map(tomlString).join(", ")}]`;

/** Our block of `.codex/config.toml`: the hooks as arrays of tables, the server as one table. */
export function codexBlock(sel: Resolved, command: string[], extra: string[] = [], timeoutSec = 10): string {
  const lines = [BLOCK_START];
  for (const [event, groups] of Object.entries(hookGroups("codex", sel, command, extra, timeoutSec))) {
    for (const g of groups) {
      lines.push("", `[[hooks.${event}]]`);
      if (g.matcher) lines.push(`matcher = ${tomlString(g.matcher)}`);
      for (const h of g.hooks) lines.push(`[[hooks.${event}.hooks]]`, `type = "command"`, `command = ${tomlString(h.command)}`, `timeout = ${h.timeout ?? timeoutSec}`);
    }
  }
  if (sel.tools.length) {
    lines.push("", "[mcp_servers.jev]", `command = ${tomlString(command[0])}`, `args = ${tomlArray([...command.slice(1), "mcp", "--tools", sel.tools.join(",")])}`,
      `default_tools_approval_mode = "approve"`,
      // Codex starts MCP servers with a clean environment; hooks inherit it, servers do not.
      `env_vars = ${tomlArray(MCP_ENV_VARS)}`);
  }
  lines.push(BLOCK_END);
  return lines.join("\n") + "\n";
}

/**
 * Codex: `.codex/config.toml`, loaded once the project is trusted. There is no TOML parser here, so
 * the file is not rewritten: our entries live in one marked block at the end, replaced on every run.
 */
export function planCodex(o: SetupOptions): FileChange[] {
  const sel = resolveSelection(o);
  const command = o.command ?? defaultCommand();
  const path = join(resolve(o.dir), ".codex", "config.toml");
  const before = existsSync(path) ? readFileSync(path, "utf8") : null;
  const text = before ?? "";
  const start = text.indexOf(BLOCK_START);
  const end = text.indexOf(BLOCK_END);
  if ((start === -1) !== (end === -1) || end < start) {
    throw new SetupError(`${path} has a broken jev setup block (a start or end marker is missing); fix or remove it, then run jev setup again. Nothing was written.`);
  }
  const outside = start === -1 ? text : text.slice(0, start) + text.slice(end + BLOCK_END.length);
  if (/^\s*\[\s*mcp_servers\.jev\s*\]/m.test(outside)) {
    throw new SetupError(`${path} already defines [mcp_servers.jev] outside the jev setup block; remove it or rename it, then run jev setup again. Nothing was written.`);
  }
  const block = codexBlock(sel, command, o.hookArgs, o.timeoutSec);
  const rest = outside.replace(/\s+$/, "");
  const after = (rest ? rest + "\n\n" : "") + block;
  return [{ path, before, after, changed: before !== after }];
}

/** One line for people: what the selection turns on. */
export function describeSelection(o: Selection): string {
  const sel = resolveSelection(o);
  const parts = [
    sel.guards.length ? `guards ${sel.guards.join(",")}` : "",
    sel.ask ? "ask when unsure" : "",
    sel.allowReadOnly ? "approve read only" : "",
    sel.compact ? "compaction advisor" : "",
    sel.tools.length ? `tools ${sel.tools.join(",")}` : "",
  ].filter(Boolean);
  return parts.join("; ");
}

export function plan(o: SetupOptions): FileChange[] {
  return o.harness === "claude" ? planClaude(o) : planCodex(o);
}

export function apply(changes: FileChange[]): void {
  for (const c of changes) {
    if (!c.changed) continue;
    mkdirSync(dirname(c.path), { recursive: true });
    writeFileSync(c.path, c.after);
  }
}
