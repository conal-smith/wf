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
 * barrel.
 */
import {
  Menu,
  MessagesSquare,
  Store,
  Wind,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import "./siteMenu.css";
import { SITE_SECTIONS, type SiteSectionId } from "./siteNav";

const ICONS: Record<SiteSectionId, LucideIcon> = {
  map: Wind,
  market: Store,
  community: MessagesSquare,
};

export function SiteMenu({
  /**
   * The section this app is. Named by the caller rather than read from the URL
   * during render: each app already knows which one it is, and deriving it here
   * would make the menu depend on the location twice over.
   */
  current,
  /** The trigger's control height, so it sits in scale with its neighbours. */
  size = "md",
}: {
  current: SiteSectionId;
  size?: "sm" | "md";
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

  return (
    <div
      className="f5-site-menu"
      data-mode="light"
      ref={root}
      // Tabbing past the last row closes the menu rather than leaving it hanging
      // open behind the reader. Not a focus trap: focus is free to leave, and
      // this is what happens when it does.
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null))
          setOpen(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        className={`f5-button f5-button--pill f5-button--icon f5-site-menu__trigger${
          size === "sm" ? " f5-button--sm" : ""
        }`}
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
      </button>
      {open && (
        <nav
          id={panelId}
          className="f5-surface f5-site-menu__panel"
          aria-label="Site"
        >
          <ul className="f5-site-menu__list">
            {SITE_SECTIONS.map((section, index) => {
              const Icon = ICONS[section.id];
              return (
                <li key={section.id}>
                  <a
                    ref={index === 0 ? firstLink : undefined}
                    className="f5-button f5-site-menu__link"
                    href={section.href}
                    aria-current={section.id === current ? "page" : undefined}
                  >
                    <Icon size={16} aria-hidden="true" />
                    <span>{section.label}</span>
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
