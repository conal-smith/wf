/**
 * A channel's tags as its one filter: All, then each tag. Links, so the tag
 * rides in the URL and a filtered channel can be sent to someone; the one that
 * is on is raised and filled as well as said with `aria-current`.
 */
import { Button } from "../../../ui";
import { tv } from "../../../ui/tv";
import type { Tag } from "../../shared/types";
import { paths, routed } from "../router";

export const tagPillsStyles = tv({
  slots: {
    // Wrapping beside the rail. On a phone one line that scrolls sideways, let
    // out to the screen's edges so a pill is not cut off at the gutter.
    base: [
      "m-0 flex list-none flex-wrap gap-1 p-0",
      "max-rail:-mx-3 max-rail:flex-nowrap max-rail:overflow-x-auto max-rail:px-3 max-rail:py-1",
    ],
    item: "shrink-0",
    pill: "text-body",
  },
  variants: {
    // The ones that are off are quiet: the kit's pressed pill says the rest.
    on: { false: { pill: "font-normal shadow-none" } },
  },
});

/** The tag a URL asks for, if it is one of the channel's. Anything else is All. */
export function currentTag(tags: readonly Tag[], asked: string | null) {
  return tags.find((tag) => tag.id === asked) ?? null;
}

export interface TagPillsProps {
  slug: string;
  tags: readonly Tag[];
  /** The id of the tag that is on; null is All. */
  current: string | null;
}

export function TagPills({ slug, tags, current }: TagPillsProps) {
  const ordered = [...tags].sort((a, b) => a.position - b.position);
  // A channel with no tags has nothing to filter by, and All alone says nothing.
  if (!ordered.length) return null;
  const pills = [
    { id: null, label: "All" },
    ...ordered.map((tag) => ({
      id: tag.id as string | null,
      label: tag.label,
    })),
  ];
  const styles = tagPillsStyles();
  return (
    <nav aria-label="Filter by tag">
      <ul className={styles.base()}>
        {pills.map((pill) => (
          <li key={pill.id ?? "all"} className={styles.item()}>
            <Button
              {...routed(paths.channel(slug, pill.id))}
              variant="pill"
              size="sm"
              pressed={current === pill.id}
              className={tagPillsStyles({ on: current === pill.id }).pill()}
            >
              {pill.label}
            </Button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
