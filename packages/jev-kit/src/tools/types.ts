/**
 * A Jev tool, defined once for every harness: pi registers it, the MCP server lists it, the CLI
 * runs it. The name, description, parameters, and payload are the same wherever it appears.
 */
import type { Decider } from "../events/index.ts";
import type { CompactAction } from "../compact/should-compact.ts";
import type { Evaluation, TurnInput } from "../compact/evaluate.ts";

/** The subset of JSON Schema the tools use. */
export interface JsonSchema {
  type?: "object" | "string" | "boolean" | "array" | "number" | "integer";
  description?: string;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  additionalProperties?: boolean | JsonSchema;
}

export interface CompactionSource {
  /** The session as the harness sees it, or null when it has no history to offer. */
  input(): TurnInput | null | Promise<TurnInput | null>;
  /** How the agent can act on a tier under this harness. */
  action: CompactAction;
  /** Told about every evaluation, so a harness can keep injecting the latest tier. */
  onEvaluation?(evaluation: Evaluation): void;
}

export interface ToolContext {
  /** The directory the agent works in. Paths resolve here and may not leave it. */
  cwd: string;
  harness: string;
  decide: Decider;
  report(kind: string, payload: Record<string, unknown>): void;
  /** Level 7 only. */
  compaction?: CompactionSource;
}

export interface ToolResult {
  /** What the agent reads. */
  text: string;
  /** The structured result, when the call succeeded. */
  payload?: unknown;
  isError?: boolean;
}

export interface JevTool {
  name: string;
  label: string;
  description: string;
  parameters: JsonSchema;
  execute(params: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export const ok = (payload: unknown): ToolResult => ({ text: JSON.stringify(payload, null, 2), payload });
export const fail = (text: string): ToolResult => ({ text, isError: true });

export const object = (properties: Record<string, JsonSchema>, required: string[] = Object.keys(properties)): JsonSchema =>
  ({ type: "object", properties, required });
export const str = (description?: string): JsonSchema => (description ? { type: "string", description } : { type: "string" });
