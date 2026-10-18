# Spec Delta

## Purpose

Gives scripts, CI jobs, git hooks, and people at a terminal the same Jev decisions the agent tools use: typed answers as JSON, gates as exit codes, and a command that wires the Jev hooks and MCP server into a project's agent config.

## ADDED Requirements

### Requirement: One command with subcommands
The package SHALL provide one `jev` command. Its subcommands SHALL include `ask`, `files`, `gate`, `guard`, `setup`, `hook`, and `mcp`, and `jev --help` and `jev <subcommand> --help` SHALL describe each with its options.

#### Scenario: Help
- **WHEN** a user runs `jev --help`
- **THEN** every subcommand is listed with a one-line description

### Requirement: ask returns typed answers
`jev ask` SHALL take a question block (inline JSON or a file) and a state assembled from any of: inline text or JSON, files or globs, and a command whose output is captured. It SHALL apply the same validation, budget, split suggestion, and bash gate on the command as the `ask_jev` tool, and SHALL print the answers, a state summary, and usage as JSON on stdout.

#### Scenario: Ask about files in CI
- **WHEN** a CI job runs `jev ask --questions review.json --paths "src/**/*.ts"`
- **THEN** stdout is one JSON object with `answers` keyed by the question ids, `state_summary`, and `usage`

#### Scenario: Over budget
- **WHEN** the assembled state exceeds the per-call budget
- **THEN** the command exits non-zero and stderr names the parts and a split into calls that fit

### Requirement: files asks per file in parallel
`jev files` SHALL expand globs and directories with the same pruning rules as `ask_jev_files`, ask the same question block once per surviving file in parallel, and print one result per file plus the list of skipped files with reasons.

#### Scenario: Skipped files are reported
- **WHEN** `jev files "**/*" --questions q.json` runs in a repo with `node_modules` and a PNG
- **THEN** neither is sent to Jev and both appear under `skipped` with a reason

### Requirement: gate answers with an exit code
`jev gate` SHALL ask one yes or no question about a state and exit with a code a shell can branch on: 0 when the probability of yes is at or above the threshold, 1 when it is below, 2 for invalid usage, and 3 when Jev could not be reached or errored. The threshold SHALL default to 0.5 and be set with `--threshold`. `--json` SHALL also print the answer.

#### Scenario: Pre-commit check
- **WHEN** a git hook runs `jev gate "Does this diff add a secret or credential?" --command "git diff --cached" --threshold 0.7`
- **THEN** the hook can block the commit on exit code 0 and continue on 1

#### Scenario: Jev unavailable
- **WHEN** the network is down
- **THEN** `jev gate` exits 3, so the script chooses whether to fail open or closed

### Requirement: guard checks a command or write with the Level 6 decision
`jev guard bash "<command>"` and `jev guard write <path>` (content on stdin) SHALL run the same bash gate and write gate the hooks use, print the verdict and reason, and exit 0 for allow and 1 for block.

#### Scenario: Force push
- **WHEN** a user runs `jev guard bash "git push --force origin main"`
- **THEN** it prints a block with the reason and exits 1

### Requirement: setup wires a project without clobbering it
`jev setup --harness claude|codex` SHALL write the MCP server entry and hook entries for the chosen tools and guards into the project's agent config (Claude: `.mcp.json` and `.claude/settings.json`; Codex: its config file), merging into existing files, never removing or changing entries it did not create, and SHALL support `--dry-run` to print the result without writing. Running it twice SHALL leave the files as after the first run.

#### Scenario: Existing settings kept
- **WHEN** `.claude/settings.json` already has a permissions block and an unrelated hook, and the user runs `jev setup --harness claude --guards bash,write`
- **THEN** the file keeps the permissions and the unrelated hook and gains the Jev `PreToolUse` entries

#### Scenario: Idempotent
- **WHEN** `jev setup` runs twice with the same options
- **THEN** the second run reports no changes

### Requirement: Machine-readable by default where scripts read it
Subcommands that produce answers SHALL write results to stdout and diagnostics to stderr, so stdout can be piped to `jq`, and SHALL never print credentials.

#### Scenario: Piping to jq
- **WHEN** a user runs `jev ask ... | jq .answers`
- **THEN** jq receives valid JSON with no log lines mixed in
