/**
 * The Codex driver: one `codex exec --json` process per prompt, and `codex exec resume <thread>` for
 * follow ups (docs/NOTES-codex.md in the package). Everything is passed as -c overrides, so neither
 * the user's config.toml nor their hooks.json is read or written: the jev MCP server (with env_vars,
 * since Codex starts MCP servers without the environment) and one hook entry per event.
 *
 *   item command_execution, mcp_tool_call, file_change -> tool_execution_start / _end
 *   item agent_message                                -> message_end
 *   turn.completed                                    -> stats, agent_settled
 * Abort kills the process tree; the next prompt resumes the thread. No cost is reported.
 */
import { readdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { codexTokenCount } from "@bobobowis/jev-kit/hooks";
import { defaultCommand, hookGroups, MCP_ENV_VARS } from "@bobobowis/jev-kit/setup";
import { killTree, spawnCli } from "../spawn-cli.mjs";
import { readLines } from "./lines.mjs";
import { selectionFor } from "./selection.mjs";

export const name = "codex";
export const command = "codex";
/** Codex's own default model, unless JEV_AGENT_MODEL names one. */
export const defaultModel = "";

export function credentialEnv() {
  return { names: ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_HOME"], prefixes: [], set: {} };
}

const toml = (v) => (Array.isArray(v) ? `[${v.map(toml).join(",")}]` : typeof v === "object" && v ? `{${Object.entries(v).map(([k, x]) => `${k}=${toml(x)}`).join(",")}}` : JSON.stringify(v));

/** The -c overrides and the hook-trust flags for one option; the prompt goes on stdin. */
export function plan({ level, tools, config, model, cwd }) {
  const { sel, hookArgs } = selectionFor(level, tools, config);
  const bin = defaultCommand();
  const c = (key, value) => ["-c", `${key}=${toml(value)}`];
  const args = [
    "--json", "--ignore-user-config", "--dangerously-bypass-hook-trust", "--skip-git-repo-check",
    ...c("approval_policy", "never"), ...c("sandbox_mode", "workspace-write"),
  ];
  if (model) args.push("-m", model);
  if (sel.tools.length) {
    args.push(
      ...c("mcp_servers.jev.command", bin[0]),
      ...c("mcp_servers.jev.args", [...bin.slice(1), "mcp", "--tools", sel.tools.join(","), "--cwd", cwd]),
      ...c("mcp_servers.jev.default_tools_approval_mode", "approve"),
      ...c("mcp_servers.jev.env_vars", MCP_ENV_VARS),
    );
  }
  for (const [event, groups] of Object.entries(hookGroups("codex", sel, bin, hookArgs))) args.push(...c(`hooks.${event}`, groups));
  return { args, sel };
}

/** `/bin/bash -lc 'npm test'` is how exec items show a command; the row shows `npm test`. */
export const plainCommand = (cmd) => {
  const m = String(cmd ?? "").match(/^\S*sh -lc (.*)$/s);
  if (!m) return String(cmd ?? "");
  const inner = m[1].trim();
  if (inner.length > 1 && inner.startsWith("'") && inner.endsWith("'")) return inner.slice(1, -1).replace(/'\\''/g, "'");
  if (inner.length > 1 && inner.startsWith('"') && inner.endsWith('"')) return inner.slice(1, -1).replace(/\\(["\\$`])/g, "$1");
  return inner;
};

const toolOf = (item) => {
  if (item.type === "command_execution") return { toolName: "Bash", args: { command: plainCommand(item.command) } };
  if (item.type === "mcp_tool_call") return { toolName: `mcp__${item.server}__${item.tool}`, args: item.arguments ?? {} };
  if (item.type === "file_change") return { toolName: "apply_patch", args: { path: (item.changes ?? []).map((c) => c.path).join(", ") } };
  return null;
};

function resultOf(item) {
  if (item.type === "command_execution") return { text: item.aggregated_output ?? "", isError: item.exit_code !== 0 };
  if (item.type === "mcp_tool_call") {
    const text = item.error ? String(item.error.message ?? item.error) : (item.result?.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("\n");
    return { text, isError: item.status !== "completed" || Boolean(item.error) };
  }
  return { text: (item.changes ?? []).map((c) => `${c.kind} ${c.path}`).join("\n"), isError: item.status !== "completed" };
}

/** Turn exec JSONL into the lab's events. Pure, so a test can replay a capture through it. */
export function createTranslator(push, { onThread = () => {}, usage = () => null } = {}) {
  return function translate(msg) {
    const item = msg.item;
    switch (msg.type) {
      case "thread.started": onThread(msg.thread_id); return;
      case "turn.started": return;
      case "item.started": {
        const t = item && toolOf(item);
        if (t) push("tool_execution_start", { toolCallId: item.id, ...t });
        return;
      }
      case "item.completed": {
        if (!item) return;
        if (item.type === "agent_message") return push("message_end", { message: { role: "assistant", content: [{ type: "text", text: item.text ?? "" }] } });
        if (item.type === "error") {
          if (/--dangerously-bypass-hook-trust/.test(item.message ?? "")) return; // the flag's own notice
          if (/^clamping .* hook timeout/i.test(item.message ?? "")) return push("log", { stream: "codex", text: item.message });
          return push("error", { message: item.message });
        }
        if (toolOf(item)) {
          const r = resultOf(item);
          return push("tool_execution_end", { toolCallId: item.id, result: { content: [{ type: "text", text: r.text }] }, isError: r.isError });
        }
        return;
      }
      case "turn.completed": {
        const u = msg.usage ?? {};
        const ctx = usage();
        // Tokens are cumulative for the thread; Codex reports no cost, so the field stays empty.
        push("stats", {
          cost: null,
          tokens: { input: u.input_tokens ?? null, cached: u.cached_input_tokens ?? null, output: u.output_tokens ?? null },
          contextUsage: ctx ? { tokens: ctx.tokens, contextWindow: ctx.window, percent: ctx.pct } : null,
        });
        push("agent_settled", {});
        return;
      }
      case "turn.failed":
        push("error", { message: msg.error?.message ?? "turn failed" });
        push("agent_settled", { subtype: "failed" });
        return;
      default:
        push("log", { stream: "stdout", text: JSON.stringify(msg).slice(0, 2000) });
    }
  };
}

/** The rollout file for a thread, under CODEX_HOME/sessions, for context usage. */
export function findRollout(threadId, env = process.env) {
  const root = join(env.CODEX_HOME || join(env.HOME || env.USERPROFILE || homedir(), ".codex"), "sessions");
  try {
    const hit = readdirSync(root, { recursive: true }).map(String).find((f) => f.endsWith(".jsonl") && f.includes(threadId));
    return hit ? join(root, hit) : null;
  } catch {
    return null;
  }
}

export function create({ level, tools, config, model }) {
  let session = null;
  let child = null;
  let threadId = null;
  let aborted = false;
  let rollout = null;

  const usage = () => {
    rollout ??= threadId ? findRollout(threadId, session.env) : null;
    const c = rollout ? codexTokenCount(rollout) : null;
    return c ? { tokens: c.tokens, window: c.window, pct: c.window ? (c.tokens / c.window) * 100 : null } : null;
  };

  return {
    name, model,
    start(s) {
      session = s;
      s.push("state", { model: { provider: "openai", id: model || "codex default" } });
    },
    async prompt(text) {
      const { args } = plan({ level, tools, config, model, cwd: session.cwd });
      const argv = threadId ? ["exec", "resume", ...args, threadId, "-"] : ["exec", ...args, "-"];
      try {
        child = spawnCli("codex", argv, { cwd: session.cwd, env: session.env, stdio: ["pipe", "pipe", "pipe"] });
      } catch (err) {
        session.push("error", { message: `${err.message}. Install Codex: npm install -g @openai/codex` });
        throw err;
      }
      aborted = false;
      // Per run: a previous run's process can close after this one started, and must not settle it.
      const run = { child, settled: false };
      session.push("agent_start", {});
      const translate = createTranslator((e, d) => {
        if (e === "agent_settled") run.settled = true;
        session.push(e, d);
      }, { onThread: (id) => { threadId ??= id; }, usage });
      const tailErr = [];
      readLines(child.stdout, (line) => {
        let msg;
        try { msg = JSON.parse(line); } catch { return session.push("log", { stream: "stdout", text: line }); }
        translate(msg);
      });
      readLines(child.stderr, (line) => {
        if (line.startsWith("Reading additional input from stdin")) return;
        tailErr.push(line);
        if (tailErr.length > 20) tailErr.shift();
        session.stderrLine(line);
      });
      run.child.on("close", (code) => {
        if (run.settled) return;
        run.settled = true;
        if (code && !aborted) session.push("error", { message: `codex exited with ${code}: ${tailErr.slice(-3).join(" ")}`.trim() });
        session.push("agent_settled", { subtype: aborted ? "killed" : "exited" });
      });
      child.stdin.end(text);
      return { ok: true };
    },
    async abort() {
      if (!child || child.exitCode !== null || child.signalCode !== null) return { ok: true };
      aborted = true;
      // Wait for the exit, so the close handler reports the run as killed before the session settles.
      const exited = new Promise((r) => child.once("close", r));
      killTree(child);
      await Promise.race([exited, new Promise((r) => setTimeout(r, 3000))]);
      return { ok: true };
    },
    close() {
      aborted = true;
      killTree(child);
      session?.ended(0);
    },
  };
}
