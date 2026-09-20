import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SiteAuth } from "./auth";

/**
 * The bridge picks its provider from the environment when the module loads,
 * so each case sets the environment and then loads it afresh. The Clerk
 * provider needs a browser and a real key, so its package is stood in for
 * further down; the two providers that need neither are checked as they are,
 * and they are the two the API's dev mode is tested against.
 */

async function authWith(env: {
  clerk?: string;
  devUser?: string;
  /** A build made with VITE_MARKET_DEV_SWITCH, and the name its browser keeps. */
  kept?: string | null;
}) {
  vi.resetModules();
  vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", env.clerk ?? "");
  vi.stubEnv("VITE_MARKET_DEV_USER", env.devUser ?? "");
  vi.stubEnv("VITE_MARKET_DEV_SWITCH", env.kept === undefined ? "" : "1");
  if (env.kept !== undefined)
    vi.stubGlobal("localStorage", { getItem: () => env.kept });
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

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

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

  it("reads the dev identity from the browser on a build that asked to", async () => {
    const auth = await authWith({ kept: "cian" });
    expect(auth.provider).toBe("dev");
    expect(auth.userId).toBe("dev_cian");
    await expect(auth.getToken()).resolves.toBe("dev:cian");
    // Nothing kept is the build's own name, or nobody when it has none.
    expect((await authWith({ kept: null })).provider).toBe("none");
    expect((await authWith({ kept: null, devUser: "ann" })).userId).toBe(
      "dev_ann",
    );
    // A name the API's dev mode would refuse signs nobody in.
    expect((await authWith({ kept: "not a name" })).signedIn).toBe(false);
  });

  it("leaves what the browser keeps alone on a build that did not ask", async () => {
    vi.stubGlobal("localStorage", { getItem: () => "cian" });
    expect((await authWith({})).provider).toBe("none");
    expect((await authWith({ devUser: "ann" })).userId).toBe("dev_ann");
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

/**
 * The identity provider's own package, stood in for: its provider keeps the
 * props it was given and its hooks answer with a signed-in member. What is
 * under test is the bridge's reading of them, and where `home` ends up.
 */
function standInForClerk() {
  const seen = {
    provider: undefined as Record<string, unknown> | undefined,
    signOut: vi.fn(async (_options?: { redirectUrl?: string }) => {}),
  };
  vi.doMock("@clerk/clerk-react", () => ({
    ClerkProvider: ({
      children,
      ...props
    }: {
      children: ReactNode;
      [prop: string]: unknown;
    }) => {
      seen.provider = props;
      return children;
    },
    useAuth: () => ({
      isLoaded: true,
      isSignedIn: true,
      userId: "user_ann",
      getToken: async () => "session-token",
      signOut: seen.signOut,
    }),
    useUser: () => ({
      user: {
        fullName: "Ann Bonny",
        primaryEmailAddress: { emailAddress: "ann@example.com" },
      },
    }),
    useClerk: () => ({ openSignIn: () => {} }),
  }));
  return seen;
}

describe("the bridge over the identity provider", () => {
  afterEach(() => vi.doUnmock("@clerk/clerk-react"));

  it("reads the session, and sends a sign-out to the section's home", async () => {
    const clerk = standInForClerk();
    const auth = await authWith({ clerk: "pk_test_bridge" });
    expect(clerk.provider).toEqual({
      publishableKey: "pk_test_bridge",
      afterSignOutUrl: "/community",
      signInFallbackRedirectUrl: "/community",
    });
    expect(auth.provider).toBe("clerk");
    expect(auth.loaded).toBe(true);
    expect(auth.signedIn).toBe(true);
    expect(auth.userId).toBe("user_ann");
    expect(auth.identity).toEqual({
      name: "Ann Bonny",
      email: "ann@example.com",
    });
    await expect(auth.getToken()).resolves.toBe("session-token");
    await auth.signOut();
    expect(clerk.signOut).toHaveBeenCalledWith({ redirectUrl: "/community" });
  });

  it("is never a dev identity, whatever the build asked and the browser keeps", async () => {
    standInForClerk();
    const auth = await authWith({ clerk: "pk_test_bridge", kept: "cian" });
    expect(auth.provider).toBe("clerk");
    expect(auth.userId).toBe("user_ann");
  });

  it("sends the marketplace's sign-out to /market, as it always did", async () => {
    const clerk = standInForClerk();
    vi.resetModules();
    vi.stubEnv("VITE_CLERK_PUBLISHABLE_KEY", "pk_test_bridge");
    const market = await import("../../market/web/auth");
    let seen: SiteAuth | undefined;
    const Probe = () => {
      seen = market.useMarketAuth();
      return null;
    };
    renderToStaticMarkup(
      createElement(market.MarketAuthProvider, {
        children: createElement(Probe),
      }),
    );
    expect(clerk.provider?.afterSignOutUrl).toBe("/market");
    expect(clerk.provider?.signInFallbackRedirectUrl).toBe("/market");
    await seen!.signOut();
    expect(clerk.signOut).toHaveBeenCalledWith({ redirectUrl: "/market" });
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
