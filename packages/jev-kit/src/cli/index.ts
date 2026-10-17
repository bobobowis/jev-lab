#!/usr/bin/env node
/**
 * The `jev` bin. Everything lives in main.ts, so tests can call it without a process.
 */
import { main } from "./main.ts";
import { processIo } from "./common.ts";

// A reader that stops early (`jev files ... | head -1`) closes the pipe: that ends the output, not an error.
process.stdout.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EPIPE") process.exit(process.exitCode ?? 0);
  throw err;
});

const argv = process.argv.slice(2);
main(argv, processIo()).then((code) => {
  // A hook must exit as soon as it has answered: a Jev call abandoned at the deadline would
  // otherwise hold the process, and the harness waits for it. Exit once stdout has flushed.
  if (argv[0] === "hook") process.stdout.write("", () => process.exit(code));
  else process.exitCode = code;
});
