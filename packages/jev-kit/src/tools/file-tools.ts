/**
 * Levels 8 and 9: judgments about files the agent never loads.
 *
 *   ask_jev_file_bool(path, question, yes?, no?)
 *   ask_jev_file_choice(path, question, options)
 *   ask_jev_file_score(path, question, levels)
 *   ask_jev_files(paths_or_globs, questions_json, recursive?)   one call per file, in parallel
 *   pick_first_file(question, candidates)                        a second pass: which to open first
 */
import { askFileBool } from "../files/ask-file-bool.ts";
import { askFileChoice } from "../files/ask-file-choice.ts";
import { askFileScore } from "../files/ask-file-score.ts";
import { askFiles } from "../files/ask-files.ts";
import { pickFirstFile } from "../files/pick-first.ts";
import { FileStateError } from "../files/read-state.ts";
import { fail, object, ok, str, type JevTool } from "./types.ts";

const WHEN =
  "Use this for a judgment about what a file does or contains, without reading it into your context. " +
  "Write the question against `content`, which is the file's text. Use the read tool instead when you need the code itself, to edit or quote it. " +
  "Exact lookups, does this string appear, how many lines, belong to grep, not here.";

export const QUESTION_SCHEMA =
  'questions_json is a JSON object keyed by question id. Three types. ' +
  'noul: {"type":"noul","instructions":"Does `content` ...?","criteria":{"true":"...","false":"..."}} returns a probability of yes. ' +
  'choice: {"type":"choice","instructions":"Which ... is `content`?","criteria":{"option_a":"when it applies","option_b":"...","other":"none of the above"}} returns one of your keys plus confidence, up to 255 options. ' +
  'score: {"type":"score","instructions":"How ... is `content`?","criteria":["lowest situation","...","highest situation"]} returns a position on your levels, two to ten of them. ' +
  "Write every question against `content`, the file's text; `path` is also in the state. Ask every question you might need in one block, it is one call per file either way.";

const fileFail = (err: any) => fail(err instanceof FileStateError ? err.message : `error: ${err?.message ?? err}`);
const PATH = str("File path, relative to the repo");

export const askJevFileBool: JevTool = {
  name: "ask_jev_file_bool",
  label: "Ask Jev about a file, yes or no",
  description: `Yes or no about one file. Returns { path, answer, noul } where noul is the probability of yes, 0 to 1. ${WHEN}`,
  parameters: object({
    path: PATH,
    question: str("A yes or no question about `content`, for example: Does `content` validate authentication tokens?"),
    yes: str("What counts as yes"),
    no: str("What counts as no"),
  }, ["path", "question"]),
  async execute(p: any, ctx) {
    try {
      return ok(await askFileBool(p.path, p.question, ctx.cwd, { yes: p.yes, no: p.no }, (s, q) => ctx.decide("ask_jev_file_bool", s, q, { path: p.path })));
    } catch (err) { return fileFail(err); }
  },
};

export const askJevFileChoice: JevTool = {
  name: "ask_jev_file_choice",
  label: "Ask Jev about a file, pick one",
  description: `Pick one option about one file. Returns { path, choice, confidence, probabilities }. The choice is always one of your options; an "other" option is added if you leave none. ${WHEN}`,
  parameters: object({
    path: PATH,
    question: str("The question, for example: Which layer is `content`?"),
    options: { type: "object", additionalProperties: { type: "string" }, description: "Option name to a one line description of when it applies. Up to 255." },
  }),
  async execute(p: any, ctx) {
    try {
      return ok(await askFileChoice(p.path, p.question, p.options, ctx.cwd, (s, q) => ctx.decide("ask_jev_file_choice", s, q, { path: p.path })));
    } catch (err) { return fileFail(err); }
  },
};

export const askJevFileScore: JevTool = {
  name: "ask_jev_file_score",
  label: "Ask Jev about a file, on a scale",
  description: `A position on a scale you define, about one file. Returns { path, score, top, nearest, confidence, legend }. Levels are ordered low to high, two to ten of them, each a described situation. ${WHEN}`,
  parameters: object({
    path: PATH,
    question: str("The question, for example: How risky is a refactor of `content`?"),
    levels: { type: "array", items: { type: "string" }, description: "Ordered low to high, each level a situation, for example: Isolated and well tested" },
  }),
  async execute(p: any, ctx) {
    try {
      return ok(await askFileScore(p.path, p.question, p.levels, ctx.cwd, (s, q) => ctx.decide("ask_jev_file_score", s, q, { path: p.path })));
    } catch (err) { return fileFail(err); }
  },
};

export const askJevFiles: JevTool = {
  name: "ask_jev_files",
  label: "Ask Jev about many files",
  description:
    "Ask the same typed questions of many files at once without reading any of them. Code expands globs and directories, " +
    "drops node_modules, .git, binaries, and files over the budget, caps the list at 255, then makes one Jev call per file in parallel. " +
    "Returns { results: [{ path, answers }], skipped: [{ path, reason }], calls }. " + QUESTION_SCHEMA +
    " Use read when you need a file's code; use grep for exact strings.",
  parameters: object({
    paths_or_globs: { type: "array", items: { type: "string" }, description: 'Files, directories, or globs, relative to the repo, for example ["src/**/*.ts"] or ["src/http"]' },
    questions_json: str("The question block as a JSON string"),
    recursive: { type: "boolean", description: "For directories: include every file below them. Default false." },
  }, ["paths_or_globs", "questions_json"]),
  async execute(p: any, ctx) {
    try {
      return ok(await askFiles(p.paths_or_globs, p.questions_json, ctx.cwd, {
        recursive: p.recursive ?? false,
        decide: (s, q) => ctx.decide("ask_jev_files", s, q, { path: (s as any).path }),
      }));
    } catch (err: any) { return fail(`error: ${err?.message ?? err}`); }
  },
};

export const pickFirstFileTool: JevTool = {
  name: "pick_first_file",
  label: "Pick the file to open first",
  description:
    "After ask_jev_files, choose which of a list of files to open first for a goal. One Choice keyed by path, so the pick is always a real file. " +
    "Returns { path | null, confidence, probabilities }. Pass a short note per path if you have one, for example the answers you already got.",
  parameters: object({
    question: str("The goal, for example: Which file should I open first to fix the proration bug?"),
    candidates: {
      type: "array",
      items: object({ path: str(), note: str() }, ["path"]),
      description: "Paths, with an optional one line note each",
    },
  }),
  async execute(p: any, ctx) {
    try {
      return ok(await pickFirstFile(p.question, p.candidates, (s, q) => ctx.decide("pick_first_file", s, q)));
    } catch (err: any) { return fail(`error: ${err?.message ?? err}`); }
  },
};
