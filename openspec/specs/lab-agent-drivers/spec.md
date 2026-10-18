# lab-agent-drivers Specification

## Purpose

Lets the lab's agent window for Levels 6 to 10 run a real session in the user's chosen coding agent (pi, Claude Code, or Codex), with the same controls and the same rendered stream whichever harness runs underneath.

## Requirements

### Requirement: Harness is selectable
The lab SHALL choose the harness for agent sessions from `JEV_AGENT` (`pi`, `claude`, `codex`), overridable per session in the start request. Unset, it SHALL pick the first harness found on `PATH` in the order pi, claude, codex, and SHALL report which one it chose.

#### Scenario: Explicit choice
- **WHEN** `JEV_AGENT=claude` and a Level 8 session starts
- **THEN** the session runs Claude Code and the start response names `claude` as the harness

#### Scenario: No harness installed
- **WHEN** none of the CLIs is on `PATH`
- **THEN** starting a session fails with an error naming the three supported agents and how to install each, and Levels 1 to 5 keep working

### Requirement: Same session controls on every harness
For every harness, the lab SHALL support start, prompt, abort, follow-up prompts in the same conversation, and close, with the existing HTTP routes and responses unchanged.

#### Scenario: Follow-up prompt keeps context
- **WHEN** the user sends the option's `then` prompt after the first answer under Codex
- **THEN** the agent answers in the same conversation, aware of the first exchange

#### Scenario: Abort while running
- **WHEN** the user presses Stop during a Claude Code turn
- **THEN** the turn stops, an `abort` event is shown, and the next prompt is accepted

#### Scenario: Prompt while running
- **WHEN** a prompt arrives while the agent is still running
- **THEN** it is rejected with the existing "Stop it first" error, on every harness

### Requirement: Normalized event vocabulary
Each driver SHALL translate its harness's output into one vocabulary the web chat renders: `session`, `state`, `prompt`, `agent_start`, `agent_settled`, `message_end`, `tool_execution_start`, `tool_execution_end`, `compaction_end`, `stats`, `jev`, `hook`, `error`, `abort`, `closed`. Tool names SHALL be shown as the harness names them.

#### Scenario: Claude tool call renders
- **WHEN** Claude Code calls `mcp__jev__ask_jev_file_bool`
- **THEN** the window shows a tool start and end row for it, followed by the Jev row reported by the tool

### Requirement: Stats include cost and context where known
The `stats` event SHALL carry the agent's LLM cost and context usage (tokens, window, percent) when the harness provides them, and SHALL leave unknown fields empty instead of showing zero.

#### Scenario: Codex without cost
- **WHEN** Codex reports token usage but no cost
- **THEN** the footer shows the tokens and leaves the LLM cost blank

### Requirement: Each session is isolated
Each session SHALL run in its own git-initialized copy of the sandbox, with the level's tool server, hooks, and agent instructions configured only for that copy, without reading the user's own agent config, plugins, skills, or MCP servers, and SHALL remove the copy on close.

#### Scenario: User's global MCP servers not loaded
- **WHEN** a Claude Code session starts on a machine with user-level MCP servers configured
- **THEN** only the lab's Jev server is available in the session

#### Scenario: Agent edit does not leak
- **WHEN** an agent fixes the billing bug in one session
- **THEN** a new session starts from the pristine sandbox with the failing test

### Requirement: Explicit tool allowlist per harness
Each option SHALL declare the tools the agent may use, mapped to each harness's tool names, and the session SHALL expose only those tools.

#### Scenario: Level 8 on Claude Code
- **WHEN** Level 8 option A starts under Claude Code
- **THEN** the agent can use Read, Bash, and the three `ask_jev_file_*` tools, and nothing else

### Requirement: Minimal environment for the agent
The agent process SHALL receive only the shell basics, the Jev keys, the chosen harness's own credentials, `JEV_*` settings, and names listed in `JEV_AGENT_ENV`.

#### Scenario: Unrelated secret not passed
- **WHEN** `AWS_SECRET_ACCESS_KEY` is set in the lab's environment
- **THEN** the agent's bash tool cannot print it

### Requirement: Agent model per harness
The agent model SHALL default per harness and be overridable per harness with `JEV_AGENT_MODEL_PI`, `JEV_AGENT_MODEL_CLAUDE`, or `JEV_AGENT_MODEL_CODEX`, then for every harness with `JEV_AGENT_MODEL`; the chosen model SHALL be shown in the window.

#### Scenario: Override under Claude Code
- **WHEN** `JEV_AGENT_MODEL=claude-haiku-5-5` and the harness is Claude Code
- **THEN** the session uses that model and the window shows it

#### Scenario: A pi model does not reach Codex
- **WHEN** `JEV_AGENT_MODEL_PI=openai/gpt-6.1-sol` is set and the harness is Codex
- **THEN** the Codex session uses its own default model
