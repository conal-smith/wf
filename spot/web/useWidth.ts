import { useLayoutEffect, useRef, useState } from "react";

/** The width of an element, kept current, for the curves drawn at real size. */
export function useWidth<T extends HTMLElement>(fallback = 360) {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(fallback);
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth || fallback);
    if (typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.round(entry.contentRect.width))),
    );
    watch.observe(element);
    return () => watch.disconnect();
  }, [fallback]);
  return [ref, width] as const;
}
