/**
 * One small interface over "who is signed in", so the pages never import
 * Clerk directly. Three providers stand behind it:
 *
 * - Clerk, when VITE_CLERK_PUBLISHABLE_KEY is set (production).
 * - A fixed dev identity, when VITE_MARKET_DEV_USER is set and the API runs
 *   with MARKET_AUTH_MODE=dev. No Clerk account needed to develop. A build
 *   made with VITE_MARKET_DEV_SWITCH reads the name from the browser instead
 *   (`devUserNow`), which is how the e2e suite is several people on one build.
 * - Nobody, when neither is set: the section is read-only and says so.
 *
 * Every section of the site (the marketplace, the community) mounts the one
 * provider and reads the one hook, so a session means the same thing in each.
 */
import { ClerkProvider, useAuth, useClerk, useUser } from "@clerk/clerk-react";
import { createContext, useContext, useMemo, type ReactNode } from "react";

export interface SiteAuth {
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

const none: SiteAuth = {
  provider: "none",
  loaded: true,
  signedIn: false,
  userId: null,
  identity: { name: null, email: null },
  getToken: async () => null,
  signIn: () => {},
  signOut: async () => {},
};

const Ctx = createContext<SiteAuth>(none);

export const useSiteAuth = () => useContext(Ctx);

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as
  string | undefined;
const devUser = import.meta.env.VITE_MARKET_DEV_USER as string | undefined;
const devSwitch = Boolean(import.meta.env.VITE_MARKET_DEV_SWITCH);

/** Where a build made with VITE_MARKET_DEV_SWITCH keeps who is signed in. */
export const DEV_USER_KEY = "wingfoil:dev-user";

/**
 * The dev identity is one name a build, and a browser test needs several
 * people, and nobody, on the one build. So a build that asked for it reads the
 * name from localStorage on each load: a name the API's dev mode would take, or
 * nothing there for the build's own. It is a dev identity either way: the API
 * refuses `dev:` tokens in production, and a Clerk build never gets here.
 */
function devUserNow(): string | undefined {
  if (!devSwitch) return devUser;
  try {
    const kept = localStorage.getItem(DEV_USER_KEY);
    return kept && /^[A-Za-z0-9_-]{1,64}$/.test(kept) ? kept : devUser;
  } catch {
    return devUser;
  }
}

/** `home` is the section's own root (`/market`), where a sign-out lands. */
export function SiteAuthProvider({
  home,
  children,
}: {
  home: string;
  children: ReactNode;
}) {
  if (publishableKey) {
    return (
      <ClerkProvider
        publishableKey={publishableKey}
        afterSignOutUrl={home}
        signInFallbackRedirectUrl={home}
      >
        <ClerkBridge home={home}>{children}</ClerkBridge>
      </ClerkProvider>
    );
  }
  return <DevOrNobody>{children}</DevOrNobody>;
}

function DevOrNobody({ children }: { children: ReactNode }) {
  // Once for the page: a new identity on every render would be a new session.
  const value = useMemo(() => {
    const name = devUserNow();
    return name ? devAuth(name) : none;
  }, []);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

function devAuth(name: string): SiteAuth {
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

function ClerkBridge({
  home,
  children,
}: {
  home: string;
  children: ReactNode;
}) {
  const { isLoaded, isSignedIn, userId, getToken, signOut } = useAuth();
  const { user } = useUser();
  const clerk = useClerk();
  const value = useMemo<SiteAuth>(
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
      signOut: () => signOut({ redirectUrl: home }),
    }),
    [isLoaded, isSignedIn, userId, user, getToken, clerk, signOut, home],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
