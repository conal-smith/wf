/**
 * The site's modules are type-checked here too. A few read Vite's
 * import.meta.env (force5/src/urls.ts, force5/src/boot.ts); the app never runs
 * that code (metro.config.js resolves urls.ts to src/config/urls.ts, and boot.ts
 * is the browser's), but tsc reads it, so it is declared.
 */
interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly MODE: string;
  readonly [key: string]: string | undefined;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
