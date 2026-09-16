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
  - `__now` — the warm marker for real clock time.
- **Card** (`__card`) — what each model says at one hour, on hover or press.
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

The filter is a modal dialog: focus is trapped while it is open, Escape closes
it, and the trigger takes focus back afterwards. Its switches are real
checkboxes with `role="switch"`; a row with no data source is disabled with the
reason in text beside it, not merely greyed.

Under `prefers-reduced-transparency` the multiplied bands are drawn over the
opaque surface rather than the glass dock, and they are chosen to stay legible
there — the fallback is the accessible case, not a degradation of one.
