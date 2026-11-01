/**
 * The one site menu, in every app.
 *
 * wingfoil.ie is three bundles on one origin and `src/main.tsx` chooses between
 * them from the pathname, so the menu's rows are plain `<a href>`: moving
 * between the map, the marketplace and the community is a page load by
 * construction, and a client router cannot do it. Inside each app its own
 * router still owns its own routes.
 *
 * The map imports this through `force5/src`; the marketplace and the community
 * import this file directly, so no bundle picks up another by importing a
 * barrel. It reads the kit file by file for the same reason.
 *
 * Drawn from ui/ and the theme, like the pages it sits in: ui/theme.css scans
 * this one file of force5/src (and none of the map's), so its classes resolve
 * in every bundle.
 *
 * The menu is a drawer from the right, where its button is at the far right
 * of the top bar on every page (ui/TopBar.tsx): a modal <dialog> over the
 * kit's backdrop, so the focus is trapped in it and the page behind is inert.
 * A quiet sheet: the wordmark and a close button at the bar's height, the
 * site's navigation in named groups with one line icon a row and no rules
 * between them, the page you are on on a soft pill with "You're here", and
 * at the foot Light, Dark or Auto. A finger can push it back off to the right.
 *
 * The navigation is one menu, in one order, wherever it is opened: the
 * forecast, your settings, help, then the site's other sections, Use with AI
 * last (force5/src/siteNav.ts). The chart's layers are not in it: they are
 * the rail beside the zoom (src/LayerRail.tsx).
 */
import { Menu, Moon, Sun, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useFadeOut } from "../../ui/Backdrop";
import { Button } from "../../ui/Button";
import { backdropPress, onBackdrop } from "../../ui/Dialog";
import { Segmented } from "../../ui/Segmented";
import { RING, tv } from "../../ui/tv";
import { Wordmark } from "../../ui/Wordmark";
import { ChartGlyph } from "../../shared/web/ChartGlyph";
import { FEATURES, type SiteFeatures } from "../../shared/web/features";
import {
  THEME_EVENT,
  chooseTheme,
  themeChoice,
  type ThemeChoice,
} from "../../shared/web/theme";
import {
  about,
  community,
  displayOptions,
  market,
  settings,
  spotFinder,
  starsFrom,
  tour,
  useWithAi,
  windMap,
  type GlyphDef,
} from "../../shared/web/glyphSet";
import {
  SECTIONS_GROUP_NAME,
  SITE_NAV_GROUPS,
  siteSections,
  type SiteNavId,
  type SitePageId,
  type SiteSectionId,
} from "./siteNav";

/*
 * The one hook left on the menu, and it draws nothing: e2e/site-menu.spec.ts
 * finds the menu by it, to hide it and to ask whether a tap landed on it.
 */
const HOOK = "f5-site-menu";

/** Each row's glyph, beside its name in the drawer. */
const ROW_GLYPH: Record<SiteNavId | Exclude<SiteSectionId, "map">, GlyphDef> = {
  chart: windMap,
  finder: spotFinder,
  settings,
  options: displayOptions,
  about,
  stars: starsFrom,
  tour,
  market,
  community,
  ai: useWithAi,
};

/*
 * How a finger puts the drawer away. A press has to travel a few pixels to the
 * right, and more right than up or down, before it is a drag at all: a tap on a
 * row, or a scroll down a long list, is not one. Let go past CLOSE_AT pixels,
 * or flicked faster than FLICK pixels a millisecond, it shuts; otherwise it
 * springs back.
 */
export const DRAG = { SLOP: 8, CLOSE_AT: 70, FLICK: 0.5 } as const;

export const siteMenuStyles = tv({
  slots: {
    root: `${HOOK} pointer-events-auto relative inline-flex`,
    /*
     * The drawer: the full height of the screen at the right edge, on the
     * ground, its corners facing the page rounded to a sheet's, one soft
     * shadow (and in dark a faint edge). Its list scrolls between the head
     * and the foot, and it leaves the vertical pan to the browser so a
     * sideways drag is the script's.
     */
    drawer: [
      "fixed inset-y-0 right-0 left-auto m-0 h-dvh max-h-none w-90 max-w-11/12 open:flex open:flex-col",
      "overscroll-contain touch-pan-y",
      "rounded-l-dialog border-0 bg-ground p-0 shadow-sheet dark:ring-1 dark:ring-line",
      "pt-safe-0 pb-safe-0 font-body text-ink",
      "backdrop:scrim drawer-slide",
    ],
    // The wordmark and the close button, at the top bar's height. Space, not
    // a rule, sets it off from the rows.
    head: "flex h-16 shrink-0 items-center justify-between gap-3 pr-3 pl-6 max-wide:h-14 max-wide:pl-5",
    body: "min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-4",
    group: "mt-4.5 first:mt-0",
    groupName: "m-0 px-3 pb-1.5 font-body text-body font-medium text-ink-muted",
    list: "m-0 flex list-none flex-col gap-0.5 p-0",
    /*
     * A row: a name with its line icon, the height of touch, on a soft pill
     * under the pointer. No rule between rows.
     */
    row: [
      "flex h-touch w-full items-center gap-3 rounded-control px-3",
      "font-body text-prose font-medium text-ink no-underline",
      "transition-colors duration-fast not-disabled:hover:bg-sunken",
      RING,
    ],
    glyph: "inline-flex size-5 shrink-0 items-center justify-center text-ink-2",
    // "You're here", or a quiet "Preview", at the row's end.
    end: "ml-auto font-body text-label font-medium text-ink-muted",
    preview: "rounded-full bg-sunken px-2 py-0.5",
    // Light, dark or auto, and the one line every page owes a rider.
    foot: "grid shrink-0 gap-3 px-6 pt-3.5 pb-5 max-wide:px-5",
    appearance: "flex items-center justify-between gap-3 font-body text-prose font-medium",
    small: "m-0 font-body text-label leading-normal text-ink-muted",
  },
  variants: {
    /*
     * The page you are on: on the soft pill and in semibold, with "You're
     * here" at its end, so the state is not said by colour alone. The
     * machine-readable half is `aria-current="page"`.
     */
    current: { true: { row: "bg-sunken font-semibold", glyph: "text-ink" } },
  },
});

/** A finger on the drawer: where it went down, and how it has moved since. */
interface Drag {
  id: number;
  x0: number;
  y0: number;
  dx: number;
  /** When it last moved, and how fast, in pixels a millisecond. */
  at: number;
  speed: number;
  /** Past the slop, and to the right: the drawer follows it. */
  active: boolean;
}

/**
 * Whether a drag let go here puts the drawer away: far enough, or a flick.
 * A flick has to have moved lately, so a drag held still before it is let go
 * springs back unless it is past the line.
 */
export function dragCloses(
  drag: { dx: number; speed: number; at: number },
  now: number,
): boolean {
  const flick = now - drag.at < 100 && drag.speed > DRAG.FLICK;
  return drag.dx > DRAG.CLOSE_AT || (flick && drag.dx > 2 * DRAG.SLOP);
}

/** A plain press: not one for a new tab or window, nor a middle click. */
const plainPress = (event: ReactMouseEvent) =>
  event.button === 0 &&
  !event.metaKey &&
  !event.ctrlKey &&
  !event.shiftKey &&
  !event.altKey;

/**
 * The site's navigation, the same rows in the same order on every page, in
 * its named groups (SITE_NAV_GROUPS), then the site's other sections, Use
 * with AI last. Each is a link with its line icon, and the page you are on is
 * marked. Only the sections switched on in this build are drawn: with the
 * marketplace or the community off (as production has them,
 * shared/web/features.ts), nothing of it is; on, they say "Preview".
 */
export function SiteNav({
  current,
  go = {},
  features = FEATURES,
  first,
  onFollow,
}: {
  current: SitePageId | null;
  /**
   * The map's own way to a row, in place of the page load, where the page
   * has one: the chart and the spot finder are one bundle, and Settings, the
   * display options, About and the tour are dialogs of theirs. A press for a
   * new tab is still the browser's.
   */
  go?: Partial<Record<SiteNavId, () => void>>;
  features?: Pick<SiteFeatures, "market" | "community">;
  /** Handed the first row, for the drawer to focus as it opens. */
  first?: (el: HTMLAnchorElement | null) => void;
  /** Following a row: the drawer shuts. */
  onFollow?: () => void;
}) {
  const styles = siteMenuStyles();
  const groupId = useId();
  const row = (
    {
      id,
      href,
      label,
    }: { id: keyof typeof ROW_GLYPH; href: string; label: string },
    index: number,
  ) => {
    const here = id === current;
    const own = go[id as SiteNavId];
    const preview = id === "market" || id === "community";
    const s = siteMenuStyles({ current: here });
    return (
      <li key={id}>
        <a
          ref={index === 0 ? first : undefined}
          className={s.row()}
          href={href}
          aria-current={here ? "page" : undefined}
          // A mouse dragging a link drags the link itself, and the drawer
          // never hears the drag that would push it away.
          draggable={false}
          // Following a row closes the menu: the map, kept under the page the
          // row opens (src/PagesOverMap.tsx), comes back with its menu shut.
          // The page you are on is not opened again, only the menu shut.
          onClick={(event) => {
            if (plainPress(event) && (here || own)) {
              event.preventDefault();
              onFollow?.();
              if (!here) own?.();
              return;
            }
            onFollow?.();
          }}
        >
          <span className={s.glyph()}>
            <ChartGlyph glyph={ROW_GLYPH[id]} />
          </span>
          {label}
          {/* Said in words for the eye; a screen reader hears the page
              you are on from `aria-current`, and the row's name stays the
              page's own. */}
          {here ? (
            <span className={s.end()} aria-hidden="true">
              You’re here
            </span>
          ) : (
            preview && (
              <span
                className={s.end({ className: s.preview() })}
                aria-hidden="true"
              >
                Preview
              </span>
            )
          )}
        </a>
      </li>
    );
  };
  // The map is the chart, in the navigation: it is not a section again.
  const sections = siteSections(features).flatMap((section) =>
    section.id === "map" ? [] : [{ ...section, id: section.id }],
  );
  const groups = [
    ...SITE_NAV_GROUPS.map((group) => ({
      name: group.name,
      rows: group.rows as readonly {
        id: keyof typeof ROW_GLYPH;
        href: string;
        label: string;
      }[],
    })),
    { name: SECTIONS_GROUP_NAME, rows: sections },
  ];
  let index = 0;
  return (
    <nav aria-label="Site">
      {groups.map((group, g) => (
        <section
          key={group.name}
          className={styles.group()}
          aria-labelledby={`${groupId}-${g}`}
        >
          <h2 className={styles.groupName()} id={`${groupId}-${g}`}>
            {group.name}
          </h2>
          <ul className={styles.list()}>
            {group.rows.map((entry) => row(entry, index++))}
          </ul>
        </section>
      ))}
    </nav>
  );
}

const APPEARANCE = [
  {
    value: "light",
    label: (
      <>
        <Sun size={15} strokeWidth={1.75} aria-hidden="true" />
        Light
      </>
    ),
  },
  {
    value: "dark",
    label: (
      <>
        <Moon size={15} strokeWidth={1.75} aria-hidden="true" />
        Dark
      </>
    ),
  },
  { value: "system", label: "Auto" },
] as const;

/**
 * Light, dark, or the device's (auto), kept on this device
 * (shared/web/theme.ts). On a phone the top bar has no room for its theme
 * button, so the menu carries the choice on every width.
 */
function Appearance() {
  const styles = siteMenuStyles();
  const [choice, setChoice] = useState<ThemeChoice>(themeChoice);
  useEffect(() => {
    const follow = () => setChoice(themeChoice());
    window.addEventListener(THEME_EVENT, follow);
    return () => window.removeEventListener(THEME_EVENT, follow);
  }, []);
  return (
    <div className={styles.appearance()} data-appearance>
      <span>Appearance</span>
      <Segmented
        aria-label="Appearance"
        size="sm"
        options={APPEARANCE}
        value={choice}
        onChange={(next) => {
          chooseTheme(next);
          setChoice(next);
        }}
      />
    </div>
  );
}

export function SiteMenu({
  /**
   * The page this is, of the navigation's and the sections', or null for a
   * page that is neither (a spot's). Named by the caller rather than read from
   * the URL during render: each app already knows which one it is, and
   * deriving it here would make the menu depend on the location twice over.
   */
  current,
  /** The page's own way to a row of the navigation (`SiteNav`'s `go`). */
  go,
  /** Which sections are switched on: the build's, unless a test says. */
  features = FEATURES,
}: {
  current: SitePageId | null;
  go?: Partial<Record<SiteNavId, () => void>>;
  features?: Pick<SiteFeatures, "market" | "community">;
}) {
  const [open, setOpen] = useState(false);
  // Kept the slide's length after it shuts, so it can slide out.
  const shown = useFadeOut(open);
  const drawerId = useId();
  const drawer = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstRow = useRef<HTMLElement | null>(null);
  const drag = useRef<Drag | null>(null);
  // A drag ends in a click on whatever it let go over: that click is the
  // drag's, not a press of the row.
  const dragged = useRef(false);
  const [press] = useState(() => backdropPress(() => drawer.current));

  /*
   * Shut at once, here rather than in an effect: a tool's dialog opens in the
   * same breath, and must find this one closed and the focus on the trigger,
   * to give it back there when it shuts in turn.
   */
  const close = useCallback(() => {
    const el = drawer.current;
    if (el) {
      // Whatever a finger left on it goes, so it slides out from there.
      el.style.transition = "";
      el.style.transform = "";
      if (el.open) el.close();
    }
    drag.current = null;
    setOpen(false);
    trigger.current?.focus();
  }, []);

  useEffect(() => {
    const el = drawer.current;
    if (!open || !el) return;
    if (!el.open) el.showModal();
    // The browser focuses the close button; the first row is what was asked.
    firstRow.current?.focus();
    // The page under it holds still while it is open.
    const root = document.documentElement;
    const overflow = root.style.overflow;
    root.style.overflow = "hidden";
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The map has a global Escape handler of its own, which closes the
      // search, the display options, the spot card or the sheet. Capturing on the
      // document and stopping there is what makes Escape with this menu open
      // mean "close this menu" and nothing else.
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      root.style.overflow = overflow;
    };
  }, [open, close]);

  // Unmounted while open (a page swapped under it), it lets the page go.
  useEffect(() => () => drawer.current?.close(), []);

  const onPointerDown = (event: ReactPointerEvent<HTMLDialogElement>) => {
    press.down(event);
    dragged.current = false;
    if (event.button !== 0 || onBackdrop(drawer.current, event)) return;
    drag.current = {
      id: event.pointerId,
      x0: event.clientX,
      y0: event.clientY,
      dx: 0,
      at: event.timeStamp,
      speed: 0,
      active: false,
    };
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDialogElement>) => {
    const d = drag.current;
    const el = drawer.current;
    if (!d || !el || event.pointerId !== d.id) return;
    const dx = event.clientX - d.x0;
    const dy = event.clientY - d.y0;
    if (!d.active) {
      if (Math.abs(dx) < DRAG.SLOP && Math.abs(dy) < DRAG.SLOP) return;
      // Down, up or to the left: a scroll or a slip, not a drag.
      if (dx < 0 || Math.abs(dy) >= Math.abs(dx)) {
        drag.current = null;
        return;
      }
      d.active = true;
      // Held on the drawer however far the finger strays. A pointer the
      // browser no longer knows (a scripted one) cannot be held, and the
      // drag goes on without.
      try {
        el.setPointerCapture(event.pointerId);
      } catch {
        // Nothing to hold.
      }
      el.style.transition = "none";
    }
    const next = Math.max(0, dx);
    const dt = event.timeStamp - d.at;
    // Events can come in the same millisecond; a finger never moves in none.
    d.speed = (next - d.dx) / Math.max(dt, 1);
    d.dx = next;
    d.at = event.timeStamp;
    el.style.transform = `translateX(${next}px)`;
  };

  const onPointerEnd = (event: ReactPointerEvent<HTMLDialogElement>) => {
    const d = drag.current;
    const el = drawer.current;
    if (!d || event.pointerId !== d.id) return;
    drag.current = null;
    if (!d.active || !el) return;
    dragged.current = true;
    if (event.type === "pointerup" && dragCloses(d, event.timeStamp)) close();
    else {
      // Back to where it was, at the drawer's own pace.
      el.style.transition = "";
      el.style.transform = "";
    }
  };

  const styles = siteMenuStyles();

  return (
    <div className={styles.root()}>
      <Button
        ref={trigger}
        icon
        // The label stays put; `aria-expanded` is what says open or closed.
        aria-label="Site menu"
        aria-expanded={open}
        // The drawer only exists while it is open (or sliding out).
        aria-controls={open ? drawerId : undefined}
        onClick={() => setOpen(true)}
      >
        <Menu size={18} strokeWidth={1.75} aria-hidden="true" />
      </Button>
      {shown && (
        <dialog
          ref={drawer}
          id={drawerId}
          aria-label="Site menu"
          className={styles.drawer()}
          onCancel={(event) => {
            // Escape, where the document's listener did not hear it first.
            // Closed by `open` going false, not by the browser, so the state
            // and the screen cannot disagree.
            event.preventDefault();
            close();
          }}
          onKeyDown={(event) => {
            // The page behind is inert, but a modal lets Tab out past its last
            // row to the browser's own chrome. Round the drawer instead.
            if (event.key !== "Tab") return;
            const rows = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                "a[href], button:not(:disabled)",
              ),
            ];
            const edge = event.shiftKey ? rows[0] : rows[rows.length - 1];
            if (document.activeElement !== edge) return;
            event.preventDefault();
            (event.shiftKey ? rows[rows.length - 1] : rows[0])?.focus();
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
          onClickCapture={(event) => {
            if (!dragged.current) return;
            dragged.current = false;
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => {
            if (press.click(event)) close();
          }}
        >
          <div className={styles.head()}>
            <Wordmark />
            <Button
              variant="quiet"
              icon
              aria-label="Close menu"
              onClick={close}
            >
              <X size={18} strokeWidth={1.75} aria-hidden="true" />
            </Button>
          </div>
          <div className={styles.body()}>
            <SiteNav
              current={current}
              go={go}
              features={features}
              first={(el) => {
                firstRow.current = el;
              }}
              onFollow={close}
            />
          </div>
          <div className={styles.foot()}>
            <Appearance />
            <p className={styles.small()}>
              Model forecasts, not a safety statement. Look at the water
              before you go out.
            </p>
          </div>
        </dialog>
      )}
    </div>
  );
}
