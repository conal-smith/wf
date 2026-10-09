/**
 * Configuration, read once from the environment and validated up front so a
 * misconfigured service fails at boot rather than on the first request.
 */
import { isPriced } from "../../../companion/api/budget.js";

export type AuthMode = "clerk" | "dev";
export type StorageMode = "s3" | "local";
export type DbMode = "postgres" | "memory";
export type CompanionEffort = "low" | "medium" | "high" | "xhigh" | "max";
const EFFORTS: readonly CompanionEffort[] = [
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/**
 * The parts of the site that are switched on. Each is off unless its variable
 * is "1" (FEATURE_GUST, FEATURE_MARKET, FEATURE_COMMUNITY); the website has
 * the same switches at build time (VITE_FEATURE_*, shared/web/features.ts).
 */
export interface Features {
  gust: boolean;
  market: boolean;
  community: boolean;
}

export interface Config {
  port: number;
  production: boolean;
  publicUrl: string;
  corsOrigins: string[] | "*";
  /**
   * The site root the MCP endpoint reads published forecasts from
   * (FORECAST_BASE_URL, e.g. https://wingfoil.ie/). Null reads the checkout's
   * `public/` in development and leaves /api/mcp off in production.
   */
  forecastBaseUrl: string | null;
  features: Features;
  /**
   * Gust, the in-app companion (companion/api). With no API key and no fake it
   * is asleep: /api/companion/chat answers 503 not_configured.
   */
  companion: {
    apiKey: string | null;
    model: string;
    /** output_config.effort per model call; low keeps a chat quick. */
    effort: CompanionEffort;
    /** The scripted fake model (COMPANION_FAKE=1): development and e2e only. */
    fake: boolean;
    /**
     * US dollars Gust may spend a calendar month (COMPANION_MONTHLY_BUDGET_USD).
     * Required with a real key; null only for the fake.
     */
    monthlyBudgetUsd: number | null;
  };
  db: { mode: DbMode; url: string | null };
  auth: {
    mode: AuthMode;
    clerkSecretKey: string | null;
    clerkJwtKey: string | null;
    authorizedParties: string[];
  };
  storage: {
    mode: StorageMode;
    prefix: string;
    s3: {
      bucket: string | null;
      region: string;
      endpoint: string | null;
      publicBaseUrl: string | null;
      forcePathStyle: boolean;
    };
    local: { dir: string; secret: string };
  };
}

function list(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const production = env.NODE_ENV === "production";
  const port = Number(env.PORT ?? 8787);
  const publicUrl = (
    env.MARKET_PUBLIC_URL ?? `http://127.0.0.1:${port}`
  ).replace(/\/$/, "");

  const dbMode: DbMode = env.MARKET_DB === "memory" ? "memory" : "postgres";
  const dbUrl = env.DATABASE_URL ?? null;
  if (dbMode === "postgres" && !dbUrl) {
    throw new Error(
      "DATABASE_URL is required (or set MARKET_DB=memory for a throwaway in-memory store)",
    );
  }
  if (dbMode === "memory" && production) {
    throw new Error(
      "MARKET_DB=memory loses every listing on restart and is refused in production",
    );
  }

  const authMode: AuthMode = env.MARKET_AUTH_MODE === "dev" ? "dev" : "clerk";
  if (authMode === "dev" && production) {
    throw new Error(
      "MARKET_AUTH_MODE=dev accepts unsigned identities and is refused in production",
    );
  }
  const clerkSecretKey = env.CLERK_SECRET_KEY ?? null;
  const clerkJwtKey = env.CLERK_JWT_KEY ?? null;
  if (authMode === "clerk" && !clerkSecretKey && !clerkJwtKey) {
    throw new Error(
      "CLERK_SECRET_KEY (or CLERK_JWT_KEY) is required unless MARKET_AUTH_MODE=dev",
    );
  }

  const storageMode: StorageMode =
    env.MARKET_STORAGE === "local" ? "local" : "s3";
  const bucket = env.MARKET_S3_BUCKET ?? null;
  if (storageMode === "s3" && !bucket) {
    throw new Error("MARKET_S3_BUCKET is required unless MARKET_STORAGE=local");
  }

  const corsList = list(env.MARKET_CORS_ORIGINS);
  const corsOrigins: string[] | "*" = corsList.length
    ? corsList
    : production
      ? []
      : "*";
  if (production && corsOrigins.length === 0) {
    throw new Error(
      "MARKET_CORS_ORIGINS must name the website origin(s) in production",
    );
  }

  const forecastBaseUrl = env.FORECAST_BASE_URL?.trim() || null;
  if (forecastBaseUrl && !/^https?:\/\//.test(forecastBaseUrl)) {
    throw new Error("FORECAST_BASE_URL must be an http(s) URL");
  }

  const companionFake = env.COMPANION_FAKE === "1";
  if (companionFake && production) {
    throw new Error(
      "COMPANION_FAKE answers with a scripted model and is refused in production",
    );
  }
  const effort = (env.COMPANION_EFFORT?.trim() || "low") as CompanionEffort;
  if (!EFFORTS.includes(effort)) {
    throw new Error(`COMPANION_EFFORT must be one of ${EFFORTS.join(", ")}`);
  }

  const features: Features = {
    gust: env.FEATURE_GUST === "1",
    market: env.FEATURE_MARKET === "1",
    community: env.FEATURE_COMMUNITY === "1",
  };

  const apiKey = env.ANTHROPIC_API_KEY?.trim() || null;
  const model = env.COMPANION_MODEL?.trim() || "claude-haiku-5-5";
  const budgetText = env.COMPANION_MONTHLY_BUDGET_USD?.trim();
  const monthlyBudgetUsd = budgetText ? Number(budgetText) : null;
  if (
    monthlyBudgetUsd !== null &&
    !(Number.isFinite(monthlyBudgetUsd) && monthlyBudgetUsd >= 0)
  ) {
    throw new Error(
      "COMPANION_MONTHLY_BUDGET_USD must be a number of US dollars, e.g. 200",
    );
  }
  // A real key spends real money: Gust does not wake on one without a cap he
  // can keep to.
  if (features.gust && apiKey && !companionFake) {
    if (monthlyBudgetUsd === null)
      throw new Error(
        "COMPANION_MONTHLY_BUDGET_USD is required when FEATURE_GUST=1 with an ANTHROPIC_API_KEY",
      );
    if (!isPriced(model))
      throw new Error(
        `COMPANION_MODEL ${model} has no price in companion/api/budget.ts, so its spend cannot be capped`,
      );
  }

  return {
    port,
    production,
    publicUrl,
    corsOrigins,
    forecastBaseUrl,
    features,
    companion: {
      apiKey,
      model,
      effort,
      fake: companionFake,
      monthlyBudgetUsd,
    },
    db: { mode: dbMode, url: dbUrl },
    auth: {
      mode: authMode,
      clerkSecretKey,
      clerkJwtKey,
      authorizedParties: list(env.CLERK_AUTHORIZED_PARTIES),
    },
    storage: {
      mode: storageMode,
      prefix: (env.MARKET_S3_PREFIX ?? "market").replace(/^\/|\/$/g, ""),
      s3: {
        bucket,
        region: env.MARKET_S3_REGION ?? env.AWS_REGION ?? "auto",
        endpoint: env.MARKET_S3_ENDPOINT ?? null,
        publicBaseUrl:
          (env.MARKET_S3_PUBLIC_BASE_URL ?? null)?.replace(/\/$/, "") ?? null,
        forcePathStyle: env.MARKET_S3_FORCE_PATH_STYLE === "true",
      },
      local: {
        dir: env.MARKET_UPLOAD_DIR ?? ".cache/market-uploads",
        secret: env.MARKET_UPLOAD_SECRET ?? "",
      },
    },
  };
}
