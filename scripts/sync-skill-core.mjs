#!/usr/bin/env node
/**
 * Copy the package's core into the hyper-jev skill starter, so the skill stays self-contained
 * while @bobobowis/jev-kit stays the one source of truth. packages/jev-kit/tests/skill-sync.test.ts
 * fails when the two differ. Usage: node scripts/sync-skill-core.mjs [--check]
 */
import { copyFile, readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SOURCE = join(root, "packages/jev-kit/src/core");
export const TARGET = join(root, ".claude/skills/hyper-jev/templates/starter/src/core");

const check = process.argv.includes("--check");
const files = (await readdir(SOURCE)).filter((f) => f.endsWith(".ts")).sort();
const stale = [];
for (const file of files) {
  const src = await readFile(join(SOURCE, file), "utf8");
  const dst = await readFile(join(TARGET, file), "utf8").catch(() => null);
  if (src === dst) continue;
  stale.push(file);
  if (!check) await copyFile(join(SOURCE, file), join(TARGET, file));
}
const extra = (await readdir(TARGET)).filter((f) => f.endsWith(".ts") && !files.includes(f));

if (check) {
  if (stale.length || extra.length) {
    console.error(`skill core is out of date: ${[...stale, ...extra.map((f) => `${f} (not in the package)`)].join(", ")}. Run node scripts/sync-skill-core.mjs`);
    process.exit(1);
  }
  console.log("skill core matches the package");
} else {
  console.log(stale.length ? `synced ${stale.join(", ")}` : "skill core already matches the package");
  if (extra.length) console.warn(`not in the package, left alone: ${extra.join(", ")}`);
}
