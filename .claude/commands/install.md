---
description: Install 10 Levels of Jev by following AGENTS.md, plus the Claude Code checks
---

# Install 10 Levels of Jev

Follow the **Setup** section of `AGENTS.md` step by step, running every check through Bash and
showing a pass or fail line after each. Then run the Claude-specific checks below and report.

## Rules

- Do not assume anything is installed; check it.
- Install the web dependencies without asking. Ask the user before anything that needs their input.
- Never read or display a key's value. Only confirm it is set: `grep -q '^OPENROUTER_API_KEY=' .env 2>/dev/null || [ -n "$OPENROUTER_API_KEY" ]`, and the same for `TYPESAFE_API_KEY`.
- If no key is set, ask whether the user has an OpenRouter key (https://openrouter.ai/keys). If so, copy `.env.sample` to `.env` and tell them which line to fill; do not ask them to paste it into the chat.
- Do not install a coding agent the user didn't ask for. Report which levels it would unlock (the table in `AGENTS.md`) and continue.
- Never start `npm run web` or `npm run dev`; only confirm they exist in `npm run`.

## Claude Code checks

1. `claude --version` is 2.1.302 or later, the version the lab's Claude driver was tested with.
2. `ls .claude/skills/hyper-jev/SKILL.md` and `node scripts/sync-skill-core.mjs --check`: the skill is present and its core matches the package.
3. `node scripts/docs.mjs --check` (after `npm install`): the README capability tables are current.
4. `apps/ten-levels/sandbox/src/domain/billing.ts` still has `Math.floor` on the prorate line. If it reads `Math.round`, the pristine sandbox was fixed and Levels 7, 9, and 10 lose their bug; report it, don't change it.

## Report

A status table with one row per check, then the ready count (for example `9 of 10 ready`) and one
line per item that needs the user. Next steps to paste:

```bash
npm run web            # the lab on http://127.0.0.1:4399
npm run level -- 1     # one level in the terminal; add a, b, or c for one option
npm run test:live      # live tests, needs a key
```
