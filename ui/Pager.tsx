import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "./Button";
import { tv } from "./tv";

export const pagerStyles = tv({
  slots: {
    base: "flex items-center justify-center gap-3 pt-2",
    // A figure, so the figures' face.
    status: "font-mono text-caption text-ink-muted tabular-nums",
  },
});

export interface PagerProps {
  /** The page in view, counted from one. */
  page: number;
  pageSize: number;
  total: number;
  onPage: (page: number) => void;
  className?: string;
}

/** How many pages `total` rows make. Never none: an empty list is one page. */
export const pageCount = (total: number, pageSize: number) =>
  Math.max(1, Math.ceil(total / pageSize));

/** Previous and next. Nothing at all when everything fits on one page. */
export function Pager({
  page,
  pageSize,
  total,
  onPage,
  className,
}: PagerProps) {
  const pages = pageCount(total, pageSize);
  if (pages <= 1) return null;
  const styles = pagerStyles();
  return (
    <nav className={styles.base({ className })} aria-label="Pages">
      <Button
        variant="pill"
        size="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        <ChevronLeft size={16} aria-hidden="true" /> Previous
      </Button>
      <span className={styles.status()} aria-current="page">
        Page {page} of {pages}
      </span>
      <Button
        variant="pill"
        size="sm"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        Next <ChevronRight size={16} aria-hidden="true" />
      </Button>
    </nav>
  );
}
