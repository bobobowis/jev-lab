/** Client for the agent session routes: start, prompt, abort, and the live event stream. */

export interface AgentItem {
  seq: number;
  event: string;
  data: any;
  at: number;
}

async function post(path: string, body?: unknown): Promise<any> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body ?? {}) });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
  return json;
}

/** Starts a session in the harness given, or the server's default (JEV_AGENT, then the first on PATH). */
export function startAgent(level: number, option: string, config: Record<string, unknown>, harness?: string): Promise<{ id: string; model: string; harness: string }> {
  return post("/api/agent/start", { level, option, config, harness: harness || undefined });
}

export const promptAgent = (id: string, message: string) => post(`/api/agent/${id}/prompt`, { message });
export const abortAgent = (id: string) => post(`/api/agent/${id}/abort`);
export const stopAgent = (id: string) => fetch(`/api/agent/${id}`, { method: "DELETE" }).catch(() => undefined);

/** Subscribe to a session. Every event so far replays first, then live. Returns the closer. */
export function subscribeAgent(id: string, onItem: (item: AgentItem) => void): () => void {
  const es = new EventSource(`/api/agent/${id}/events`);
  es.addEventListener("item", (e) => onItem(JSON.parse((e as MessageEvent).data)));
  return () => es.close();
}
