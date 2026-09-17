/**
 * One small interface over "who is signed in", so the pages never import
 * Clerk directly. Three providers stand behind it:
 *
 * - Clerk, when VITE_CLERK_PUBLISHABLE_KEY is set (production).
 * - A fixed dev identity, when VITE_MARKET_DEV_USER is set and the API runs
 *   with MARKET_AUTH_MODE=dev. No Clerk account needed to develop.
 * - Nobody, when neither is set: the marketplace is read-only and says so.
 */
import { ClerkProvider, useAuth, useClerk, useUser } from "@clerk/clerk-react";
import { createContext, useContext, useMemo, type ReactNode } from "react";
import { BASE } from "./router";

export interface MarketAuth {
  provider: "clerk" | "dev" | "none";
  /** False until the provider knows whether there is a session. */
  loaded: boolean;
  signedIn: boolean;
  userId: string | null;
  /** What the identity provider knows, for prefilling a new profile. */
  identity: { name: string | null; email: string | null };
  getToken(): Promise<string | null>;
  signIn(): void;
  signOut(): Promise<void>;
}

const none: MarketAuth = {
  provider: "none",
  loaded: true,
  signedIn: false,
  userId: null,
  identity: { name: null, email: null },
  getToken: async () => null,
  signIn: () => {},
  signOut: async () => {},
};

const Ctx = createContext<MarketAuth>(none);

export const useMarketAuth = () => useContext(Ctx);

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  string | undefined;
const devUser = import.meta.env.VITE_MARKET_DEV_USER as string | undefined;

export function MarketAuthProvider({ children }: { children: ReactNode }) {
  if (publishableKey) {
    return (
      <ClerkProvider
        publishableKey={publishableKey}
        afterSignOutUrl={BASE}
        signInFallbackRedirectUrl={BASE}
      >
        <ClerkBridge>{children}</ClerkBridge>
      </ClerkProvider>
    );
  }
  if (devUser)
    return <Ctx.Provider value={devAuth(devUser)}>{children}</Ctx.Provider>;
  return <Ctx.Provider value={none}>{children}</Ctx.Provider>;
}

function devAuth(name: string): MarketAuth {
  return {
    provider: "dev",
    loaded: true,
    signedIn: true,
    userId: `dev_${name}`,
    identity: { name, email: `${name}@example.com` },
    getToken: async () => `dev:${name}`,
    signIn: () => {},
    signOut: async () => {},
  };
}

function ClerkBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();
  const value = useMemo<MarketAuth>(
    () => ({
      provider: "clerk",
      loaded: isLoaded,
      signedIn: Boolean(isSignedIn),
      userId: userId ?? null,
      identity: {
        name: user?.fullName ?? user?.firstName ?? user?.username ?? null,
        email: user?.primaryEmailAddress?.emailAddress ?? null,
      },
      getToken: () => getToken(),
      signIn: () =>
        clerk.openSignIn({
          fallbackRedirectUrl: location.pathname + location.search,
        }),
      signOut: () => signOut({ redirectUrl: BASE }),
    }),
    [isLoaded, isSignedIn, userId, user, getToken, clerk, signOut],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
