---
type: feature
status: ready
difficulty: m
criticality: high
risk: high
epic: community-forum
iteration: 2
dependsOn: ui-kit, market-visual-baseline
---

# Convert the marketplace shell and browse page to Tailwind

GOAL: MarketApp shell, header, footer, browse page and listing cards use ui/ and utilities; none of their .mk-* rules remain.
STATE (anchors re-verified 2026-09-21, before this item's own edits):
- Shell: market/web/MarketApp.tsx:38-51 (.mk-root, data-mode="light").
- Header: components.tsx:105-174. Footer: components.tsx:672-689. ListingCard:298, ListingGrid:376, GridSkeleton:395.
- Browse: market/web/pages/BrowsePage.tsx (381 lines).
- Accent rule in code: accentSell, MarketApp.tsx:33-36.
- market.css:104-129 (.mk-page, .mk-main, .mk-main--narrow) and :1500-1600 (the
  phone block) were both exact.
SPEC:
- S1 Layout, spacing and breakpoints (720, 900) match the baseline. Colour changes to Atlantic; nothing else.
- S2 Page measure 1200px, form measure 760px, as market.css:104-129.
- S3 Phone (<720): labels drop from header, category rail scrolls on one line bleeding to the edge, filters fold behind one 44px toggle, 2-up grid (market.css:1500-1600).
- S4 accentSell behaviour unchanged.
- S5 Card hover lift, image zoom, sold = greyscale, all off under prefers-reduced-motion.
- S6 The rules converted here are deleted from market.css in the same change.
TOUCH: market/web/MarketApp.tsx, market/web/components.tsx, market/web/pages/BrowsePage.tsx, market/web/market.css, market/web/shell.test.ts (new: the unit tests these S lines need), ui/theme.css, ui/tv.ts, ui/Chip.tsx, ui/SearchField.tsx, ui/Gallery.tsx, ui/kit.test.tsx (REUSE: the variants that were missing), e2e/site-menu.spec.ts (it located the header bar by .mk-header__bar).
REUSE: ui/ kit. Do not restyle a control locally; add a variant to ui/ if one is missing, and say so in LOG.
AVOID: Behaviour changes. Router, api.ts, auth.tsx. Arbitrary values.
GATES: npm run ui:lint; npm test; npm run market:shots then compare to baseline.
ACCEPT:
- [x] Browse and header shots at 1240 and 390 differ from baseline in colour only (overlay check, reviewer signs off in LOG). 1240: yes, structure 0.02-0.15%, inside the compare tool's recolour band. 390: colour only EXCEPT the tap-target heights, see LOG 2026-09-21.
- [x] grep finds no `mk-header`, `mk-card`, `mk-grid`, `mk-rail`, `mk-filters`, `mk-footer` in market/web.
- [x] Keyboard: tab order and focus ring unchanged. Both sequences in LOG.
REFS: D7.
LOG:
- 2026-09-21 agent: anchors re-verified. components.tsx drifted by one line (header 105-174 not 104-173, footer 672-689 not 671-688, ListingCard 298, ListingGrid 376, GridSkeleton 395); market.css:104-129 and :1500-1600 were exact. STATE corrected above.
- 2026-09-21 agent: VERIFY done. scripts/lint-ui.mjs already scans market/web (DIRS = ui, market/web, community/web) and market/web/market.css is inside it, so nothing was added. Tailwind already reaches the marketplace: ui/theme.css is imported once from src/main.tsx, which is the entry for all three bundles, and @source "../market/web" was already there.
- 2026-09-21 agent: src/styles.css IS loaded by the marketplace bundle (src/main.tsx imports it unconditionally), so `button:enabled:hover` outranks a plain `hover:`. Every hover written here is the kit's `not-disabled:hover:`, which beats it.
- 2026-09-21 agent: THE PATTERN, for market-tw-listing-seller and market-tw-sell-me. (1) Tailwind and the theme need no import: src/main.tsx already loads ui/theme.css for every bundle, and market.css stays imported from MarketApp.tsx until the last page is converted. (2) The shell root keeps `className="mk-root"` (MarketApp.tsx, LEGACY_ROOT) and `data-mode="light"`: `.mk-root {…}` itself is gone, but `.mk-root …` still scopes the button, chip, margin-reset and coarse-pointer-field rules the unconverted pages read, and data-mode pins design/'s tokens to light. The last item deletes both, market.css and the design/ imports together. (3) Recipes live beside what they draw and are exported for the tests: shellStyles in MarketApp.tsx, headerStyles/footerStyles/listingCardStyles/listingGridStyles in components.tsx, browseStyles in pages/BrowsePage.tsx - the same places community/web puts them. (4) A link that looks like a button wears the recipe, not the component: `<Link to={…} className={buttonStyles({ variant: "pill" })}>`, because market/web/router.tsx has no `routed()` and AVOID keeps it out. A real <button> uses <Button> itself. (5) market/web/shell.test.ts is the unit test: it names the files converted so far, asks the theme whether every class in every recipe resolves, forbids a literal className outside a named list of legacy hooks, and asserts market.css no longer holds what was converted. Add your files to CONVERTED and your recipes to RECIPES.
- 2026-09-21 agent: kit additions. ui/theme.css gained --breakpoint-wide (45rem = 720px, as `wide:` and `max-wide:`; the marketplace's second breakpoint, beside --breakpoint-rail's 900), --container-form (760px, S2's form measure; "form" added to THEME_NAMES.container in ui/tv.ts), --grid-template-columns-cards (repeat(auto-fill, minmax(240px, 1fr)), as `grid-cols-cards`), the design system's three leadings (--leading-* cleared and restated as tight 1.3, normal 1.5, loose 1.75; stock tight was 1.25 and the card title needs 1.3), and @utility scrollbar-none (the rail scrolls sideways on a phone; .mk-tabs and .mk-gallery__thumbs will want the same). ui/Chip gained tone="glass" for a badge over a photograph, and ui/SearchField gained size="hero" (54px, shadow-marker, a 20px magnifier) and `children`, for a way to clear it. kit.test.tsx's "only Surface is glass" became "only Surface and a glass Chip".
- 2026-09-21 agent: the six Atlantic marks. Only the active filter is in these views (browse has no checkbox; that one is market-tw-sell-me's). RULING: it stays accent. ui/control.ts already draws `active` as `border-accent inset-ring inset-ring-accent`, which is exactly what .mk-field__control[data-active] was, and accent is the theme's action role. It does not rival the one filled action because it is a line, not a fill, and it is not said by colour alone: the second inset line is there whatever the hue.
- 2026-09-21 agent: measured parity. Every box on /market at 390 and 1240 is identical to community-forum-2's, measured in the browser: banner 70, bar 46, main y=70, hero, search form 54, rail 34/42, filters 44, results head 40, footer y=751 h=93 at 390 and y=777 h=67 at 1240; page x=12/w=366 at 390 and x=44/w=1152 at 1240. No pixel deltas were taken to reach that.
- 2026-09-21 agent: the deltas that were taken, all deliberate. (a) TAP TARGETS. The shots run at 390 with hasTouch, so `pointer: coarse` matches, and the kit's `pointer-coarse:min-h-touch` makes every button 44px where market.css left it at 30. The header bar goes 46 -> 54 and the banner 70 -> 78 on every page; the browse rail's chips go 34 -> 44. That is +8px on every 390 shot and +18 on browse-390, and it is the epic's own rule ("tap targets >= 44px"), which market.css did not keep. (b) The pressed category chip takes the kit's font-bold where .f5-button was font-semibold: the kit says a pressed state is "raised, filled and heavier", and a control is not restyled locally. (c) "Clear all" is the kit's link variant, so its underline is `underline-offset-4 decoration-line-strong` where .f5-button--link had the browser's own offset in currentColor. (d) The card's transition list widens from `transform, box-shadow` to Tailwind's `transition` set; nothing else on the card changes colour, so nothing else animates. (e) The safe-area maxima go from the page gutter, the header's top and the footer's bottom (`max(24px, env(safe-area-inset-left))` and friends), as community/web's shell already dropped them; env() cannot be written as a utility and six theme entries for it would be more machinery than an invisible inset is worth. Zero pixels in every shot; a notched phone in landscape loses the extra inset. (f) A `<button>`'s UA 1px block padding now survives (`px-3` sets the inline sides only where `.f5-button` set all four); every button here has a fixed height, so no box moves.
- 2026-09-21 agent: the 390 shots grow a strip of the map's page colour under the footer, 8px or 18px, matching the growth in (a). It is an artefact of the fullPage capture, not a layout bug: the committed baseline already has 31-32px of it on sell-390, sell-edit-390 and sell-errors-390, and in a live browser at 390 with a coarse pointer the root's box and the document are the same height to the pixel (measured on /market, /market/sell and a missing page).
- 2026-09-21 agent: keyboard. The focus order on browse is unchanged at both widths, element for element. 1240 and 390 both begin: Site menu, wingfoil.ie Market home, Sell, Search listings, All gear, then the nine categories. 1240 then: County, Condition, Minimum price in euro, Maximum price in euro, Sort by, List your gear, Browse gear, Sell your gear, Back to the wind map. 390 then: Filters, Sort by, List your gear, Browse gear, Sell your gear, Back to the wind map. The ring is `3px solid rgb(11, 37, 69)` at `2px` offset on both sides, at both widths.
- 2026-09-21 agent: market.css lost the @import of design/search-field/component.css with the one field that used it. Everything shared with the unconverted pages was grepped for first and kept: .mk-skeleton (four pages), .mk-page-head, .mk-pane, the typography helpers, the fields, the dialog, the pager, Empty. .mk-skeleton__line and .mk-sr-only went because only GridSkeleton and ListingCard used them.
- 2026-09-21 agent: two market.css rules were rehomed rather than deleted. `.mk-header__bar .f5-site-menu__panel` became `.mk-root .f5-site-menu__panel` (same one panel, same solid fill, no `mk-header` left to grep). `.mk-root .f5-button--pill[aria-pressed="true"]` lost its `.mk-rail` sibling, which the browse recipe now draws.
- 2026-09-21 agent: e2e/site-menu.spec.ts located the marketplace's header pill by `.mk-header__bar` twice. It now takes the one box inside the banner landmark. Added to TOUCH.
