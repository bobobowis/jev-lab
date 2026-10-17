/**
 * The READMEs carry the capability matrix generated from the package; this fails when one drifts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { MATRIX_END, MATRIX_START, withMatrix } from "@bobobowis/jev-kit/capabilities";

const root = fileURLToPath(new URL("../../../", import.meta.url));

for (const doc of ["README.md", "apps/ten-levels/README.md", "packages/jev-kit/README.md"]) {
  test(`${doc} carries the current capability matrix`, async () => {
    const text = await readFile(root + doc, "utf8");
    assert.ok(text.includes(MATRIX_START) && text.includes(MATRIX_END), `${doc} has no jev:matrix markers`);
    assert.equal(withMatrix(text), text, `${doc} is stale; run npm run docs`);
  });
}
