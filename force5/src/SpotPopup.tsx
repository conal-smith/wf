import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Popup, type Map } from "maplibre-gl";
import { ArrowUpRight, X } from "lucide-react";
import type { Point } from "./weather";
import { spotHref } from "./siteNav";

const safeLink = (value?: string) => {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
};

/** React text rendering keeps external location records out of HTML injection sinks. */
export default function SpotPopup({
  map,
  point,
  bottomInset,
  onClose,
}: {
  map: Map;
  point: Point;
  bottomInset: number;
  onClose: () => void;
}) {
  const [content] = useState(() => document.createElement("div"));
  const closeButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const popup = new Popup({
      className: "spot-popout",
      closeButton: false,
      closeOnClick: false,
      focusAfterOpen: false,
      offset: 20,
      maxWidth: "280px",
      padding: { top: 62, bottom: bottomInset + 28, left: 12, right: 12 },
    })
      .setLngLat([point.lon, point.lat])
      .setDOMContent(content)
      .addTo(map);
    closeButton.current?.focus({ preventScroll: true });
    // Content size can change after a font loads or a responsive layout changes.
    let layoutFrame = 0;
    const fit = () => {
      popup.setLngLat([point.lon, point.lat]);
      cancelAnimationFrame(layoutFrame);
      layoutFrame = requestAnimationFrame(() => {
        const card = content.getBoundingClientRect();
        const viewport = map.getContainer().getBoundingClientRect();
        const left = viewport.left + 12,
          right = viewport.right - 12;
        const top = viewport.top + 62,
          bottom = viewport.bottom - bottomInset - 20;
        const dx =
          card.left < left
            ? card.left - left
            : card.right > right
              ? card.right - right
              : 0;
        // A card taller than the band between the header and the dock cannot be
        // satisfied, and chasing it would pan the map back and forth for ever.
        const dy =
          card.height > bottom - top
            ? 0
            : card.top < top
              ? card.top - top
              : card.bottom > bottom
                ? card.bottom - bottom
                : 0;
        if (Math.abs(dx) > 1 || Math.abs(dy) > 1)
          map.panBy([dx, dy], { duration: 0 });
      });
    };
    const observer = new ResizeObserver(fit);
    observer.observe(content);
    /**
     * Choosing a spot flies the camera, so the first measurement can be taken
     * mid-flight and be stale by the time it lands: fit again when that flight
     * comes to rest.
     *
     * Once, and only for that flight. Refitting after every move would re-clamp
     * the card after each of the reader's own pans, pinning the marker to the
     * screen and making the map impossible to move away from. The first touch
     * of the map is the reader taking over, and from then on the card goes
     * wherever the map goes.
     */
    let opening = true;
    const handOver = () => {
      opening = false;
    };
    const landed = () => {
      if (!opening) return;
      handOver();
      fit();
    };
    const container = map.getContainer();
    container.addEventListener("pointerdown", handOver);
    container.addEventListener("keydown", handOver);
    map.on("moveend", landed);
    return () => {
      cancelAnimationFrame(layoutFrame);
      observer.disconnect();
      container.removeEventListener("pointerdown", handOver);
      container.removeEventListener("keydown", handOver);
      map.off("moveend", landed);
      popup.remove();
    };
  }, [map, point.id, point.lat, point.lon, bottomInset, content]);
  const kind = {
    spot: "Spot",
    operator: "School / operator",
    club: "Club",
    area: "Area reference",
  }[point.kind || "spot"];
  const website = safeLink(point.website);
  const sources =
    point.locationSources?.filter((source) => safeLink(source.url)) || [];
  return createPortal(
    <section
      className="spot-popout-card"
      role="dialog"
      aria-label={`${point.name} information`}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
    >
      <button
        className="spot-popout-close"
        ref={closeButton}
        aria-label="Close spot information"
        onClick={onClose}
      >
        <X size={16} />
      </button>
      <div className="spot-popout-type">
        <span>
          {kind}
          {point.county ? ` · ${point.county}` : ""}
        </span>
        {/* On the eyebrow's own line: the card is fitted between the header
            and the dock on a phone, and has no height to spare for a row. */}
        {point.id && (
          <a
            className="spot-popout-page"
            href={spotHref(point.id)}
            data-spot-page-link
          >
            Open spot page <ArrowUpRight size={12} aria-hidden="true" />
          </a>
        )}
      </div>
      <h3>{point.name}</h3>
      {point.note && <p>{point.note}</p>}
      <small className="spot-popout-coordinates">
        {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
      </small>
      {(website || sources.length > 0) && (
        <div className="spot-popout-links">
          {website && (
            <a href={website} target="_blank" rel="noreferrer">
              Website <ArrowUpRight size={13} />
            </a>
          )}
          {sources.map((source, i) => (
            <a
              key={`${source.url}/${i}`}
              href={safeLink(source.url)}
              title={`${source.name} · ${source.licence}`}
              target="_blank"
              rel="noreferrer"
            >
              Source{sources.length > 1 ? ` ${i + 1}` : ""}{" "}
              <ArrowUpRight size={13} />
            </a>
          ))}
        </div>
      )}
    </section>,
    content,
  );
}
