/**
 * The rider the account keeps: the repo's contract, against the memory repo
 * always and against Postgres when DATABASE_URL is set (npm run market:db),
 * in a schema of its own made by the real migrations and dropped afterwards;
 * and the two routes, GET and PUT /api/me/rider.
 *
 *   DATABASE_URL=postgres://market:market@127.0.0.1:55432/market npm test
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { oursCopy, type CustomRating } from "../../force5/src/stars";
import { migrate, type Db } from "../../market/api/src/db";
import { newId } from "../../market/api/src/ids";
import { createApp } from "../../market/api/src/app";
import { devVerifier } from "../../market/api/src/auth";
import { memoryRepo } from "../../market/api/src/repo-memory";
import { memoryRepo as memoryCommunityRepo } from "../../community/api/repo-memory";
import { devIdentity } from "./identity";
import { memoryUsersRepo } from "./repo-memory";
import { pgUsersRepo } from "./repo-pg";
import type { UsersRepo } from "./repo";
import { memoryRidersRepo, type RidersRepo } from "./riders";
import { pgRidersRepo } from "./riders-pg";
import type { RiderProfile } from "../shared/rider";

const OWN: CustomRating = {
  ...oursCopy(),
  wind: { min: 9, sweetLow: 13, sweetHigh: 26, max: 35 },
};
const OTHER: CustomRating = {
  ...OWN,
  direction: { ...OWN.direction, crossOff: 2 },
};
/** A rating as a device from before 25 October 2026 wrote it: version 2, made from a level. */
const OLD = {
  version: 2,
  base: "advanced",
  wind: { min: 9, sweetLow: 13, sweetHigh: 26, max: 35 },
  direction: { onshore: 0.5, crossOn: 0, cross: 0, crossOff: 1, offshore: 3 },
};

function contract(
  name: string,
  make: () => Promise<{ users: UsersRepo; riders: RidersRepo }>,
) {
  describe(name, () => {
    let users: UsersRepo;
    let riders: RidersRepo;
    let n = 0;
    const someone = async () => {
      const id = `dev_rider${++n}_${newId().slice(0, 6).toLowerCase()}`;
      await users.insertUser({
        id,
        handle: id.replace(/_/g, "-").slice(0, 30),
        displayName: "Rider",
        avatarUrl: null,
      });
      return id;
    };
    beforeAll(async () => {
      ({ users, riders } = await make());
    });

    it("keeps nothing until the rider sets something", async () => {
      expect(await riders.get(await someone())).toEqual({
        customStars: null,
        updatedAt: null,
      });
    });

    it("keeps a rating, and a reset, each when newer", async () => {
      const id = await someone();
      const at = "2026-10-18T10:00:00.000Z";
      expect(await riders.put(id, { customStars: OWN, updatedAt: at })).toEqual(
        { customStars: OWN, updatedAt: at },
      );
      const reset = "2026-10-18T11:00:00.000Z";
      expect(
        await riders.put(id, {
          customStars: null,
          updatedAt: reset,
        }),
      ).toEqual({ customStars: null, updatedAt: reset });
      expect(await riders.get(id)).toEqual({
        customStars: null,
        updatedAt: reset,
      });
    });

    it("lets the newer copy stand against an older write", async () => {
      const id = await someone();
      await riders.put(id, {
        customStars: OWN,
        updatedAt: "2026-10-18T12:00:00.000Z",
      });
      const stale = await riders.put(id, {
        customStars: OTHER,
        updatedAt: "2026-10-18T09:00:00.000Z",
      });
      expect(stale).toEqual({
        customStars: OWN,
        updatedAt: "2026-10-18T12:00:00.000Z",
      });
      // The same moment again is not newer either.
      expect(
        (
          await riders.put(id, {
            customStars: OTHER,
            updatedAt: "2026-10-18T12:00:00.000Z",
          })
        ).customStars,
      ).toEqual(OWN);
    });

    it("keeps each rider's own", async () => {
      const a = await someone();
      const b = await someone();
      const at = "2026-10-18T10:00:00.000Z";
      await riders.put(a, { customStars: OWN, updatedAt: at });
      await riders.put(b, { customStars: OTHER, updatedAt: at });
      expect((await riders.get(a)).customStars).toEqual(OWN);
      expect((await riders.get(b)).customStars).toEqual(OTHER);
    });
  });
}

contract("memory repo", async () => {
  const users = memoryUsersRepo();
  return { users, riders: memoryRidersRepo(users) };
});

const url = process.env.DATABASE_URL;

describe.skipIf(!url)("Postgres", () => {
  const schema = `rider_test_${newId()}`.toLowerCase();
  let sql: Db;

  beforeAll(async () => {
    sql = postgres(url!, {
      max: 4,
      onnotice: () => {},
      connection: { search_path: schema },
    });
    await sql`create schema ${sql(schema)}`;
    await migrate(sql);
  }, 60_000);

  afterAll(async () => {
    await sql`drop schema ${sql(schema)} cascade`;
    await sql.end({ timeout: 5 });
  });

  contract("Postgres repo", async () => ({
    users: pgUsersRepo(sql),
    riders: pgRidersRepo(sql),
  }));

  it("reads a rating kept from before version 3, or kept aside for a level, as none", async () => {
    const users = pgUsersRepo(sql);
    const riders = pgRidersRepo(sql);
    const id = "dev_old_rating";
    await users.insertUser({
      id,
      handle: "old-rating",
      displayName: "Old rating",
      avatarUrl: null,
    });
    await sql`
      insert into rider_profiles (user_id, custom_stars, kept_stars, updated_at)
      values (${id}, ${sql.json(OLD)}, ${sql.json(OLD)}, '2026-10-18T10:00:00Z')`;
    expect(await riders.get(id)).toEqual({
      customStars: null,
      updatedAt: "2026-10-18T10:00:00.000Z",
    });
  });

  it("goes with the person", async () => {
    const users = pgUsersRepo(sql);
    const riders = pgRidersRepo(sql);
    const id = "dev_leaving";
    await users.insertUser({
      id,
      handle: "leaving",
      displayName: "Leaving",
      avatarUrl: null,
    });
    await riders.put(id, {
      customStars: OWN,
      updatedAt: "2026-10-18T10:00:00.000Z",
    });
    await sql`delete from users where id = ${id}`;
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from rider_profiles where user_id = ${id}`;
    expect(n).toBe(0);
  });
});

describe("GET and PUT /api/me/rider", () => {
  const users = memoryUsersRepo();
  const app = createApp({
    repo: memoryRepo(users),
    community: memoryCommunityRepo(users),
    people: { users, identity: devIdentity() },
    // No route here uploads anything.
    storage: {} as never,
    verify: devVerifier(),
    storagePrefix: "market",
    corsOrigins: "*",
    authMode: "dev",
  });
  const call = async (method: string, body?: unknown, user = "aoife") => {
    const res = await app.request("/api/me/rider", {
      method,
      headers: {
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...(user ? { Authorization: `Bearer dev:${user}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  };

  it("is for a signed-in rider only", async () => {
    expect((await call("GET", undefined, "")).status).toBe(401);
    expect(
      (
        await call(
          "PUT",
          { customStars: null, updatedAt: new Date().toISOString() },
          "",
        )
      ).status,
    ).toBe(401);
  });

  it("answers nothing kept for a new rider, making their row", async () => {
    const res = await call("GET", undefined, "niamh");
    expect(res).toEqual({
      status: 200,
      body: { customStars: null, updatedAt: null },
    });
    expect(await users.getUser("dev_niamh")).not.toBeNull();
  });

  it("keeps the newer, and answers what it kept", async () => {
    const put = await call("PUT", {
      customStars: OWN,
      updatedAt: "2026-10-18T10:00:00.000Z",
    });
    expect(put.status).toBe(200);
    expect(put.body as RiderProfile).toEqual({
      customStars: OWN,
      updatedAt: "2026-10-18T10:00:00.000Z",
    });
    const older = await call("PUT", {
      customStars: null,
      updatedAt: "2026-10-18T09:00:00.000Z",
    });
    expect(older.body.customStars).toEqual(OWN);
    expect((await call("GET")).body.customStars).toEqual(OWN);
  });

  it("clamps the figures, and refuses what is not a star rating", async () => {
    const wild = {
      ...OWN,
      wind: { min: 30, sweetLow: 20, sweetHigh: 10, max: 5 },
    };
    const put = await call(
      "PUT",
      { customStars: wild, updatedAt: "2026-10-18T11:00:00.000Z" },
      "ciara",
    );
    expect(put.body.customStars.wind).toEqual({
      min: 30,
      sweetLow: 31,
      sweetHigh: 32,
      max: 33,
    });
    // Offshore is never, whatever was sent.
    expect(put.body.customStars.direction.offshore).toBe(5);
    for (const body of [
      { customStars: "five stars", updatedAt: "2026-10-18T12:00:00Z" },
      { customStars: OWN, updatedAt: "yesterday" },
      { customStars: OWN },
    ])
      expect((await call("PUT", body, "ciara")).status).toBe(400);
  });

  it("takes what a page from before 25 October 2026 sends, and lets its old rating go", async () => {
    const at = (h: number) => `2026-10-18T${h}:00:00.000Z`;
    await call("PUT", { customStars: OWN, updatedAt: at(10) }, "eoin");
    // Its version 2 rating, made from a level, and one kept aside: not
    // refused, but not kept either, so the newer rating made since stands.
    const old = await call(
      "PUT",
      { customStars: OLD, keptStars: OLD, updatedAt: at(11) },
      "eoin",
    );
    expect(old).toEqual({
      status: 200,
      body: { customStars: OWN, updatedAt: at(10) },
    });
    // A rating of its own kept aside while a level rated is dropped, and
    // its null is the reset it always was.
    const level = await call(
      "PUT",
      { customStars: null, keptStars: OLD, updatedAt: at(12) },
      "eoin",
    );
    expect(level).toEqual({
      status: 200,
      body: { customStars: null, updatedAt: at(12) },
    });
    // And `keptStars` beside a rating that reads is dropped.
    const both = await call(
      "PUT",
      { customStars: OTHER, keptStars: OWN, updatedAt: at(13) },
      "eoin",
    );
    expect(both.body).toEqual({ customStars: OTHER, updatedAt: at(13) });
    expect((await call("GET", undefined, "eoin")).body).not.toHaveProperty(
      "keptStars",
    );
  });

  it("takes no write as newer than the moment it arrives", async () => {
    const ahead = new Date(Date.now() + 86_400_000).toISOString();
    const put = await call(
      "PUT",
      { customStars: OWN, updatedAt: ahead },
      "dara",
    );
    expect(Date.parse(put.body.updatedAt)).toBeLessThanOrEqual(Date.now());
    // So a change made a moment later still lands.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const later = await call(
      "PUT",
      {
        customStars: OTHER,
        updatedAt: new Date(Date.now() + 60_000).toISOString(),
      },
      "dara",
    );
    expect(later.body.customStars).toEqual(OTHER);
  });
});
