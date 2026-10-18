/**
 * Policy helpers: the numbers in code that turn answers into decisions.
 * Jev never sees these. Tuning means changing a number, not a prompt.
 */
import type { ScoreAnswer } from "../core/types.ts";

/** Normalize a score answer to 0-1 against its own top level, so scales of different lengths compare. */
export function normalized(answer: ScoreAnswer): number {
  const topLevel = Object.keys(answer.legend).length - 1;
  return topLevel === 0 ? 0 : answer.score / topLevel;
}

/** Weighted sum of 0-1 parts. Weights are divided by their total, so they need not add up to 1. */
export function weighted<K extends string>(parts: Record<K, number>, weights: Record<K, number>): number {
  const keys = Object.keys(weights) as K[];
  const total = keys.reduce((n, k) => n + weights[k], 0);
  if (total <= 0) throw new RangeError("weights must add up to more than 0");
  return keys.reduce((n, k) => {
    if (typeof parts[k] !== "number") throw new RangeError(`missing part "${k}"`);
    return n + (weights[k] / total) * parts[k];
  }, 0);
}

/** The two confidence thresholds a gate reads. */
export const CONFIDENCE = {
  REVIEW_FLOOR: 0.5, // below this: don't act, ask a human
  DESTRUCTIVE_BAR: 0.9, // above this: act without confirmation
} as const;

export type ConfidenceBand = "review" | "confirm" | "act";

/** The answer says what, confidence says whether: below the floor a human decides, above the bar it runs, in between it asks. */
export function confidenceBand(confidence: number, floor: number = CONFIDENCE.REVIEW_FLOOR, bar: number = CONFIDENCE.DESTRUCTIVE_BAR): ConfidenceBand {
  if (confidence < floor) return "review";
  if (confidence > bar) return "act";
  return "confirm";
}
