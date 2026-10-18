# Billing sandbox

A small service the lab's agents work in: sessions and tokens under `src/auth`, storage under
`src/db`, HTTP handlers under `src/http`, and pure billing rules under `src/domain`. Tests run with
`pnpm test`. One test fails on purpose: proration in `src/domain/billing.ts` rounds the wrong way.

## Run it by hand with Claude Code or Codex

The lab copies this folder for every agent session and wires Jev in for you. You can do the same
yourself, without the lab, with `jev setup` from `@bobobowis/jev-kit`. From the repo root, after
`pnpm install`:

```bash
cp -r apps/ten-levels/sandbox /tmp/jev-sandbox
JEV="node $PWD/packages/jev-kit/dist/cli/index.js"
cd /tmp/jev-sandbox && git init -q && git add -A && git commit -qm start

# The guards in .claude/settings.json, and ask_jev in .mcp.json
$JEV setup --harness claude --guards bash,write,result --tools ask_jev
claude
```

For Codex, use `--harness codex`. It writes a marked block at the end of `.codex/config.toml`, and
Codex asks you to trust the project and its hooks the first time. Then run `codex`.

- The hooks and the MCP server read `TYPESAFE_API_KEY` or `OPENROUTER_API_KEY` from the environment
  the agent was started in, so export one first. Without a key they allow everything and report an
  error, they never block on their own.
- `--level 7` adds the compaction advisor. Claude Code and Codex cannot compact from a tool, so
  the agent is told to ask you to run `/compact`. Its lines default to 50k, 100k, and 150k tokens of
  context. Pass `--hook-args "--lines 6000,10000,14000"` for the lab's demo lines.
- The advisor keeps its notes in `.jev/` in the project. Add it to `.gitignore`.
- Each run sets the whole selection: running it again with other options replaces what it set up
  before (and only that), it does not add to it. It prints what is on after the run, and
  `--dry-run` shows the files first. `--level N` is shorthand for one lab level: 6 is the guards,
  7 the advisor, 8 to 10 their tools.
