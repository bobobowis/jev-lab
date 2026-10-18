---
name: verify
description: Check claims about code against the files they cite, with Jev, before stating them. Use before a final answer that says what code does with file:line references, when the user says verify, check your claims, or are you sure, and after an explanation or review built from several files.
argument-hint: "[the claims to check; default: the ones in your last answer]"
---

# Verify claims with Jev

Level 4's citation check (`checkCitation` in `apps/ten-levels/src/levels/level04/citation-check.ts`)
applied to your own answer: every claim about the code is checked against the file it cites, by Jev
reading the file, before the user reads the claim.

## 1. List the claims

From `$ARGUMENTS`, or from the answer you are about to give, take each claim that says what code
does and cites where. Write each one as:

- `claim`: one sentence, for example "`gateBash` blocks an irreversible pick at confidence 0.6 or more"
- `quote`: the exact line or lines it rests on, copied from the file
- `path`: the file, relative to the repo

Eight claims at most; pick the ones the answer depends on. A claim with no file behind it is not
checked here: say it is unverified.

## 2. Ask Jev, one call per claim, all in parallel

Call `mcp__jev__ask_jev` (load it with ToolSearch `select:mcp__jev__ask_jev` if needed) with
`state` = `{"claim": "...", "quote": "..."}` as a JSON string, `paths` = `["<path>"]`, and:

```json
{
  "supports": {
    "type": "choice",
    "instructions": "Does the file in files support `claim`, read around `quote`?",
    "criteria": {
      "supports": "The code clearly does what the claim says",
      "contradicts": "The code does something different from the claim",
      "unrelated": "The file does not settle the claim either way"
    }
  },
  "quote_accuracy": {
    "type": "score",
    "instructions": "How faithful is `quote` to the text in the file?",
    "criteria": ["Not in the file, or altered so the meaning changes", "Loose but keeps the meaning", "Verbatim or trivially trimmed"]
  }
}
```

Without the MCP tool, the same block works with the command: `jev ask --questions '<json>' --state '<json>' --paths <path>`
(in this repo `node --env-file-if-exists=.env packages/jev-kit/dist/cli/index.js ask ...`).

## 3. Decide in code terms, not by feel

| Jev says | Do |
|---|---|
| `supports` at confidence ≥ 0.6 and `quote_accuracy` score ≥ 1 | keep the claim |
| `contradicts`, or `quote_accuracy` score < 1 | open the file at the quote, fix the claim, or drop it |
| `unrelated` | the cited file is the wrong one: find the right one or mark the claim unverified |
| `supports` confidence < 0.5 | read the lines yourself before keeping it |

Go by the `quote_accuracy` score, not its confidence: on a long file the confidence runs low even
for a verbatim quote (a true claim came back `supports 1.00`, quote score 1.57 at 0.35).

## 4. Report

Give the corrected answer. After it, one line per claim you changed or dropped, with what Jev said
(`contradicts 0.91`), and a count: "Checked 6 claims with Jev: 5 kept, 1 fixed." Don't paste Jev's
raw JSON.
