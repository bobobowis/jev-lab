/**
 * The one call every file helper makes. Defaults to the shared client; tools and hooks pass
 * a reporting decider instead, so the call lands on the event channel.
 */
import type { Answer, Questions, State } from "../core/types.ts";

export type Decide = (state: State, questions: Questions) => Promise<{ answers: Record<string, Answer>; usage?: unknown; model?: string }>;
