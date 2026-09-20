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

/** The first of `candidates` that exists: an env override, then src/, then dist/. */
function firstExisting(candidates: (string | undefined)[]): string {
  const given = candidates.filter((c): c is string => Boolean(c));
  return given.find((c) => existsSync(c)) ?? given[0];
}

const here = dirname(fileURLToPath(import.meta.url));

/** market/api/migrations, whether this file runs from src/ or from dist/market/api/src/. */
const MIGRATIONS_DIR = firstExisting([
  process.env.MARKET_MIGRATIONS_DIR,
  join(here, "..", "migrations"),
  join(here, "..", "..", "..", "..", "migrations"),
]);

/** community/api/migrations, found from the same two places. */
export const COMMUNITY_MIGRATIONS_DIR = firstExisting([
  process.env.COMMUNITY_MIGRATIONS_DIR,
  join(here, "..", "..", "..", "community", "api", "migrations"),
  join(
    here,
    "..",
    "..",
    "..",
    "..",
    "..",
    "..",
    "community",
    "api",
    "migrations",
  ),
]);

export const MARKET_LEDGER = "market_migrations";
export const COMMUNITY_LEDGER = "community_migrations";

/**
 * Apply every *.sql file in `dir` not yet recorded in the `ledger` table, in
 * filename order, all inside one transaction. Safe to run on every boot: a
 * second run is a no-op, and two instances booting together serialise on an
 * advisory lock. Each section of the site keeps its own directory and ledger;
 * they share the lock, so their migrations never interleave.
 */
export async function migrate(
  sql: Db,
  dir = MIGRATIONS_DIR,
  ledger = MARKET_LEDGER,
): Promise<string[]> {
  if (!/^[a-z_][a-z0-9_]*$/.test(ledger))
    throw new Error(`Not a ledger table name: ${ledger}`);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const ran: string[] = [];
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(7205759403792793)`;
    // The ledger is made and read under the lock: whoever waited here sees
    // what the winner applied, and two boots never race to create the table.
    await tx`create table if not exists ${tx(ledger)} (
      name text primary key,
      applied_at timestamptz not null default now()
    )`;
    const applied = new Set(
      (await tx<{ name: string }[]>`select name from ${tx(ledger)}`).map(
        (r) => r.name,
      ),
    );
    for (const file of files) {
      if (applied.has(file)) continue;
      await tx.unsafe(readFileSync(join(dir, file), "utf8"));
      await tx`insert into ${tx(ledger)} (name) values (${file})`;
      ran.push(file);
    }
  });
  return ran;
}
