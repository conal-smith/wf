---
type: feature
status: ready
difficulty: m
criticality: high
risk: normal
epic: community-forum
iteration: 1
---

# Install Tailwind 4 and author the Atlantic theme

GOAL: `class="bg-card text-ink rounded-surface"` works in any bundle, from one theme file, with no visual change to existing pages.
STATE:
- No Tailwind in package.json. vite.config.ts has only the React plugin.
- Design values live in design/foundations/tokens.css (generated).
SPEC:
- S1 NEW-DEP tailwindcss@4, @tailwindcss/vite. Plugin registered in vite.config.ts.
- S2 ui/theme.css: @theme with every value below. Imported once from src/main.tsx after src/styles.css.
- S3 No Preflight (D3): import tailwindcss/theme.css and tailwindcss/utilities.css layers only.
- S4 Defaults removed: `--color-*: initial; --text-*: initial; --radius-*: initial; --shadow-*: initial; --font-*: initial`. Spacing base stays 4px.
- S5 Colours (plan 13.1): ground #f4f6fa, sea #9db0cc, card #fff, solid #eef2f9, glass #eef2f9db, sunken #e1e8f3, inverse #0b2545, scrim #0a1f3c73, line #0a1f3c1a, line-strong #7488a6, ink #0a1f3c, ink-2 #1f3a5c, ink-muted #4a607c, ink-disabled #7488a6, ink-inverse #fff, accent #1463ff, accent-hover #0d4fd1, accent-ink #fff, quiet #0b2545, focus #0b2545, ok #3c8a72, warn #854d31, warn-ground #fff4e8, now #a8442e.
- S6 wind-k00..k65: copied verbatim from design/foundations/tokens.css:147-160.
- S7 Type steps as --text-<name> with line-height and weight companions: eyebrow 9/1.5/600 tracking 1.1px, caption 10/1.5, label 11/1.3/600, body 12/1.5, prose 14/1.5, lead 17/1.3/600, title 25/1.3/600 tracking -0.7px, reading 48/1.3.
- S8 Radius: control 12, surface 20, pill 24, dialog 30, full. Shadows: control, marker, surface, dock (plan 13.1 ink). Durations: fast 150ms, base 250ms. z: header 20, panel 15, popover 6, dialog 30. Control heights 30/40/46, touch 44 as named spacing.
- S9 font-sans = "DM Sans", -apple-system, BlinkMacSystemFont, sans-serif. Weights used: 400 500 600 700.
- S10 scripts/lint-ui.mjs + `npm run ui:lint`: fails on `[` arbitrary values in class strings and on colour literals in ui/, market/web, community/web. Honours `ui-lint-allow: <reason>`. Ships with a probe that injects a violation and fails if the lint stays quiet.
DO:
1. Deps, plugin, theme file, import.
2. Lint script, probe, npm script.
3. tsconfig.json:9 include "ui".
TOUCH: package.json, package-lock.json, vite.config.ts, tsconfig.json, src/main.tsx, ui/theme.css, scripts/lint-ui.mjs, tests/ui-theme.test.ts, tests/ui-lint.test.ts.
AVOID: Preflight. tailwind.config.js. Editing design/. Touching any existing class or stylesheet.
GATES: npm run build; npm test; e2e suite unchanged (npm run test:e2e).
ACCEPT:
- [x] A scratch element with `bg-accent text-accent-ink rounded-full h-control-md` renders #1463ff, white, 40px tall in dev.
- [x] `bg-red-500` produces no CSS (defaults removed).
- [x] npm run test:e2e passes with zero snapshot changes.
- [x] npm run ui:lint exits 0; the probe proves it exits non-zero on `p-[13px]`.
REFS: D1 D2 D3 D5 D6. Plan 13.1, 14.
OPEN: S5 names a colour `solid`. `bg-solid` and `text-solid` work, but `border-solid` and `outline-solid` already mean the line style and keep meaning it, so this one colour can never be a border. Fine while it is only a fill; rename it if ui-kit ever wants it as a line.
LOG:
- 2026-09-20 agent: anchors verified before editing: tsconfig.json:9 is the include line; design/foundations/tokens.css:147-160 is the fourteen --sem-color-wind-* lines; package.json had no Tailwind; vite.config.ts had only the React plugin.
- 2026-09-20 agent: installed tailwindcss 4.3.3 and @tailwindcss/vite 4.3.3 as devDependencies, beside vite.
- 2026-09-20 agent: TOUCH grew by tests/ui-theme.test.ts and tests/ui-lint.test.ts, because every S line owes a test and vitest only collects from tests/, src, force5/src and market. The theme test compiles ui/theme.css with the real compiler and asserts on the CSS that comes back.
- 2026-09-20 agent: ui/theme.css scans ui/, market/web and community/web only (source(none) plus three @source lines, the same three directories the lint reads). With automatic detection the scanner also read src/, docs/ and backlog/, where bare words become rules (.hidden, .grid) and this item's own `p-[13px]` became CSS. Even so, words in market/web already yield .fixed .block .contents .inline .table .filter in the utilities layer; no element on the site carries any of those as a class today (grepped className and classList in src, force5/src, market/web).
- 2026-09-20 agent: both layers sit under the site's unlayered stylesheets, so an existing rule always beats a utility. The import sits after dock.css in src/main.tsx, which is after styles.css as S2 asks.
- 2026-09-20 agent: S8 shadow values taken from the mockup's Atlantic block (backlog/mockups/2026-09-20-community-atlantic.html:651-653): control 0 1 5 #0a1f3c1f, marker 0 3 12 #0a1f3c2e, surface 0 10 40 #0a1f3c33. The mockup has no dock shadow; dock keeps the token's geometry and alpha on the new ink, 0 -4 24 #0a1f3c33. Note the marker alpha is 2e in the mockup and 33 in design/foundations/tokens.css:218; the mockup won, as it did for the hairline (1a, not 14).
- 2026-09-20 agent: S7 followed as written: reading has no tracking. design/foundations/tokens.css:215 gives the reading step -0.7px; nothing in the forum uses the step, so it is left for whoever first does.
- 2026-09-20 agent: S8 namespaces: durations are --transition-duration-{fast,base} (duration-fast), layers are --z-index-* (z-header), control heights are --spacing-control-{sm,md,lg} and --spacing-touch (h-control-md, min-h-touch). S9 weights are --font-weight-{normal,medium,semibold,bold}; they have to be restated because `--font-*: initial` clears them with the families.
- 2026-09-20 agent: S10 goes a little past `[`: it also fails on the bracketless custom-property form `w-(--gutter)`, on `/[…]` modifiers, and on arbitrary variants and properties, since each resolves without the theme. ui/theme.css is the one file exempt from the colour rule. The allow comment works on the line or the line above and is refused without a reason. `npm run ui:lint` runs the lint, then `--probe`: seven scratch trees in the OS temp directory, each linted in a child process; the working tree is never written to.
- 2026-09-20 agent: ACCEPT 1 proved on the dev server (port 4300) on / and /market: an injected element with the four classes computed to rgb(20, 99, 255), rgb(255, 255, 255), 40px, and `bg-red-500` to a transparent background. ACCEPT 3: 65 of 65 e2e specs passed on PREVIEW_PORT=4300; the suite holds no screenshot snapshots, so there were none to change. Gates run: npm run build, npm test (31 files, 423 tests), npm run market:api:build, npm run ui:lint, npm run test:e2e.
- 2026-09-20 agent: stopped at the end of the item. Nothing in design/, no existing class or stylesheet, and no tailwind.config.js were touched.
