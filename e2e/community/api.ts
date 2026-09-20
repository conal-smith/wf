/**
 * The API the community suite runs against: the real app, over the memory
 * repos and dev identities, and nothing else. It is market/api/src/index.ts
 * with the Postgres half left out, so no run of the suite can reach a
 * database, and with the three things a browser test cannot wait for or do
 * over HTTP settled here:
 *
 * - Staff. users.role is written by hand in the database (community-safety
 *   S1) and no route grants it, so the memory users repo is that hand: the one
 *   name in people.ts is staff from their first request.
 * - Age. A member is new for a day: no mentions, no links. Accounts here are
 *   made two days old, so what is left of being new is the three messages, and
 *   the specs post those.
 * - Pace. One message every three seconds is a ceiling for people; a test that
 *   posts its fixtures over HTTP would spend its minute waiting. The limiter
 *   here never refuses. community/api/router.test.ts holds the real one.
 *
 * Everything else a spec needs (threads, replies, follows) it makes over HTTP,
 * as a member would (D23).
 */
import { serve } from "@hono/node-server";
import { createApp } from "../../market/api/src/app.js";
import { devVerifier } from "../../market/api/src/auth.js";
import { loadConfig } from "../../market/api/src/env.js";
import { memoryRepo } from "../../market/api/src/repo-memory.js";
import { localStorage } from "../../market/api/src/storage.js";
import { memoryHub } from "../../community/api/hub.js";
import { memoryRepo as memoryCommunityRepo } from "../../community/api/repo-memory.js";
import { devIdentity } from "../../site/api/identity.js";
import { memoryUsersRepo } from "../../site/api/repo-memory.js";
import { STAFF, userId } from "./people.js";

const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;

function main() {
  const config = loadConfig();
  if (config.db.mode !== "memory" || config.auth.mode !== "dev")
    throw new Error(
      "The e2e API runs on MARKET_DB=memory and MARKET_AUTH_MODE=dev only",
    );

  const users = memoryUsersRepo(() => new Date(Date.now() - TWO_DAYS));
  const hub = memoryHub();
  const app = createApp({
    repo: memoryRepo(users),
    community: memoryCommunityRepo(users),
    people: {
      users: {
        ...users,
        async insertUser(row) {
          const user = await users.insertUser(row);
          // The row the repo keeps, so every later read of it says staff.
          if (user?.id === userId(STAFF)) user.role = "staff";
          return user;
        },
      },
      identity: devIdentity(),
    },
    verify: devVerifier(),
    storage: localStorage(config.storage, config.publicUrl),
    storagePrefix: config.storage.prefix,
    corsOrigins: config.corsOrigins,
    authMode: "dev",
    hub,
    limiter: { take: () => {} },
  });

  const server = serve(
    { fetch: app.fetch, port: config.port, hostname: "127.0.0.1" },
    (info) =>
      console.log(
        `e2e api: listening on http://${info.address}:${info.port} (db=memory, auth=dev)`,
      ),
  );
  const shutdown = () => {
    server.close();
    void hub.close().then(() => process.exit(0));
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main();
