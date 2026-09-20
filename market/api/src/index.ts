import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { clerkVerifier, devVerifier } from "./auth.js";
import {
  COMMUNITY_LEDGER,
  COMMUNITY_MIGRATIONS_DIR,
  connect,
  migrate,
} from "./db.js";
import { loadConfig } from "./env.js";
import { memoryRepo } from "./repo-memory.js";
import { pgRepo } from "./repo-pg.js";
import { localStorage, s3Storage } from "./storage.js";
import { clerkIdentity, devIdentity } from "../../../site/api/identity.js";
import { memoryUsersRepo } from "../../../site/api/repo-memory.js";
import { pgUsersRepo } from "../../../site/api/repo-pg.js";

async function main() {
  const config = loadConfig();

  let repo, users;
  if (config.db.mode === "postgres") {
    const sql = connect(config.db.url!);
    const ran = await migrate(sql);
    if (ran.length) console.log(`market: applied migrations ${ran.join(", ")}`);
    // After the marketplace's: the community's tables reference `users`.
    const ranCommunity = await migrate(
      sql,
      COMMUNITY_MIGRATIONS_DIR,
      COMMUNITY_LEDGER,
    );
    if (ranCommunity.length)
      console.log(`community: applied migrations ${ranCommunity.join(", ")}`);
    repo = pgRepo(sql);
    users = pgUsersRepo(sql);
  } else {
    console.warn(
      "market: MARKET_DB=memory, listings will not survive a restart",
    );
    const memoryUsers = memoryUsersRepo();
    repo = memoryRepo(memoryUsers);
    users = memoryUsers;
  }

  const verify =
    config.auth.mode === "clerk" ? clerkVerifier(config.auth) : devVerifier();
  if (config.auth.mode === "dev")
    console.warn("market: MARKET_AUTH_MODE=dev, accepting 'Bearer dev:<name>'");

  const storage =
    config.storage.mode === "s3"
      ? s3Storage(config.storage)
      : localStorage(config.storage, config.publicUrl);

  const identity =
    config.auth.mode === "clerk"
      ? clerkIdentity(config.auth.clerkSecretKey)
      : devIdentity();

  const app = createApp({
    repo,
    people: { users, identity },
    verify,
    storage,
    storagePrefix: config.storage.prefix,
    corsOrigins: config.corsOrigins,
    authMode: config.auth.mode,
  });

  const server = serve(
    { fetch: app.fetch, port: config.port, hostname: "0.0.0.0" },
    (info) => {
      console.log(
        `market: listening on http://${info.address}:${info.port} ` +
          `(db=${config.db.mode}, auth=${config.auth.mode}, storage=${config.storage.mode})`,
      );
    },
  );

  const shutdown = async (signal: string) => {
    console.log(`market: ${signal}, shutting down`);
    server.close();
    await repo.close();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
