import { describe, expect, it, vi } from "vitest";
import { clerkIdentity, devIdentity, type IdentityLookup } from "./identity";
import { memoryUsersRepo } from "./repo-memory";
import { isSuspended } from "./router";
import { ensureUser, handleCandidate, slugifyHandle } from "./users";
import { RESERVED_HANDLES, USER_LIMITS } from "../shared/types";
import { handleSchema } from "../shared/validate";

const named =
  (name: string | null, avatarUrl: string | null = null): IdentityLookup =>
  async () => ({ name, avatarUrl });

describe("handles", () => {
  it("slugifies a name into the handle shape", () => {
    expect(slugifyHandle("Aoife K")).toBe("aoife-k");
    expect(slugifyHandle("Siobhán Ní Bhriain")).toBe("siobhan-ni-bhriain");
    expect(slugifyHandle("  --Seán_O'Brien!!  ")).toBe("sean-o-brien");
    expect(slugifyHandle("Al")).toBe("member-al");
    expect(slugifyHandle("李雷")).toBe("member");
    expect(slugifyHandle("")).toBe("member");
  });

  it("always produces something the handle schema accepts", () => {
    for (const name of [
      "Aoife K",
      "x",
      "",
      "A very long name that goes on well past thirty characters",
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaa-b",
    ]) {
      const base = slugifyHandle(name);
      for (const n of [1, 2, 10, 999]) {
        const handle = handleCandidate(base, n);
        expect(handle.length).toBeLessThanOrEqual(USER_LIMITS.handleMax);
        expect(handle).toMatch(/^[a-z0-9-]{3,30}$/);
        expect(handle.endsWith("-")).toBe(false);
      }
    }
    expect(handleCandidate("aoife", 1)).toBe("aoife");
    expect(handleCandidate("aoife", 2)).toBe("aoife-2");
  });

  it("validates a handle someone types: 3-30 of [a-z0-9-], nothing reserved", () => {
    expect(handleSchema.parse("aoife-k")).toBe("aoife-k");
    expect(handleSchema.parse("  Aoife-K ")).toBe("aoife-k");
    expect(handleSchema.parse("a".repeat(30))).toHaveLength(30);
    for (const bad of ["ab", "a".repeat(31), "aoife_k", "aoife.k", "aoífe"])
      expect(handleSchema.safeParse(bad).success, bad).toBe(false);
    for (const reserved of RESERVED_HANDLES)
      expect(handleSchema.safeParse(reserved).success, reserved).toBe(false);
  });
});

describe("ensureUser", () => {
  it("creates the row once, from what the identity provider knows", async () => {
    const users = memoryUsersRepo();
    const identity = vi.fn(named("Aoife K", "https://img.test/aoife.jpg"));
    const first = await ensureUser({ users, identity }, "user_1");
    expect(first).toMatchObject({
      id: "user_1",
      handle: "aoife-k",
      displayName: "Aoife K",
      avatarUrl: "https://img.test/aoife.jpg",
      role: "member",
      contactEmail: null,
      contactPhone: null,
    });

    const second = await ensureUser({ users, identity }, "user_1");
    expect(second).toEqual(first);
    expect(identity).toHaveBeenCalledTimes(1);
  });

  it("adds a numeric suffix when the handle is taken", async () => {
    const users = memoryUsersRepo();
    const people = { users, identity: named("Aoife") };
    expect((await ensureUser(people, "user_1")).handle).toBe("aoife");
    expect((await ensureUser(people, "user_2")).handle).toBe("aoife-2");
    expect((await ensureUser(people, "user_3")).handle).toBe("aoife-3");
  });

  it("never hands out a reserved handle", async () => {
    const users = memoryUsersRepo();
    const made = await ensureUser(
      { users, identity: named("Admin") },
      "user_1",
    );
    expect(made.handle).toBe("admin-2");
    expect(made.displayName).toBe("Admin");
  });

  it("falls back to a placeholder when there is no usable name", async () => {
    const users = memoryUsersRepo();
    const people = { users, identity: named(null) };
    expect(await ensureUser(people, "user_1")).toMatchObject({
      handle: "member",
      displayName: "Member",
    });
    expect((await ensureUser(people, "user_2")).handle).toBe("member-2");
  });

  it("returns the one row when two first requests race", async () => {
    const users = memoryUsersRepo();
    const people = { users, identity: named("Aoife") };
    const [a, b] = await Promise.all([
      ensureUser(people, "user_1"),
      ensureUser(people, "user_1"),
    ]);
    expect(a).toEqual(b);
    expect(a.handle).toBe("aoife");
  });

  it("derives the dev identity from the dev name", async () => {
    const users = memoryUsersRepo();
    const made = await ensureUser(
      { users, identity: devIdentity() },
      "dev_brian",
    );
    expect(made).toMatchObject({ handle: "brian", displayName: "brian" });
  });

  it("has nothing to ask with when only a JWT key is configured", async () => {
    expect(await clerkIdentity(null)("user_1")).toEqual({
      name: null,
      avatarUrl: null,
    });
  });
});

describe("isSuspended", () => {
  it("is true only while suspended_until is in the future", () => {
    const now = Date.parse("2026-09-20T12:00:00Z");
    expect(isSuspended({ suspendedUntil: null }, now)).toBe(false);
    expect(isSuspended({ suspendedUntil: "2026-09-20T11:59:59Z" }, now)).toBe(
      false,
    );
    expect(isSuspended({ suspendedUntil: "2026-09-21T00:00:00Z" }, now)).toBe(
      true,
    );
  });
});
