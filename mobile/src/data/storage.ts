/**
 * A synchronous localStorage, backed by SQLite on the device, installed on
 * globalThis before anything reads it. The site's own stores
 * (force5/src/prefs.ts, shared/web/favourites.ts) then work unchanged, under
 * the same keys, so a rider's settings mean the same thing in both.
 *
 * Imported first by src/app/_layout.tsx.
 */
import "expo-sqlite/localStorage/install";
