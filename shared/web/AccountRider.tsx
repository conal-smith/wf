/**
 * The account's side of the rider, for the pages that have no sign-in of
 * their own (the map, the spot pages, How the stars work): the site's auth
 * provider with nothing in it but RiderSync. Loaded on its own, and only on
 * a device that has signed in before (riderSync.ts `signedInHint`), so a
 * reader who never signs in never downloads the identity provider.
 */
import { SiteAuthProvider } from "./auth";
import { RiderSync } from "./useRiderSync";

export default function AccountRider() {
  return (
    <SiteAuthProvider home="/">
      <RiderSync />
    </SiteAuthProvider>
  );
}
