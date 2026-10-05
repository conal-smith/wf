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
 */
import { Menu, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../ui/Button";
import { surfaceStyles } from "../../ui/Surface";
import { RING, tv } from "../../ui/tv";
import { SITE_SECTIONS, type SiteSectionId } from "./siteNav";

/*
 * The one hook left on the menu, and it draws nothing: e2e/site-menu.spec.ts
 * finds the menu by it, to hide it and to ask whether a tap landed on it.
 */
const HOOK = "f5-site-menu";

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
    // The chart's box, hung below the trigger by a gap from its leading
    // edge, padded tight so the rows carry the padding.
    panel: [
      "absolute top-full left-0 z-panel mt-2 min-w-60 p-2",
      "animate-menu-in motion-reduce:animate-none",
    ],
    list: "m-0 flex list-none flex-col p-0",
    /*
     * A row is a section's name in the display face, on a hairline, the height
     * of touch: the index of a broadsheet, not a list of buttons. It goes
     * magenta under the pointer, as every link on the chart does.
     */
    row: [
      "flex h-touch w-full items-center gap-2 border-b border-line px-2",
      "font-display text-prose font-semibold text-ink no-underline",
      "transition-colors duration-fast not-disabled:hover:text-chart-magenta",
      RING,
    ],
  },
  variants: {
    /*
     * What the menu stands on: the moving map or a page. Both are paper now
     * (the chart draws its boxes solid), so the ground only says how far the
     * menu sits into the bar it starts.
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
   * trigger is the chart's square instrument either way, and the panel the
   * chart's double-ruled box.
   */
  ground = "map",
}: {
  current: SiteSectionId;
  size?: "sm" | "md";
  ground?: "map" | "content";
}) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstLink = useRef<HTMLAnchorElement>(null);

  // Dismissing puts focus back where it came from. Safari does not focus a
  // button on click, so closing through the trigger would otherwise drop focus
  // onto the body and leave a keyboard reader at the top of the document.
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  // Opening is a keyboard event as often as a pointer one, so the panel takes
  // focus rather than waiting to be tabbed into.
  useEffect(() => {
    if (open) firstLink.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      // The map has a global Escape handler of its own, which closes the
      // search, the layers panel, the spot card or the sheet. Capturing on the
      // document and stopping there is what makes Escape with this menu open
      // mean "close this menu" and nothing else: a capture listener here runs
      // before every bubble-phase listener, including one on `window`.
      event.preventDefault();
      event.stopPropagation();
      close();
    };
    const onPointerDown = (event: Event) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKeyDown, true);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [open]);

  const styles = siteMenuStyles({ ground });

  return (
    <div
      className={styles.root()}
      ref={root}
      // Tabbing past the last row closes the menu rather than leaving it hanging
      // open behind the reader. Not a focus trap: focus is free to leave, and
      // this is what happens when it does.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <Button
        ref={trigger}
        variant="raised"
        size={size}
        icon
        className={styles.trigger()}
        // The label stays put; `aria-expanded` is what says open or closed.
        aria-label="Site menu"
        aria-expanded={open}
        // A disclosure, not a menubar. The panel is a nav of links: arrow keys
        // stay the reader's own, and `aria-haspopup` would promise otherwise.
        // The controlled element only exists while the panel does.
        aria-controls={open ? panelId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
      >
        {open ? (
          <X size={size === "sm" ? 15 : 18} aria-hidden="true" />
        ) : (
          <Menu size={size === "sm" ? 15 : 18} aria-hidden="true" />
        )}
      </Button>
      {open && (
        <nav
          id={panelId}
          className={surfaceStyles({ className: styles.panel() })}
          aria-label="Site"
        >
          <ul className={styles.list()}>
            {SITE_SECTIONS.map((section, index) => {
              const here = section.id === current;
              return (
                <li key={section.id}>
                  <a
                    ref={index === 0 ? firstLink : undefined}
                    className={styles.row({ current: here })}
                    href={section.href}
                    aria-current={here ? "page" : undefined}
                  >
                    {section.label}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
