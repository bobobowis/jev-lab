#!/usr/bin/env node
/**
 * Write the capability matrix from packages/jev-kit/src/capabilities.ts into every README that has
 * the jev:matrix markers. apps/ten-levels/tests/docs-matrix.test.ts fails when a README is stale.
 * Usage: node scripts/docs.mjs [--check] (after the package is built)
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { withMatrix } from "../packages/jev-kit/dist/capabilities.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const MATRIX_DOCS = ["README.md", "apps/ten-levels/README.md", "packages/jev-kit/README.md"];

const check = process.argv.includes("--check");
const stale = [];
for (const doc of MATRIX_DOCS) {
  const text = await readFile(join(root, doc), "utf8");
  const next = withMatrix(text);
  if (next === text) continue;
  stale.push(doc);
  if (!check) await writeFile(join(root, doc), next);
}
if (check && stale.length) {
  console.error(`capability matrix is out of date in ${stale.join(", ")}. Run npm run docs`);
  process.exit(1);
}
console.log(stale.length ? `${check ? "stale" : "updated"}: ${stale.join(", ")}` : "capability matrix is up to date");
