/**
 * Level 6 on pi: the guards as tool_call and tool_result hooks. The agent never knows Jev is here.
 *
 *   tool_call    bash: the bash gate. write, edit: the write gate.
 *   tool_result  read, bash: the result screen, banner prepended to the output.
 */
import { handleHook, type Guard } from "@bobobowis/jev-kit/hooks";
import { decide, levelConfig, report } from "../report.ts";

type Option = "A" | "B" | "C";
const GUARD: Record<Option, Guard> = { A: "bash", B: "write", C: "result" };

export function install(pi: any) {
  const cfg = levelConfig<{ gates: Option[] }>({ gates: ["A", "B", "C"] });
  const guards = cfg.gates.map((o) => GUARD[o]).filter(Boolean);
  const hookCtx = {
    guards,
    decide: (source: string, s: any, q: any, extra?: Record<string, unknown>) => decide(pi, source, s, q, extra),
    report: (kind: string, payload: Record<string, unknown>) => report(pi, kind, payload),
  };

  pi.on("tool_call", async (event: any, ctx: any) => {
    const input = event.input ?? {};
    if (event.toolName === "bash") {
      const r = await handleHook({ kind: "shell", tool: "bash", command: String(input.command ?? ""), cwd: ctx.cwd }, hookCtx);
      if (r.block) return { block: true, reason: r.reason };
    }
    if (event.toolName === "write" || event.toolName === "edit") {
      const content = String(input.content ?? input.newText ?? input.new_string ?? "");
      const r = await handleHook({ kind: "write", tool: event.toolName, path: String(input.path ?? ""), content, cwd: ctx.cwd }, hookCtx);
      if (r.block) return { block: true, reason: r.reason };
    }
  });

  pi.on("tool_result", async (event: any, ctx: any) => {
    if (!(event.toolName === "read" || event.toolName === "bash")) return;
    const text = Array.isArray(event.content) ? event.content.filter((c: any) => c?.type === "text").map((c: any) => c.text).join("\n") : "";
    const kind = event.toolName === "read" ? "read-result" : "shell-result";
    const r = await handleHook({ kind, tool: event.toolName, text, cwd: ctx?.cwd ?? process.cwd() }, hookCtx);
    if (r.banner) return { content: [{ type: "text", text: `${r.banner}\n\n${text}` }] };
  });
}
