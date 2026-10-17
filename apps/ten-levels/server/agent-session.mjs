/**
 * Agent sessions: one coding agent per lab run, in its own git copy of the sandbox.
 *
 * The session is the same whichever harness runs it: the sandbox copy, the baseline commit, the
 * event buffer and its subscribers, the idle kill, and a per-session event directory that every
 * reporting process writes to (the pi extension, the MCP server, the hook runner). A driver per
 * harness (drivers/) spawns the CLI and translates its stream into the lab's event vocabulary.
 *
 *   start(config)         copy the sandbox, start the driver
 *   session.prompt(text)  send a prompt, rejected while the agent is running
 *   session.abort()       interrupt, resolves once the agent is idle again
 *   session.subscribe(fn) every event so far, then live
 *   session.close()       stop the agent and remove the copy
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { DRIVERS } from "./drivers/index.mjs";
import { tailEventDir } from "./event-tail.mjs";

const APP = fileURLToPath(new URL("../", import.meta.url));
const SESSIONS_DIR = join(APP, ".sessions");
const WORK_DIR = join(APP, ".sandboxes");
const IDLE_KILL_MS = 15 * 60_000;

/** The model for a harness: JEV_AGENT_MODEL when set, otherwise the driver's default. */
export const agentModel = (driver = DRIVERS.pi) => process.env.JEV_AGENT_MODEL || driver.defaultModel;

const BASE_ENV = ["PATH", "Path", "HOME", "USER", "LOGNAME", "SHELL", "TMPDIR", "LANG", "LC_ALL", "TERM", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "XDG_CONFIG_HOME", "XDG_DATA_HOME", "XDG_STATE_HOME", "XDG_CACHE_HOME"];
const WINDOWS_ENV = ["USERPROFILE", "APPDATA", "LOCALAPPDATA", "SystemRoot", "SYSTEMROOT", "windir", "ComSpec", "PATHEXT", "TEMP", "TMP", "HOMEDRIVE", "HOMEPATH", "ProgramData", "ProgramFiles"];
const JEV_KEYS = ["OPENROUTER_API_KEY", "TYPESAFE_API_KEY"];

/**
 * The environment the agent can see. Its shell can print every variable, so it gets only what a
 * session needs: the shell basics, the Jev keys, the harness's own credentials, JEV_* settings, and
 * names listed in JEV_AGENT_ENV, comma separated. Never PI_MODEL or PI_PROVIDER from a calling pi
 * session. The level config, the event directory, and the state directory ride in on JEV_ variables.
 */
export function agentEnv(model, config, driver = DRIVERS.pi, dirs = {}) {
  const creds = driver.credentialEnv(model);
  const extra = (process.env.JEV_AGENT_ENV ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const names = new Set([...BASE_ENV, ...WINDOWS_ENV, ...JEV_KEYS, ...creds.names, ...extra]);
  const env = {};
  for (const [name, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (names.has(name) || name.startsWith("JEV_") || creds.prefixes.some((p) => name.startsWith(p))) env[name] = value;
  }
  const out = { ...env, ...creds.set, JEV_LEVEL_CONFIG: JSON.stringify(config ?? {}) };
  if (dirs.eventDir) out.JEV_EVENT_DIR = dirs.eventDir;
  if (dirs.stateDir) out.JEV_STATE_DIR = dirs.stateDir;
  return out;
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
export function start({ level, option, extension, tools, cwd, config, harness = "pi" }) {
  const driverModule = DRIVERS[harness];
  if (!driverModule) throw new Error(`unknown harness ${harness}`);
  mkdirSync(SESSIONS_DIR, { recursive: true });
  const session = new AgentSession({ level, option, extension, tools, cwd, config, driverModule });
  sessions.set(session.id, session);
  session.begin();
  return session;
}

class AgentSession {
  constructor({ level, option, extension, tools, cwd, config, driverModule }) {
    this.id = randomUUID().slice(0, 8);
    this.level = level;
    this.option = option;
    this.harness = driverModule.name;
    this.model = agentModel(driverModule);
    this.events = [];
    this.listeners = new Set();
    this.streaming = false;
    this.closed = false;
    this.seq = 0;
    this.home = join(SESSIONS_DIR, this.id);
    this.eventDir = join(this.home, "events");
    this.stateDir = join(this.home, "state");
    mkdirSync(this.eventDir, { recursive: true });
    this.cwd = join(WORK_DIR, this.id);
    cpSync(cwd, this.cwd, { recursive: true });
    // A git repo of its own with a baseline commit, so `git diff` and `git status` show what the agent changed.
    try {
      const git = (...args) => execFileSync("git", args, { cwd: this.cwd, stdio: "ignore" });
      git("init", "-q");
      git("add", "-A");
      git("-c", "user.name=lab", "-c", "user.email=lab@local", "commit", "-qm", "sandbox baseline");
    } catch (err) {
      console.error(`sandbox git init failed: ${err?.message ?? err}`);
    }
    this.env = agentEnv(this.model, config, driverModule, { eventDir: this.eventDir, stateDir: this.stateDir });
    this.driver = driverModule.create({ level, option, extension, tools, config, model: this.model, sessionsDir: SESSIONS_DIR, home: this.home });
    // Every reporting process writes its own file here; the tail folds them into this stream.
    this.tail = tailEventDir(this.eventDir, (event) => this.push("jev", event));
  }

  begin() {
    this.touch();
    this.push("session", { id: this.id, level: this.level, option: this.option, model: this.model, harness: this.harness, cwd: this.cwd });
    this.driver.start(this);
  }

  /** A driver reports its process ended. */
  ended(code) {
    this.exited = true;
    if (this.removeOnExit) this.removeCopy();
    if (this.closed) return;
    this.closed = true;
    this.streaming = false;
    this.tail.stop();
    this.push("closed", { code });
  }

  /** stderr from the agent process: JEV_EVENT lines from an extension without an event dir, otherwise a log line. */
  stderrLine(line) {
    if (line.startsWith("JEV_EVENT ")) {
      try { return this.push("jev", JSON.parse(line.slice(10))); } catch { /* fall through */ }
    }
    this.push("log", { stream: "stderr", text: line.slice(0, 2000) });
  }

  push(event, data) {
    if (event === "agent_start") this.streaming = true;
    if (event === "agent_settled" || event === "agent_end") this.streaming = false;
    if (event === "stats") this.stats = data;
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

  async prompt(message) {
    if (this.closed) throw new Error("session closed");
    if (this.streaming) throw new Error("the agent is still running; Stop it first");
    this.push("prompt", { message });
    return this.driver.prompt(message);
  }

  async abort() {
    this.push("abort", {});
    const r = await this.driver.abort();
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
    this.closed = true;
    try { this.driver.close(); } catch { /* already gone */ }
    this.tail.stop();
    // The copy goes once the agent has let go of its files: now if it already exited, else on exit.
    if (this.exited) return this.removeCopy();
    this.removeOnExit = true;
    setTimeout(() => this.removeCopy(), 2500).unref?.();
  }

  removeCopy() {
    try { rmSync(this.cwd, { recursive: true, force: true }); } catch { /* best effort; Windows may still hold a file */ }
  }
}
