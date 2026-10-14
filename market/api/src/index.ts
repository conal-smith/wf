import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { clerkVerifier, devVerifier } from "./auth.js";
import {
  ALERTS_LEDGER,
  ALERTS_MIGRATIONS_DIR,
  COMMUNITY_LEDGER,
  COMMUNITY_MIGRATIONS_DIR,
  COMPANION_LEDGER,
  COMPANION_MIGRATIONS_DIR,
  connect,
  migrate,
} from "./db.js";
import { loadConfig } from "./env.js";
import { memoryRepo } from "./repo-memory.js";
import { pgRepo } from "./repo-pg.js";
import { localStorage, s3Storage } from "./storage.js";
import { dirSource, httpSource } from "../../../mcp/api/source.js";
import {
  deliver,
  memoryLock,
  startEvaluator,
} from "../../../alerts/api/evaluate.js";
import { expoPush } from "../../../alerts/api/push.js";
import type { AlertsRepo } from "../../../alerts/api/repo.js";
import { memoryAlertsRepo } from "../../../alerts/api/repo-memory.js";
import { pgAlertsRepo, pgEvaluatorLock } from "../../../alerts/api/repo-pg.js";
import { anthropicClient } from "../../../companion/api/agent.js";
import { fakeClient } from "../../../companion/api/fake.js";
import {
  createBudget,
  memoryLedger,
  type UsageLedger,
} from "../../../companion/api/budget.js";
import { pgLedger } from "../../../companion/api/budget-pg.js";
import { memoryHub, pgHub } from "../../../community/api/hub.js";
import { memoryRepo as memoryCommunityRepo } from "../../../community/api/repo-memory.js";
import { pgRepo as pgCommunityRepo } from "../../../community/api/repo-pg.js";
import { clerkIdentity, devIdentity } from "../../../site/api/identity.js";
import { memoryUsersRepo } from "../../../site/api/repo-memory.js";
import { pgUsersRepo } from "../../../site/api/repo-pg.js";

async function main() {
  const config = loadConfig();

  let repo, community, users, hub;
  let ledger: UsageLedger;
  let alertsRepo: AlertsRepo;
  let alertsLock: <T>(work: () => Promise<T>) => Promise<T | null>;
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
    const ranCompanion = await migrate(
      sql,
      COMPANION_MIGRATIONS_DIR,
      COMPANION_LEDGER,
    );
    if (ranCompanion.length)
      console.log(`companion: applied migrations ${ranCompanion.join(", ")}`);
    const ranAlerts = await migrate(sql, ALERTS_MIGRATIONS_DIR, ALERTS_LEDGER);
    if (ranAlerts.length)
      console.log(`alerts: applied migrations ${ranAlerts.join(", ")}`);
    alertsRepo = pgAlertsRepo(sql);
    alertsLock = pgEvaluatorLock(sql);
    ledger = pgLedger(sql);
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
    ledger = memoryLedger();
    alertsRepo = memoryAlertsRepo();
    alertsLock = memoryLock();
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
  // Switched off (FEATURE_GUST unset) he makes no calls whatever is set.
  const { companion, features } = config;
  const companionClient = !features.gust
    ? null
    : companion.fake
      ? fakeClient()
      : companion.apiKey
        ? anthropicClient(companion.apiKey)
        : null;
  if (!features.gust)
    console.warn("market: FEATURE_GUST is not 1, Gust is off");
  else if (companion.fake)
    console.warn("market: COMPANION_FAKE=1, Gust answers from a script");
  else if (!companionClient)
    console.warn("market: ANTHROPIC_API_KEY is not set, Gust is asleep");
  else
    console.log(
      `market: Gust on ${companion.model}, $${companion.monthlyBudgetUsd} a month`,
    );
  if (!features.market)
    console.warn("market: FEATURE_MARKET is not 1, /api/market is off");
  if (!features.community)
    console.warn("market: FEATURE_COMMUNITY is not 1, /api/community is off");

  // Star-condition alerts for the app: rules and devices always served when
  // switched on; evaluated and sent only where ALERTS_EVALUATE=1.
  const alertsDeps = {
    repo: alertsRepo,
    source: forecast ?? null,
    push: expoPush({ accessToken: config.alerts.expoAccessToken }),
  };
  const evaluating = features.alerts && config.alerts.evaluate;
  if (!features.alerts)
    console.warn("market: FEATURE_ALERTS is not 1, /api/alerts is off");
  else if (!evaluating)
    console.warn("market: ALERTS_EVALUATE is not 1, alerts are kept but not sent");
  const stopEvaluator = evaluating
    ? startEvaluator(alertsDeps, { lock: alertsLock })
    : () => {};

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
    features,
    alerts: {
      repo: alertsRepo,
      source: forecast ?? null,
      adminToken: config.alerts.adminToken,
      evaluating,
      // An announcement goes out now rather than at the next pass, from
      // whichever instance received it, under the same lock.
      kick: () =>
        void alertsLock(() => deliver(alertsDeps)).catch((error) =>
          console.error(`alerts: delivery failed: ${String(error)}`),
        ),
    },
    companion: {
      client: companionClient,
      model: companion.model,
      effort: companion.effort,
      fake: companion.fake,
      trustClientClock: companion.fake,
      budget: createBudget({
        monthlyUsd: companion.monthlyBudgetUsd,
        ledger,
        model: companion.model,
      }),
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
    stopEvaluator();
    // On Postgres the repos close the one pool, which ends once. The hub
    // ends its own listening connection.
    await Promise.all([
      repo.close(),
      community.close(),
      hub.close(),
      alertsRepo.close(),
    ]);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
