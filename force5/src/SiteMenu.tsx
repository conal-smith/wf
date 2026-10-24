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
 * The menu is a drawer from the left (owner's ruling of 2026-10-24, the mockup
 * `backlog/mockups/2026-10-24-your-spots-home.html`): a modal <dialog> over
 * the kit's backdrop, so the focus is trapped in it and the page behind is
 * inert, with the page's own tools and then the site's sections, each with
 * its glyph in the margin. A finger can push it back off to the left.
 */
import { Menu, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { useFadeOut } from "../../ui/Backdrop";
import { Button } from "../../ui/Button";
import { backdropPress, onBackdrop } from "../../ui/Dialog";
import { RING, tv } from "../../ui/tv";
import { Wordmark } from "../../ui/Wordmark";
import { ChartGlyph } from "../../shared/web/ChartGlyph";
import { FEATURES, type SiteFeatures } from "../../shared/web/features";
import {
  community,
  market,
  useWithAi,
  windMap,
  type GlyphDef,
} from "../../shared/web/glyphSet";
import { siteSections, type SiteSectionId } from "./siteNav";

/*
 * The one hook left on the menu, and it draws nothing: e2e/site-menu.spec.ts
 * finds the menu by it, to hide it and to ask whether a tap landed on it.
 */
const HOOK = "f5-site-menu";

/** Each section's glyph, beside its name in the drawer. */
const SECTION_GLYPH: Record<SiteSectionId, GlyphDef> = {
  map: windMap,
  market,
  community,
  ai: useWithAi,
};

/*
 * How a finger puts the drawer away. A press has to travel a few pixels to the
 * left, and more left than up or down, before it is a drag at all: a tap on a
 * row, or a scroll down a long list, is not one. Let go past CLOSE_AT pixels,
 * or flicked faster than FLICK pixels a millisecond, it shuts; otherwise it
 * springs back.
 */
export const DRAG = { SLOP: 8, CLOSE_AT: 70, FLICK: 0.5 } as const;

export const siteMenuStyles = tv({
  slots: {
    root: `${HOOK} pointer-events-auto relative inline-flex`,
    /*
     * An icon button is under the target floor on a finger, and in a header
     * row its neighbours are inches away along the inline axis. So on a coarse
     * pointer it keeps its drawn size and its hit area grows DOWN THE BLOCK
     * AXIS ONLY, to touch, through a band laid across it: an overhang to
     * either side would swallow taps meant for the brand link beside it.
     * Padding the inline side out is the parent's job.
     */
    trigger: [
      "relative pointer-coarse:min-h-0 pointer-coarse:min-w-0",
      "pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:top-1/2",
      "pointer-coarse:after:h-touch pointer-coarse:after:-translate-y-1/2",
    ],
    /*
     * The drawer: the full height of the screen at the left edge, paper with
     * its grain, ruled in ink down its right edge, where its corners take the
     * dialog's radius. It scrolls a list too long for a short screen, and
     * leaves the vertical pan to the browser so a sideways drag is the
     * script's.
     */
    drawer: [
      "fixed inset-y-0 left-0 right-auto m-0 h-dvh max-h-none w-80 max-w-11/12",
      "overflow-y-auto overscroll-contain touch-pan-y",
      "rounded-r-dialog border-0 border-r border-ink bg-card paper-grain shadow-sheet",
      "px-safe-5 pt-safe-4 pb-safe-4 font-body text-ink",
      "backdrop:scrim drawer-slide",
    ],
    // The close button and the nameplate, over the broadsheet's heavy rule.
    head: "flex items-center gap-3 border-b-2 border-ink pb-2.5",
    list: "m-0 mt-2.5 flex list-none flex-col p-0",
    // The site's sections, a gap under the page's own tools.
    sections: "mt-4",
    /*
     * A row is a name on a hairline, the height of touch, with its glyph in
     * the margin: the index of a broadsheet, not a list of buttons. It goes
     * magenta under the pointer, as every link on the chart does.
     */
    row: [
      "flex h-touch w-full items-center gap-3 border-b border-line px-0.5",
      "font-body text-prose font-medium text-ink no-underline",
      "transition-colors duration-fast not-disabled:hover:text-chart-magenta",
      RING,
    ],
    /*
     * A tool is a row like a section's: the kit's quiet button, its mono
     * capitals and pill taken back to the row's face and hairline.
     */
    tool: [
      "h-touch w-full justify-start gap-3 rounded-none border-0 border-b border-line px-0.5",
      "font-body text-prose font-medium tracking-normal text-ink normal-case",
      "not-disabled:hover:bg-transparent not-disabled:hover:text-chart-magenta",
    ],
    glyph: "inline-flex size-5 shrink-0 items-center justify-center",
    // A small bar on the right edge, saying the drawer can be pushed away.
    grip: "pointer-events-none absolute top-1/2 right-1.5 h-touch w-1 -translate-y-1/2 rounded-full bg-line",
  },
  variants: {
    /*
     * What the menu stands on: the moving map or a page. Both are paper now
     * (the chart draws its boxes solid), and the trigger is the same round
     * button on either, so the ground draws nothing of its own.
     */
    ground: {
      map: {},
      content: {},
    },
    /*
     * The section you are in: set in the italic, heavier, on the paper's
     * second sheet, so the state is not said by colour alone. The
     * machine-readable half is `aria-current="page"`.
     */
    current: { true: { row: "bg-sunken font-bold italic" } },
  },
  defaultVariants: { ground: "map" },
});

/** Something the page itself opens from the menu: the map's layers, say. */
export interface SiteMenuTool {
  id: string;
  label: string;
  /** A small drawn glyph in `currentColor`, beside the name. */
  glyph?: ReactNode;
  /** Called once the menu has shut and handed the focus back to its trigger. */
  onSelect: () => void;
}

/** A finger on the drawer: where it went down, and how it has moved since. */
interface Drag {
  id: number;
  x0: number;
  y0: number;
  dx: number;
  /** When it last moved, and how fast, in pixels a millisecond. */
  at: number;
  speed: number;
  /** Past the slop, and to the left: the drawer follows it. */
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
  const flick = now - drag.at < 100 && drag.speed < -DRAG.FLICK;
  return drag.dx < -DRAG.CLOSE_AT || (flick && drag.dx < -2 * DRAG.SLOP);
}

/**
 * The site's sections, each a link with its glyph in the margin, the one you
 * are in marked. Only the sections switched on in this build are drawn: with
 * the marketplace or the community off (as production has them,
 * shared/web/features.ts), nothing of it is.
 */
export function SiteSections({
  current,
  features = FEATURES,
  className,
  first,
  onFollow,
}: {
  current: SiteSectionId;
  features?: Pick<SiteFeatures, "market" | "community">;
  className?: string;
  /** Handed the first row, for the drawer to focus as it opens. */
  first?: (el: HTMLAnchorElement | null) => void;
  /** Following a row: the drawer shuts. */
  onFollow?: () => void;
}) {
  const styles = siteMenuStyles();
  return (
    <nav aria-label="Site" className={className}>
      <ul className={styles.list()}>
        {siteSections(features).map((section, index) => {
          const here = section.id === current;
          return (
            <li key={section.id}>
              <a
                ref={index === 0 ? first : undefined}
                className={styles.row({ current: here })}
                href={section.href}
                aria-current={here ? "page" : undefined}
                // Following a row closes the menu: the map, kept under the
                // page the row opens (src/PagesOverMap.tsx), comes back with
                // its menu shut.
                onClick={onFollow}
              >
                <span className={styles.glyph()}>
                  <ChartGlyph glyph={SECTION_GLYPH[section.id]} />
                </span>
                {section.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export function SiteMenu({
  /**
   * The section this app is. Named by the caller rather than read from the URL
   * during render: each app already knows which one it is, and deriving it here
   * would make the menu depend on the location twice over.
   */
  current,
  /** The trigger's control height, so it sits in scale with its neighbours. */
  size = "md",
  /**
   * What the menu stands on: the moving map, or a page's masthead. The
   * trigger is the round menu button either way: the kit's raised paper
   * button, lit from above, inside the head's box on the map and on the
   * masthead on a page. The drawer is the same either way.
   */
  ground = "map",
  /**
   * The page's own tools, over the sections: on the map, Customise, its
   * layers, your spots, the display options, what the map means and the
   * tour. The menu is the one way in to them, so they come first. Each opens
   * a dialog of the page's, which hands the focus back to the trigger when it
   * shuts.
   */
  tools,
  /** Which sections are switched on: the build's, unless a test says. */
  features = FEATURES,
}: {
  current: SiteSectionId;
  size?: "sm" | "md";
  ground?: "map" | "content";
  tools?: { title: string; items: readonly SiteMenuTool[] };
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
      // search, the layers panel, the spot card or the sheet. Capturing on the
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
      // Down, up or to the right: a scroll or a slip, not a drag.
      if (dx > 0 || Math.abs(dy) >= Math.abs(dx)) {
        drag.current = null;
        return;
      }
      d.active = true;
      el.setPointerCapture?.(event.pointerId);
      el.style.transition = "none";
    }
    const next = Math.min(0, dx);
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

  const styles = siteMenuStyles({ ground });
  const toolItems = tools?.items ?? [];

  return (
    <div className={styles.root()}>
      <Button
        ref={trigger}
        variant="raised"
        size={size}
        icon
        className={styles.trigger()}
        // The label stays put; `aria-expanded` is what says open or closed.
        aria-label="Site menu"
        aria-expanded={open}
        // The drawer only exists while it is open (or sliding out).
        aria-controls={open ? drawerId : undefined}
        onClick={() => setOpen(true)}
      >
        <Menu size={size === "sm" ? 15 : 18} aria-hidden="true" />
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
            <Button
              variant="quiet"
              size="sm"
              icon
              aria-label="Close menu"
              onClick={close}
            >
              <X size={15} aria-hidden="true" />
            </Button>
            <Wordmark size="sm" />
          </div>
          {toolItems.length > 0 && (
            <div role="group" aria-label={tools?.title}>
              <ul className={styles.list()}>
                {toolItems.map((tool, index) => (
                  <li key={tool.id}>
                    <Button
                      ref={
                        index === 0
                          ? (el: HTMLButtonElement | null) => {
                              firstRow.current = el;
                            }
                          : undefined
                      }
                      variant="quiet"
                      className={styles.tool()}
                      aria-haspopup="dialog"
                      onClick={() => {
                        close();
                        tool.onSelect();
                      }}
                    >
                      <span className={styles.glyph()}>{tool.glyph}</span>
                      {tool.label}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <SiteSections
            current={current}
            features={features}
            className={toolItems.length > 0 ? styles.sections() : undefined}
            first={
              toolItems.length === 0
                ? (el) => {
                    firstRow.current = el;
                  }
                : undefined
            }
            onFollow={close}
          />
          <span aria-hidden="true" className={styles.grip()} />
        </dialog>
      )}
    </div>
  );
}
