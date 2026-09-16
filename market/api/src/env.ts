/**
 * Configuration, read once from the environment and validated up front so a
 * misconfigured service fails at boot rather than on the first request.
 */

export type AuthMode = "clerk" | "dev";
export type StorageMode = "s3" | "local";
export type DbMode = "postgres" | "memory";

export interface Config {
  port: number;
  production: boolean;
  publicUrl: string;
  corsOrigins: string[] | "*";
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

  return {
    port,
    production,
    publicUrl,
    corsOrigins,
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
