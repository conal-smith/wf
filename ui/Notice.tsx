import { AlertTriangle, ChevronDown, Droplet, Info } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { tv, type VariantProps } from "./tv";

/*
 * Something the reader should know, in a quiet card: a coloured square with
 * its sign, a plain title that says the level in words ("Orange wind
 * warning"), a second line (when, and what it does to the stars), and a
 * chevron that opens the details. No capital chip, no coloured bar down the
 * side. Met Éireann's yellow, orange and red keep their own colours; bathing
 * water is a drop on the pen's tint.
 */
export const noticeStyles = tv({
  slots: {
    base: "grid grid-cols-notice items-start gap-x-3.5 gap-y-0.5 rounded-surface bg-sunken px-4 py-3.5 font-body text-ink",
    mark: "row-span-2 grid size-9 place-items-center rounded-control",
    title: "min-w-0 pt-px text-prose leading-tight font-semibold text-pretty",
    meta: "col-start-2 min-w-0 text-body leading-normal text-ink-2",
    end: "col-start-3 row-span-2 row-start-1 self-center",
    details:
      "col-span-2 col-start-2 mt-2.5 min-w-0 text-body leading-normal text-ink-2",
    chevron:
      "transition-transform duration-fast motion-reduce:transition-none group-data-open/notice:rotate-180",
  },
  variants: {
    level: {
      info: { mark: "bg-ground text-ink-2" },
      warn: { mark: "bg-warn-ground text-pen-ink" },
      yellow: { mark: "bg-met-yellow text-photo-shade" },
      orange: { mark: "bg-met-orange text-photo-line" },
      red: { mark: "bg-met-red text-photo-line" },
      water: { mark: "bg-warn-ground text-pen-ink" },
      "water-advice": { mark: "bg-ground text-depth" },
    },
  },
  defaultVariants: { level: "info" },
});

export type NoticeLevel = NonNullable<
  VariantProps<typeof noticeStyles>["level"]
>;

const ICON: Record<NoticeLevel, typeof Info> = {
  info: Info,
  warn: AlertTriangle,
  yellow: AlertTriangle,
  orange: AlertTriangle,
  red: AlertTriangle,
  water: Droplet,
  "water-advice": Droplet,
};

export interface NoticeProps {
  level?: NoticeLevel;
  /** The plain title, the level in words. */
  title: ReactNode;
  /** The second line: when, and what it does to the stars. */
  children?: ReactNode;
  /** What opens under the chevron. */
  details?: ReactNode;
  /** The details open from the first. */
  defaultOpen?: boolean;
  /** An action on the right in place of the chevron: Try again. */
  action?: ReactNode;
  /**
   * Interrupts a screen reader: something went wrong just now. A notice that
   * was there when the page came (a weather warning) does not.
   */
  alert?: boolean;
  className?: string;
}

export function Notice({
  level = "info",
  title,
  children,
  details,
  defaultOpen = false,
  action,
  alert = false,
  className,
}: NoticeProps) {
  const styles = noticeStyles({ level });
  const [open, setOpen] = useState(defaultOpen);
  const detailsId = useId();
  const Icon = ICON[level];
  return (
    <div
      className={styles.base({ className: ["group/notice", className] })}
      role={alert ? "alert" : undefined}
      data-open={open || undefined}
      data-level={level}
    >
      <span className={styles.mark()} aria-hidden="true">
        <Icon size={18} strokeWidth={1.75} />
      </span>
      <div className={styles.title()}>{title}</div>
      {action ? (
        <div className={styles.end()}>{action}</div>
      ) : (
        details && (
          <Button
            variant="quiet"
            size="sm"
            icon
            className={styles.end()}
            aria-label="Details"
            aria-expanded={open}
            aria-controls={detailsId}
            onClick={() => setOpen((was) => !was)}
          >
            <ChevronDown
              className={styles.chevron()}
              size={18}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          </Button>
        )
      )}
      {children && <div className={styles.meta()}>{children}</div>}
      {details && (
        <div className={styles.details()} id={detailsId} hidden={!open}>
          {details}
        </div>
      )}
    </div>
  );
}

/*
 * The same level as a small square, where a notice takes the place of the
 * stars: an hour in the table, the Your stars card. With a word beside it
 * ("Water", "Orange warning"), never a capital chip.
 */
export const noticeMarkStyles = tv({
  slots: {
    base: "inline-flex items-center gap-1.5 font-body font-medium text-ink",
    square: "grid shrink-0 place-items-center",
  },
  variants: {
    size: {
      sm: { base: "text-body", square: "size-4 rounded-mark" },
      md: { base: "text-prose", square: "size-7 rounded-control" },
    },
    level: {
      info: { square: "bg-ground text-ink-2" },
      warn: { square: "bg-warn-ground text-pen-ink" },
      yellow: { square: "bg-met-yellow text-photo-shade" },
      orange: { square: "bg-met-orange text-photo-line" },
      red: { square: "bg-met-red text-photo-line" },
      water: { square: "bg-warn-ground text-pen-ink" },
      "water-advice": { square: "bg-ground text-depth" },
    },
  },
  defaultVariants: { size: "sm", level: "info" },
});

export interface NoticeMarkProps {
  level: NoticeLevel;
  size?: "sm" | "md";
  /** The word beside the square; the square alone where the row says it. */
  children?: ReactNode;
  className?: string;
}

export function NoticeMark({
  level,
  size = "sm",
  children,
  className,
}: NoticeMarkProps) {
  const styles = noticeMarkStyles({ level, size });
  const Icon = ICON[level];
  return (
    <span className={styles.base({ className })} data-notice-mark={level}>
      <span className={styles.square()} aria-hidden="true">
        <Icon size={size === "sm" ? 11 : 16} strokeWidth={2} />
      </span>
      {children}
    </span>
  );
}
