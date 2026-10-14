#!/usr/bin/env node
/**
 * Tells a development build (EXPO_PUBLIC_VERIFY_HARNESS=1) which route to
 * show, for screenshots on a simulator (src/dev/useVerifyHarness.ts).
 *
 *   node scripts/verify-route.mjs serve          keep the answer on :8099
 *   node scripts/verify-route.mjs /spot/inch     change it (the server reads the file)
 */
import { createServer } from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const file = join(tmpdir(), "wingfoil-verify-route");
const [arg] = process.argv.slice(2);

if (arg === "serve") {
  createServer((req, res) => {
    let route = "/";
    try {
      route = readFileSync(file, "utf8");
    } catch {}
    res.writeHead(200, { "content-type": "text/plain", "cache-control": "no-store" });
    res.end(route);
  }).listen(8099, "127.0.0.1", () => console.log("verify: serving the route on :8099"));
} else if (arg) {
  writeFileSync(file, arg);
  console.log(`verify: route ${arg}`);
} else {
  console.error("usage: verify-route.mjs serve | <route>");
  process.exit(1);
}
