---
name: route-task
description: Decide with Jev who should do a task before starting it, a plain command, this session, a subagent, a browser-capable agent, or the user, and whether it is too ambiguous to start. Use when the user says route this, who should do this, or triage this task, and when a request arrives that is broad or unclear.
argument-hint: "<the task>"
---

# Route a task before doing it

Level 5's agent router (`routeAgent` in `apps/ten-levels/src/levels/level05/agent-router.ts`): one
Jev call says which workflow fits the task, how ambiguous it is, and whether it needs logged-in apps.
Ambiguity is the part that pays: an unclear task gets questions before it gets work.

## 1. Ask Jev

Call `mcp__jev__ask_jev` (ToolSearch `select:mcp__jev__ask_jev` if needed) with
`state` = `{"task": "<the task, verbatim>", "repository": "<repo name>"}` as a JSON string and:

```json
{
  "profile": {
    "type": "choice",
    "instructions": "Which workflow should handle `task` in `repository`?",
    "criteria": {
      "command": "A command or an existing script answers it; no reasoning needed",
      "this_session": "A localized change or question the current session can do directly",
      "subagent": "Separable work, such as a broad search or an independent piece, that can run on its own and report back",
      "browser": "Needs a browser, a logged-in web app, or the desktop",
      "user": "Sensitive, irreversible, or needs a judgment or access only the user has"
    }
  },
  "ambiguity": {
    "type": "score",
    "instructions": "How ambiguous is `task`?",
    "criteria": ["Fully specified", "Some interpretation, but the goal is clear", "Open-ended: success depends on choices the request doesn't state"]
  },
  "needs_desktop": {
    "type": "noul",
    "instructions": "Does `task` need logged-in applications or the desktop?"
  }
}
```

Without the MCP tool: `jev ask --questions '<json>' --state '<json>'` (in this repo
`node --env-file-if-exists=.env packages/jev-kit/dist/cli/index.js ask ...`).

## 2. Act on it

First the ambiguity, whatever the profile:

- `ambiguity` score ≥ 1.5 at confidence ≥ 0.5: don't start. Ask the user the one to three
  questions whose answers would change the work, then route again with the answers in `task`.
- `ambiguity` score ≥ 1.5 at lower confidence: go ahead, and state the assumptions you made.

Then the profile, in this order. Below confidence 0.5, treat it as `user`.

| Profile | Do |
|---|---|
| `command` | run the command and report its result; no plan, no subagent |
| `this_session` | do it here |
| `subagent` | hand it off with the `delegate` skill, which also picks the model |
| `user` | say why it is theirs to decide or do, and what you would need to do it; this wins over `needs_desktop` |
| `browser`, or `needs_desktop` ≥ 0.5 | use the browser or computer-use tools if this session has them; if not, say what the user needs to do |

Start your reply with one line: "Jev routed this to subagent (0.82), ambiguity 0.4."
