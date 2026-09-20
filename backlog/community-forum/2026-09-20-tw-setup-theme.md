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
TOUCH: package.json, package-lock.json, vite.config.ts, tsconfig.json, src/main.tsx, ui/theme.css, scripts/lint-ui.mjs.
AVOID: Preflight. tailwind.config.js. Editing design/. Touching any existing class or stylesheet.
GATES: npm run build; npm test; e2e suite unchanged (npm run test:e2e).
ACCEPT:
- [ ] A scratch element with `bg-accent text-accent-ink rounded-full h-control-md` renders #1463ff, white, 40px tall in dev.
- [ ] `bg-red-500` produces no CSS (defaults removed).
- [ ] npm run test:e2e passes with zero snapshot changes.
- [ ] npm run ui:lint exits 0; the probe proves it exits non-zero on `p-[13px]`.
REFS: D1 D2 D3 D5 D6. Plan 13.1, 14.
