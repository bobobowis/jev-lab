/**
 * The package must be able to leave this repository by moving one directory:
 * no import resolves outside it, no runtime dependencies, and only declared entry points are public.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** Static `import`/`export ... from`, side-effect `import "x"`, and dynamic `import("x")`. */
const SPECIFIER = /^\s*(?:import|export)\b[^;'"]*?\bfrom\s*["']([^"']+)["']|^\s*import\s*["']([^"']+)["']|\bimport\s*\(\s*["']([^"']+)["']/gm;

async function sourceFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await sourceFiles(full)));
    else if (entry.name.endsWith(".ts")) out.push(full);
  }
  return out;
}

test("every import under src resolves inside the package or to a node: builtin", async () => {
  const offenders: string[] = [];
  for (const file of await sourceFiles(join(root, "src"))) {
    const text = await readFile(file, "utf8");
    for (const m of text.matchAll(SPECIFIER)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (spec.startsWith("node:")) continue;
      const rel = relative(root, resolve(dirname(file), spec));
      if (!spec.startsWith(".") || rel.startsWith("..")) offenders.push(`${relative(root, file)} imports ${spec}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test("the manifest has no runtime or peer dependencies", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  assert.equal(pkg.dependencies, undefined);
  assert.equal(pkg.peerDependencies, undefined);
  assert.equal(pkg.optionalDependencies, undefined);
});

test("declared entry points resolve, private modules do not", async () => {
  const pkg = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  for (const entry of Object.keys(pkg.exports)) {
    const name = entry === "." ? pkg.name : `${pkg.name}/${entry.slice(2)}`;
    assert.doesNotThrow(() => import.meta.resolve(name), name);
  }
  for (const hidden of ["core/client", "dist/core/client.js", "src/core/client.ts"]) {
    assert.throws(() => import.meta.resolve(`${pkg.name}/${hidden}`), { code: "ERR_PACKAGE_PATH_NOT_EXPORTED" }, hidden);
  }
});
