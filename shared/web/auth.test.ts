import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiteAuth } from "./auth";

/**
 * The bridge picks its provider from the environment when the module loads,
 * so each case sets the environment and then loads it afresh. The Clerk
 * provider needs a browser and a real key; the two that need neither are
 * checked here, and they are the two the API's dev mode is tested against.
 */

async function authWith(env: { clerk?: string; devUser?: string }) {
  vi.resetModules();
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", env.clerk ?? "");
  vi.stubEnv("VITE_MARKET_DEV_USER", env.devUser ?? "");
  const { SiteAuthProvider, useSiteAuth } = await import("./auth");
  let seen: SiteAuth | undefined;
  const Probe = () => {
    seen = useSiteAuth();
    return null;
  };
  renderToStaticMarkup(
    createElement(SiteAuthProvider, {
      home: "/community",
      children: createElement(Probe),
    }),
  );
  return seen!;
}

afterEach(() => vi.unstubAllEnvs());

describe("useSiteAuth", () => {
  it("is nobody, loaded and signed out, when nothing is configured", async () => {
    const auth = await authWith({});
    expect(auth.provider).toBe("none");
    expect(auth.loaded).toBe(true);
    expect(auth.signedIn).toBe(false);
    expect(auth.userId).toBeNull();
    expect(auth.identity).toEqual({ name: null, email: null });
    await expect(auth.getToken()).resolves.toBeNull();
  });

  it("is the dev identity, with the token the API's dev mode reads", async () => {
    const auth = await authWith({ devUser: "ann" });
    expect(auth.provider).toBe("dev");
    expect(auth.loaded).toBe(true);
    expect(auth.signedIn).toBe(true);
    expect(auth.userId).toBe("dev_ann");
    expect(auth.identity).toEqual({ name: "ann", email: "ann@example.com" });
    await expect(auth.getToken()).resolves.toBe("dev:ann");
  });

  it("answers outside any provider as nobody, rather than throwing", async () => {
    vi.resetModules();
    const { useSiteAuth } = await import("./auth");
    let seen: SiteAuth | undefined;
    renderToStaticMarkup(
      createElement(() => {
        seen = useSiteAuth();
        return null;
      }),
    );
    expect(seen?.provider).toBe("none");
  });
});

describe("the marketplace's name for it", () => {
  it("is the same hook, so both sections read one session", async () => {
    vi.resetModules();
    const shared = await import("./auth");
    const market = await import("../../market/web/auth");
    expect(market.useMarketAuth).toBe(shared.useSiteAuth);
  });
});
