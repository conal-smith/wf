import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { RING, tv, type VariantProps } from "./tv";

/*
 * The parts of one page or dialog: a row of words, the current one on a soft
 * pill. Down the side of a wide dialog, a column of the same. The arrow keys
 * move between them, as a tab list's do; Tab leaves the list.
 */
export const tabsStyles = tv({
  slots: {
    base: "flex gap-1 overflow-x-auto scrollbar-none",
    tab: [
      "inline-flex shrink-0 cursor-pointer items-center gap-2 rounded-full border-0 bg-transparent px-3 py-2",
      "font-body text-prose font-medium whitespace-nowrap text-ink-2 no-underline",
      "transition-colors duration-fast not-disabled:hover:bg-sunken",
      "aria-selected:bg-sunken aria-selected:text-ink",
      RING,
    ],
  },
  variants: {
    vertical: {
      true: {
        base: "flex-col gap-0.5 overflow-visible",
        tab: "w-full justify-start rounded-control px-3 py-2.25",
      },
    },
  },
});

export interface TabItem<T extends string> {
  value: T;
  label: ReactNode;
  /** The panel this tab shows, by id, for `aria-controls`. */
  controls?: string;
}

export type TabsProps<T extends string> = VariantProps<typeof tabsStyles> & {
  "aria-label": string;
  tabs: readonly TabItem<T>[];
  value: T;
  onChange: (value: T) => void;
  className?: string;
};

/** A tab list: one tab selected, the arrow keys to move, Home and End. */
export function Tabs<T extends string>({
  tabs,
  value,
  onChange,
  vertical,
  className,
  "aria-label": label,
}: TabsProps<T>) {
  const styles = tabsStyles({ vertical });
  const list = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent) => {
    const keys = vertical
      ? { next: "ArrowDown", prev: "ArrowUp" }
      : { next: "ArrowRight", prev: "ArrowLeft" };
    const at = tabs.findIndex((t) => t.value === value);
    let to = -1;
    if (event.key === keys.next) to = (at + 1) % tabs.length;
    else if (event.key === keys.prev) to = (at - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") to = 0;
    else if (event.key === "End") to = tabs.length - 1;
    if (to < 0) return;
    event.preventDefault();
    onChange(tabs[to].value);
    list.current
      ?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
      [to]?.focus();
  };
  return (
    <div
      ref={list}
      role="tablist"
      aria-label={label}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      className={styles.base({ className })}
      onKeyDown={move}
    >
      {tabs.map((tab) => {
        const selected = tab.value === value;
        return (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-controls={tab.controls}
            tabIndex={selected ? 0 : -1}
            className={styles.tab()}
            onClick={() => onChange(tab.value)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}
