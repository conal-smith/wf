import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import postgres, { type Sql } from "postgres";

export type Db = Sql;

export function connect(url: string): Db {
  return postgres(url, {
    max: 5,
    idle_timeout: 30,
    connect_timeout: 10,
    // Railway's public proxy needs TLS; the private network does not, and
    // the URL tells us which one we were given.
    ssl: /railway\.app|rlwy\.net|sslmode=require/.test(url)
      ? "require"
      : undefined,
    onnotice: () => {},
  });
}

/** market/api/migrations, whether this file runs from src/ or from dist/api/src/. */
const MIGRATIONS_DIR = (() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.MARKET_MIGRATIONS_DIR,
    join(here, "..", "migrations"),
    join(here, "..", "..", "..", "migrations"),
  ].filter((c): c is string => Boolean(c));
  return candidates.find((c) => existsSync(c)) ?? candidates[0];
})();

/**
 * Apply every migrations/*.sql file not yet recorded, in filename order, each
 * inside its own transaction. Safe to run on every boot: a second run is a
 * no-op, and two instances booting together serialise on an advisory lock.
 */
export async function migrate(
  sql: Db,
  dir = MIGRATIONS_DIR,
): Promise<string[]> {
  await sql`create table if not exists market_migrations (
    name text primary key,
    applied_at timestamptz not null default now()
  )`;
  const applied = new Set(
    (await sql<{ name: string }[]>`select name from market_migrations`).map(
      (r) => r.name,
    ),
  );
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const ran: string[] = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(7205759403792793)`;
    for (const file of files) {
      if (applied.has(file)) continue;
      await tx.unsafe(readFileSync(join(dir, file), "utf8"));
      await tx`insert into market_migrations (name) values (${file})`;
      ran.push(file);
    }
  });
  return ran;
}
