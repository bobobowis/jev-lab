/**
 * Level 10: ask_jev on any situation. The agent passes its own state, paths for code to read,
 * a command for code to run, and its question block. Code assembles one state and makes one call.
 * A command runs through the bash gate first. Over the budget, the error names the parts and a split.
 */
import { parseQuestions } from "../files/ask-files.ts";
import { AskStateError, assembleState, type RunCommand } from "../files/assemble.ts";
import { ASK_JEV_DESCRIPTION } from "./description.ts";
import { gatedRunner } from "./run-command.ts";
import { fail, object, ok, str, type JevTool } from "./types.ts";

/** The usage guidance: a system prompt line under pi, server instructions under MCP. */
export const ASK_JEV_NUDGE =
  "You have ask_jev. When you need a classification, a risk score, or a yes or no with a confidence, " +
  "prefer it over reasoning it out yourself. Give it paths or a command instead of pasting content. " +
  "It answers in 300 ms and costs almost nothing.";

/** `run` is the unguarded runner the gate wraps; tests pass a fake. */
export function makeAskJev(run?: RunCommand): JevTool {
  return {
    name: "ask_jev",
    label: "Ask Jev",
    description: ASK_JEV_DESCRIPTION,
    parameters: object({
      questions_json: str("The question block, a JSON object keyed by question id"),
      state: str("Your own state: plain text, or a JSON object as a string. Short. Not for pasting files or output."),
      paths: { type: "array", items: { type: "string" }, description: "Files or globs for code to read into files[\"path\"]. Up to 20 files." },
      command: str("A command for code to run in the repo; its result goes into output. Runs through the bash gate."),
    }, ["questions_json"]),
    async execute(p: any, ctx) {
      try {
        const questions = parseQuestions(p.questions_json);
        const { state, summary } = await assembleState({ state: p.state, paths: p.paths, command: p.command }, ctx.cwd, gatedRunner(ctx, run));
        const result = await ctx.decide("ask_jev", state, questions, { summary });
        return ok({ answers: result.answers, state_summary: summary, usage: result.usage, model: result.model });
      } catch (err: any) {
        const text = err instanceof AskStateError ? err.message : `ask_jev error: ${err?.message ?? err}`;
        ctx.report("error", { hook: "ask_jev", message: text });
        return fail(text);
      }
    },
  };
}

export const askJev: JevTool = makeAskJev();
