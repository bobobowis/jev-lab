# 10 Levels of Jev — a tested codebase

Concrete use cases for [Jev](https://typesafe.ai), TypeSafe AI's System One model, arranged from one
smart `if` statement to a coding agent that **authors its own choice blocks at runtime**.

Every level ships **three options** — three different concrete builds of the same idea — and every
option is covered by tests. Zero runtime dependencies. Node 22.18 or later (24 recommended) runs the
TypeScript natively; `npm install` at the repo root links the workspace and builds `@bobobowis/jev-kit`,
the package the levels import, once.

```
npm install  # at the repo root, once
npm test     # the package's tests, then the lab's: offline, deterministic mock backend
npm run demo # print every level's three options running end to end
```

Every command here runs the same in a macOS or Linux shell and in Windows PowerShell or cmd.

## The live lab

```sh
npm run web   # → http://127.0.0.1:4399
```

Ten level pages. Levels 1 to 5 run one call: edit the state, **Run live**, and read the request,
the typed answers as probability bars, the response body, and a cost table against six chat models.
Levels 6 to 10 open an **agent window**: a real session in a copy of `sandbox/`, under the coding
agent picked in the window's Harness menu: pi with the level's extension loaded, or Claude Code or
Codex with the level's hooks (`jev hook`) and tools (`jev mcp`). Each gets an explicit tool
allowlist. You prompt it, the box locks, Go becomes Stop, and every tool call, hook decision, and
Jev call lands as one line. Click a line for the details. The footer shows the agent and model, the
LLM cost, the Jev cost, and the context bar. Codex reports tokens but no cost, so its LLM figure is
tokens in and out; anything an agent doesn't report stays blank.

| Level | What the agent window shows |
|---|---|
| 6 Guardrail hooks | the agent window: each tool call, and the hook that blocked or allowed it, one line each |
| 7 Should I compact | the agent window: every turn's four answers and the tier, silent to request |
| 8 Cheap reads | the agent window: ask_jev_file calls with the file never appearing |
| 9 Files at scale | the agent window: one Jev row per file, in parallel, then the pick |
| 10 Agentic Jev | the agent window: ask_jev calls the agent chose to make, and the spend ledger |

Live against OpenRouter when `OPENROUTER_API_KEY` is set (`JEV_BACKEND=mock` forces the offline
mock for levels 1 to 5). The agent comes from the page's picker, then `JEV_AGENT`, then the first
installed of pi, Claude Code, and Codex. Each signs in its own way and has its own default model,
overridden with `JEV_AGENT_MODEL`:

| Agent | Signs in with | Default model |
|---|---|---|
| pi 0.85.1+ | `OPENROUTER_API_KEY` for the default model, or the key of the provider in `JEV_AGENT_MODEL` | `openrouter/google/gemini-3.8-flash` |
| Claude Code 2.1.302+ | your `claude` login, or `ANTHROPIC_API_KEY` | `claude-haiku-5-5` |
| Codex 0.162+ | your `codex login`, or `OPENAI_API_KEY` | your account's default |

The agent's environment holds only the shell basics, the Jev keys, its own credentials, and
`JEV_*` settings; a child pi never inherits `PI_MODEL`/`PI_PROVIDER` from a calling pi session.
Extensions, hooks, and the MCP server report every decision as JSON lines in the session's event
directory, which the server folds into the window.

Tests: offline with `npm test` (mock backend), and **10 live** with `npm run test:live`, one per level.

## The ladder

| Level | Idea | Options |
|---|---|---|
| 01 Single decisions | the smart if-statement | prompt injection gate · urgency gate · ticket classifier |
| 02 Multiple choice | pick one declared option, several questions per call | support triage · resume screening · sponsor-form qualification |
| 03 Composite scoring | one judgment per dimension, weights in code | ticket priority · code-review risk · startup-idea verdict |
| 04 Confidence-gated routing | the answer says what, confidence says whether | bash tool gate · account actions · citation check |
| 05 Intent & model routing | Jev in front of expensive things | agent router · intent router · model router |
| 06 Guardrail hooks | Jev in the tool_call and tool_result hooks | bash gate · write gate · result screen |
| 07 Should I compact | four questions after every turn, four tiers back | turn end hook · on demand tool · pick the cut point |
| 08 Cheap reads | a judgment about a file, never the file | ask_jev_file_bool · ask_jev_file_choice · ask_jev_file_score |
| 09 Files at scale | many files, one call each, in parallel | several paths · a glob · recursive then pick first |
| 10 Agentic Jev | ask_jev on anything the agent holds | triage a failure · judge a diff · classify a request |

## Mock vs live

With no backend selected, every call runs against `src/core/mock.ts` — a deterministic, offline
stand-in that mimics the exact wire contract (typed answers, distributions that sum to 1, legends,
confidence). It stands in for **shape**, not intelligence: it decides by token overlap, so rubric
wording matters more than it would live. `npm test` always runs the mock.

Live runs go through **OpenRouter's decision endpoint** — no TypeSafe key needed (the transport
pattern verified in the [jev-use-cases lab](https://openrouter.ai/~typesafe/jev-latest)):

```sh
export OPENROUTER_API_KEY=...   # PowerShell: $env:OPENROUTER_API_KEY="..."; or put it in the root .env
npm run demo:live   # every level against real Jev: POST openrouter.ai/api/alpha/decisions, ~typesafe/jev-latest
npm run test:live   # 10 live tests, one per level
```

Live responses pass a strict contract check before they reach your code (distributions cover every
declared option and sum to ~1, choices are declared options). With `TYPESAFE_API_KEY` set, the
client calls TypeSafe directly instead, and that key takes precedence; `JEV_BACKEND=typesafe` or
`openrouter` picks one explicitly. The live tests run on whichever key is set.

## Where things live

```
src/core/     re-exports the core from @bobobowis/jev-kit (packages/jev-kit/src/core)
src/levels/   level01/ .. level10/ — one file per option (A, B, C), questions and thresholds in that file;
              levels 6 to 10 re-export their decision code from the package's guards, compact, and files
src/demo.ts   runs all 10 levels
extensions/   the pi extensions for levels 6 to 10, thin adapters over the package's tools and hooks
server/       the API, the scenarios, agent-session.mjs, and drivers/ for pi, Claude Code, and Codex
tests/        core.test.ts, one test file per level, and the server, drivers, and docs tests
```

## Use the Jev tools in any MCP client

The Level 7 to 10 tools are also an MCP server, `jev mcp` from `@bobobowis/jev-kit`, so any agent
that speaks MCP can use them. From this directory, after `npm install` at the repo root:

```bash
npm run mcp -- --level 8 --cwd sandbox          # ask_jev_file_bool, _choice, _score over stdio
npm run mcp -- --tools ask_jev,ask_jev_files    # or name the tools
```

Paths resolve against `--cwd`, or the directory the client starts the server in, and may not leave
it. The server reads `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` from its environment.

**Claude Code.** Add it to a project's `.mcp.json`, or let `jev setup --harness claude --tools ...` do it:

```json
{ "mcpServers": { "jev": { "command": "node", "args": ["<repo>/packages/jev-kit/dist/cli/index.js", "mcp", "--level", "8"] } } }
```

Or once, from the project: `claude mcp add jev -- node <repo>/packages/jev-kit/dist/cli/index.js mcp --level 8`.
The tools show up as `mcp__jev__ask_jev_file_bool` and so on.

**Codex.** In `~/.codex/config.toml`, or a trusted project's `.codex/config.toml`:

```toml
[mcp_servers.jev]
command = "node"
args = ["<repo>/packages/jev-kit/dist/cli/index.js", "mcp", "--level", "8"]
default_tools_approval_mode = "approve"   # without it, calls fail under approval_policy = "never"
env_vars = ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY"]   # Codex starts MCP servers without your environment
```

## Which harness runs what

The lab marks each option with its support in the harness you pick, and won't start an unavailable one.

<!-- jev:matrix (generated by `npm run docs` from packages/jev-kit/src/capabilities.ts) -->

| Level | pi | Claude Code | Codex | Generic MCP |
|---|---|---|---|---|
| 6 A Bash gate | full | full | full | unavailable (an MCP client has no hooks) |
| 6 B Write gate | full | full | full (apply_patch is read from the patch text) | unavailable (an MCP client has no hooks) |
| 6 C Result screen | full | degraded (the banner is added as context, not above the output) | degraded (the banner is added as context, not above the output) | unavailable (an MCP client has no hooks) |
| 7 A Turn end hook | full | degraded (advisory after each turn, delivered on the next prompt; no compact_now) | degraded (advisory after each turn, delivered on the next prompt; no compact_now) | unavailable (an MCP client has no turn end hook) |
| 7 B On demand tool | full | degraded (no compact_now; the agent asks you to run /compact) | degraded (no compact_now; Codex can't compact from a tool) | degraded (no compact_now) |
| 7 C Pick the cut point | full | unavailable (Claude Code doesn't let a hook choose where to cut) | unavailable (Codex doesn't let a hook choose where to cut) | unavailable (an MCP client has no compaction hook) |
| 8 A ask_jev_file_bool | full | full | full (the built-in shell can't be removed) | full |
| 8 B ask_jev_file_choice | full | full | full (the built-in shell can't be removed) | full |
| 8 C ask_jev_file_score | full | full | full (the built-in shell can't be removed) | full |
| 9 A Several paths, one block | full | full | full (the built-in shell can't be removed) | full |
| 9 B A glob over a directory | full | full | full (the built-in shell can't be removed) | full |
| 9 C Recursive, then pick first | full | full | full (the built-in shell can't be removed) | full |
| 10 A Triage a failure | full | full | full (the built-in shell can't be removed) | full |
| 10 B Judge a diff before shipping | full | full | full (the built-in shell can't be removed) | full |
| 10 C Classify a request, gate a plan | full | full | full (the built-in shell can't be removed) | full |

<!-- /jev:matrix -->

## The rules this codebase follows (from the TypeSafe docs and field reports)

1. **One snap judgment per question.** "Does this convey urgency?" — not "analyze and decide the best action."
2. **Fan out.** Ask every question you might need in one request, including speculative ones; code decides which answers to use.
3. **Numbers, dates, and counting stay in code.** Jev picks a card from the deck; it doesn't name one. Filter candidates first, let Jev choose.
4. **Confidence is a second axis.** Floor (route to human), bar (auto-execute destructive), and the middle confirms.
5. **Give the model an exit.** An `other` / `none_of_the_above` option whenever the list might not cover every input.
6. **Describe situations, not degrees.** "Blocking issue; no workaround exists" — not "moderately severe."
7. **Questions and thresholds in one reviewable file per level.** The part a human audits.
8. **Isolate the state.** If you're classifying a passage, don't send the whole document — context rot is real.
9. **Second requests only for real dependencies.** If the next question's options depend on the first answer, that's a second request; otherwise fan out.
10. **The 255-option Choice cap is a feature.** Dynamic blocks prune in code before they build — `buildChoiceBlock` enforces it.

## Levels 6 to 10 in one paragraph

Levels 1 to 5 call Jev from code. Levels 6 to 10 put Jev inside a coding agent, and each step gives
the agent more say over the questions. Level 6 is two hooks the agent never sees: `tool_call` blocks
irreversible commands and credential writes, `tool_result` flags injected instructions. Level 7 is
the `turn_end` hook asking four questions after every turn, with the numbers in code and the agent
hearing nothing, a notice, a recommendation, or a request. Level 8 is three flat tools, one file
each, where code reads the file and the agent gets a typed answer, never the content. Level 9 is
one tool over globs, one call per file in parallel, capped at 255 in code. Level 10 is `ask_jev`
on anything the agent holds, with a description that carries the schema and prompts that say what
to ask. The names are pi's (`tool_call`, `tool_result`, `turn_end`); under Claude Code and Codex the
same decisions run on `PreToolUse`, `PostToolUse`, `UserPromptSubmit`, and `Stop`. The pi extensions
live in `extensions/`, the drivers for every agent in `server/drivers/`, the decision code in
`@bobobowis/jev-kit` (re-exported from `src/levels/`), and the sandbox they work in in `sandbox/`.
