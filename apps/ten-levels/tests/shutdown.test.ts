import test from "node:test";
import assert from "node:assert/strict";
import { shutdownRefusal } from "../server/shutdown.mjs";
// @ts-ignore plain JS helper outside this package
import { openers } from "../../../scripts/open-url.mjs";

const req = (remoteAddress: string, headers: Record<string, string> = {}, method = "POST") => ({ method, headers, socket: { remoteAddress } });
const LAB = { "x-jev-lab": "shutdown" };

test("shutdown: allowed from loopback with the lab header", () => {
  for (const addr of ["127.0.0.1", "::1", "::ffff:127.0.0.1"]) assert.equal(shutdownRefusal(req(addr, LAB)), null, addr);
});

test("shutdown: refused from another machine, without the header, or not as a POST", () => {
  assert.match(shutdownRefusal(req("192.168.1.20", LAB))!, /only from this machine/);
  assert.match(shutdownRefusal(req("10.0.0.5", LAB))!, /only from this machine/);
  assert.match(shutdownRefusal(req("127.0.0.1"))!, /x-jev-lab header is required/);
  assert.match(shutdownRefusal(req("127.0.0.1", { "x-jev-lab": "please" }))!, /header is required/);
  assert.match(shutdownRefusal(req("127.0.0.1", LAB, "GET"))!, /POST only/);
});

test("open-url: the opener per platform, WSL tries wslview then explorer.exe", () => {
  const url = "http://127.0.0.1:4399/?a=1&b=2";
  assert.deepEqual(openers(url, "win32", false), [["rundll32", ["url.dll,FileProtocolHandler", url]]]);
  assert.deepEqual(openers(url, "darwin", false), [["open", [url]]]);
  assert.deepEqual(openers(url, "linux", true).map(([c]: [string]) => c), ["wslview", "explorer.exe"]);
  assert.deepEqual(openers(url, "linux", false), [["xdg-open", [url]]]);
});
