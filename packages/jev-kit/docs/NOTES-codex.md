# Codex: the contract `jev hook` and the lab's codex driver rely on

Captured on 2026-10-17 with **codex-cli 0.162.1** (model `gpt-6.1-sol`, the account default). One `codex exec --json` run with a hook on every event and a one-tool fixture MCP server, then one `codex exec resume`. The captures are in `tests/fixtures/codex/` (hook stdin, two rollout `token_count` lines with account rate limits removed) and `apps/ten-levels/tests/fixtures/codex/` (exec JSONL), with paths replaced by `/work` and `~`.

## Launch

```
codex exec --json --ignore-user-config --dangerously-bypass-hook-trust --skip-git-repo-check \
  --sandbox workspace-write -c approval_policy='"never"' \
  -c 'mcp_servers.jev.command="node"' -c 'mcp_servers.jev.args=[...]' \
  -c 'mcp_servers.jev.default_tools_approval_mode="approve"' \
  -c 'hooks.PreToolUse=[{matcher="*",hooks=[{type="command",command="...",timeout=10}]}]' \
  -C <dir> "<prompt>" < /dev/null
```

- **Close stdin or pipe the prompt.** With stdin left open and not a TTY, `codex exec` prints "Reading additional input from stdin..." and waits; the first attempt hung until its 300 s timeout.
- **Hooks must come in through `-c hooks.<Event>=[...]`.** A project `.codex/hooks.json` was not loaded, with or without `projects."<dir>".trust_level="trusted"`. The user's `$CODEX_HOME/hooks.json` is the other place Codex reads, and the lab must not write there.
- `--dangerously-bypass-hook-trust` runs the hooks without a stored trust entry and emits two `item.completed` items of type `error` saying so. The driver drops them.
- **MCP servers start without the agent's environment; hooks inherit it.** A `jev mcp` server configured without `env_vars` answered "Jev credentials are missing" (2026-10-17, project `.codex/config.toml`); with `env_vars = ["TYPESAFE_API_KEY", "OPENROUTER_API_KEY", "JEV_EVENT_DIR"]` the same call answered `true, noul 0.97`. A project `.codex/config.toml` is loaded, hooks and MCP servers both, once the project is trusted.
- **MCP tools need `default_tools_approval_mode="approve"`.** Under `approval_policy="never"` without it, the call failed: "MCP tool call requires approval, but approval policy is never".
- `codex exec resume <thread_id> <prompt>` does not accept `--sandbox` or `-C`: pass `-c sandbox_mode="workspace-write"` and spawn it in the session directory. The follow-up knew the earlier turn (it answered `math.ts`).

## Exec JSONL

| Line | Fields used |
|---|---|
| `thread.started` | `thread_id`, the id `resume` takes |
| `turn.started` | |
| `item.started` / `item.completed` | `item.type`: `agent_message {text}`, `command_execution {command, aggregated_output, exit_code, status}`, `mcp_tool_call {server, tool, arguments, result, error, status}`, `file_change {changes[{path, kind}], status}`, `error {message}` |
| `turn.completed` | `usage {input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens}` |

- **No cost is reported**, only tokens; the footer leaves LLM cost blank.
- **`turn.completed` usage is cumulative for the thread** (90,119 input tokens after the first turn, 105,520 after the resumed one). The driver reports differences.
- **A command blocked by a hook produces no item.** It shows up only as a stderr line (`ERROR codex_core::tools::router: error=Command blocked by PreToolUse hook: ...`) and in the agent's own message. The lab sees the block through the hook runner's `hook` event.

Context usage lives in the rollout file named by the hooks' `transcript_path`: the last `event_msg` of type `token_count` has `info.last_token_usage.input_tokens` (15,401 for the resumed turn) and `info.model_context_window` (475,000).

## Hook payloads (stdin)

Codex names and fills its hooks like Claude Code. Every hook gets `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`; turn events add `turn_id`.

| Event | Fired | Extra fields |
|---|---|---|
| `SessionStart` | yes | `source: "startup"` |
| `UserPromptSubmit` | yes | `prompt` |
| `PreToolUse` | yes, shell, MCP, and apply_patch | `tool_name`, `tool_input`, `tool_use_id` |
| `PostToolUse` | yes | as PreToolUse, plus `tool_response` |
| `Stop` | yes | `stop_hook_active`, `last_assistant_message` |
| `SessionEnd` | yes | `reason` |
| `PermissionRequest`, `PreCompact`, `PostCompact` | not in this run (no approvals, no compaction) | |

`tool_name` and `tool_input` by tool:

- Shell: `Bash`, input `{command}` (the plain command, not the `/bin/bash -lc` wrapper shown in exec items); response is the output as a string.
- MCP: `mcp__<server>__<tool>`, input is the arguments; response `{content: [...]}`.
- `apply_patch`: input `{command: "*** Begin Patch\n*** Add File: notes.txt\n+done\n*** End Patch"}`; response is a status string. **apply_patch is hookable**: the write gate reads the file paths from `*** Add File:` / `*** Update File:` / `*** Delete File:` lines and the content from the `+` lines.

## Hook responses (stdout, exit 0)

The same `hookSpecificOutput` shapes as Claude Code, all confirmed:

- Deny: `permissionDecision: "deny"` with `permissionDecisionReason`. The command did not run; the agent quoted "Command blocked by PreToolUse hook: jev-guard blocked this command: FIXTURE-DENY-REASON. Command: echo forbidden".
- `PostToolUse` and `UserPromptSubmit` `additionalContext`: both reached the agent, which quoted `FIXTURE-PROMPT-NOTE-42` and `FIXTURE-BANNER-Bash`.

## What this means for Level 7

Codex fires `Stop` with `last_assistant_message`, and `UserPromptSubmit` can inject. So Level 7 A runs as on Claude Code: advise after the turn, deliver on the next prompt. Codex has no tool that compacts, so it stays advisory. `PreCompact` exists but did not fire in this run.
