/** Strict JSONL: split on LF only. Node's readline also splits on U+2028, which breaks JSON strings. */
export function readLines(stream, onLine) {
  let buffer = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk) => {
    buffer += chunk;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i).replace(/\r$/, "");
      buffer = buffer.slice(i + 1);
      if (line) onLine(line);
    }
  });
}
