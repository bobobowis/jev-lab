/**
 * Agent sessions: one long lived pi process per lab run, driven over RPC mode.
 *
 * pi speaks JSON lines on stdin and stdout. Commands go in, events come out. The level's
 * extension reports every Jev call and hook decision on stderr as `JEV_EVENT {json}` lines,
 * which this module folds into the same event stream the window subscribes to.
 *
 *   start(config)         spawn pi with the level's extension, tools, cwd, and config
 *   session.prompt(text)  send a prompt, rejected while the agent is streaming
 *   session.abort()       interrupt, resolves once pi is idle again
 *   session.subscribe(fn) every event so far, then live
 *   session.close()       kill the process
 */
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const APP = fileURLToPath(new URL("../", import.meta.url));
const SESSIONS_DIR = join(APP, ".sessions");
const WORK_DIR = join(APP, ".sandboxes");
const IDLE_KILL_MS = 15 * 60_000;

export const agentModel = () => process.env.JEV_AGENT_MODEL || "openrouter/google/gemini-3.8-flash";

const BASE_ENV = ["PATH", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY"];
const JEV_KEYS = ["OPENROUTER_API_KEY", "TYPESAFE_API_KEY"];

/**
 * The environment the agent can see. Its bash tool can print every variable, so pi gets only what a
 * session needs: the shell basics, the Jev keys, the agent model's provider key (openrouter/... reads
 * OPENROUTER_API_KEY), JEV_* settings, and any names listed in JEV_AGENT_ENV, comma separated. Never
 * PI_MODEL or PI_PROVIDER from a calling pi session. The level config rides in on one variable.
 */
export function agentEnv(model, config) {
  const providerKey = `${model.split("/")[0].toUpperCase().replace(/[^A-Z0-9]/g, "_")}_API_KEY`;
  const extra = (process.env.JEV_AGENT_ENV ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const names = new Set([...BASE_ENV, ...JEV_KEYS, providerKey, ...extra]);
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value !== undefined && (names.has(name) || name.startsWith("JEV_"))) env[name] = value;
  }
  return { ...env, JEV_BACKEND: "openrouter", JEV_LEVEL_CONFIG: JSON.stringify(config ?? {}) };
}

const sessions = new Map();

/** Close every session, for a lab that is shutting down. */
export function closeAll() {
  for (const s of [...sessions.values()]) s.close();
}

export function getSession(id) {
  return sessions.get(id);
}

/**
 * `cwd` is the pristine sandbox. Each session gets its own copy under .sandboxes, so an agent that
 * fixes the bug or writes a file never changes what the next session sees. The copy is removed on close.
 */
export function start({ level, option, extension, tools, cwd, config }) {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  const session = new AgentSession({ level, option, extension, tools, cwd, config });
  sessions.set(session.id, session);
  return session;
}

class AgentSession {
  constructor({ level, option, extension, tools, cwd, config }) {
    this.id = randomUUID().slice(0, 8);
    this.level = level;
    this.option = option;
    this.model = agentModel();
    this.events = [];
    this.listeners = new Set();
    this.pending = new Map();
    this.streaming = false;
    this.closed = false;
    this.state = null;
    this.stats = null;
    this.seq = 0;
    this.cwd = join(WORK_DIR, this.id);
    cpSync(cwd, this.cwd, { recursive: true });
    cwd = this.cwd;
    // A git repo of its own with a baseline commit, so `git diff` and `git status` show what the agent changed.
    try {
      const git = (...args) => execFileSync("git", args, { cwd, stdio: "ignore" });
      git("init", "-q");
      git("add", "-A");
      git("-c", "user.name=lab", "-c", "user.email=lab@local", "commit", "-qm", "sandbox baseline");
    } catch (err) {
      console.error(`sandbox git init failed: ${err?.message ?? err}`);
    }

    const args = [
      "--mode", "rpc", "--offline", "--approve", // trust the sandbox's .pi/settings.json (keepRecentTokens)
      "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-themes",
      "--model", this.model, "--thinking", "low",
      "--session-dir", SESSIONS_DIR,
      "-e", extension,
      "--tools", tools.join(","),
    ];
    this.child = spawn("pi", args, { cwd, env: agentEnv(this.model, config), stdio: ["pipe", "pipe", "pipe"] });
    this.child.on("error", (err) => this.push("error", { message: String(err?.message ?? err) }));
    this.child.on("close", (code) => {
      this.closed = true;
      this.push("closed", { code });
      for (const p of this.pending.values()) p.reject(new Error("pi exited"));
      this.pending.clear();
    });
    this.readLines(this.child.stdout, (line) => this.onStdout(line));
    this.readLines(this.child.stderr, (line) => this.onStderr(line));
    this.touch();

    this.push("session", { id: this.id, level, option, model: this.model, cwd });
    this.send({ type: "get_state" }).then((r) => {
      this.state = r?.data ?? null;
      this.push("state", { model: r?.data?.model ?? null, sessionFile: r?.data?.sessionFile ?? null });
    }).catch(() => {});
  }

  /** Strict JSONL: split on LF only. Node's readline also splits on U+2028, which breaks JSON strings. */
  readLines(stream, onLine) {
    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      buffer += chunk;
      let i;
      while ((i = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, i).replace(/\r$/, "");
        buffer = buffer.slice(i + 1);
        if (line) onLine(line);
      }
    });
  }

  onStdout(line) {
    let msg;
    try { msg = JSON.parse(line); } catch { return this.push("log", { stream: "stdout", text: line }); }
    if (msg.type === "response") {
      const p = msg.id ? this.pending.get(msg.id) : null;
      if (p) { this.pending.delete(msg.id); p.resolve(msg); }
      return;
    }
    if (msg.type === "agent_start") this.streaming = true;
    if (msg.type === "agent_settled" || msg.type === "agent_end") this.streaming = false;
    this.push(msg.type, msg);
    if (msg.type === "turn_end" || msg.type === "agent_end" || msg.type === "compaction_end") this.refreshStats();
  }

  onStderr(line) {
    if (line.startsWith("JEV_EVENT ")) {
      try { return this.push("jev", JSON.parse(line.slice(10))); } catch { /* fall through */ }
    }
    this.push("log", { stream: "stderr", text: line.slice(0, 2000) });
  }

  async refreshStats() {
    try {
      const r = await this.send({ type: "get_session_stats" });
      if (r?.success) { this.stats = r.data; this.push("stats", r.data); }
    } catch { /* process gone */ }
  }

  push(event, data) {
    const item = { seq: ++this.seq, event, data, at: Date.now() };
    this.events.push(item);
    if (this.events.length > 5000) this.events.splice(0, this.events.length - 5000);
    for (const l of this.listeners) l(item);
    this.touch();
  }

  subscribe(listener) {
    for (const item of this.events) listener(item);
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  send(cmd) {
    if (this.closed) return Promise.reject(new Error("session closed"));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.child.stdin.write(JSON.stringify({ id, ...cmd }) + "\n");
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error(`${cmd.type} timed out`)); }
      }, 120_000);
    });
  }

  async prompt(message) {
    if (this.streaming) throw new Error("the agent is still running; Stop it first");
    this.push("prompt", { message });
    const r = await this.send({ type: "prompt", message });
    if (!r.success) throw new Error(r.error ?? "prompt rejected");
    return r;
  }

  async abort() {
    this.push("abort", {});
    const r = await this.send({ type: "abort" });
    this.streaming = false;
    return r;
  }

  touch() {
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.close(), IDLE_KILL_MS);
    this.idleTimer.unref?.();
  }

  close() {
    clearTimeout(this.idleTimer);
    sessions.delete(this.id);
    if (this.closed) return;
    this.closed = true;
    try { this.child.kill("SIGTERM"); } catch { /* already gone */ }
    setTimeout(() => {
      try { this.child.kill("SIGKILL"); } catch { /* gone */ }
      try { rmSync(this.cwd, { recursive: true, force: true }); } catch { /* best effort */ }
    }, 2000).unref?.();
  }
}
