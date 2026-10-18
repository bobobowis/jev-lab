/**
 * POST /api/shutdown lets a new `pnpm run web` replace the lab already holding the port, instead of
 * killing whatever listens there. Only from this machine, and only with the lab's own header: a
 * page in the browser cannot send a custom header cross-origin without a preflight, which this
 * server never answers, so no website can stop the lab.
 */
export const SHUTDOWN_HEADER = "x-jev-lab";
export const SHUTDOWN_VALUE = "shutdown";

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/** Why a shutdown request is refused, or null when it is allowed. */
export function shutdownRefusal(req) {
  if (req.method !== "POST") return "POST only";
  if (!LOOPBACK.has(req.socket?.remoteAddress ?? "")) return "only from this machine";
  if (req.headers?.[SHUTDOWN_HEADER] !== SHUTDOWN_VALUE) return `the ${SHUTDOWN_HEADER} header is required`;
  return null;
}
