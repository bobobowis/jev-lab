/**
 * The Claude Code driver: one long lived `claude -p` over stream-json (docs/NOTES-claude.md in the
 * package). The level's Jev tools come from `jev mcp` and its guards and advisor from `jev hook`,
 * configured for this session only: --strict-mcp-config, --settings, and --setting-sources "".
 *
 *   assistant tool_use  -> tool_execution_start     user tool_result -> tool_execution_end
 *   assistant text      -> message_end              result           -> stats, agent_settled
 *   compact_boundary    -> compaction_end
 * Abort sends the interrupt control request; if the turn has not settled in 3 s, the process is
 * killed and the next prompt resumes the conversation with --resume.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultCommand, hookGroups } from "@bobobowis/jev-kit/setup";
import { ASK_JEV_NUDGE } from "@bobobowis/jev-kit/tools";
import { killTree, spawnCli } from "../spawn-cli.mjs";
import { readLines } from "./lines.mjs";
import { selectionFor } from "./selection.mjs";

export const name = "claude";
export const command = "claude";
export const defaultModel = "claude-haiku-5-5";
export const MIN_VERSION = "2.1.302";

const BUILTIN = { read: "Read", bash: "Bash", edit: "Edit", write: "Write" };

export function credentialEnv() {
  return { names: ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL", "CLAUDE_CONFIG_DIR"], prefixes: ["CLAUDE_CODE_", "ANTHROPIC_"], set: {} };
}

const newer = (a, b) => {
  const pa = a.split(".").map(Number), pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  return true;
};

/** The flags and the per-session config files for one option. */
export function plan({ level, tools, config, model, home, cwd }) {
  const { sel, hookArgs, builtins } = selectionFor(level, tools, config);
  const bin = defaultCommand();
  const dir = join(home, "claude");
  const mcpTools = sel.tools.map((t) => `mcp__jev__${t}`);
  const toolList = [...builtins.map((t) => BUILTIN[t] ?? t), ...(mcpTools.length ? ["ToolSearch"] : [])];
  const files = {
    [join(dir, "mcp.json")]: { mcpServers: sel.tools.length ? { jev: { command: bin[0], args: [...bin.slice(1), "mcp", "--tools", sel.tools.join(","), "--cwd", cwd] } } : {} },
    [join(dir, "settings.json")]: { hooks: hookGroups("claude", sel, bin, hookArgs) },
  };
  const args = [
    "-p", "--input-format", "stream-json", "--output-format", "stream-json", "--verbose",
    "--model", model,
    "--mcp-config", join(dir, "mcp.json"), "--strict-mcp-config",
    "--settings", join(dir, "settings.json"), "--setting-sources", "",
    "--tools", toolList.join(","), "--allowedTools", [...toolList, ...mcpTools].join(","),
    "--permission-mode", "bypassPermissions",
  ];
  // /compact must keep working on Level 7, where the advisor asks the user to run it.
  if (level !== 7) args.push("--disable-slash-commands");
  if (sel.tools.includes("ask_jev")) args.push("--append-system-prompt", ASK_JEV_NUDGE);
  return { args, files, dir };
}

const textOfResult = (content) =>
  typeof content === "string" ? content
    : Array.isArray(content) ? content.map((c) => (c?.type === "text" ? c.text : c?.type === "tool_reference" ? `tool: ${c.tool_name}` : "")).filter(Boolean).join("\n")
    : "";

/** Turn stream-json messages into the lab's events. Pure, so a test can replay a capture through it. */
export function createTranslator(push, onSession = () => {}) {
  let lastUsage = null;
  let seenInit = false;
  return function translate(msg) {
    switch (msg.type) {
      case "system":
        if (msg.subtype === "init") {
          onSession(msg.session_id);
          if (!seenInit) { seenInit = true; push("state", { model: { provider: "anthropic", id: msg.model }, version: msg.claude_code_version ?? null }); }
        } else if (msg.subtype === "compact_boundary") {
          const m = msg.compact_metadata ?? {};
          push("compaction_end", { result: { tokensBefore: m.pre_tokens ?? null, estimatedTokensAfter: m.post_tokens ?? null }, trigger: m.trigger ?? null });
        }
        return;
      case "assistant": {
        const content = msg.message?.content ?? [];
        if (msg.message?.usage) lastUsage = msg.message.usage;
        for (const c of content) {
          if (c.type === "tool_use") push("tool_execution_start", { toolCallId: c.id, toolName: c.name, args: c.input });
        }
        const text = content.filter((c) => c.type === "text" && c.text?.trim());
        const thinking = content.filter((c) => c.type === "thinking" && c.thinking?.trim());
        if (text.length || thinking.length) push("message_end", { message: { role: "assistant", content: [...thinking, ...text], usage: msg.message?.usage } });
        return;
      }
      case "user": {
        for (const c of msg.message?.content ?? []) {
          if (c?.type === "tool_result") push("tool_execution_end", { toolCallId: c.tool_use_id, result: { content: [{ type: "text", text: textOfResult(c.content) }] }, isError: Boolean(c.is_error) });
        }
        return;
      }
      case "result": {
        const window = Object.values(msg.modelUsage ?? {})[0]?.contextWindow ?? null;
        const u = lastUsage;
        const tokens = u ? (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) : null;
        // total_cost_usd is the session total, which is what the window's LLM cost shows.
        push("stats", {
          cost: typeof msg.total_cost_usd === "number" ? msg.total_cost_usd : null,
          contextUsage: tokens === null ? null : { tokens, contextWindow: window, percent: window ? (tokens / window) * 100 : null },
          turn: { subtype: msg.subtype, is_error: msg.is_error, num_turns: msg.num_turns, duration_ms: msg.duration_ms },
        });
        push("agent_settled", { subtype: msg.subtype });
        return;
      }
      case "control_response":
      case "rate_limit_event":
        return;
      default:
        push("log", { stream: "stdout", text: JSON.stringify(msg).slice(0, 2000) });
    }
  };
}

export function create({ level, tools, config, model, home }) {
  let child = null;
  let session = null;
  let sessionId = null;
  let restarting = false;
  let settled = null; // resolves on the next agent_settled

  function spawnClaude(resume) {
    const p = plan({ level, tools, config, model, home, cwd: session.cwd });
    mkdirSync(p.dir, { recursive: true });
    for (const [file, value] of Object.entries(p.files)) writeFileSync(file, JSON.stringify(value, null, 2));
    const args = resume ? [...p.args, "--resume", resume] : p.args;
    child = spawnCli("claude", args, { cwd: session.cwd, env: session.env, stdio: ["pipe", "pipe", "pipe"] });
    const push = (event, data) => {
      session.push(event, data);
      if (event === "agent_settled") { settled?.(); settled = null; }
    };
    const translate = createTranslator(push, (id) => { sessionId = id ?? sessionId; });
    readLines(child.stdout, (line) => {
      let msg;
      try { msg = JSON.parse(line); } catch { return session.push("log", { stream: "stdout", text: line }); }
      translate(msg);
    });
    readLines(child.stderr, (line) => session.stderrLine(line));
    const me = child;
    child.on("error", (err) => session.push("error", { message: String(err?.message ?? err) }));
    child.on("close", (code) => {
      // A process killed for kill-and-resume can close after its replacement started.
      if (restarting || child !== me) return;
      if (session.streaming) session.push("agent_settled", { subtype: "exited" });
      session.ended(code);
    });
  }

  return {
    name, model,
    start(s) {
      session = s;
      try {
        spawnClaude(null);
      } catch (err) {
        s.push("error", { message: `${err.message}. Install Claude Code: pnpm add -g @anthropic-ai/claude-code` });
        s.ended(1);
        return;
      }
      checkVersion(s);
    },
    async prompt(text) {
      if (restarting) { restarting = false; spawnClaude(sessionId); }
      session.push("agent_start", {});
      child.stdin.write(JSON.stringify({ type: "user", message: { role: "user", content: [{ type: "text", text }] } }) + "\n");
      return { ok: true };
    },
    async abort() {
      if (!session.streaming) return { ok: true };
      const done = new Promise((r) => { settled = r; });
      child.stdin.write(JSON.stringify({ type: "control_request", request_id: `abort-${Date.now()}`, request: { subtype: "interrupt" } }) + "\n");
      const ok = await Promise.race([done.then(() => true), new Promise((r) => setTimeout(() => r(false), 3000))]);
      if (!ok) {
        // The turn did not settle: stop the process; the next prompt resumes the conversation.
        restarting = true;
        killTree(child);
        session.push("agent_settled", { subtype: "killed" });
      }
      return { ok: true };
    },
    close() {
      restarting = false;
      killTree(child);
      setTimeout(() => killTree(child, "SIGKILL"), 2000).unref?.();
    },
  };
}

/** Warn, do not refuse, below the version the stream-json contract was captured on. */
function checkVersion(s) {
  let out = "";
  try {
    const v = spawnCli("claude", ["--version"], { env: s.env, stdio: ["ignore", "pipe", "ignore"] });
    v.stdout.on("data", (c) => (out += c));
    v.on("close", () => {
      const version = out.match(/\d+\.\d+\.\d+/)?.[0];
      if (version && !newer(version, MIN_VERSION)) s.push("error", { message: `Claude Code ${version} is older than ${MIN_VERSION}, the version this lab was tested with; update it if the session misbehaves.` });
    });
  } catch { /* the main spawn reports a missing CLI */ }
}
