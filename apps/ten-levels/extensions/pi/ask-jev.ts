/**
 * Level 10 on pi: ask_jev on any situation, the system prompt nudge, and the spend ledger
 * reported at the end of each agent run.
 */
import { emptyLedger, record, summarize } from "@bobobowis/jev-kit/ledger";
import { ASK_JEV_NUDGE, askJev } from "@bobobowis/jev-kit/tools";
import { registerJevTool, report, type PiTypes } from "../report.ts";

export function install(pi: any, Type: PiTypes) {
  let ledger = emptyLedger();

  pi.on("before_agent_start", async (event: any) => {
    const systemPrompt = event.systemPrompt ?? "";
    if (systemPrompt.includes("ask_jev")) return;
    return { systemPrompt: `${systemPrompt}\n\n${ASK_JEV_NUDGE}` };
  });

  registerJevTool(pi, Type, askJev, {
    after: (r) => {
      if (r.isError) return;
      const p = r.payload as { answers: Record<string, unknown>; usage?: any };
      ledger = record(ledger, p.usage, Object.keys(p.answers).length);
    },
  });

  pi.on("agent_end", async () => {
    if (ledger.calls) report(pi, "ledger", { ...ledger, summary: summarize(ledger, 0) });
  });
}
