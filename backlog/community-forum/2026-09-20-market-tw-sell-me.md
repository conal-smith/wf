---
type: feature
status: ready
difficulty: m
criticality: high
risk: high
epic: community-forum
iteration: 2
dependsOn: market-tw-shell-browse
---

# Convert the sell and account pages, then delete market.css

GOAL: SellPage, MePage and ProfileForm use ui/; market/web/market.css no longer exists.
STATE (anchors re-verified 2026-09-22 against f0befa4, the tree this item began from):
- market/web/pages/SellPage.tsx (652), MePage.tsx (350), ProfileForm.tsx (215, site-users' shape).
- CSS: list rows market.css:558-642, forms :643-799, photo uploader :800-886, notices/empty/pager/dialog :887-1011.
SPEC:
- S1 Field, TextInput, TextArea, Select from ui/. Invalid field = warn border and warn ground plus the message, never colour alone.
- S2 Photo uploader: tiles 4:3, add tile dashed, busy = dimmed, cover badge, reorder tools on glass.
- S3 Me tabs use Segmented; count badge inside the tab.
- S4 Whole-page sign-in gate stays an Empty with one primary (MePage.tsx:50-70).
- S5 When this and market-tw-listing-seller are both merged: market.css and its import are deleted, and the @import of design/* in it goes with it.
TOUCH: market/web/pages/SellPage.tsx, MePage.tsx, ProfileForm.tsx, market/web/components.tsx, market/web/market.css, market/web/MarketApp.tsx (css import).
AVOID: Validation or upload logic. market/shared.
TRAP: site-users rewrites ProfileForm's data shape and lands in iteration 1. Re-verify every anchor here against it.
GATES: npm run ui:lint; npm test; market:shots compare.
ACCEPT:
- [ ] Sell, me and profile shots differ from baseline in colour only.
- [ ] market/web/market.css is absent; `grep -r "mk-" market/web` returns nothing.
- [ ] npm run build output contains no .f5- or .mk- selectors from the marketplace chunk.
REFS: D7.
LOG:
- 2026-09-22 agent: resumed after an interruption; the three commits 0bce1ad (Checkbox, hover bg on link and danger), dbf9a57 (grid-cols-fields, grid-cols-tiles, pinned in ui/tv.test.ts), 3447d12 (the three pages, and components.tsx handing on Field, TextInput, TextArea, Select, Notice, Empty, Pager, ConfirmDialog from ui/) were in and unlogged; this LOG covers them too.
- 2026-09-22 agent: anchors re-verified against f0befa4. All drifted but the gate: SellPage 652 not 648, MePage 350 not 372, ProfileForm 215 not 182; market.css had lost ~410 lines to shell-browse, so list rows :558-642, forms :643-799, uploader :800-886 (not :971/:1056/:1213). MePage.tsx:50-70 exact. STATE corrected above.
- 2026-09-22 agent: TRAP re-verified. site-users (01c7821) is in: ProfileForm reads Profile from site/shared/types (handle, contactWhatsapp), validates with profileInputSchema when contact is required and site/shared/validate's userInputSchema otherwise, and SellPage gates on site/shared/types' hasContact. The converted form keeps all seven fields, both schemas, the email prefill and the handle echo untouched; only its markup and ids changed (mk-p-* -> profile-*, mk-l-* -> listing-*, so the ACCEPT grep has nothing to find). Nothing in e2e/ or elsewhere read the old ids.
- 2026-09-22 agent: first compare against the committed baseline was not colour only: 13 resized, 15 moved. Measured every box on 32 views in both trees (f0befa4 and this branch, same fixtures, same contexts) and every move came from four places, all fixed at the source rather than at the page. (1) ui/Field's label and hint took the body step's 1.5 leading where design/ draws a label at 1.3: 15.6 -> 18px a label, +2.4px per field row, +15px on sell. Now `leading-tight`. (2) ui/control's text area was min-h-32 (128px) where design/ is three large controls (138): `min-h-34.5`. (3) ui/Empty's icon well was size-14 (56) where design/ is a large control and a gap (58), which lifted every empty state's title 2px: `size-14.5`. (4) The account tabs' count took font-normal and the caption's 1.5 leading where design/'s segmented drew it at the tab's own weight and 1.3: now `text-caption leading-tight text-ink-muted`, the tab `leading-tight`. No new theme values; pinned in ui/kit.test.tsx ("Field, TextArea and Empty keep design/'s measures") and shell.test.ts's S3 case.
- 2026-09-22 agent: the kit changes reach community/web too (Field, TextArea, Empty are shared). Every one moves it toward design/'s own tokens (--sem-text-label-line-height 1.3, 3 x --sem-control-height-lg, control-lg + gap-loose), and community has no pixel baseline to hold; npm test and test:e2e are green over it.
- 2026-09-22 agent: after the fixes, sell, sell-contact, sell-errors, sell-signed-out at both widths, sell-edit-1240, me-profile-1240, me-signed-out, not-found and browse-empty at both widths are colour only (structure 0.00%). me-listings-1240, me-saved-1240 and me-reviews-1240 read 1.2-1.6% "new", 0.00% "gone", with every box identical to the pixel: the overlay is the underline on "View your public seller page" and "Remove", the kit link variant's offset and line colour (shell-browse delta (c)).
- 2026-09-22 agent: the 390 deltas, all the ruled tap-target minimum and nothing else, measured box by box: the account tabs 34 -> 44 (track 42 -> 52, +10 on every me-*-390), pill-sm Edit, Mark as sold, Relist and New listing 30 -> 44 (+14 a row, me-listings-390 1578 -> 1714), Back to listing 30 -> 44 and the uploader's three glass tools 30 -> 44 (sell-edit-390 2066 -> 2080; the tools are bottom-anchored, so the tile does not grow). me-profile-390 1175 -> 1185 is the tabs.
- 2026-09-22 agent: two deltas left, both the kit's ConfirmDialog, on the listing owner's confirm-dialog shot (the account page opens the same one, unshot). (g) Rhythm: the kit spaces head, body and actions gap-5 (20/20) where market.css spaced 12 and 24, so the box is 206 -> 210 at 1240. (h) At 390 the two answers no longer stretch to the width (market.css: `flex: 1 1 auto` under 720) and grow to 44px; the box is 356 -> 358 wide (w-11/12). Not changed here: ui/Dialog is community's dialog as much as this one, and a kit rhythm change is the owner's call. OPEN below.
- 2026-09-22 agent: S1 in a browser at 1240 and 390 (a Playwright probe, not committed). An invalid Price box is border rgb(133,77,49) on rgb(255,244,232) with "Enter a price like 450 or 449.99, or 0 for free." under it as role=alert; a valid one beside it rgb(116,136,166) on white. Three tellings, never colour alone.
- 2026-09-22 agent: S2 in a browser, both widths. Tiles and the add tile 4:3 (156x117 at 390); add tile dashed 2px on the content ground, bg-sunken under data-over; a held upload dims the image to opacity 0.5 with data-busy="true" and returns to 1 when it lands; Cover is the glass Chip; the tools are glass (rgba(238,242,249,.86), blur 5px), 30px at 1240 and 44 at 390. The add tile's focus ring is 3px rgb(11,37,69) at 2px, the one ring.
- 2026-09-22 agent: S3. Tabs are segmentedStyles on four router Links (role=tab, aria-selected and aria-pressed as before); the chosen one is lifted (card fill and shadow), not recoloured; 34px at 1240, 44 at 390. The saved count sits inside the Saved tab ("Saved 1" in me-saved) as a number, not the kit's Count, which is a filled badge for unread and would be a new mark.
- 2026-09-22 agent: S4. The signed-out gate is one ui/ Empty (shell.test.ts renders it), whose one action is the only variant="primary" in MePage and appears only where a provider exists; the e2e build has none, as the baseline records. ONE FILLED ACTION counted in the browser at both widths: sell 1 (Publish listing), edit 1 (Save changes), profile 1 (Save profile), me 0. The danger answer keeps its warm fill under the pointer (rgb(133,77,49) before and after), and Cancel holds the focus on open.
- 2026-09-22 agent: tests prove themselves. The tightened `\.mk-<name>(?:__…|--…)?(?![\w-])` is red for .mk-field__label, .mk-photo--add, .mk-item__thumb and .mk-dialog__actions put back into market.css (two cases each); a literal className put back into SellPage is red too. S5 not started, as asked: market.css still holds what ListingPage and SellerPage read (and the stars, rating picker and avatar components.tsx draws for them), and the ACCEPT greps wait for that item.
- 2026-09-22 agent: gates. npm run ui:lint clean, 84 files, probe 7; npm test 1243 passed, 75 skipped (57 files); npm run build; npm run market:api:build; PREVIEW_PORT=4422 PORT=8922 market:shots then shots:compare: 49 shots, 23 identical (browse, every listing view but the dialog, seller), 16 colour only (me-profile-1240 among them at 0.46%, its link underline), 7 over 1% and 3 resized: me-listings, me-saved and me-reviews at 1240 are the link underline alone, me-saved-390, me-reviews-390 (moved) and me-listings-390, me-profile-390, sell-edit-390 (resized) the tap targets alone, confirm-dialog at both widths (g, h). Listing-review and listing-contact, which read the shared Field and TextArea, went from resized to identical with the kit fixes. test:e2e in the next line. The re-shot PNGs are not committed.
- 2026-09-22 agent: PREVIEW_PORT=4422 PORT=8922 npm run test:e2e: 85 passed, over the kit changes that community/web shares.
  OPEN (for the owner, not this item):
- ui/Dialog's rhythm and the phone's full-width answers, (g) and (h) above. market.css stretched a dialog's buttons under 720 and put 24px above them; if the kit should, it is one class on dialogStyles.actions and one on base, and community's dialogs take it too.
- ui/Button's `link` variant has no touch minimum (`h-auto p-0`), so "Remove" on a my-listings row is 14px tall at 390, as it was. The rule says 44; the fix is the kit's and would move every link-button on the site.
