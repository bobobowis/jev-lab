# jev-event-channel Specification

## Purpose

Lets every Jev call and hook decision made by a tool or hook, in whatever process the harness runs it, reach the lab's agent window live and stay on record after the session.

## Requirements

### Requirement: Events are written to a session event directory when one is named
When `JEV_EVENT_DIR` names a directory, every reporting process (pi extension, MCP server, hook runner, CLI run) SHALL append its events to its own JSON Lines file in that directory, one object per line with `kind` and `at` fields, so no two processes write to the same file.

#### Scenario: Two processes report at once
- **WHEN** an MCP tool call and a hook both report large events during the same turn
- **THEN** the directory holds both as separate, complete, parseable lines

### Requirement: Stderr fallback
When `JEV_EVENT_DIR` is not set, reporters SHALL write each event to stderr as a `JEV_EVENT ` prefixed JSON line, as today. The general CLI subcommands (`ask`, `files`, `gate`, `guard`) are the exception: they report only to an event directory, so their stderr stays readable.

#### Scenario: Plain pi run
- **WHEN** a pi extension runs without `JEV_EVENT_DIR`
- **THEN** events appear on stderr with the `JEV_EVENT ` prefix

#### Scenario: CLI without an event directory
- **WHEN** `jev gate` runs without `JEV_EVENT_DIR`
- **THEN** no `JEV_EVENT` line is written to stderr

### Requirement: Stable event kinds and payloads
Events SHALL keep the existing kinds (`jev`, `hook`, `error`, `ledger`, `compact`, `compact-done`) and payload fields, adding a `harness` field naming the harness that produced them.

#### Scenario: Jev call event
- **WHEN** a tool calls Jev
- **THEN** the event has `kind: "jev"`, `source`, `state`, `questions`, `answers`, `usage`, `model`, `ms`, and `harness`

### Requirement: Lab follows the log live
The lab SHALL read new lines from every file in a session's event directory as they are written and deliver them on that session's event stream, in write order per file, ignoring a partial last line until it is complete.

#### Scenario: Hook event shows up live
- **WHEN** a Claude Code hook appends a `hook` event while the agent is running
- **THEN** the agent window shows the row before the turn ends

### Requirement: Reporting never breaks the agent
A failure to write an event SHALL NOT fail the tool call or hook that produced it.

#### Scenario: Unwritable log
- **WHEN** the event directory is not writable
- **THEN** the tool still returns its result and the event goes to stderr instead
