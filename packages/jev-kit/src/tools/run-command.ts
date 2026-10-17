/**
 * Run a command for a state. The output is captured, never streamed to the agent, and the
 * command passes the bash gate first: a state should only ever need reads.
 */
import { exec } from "node:child_process";
import { BLOCK_NOTICE, gateBashCommand } from "../guards/bash-gate.ts";
import { AskStateError, type CommandOutput, type RunCommand } from "../files/assemble.ts";
import type { ToolContext } from "./types.ts";

export const COMMAND_TIMEOUT_MS = 60_000;
export const MAX_OUTPUT_CHARS = 200_000;

export function runCommand(command: string, cwd: string): Promise<CommandOutput> {
  return new Promise((resolve) => {
    exec(command, { cwd, timeout: COMMAND_TIMEOUT_MS, maxBuffer: MAX_OUTPUT_CHARS * 4, env: { ...process.env, CI: "1" } }, (err, stdout, stderr) => {
      const code = err && typeof (err as any).code === "number" ? (err as any).code : err ? null : 0;
      resolve({ command, exit_code: code, stdout: String(stdout).slice(0, MAX_OUTPUT_CHARS), stderr: String(stderr).slice(0, MAX_OUTPUT_CHARS) });
    });
  });
}

/** A runner that refuses what the bash gate blocks, reporting the gate's verdict either way. */
export function gatedRunner(ctx: ToolContext, run: RunCommand = runCommand): RunCommand {
  return async (command, cwd) => {
    const gate = await gateBashCommand(command, cwd, (s, q) => ctx.decide("ask_jev command gate", s, q));
    ctx.report("hook", { hook: "ask_jev command", tool: "bash", command, block: gate.block, reason: gate.reason });
    if (gate.block) throw new AskStateError(`ask_jev: the command was refused by the bash gate: ${gate.reason}. ${BLOCK_NOTICE} ask_jev commands should only read.`);
    return run(command, cwd);
  };
}
