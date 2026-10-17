import test from "node:test";
import assert from "node:assert/strict";
import { CONFIDENCE, confidenceBand, normalized, weighted } from "../src/policy/index.ts";
import type { ScoreAnswer } from "../src/core/types.ts";

const scoreAnswer = (score: number, levels: number): ScoreAnswer => ({
  type: "score", score, confidence: 1,
  legend: Object.fromEntries(Array.from({ length: levels }, (_, i) => [String(i), `level ${i}`])),
  probabilities: {},
} as unknown as ScoreAnswer);

test("normalized puts scales of different lengths on 0 to 1", () => {
  assert.equal(normalized(scoreAnswer(2, 3)), 1);
  assert.equal(normalized(scoreAnswer(2, 5)), 0.5);
  assert.equal(normalized(scoreAnswer(0, 1)), 0);
});

test("weighted divides by the weight total", () => {
  assert.equal(weighted({ a: 1, b: 0 }, { a: 0.6, b: 0.4 }), 0.6);
  assert.equal(weighted({ a: 1, b: 0 }, { a: 3, b: 2 }), 0.6);
});

test("weighted refuses a missing part and zero weights", () => {
  assert.throws(() => weighted({ a: 1 } as Record<"a" | "b", number>, { a: 1, b: 1 }), /missing part "b"/);
  assert.throws(() => weighted({ a: 1 }, { a: 0 }), RangeError);
});

test("confidenceBand: below the floor a human decides, above the bar it acts", () => {
  assert.equal(confidenceBand(CONFIDENCE.REVIEW_FLOOR - 0.01), "review");
  assert.equal(confidenceBand(0.7), "confirm");
  assert.equal(confidenceBand(0.95), "act");
  assert.equal(confidenceBand(0.6, 0.65, 0.8), "review");
});
