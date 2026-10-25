# Recommended wing size per forecast hour

Research, 25 Oct 2026. The raw brand data, the full lookup table (60 to 110 kg, 10 to 35 kn) and the fit details are in [`2026-10-25-wing-sizes.json`](2026-10-25-wing-sizes.json).

## The recommendation

- **Formula:** `size = 64 × (weight / 75)^0.46 / wind^0.90` (wind in knots, weight in kg), rounded to the nearest size riders buy: 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8 m². It was fitted to the middle of 141 published wind ranges from 9 brands. It is typically within 0.3 m² of a brand's own chart, and 97% of points are within 1 m².
- **Weight matters less than you'd think:** going from 70 to 90 kg adds only about half a size. Gong, the only brand that publishes a separate chart per rider weight, shifts each size's range up about 2 kn per weight band. Sroka and North give rules that point to a slightly stronger effect.
- **Show nothing outside the usable range.** Below about 10 kn (8.5 kn at 60 kg, 11.5 kn at 110 kg) you would need a wing bigger than 8 m², so show "too light". Above 40 kn steady wind, every brand's 2 m² wing has run out of range, so show "too strong". Use the steady (mean) wind, not the gusts.

## Table (m²)

| kn | 12 | 13 | 14 | 15 | 16 | 17 | 18 | 19 | 20 | 21 | 22 | 23 | 24 | 25 | 26 | 27 | 28 | 29 | 30 | 31 | 32 | 33 | 34 | 35 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 70 kg | 6.5 | 6 | 6 | 5.5 | 5 | 5 | 4.5 | 4.5 | 4 | 4 | 4 | 3.5 | 3.5 | 3.5 | 3.5 | 3 | 3 | 3 | 3 | 3 | 2.5 | 2.5 | 2.5 | 2.5 |
| 80 kg | 7 | 6.5 | 6 | 6 | 5.5 | 5 | 5 | 4.5 | 4.5 | 4.5 | 4 | 4 | 4 | 3.5 | 3.5 | 3.5 | 3.5 | 3 | 3 | 3 | 3 | 3 | 3 | 2.5 |
| 90 kg | 7 | 7 | 6.5 | 6 | 5.5 | 5.5 | 5 | 5 | 4.5 | 4.5 | 4.5 | 4 | 4 | 4 | 3.5 | 3.5 | 3.5 | 3.5 | 3.5 | 3 | 3 | 3 | 3 | 3 |

## How the brands compare

For a 75 kg rider, here is the size each brand's chart implies (taken from the middle of each size's range):

| kn | model | brands (lowest to highest) |
|---|---|---|
| 15 | 5.6 | 5.2 (Gong Droid) to 6.2 (Armstrong XPS) |
| 20 | 4.3 | 4.0 (Ozone Wasp) to 5.0 (Armstrong XPS) |
| 25 | 3.5 | 2.8 (Ozone Wasp) to 4.2 (F-One Strike) |
| 30 | 3.0 | 2.5 (Cabrinha Mantis) to 3.5 (F-One Strike) |

- At any given wind, brands usually disagree by about 1 m², or ±0.5 m² around the model. The gap is widest at 25 kn, at about 1.4 m².
- Duotone, Cabrinha, Sroka, Gong and North are close to one another and to the model.
- F-One and Armstrong (and Slingshot, a little) rate their 3 to 4.5 m² wings for 3 to 5 kn more wind than the others. That means at the same wind they suggest about half a size bigger.
- Ozone's 2022 Wasp chart leans smaller.
- The ranges brands publish are wide (a 5 m² wing is typically rated from 10 to 25 kn). They assume an intermediate rider on a mid-size foil. Gong's guide says an 85 kg beginner needs 15 to 20 kn on a 5 m² wing, while an experienced rider needs about 15 kn.
- Specialist light-wind wings (F-One Strike CWC, Armstrong XPS Lightwind, North Nova Light Wind) work 1 to 3 kn lower than the formula suggests for their size.

## JS (paste into a mock-up)

```js
// Recommended wing size (m²) for a steady wind (kn) and rider weight (kg).
// Fitted to 9 brands' published wind ranges (backlog/research/2026-10-25-wing-sizes.json).
// Returns null when no sensible wing exists (too light or too strong).
const WING_STEPS = [2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 8];
function recommendedWing(windKn, weightKg = 75) {
  if (!(windKn > 0) || windKn > 40) return null;          // too strong above 40 kn
  const raw = 64 * Math.pow(weightKg / 75, 0.46) / Math.pow(windKn, 0.9);
  if (raw > 8.5 || raw < 1.75) return null;              // too light / too strong
  let best = WING_STEPS[0];
  for (const s of WING_STEPS) {
    if (Math.abs(s - raw) <= Math.abs(best - raw)) best = s; // ties go to the bigger wing
  }
  return best;
}
// recommendedWing(18, 80) -> 5
```

## Sources

Every source below was read directly unless it says "excerpt".

- Gong Plus, Droid and Neutra 2026 size charts, with separate wind ranges for S (under 65 kg), M/L (65 to 85 kg) and XL (over 85 kg) riders: [Plus](https://www.gong-galaxy.com/en/products/gong-wing-plus-26), [Droid](https://www.gong-galaxy.com/en/products/gong-wing-droid-26nhnb), [Neutra](https://www.gong-galaxy.com/en/products/gong-wing-neutra-26nhnb) (chart images), and the [Gong guide to choosing a wing](https://www.gong-galaxy.com/en/blogs/how-to/how-to-choose-your-wing-1).
- F-One: [Strike V6](https://www.f-one.world/en/WING/wings/strike-6.html), [Strike CWC](https://www.f-one.world/en/WING/wings/strike-6-cwc.html), [Swing V5](https://www.f-one.world/en/WING/wings/swing-v5.html). The 75 kg reference rider comes from an excerpt only.
- Duotone Unit 2025/26: [Isthmus](https://isthmussailboards.com/2025-duotone-unit-wind-wing.html) and [MacKite](https://www.mackiteboarding.com/2026-duotone-unit-wing/) retailer copies. Duotone Slick: [Powerkiteshop](https://powerkiteshop.com/products/duotone-slick-sale) (excerpt). The Echo's table is not readable on duotonesports.com.
- [Cabrinha Mantis 2027](https://www.cabrinha.com/products/2027-mantis-wing) (75 kg rider).
- Armstrong: [A-Wing XPS Mk II](https://armstrongfoils.com/products/a-wing-xps-mk-ii), [XPS Lightwind](https://armstrongfoils.com/products/a-wing-xps-lightwind-wing) (75 kg rider), [X-Wing](https://armstrongfoils.com/products/x-wing-performance-wing).
- [Slingshot SlingWing V6](https://slingshotsports.com/products/slingwing-v6) (spec chart in the page's size-chart widget).
- Sroka: [Wing V4](https://srokacompany.com/products/wing-v4-sroka) (75 kg rider, plus a weight rule) and [V4 Elite](https://srokacompany.com/products/wing-v4-elite).
- North: [Nova 2026 at MacKite](https://www.mackiteboarding.com/2026-North-Nova-Wing/), and [Nova Light Wind](https://northactionsports.com/products/nova-light-wind-wing) (excerpt).
- [Ozone Wasp V3 PDF](https://ozonekites.com/app/uploads//2022/04/Wasp-V3-Info-PDF.pdf) (80 kg rider; ranges read from the bar chart).
- Cross-checks (retailer charts, not used in the fit): [MacKite wind/weight chart](https://mackiteboarding.com/2024-duotone-slick-wing), [Windance](https://www.windance.com/blogs/wing-foiling/wing-size-by-wind-chart).
- No wind charts were found for Naish (the ADX page lists sizes only), Takuma (site unreachable; mainly a foil brand) or AK (no wings on its current site).
