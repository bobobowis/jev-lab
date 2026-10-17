/**
 * jev ask, files, gate, guard. In process with an injected client where the verdict matters,
 * as a real process where the environment matters (no key, no silent mock).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { fileURLToPath } from "node:url";
import { main } from "../src/cli/main.ts";

const BIN = fileURLToPath(new URL("../src/cli/index.ts", import.meta.url));
const Q = JSON.stringify({ about_auth: { type: "noul", instructions: "Is `files` about authentication?" } });

function repo() {
  const dir = mkdtempSync(join(tmpdir(), "jev-cli-"));
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "node_modules"));
  writeFileSync(join(dir, "src", "session.ts"), "export const validate = (t: string) => t.length > 0;\n");
  writeFileSync(join(dir, "src", "plans.ts"), "export const PLANS = ['free'];\n");
  writeFileSync(join(dir, "src", "logo.png"), "png");
  writeFileSync(join(dir, "node_modules", "dep.js"), "x");
  return dir;
}

/** A client that answers every question from `answer(questionId)`. */
const client = (answer: (id: string) => unknown) => () => ({
  systemOne: async (_state: unknown, questions: Record<string, unknown>) => ({
    answers: Object.fromEntries(Object.keys(questions).map((id) => [id, answer(id)])) as any,
    usage: { input_tokens: 10, output_tokens: 2 }, model: "fake",
  }) as any,
});
const noulOf = (p: number) => client(() => ({ type: "noul", noul: p }));
const bash = (choice: string, confidence: number, destructive: number) => client((id) =>
  id === "effect" ? { type: "choice", choice, confidence, probabilities: { [choice]: confidence } } : { type: "noul", noul: destructive });
const throwing = () => ({ systemOne: async () => { throw new Error("network down"); } }) as any;

function run(argv: string[], opts: { client?: any; stdin?: string } = {}) {
  const out: string[] = [], err: string[] = [];
  const io = { stdout: { write: (s: string) => out.push(s) }, stderr: { write: (s: string) => err.push(s) }, stdin: Readable.from([opts.stdin ?? ""]), client: opts.client };
  return main(argv, io).then((code) => ({ code, out: out.join(""), err: err.join("") }));
}

test("ask: stdout is one JSON object with answers, state_summary, and usage, nothing else", async () => {
  const dir = repo();
  const r = await run(["ask", "--questions", Q, "--paths", "src/*.ts", "--state", "a note", "--cwd", dir], { client: noulOf(0.9) });
  assert.equal(r.code, 0, r.err);
  const parsed = JSON.parse(r.out);
  assert.deepEqual(Object.keys(parsed).sort(), ["answers", "model", "state_summary", "usage"]);
  assert.equal(parsed.answers.about_auth.noul, 0.9);
  assert.deepEqual(parsed.state_summary.files, ["src/plans.ts", "src/session.ts"]);
  assert.deepEqual(parsed.state_summary.own_fields, ["text"]);
});

test("ask: questions from a file with @, and a state from a file", async () => {
  const dir = repo();
  writeFileSync(join(dir, "q.json"), Q);
  writeFileSync(join(dir, "state.json"), JSON.stringify({ ticket: "login fails" }));
  const r = await run(["ask", "--questions", `@${join(dir, "q.json")}`, "--state-file", join(dir, "state.json"), "--cwd", dir], { client: noulOf(0.4) });
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(JSON.parse(r.out).state_summary.own_fields, ["ticket"]);
});

test("ask: over the budget it exits 1 and stderr names the parts and a split", async () => {
  const dir = repo();
  writeFileSync(join(dir, "big-a.txt"), "a".repeat(150_000));
  writeFileSync(join(dir, "big-b.txt"), "b".repeat(150_000));
  const r = await run(["ask", "--questions", Q, "--paths", "big-a.txt", "--paths", "big-b.txt", "--cwd", dir], { client: noulOf(0.5) });
  assert.equal(r.code, 1);
  assert.equal(r.out, "");
  assert.match(r.err, /the state is 75\.0k tokens, the limit per call is 60\.0k tokens/);
  assert.match(r.err, /Split into 2 calls/);
});

test("ask: a command the bash gate refuses never runs", async () => {
  const dir = repo();
  const r = await run(["ask", "--questions", Q, "--command", "rm -rf src", "--cwd", dir], { client: bash("irreversible", 0.99, 0.95) });
  assert.equal(r.code, 1);
  assert.match(r.err, /refused by the bash gate/);
  assert.equal(spawnSync("ls", [join(dir, "src")]).status, 0);
});

test("ask: bad questions and missing options exit non-zero with a reason", async () => {
  assert.equal((await run(["ask", "--questions", "{nope"], { client: noulOf(1) })).code, 1);
  assert.equal((await run(["ask"])).code, 2);
  assert.equal((await run(["ask", "--frobnicate"])).code, 2);
});

test("files: one result per file, junk and dependencies under skipped with a reason", async () => {
  const dir = repo();
  const r = await run(["files", "**/*", "node_modules/dep.js", "src/logo.png", "--questions", JSON.stringify({ q: { type: "noul", instructions: "Does `content` export?" } }), "--cwd", dir], { client: noulOf(0.7) });
  assert.equal(r.code, 0, r.err);
  const parsed = JSON.parse(r.out);
  assert.deepEqual(parsed.results.map((x: any) => x.path), ["src/plans.ts", "src/session.ts"]);
  const reasons = Object.fromEntries(parsed.skipped.map((s: any) => [s.path, s.reason]));
  assert.match(reasons["node_modules/dep.js"], /skipped directory/);
  assert.match(reasons["src/logo.png"], /binary/);
  assert.equal(parsed.calls, 2);
});

test("gate: exit 0 at or above the threshold, 1 below, with --json printing the answer", async () => {
  const dir = repo();
  const yes = await run(["gate", "Does this diff add a secret?", "--state", "+API_KEY=sk-live-1", "--threshold", "0.7", "--json", "--cwd", dir], { client: noulOf(0.7) });
  assert.equal(yes.code, 0);
  assert.deepEqual(JSON.parse(yes.out), { noul: 0.7, threshold: 0.7, yes: true });
  const no = await run(["gate", "Does this diff add a secret?", "--state", "+name = 'x'", "--threshold", "0.7", "--cwd", dir], { client: noulOf(0.69) });
  assert.equal(no.code, 1);
  assert.equal(no.out, "");
});

test("gate: 2 for bad usage or a state that cannot be sent, 3 when Jev cannot answer", async () => {
  const dir = repo();
  assert.equal((await run(["gate", "--state", "x"], { client: noulOf(1) })).code, 2);
  assert.equal((await run(["gate", "q?", "--state", "x", "--threshold", "2"], { client: noulOf(1) })).code, 2);
  assert.equal((await run(["gate", "q?", "--cwd", dir], { client: noulOf(1) })).code, 2); // nothing to judge
  const down = await run(["gate", "q?", "--state", "x", "--cwd", dir], { client: throwing });
  assert.equal(down.code, 3);
  assert.match(down.err, /network down/);
});

test("guard: bash and write verdicts as exit codes, a Jev error is 3, never a silent allow", async () => {
  const dir = repo();
  const force = await run(["guard", "bash", "git push --force origin main", "--cwd", dir], { client: bash("irreversible", 0.99, 0.9) });
  assert.equal(force.code, 1);
  assert.match(force.out, /^block: irreversible \(0\.99\)/);
  const ls = await run(["guard", "bash", "ls", "--cwd", dir, "--json"], { client: bash("read_only", 1, 0) });
  assert.equal(ls.code, 0);
  assert.equal(JSON.parse(ls.out).block, false);
  const secret = client((id) => (id === "kind" ? { type: "choice", choice: "config", confidence: 0.9, probabilities: {} } : { type: "noul", noul: 0.95 }));
  const w = await run(["guard", "write", "config/.env", "--cwd", dir], { client: secret, stdin: "KEY=sk-live-abc" });
  assert.equal(w.code, 1);
  assert.match(w.out, /^block: contains a credential/);
  assert.equal((await run(["guard", "bash", "ls", "--cwd", dir], { client: throwing })).code, 3);
  assert.equal((await run(["guard", "rm", "x"])).code, 2);
});

test("no key and no --mock: an error naming the variables, no decision, no mock", () => {
  const env = { ...process.env };
  for (const k of ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "JEV_BACKEND", "NODE_TEST_CONTEXT", "JEV_EVENT_DIR"]) delete env[k];
  const gate = spawnSync(process.execPath, [BIN, "gate", "Is it urgent?", "--state", "help"], { env, encoding: "utf8" });
  assert.equal(gate.status, 3);
  assert.match(gate.stderr, /TYPESAFE_API_KEY or OPENROUTER_API_KEY/);
  assert.equal(gate.stdout, "");
  const ask = spawnSync(process.execPath, [BIN, "ask", "--questions", Q, "--state", "help"], { env, encoding: "utf8" });
  assert.equal(ask.status, 1);
  assert.match(ask.stderr, /TYPESAFE_API_KEY or OPENROUTER_API_KEY/);
});

test("a reader that closes stdout early ends the output quietly, with no EPIPE trace", async () => {
  const child = spawn(process.execPath, [BIN, "ask", "--questions", Q, "--state", "help", "--mock"], { stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.destroy();
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; });
  const code = await new Promise((resolve) => child.on("close", resolve));
  assert.doesNotMatch(stderr, /EPIPE|Unhandled/);
  assert.equal(code, 0);
});
