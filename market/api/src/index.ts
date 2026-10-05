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
import { dirSource, httpSource } from "../../../mcp/api/source.js";
import { anthropicClient } from "../../../companion/api/agent.js";
import { fakeClient } from "../../../companion/api/fake.js";
import { memoryHub, pgHub } from "../../../community/api/hub.js";
import { memoryRepo as memoryCommunityRepo } from "../../../community/api/repo-memory.js";
import { pgRepo as pgCommunityRepo } from "../../../community/api/repo-pg.js";
import { clerkIdentity, devIdentity } from "../../../site/api/identity.js";
import { memoryUsersRepo } from "../../../site/api/repo-memory.js";
import { pgUsersRepo } from "../../../site/api/repo-pg.js";

async function main() {
  const config = loadConfig();

  let repo, community, users, hub;
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
    community = pgCommunityRepo(sql);
    users = pgUsersRepo(sql);
    // A client of its own: the LISTEN keeps a connection for good, and the
    // pool above has five for every query the API makes.
    hub = await pgHub(connect(config.db.url!), sql);
  } else {
    console.warn(
      "market: MARKET_DB=memory, listings and threads will not survive a restart",
    );
    const memoryUsers = memoryUsersRepo();
    repo = memoryRepo(memoryUsers);
    community = memoryCommunityRepo(memoryUsers);
    users = memoryUsers;
    hub = memoryHub();
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

  // The MCP endpoint reads the forecast the site publishes. In development
  // that is the checkout's public/, the same files Vite serves the map.
  const forecast = config.forecastBaseUrl
    ? httpSource(config.forecastBaseUrl)
    : config.production
      ? undefined
      : dirSource("public");
  if (!forecast)
    console.warn("market: FORECAST_BASE_URL is not set, /api/mcp is off");

  // Gust: the Claude API with a key, the scripted fake in development when
  // asked for, and otherwise asleep (503 not_configured, never a fake answer).
  const { companion } = config;
  const companionClient = companion.fake
    ? fakeClient()
    : companion.apiKey
      ? anthropicClient(companion.apiKey)
      : null;
  if (companion.fake)
    console.warn("market: COMPANION_FAKE=1, Gust answers from a script");
  else if (!companionClient)
    console.warn("market: ANTHROPIC_API_KEY is not set, Gust is asleep");

  const app = createApp({
    repo,
    community,
    people: { users, identity },
    verify,
    storage,
    storagePrefix: config.storage.prefix,
    corsOrigins: config.corsOrigins,
    authMode: config.auth.mode,
    hub,
    forecast,
    companion: {
      client: companionClient,
      model: companion.model,
      effort: companion.effort,
      fake: companion.fake,
      trustClientClock: companion.fake,
    },
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
    // On Postgres both repos close the one pool, which ends once. The hub
    // ends its own listening connection.
    await Promise.all([repo.close(), community.close(), hub.close()]);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
