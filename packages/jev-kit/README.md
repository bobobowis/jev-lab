# @bobobowis/jev-kit

Jev, TypeSafe AI's System One decision model, as a typed client, guards, file reads, agent tools,
hooks, an MCP server, and a CLI. Zero runtime dependencies. Node 22.18 or later.

Jev answers typed questions about a state (yes or no, pick one of your options, a position on your
scale) in about 300 ms for a fraction of a cent. This package is the reusable part of
[10 Levels of Jev](https://github.com/bobobowis/ten-levels-of-jev): the client and the decisions the lab teaches, packaged so a
project or a coding agent can use them directly.

## Install

```bash
npm install @bobobowis/jev-kit        # or: pnpm add @bobobowis/jev-kit
npx jev --help
```

Or run the command without installing anything:

```bash
npx @bobobowis/jev-kit gate "Is this ticket about billing?" --state "I was charged twice this month"
npx @bobobowis/jev-kit setup --harness claude --guards bash,write --tools ask_jev
```

Run through `npx` or `pnpm dlx`, `jev setup` writes `npx -y @bobobowis/jev-kit@<version>` into the
hooks and the MCP entry, not a path into the npx cache, so the config keeps working after the cache is cleared.
Installed in the project, it writes node and the installed bin.

## Keys

Everything reads `TYPESAFE_API_KEY`, or else `OPENROUTER_API_KEY`, from the environment. Without one,
calls fail with an error; nothing quietly falls back to the mock. `--mock` (CLI) or
`new JevClient({ provider: "mock" })` selects the offline mock explicitly. The mock is a
deterministic stand-in for tests and wiring, not a model: its answers are not judgments.

## The library

```ts
import { JevClient, noul, choice, score } from "@bobobowis/jev-kit";

const jev = new JevClient();              // TypeSafe or OpenRouter from the environment; { provider: "mock" } offline
const { answers } = await jev.systemOne(
  { ticket: "The export button has done nothing since Tuesday's release." },
  {
    bug: noul("Does the ticket report something broken?"),
    area: choice("Which area is it about?", { billing: "Payments and invoices", export: "Exporting data", other: "None of these" }),
    urgency: score("How urgent is it?", ["Whenever", "This week", "Today, people are blocked"]),
  },
);
console.log(answers.bug, answers.area, answers.urgency);
```

Each entry point is one layer of the lab. The functions that call Jev take an optional `decide`
function last, so tests and other clients plug in without a key.

| Import | What it has |
|---|---|
| `@bobobowis/jev-kit` | `JevClient`, `jev` (a shared client), the `noul`, `choice`, and `score` builders, `MockJev`, the wire types, `validateRequest`, `LIMITS` |
| `/policy` | `normalized`, `weighted` (scores to numbers), `CONFIDENCE`, `confidenceBand` (floor, middle, bar) |
| `/guards` | `gateBashCommand(command, cwd)`, `gateWriteCall(path, content, repo)`, `screenToolResult(tool, content)`: the Level 6 gates, with their questions and thresholds |
| `/compact` | `evaluateCompaction`, `decideTier`, `tierMessage`, `compactVerdict`, `cutPointQuestion`: the Level 7 advisor |
| `/files` | `readFileState` (a file as state, never outside `cwd`), `askFileBool`, `askFileChoice`, `askFileScore`, `askFiles` (one call per file, in parallel), `pickFirstFile`, `askJev`, `assembleState` |
| `/tools` | the agent tools as harness-neutral `JevTool` objects (`ALL_TOOLS`, `LEVEL_TOOLS`, `selectTools`), `ASK_JEV_DESCRIPTION`, `runCommand`, `gatedRunner` |
| `/hooks` | `handleHook` (normalized events), `runHarnessHook` (a Claude Code or Codex payload in, the harness's answer out), transcript usage readers |
| `/setup` | `plan` and `apply`, behind `jev setup` |
| `/events` | `createReporter`, `createDecider`, `parseEventLine`: the event channel below |
| `/ledger` | `emptyLedger`, `record`, `summarize`: Jev spend per session |
| `/capabilities` | `CAPABILITIES`, `capability(level, option, harness)`: the support table below |

```ts
import { gateBashCommand } from "@bobobowis/jev-kit/guards";
import { askFileBool } from "@bobobowis/jev-kit/files";

const verdict = await gateBashCommand("git push --force origin main", process.cwd());
if (verdict.block) console.error(verdict.reason);

const r = await askFileBool("src/billing.ts", "Does this file round money anywhere?", process.cwd());
console.log(r.answer, r.noul);   // your script, or the agent, never loads the file
```

## Recipes: the lab's levels 1 to 5

The package doesn't export the use cases from levels 1 to 5: they are examples with the lab's own
categories built in, so copy the one you need. Each one is a single short file that uses only what
the package exports. Copy it into your project, point its imports at the package, and change the
options and criteria to your own:

```ts
// In the lab
import { jev } from "../../core/client.ts";
import { noul } from "../../core/helpers.ts";
import type { NoulAnswer } from "../../core/types.ts";
import { CONFIDENCE } from "./confidence.ts";          // or { normalized } from "./normalize.ts"

// In your project
import { jev, noul, type NoulAnswer } from "@bobobowis/jev-kit";
import { CONFIDENCE, normalized } from "@bobobowis/jev-kit/policy";
```

| Level | Recipe | Use it for |
|---|---|---|
| 1 Single decisions | [`injectionGate`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level01/injection-gate.ts) | A prompt injection gate in front of anything that sends user text to an LLM |
| | [`urgentGate`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level01/urgency-gate.ts) | Pinging a human only when a message is urgent, with your threshold |
| | [`classifyTicket`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level01/ticket-classifier.ts) | Routing a ticket to one department, with its confidence |
| 2 Multiple choice | [`triageTicket`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level02/support-triage.ts) | Route, priority, and a human handoff for a support ticket in one call |
| | [`screenResume`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level02/resume-screening.ts) | Seniority and fit of a resume against a job description |
| | [`qualifySponsorForm`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level02/sponsor-qualification.ts) | Qualifying inbound forms or leads by intent and product |
| 3 Composite scoring | [`ticketPriority`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level03/ticket-priority.ts) | A weighted priority from several scores |
| | [`codeReviewRisk`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level03/code-review-risk.ts) | The risk of a diff in CI, before a human reviews it |
| | [`ideaVerdict`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level03/idea-verdict.ts) | Kill, fix, or ship on a pitch or proposal |
| 4 Confidence gating | [`gateShellCommand`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level04/shell-command-gate.ts) | Allowing a shell command, or asking a human when Jev is unsure |
| | [`routeAccountAction`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level04/account-actions.ts) | Running an account action on its own, asking for a confirmation before a transfer, and handing off to a human when unsure |
| | [`checkCitation`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level04/citation-check.ts) | Checking that a quote supports a claim, for RAG answers |
| 5 Routing | [`routeIntent`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level05/intent-router.ts) | Sending a message to the right handler, and to reasoning only when it needs it |
| | [`routeModel`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level05/model-router.ts) | The cheapest model and the effort a task needs |
| | [`routeAgent`](https://github.com/bobobowis/ten-levels-of-jev/blob/main/apps/ten-levels/src/levels/level05/agent-router.ts) | Picking which coding agent takes a task |

Levels 6 to 10 need no copying: they ship as `/guards`, `/compact`, `/files`, and `/tools`, and
behind `jev guard`, `jev setup`, and `jev mcp`.

## The jev command

Results go to stdout as JSON, diagnostics to stderr, so stdout pipes straight into `jq`. Every
command takes `--help`, and the ones that call Jev take `--mock`.

**`jev ask`**: one question block about your own state, files code reads for you, and a command's
output.

```bash
jev ask --questions '{"risky":{"type":"score","instructions":"How risky is the change in output?","criteria":["Docs only","Some callers","Auth or billing, no tests"]}}' \
        --command "git diff HEAD~1" | jq .answers.risky.score
jev ask --questions @questions.json --state "customer says export fails" --paths "src/**/*.ts"
```

**`jev files`**: the same block once per file, in parallel.

```bash
jev files "src/**/*.ts" --questions '{"todo":{"type":"noul","instructions":"Does this file leave work unfinished?"}}' | jq '.results[] | {path, answers}'
```

**`jev gate`**: the smart if. The exit code is the answer.

```bash
jev gate "Is this ticket about billing?" --state "I was charged twice this month" && echo billing
```

**`jev guard`**: the Level 6 gates on a command or a file write.

```bash
jev guard bash "git push --force origin main"           # block: ... exit 1
echo 'API_KEY=sk-live-4f9a...' | jev guard write .env    # block: ... exit 1
```

**`jev setup`**, **`jev hook`**, and **`jev mcp`** are below.

| Command | Exit codes |
|---|---|
| `ask`, `files` | 0 answered, 1 refused or failed (the reason is on stderr), 2 bad options |
| `gate` | 0 yes (at or above `--threshold`, default 0.5), 1 no, 2 bad options or a state that cannot be sent, 3 Jev could not answer |
| `guard` | 0 allow, 1 block, 2 bad options, 3 Jev could not answer |
| `setup` | 0 written (or printed with `--dry-run`), 1 a config it can't safely merge, 2 bad options |
| `hook` | 0 always, 1 bad options; never 2, which both harnesses read as "block" |

`gate` and `guard` exit 3 instead of guessing when Jev cannot answer, so the script decides whether
that fails open or closed. A pre-commit hook that blocks commits adding a live credential, and lets
commits through when Jev is unreachable:

```sh
#!/bin/sh
# .git/hooks/pre-commit
jev gate "Does output add a real credential (an API key, token, password, or private key with a real-looking value), not a placeholder?" \
  --command "git diff --cached" --threshold 0.7
case $? in
  0) echo "pre-commit: this commit seems to add a credential; remove it or commit with --no-verify." >&2; exit 1 ;;
  3) echo "pre-commit: Jev unavailable, not checked." >&2 ;;
esac
exit 0
```

## jev setup

Writes or merges the MCP entry and the hooks into a project's agent config, and leaves everything
else alone:

```bash
jev setup --harness claude --guards bash,write,result --tools ask_jev    # .claude/settings.json, .mcp.json
jev setup --harness codex  --guards bash,write --compact                  # a marked block in .codex/config.toml
jev setup --harness claude --level 6 --dry-run                            # print, write nothing
```

Each run sets the whole selection and replaces only what an earlier run wrote. A settings file that
is not valid JSON is refused, never overwritten. Codex asks you to trust the project and its hooks
the first time.

## Use the Jev tools in any MCP client

`jev mcp` serves the agent tools over stdio MCP:

| Tool | What it answers |
|---|---|
| `should_i_compact` | whether now is a good moment to compact (needs the Level 7 hooks' notes) |
| `ask_jev_file_bool`, `_choice`, `_score` | a yes or no, a pick, or a score about one file the agent never loads |
| `ask_jev_files`, `pick_first_file` | the same questions over many files in parallel, then which to open first |
| `ask_jev` | any question block over the agent's own state, file paths, and a command's output |

```bash
jev mcp --level 8                    # the lab's levels 7 to 10
jev mcp --tools ask_jev,ask_jev_files
```

Claude Code, in `.mcp.json`:

```json
{ "mcpServers": { "jev": { "command": "jev", "args": ["mcp", "--tools", "ask_jev"] } } }
```

Codex, in `~/.codex/config.toml` or a trusted project's `.codex/config.toml`:

```toml
[mcp_servers.jev]
command = "jev"
args = ["mcp", "--tools", "ask_jev"]
default_tools_approval_mode = "approve"
env_vars = ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY"]   # Codex starts MCP servers without your environment
```

Or let `jev setup` write either one.

## Hooks: guards and the compaction advisor

`jev hook` runs as a Claude Code or Codex hook. It reads the hook payload on stdin and answers in the
harness's own format.

- **Guards.** `PreToolUse` runs the bash gate on shell commands and the write gate on file writes
  (`Write`, `Edit`, `MultiEdit`, `NotebookEdit`, Codex's `apply_patch`). A block denies the call.
  `PostToolUse` screens `Read` and `Bash` output for instructions aimed at the agent and attaches a
  banner.
- **Compaction advisor.** `UserPromptSubmit` and `Stop` ask four questions after each turn and, when
  the work has moved on and context is high, tell the agent on the next prompt to ask you to run
  `/compact`.

```bash
echo '{"hook_event_name":"PreToolUse","tool_name":"Bash","tool_input":{"command":"git push --force origin main"},"cwd":"."}' \
  | jev hook --harness claude --event PreToolUse --guards bash
```

Hooks fail open: a missing key, a Jev error, or a timeout (8 s by default) allows the action and
reports an error. They never exit 2. The contracts they rely on are in
[docs/NOTES-claude.md](docs/NOTES-claude.md) and [docs/NOTES-codex.md](docs/NOTES-codex.md).

## Support by harness

The same table is exported as `CAPABILITIES` from `@bobobowis/jev-kit/capabilities`.

<!-- jev:matrix (generated by `pnpm run docs` from packages/jev-kit/src/capabilities.ts) -->

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

## Events

Every Jev call and hook decision is reported as one JSON line: to `$JEV_EVENT_DIR/<harness>-<pid>.jsonl`
when that is set, otherwise to stderr prefixed `JEV_EVENT `. The lab uses this to show hooks and
tool calls live. `ask`, `files`, `gate`, and `guard` keep stderr quiet unless `JEV_EVENT_DIR` is set.
