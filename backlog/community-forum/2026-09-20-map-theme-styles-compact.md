---
type: feature
status: ready
difficulty: m
criticality: normal
risk: high
epic: community-forum
iteration: 2
dependsOn: map-visual-baseline, tw-setup-theme
---

# Replace colour literals with theme variables in src/styles.css, src/compact.css

GOAL: src/styles.css, src/compact.css: zero colour literals; every colour is a theme variable; screenshots differ from baseline in colour only.
STATE: 149 colour literals (hex and alpha hex) across src/styles.css, src/compact.css. No theme use.
SPEC:
- S1 Each literal is replaced by the theme variable that names its role (ink, ink-muted, glass, solid, sunken, line, inverse, accent, warn, warn-ground, now, scrim).
- S2 Alpha variants use color-mix(in srgb, var(--color-x) N%, transparent) or a named theme alpha. No new hex.
- S3 A literal with no matching role is a missing theme value: add it to ui/theme.css with a name that says what it is, and record it in LOG. Wind, model hues and the now-marker stay as they are (D12).
- S4 Text below 4.5:1 on its ground after the swap is a defect: fix by choosing the darker ink step.
- S5 No selector, size, spacing or layout change (D11).
DO:
1. Inventory: literal -> role -> variable. Commit the table as a comment block at the top of the file or in LOG.
2. Replace. Shoot. Compare.
TOUCH: src/styles.css, src/compact.css, ui/theme.css (only if S3 applies).
AVOID: Converting to utility classes (D11). Touching TSX. Renaming classes.
GATES: npm run test:e2e; npm run map:shots compare; `grep -cE "#[0-9a-fA-F]{3,8}\b"` on each file returns 0 (wind and model hues live in TS, not here. VERIFY).
ACCEPT:
- [ ] Literal count is 0 in src/styles.css, src/compact.css.
- [ ] Every map:shots state differs from baseline in colour only; reviewer signs off in LOG.
- [ ] npm run test:e2e passes untouched.
REFS: D11 D12.
