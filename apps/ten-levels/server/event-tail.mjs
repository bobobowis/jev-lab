/**
 * Follow a session's event directory: every `*.jsonl` file in it, each read by byte offset, so
 * events from the pi extension, the MCP server, and short-lived hook processes all reach the
 * window live. fs.watch wakes it up; a poll catches what watch misses on WSL and network drives.
 * A partial last line waits in a buffer until its newline arrives.
 *
 *   const tail = tailEventDir(dir, (event, file) => session.push("jev", event));
 *   tail.flush();   read everything written so far, synchronously
 *   tail.stop();
 */
import { closeSync, fstatSync, openSync, readdirSync, readSync, watch } from "node:fs";
import { join } from "node:path";
import { StringDecoder } from "node:string_decoder";

const CHUNK = 1 << 20;

export function tailEventDir(dir, onEvent, { pollMs = 250, onError = () => {} } = {}) {
  const files = new Map(); // name -> { offset, partial, decoder }
  let stopped = false;

  function readFile(name) {
    const state = files.get(name) ?? { offset: 0, partial: "", decoder: new StringDecoder("utf8") };
    files.set(name, state);
    let fd;
    try { fd = openSync(join(dir, name), "r"); } catch { return; }
    try {
      const size = fstatSync(fd).size;
      if (size < state.offset) { state.offset = 0; state.partial = ""; state.decoder = new StringDecoder("utf8"); } // truncated or replaced
      const buf = Buffer.alloc(CHUNK);
      while (state.offset < size) {
        const n = readSync(fd, buf, 0, Math.min(CHUNK, size - state.offset), state.offset);
        if (n <= 0) break;
        state.offset += n;
        state.partial += state.decoder.write(buf.subarray(0, n)); // holds a split multi-byte character
        let nl;
        while ((nl = state.partial.indexOf("\n")) !== -1) {
          const line = state.partial.slice(0, nl).trim();
          state.partial = state.partial.slice(nl + 1);
          if (!line) continue;
          let event;
          try { event = JSON.parse(line); } catch { onError(new Error(`unparseable event line in ${name}`)); continue; }
          onEvent(event, name);
        }
      }
    } finally {
      closeSync(fd);
    }
  }

  function flush() {
    if (stopped) return;
    let names;
    try { names = readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort(); } catch { return; }
    for (const name of names) readFile(name);
  }

  let watcher = null;
  try {
    watcher = watch(dir, () => flush());
    watcher.on("error", () => { watcher?.close(); watcher = null; });
  } catch { /* poll only */ }
  const timer = setInterval(flush, pollMs);
  timer.unref?.();
  flush();

  return {
    flush,
    stop() {
      if (stopped) return;
      flush();
      stopped = true;
      clearInterval(timer);
      watcher?.close();
    },
  };
}
