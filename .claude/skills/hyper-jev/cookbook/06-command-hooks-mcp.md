# Without writing code: the jev command, hooks, and MCP

Some decisions don't need a module in the user's backend. A script, a CI step, a git hook, or a
coding agent can call Jev through `jev`, the command in `@bobobowis/jev-kit`, the package this
skill's core is synced from. It is not on npm yet: pack it from the ten-levels repository
(`npm pack -w packages/jev-kit`) and install the tarball. It reads `TYPESAFE_API_KEY` or
`OPENROUTER_API_KEY`, and `--mock` runs offline.

## Pick the delivery

| The decision runs | Use |
|---|---|
| in a shell script, CI step, or git hook | `jev gate` (the exit code is the answer) or `jev ask` (JSON on stdout) |
| on every tool call a coding agent makes | `jev setup --guards ...`, which installs `jev hook` as the agent's hooks |
| when the agent chooses to ask | `jev setup --tools ...`, which serves the tools over MCP with `jev mcp` |
| inside the user's own service | the client, as in [structure and setup](01-structure-and-setup.md) |

## Scripts, CI, and git hooks

```bash
jev gate "Is this ticket about billing?" --state "$(cat ticket.txt)" && route billing
jev ask --questions @questions.json --command "git diff main" | jq .answers
jev files "src/**/*.ts" --questions @questions.json        # one call per file, in parallel
jev guard bash "$CMD"                                      # 0 allow, 1 block
```

`gate` and `guard` exit 3 when Jev can't answer. Decide per use case whether 3 fails open (a
pre-commit check) or closed (a deploy gate), as in [production checks](05-production.md).

## Coding agents: hooks and tools

```bash
jev setup --harness claude --guards bash,write,result --tools ask_jev   # Claude Code: .claude/settings.json and .mcp.json
jev setup --harness codex --guards bash,write --compact                 # Codex: a marked block in .codex/config.toml
jev setup --harness claude --level 8 --dry-run                          # print what it would write
```

- **Guards** (`bash`, `write`, `result`) run before or after a tool call. A block denies the call
  and tells the agent why. Hooks fail open on a Jev error or timeout, so they are a second signal
  next to the harness's own permissions, never the only control.
- **The compaction advisor** (`--compact`) asks after each turn whether the work has moved on and,
  with context high, tells the agent to ask the user to run `/compact`.
- **Tools** (`ask_jev`, `ask_jev_files`, `ask_jev_file_bool`, ...) let the agent ask Jev about files
  it never loads, or about anything it holds. Any MCP client can use them through `jev mcp`.

Each `jev setup` run sets the whole selection and replaces only what an earlier run wrote; the
user's other settings are left alone. Run it in the user's project only when asked, and show the
`--dry-run` first when the project already has agent config.
