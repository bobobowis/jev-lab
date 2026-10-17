#!/usr/bin/env node
/**
 * Every recipe as a named task, so npm and a bare terminal run the same thing on Windows,
 * macOS, and Linux. No shell: node runs as process.execPath, tsc through its JS entry, bun as an
 * executable. Node children load the repo's .env with --env-file-if-exists.
 *
 *   node scripts/run.mjs <task> [args]
 *   tasks: build, level <n> [a|b|c], demo, demo-live, test, test-live, web, dev, lint, heroes, mcp [args], sync-skill
 */
const REQUIRED = [22, 18];
const [major, minor] = process.versions.node.split(".").map(Number);
if (major < REQUIRED[0] || (major === REQUIRED[0] && minor < REQUIRED[1])) {
  console.error(`10 Levels of Jev needs Node ${REQUIRED.join(".")} or later (24 recommended); this is Node ${process.versions.node}.`);
  process.exit(1);
}

const { spawn } = await import("node:child_process");
const { createRequire } = await import("node:module");
const { dirname, join } = await import("node:path");
const { fileURLToPath } = await import("node:url");

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "apps", "ten-levels");
const WEB = join(APP, "web");
const KIT = join(ROOT, "packages", "jev-kit");
const ENV_FILE = `--env-file-if-exists=${join(ROOT, ".env")}`;
const require = createRequire(join(KIT, "package.json"));

/** Run one command, inheriting stdio. Resolves with its exit code. */
function run(command, args, { cwd = ROOT, env = {} } = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
    child.on("error", (err) => {
      console.error(err.code === "ENOENT" ? `run: ${command} is not installed or not on PATH.` : `run: ${command}: ${err.message}`);
      resolve(127);
    });
    child.on("exit", (code, signal) => resolve(code ?? (signal ? 1 : 0)));
  });
}
const node = (args, opts) => run(process.execPath, args, opts);
const bun = (args) => run("bun", args, { cwd: WEB });
const tsc = (args) => node([require.resolve("typescript/bin/tsc"), ...args], { cwd: KIT });
const build = () => tsc(["-b", "tsconfig.build.json"]);

/** Run steps in order, stopping at the first that fails. */
async function steps(...fns) {
  for (const fn of fns) {
    const code = await fn();
    if (code) return code;
  }
  return 0;
}

const PORT = Number(process.env.PORT || 4399);
const LAB = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const reachable = () => fetch(`${LAB}/api/state`).then((r) => r.ok, () => false);

/** Ask a lab already on the port to stop, then wait for the port. A foreign process gets a message, not a kill. */
async function freePort() {
  let res;
  try {
    res = await fetch(`${LAB}/api/shutdown`, { method: "POST", headers: { "x-jev-lab": "shutdown" } });
  } catch {
    return 0; // nothing is listening
  }
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.lab) {
    console.error(`run: port ${PORT} is held by another program, not a 10 Levels of Jev lab. Stop it, or start the lab on another port with PORT=4400.`);
    return 1;
  }
  for (let i = 0; i < 50; i++) {
    if (!(await reachable())) return 0;
    await sleep(100);
  }
  console.error(`run: the lab on port ${PORT} did not stop.`);
  return 1;
}

/** Start the server, open the browser once it answers, and run until it exits. */
async function serveAndOpen() {
  const exited = node([ENV_FILE, "server/server.mjs"], { cwd: APP });
  let done = false;
  exited.then(() => { done = true; });
  for (let i = 0; i < 150 && !done; i++) {
    if (await reachable()) {
      const { openUrl } = await import("./open-url.mjs");
      await openUrl(LAB);
      break;
    }
    await sleep(100);
  }
  return exited;
}

const tasks = {
  build,
  level: (n, option = "") => steps(build, () => node([ENV_FILE, "src/level.ts", n, option].filter(Boolean), { cwd: APP })),
  demo: () => steps(build, () => node(["src/demo.ts", "--mock"], { cwd: APP })),
  "demo-live": () => steps(build, () => node([ENV_FILE, "src/demo.ts"], { cwd: APP })),
  test: () => steps(
    build,
    () => node(["--test", "tests/**/*.test.ts"], { cwd: KIT }),
    () => node(["--test", "tests/**/*.test.ts"], { cwd: APP }),
  ),
  "test-live": () => steps(build, () => node([ENV_FILE, "--test", "tests/live.test.ts"], { cwd: APP, env: { JEV_LIVE: "1", JEV_BACKEND: "openrouter" } })),
  web: () => steps(build, () => bun(["run", "build"]), freePort, serveAndOpen),
  dev: async () => {
    const watch = tsc(["-b", "tsconfig.build.json", "--watch", "--preserveWatchOutput"]);
    const code = await bun(["run", "dev"]);
    return code || watch;
  },
  lint: () => bun(["run", "lint"]),
  heroes: () => bun(["run", "heroes"]),
  mcp: (...args) => steps(build, () => node([ENV_FILE, join(KIT, "dist", "cli", "index.js"), "mcp", ...args], { cwd: APP })),
  "sync-skill": () => node([join(ROOT, "scripts", "sync-skill-core.mjs")]),
};

const [name, ...args] = process.argv.slice(2);
if (!name || !tasks[name]) {
  console.error(`Usage: node scripts/run.mjs <task> [args]\nTasks: ${Object.keys(tasks).join(", ")}`);
  process.exit(name ? 2 : 0);
}
process.exitCode = await tasks[name](...args);
