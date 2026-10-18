// Stop: when the turn changed code, run the offline tests. On a failure, Jev says whether the
// change caused it; only then is Claude sent back to fix it. Environment failures are reported, not blocked.
import { ask, main, run } from "./lib.mjs";

main((p) => {
  if (p.stop_hook_active) return null; // already sent back once this turn
  const changed = run("git status --porcelain -- packages apps scripts", { keep: 4000 }).output.trim();
  if (!changed) return null;

  const tests = run("pnpm test", { timeout: 240000 });
  if (tests.status === 0) return null;

  const answers = ask({
    cause: {
      type: "choice",
      instructions: "The offline test suite failed after an agent changed the files in changed. Read output: what caused the failure?",
      criteria: {
        change: "An assertion or type error a code change explains",
        environment: "The environment: missing build, install, network, a port in use, a timeout",
        unclear: "Can't tell from the output",
      },
    },
  }, { state: { changed, output: tests.output } });

  const cause = answers?.cause;
  if (cause && cause.choice === "environment" && cause.confidence >= 0.6) {
    return { systemMessage: "pnpm test failed, but Jev reads it as an environment problem, not the change." };
  }
  return {
    decision: "block",
    reason: `pnpm test fails after your changes${cause ? ` (Jev: ${cause.choice}, ${cause.confidence.toFixed(2)})` : ""}. Fix it before finishing. Last lines:\n${tests.output.slice(-1500)}`,
  };
});
