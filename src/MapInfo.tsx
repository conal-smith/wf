import { ChartSpline } from "lucide-react";
import {
  Fragment,
  Suspense,
  lazy,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { Button } from "../ui/Button";
import { Dialog } from "../ui/Dialog";
import { Puffin } from "../ui/Puffin";
import { StarGlyphs } from "../ui/StarGlyphs";
import { Wordmark } from "../ui/Wordmark";
import { MODEL_CATALOG, modelHue } from "../force5/src/catalog";
import { DEPTHS } from "../force5/src/chartStyle";
import { leadOrder, type StarsFrom } from "../force5/src/lead";
import {
  SATELLITE_TIDES_NOTE,
  satelliteTidesLine,
} from "../force5/src/satellite";
import { STARS_HREF } from "../force5/src/siteNav";
import { windBand, type Rider } from "../force5/src/stars";
import { windColor } from "../force5/src/weather";
import {
  AboutGlyph,
  ColouredWindGlyph,
  CurrentsGlyph,
  HighTideGlyph,
  LoupeGlyph,
  LowTideGlyph,
  NamesGlyph,
  ParticlesGlyph,
  RainGlyph,
  ReliefGlyph,
  RingGlyph,
  SatelliteGlyph,
  SoundingsGlyph,
  SourcesGlyph,
  StarGlyph,
  TidalDepthGlyph,
  TintsGlyph,
} from "./chartGlyphs";
import FoilLegend from "./FoilLegend";
import { KnotScale } from "./KnotScale";
import { RainScale } from "./RainScale";
import type { InfoSection } from "./mapInfoContext";
import { riderLine } from "./riderLine";
import "./mapInfo.css";

/** The Currents layer's key, its own chunk: few readers open it. */
const CurrentsKey = lazy(() => import("./CurrentsKey"));

interface Part {
  id: InfoSection;
  /** Its name in the rail, and its heading. */
  name: string;
  /** Its name on a phone's tab. */
  short: string;
  glyph: (size: number) => ReactNode;
  /** A rule above it in the rail: the chart, its layers, the small print. */
  rule?: boolean;
}

const PARTS: readonly Part[] = [
  {
    id: "key",
    name: "The map’s key",
    short: "Key",
    glyph: (size) => <LoupeGlyph size={size} />,
  },
  {
    id: "stars",
    name: "Stars",
    short: "Stars",
    glyph: (size) => <StarGlyph size={size} />,
  },
  {
    id: "wind",
    name: "Wind & gusts",
    short: "Wind",
    glyph: (size) => <ParticlesGlyph size={size} />,
  },
  {
    id: "blend",
    name: "The blend & models",
    short: "Blend",
    glyph: (size) => (
      <ChartSpline size={size} strokeWidth={1.5} aria-hidden="true" />
    ),
  },
  {
    id: "foil",
    name: "Tidal depth",
    short: "Tidal",
    glyph: (size) => <TidalDepthGlyph size={size} />,
    rule: true,
  },
  {
    id: "currents",
    name: "Currents",
    short: "Currents",
    glyph: (size) => <CurrentsGlyph size={size} />,
  },
  {
    id: "rain",
    name: "Rain",
    short: "Rain",
    glyph: (size) => <RainGlyph size={size} />,
  },
  {
    id: "satellite",
    name: "Satellite",
    short: "Satellite",
    glyph: (size) => <SatelliteGlyph size={size} />,
  },
  {
    id: "sources",
    name: "Sources & credits",
    short: "Sources",
    glyph: (size) => <SourcesGlyph size={size} />,
    rule: true,
  },
  {
    id: "about",
    name: "About",
    short: "About",
    glyph: (size) => <AboutGlyph size={size} />,
  },
];

/** The part's panel, by id: what a deep link and a test look for. */
const panelId = (id: InfoSection) => `map-info-${id}`;

export interface MapInfoProps {
  at: InfoSection;
  /** False while it fades out, once shut. */
  open?: boolean;
  onClose: () => void;
  scale: string;
  rider: Rider;
  /** The rider's model, which the stars rate, and ECMWF past its run. */
  starsFrom: StarsFrom;
  /** The models the blend lays over each other (the display options). */
  blendModels: readonly string[];
  /** The open spot, for the stars page's worked example. */
  spotId: string | null;
  /** The tidal-depth key's readings (src/FoilLegend.tsx). */
  foil: Parameters<typeof FoilLegend>[0];
  /**
   * The Rain layer: whether it is on, and what it draws at the hour shown
   * (or why it draws nothing there).
   */
  rain?: { on: boolean; line: string | null };
  sources: ReactNode;
  /** "Satellite: high tide (≈4.6 m)" while the image is on, else null. */
  satellite?: string | null;
  /** Why the image is not drawn, when it was asked for and could not be. */
  satelliteError?: string | null;
  /** The images' tides at the station nearest the map's centre, once known. */
  satelliteTides?: { name: string; high: number; low: number } | null;
}

/**
 * Everything the map explains, behind "About the map" in the site menu: what
 * its marks mean, how the stars are given, the wind and the blend, each
 * layer's key, where it all comes from, and who we are. A rail of glyphs down
 * the left, the chosen part beside it; on a phone the rail is a row of tabs
 * over it. One dialog over the blurred chart, so none of it sits on the map,
 * in a chunk of its own fetched when it first opens. A "?" by the stars, or
 * a layer's "i" in Layers, opens it at its own part.
 */
export default function MapInfo({
  at,
  open = true,
  onClose,
  scale,
  rider,
  starsFrom,
  blendModels,
  spotId,
  foil,
  rain = { on: false, line: null },
  sources,
  satellite = null,
  satelliteError = null,
  satelliteTides = null,
}: MapInfoProps) {
  const asked = PARTS.some((part) => part.id === at) ? at : "key";
  const [shown, setShown] = useState<InfoSection>(asked);
  // Opened again (or at another part) while still mounted, as it is for the
  // fade after closing: it opens where it is asked to, not where it was left.
  const [opened, setOpened] = useState({ at, open });
  if (opened.at !== at || opened.open !== open) {
    setOpened({ at, open });
    if (open) setShown(asked);
  }
  const tabs = useRef<Partial<Record<InfoSection, HTMLButtonElement | null>>>(
    {},
  );
  const main = useRef<HTMLDivElement>(null);
  const ids = useId();
  const part = PARTS.find((p) => p.id === shown)!;

  const choose = (id: InfoSection, focus = false) => {
    setShown(id);
    main.current?.scrollTo?.(0, 0);
    if (focus) tabs.current[id]?.focus();
  };
  // The rail is one stop for Tab; the arrows move along it, either way, as
  // it stands down the side or across the top.
  const arrows = (event: KeyboardEvent) => {
    const index = PARTS.findIndex((p) => p.id === shown);
    const step = {
      ArrowDown: 1,
      ArrowRight: 1,
      ArrowUp: -1,
      ArrowLeft: -1,
    }[event.key];
    const to =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? PARTS.length - 1
          : step === undefined
            ? null
            : (index + step + PARTS.length) % PARTS.length;
    if (to === null) return;
    event.preventDefault();
    choose(PARTS[to].id, true);
  };

  const body: Record<InfoSection, () => ReactNode> = {
    key: () => <MapKey scale={scale} />,
    stars: () => (
      <StarsPart rider={rider} starsFrom={starsFrom} spotId={spotId} />
    ),
    wind: () => <WindPart />,
    blend: () => <BlendPart starsFrom={starsFrom} models={blendModels} />,
    foil: () => (
      <>
        <p className="mi-lede">
          How deep the water is at the hour shown, so you can see where the mast
          would touch down.
        </p>
        <h4>
          The colours <small>depth at this tide</small>
        </h4>
        <FoilLegend {...foil} />
      </>
    ),
    currents: () => (
      <>
        <p className="mi-lede">
          The tidal streams and the sea&rsquo;s surface current: which way the
          water runs, and how hard, at the hour shown.
        </p>
        <Suspense fallback={<p>Loading…</p>}>
          <CurrentsKey />
        </Suspense>
      </>
    ),
    rain: () => <RainPart {...rain} />,
    satellite: () => (
      <SatellitePart
        line={satellite}
        error={satelliteError}
        tides={satelliteTides}
      />
    ),
    sources: () => (
      <>
        <p className="mi-lede">Where it all comes from.</p>
        <div className="mi-sources">{sources}</div>
      </>
    ),
    about: () => <AboutPart />,
  };

  return (
    <Dialog
      open={open}
      title="About the map"
      size="wide"
      className="map-info"
      onClose={onClose}
    >
      <div
        className="mi-nav"
        role="tablist"
        aria-label="About the map"
        aria-orientation="vertical"
        onKeyDown={arrows}
      >
        {PARTS.map((p) => (
          <Fragment key={p.id}>
            {p.rule && <hr />}
            <Button
              ref={(el: HTMLButtonElement | null) => {
                tabs.current[p.id] = el;
              }}
              variant="quiet"
              className="mi-tab"
              role="tab"
              // Named whole on a phone too, where the tab shows its short name.
              aria-label={p.name}
              id={`${ids}-${p.id}`}
              aria-selected={p.id === shown}
              aria-controls={panelId(p.id)}
              tabIndex={p.id === shown ? 0 : -1}
              onClick={() => choose(p.id)}
            >
              {p.glyph(18)}
              <span className="mi-name">{p.name}</span>
              <span className="mi-short" aria-hidden="true">
                {p.short}
              </span>
            </Button>
          </Fragment>
        ))}
      </div>
      <div
        ref={main}
        className="mi-main"
        role="tabpanel"
        id={panelId(shown)}
        aria-labelledby={`${ids}-${shown}`}
        tabIndex={0}
      >
        <p className="mi-kick" aria-hidden="true">
          {part.glyph(14)} {part.name}
        </p>
        <h3>{part.name}</h3>
        {body[shown]()}
      </div>
    </Dialog>
  );
}

/** A mark beside its name and a line on it. */
function Key({
  mark,
  name,
  children,
}: {
  mark: ReactNode;
  name: string;
  children: ReactNode;
}) {
  return (
    <li>
      <span className="mi-spec">{mark}</span>
      <span>
        <b>{name}</b>
        <span>{children}</span>
      </span>
    </li>
  );
}

/** What the lights, the loupe, the depths and the chart's symbols mean. */
function MapKey({ scale }: { scale: string }) {
  return (
    <>
      <p className="mi-lede">
        Every mark on the chart, in the chart&rsquo;s own symbols.{" "}
        <span className="mi-fig">{scale}</span>
      </p>
      <h4>
        The lights <small>one a spot</small>
      </h4>
      <ul className="mi-keys">
        <Key mark={<KeyLight stars={5} />} name="Five stars">
          In magenta.
        </Key>
        <Key mark={<KeyLight stars={4} />} name="Three or four">
          Inked in.
        </Key>
        <Key mark={<KeyLight stars={2} />} name="One or two">
          A plain ring.
        </Key>
        <Key mark={<KeyLight stars={0} />} name="None now">
          Dashed: no stars at this hour.
        </Key>
        <Key mark={<KeyLight stars={1} struck />} name="Offshore">
          Struck through in red. Not safe.
        </Key>
        <Key mark={<KeyLight stars={3} arrow cross />} name="Cross-offshore">
          A red arrow. One star off, unless you set it otherwise.
        </Key>
        <Key mark={<KeyLight stars={4} arrow />} name="The arrow">
          Stars at the hour shown; the arrow blows downwind.
        </Key>
        <Key mark={<KeyLight stars={4} arrow wedge />} name="The wedge">
          On the spot you open, with the range ring or no mark: the headings you
          can hold out to sea in this wind, as far up and down the wind as you
          say you ride. The longer it is, the better powered you are; it pulses
          faster with more stars.
        </Key>
      </ul>
      <h4>
        Round your spot <small>the loupe</small>
      </h4>
      <div className="mi-beside">
        <KeyRose />
        <ul className="mi-legend">
          <li>
            <i className="mi-sw-nogo" aria-hidden="true" />
            No-go: too close to the wind
          </li>
          <li>
            <i className="mi-sw-out" aria-hidden="true" />
            Your tack out to sea
          </li>
          <li>
            <i className="mi-sw-home" aria-hidden="true" />
            Your tack home
          </li>
          <li>
            <i className="mi-sw-slow" aria-hidden="true" />
            Downwind of your course: you drift, losing ground
          </li>
          <li>
            <i className="mi-sw-off" aria-hidden="true" />
            Offshore winds, on the rim
          </li>
          <li>
            <i
              aria-hidden="true"
              style={{ background: `rgb(${windColor(16).join(",")})` }}
            />
            The wind&rsquo;s needle, in its speed&rsquo;s colour
          </li>
        </ul>
      </div>
      <p className="mi-sm">
        About the headings you can hold in this hour&rsquo;s wind, out to sea
        and home, and the way you drift if you fall, dotted. How far into the
        wind you can ride, and how far below across your course runs (both in
        Settings), decide how wide the no-go and the course are. Its rim is half
        a nautical mile (or a kilometre) away. Round the chosen spot is a range
        ring unless you choose the loupe, or nothing, in Layers.
      </p>
      <h4>
        The depths <small>metres below chart datum</small>
      </h4>
      <div className="tints" aria-label="Depth tints">
        {[0, 1, 2, 5, 10, 20, 50].map((d) => (
          <span
            key={d}
            style={{
              background: `var(--map-d${DEPTHS.includes(d as (typeof DEPTHS)[number]) ? d : 50})`,
            }}
          >
            {d === 50 ? "50+" : d}
          </span>
        ))}
      </div>
      <p className="mi-sm">Depths in metres below chart datum</p>
      <h4>
        A chart&rsquo;s own symbols <small>INT 1</small>
      </h4>
      <ul className="mi-symbols">
        {SYMBOLS.map(([glyph, name, where]) => (
          <li key={name}>
            {glyph}
            <b>{name}</b>
            <span>{where}</span>
          </li>
        ))}
      </ul>
      <p className="mi-sm">
        Drawn as an Admiralty chart draws each thing, from INT 1, its book of
        symbols.
      </p>
    </>
  );
}

/** The Rain layer: what its blues mean, where they come from, what they miss. */
function RainPart({ on, line }: { on: boolean; line: string | null }) {
  return (
    <>
      <p className="mi-lede">Where it rains in the hour shown, and how hard.</p>
      <h4>
        The colours <small>rain in the hour</small>
      </h4>
      <RainScale />
      <p data-rain-line>
        {on
          ? (line ?? "Reading…")
          : "Off. Turn it on in Layers, under Weather: \u201cRain\u201d."}
      </p>
      <p>
        From DWD&rsquo;s ICON-EU model: about 6.5 km, hourly, for three days
        from its run. Dry is left clear. At a three-hour column the blues are
        the mean of its hours. A shower a few kilometres across can be missed or
        put in the wrong place.
      </p>
      <p className="ip-small">
        Weather data: Deutscher Wetterdienst (DWD) ICON-EU open data, CC BY 4.0.
      </p>
    </>
  );
}

/** The chart's parts, each in the symbol INT 1 gives it, and where it is. */
const SYMBOLS: readonly [ReactNode, string, string][] = [
  [<NamesGlyph size={32} />, "A light", "Each spot, and its name"],
  [<TintsGlyph size={32} />, "Depth tints", "Layers: Chart"],
  [<SoundingsGlyph size={32} />, "Contours, soundings", "Layers: Chart"],
  [<ReliefGlyph size={32} />, "Land relief", "Layers: Chart"],
  [<TidalDepthGlyph size={32} />, "A drying height", "Layers: Tidal depth"],
  [<CurrentsGlyph size={32} />, "A flood stream", "Layers: Currents"],
  [<SatelliteGlyph size={32} />, "A photograph inset", "Layers: Satellite"],
  [
    <LoupeGlyph size={32} />,
    "A compass rose",
    "Round the chosen spot: the loupe",
  ],
  [<RingGlyph size={32} />, "A range ring", "Round the chosen spot"],
];

/** How the stars are given, how to read them, and who they are for. */
function StarsPart({
  rider,
  starsFrom,
  spotId,
}: {
  rider: Rider;
  starsFrom: StarsFrom;
  spotId: string | null;
}) {
  const band = windBand(rider);
  const [model, then] = leadOrder(starsFrom).map(modelName);
  return (
    <>
      <p className="mi-lede">
        How good an hour is for you, at that spot. Out of five.
      </p>
      <div
        className="mi-eq"
        role="img"
        aria-label="The wind alone, less what the gusts and the shore cost, is your stars"
      >
        <span>
          <small>The wind alone</small>
          <StarGlyphs stars={5} potential={5} size={14} />
        </span>
        <span className="mi-op">−</span>
        <span>
          <small>Gusts</small>
          <StarGlyphs stars={1} potential={1} size={14} slots="potential" />
        </span>
        <span className="mi-op">−</span>
        <span>
          <small>The shore</small>
          <StarGlyphs stars={1} potential={1} size={14} slots="potential" />
        </span>
        <span className="mi-op">=</span>
        <span>
          <small>Your stars</small>
          <StarGlyphs stars={3} potential={5} size={14} />
        </span>
      </div>
      <p className="mi-sm">
        The wind alone is the steady wind against four numbers: too light, the
        sweet spot and too much. None under too light, then a star a knot up to
        four, five through the sweet spot, and fewer past it: one star 5 kn
        under too much, none 3 kn under it. A gust is read 5 kn lighter and
        costs a star when that is worth less; a gust past too much leaves no
        stars at all. The shore is the wind&rsquo;s angle to the beach:
        cross-offshore costs a star, and offshore is never. An orange or red Met
        Éireann warning stands in place of the stars.
      </p>
      <h4>
        Reading them <small>solid, outlined, dots</small>
      </h4>
      <ul className="mi-keys">
        <Key
          mark={<StarGlyphs stars={3} potential={5} size={10} />}
          name="Solid"
        >
          The rating.
        </Key>
        <Key
          mark={<StarGlyphs stars={3} potential={5} size={10} />}
          name="Outlined"
        >
          Stars lost to the gusts or to the wind&rsquo;s direction: what the
          steady wind alone would have earned.
        </Key>
        <Key
          mark={<StarGlyphs stars={1} potential={2} size={10} />}
          name="A dot"
        >
          A star out of reach: not even the wind speed alone would have earned
          it.
        </Key>
        <Key mark={<span className="mi-dark" />} name="Hatched">
          The dark. Dark hours aren&rsquo;t rated.
        </Key>
        <Key mark={<StarGlyph size={22} />} name="One model">
          {then ? `${model}, then ${then} past the end of its run` : model}: the
          model you picked, the one the map draws, and its own forecast, never a
          blend.
        </Key>
      </ul>
      <h4>
        Rated for you <small>in Settings</small>
      </h4>
      <p className="mi-fig">Stars: {riderLine(rider)}</p>
      <p className="mi-fig">
        Stars from {Math.round(band.min)} kn · five at{" "}
        {Math.round(band.sweetLow)}–{Math.round(band.sweetHigh)} kn · none for
        gusts over {Math.round(band.max)} kn
      </p>
      <p className="mi-sm">
        Everyone starts from ours (11 · 15–22 · 35 kn). Your own four numbers,
        the shore and how you ride upwind are in Settings, in the menu at the
        top left; your model is in Display options there. Your weight and wings
        never change the stars.
      </p>
      <a
        className="mi-more"
        href={
          spotId
            ? `${STARS_HREF}?spot=${encodeURIComponent(spotId)}`
            : STARS_HREF
        }
      >
        How the stars work, in full →
      </a>
    </>
  );
}

const modelName = (id: string) =>
  MODEL_CATALOG.find((entry) => entry.id === id)?.name ?? id.toUpperCase();

/** The wind's colours, its two layers, and its figures. */
function WindPart() {
  return (
    <>
      <p className="mi-lede">
        The wind&rsquo;s colours mean its speed and nothing else, the same for
        every rider.
      </p>
      <h4>
        The scale <small>knots</small>
      </h4>
      <KnotScale />
      <h4>
        Two layers of it <small>in Layers, either or both</small>
      </h4>
      <div className="mi-two">
        {(
          [
            [
              <ColouredWindGlyph size={40} />,
              "Coloured wind",
              "Its speed laid on the sea.",
            ],
            [
              <ParticlesGlyph size={40} />,
              "Particles",
              "The default: lines moving with the wind, at the hour shown. Over the colour, its speed and its way at a glance.",
            ],
          ] as const
        ).map(([glyph, name, line]) => (
          <figure key={name}>
            <div className="mi-cut">{glyph}</div>
            <figcaption>
              {name}
              <small>{line}</small>
            </figcaption>
          </figure>
        ))}
      </div>
      <h4>
        A wind&rsquo;s figures <small>the mean, then the gust</small>
      </h4>
      <div className="mi-beside">
        <span className="mi-wind-fig">
          17<small>g23</small>
        </span>
        <p>
          The hour&rsquo;s mean wind, then its gust, in your units: the mean is
          what holds you on the foil, the gust the strongest it blows in the
          hour.
        </p>
      </div>
    </>
  );
}

/** The blend: every model's wind over each other, and which give the stars. */
function BlendPart({
  starsFrom,
  models,
}: {
  starsFrom: StarsFrom;
  models: readonly string[];
}) {
  const [lead, then] = leadOrder(starsFrom);
  const rows = [...new Set([lead, ...(then ? [then] : []), ...models])].flatMap(
    (id) => {
      const entry = MODEL_CATALOG.find((e) => e.id === id);
      return entry ? [entry] : [];
    },
  );
  return (
    <>
      <p className="mi-lede">
        The blend lays every model&rsquo;s wind over each other, so you can see
        whether they agree. It is the dock&rsquo;s Blend view.
      </p>
      <BlendFigure />
      <h4>
        The models <small>the stars are the underlined one&rsquo;s</small>
      </h4>
      <table className="mi-models">
        <tbody>
          {rows.map((entry) => (
            <tr key={entry.id} className={entry.id === lead ? "is-lead" : ""}>
              <td>
                <span
                  className="mi-swatch"
                  style={{ background: modelHue(entry.id).wind }}
                />
              </td>
              <td>
                <b>{entry.name}</b>
              </td>
              <td>{entry.detail}</td>
              <td className="mi-tag">
                {entry.id === lead
                  ? "your model"
                  : entry.id === then
                    ? "past its run"
                    : ""}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mi-sm">
        The models in the blend give the agreement beside the stars, and never
        change a star. Which are in it is yours to choose, in the display
        options, under the one model you pick for the map and the stars; ECMWF
        takes over past the end of its run on its own.
      </p>
    </>
  );
}

/** Lines bunched where the models agree, spread where they do not. */
function BlendFigure() {
  const x = (t: number) => 20 + t * 8.6;
  const y = (t: number, off: number) =>
    96 - (12 + 6 * Math.sin(t / 7) + t * 0.12) * 3 + off * (0.4 + t * 0.05) * 3;
  const line = (off: number) =>
    Array.from(
      { length: 61 },
      (_, t) =>
        `${t ? "L" : "M"}${x(t).toFixed(1)} ${(y(t, off) + Math.sin(t * 0.8 + off * 2) * (0.3 + t * 0.03) * 3).toFixed(1)}`,
    ).join("");
  const band =
    Array.from(
      { length: 61 },
      (_, t) => `${t ? "L" : "M"}${x(t)} ${y(t, 2.4).toFixed(1)}`,
    ).join("") +
    Array.from({ length: 61 }, (_, i) => 60 - i)
      .map((t) => `L${x(t)} ${y(t, -2.4).toFixed(1)}`)
      .join("") +
    "Z";
  return (
    <svg className="mi-blend" viewBox="0 0 560 150" aria-hidden="true">
      <path d={band} fill="var(--color-ink)" opacity="0.07" />
      {["harmonie", "icon-eu", "ecmwf", "gfs"].map((id, i) => (
        <path
          key={id}
          d={line([0.2, 1.4, -1.3, 2.2][i])}
          fill="none"
          stroke={modelHue(id).wind}
          strokeWidth="1.5"
        />
      ))}
      <path
        d={line(0)}
        fill="none"
        stroke="var(--color-ink)"
        strokeWidth="2.4"
      />
      <text x="24" y="142">
        BUNCHED: THEY AGREE
      </text>
      <text x="400" y="142">
        SPREAD: THEY DON&rsquo;T
      </text>
    </svg>
  );
}

/** The satellite images: what they are, and the tide they were taken at. */
function SatellitePart({
  line,
  error,
  tides,
}: {
  line: string | null;
  error: string | null;
  tides: { name: string; high: number; low: number } | null;
}) {
  return (
    <>
      <p className="mi-lede">
        A clear look from space at high and at low water, under the chart. Turn
        it on in Layers, under Satellite at tide.
      </p>
      <ul className="mi-keys">
        <Key mark={<HighTideGlyph size={28} />} name="High tide">
          The sand covered: where the water reaches.
        </Key>
        <Key mark={<LowTideGlyph size={28} />} name="Low tide">
          The banks, the channels and the flats bared.
        </Key>
      </ul>
      {(line || error) && (
        <p className={`k-sat${error ? " is-error" : ""}`} role="status">
          {error ?? line}
        </p>
      )}
      {tides && <p className="mi-fig">{satelliteTidesLine(tides)}</p>}
      <p className="mi-sm">
        Sentinel-2&rsquo;s clear looks at that tide, at the nearest tide
        station; the land is one summer composite in both.{" "}
        {SATELLITE_TIDES_NOTE}
      </p>
    </>
  );
}

/** Who we are: the Almanac, and the chart. */
function AboutPart() {
  return (
    <>
      <div className="mi-about">
        <div>
          <Wordmark size="lg" />
          <p className="mi-lede">
            The wind for Ireland&rsquo;s wing foilers, read hour by hour, spot
            by spot.
          </p>
        </div>
        <Puffin size={80} />
      </div>
      <h4>
        The Almanac <small>our voice</small>
      </h4>
      <p>
        The Almanac reads every forecast so you don&rsquo;t have to. The puffin
        signs it, at the foot of the menu.
      </p>
      <h4>
        The chart <small>our look</small>
      </h4>
      <p>
        An Admiralty chart crossed with a broadsheet&rsquo;s weather column:
        paper, ink, the chart&rsquo;s magenta for the best, and a red pen that
        rings the hour you are reading.
      </p>
    </>
  );
}

/** The loupe's rose as the key shows it: no-go, the tack out, the needle, the offshore red. */
function KeyRose() {
  return (
    <svg
      width="96"
      height="96"
      viewBox="-17 -17 34 34"
      aria-hidden="true"
      className="k-rose"
    >
      <path
        className="k-rose-nogo"
        d="M0 0L-10.4 -10.4A14.7 14.7 0 0 1 10.4 -10.4Z"
      />
      <path className="k-rose-out" d="M0 0L13.8 5A14.7 14.7 0 0 1 5 13.8Z" />
      <path className="k-rose-off" d="M-11.3 11.3A16 16 0 0 1 -16 0" />
      <circle className="k-rose-rim" r="14.7" />
      <path
        className="k-rose-needle"
        style={{ fill: `rgb(${windColor(16).join(",")})` }}
        d="M0 -8L-2 -16.5L0 -15L2 -16.5Z"
      />
    </svg>
  );
}

/** A light as the key shows it. */
function KeyLight({
  stars,
  arrow = false,
  struck = false,
  cross = false,
  wedge = false,
}: {
  stars: number;
  arrow?: boolean;
  struck?: boolean;
  cross?: boolean;
  wedge?: boolean;
}) {
  const level = struck ? "off" : `s${stars}`;
  return (
    <svg
      width="34"
      height={arrow || wedge ? 34 : 24}
      viewBox={arrow || wedge ? "-17 -17 34 34" : "-17 -12 34 24"}
      aria-hidden="true"
      className={`k-light lt-key ${level}${cross ? " xoff" : ""}`}
    >
      {wedge && (
        <path className="lt-key-wedge" d="M0 0L15 0A15 15 0 0 1 6.3 13.6Z" />
      )}
      {arrow && (
        <path
          className="lt-arrow"
          d="M5.5 -5.5L13 -13M8.2 -13.4L13.6 -13.6L13.4 -8.2"
        />
      )}
      <circle className="lt-ring" r="7.6" />
      {struck && (
        <line className="lt-strike" x1="-5.6" y1="5.6" x2="5.6" y2="-5.6" />
      )}
      <text className="lt-n" y="3.4" textAnchor="middle">
        {stars}
      </text>
    </svg>
  );
}
