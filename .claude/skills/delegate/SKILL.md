---
name: delegate
description: Hand a task to a subagent on the cheapest Claude model that can do it, chosen by Jev. Use when the user says delegate, hand this off, or run this in the background, and when you are about to launch a subagent and haven't picked its model.
argument-hint: "<the task to hand off>"
---

# Delegate on the right model

Level 5's model router (`routeModel` in `apps/ten-levels/src/levels/level05/model-router.ts`) in
front of the Agent tool: one Jev call picks the model and the effort, so search and mechanical work
doesn't run on the most expensive model, and hard work doesn't run on the cheapest.

A hook can't change this session's model; this picks the model of the subagent you launch.

## 1. Write the brief first

The subagent starts cold. Write the prompt it will get: the goal, the files or directories it
starts from, what done means, and what it must not touch. Route on the brief, not on the user's
one-line request.

## 2. Ask Jev

Call `mcp__jev__ask_jev` (ToolSearch `select:mcp__jev__ask_jev` if needed) with
`state` = `{"task": "<the brief>"}` as a JSON string and:

```json
{
  "model": {
    "type": "choice",
    "instructions": "Which is the least costly model that can complete `task` well?",
    "criteria": {
      "haiku": "Search, lookups, extraction, listing, summarizing a few files, mechanical edits that follow a clear pattern",
      "sonnet": "Ordinary feature work, fixing a failing test, debugging across a few files, writing tests",
      "opus": "Architecture, reasoning across many files, subtle bugs, security, anything where a wrong answer is costly"
    }
  },
  "effort": {
    "type": "score",
    "instructions": "How much reasoning does `task` need?",
    "criteria": ["Immediate: one fact or one mechanical change", "Some investigation across a few files", "Deep multi-step reasoning with trade-offs"]
  },
  "read_only": {
    "type": "noul",
    "instructions": "Can `task` be done by reading and searching only, with no edits or commands that change anything?"
  }
}
```

Without the MCP tool: `jev ask --questions '<json>' --state '<json>'` (in this repo
`node --env-file-if-exists=.env packages/jev-kit/dist/cli/index.js ask ...`).

## 3. Launch

| Jev says | Agent call |
|---|---|
| `model` at confidence ≥ 0.5 | `model` = that choice |
| `model` confidence < 0.5 | the stronger of the two most probable models |
| `effort` score ≥ 1.5 | pass `effort: "high"`; at 0.5 or less, `"low"`; otherwise leave it out |
| `read_only` ≥ 0.7 | `subagent_type: "Explore"`, which can't edit |

Tell the user in one line what you launched and why: "Delegated to haiku (Explore), Jev: haiku 0.88,
effort 0.3." When it finishes, check its result before you build on it.
