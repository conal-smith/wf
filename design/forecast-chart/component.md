# Forecast chart

The dock's uncertainty views: a probability blend and a candle column, plus the
display filter that decides what the dock shows. This is the first component in
the system that draws data rather than chrome, and the first one allowed to use
a colour family outside the teal ramp — see the ruling of 2026-09-16.

The chart never explains wind speed with a new palette. Height on the value axis
_is_ speed, and the fill is the wind ramp read off that axis, so a band that
reaches the yellow part of the scale is yellow for the same reason the map is.

## Anatomy

- **Gutter** (`__gutter`) — the plot's left margin, the same width as the
  forecast table's row-label column so the two line up. It holds the value ticks
  (`__ticks`) and a vertical wind ramp (`__scale`) generated from
  `--sem-gradient-wind`, which is the legend for the fill.
- **Plot** (`__plot`) — a fixed-height box the width of the forecast columns it
  spans. Everything inside is one inline SVG:
  - `__night` — shading for the hours between sunset and sunrise.
  - `__gridline` — a dashed line at every tick.
  - `__band` — three stacked fills from the same gradient: the full model range,
    the quartiles, and an inner core. They multiply, so the core darkens exactly
    where the models agree.
  - `__model` — one faint line per model in that model's identity hue, supplied
    by the product as `--f5-model-hue`; `__model--gust` is the dashed gust line.
  - `__median` — the white line through the middle of the models.
  - `__arrow` with `__arrow-halo` — wind direction on the median.
  - `__wave-band` — an optional band along the plot's foot for wave height, on
    its own fixed nought-to-six-metre scale in `--sem-color-wind-k05` at low
    opacity. It is drawn behind the wind bands and inside the existing plot box,
    so it borrows no height from the chart and adds none to the dock.
  - `__now` — the warm marker for real clock time.
- **Card** (`__card`) — what each model says at one hour, on hover or press.
- **Wave row** (`__wave-row`) — one marine row per sea state, 28px tall and 24px
  compact, the same as the tide row's, drawn over the tide underlay. Each cell is
  a `__wave-cell`: a small `__wave-arrow` rotated by the bearing so it travels
  the way the waves do, the significant height in metres to one decimal, then the
  period in whole seconds as muted small text. The unit is stated once on the
  row's glyph, never in the cells, and a step the model did not resolve is an em
  dash. Swell and wind sea are the same row with a different glyph.
- **Weather row** (`__weather-row`) — one marine row per surface reading, 24px tall
  and 22px compact: the standard row height, not the wave row's 28px, because these
  cells hold a number or a glyph and no second line. Five cell shapes:
  - a plain integer for air temperature, mean-sea-level pressure and the skin
    temperature, with the unit on the row's glyph;
  - `__rain-cell`, the same integer plus a background tinted by amount
    (`--rain-tint`, 0 to 1, saturating at 4mm in one interval). The tint is a
    shape for scanning and carries no reading of its own;
  - `__cloud-cell`, the total cover as a number beside `__cloud-bars`: three 2px
    bars, high over medium over low, each filled from the left by `--cover`;
  - `__weather-cell`, one of nine inline stroke glyphs for the present-weather
    code, drawn in the row's own text colour;
  - `__proxy-cell`, any reading that is a model approximation rather than a
    measurement — the sea row's skin temperature, where no station measures the
    water — drawn back and italic.
- **Observed row** (`__observed-row`) — a marine row whose reading is a
  measurement rather than a forecast, at the standard 24px. It holds exactly one
  cell, `__observed-cell`, spanning every column, left-aligned: an
  `__observed-reading` of the value, then its provenance as muted small text —
  where it was measured, how far away and how long ago — and an optional
  `__observed-spark`, a 13px polyline of the recent series scaled to its own range
  and spaced by real time. No axis, no numbers, no per-column value.
- **Day maximum** (`__day-max`) — the day's highest air temperature after the sun
  times in a day group, quieter than them, and only on a group wide enough for it.
- **Filter** (`.f5-forecast-filter`) — a dialog holding the row switches, the
  units control and the models in the blend.

## Variants

- `.f5-forecast-chart--blend` — the probability band. The default.
- `.f5-forecast-chart--candles` — one candle per three-hour column: wick for the
  full range, body for the middle half, tick for the median, and a thin warm bar
  beside it for the gust range.
- `.f5-forecast-filter` — the display filter, a solid raised surface. It is a
  dialog and not a second pane on purpose: the dock is already glass, and glass
  inside glass is mud.

## States

- `.f5-forecast-chart` — at rest.
- `.f5-forecast-chart__card` — a column is under the pointer or held; the
  cursor line marks it and the card names every model's reading.
- `.f5-forecast-chart__wave-band` — the wave band is switched on.
- `.f5-forecast-chart__wave-cell` — a column with a wave reading. A column with
  no forecast step close enough carries no cell at all: it reads as an em dash in
  the row's own muted colour, never as a zero, because zero metres would be a
  measured flat calm and this is an absence.
- `.f5-forecast-chart__rain-cell` — a column with a rain amount, tinted by how
  much. Zero millimetres is a dry interval the model forecast and reads as `0`; an
  em dash is the absence of an interval to forecast over.
- `.f5-forecast-chart__weather-cell` — a column with a present-weather code, as a
  glyph; `[data-weather]` names the group and `[data-code]` the code itself.
- `.f5-forecast-chart__proxy-cell` — a reading that is a model approximation and
  not a measurement, drawn back with the caveat in the row's explanation.
- `.f5-forecast-chart__observed-cell` — the row has a measurement, so it shows one
  reading spanning the row instead of a value per column, and the row's own
  explanation names the station rather than the model.
- `.f5-forecast-chart[data-state="empty"]` — no model publishes a series for
  this spot yet. The chart says so rather than drawing an empty box.
- `.f5-forecast-chart--candles` — the candle variant.
- `.f5-forecast-filter[open]` — the filter is showing.
- `.f5-forecast-filter__switch input:checked` — a row is on.
- `.f5-forecast-filter__switch input:disabled` — the row has no source yet, and
  the reason is written beside it.
- `.f5-forecast-filter__units button[aria-pressed="true"]` — the selected unit.

## Usage

Do key the fill's gradient to the value axis, not to a single colour picked from
the median. The whole point is that height and colour say the same thing twice.

Do let the model hues stay faint. They identify a line when a reader asks which
model is which; they are not a second palette competing with the wind ramp. A
model hue never fills an area and never colours a number.

Do put the plot and the table on the same columns. The dock's Now line, its
auto-scroll and its column hooks are shared, and a chart with its own spacing
would silently disagree with the numbers beside it.

Do show the gust as a continuation upward from the wind median, not as a
separate band elsewhere on the chart. A gust is the same wind, harder.

Do give waves their own scale and say so. Wave height is not a wind speed, so it
must never be read off the value axis or coloured by the wind ramp; the band is
one quiet blue on a fixed domain, and the numbers live in the wave row. Keep the
wave rows' arrows on the same convention as the wind's — rotated by the bearing
the waves come from, so the arrow travels the way they do.

Don't make a partition look like a total. Swell and wind sea are separate wave
trains whose heights add in energy, not in metres, so they never sum to the
combined height on screen and the row's explanation says so.

Do keep a code a code. A present-weather glyph stands for one entry in a code
table, so it is read from the cell the place sits in and never averaged, blended
between models or interpolated between two hours — the mean of "fog" and "rain" is
not a forecast. Nine shapes stand in for a hundred codes, and the code's own words
and number are in the cell's tooltip for anyone who wants the rest.

Do say when a reading is an approximation, in the row and in the cell. Where no
station measures the water, the sea row shows a model skin temperature: drawn back,
its explanation says "model skin temperature, approximate", and it is off by default
rather than sitting on and looking like a measurement.

Don't draw a measurement as a forecast. A row that holds an observation holds one
value — the newest reading is as recent as the water gets — so it is shown once, at
the left, spanning its columns, and never repeated across hours it says nothing
about. The reading carries its own provenance in the same breath (station, distance,
age), because a buoy 60 km offshore is not the water at the launch, and a row that
has a measurement is on by default while the same row falling back to a model field
is off. Both are the same row: what changes is which source it found, and it always
says which.

Don't let a tint be the reading. The rain cells are tinted by amount because a wet
band should be findable before it is read, but the millimetres are printed in the
cell and the interval they cover is in its tooltip. The tint deepens only to a
ceiling, so it never becomes a scale someone might try to measure off.

Don't add a second filled action inside the dock. The toolbar's Play button is
the view's one accent; the filter trigger and the view switch stay quiet.

Don't use the warm family for anything but the Now marker and the gust range.
Warm means _this instant_ or _this is degraded_, never emphasis.

Don't animate the chart. It is a dense read, not a transition.

The filter's placement belongs to whoever opens it: the component styles the
surface, and the consumer anchors it to its trigger. In the dock that is a
modal dialog fixed above the dock's own height, which is also what traps focus
and handles Escape.

## Accessibility

The SVG carries `role="img"` and an `aria-label` that states the range, the unit
and how many model lines it contains, and it points the reader at the table
view, which prints every value as text. No reading in the product depends on
telling two fills apart.

Agreement is written in words in the hover card — "models agree", "some spread",
"models disagree" — never carried by colour alone. Each row's glyph label is a
button with a real accessible name and an explanation on hover, focus or long
press, so the row's meaning is reachable without a pointer.

The wave band carries no reading of its own: the chart's `aria-label` says it is
there and what its scale is, and the wave row beside it prints every value as
text. A wave arrow is `aria-hidden`, because the row's numbers and its glyph
explanation already carry the direction convention in words.

A present-weather glyph is never the only reading: the cell carries the code's own
words as visually hidden text, so a screen reader hears "Slight rain" rather than
an unlabelled icon, and the same words with the code number are in the cell's
tooltip. The cloud row's three-level bar is `aria-hidden` and its levels are named
in the cell's tooltip, because the number beside it already carries the cover. The
day maximum is an `img` with a spoken label, not a bare degree sign.

The filter is a modal dialog: focus is trapped while it is open, Escape closes
it, and the trigger takes focus back afterwards. Its switches are real
checkboxes with `role="switch"`; a row with no data source is disabled with the
reason in text beside it, not merely greyed.

Under `prefers-reduced-transparency` the multiplied bands are drawn over the
opaque surface rather than the glass dock, and they are chosen to stay legible
there — the fallback is the accessible case, not a degradation of one.
