---
description: Find where a bug or request lives with Jev before opening files
argument-hint: <what is broken or wanted>
---

Triage this with the Jev MCP tools before reading any file in full:

$ARGUMENTS

1. Pick the likely directories from AGENTS.md (the package in `packages/jev-kit/src/`, the levels in
   `apps/ten-levels/src/levels/`, the lab server in `apps/ten-levels/server/`).
2. Call `pick_first_file` (or `ask_jev_files` with a `noul` such as "Is this file involved in: …?")
   over those globs. Jev reads the files; you get answers, not contents.
3. Open only the top one or two files with Read. If they turn out wrong, ask again with a sharper
   question instead of opening more.
4. Report: the files Jev ranked, the ones you opened, and where the problem or change belongs.
   Don't edit anything until I say so.
