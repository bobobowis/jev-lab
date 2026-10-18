import test from "node:test";
import assert from "node:assert/strict";
import { CAPABILITIES, capability, HARNESS_ORDER, levelCapabilities, matrixMarkdown, MATRIX_END, MATRIX_START, withMatrix } from "../src/capabilities.ts";

test("every agent option names a status for every harness, and every non-full one says why", () => {
  for (const [level, l] of Object.entries(CAPABILITIES)) {
    for (const [key, o] of Object.entries(l.options)) {
      for (const h of HARNESS_ORDER) {
        const s = o.support[h];
        assert.ok(["full", "degraded", "unavailable"].includes(s.status), `${level} ${key} ${h}`);
        if (s.status !== "full") assert.ok(s.note, `${level} ${key} ${h} needs a note`);
      }
    }
  }
});

test("pi runs everything; the cut point runs only under pi; hooks need a harness", () => {
  for (const level of [6, 7, 8, 9, 10]) for (const key of ["A", "B", "C"]) assert.equal(capability(level, key, "pi").status, "full");
  for (const h of ["claude", "codex", "mcp"] as const) assert.equal(capability(7, "C", h).status, "unavailable");
  assert.equal(capability(6, "A", "mcp").status, "unavailable");
  assert.equal(capability(7, "A", "claude").status, "degraded");
  assert.equal(capability(3, "A", "codex").status, "full");
  assert.equal(levelCapabilities(3), null);
  assert.equal(levelCapabilities(9)!.B.mcp.status, "full");
});

test("the Markdown table has a row per option and a column per harness", () => {
  const lines = matrixMarkdown().split("\n");
  assert.equal(lines.length, 2 + 15);
  assert.equal(lines[0], "| Level | pi | Claude Code | Codex | Generic MCP |");
  assert.match(lines.find((l) => l.startsWith("| 7 C"))!, /\| full \| unavailable \(Claude Code/);
});

test("withMatrix replaces only what is between the markers, and leaves unmarked text alone", () => {
  const doc = `intro\n${MATRIX_START}\nold\n${MATRIX_END}\noutro`;
  const next = withMatrix(doc);
  assert.ok(next.startsWith(`intro\n${MATRIX_START}\n\n| Level`));
  assert.ok(next.endsWith(`\n\n${MATRIX_END}\noutro`));
  assert.equal(withMatrix(next), next);
  assert.equal(withMatrix("no markers"), "no markers");
  const crlf = withMatrix(doc.replaceAll("\n", "\r\n"));
  assert.equal(crlf, next.replaceAll("\n", "\r\n"), "a CRLF checkout keeps CRLF");
});
