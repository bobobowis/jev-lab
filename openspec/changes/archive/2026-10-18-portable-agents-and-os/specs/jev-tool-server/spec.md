# Spec Delta

## Purpose

Exposes the Jev tools of the agentic levels (7 to 10) to any coding agent through one harness-neutral definition and a standard MCP server, so the same tool behaves the same way under pi, Claude Code, Codex, or any MCP client.

## ADDED Requirements

### Requirement: One definition per tool across harnesses
Each Jev tool SHALL have a single definition (name, description, JSON Schema parameters, and behavior) that every harness adapter uses. The name, description, parameters, and result payload SHALL be identical whichever harness exposes the tool.

#### Scenario: Same tool under pi and MCP
- **WHEN** `ask_jev_file_bool` is listed by the pi extension and by the MCP server
- **THEN** both report the same name, the same description, and an equivalent parameter schema

#### Scenario: Same payload under pi and MCP
- **WHEN** the same `ask_jev_file_choice` call is made through pi and through MCP on the same sandbox with the mock backend
- **THEN** both return the same JSON payload

### Requirement: MCP server over stdio
The package SHALL provide an MCP server, started with `jev mcp` and communicating over stdio, that implements `initialize`, `tools/list`, and `tools/call` per the MCP specification and adds no runtime dependency.

#### Scenario: Client handshake
- **WHEN** an MCP client sends `initialize` followed by `tools/list`
- **THEN** the server returns its capabilities and the tool list for the selected level

#### Scenario: Unknown tool
- **WHEN** a client calls a tool name the server does not expose
- **THEN** the server returns a JSON-RPC error and keeps running

### Requirement: Tool set selected per level
The MCP server SHALL expose only the tools of the level it is started for: Level 7 `should_i_compact`; Level 8 `ask_jev_file_bool`, `ask_jev_file_choice`, `ask_jev_file_score`; Level 9 `ask_jev_files`, `pick_first_file`; Level 10 `ask_jev`. It SHALL also accept an explicit list of tool names instead of a level. Started with neither, it SHALL expose all of them.

#### Scenario: Level 8 only
- **WHEN** the server is started for Level 8
- **THEN** `tools/list` returns exactly the three `ask_jev_file_*` tools

#### Scenario: Tools by name
- **WHEN** the server is started with the tools `ask_jev` and `ask_jev_files`
- **THEN** `tools/list` returns exactly those two tools

### Requirement: Tools resolve paths against the agent's working directory
Tools that take paths SHALL resolve them against the directory the agent works in, SHALL refuse paths outside it, and SHALL report paths in results with forward slashes on every OS.

#### Scenario: Path outside the repo
- **WHEN** `ask_jev_file_bool` is called with `../secret.txt`
- **THEN** the tool returns an error result naming the path as outside the repo, and no Jev call is made

#### Scenario: Windows paths in results
- **WHEN** `ask_jev_files` runs on Windows over `src/**/*.ts`
- **THEN** every `path` in the result uses `/` as the separator

### Requirement: Tool failures are tool results, not crashes
A failing tool call (bad input, file problem, budget exceeded, Jev error) SHALL return an error result with a readable message to the agent and SHALL NOT terminate the server.

#### Scenario: Invalid question block
- **WHEN** `ask_jev` is called with `questions_json` that is not valid JSON
- **THEN** the call returns an error result explaining the problem and the next call succeeds normally

### Requirement: ask_jev commands pass the bash gate
A `command` given to `ask_jev` SHALL be checked by the Level 6 bash gate before it runs, under every harness, and a blocked command SHALL NOT run.

#### Scenario: Destructive command through ask_jev
- **WHEN** `ask_jev` is called with `command: "rm -rf src"`
- **THEN** the command does not run and the result says the bash gate refused it

### Requirement: Usage guidance travels with the server
The server SHALL publish the Level 10 usage nudge (prefer `ask_jev` for classifications, risk scores, and yes or no with confidence) as MCP server instructions, so harnesses that surface instructions show it without a system prompt hook.

#### Scenario: Instructions in initialize
- **WHEN** a client initializes the Level 10 server
- **THEN** the `initialize` result includes the usage guidance text
