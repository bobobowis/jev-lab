/**
 * The pi driver: one long lived `pi --mode rpc` process. pi's events are the lab's vocabulary,
 * so they pass through as they are. Commands go in as JSON lines with an id; responses resolve them.
 */
import { randomUUID } from "node:crypto";
import { killTree, spawnCli } from "../spawn-cli.mjs";
import { readLines } from "./lines.mjs";

export const name = "pi";
export const command = "pi";
export const defaultModel = "openrouter/google/gemini-3.8-flash";

/** pi reads the model's provider key: openrouter/... needs OPENROUTER_API_KEY. The pi extensions call Jev through OpenRouter. */
export function credentialEnv(model) {
  return { names: [`${model.split("/")[0].toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`], prefixes: [], set: { JEV_BACKEND: "openrouter" } };
}

export function create({ extension, tools, model, sessionsDir }) {
  let child = null;
  const pending = new Map();
  let session = null;

  function send(cmd) {
    if (!child || session.closed) return Promise.reject(new Error("session closed"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(JSON.stringify({ id, ...cmd }) + "\n");
      setTimeout(() => {
        if (pending.has(id)) { pending.delete(id); reject(new Error(`${cmd.type} timed out`)); }
      }, 120_000).unref?.();
    });
  }

  async function refreshStats() {
    try {
      const r = await send({ type: "get_session_stats" });
      if (r?.success) session.push("stats", r.data);
    } catch { /* process gone */ }
  }

  function onStdout(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return session.push("log", { stream: "stdout", text: line }); }
    if (msg.type === "response") {
      const p = msg.id ? pending.get(msg.id) : null;
      if (p) { pending.delete(msg.id); p.resolve(msg); }
      return;
    }
    session.push(msg.type, msg);
    if (msg.type === "turn_end" || msg.type === "agent_end" || msg.type === "compaction_end") refreshStats();
  }

  return {
    name, model,
    start(s) {
      session = s;
      const args = [
        "--mode", "rpc", "--offline", "--approve", // trust the sandbox's .pi/settings.json (keepRecentTokens)
        "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes",
        "--model", model, "--thinking", "low",
        "--session-dir", sessionsDir,
        "-e", extension,
        "--tools", tools.join(","),
      ];
      try {
        child = spawnCli("pi", args, { cwd: s.cwd, env: s.env, stdio: ["pipe", "pipe", "pipe"] });
      } catch (err) {
        s.push("error", { message: err.message });
        s.ended(1);
        return;
      }
      child.on("error", (err) => s.push("error", { message: String(err?.message ?? err) }));
      child.on("close", (code) => {
        for (const p of pending.values()) p.reject(new Error("pi exited"));
        pending.clear();
        s.ended(code);
      });
      readLines(child.stdout, onStdout);
      readLines(child.stderr, (line) => s.stderrLine(line));
      send({ type: "get_state" }).then((r) => {
        s.push("state", { model: r?.data?.model ?? null, sessionFile: r?.data?.sessionFile ?? null });
      }).catch(() => {});
    },
    async prompt(message) {
      const r = await send({ type: "prompt", message });
      if (!r.success) throw new Error(r.error ?? "prompt rejected");
      return r;
    },
    abort: () => send({ type: "abort" }),
    close() {
      killTree(child);
      setTimeout(() => killTree(child, "SIGKILL"), 2000).unref?.();
    },
  };
}
