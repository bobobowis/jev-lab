# Claude Code: the contract `jev hook` and the lab's claude driver rely on

Captured on 2026-10-17 with **Claude Code 2.1.302** (`claude-haiku-5-5`), the minimum version the driver checks for. Two throwaway sessions over stream-json, with a logging hook on every event and a one-tool fixture MCP server. The captures are in `tests/fixtures/claude/hooks.jsonl` (hook stdin) and `apps/ten-levels/tests/fixtures/claude/*.jsonl` (stream-json), with paths replaced by `/work` and `~`.

## Launch

```
claude -p --input-format stream-json --output-format stream-json --verbose \
  --model M --mcp-config mcp.json --strict-mcp-config --settings settings.json \
  --setting-sources "" --permission-mode bypassPermissions [--disable-slash-commands]
```

- One prompt is one stdin line: `{"type":"user","message":{"role":"user","content":[{"type":"text","text":"..."}]}}`. The process stays up between prompts.
- `--disable-slash-commands` also disables `/compact`: the session answered "/compact isn't available in this environment." Leave it off when Level 7 needs the user's `/compact`.
- `--setting-sources ""` keeps settings files out, but not account context: the model still saw the account email, a git status snapshot, and attribution reminders. The lab's isolation covers settings, MCP servers, and plugins, not this.
- **MCP tools are deferred.** The agent called `ToolSearch` with `select:mcp__fixture__echo` before it could call the tool. A `--tools` allowlist must keep `ToolSearch` whenever MCP tools are expected.

## Stream-json messages

| Message | When | Fields used |
|---|---|---|
| `system/init` | before every turn | `session_id`, `model`, `tools`, `mcp_servers[].status`, `claude_code_version` |
| `system/hook_started`, `system/hook_response` | around SessionStart hooks | ignored |
| `system/thinking_tokens`, `rate_limit_event` | during a turn | ignored |
| `assistant` | each model message | `message.content[]`: `text`, `thinking`, `tool_use {id, name, input}` |
| `user` | tool results, interrupt marker | `message.content[]`: `tool_result {tool_use_id, content}`; `text: "[Request interrupted by user]"` |
| `result` | end of every turn | `subtype` (`success`, `error_during_execution`), `is_error`, `usage`, `total_cost_usd`, `modelUsage[model].contextWindow`, `session_id` |
| `system/status` | compaction | `status: "compacting"`, then `status: null, compact_result: "success"` |
| `system/compact_boundary` | after compaction | `compact_metadata {trigger, pre_tokens, post_tokens}` |
| `control_response` | after a control request | `response {subtype, request_id}` |

- **`total_cost_usd` is cumulative for the session** (0.00371 → 0.00391 → 0.00408 over three turns). The driver reports the difference per turn.
- Context in use = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens` of the last assistant message; the window is `modelUsage[model].contextWindow` (1,000,000 for Haiku 5.5).

### Interrupt

Sent while a `Bash` tool_use was pending:

```
>> {"type":"control_request","request_id":"int-1","request":{"subtype":"interrupt"}}
<< {"type":"control_response","response":{"subtype":"success","request_id":"int-1","response":{"still_queued":[]}}}
<< user text "[Request interrupted by user]"
<< result subtype "error_during_execution", is_error true
```

The next prompt was accepted on the same process (`"ready"`). Kill-and-resume stays as the fallback.

### /compact

`/compact keep the file names` as a user line, with slash commands enabled: `system/status compacting` → `PreCompact` hook (`trigger: "manual"`, `custom_instructions: "keep the file names"`) → `SessionStart` hook (`source: "compact"`) → `system/status` with `compact_result: "success"` → `system/compact_boundary` (`pre_tokens 17347`, `post_tokens 2106`) → `result`. A follow-up still knew the file read before compaction. `UserPromptSubmit` does not fire for the slash command.

## Hook payloads (stdin)

Every hook gets `session_id`, `transcript_path`, `cwd`, `hook_event_name`, and, on tool and prompt events, `prompt_id`, `permission_mode`.

| Event | Extra fields |
|---|---|
| `UserPromptSubmit` | `prompt` |
| `PreToolUse` | `tool_name`, `tool_input`, `tool_use_id`; MCP tools add `mcp_server {name, source}` |
| `PostToolUse` | as PreToolUse, plus `tool_response`, `duration_ms` |
| `Stop` | `stop_hook_active`, `last_assistant_message`, `background_tasks` |
| `PreCompact` | `trigger` (`manual`), `custom_instructions` |
| `SessionStart` | `source` (`startup`, `compact`) |

`tool_input` and `tool_response` by tool:

- `Bash`: input `{command, description}`; response `{stdout, stderr, interrupted, isImage, noOutputExpected}`.
- `Read`: input `{file_path}` (absolute); response `{type: "text", file: {filePath, content, ...}}`.
- `Write`: input `{file_path, content}`; response `{type: "create", filePath, ...}`.
- `mcp__<server>__<tool>`: input is the tool's arguments; response is the MCP `content` array.

`Stop` carries `last_assistant_message`, so the Level 7 hook does not need the transcript for the recent turn, only for usage.

## Hook responses (stdout, exit 0)

All three were confirmed in session two:

- Deny: `{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"jev-guard blocked this command: ..."}}`. The command did not run; Claude received the tool result `PreToolUse:Bash hook error: jev-guard blocked this command: ...`.
- After a tool: `{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"..."}}`. Claude quoted it as attached to the Read result.
- On a prompt: `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"..."}}`. Claude quoted it as part of its context for the turn.

No output means allow, with nothing added.
