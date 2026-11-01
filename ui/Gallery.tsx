/**
 * The kit gallery, at /ui in development: every part, in the variants and the
 * states that can be held still, with the product's own words. Hover and focus
 * are live: point at a control, or tab through the page, and the same ring
 * should land on each one. Dark is the default; the switch at the top (or the
 * top bar's own button) turns the whole page white, to see both.
 *
 * Loaded by path from src/main.tsx in development mode only, and exported
 * from nowhere, so it is not part of any build.
 */
import {
  ArrowUpRight,
  ChevronLeft,
  Copy,
  Heart,
  MapPin,
  Menu,
  Plus,
  RotateCw,
  X,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  THEME_EVENT,
  chooseTheme,
  currentTheme,
  type Theme,
} from "../shared/web/theme";
import {
  Avatar,
  BeaufortGlyph,
  Button,
  Card,
  Checkbox,
  Chip,
  ConfirmDialog,
  Count,
  Dialog,
  Empty,
  Field,
  Figure,
  Heading,
  Link,
  Notice,
  NoticeMark,
  NumberField,
  Pager,
  RatingTip,
  Row,
  Rows,
  SearchField,
  Segmented,
  Select,
  Skeleton,
  Slider,
  SpotSearch,
  StarGlyphs,
  Switch,
  Tabs,
  Tag,
  TextArea,
  TextInput,
  ThemeButton,
  TopBar,
  Wordmark,
} from "./index";
// The site menu is the chrome's, not the kit's; it is drawn in the top bar
// here as every page draws it.
import { SiteMenu } from "../force5/src/SiteMenu";

/** A few places for the top bar's search, so the gallery reads no file. */
const PLACES = [
  { id: "dollymount", name: "Dollymount", county: "Dublin" },
  { id: "portmarnock", name: "Portmarnock", county: "Dublin" },
  { id: "brandon-bay", name: "Brandon Bay", county: "Kerry" },
  { id: "inch", name: "Inch", county: "Kerry" },
  { id: "beal-ban", name: "Béal Bán", county: "Kerry" },
  { id: "rosslare", name: "Rosslare", county: "Wexford" },
  { id: "bundoran", name: "Bundoran", county: "Donegal" },
];

const PARTS: [string, string][] = [
  ["k-head", "Headings"],
  ["k-btn", "Buttons"],
  ["k-chip", "Chips and tags"],
  ["k-seg", "Tabs and segmented"],
  ["k-form", "Form controls"],
  ["k-rows", "List rows"],
  ["k-notice", "Notices"],
  ["k-empty", "Empty state"],
  ["k-dialog", "Dialog and sheet"],
  ["k-top", "Top bar"],
  ["k-more", "Cards, figures and the rest"],
];

/** A part of the kit: a section heading, a line on why, and its specimens. */
function Part({
  id,
  title,
  why,
  children,
}: {
  id: string;
  title: string;
  why: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      className="grid scroll-mt-20 content-start gap-5 pt-11"
      aria-labelledby={`${id}-h`}
    >
      <Heading id={`${id}-h`} lead={why}>
        {title}
      </Heading>
      <div className="grid gap-x-10 gap-y-7 rail:grid-cols-2">{children}</div>
    </section>
  );
}

/** One specimen: what it is, in a small grey line, and the thing itself. */
function Spec({
  label,
  wide = false,
  children,
}: {
  label: string;
  wide?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={`grid min-w-0 content-start gap-2.5 ${wide ? "rail:col-span-2" : ""}`}
    >
      <p className="m-0 font-body text-label text-ink-muted">{label}</p>
      <div className="grid min-w-0 content-start gap-4">{children}</div>
    </div>
  );
}

const Line = ({ children }: { children: ReactNode }) => (
  <div className="flex flex-wrap items-center gap-2.5">{children}</div>
);

/** The page's theme, followed as the top bar's button changes it. */
function useTheme(): Theme {
  const [theme, setTheme] = useState<Theme>(currentTheme);
  useEffect(() => {
    const follow = () => setTheme(currentTheme());
    window.addEventListener(THEME_EVENT, follow);
    return () => window.removeEventListener(THEME_EVENT, follow);
  }, []);
  return theme;
}

// Written out whole, so the theme's scan finds every class.
const SWATCHES: [string, string][] = [
  ["ground", "bg-ground"],
  ["sunken", "bg-sunken"],
  ["line", "bg-line"],
  ["line-strong", "bg-line-strong"],
  ["ink", "bg-ink"],
  ["ink-2", "bg-ink-2"],
  ["ink-muted", "bg-ink-muted"],
  ["accent", "bg-accent"],
  ["chart-magenta", "bg-chart-magenta"],
  ["pen-ink", "bg-pen-ink"],
  ["ok", "bg-ok"],
  ["warn-ground", "bg-warn-ground"],
  ["met-yellow", "bg-met-yellow"],
  ["met-orange", "bg-met-orange"],
  ["met-red", "bg-met-red"],
  ["stars-1", "bg-stars-1"],
  ["stars-2", "bg-stars-2"],
  ["stars-3", "bg-stars-3"],
  ["stars-4", "bg-stars-4"],
  ["stars-5", "bg-stars-5"],
];

const UNITS = [
  { value: "kn", label: "Knots" },
  { value: "ms", label: "m/s" },
  { value: "kmh", label: "km/h" },
  { value: "mph", label: "mph" },
  { value: "force", label: "Force" },
] as const;
const MODELS = [
  { value: "harmonie", label: "HARMONIE" },
  { value: "icon", label: "ICON-EU" },
  { value: "ecmwf", label: "ECMWF" },
  { value: "gfs", label: "GFS" },
] as const;
const ORDERS = [
  { value: "best", label: "Best first" },
  { value: "near", label: "Nearest" },
  { value: "az", label: "A to Z" },
] as const;
const STARS = ["Any stars", "3+ stars", "4+ stars", "5 stars"] as const;
const ABOUT = [
  { value: "key", label: "The map’s key" },
  { value: "stars", label: "Stars" },
  { value: "wind", label: "Wind and gusts" },
  { value: "blend", label: "The blend and models" },
  { value: "depth", label: "Tidal depth" },
] as const;

export default function Gallery() {
  const theme = useTheme();
  const [view, setView] = useState<"graph" | "table">("graph");
  const [unit, setUnit] = useState<(typeof UNITS)[number]["value"]>("kn");
  const [model, setModel] =
    useState<(typeof MODELS)[number]["value"]>("harmonie");
  const [answer, setAnswer] = useState<"no" | "little" | "yes">("little");
  const [order, setOrder] = useState<(typeof ORDERS)[number]["value"]>("best");
  const [stars, setStars] = useState<(typeof STARS)[number]>("4+ stars");
  const [filters, setFilters] = useState(["Spots named “dolly”", "4+ stars"]);
  const [about, setAbout] = useState<(typeof ABOUT)[number]["value"]>("key");
  const [side, setSide] = useState<(typeof ABOUT)[number]["value"]>("key");
  const [colour, setColour] = useState(true);
  const [live, setLive] = useState(false);
  const [harmonie, setHarmonie] = useState(true);
  const [gusts, setGusts] = useState(35);
  const [weight, setWeight] = useState(80);
  const [saved, setSaved] = useState(false);
  const [whatsapp, setWhatsapp] = useState(true);
  const [page, setPage] = useState(2);
  const [picked, setPicked] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"find" | "confirm" | null>(null);
  const [busy, setBusy] = useState(false);

  return (
    <div className="min-h-dvh bg-ground font-body text-prose text-ink">
      <TopBar
        home="/ui"
        search={
          <SpotSearch
            spots={PLACES}
            onPick={(spot) => setPicked(spot.name)}
            enterLabel="Enter picks the spot"
          />
        }
        view={{ to: "chart", href: "/chart" }}
        menu={<SiteMenu current={null} />}
      />

      <main className="mx-auto grid max-w-page content-start px-safe-6 pt-10 pb-16 max-wide:px-safe-4">
        <div className="grid gap-5">
          <Heading
            level="page"
            lead="The parts every page is built from: Inter, sentence case, flat, kept apart by space and soft cards. Dark is the default; white is the other. Development only."
          >
            The kit
          </Heading>
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              aria-label="Theme"
              value={theme}
              onChange={(next) => chooseTheme(next)}
              options={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "White" },
              ]}
            />
            {picked && (
              <span className="text-body text-ink-2">
                The search picked {picked}.
              </span>
            )}
          </div>
          <nav className="flex flex-wrap gap-2" aria-label="Parts">
            {PARTS.map(([id, name]) => (
              <Button key={id} variant="soft" size="sm" href={`#${id}`}>
                {name}
              </Button>
            ))}
          </nav>
        </div>

        <Part
          id="k-head"
          title="Page heading and section heading"
          why="Inter throughout, sentence case. Fraunces is kept for the wordmark and a spot's name only. Headings are kept apart from what follows by space, not by a rule."
        >
          <Spec label="Page heading, lead and meta">
            <div className="grid gap-2">
              <Heading
                level="page"
                lead="We rate every daylight hour out of five stars, from four numbers: ours, unless you have made them your own in Settings."
              >
                How the stars work
              </Heading>
              <p className="m-0 text-body text-ink-muted">149 riding places</p>
            </div>
          </Spec>
          <Spec label="Section heading, with a link or a count on the right">
            <div className="grid gap-4">
              <Heading
                as="h3"
                aside={<Link href="#k-head">All spots on the chart</Link>}
              >
                The week
              </Heading>
              <Heading as="h3" aside="21 places">
                Dublin
              </Heading>
            </div>
          </Spec>
          <Spec label="Card heading and prose">
            <Card className="grid gap-1.5">
              <Heading level="card" as="h4">
                Launch
              </Heading>
              <p className="m-0 text-prose text-ink-2">
                From the sand at the end of the causeway road. Park well above
                the high-water line.
              </p>
            </Card>
          </Spec>
          <Spec label="The type scale, and the only Fraunces">
            <div className="grid gap-2.5">
              {(
                [
                  ["Wordmark", <Wordmark key="w" />],
                  ["Wordmark, lg", <Wordmark key="wl" size="lg" />],
                  [
                    "A spot's name",
                    <span
                      key="n"
                      className="font-display text-name optical-display max-wide:text-title"
                    >
                      Dollymount
                    </span>,
                  ],
                  [
                    "Page 40",
                    <span key="p" className="text-big max-wide:text-big-sm">
                      Spot forecasts
                    </span>,
                  ],
                  [
                    "Section 19",
                    <span key="s" className="text-lead">
                      Wind strength
                    </span>,
                  ],
                  [
                    "Card 15",
                    <span key="c" className="text-prose font-semibold">
                      Cross-offshore
                    </span>,
                  ],
                  [
                    "Body 15 and 13",
                    <span key="b" className="text-prose text-ink-2">
                      Blows out at an angle.{" "}
                      <span className="text-body">You drift away.</span>
                    </span>,
                  ],
                  [
                    "Label 12",
                    <span key="l" className="text-label text-ink-2">
                      Stars in the next six days
                    </span>,
                  ],
                ] as [string, ReactNode][]
              ).map(([name, sample]) => (
                <div key={name} className="flex items-baseline gap-3">
                  <small className="w-28 shrink-0 text-label text-ink-muted">
                    {name}
                  </small>
                  {sample}
                </div>
              ))}
            </div>
          </Spec>
        </Part>

        <Part
          id="k-btn"
          title="Buttons"
          why="Flat, round-ended, no gradient and no raised shadow. One filled button at most in a view: the thing to do next. The rest are outlined, soft or quiet."
        >
          <Spec label="Filled, outlined, quiet, soft">
            <Line>
              <Button variant="primary">Save</Button>
              <Button>Cancel</Button>
              <Button variant="quiet">Reset to ours</Button>
              <Button variant="soft">Use my location</Button>
            </Line>
          </Spec>
          <Spec label="Sizes: 32, 40 and 48">
            <Line>
              <Button size="sm">Small</Button>
              <Button>Medium</Button>
              <Button size="lg">Large</Button>
              <Button variant="soft" size="lg">
                Large, soft
              </Button>
            </Line>
          </Spec>
          <Spec label="Small, with an icon; disabled">
            <Line>
              <Button size="sm">
                <RotateCw size={16} strokeWidth={1.75} aria-hidden="true" />
                Try again
              </Button>
              <Button size="sm">
                Add to Claude
                <ArrowUpRight size={16} strokeWidth={1.75} aria-hidden="true" />
              </Button>
              <Button size="sm">
                Copy address
                <Copy size={16} strokeWidth={1.75} aria-hidden="true" />
              </Button>
              <Button size="sm" disabled>
                Show spots
              </Button>
              <Button size="sm" variant="primary" disabled>
                Save
              </Button>
            </Line>
          </Spec>
          <Spec label="Icon buttons: outlined, quiet; the theme's">
            <Line>
              <Button icon aria-label="Close">
                <X size={18} strokeWidth={1.75} aria-hidden="true" />
              </Button>
              <Button icon aria-label="Menu">
                <Menu size={18} strokeWidth={1.75} aria-hidden="true" />
              </Button>
              <ThemeButton />
              <Button variant="quiet" icon aria-label="Close">
                <X size={18} strokeWidth={1.75} aria-hidden="true" />
              </Button>
              <Button variant="quiet" icon aria-label="Earlier">
                <ChevronLeft size={18} strokeWidth={1.75} aria-hidden="true" />
              </Button>
              <Button variant="soft" size="sm" icon aria-label="Add">
                <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
              </Button>
            </Line>
          </Spec>
          <Spec label="A toggle: pressed, and one whose words say so">
            <Line>
              <Button pressed>Wings</Button>
              <Button pressed={false}>Boards</Button>
              <Button
                pressed={saved ? "worded" : false}
                onClick={() => setSaved(!saved)}
              >
                <Heart
                  size={16}
                  strokeWidth={1.75}
                  fill={saved ? "currentColor" : "none"}
                  aria-hidden="true"
                />
                {saved ? "Saved" : "Save"}
              </Button>
            </Line>
          </Spec>
          <Spec label="A link in running text; the one destructive answer">
            <p className="m-0 text-prose text-ink-2">
              Issued by Met Éireann (CC BY 4.0).{" "}
              <Button variant="link" href="#k-btn">
                The latest at met.ie
              </Button>{" "}
              Or read the <Link href="#k-btn">house rules</Link>.
            </p>
            <Line>
              <Button variant="danger" onClick={() => setDialog("confirm")}>
                Delete listing
              </Button>
            </Line>
          </Spec>
        </Part>

        <Part
          id="k-chip"
          title="Chips and tags"
          why="Chips are choices you can press. Tags are words that describe something and cannot be pressed. Neither is ever in capitals."
        >
          <Spec label="Choice chips, one pressed">
            <Line>
              {STARS.map((s) => (
                <Chip key={s} pressed={stars === s} onClick={() => setStars(s)}>
                  {s}
                </Chip>
              ))}
            </Line>
          </Spec>
          <Spec label="A filter in use, removable">
            <Line>
              {filters.map((f) => (
                <Chip
                  key={f}
                  removable
                  aria-label={`${f}, remove`}
                  onClick={() => setFilters(filters.filter((x) => x !== f))}
                >
                  {f}
                </Chip>
              ))}
              <Button
                variant="quiet"
                size="sm"
                onClick={() => setFilters(["Spots named “dolly”", "4+ stars"])}
              >
                {filters.length ? "Clear" : "Put them back"}
              </Button>
            </Line>
          </Spec>
          <Spec label="Tags: words, not buttons">
            <Line>
              <Tag tone="off">Offshore</Tag>
              <Tag>Unsure</Tag>
              <Tag>Fairly sure</Tag>
              <Tag tone="ok">now</Tag>
              <Tag>coming</Tag>
              <Tag>no data</Tag>
            </Line>
            <div className="flex rounded-surface bg-depth p-4">
              <Tag tone="glass">Saved, over a photograph</Tag>
            </div>
          </Spec>
          <Spec label="Status words inline, as on the week's cards">
            <Line>
              <span className="text-body font-medium text-pen-ink">
                Offshore
              </span>
              <span className="text-body text-ink-muted">Unsure</span>
              <StarGlyphs stars={4} coloured />
            </Line>
          </Spec>
        </Part>

        <Part
          id="k-seg"
          title="Tabs and segmented control"
          why="The segmented control picks one of a few short options, up to five, so all of them are visible. Tabs move between the parts of one page or dialog."
        >
          <Spec label="Segmented: two to five options">
            <div className="grid justify-items-start gap-3">
              <Segmented
                aria-label="Show the hours as"
                value={view}
                onChange={setView}
                options={[
                  { value: "graph", label: "Graph" },
                  { value: "table", label: "Table" },
                ]}
              />
              <Segmented
                aria-label="Wind in"
                value={unit}
                onChange={setUnit}
                options={UNITS}
              />
              <Segmented
                aria-label="Model"
                value={model}
                onChange={setModel}
                options={MODELS}
              />
              <Segmented
                aria-label="Wind in, small"
                size="sm"
                value={unit}
                onChange={setUnit}
                options={UNITS.slice(0, 3)}
              />
            </div>
          </Spec>
          <Spec label="Full width, larger: a question with three answers">
            <Segmented
              aria-label="Have you ridden a foil?"
              size="lg"
              full
              value={answer}
              onChange={setAnswer}
              options={[
                { value: "no", label: "Not yet" },
                { value: "little", label: "A little" },
                { value: "yes", label: "Yes" },
              ]}
            />
          </Spec>
          <Spec label="Tabs across: a phone, or a page's parts" wide>
            <Tabs
              aria-label="About the map"
              value={about}
              onChange={setAbout}
              tabs={ABOUT}
            />
          </Spec>
          <Spec label="Tabs down the side: a wide dialog">
            <Tabs
              aria-label="About the map, down the side"
              vertical
              className="max-w-60"
              value={side}
              onChange={setSide}
              tabs={ABOUT.slice(0, 3)}
            />
          </Spec>
        </Part>

        <Part
          id="k-form"
          title="Form controls"
          why="Filled fields with no underline or box rule; the label above in grey, a hint under it. Switches for on and off, which take effect at once."
        >
          <Spec label="Switches, in rows">
            <Rows>
              <Row
                inList
                title="Wind in colour"
                end={
                  <Switch
                    checked={colour}
                    onChange={setColour}
                    aria-label="Wind in colour"
                  />
                }
              />
              <Row
                inList
                title="Live wind"
                detail="Buoys and stations, the latest reading"
                end={
                  <Switch
                    checked={live}
                    onChange={setLive}
                    aria-label="Live wind"
                  />
                }
              />
            </Rows>
          </Spec>
          <Spec label="A slider with its value; a number with steps">
            <Field label="Too strong in gusts above" htmlFor="g-gusts">
              <Slider
                id="g-gusts"
                value={gusts}
                min={15}
                max={45}
                unit="kn"
                onChange={setGusts}
              />
            </Field>
            <Field
              label="Weight"
              hint="Your weight helps us suggest the right wing size."
            >
              <span>
                <NumberField
                  aria-label="Weight"
                  value={weight}
                  min={40}
                  max={130}
                  unit="kg"
                  less="Lighter"
                  more="Heavier"
                  onChange={setWeight}
                />
              </span>
            </Field>
          </Spec>
          <Spec label="Select; a search; a text field; a hint and an error">
            <Field label="Order" htmlFor="g-order">
              <Select id="g-order" defaultValue="best">
                <option value="best">Best first</option>
                <option value="near">Nearest</option>
                <option value="az">A to Z</option>
              </Select>
            </Field>
            <SearchField
              aria-label="A spot's name"
              placeholder="A spot’s name…"
            />
            <Field label="Price" hint="In euro, whole" htmlFor="g-price">
              <TextInput id="g-price" prefix="€" inputMode="numeric" />
            </Field>
            <Field
              label="Title"
              error="Give the thread a title"
              htmlFor="g-bad"
            >
              <TextInput id="g-bad" aria-invalid />
            </Field>
          </Spec>
          <Spec label="A text area; a checkbox; disabled">
            <Field label="Message" htmlFor="g-body">
              <TextArea id="g-body" placeholder="Say it plainly…" />
            </Field>
            <Checkbox
              checked={whatsapp}
              onChange={(event) => setWhatsapp(event.target.checked)}
            >
              Buyers can message this number
            </Checkbox>
            <Checkbox disabled>Add a phone number first</Checkbox>
            <Field label="Spot" htmlFor="g-off">
              <TextInput id="g-off" defaultValue="Dollymount" disabled />
            </Field>
          </Spec>
        </Part>

        <Part
          id="k-rows"
          title="List rows"
          why="Rows sit together in one soft card, with a hairline between them inside the card. No rule above or below the list."
        >
          <Spec label="Links to pages">
            <Rows>
              <Row
                inList
                href="#k-rows"
                title="Dollymount"
                detail="Dublin"
                chevron
              />
              <Row
                inList
                href="#k-rows"
                title="Brandon Bay"
                detail="Kerry"
                chevron
              />
            </Rows>
          </Spec>
          <Spec label="A setting with its value">
            <Rows>
              <Row
                inList
                title="Cross-offshore"
                detail="Blows out at an angle. You drift away from the beach."
                end="1 star off"
              />
              <Row
                inList
                title="Offshore"
                detail="Blows out to sea. We don’t recommend going out in it."
                end={<span className="font-medium text-pen-ink">No stars</span>}
              />
            </Rows>
          </Spec>
          <Spec label="A key: the mark, its name, what it means">
            <Rows>
              <Row
                inList
                lead={
                  <span className="grid size-7 place-items-center rounded-full bg-stars-5 text-label font-semibold text-ink-inverse">
                    5
                  </span>
                }
                title="Five stars"
                detail="The deepest of the stars’ colours."
              />
              <Row
                inList
                lead={
                  <span className="grid size-7 place-items-center rounded-full border border-dashed border-ink-muted text-caption font-semibold text-ink-muted">
                    0
                  </span>
                }
                title="None now"
                detail="Dashed: no stars at this hour."
              />
            </Rows>
          </Spec>
          <Spec label="A model to include, with a switch; one not yet here">
            <Rows>
              <Row
                inList
                lead={<span className="size-2.5 rounded-full bg-ok" />}
                title="HARMONIE"
                detail="2 km · 2½ days"
                end={
                  <Switch
                    checked={harmonie}
                    onChange={setHarmonie}
                    aria-label="HARMONIE in the blend"
                  />
                }
              />
              <Row
                inList
                dim
                lead={<span className="size-2.5 rounded-full bg-line-strong" />}
                title="UKV"
                detail="coming"
                end={
                  <Switch
                    checked={false}
                    onChange={() => {}}
                    disabled
                    aria-label="UKV in the blend"
                  />
                }
              />
            </Rows>
          </Spec>
        </Part>

        <Part
          id="k-notice"
          title="Notices: weather warnings and bathing water"
          why="A quiet card each. The level is a coloured square with its sign, and is said in words in the title, not in a capital chip. No coloured bar down the side. What it does to the stars is said on the second line."
        >
          <Spec label="Weather warnings, and the source under the group">
            <div className="grid gap-2">
              <Notice
                level="orange"
                defaultOpen
                title="Orange wind warning for Kerry"
                details="Wind warning: Kerry. Very strong southwest winds will veer westerly with severe gusts and coastal gales. Be aware of potential impacts: debris and loose objects displaced, large coastal waves, some fallen trees and branches."
              >
                Mon 14 Sept, 13:00 to 16:00 ·{" "}
                <span className="font-medium text-ink">
                  no stars for these hours
                </span>
              </Notice>
              <Notice
                level="yellow"
                title="Yellow small craft warning for all coasts of Ireland"
                details="Small craft warning (marine): all coasts of Ireland. Southwest winds will reach force 6 at times."
              >
                Mon 14 Sept, 09:00 to 12:00 · stars still shown
              </Notice>
              <Notice level="red" title="Red wind warning for Galway and Mayo">
                Tue 15 Sept, 03:00 to 09:00 ·{" "}
                <span className="font-medium text-ink">
                  no stars for these hours
                </span>
              </Notice>
            </div>
            <p className="m-0 text-body text-ink-muted">
              Issued by Met Éireann (CC BY 4.0).{" "}
              <Link href="#k-notice">The latest at met.ie</Link>
            </p>
          </Spec>
          <Spec label="Bathing water">
            <div className="grid gap-2">
              <Notice
                level="water"
                title="Bathing is prohibited"
                details={
                  <>
                    Water quality deteriorated due to suspected storm water
                    overflow. Portmarnock, Velvet Strand Beach, 0.4 km away ·{" "}
                    <Link href="#k-notice">The council’s notice</Link>
                  </>
                }
              >
                From Mon 14 Sept, expected to last 5 days, until lifted ·{" "}
                <span className="font-medium text-ink">
                  no stars while it lasts
                </span>
              </Notice>
              <Notice
                level="water-advice"
                title="Prior warning: bathing water quality may be affected"
                details="Risk of deterioration in water quality due to expected heavy rainfall. Clonea Beach, 1.2 km away."
              >
                Until lifted · stars still shown
              </Notice>
            </div>
            <p className="m-0 text-body text-ink-muted">
              From the EPA, as the council issued it (CC BY 4.0).
            </p>
          </Spec>
          <Spec label="A plain notice: something went wrong; info and warn">
            <div className="grid gap-2">
              <Notice
                alert
                title="The forecast could not be read just now"
                action={
                  <Button size="sm">
                    <RotateCw size={16} strokeWidth={1.75} aria-hidden="true" />
                    Try again
                  </Button>
                }
              >
                Failed to fetch. Check your connection.
              </Notice>
              <Notice title="Your listing is saved as a draft" />
              <Notice level="warn" title="You are offline">
                What you write is kept until you are back.
              </Notice>
            </div>
          </Spec>
          <Spec label="The mark, where a notice takes the stars' place">
            <Line>
              <NoticeMark level="yellow">Yellow warning</NoticeMark>
              <NoticeMark level="orange">Orange warning</NoticeMark>
              <NoticeMark level="red">Red warning</NoticeMark>
              <NoticeMark level="water">Water</NoticeMark>
              <NoticeMark level="water-advice">Water advice</NoticeMark>
            </Line>
            <Line>
              <NoticeMark level="orange" size="md">
                Orange warning
              </NoticeMark>
              <NoticeMark level="water" size="md" />
            </Line>
          </Spec>
        </Part>

        <Part
          id="k-empty"
          title="Empty state"
          why="For nothing found, not found and could not load. Centred, with no frame round it; the title in Inter. A load error is a notice with Try again."
        >
          <Spec label="Not found, with the way on">
            <Empty
              title="No riding place at this address"
              icon={<MapPin size={24} strokeWidth={1.75} />}
              actions={
                <>
                  <Button variant="primary" href="#k-empty">
                    Dollymount
                  </Button>
                  <Button href="#k-empty">All places</Button>
                </>
              }
            >
              Nothing is called “dollymont”. Did you mean Dollymount?
            </Empty>
          </Spec>
          <Spec label="Nothing found; and inline, inside a list">
            <Empty title="No spots match" as="p">
              Try fewer stars, or another model.
            </Empty>
            <Rows as="div">
              <div className="grid min-h-18 place-items-center text-prose text-ink-2">
                No spot by that name.
              </div>
            </Rows>
          </Spec>
        </Part>

        <Part
          id="k-dialog"
          title="Dialog on a computer, sheet on a phone"
          why="One component with two shapes. On a wide screen a dialog in the middle; under 640px it rises from the foot as a sheet, with the actions full width within reach of a thumb."
        >
          <Spec label="Open one, then narrow the window under 640px">
            <Line>
              <Button onClick={() => setDialog("find")}>Find a spot</Button>
              <Button variant="danger" onClick={() => setDialog("confirm")}>
                Delete listing
              </Button>
            </Line>
          </Spec>
          <Dialog
            open={dialog === "find"}
            title="Find a spot"
            onClose={() => setDialog(null)}
            actions={
              <>
                <Button variant="quiet" onClick={() => setDialog(null)}>
                  Clear
                </Button>
                <Button variant="primary" onClick={() => setDialog(null)}>
                  Show 12 spots
                </Button>
              </>
            }
          >
            <SearchField
              aria-label="A spot's name"
              placeholder="A spot’s name…"
            />
            <Field label="Order">
              <Segmented
                aria-label="Order"
                full
                value={order}
                onChange={setOrder}
                options={ORDERS}
              />
            </Field>
            <Field label="Stars in the next six days">
              <div className="flex flex-wrap gap-2">
                {STARS.map((s) => (
                  <Chip
                    key={s}
                    pressed={stars === s}
                    onClick={() => setStars(s)}
                  >
                    {s}
                  </Chip>
                ))}
              </div>
            </Field>
            <Field label="Model for the stars">
              <Segmented
                aria-label="Model for the stars"
                full
                value={model}
                onChange={setModel}
                options={MODELS}
              />
            </Field>
          </Dialog>
          <ConfirmDialog
            open={dialog === "confirm"}
            title="Delete this listing?"
            confirmLabel={busy ? "Deleting…" : "Delete listing"}
            busy={busy}
            onCancel={() => setDialog(null)}
            onConfirm={() => {
              setBusy(true);
              window.setTimeout(() => {
                setBusy(false);
                setDialog(null);
              }, 1200);
            }}
          >
            Its photos go with it. This cannot be undone.
          </ConfirmDialog>
        </Part>

        <Part
          id="k-top"
          title="Top bar"
          why="The one bar, on every page: the wordmark, the search, the other view, light or dark, and the menu at the right. On a phone the search folds into a round button and light or dark moves into the menu. The page's own is at the top; here is one with a section's actions."
        >
          <Spec label="With a section's own actions, to the spots" wide>
            <div className="overflow-hidden rounded-surface ring-1 ring-line">
              <TopBar
                home="#k-top"
                actions={
                  <Button variant="primary" size="sm">
                    <Plus size={16} strokeWidth={1.75} aria-hidden="true" />
                    Sell
                  </Button>
                }
                view={{ to: "spots", href: "#k-top" }}
                theme={false}
                menu={
                  <Button icon aria-label="Menu">
                    <Menu size={18} strokeWidth={1.75} aria-hidden="true" />
                  </Button>
                }
              />
            </div>
          </Spec>
        </Part>

        <Part
          id="k-more"
          title="Cards, figures and the rest"
          why="The soft card and the floating one; who wrote it; how many; where in a list; what is loading; and the chart's own figures."
        >
          <Spec label="Card: soft on a page, floating over the map">
            <div className="grid gap-3 wide:grid-cols-2">
              <Card>
                <Heading level="card" as="h4">
                  Soft
                </Heading>
                <p className="m-0 mt-1 text-body text-ink-2">
                  A shade off the ground, no rule, no shadow.
                </p>
              </Card>
              <div className="rounded-surface bg-sea p-4">
                <Card kind="float">
                  <Heading level="card" as="h4">
                    Float
                  </Heading>
                  <p className="m-0 mt-1 text-body text-ink-2">
                    Over the chart.
                  </p>
                </Card>
              </div>
            </div>
          </Spec>
          <Spec label="Avatar, count and pager">
            <Line>
              <Avatar name="Aoife Byrne" size="sm" />
              <Avatar name="Aoife Byrne" />
              <Avatar name="Aoife Byrne" size="lg" />
              <Avatar name="Niamh Walsh" src="/no-such-photo.jpg" />
              <Count value={4} label="unread" />
              <Count value={120} />
              <Count value={3} tone="quiet" />
            </Line>
            <Pager page={page} pageSize={20} total={58} onPage={setPage} />
          </Spec>
          <Spec label="Skeleton: the shape of what is loading">
            <div className="grid gap-3" aria-busy="true">
              <div className="flex items-center gap-3">
                <Skeleton shape="circle" />
                <div className="grid flex-1 gap-2">
                  <Skeleton />
                  <Skeleton className="w-2/3" />
                </div>
              </div>
              <Skeleton shape="block" />
            </div>
          </Spec>
          <Spec label="Stars: 0 to 5, coloured, faded for the wind alone, the dark; with the tip">
            <Line>
              <StarGlyphs stars={0} />
              <StarGlyphs stars={1} potential={3} />
              <StarGlyphs stars={3} potential={4} />
              <StarGlyphs stars={5} />
              <StarGlyphs stars={3} potential={5} coloured />
              <StarGlyphs stars={5} coloured />
              <StarGlyphs stars={null} />
              <RatingTip
                label="3 of 5 stars"
                detail="Three stars: 18 knots from the west-southwest, cross-shore, on a 5 m wing."
              >
                <StarGlyphs stars={3} potential={4} coloured />
              </RatingTip>
            </Line>
          </Spec>
          <Spec label="Figure, and the force's glyph 0 to 12">
            <Line>
              <Figure size="sm" value={12} unit="kn" />
              <Figure value={14} sup={22} unit="kn" />
              <Figure size="lg" value={18} unit="kn" />
              <Figure value={13} sup={26} alarm />
            </Line>
            <Line>
              {Array.from({ length: 13 }, (_, force) => (
                <span key={force} className="text-figure">
                  <BeaufortGlyph force={force} size={17} />
                </span>
              ))}
            </Line>
          </Spec>
          <Spec label="Colours, as the theme in view has them" wide>
            <div className="flex flex-wrap gap-3">
              {SWATCHES.map(([name, fill]) => (
                <figure key={name} className="m-0 grid w-24 gap-1.5">
                  <span
                    className={`block h-10 rounded-control ring-1 ring-line ${fill}`}
                  />
                  <figcaption className="text-caption text-ink-muted">
                    {name}
                  </figcaption>
                </figure>
              ))}
            </div>
          </Spec>
        </Part>
      </main>
    </div>
  );
}
