# Spec Delta

## Purpose

Runs the Level 6 guardrails and the Level 7 compaction advisor as hooks in whichever coding agent the user picks, with one decision logic and a documented, honest account of what each harness can and cannot do.

## ADDED Requirements

### Requirement: Shared hook decisions across harnesses
The bash gate, write gate, result screen, and should-compact decision SHALL use the same questions and thresholds under every harness. Harness adapters SHALL only translate events in and decisions out.

#### Scenario: Same verdict under pi and Claude Code
- **WHEN** the same `git push --force origin main` command is gated under pi and under Claude Code with the mock backend
- **THEN** both block it with the same reason

### Requirement: Hooks run as one command
The guards and the compaction advisor SHALL run as `jev hook`, told the harness and the hook event, reading the harness's hook payload on stdin and answering in that harness's hook response format, so any project can enable them by adding hook entries to its agent config, with or without the lab.

#### Scenario: Claude Code project outside the lab
- **WHEN** a project's `.claude/settings.json` has a `PreToolUse` hook with matcher `Bash` that runs `jev hook --harness claude --event PreToolUse`
- **THEN** a plain `claude` session in that project gets force pushes denied with the bash gate's reason

### Requirement: Bash gate blocks before execution
Under pi and Claude Code, a shell command the bash gate blocks SHALL NOT execute, and the agent SHALL receive the block reason and the standard block notice. Under Codex, the same SHALL hold wherever Codex offers a pre-execution hook.

#### Scenario: Claude Code Bash tool
- **WHEN** a Claude Code session with the Level 6 hook calls Bash with `rm -rf node_modules .sessions`
- **THEN** the command does not run and Claude receives a denial whose reason starts with `jev-guard blocked this command`

#### Scenario: Harmless command passes
- **WHEN** the agent runs `ls src`
- **THEN** the hook allows it without adding any message

### Requirement: Write gate covers every file-writing tool
The write gate SHALL check every tool that creates or modifies files in the harness (pi `write`/`edit`; Claude Code `Write`, `Edit`, `MultiEdit`, `NotebookEdit`; Codex `apply_patch` where hookable), blocking paths outside the repo and writes of credentials.

#### Scenario: Write outside the repo
- **WHEN** the agent calls Write with a `file_path` outside the sandbox
- **THEN** the write is denied with a reason naming the path

#### Scenario: Credential in content
- **WHEN** the agent edits `config/.env.example` to contain a live-looking API key
- **THEN** the edit is denied with a reason saying it contains a credential

### Requirement: Result screen warns about injected instructions
After a read or shell tool returns, the result screen SHALL flag output that carries instructions to the agent. Where the harness can rewrite the result the banner SHALL be prepended; otherwise it SHALL be added as context the agent sees with that result.

#### Scenario: Claude Code cannot rewrite a built-in result
- **WHEN** Claude Code reads `docs/vendor-notes.md` and the screen flags it
- **THEN** the banner reaches Claude as additional context attached to that tool result

### Requirement: Hooks fail open and report errors
If a hook cannot reach Jev or errors, it SHALL allow the action, report the error on the event channel, and never hang the agent beyond a bounded timeout.

#### Scenario: Jev unreachable
- **WHEN** the Jev call in the bash gate fails
- **THEN** the command proceeds and an `error` event naming the hook is reported

### Requirement: Compaction advice where compaction is not programmable
On harnesses that cannot compact from a tool, Level 7 SHALL run the four questions after each turn, decide the tier with numbers in code, and deliver non-silent tiers as context on the agent's next turn. It SHALL NOT offer `compact_now`; a `request` tier SHALL tell the agent to ask the user to compact.

#### Scenario: Claude Code request tier
- **WHEN** a Claude Code Level 7 session switches tasks with context above the request line
- **THEN** the next turn carries a message telling the agent to ask the user to run `/compact` with a note, and `compact_now` is not among the tools

#### Scenario: First request is silent
- **WHEN** the session has only one user request so far
- **THEN** no Jev call is made and nothing is injected

### Requirement: Context usage from the harness's own record
The compaction advisor SHALL compute context usage from what the harness reports (pi context usage, or token usage in the Claude Code or Codex transcript). When usage is unknown it SHALL say so in the event and decide on the judgment answers alone.

#### Scenario: Claude Code usage from the transcript
- **WHEN** the Stop hook runs with a `transcript_path`
- **THEN** usage is the input plus cache tokens of the last assistant message in that transcript

### Requirement: Capability matrix is published
The project SHALL document, per level and per harness (pi, Claude Code, Codex, generic MCP), whether each option is full, degraded (with what is lost), or unavailable, and the lab SHALL show the degraded note on the level page for the selected harness.

#### Scenario: Codex on Level 7
- **WHEN** a user opens Level 7 with Codex selected
- **THEN** the page states which Level 7 options work and which are unavailable under Codex
