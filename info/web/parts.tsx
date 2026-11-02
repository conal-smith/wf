/**
 * What the information pages are written with: a section under its heading,
 * a paragraph, and a list, at a measure a long page of sentences reads at.
 * Kept to the kit's own parts and the theme's steps, so the three pages look
 * like the rest of the site in both themes.
 */
import { useId, type ReactNode } from "react";
import { Heading } from "../../ui";
import { tv } from "../../ui/tv";

export const infoStyles = tv({
  slots: {
    main: "flex max-w-page flex-col gap-2 pt-7 pb-12 max-sm:pt-5",
    updated: "m-0 font-body text-body text-ink-muted",
    section: "flex flex-col gap-3 pt-6",
    p: "m-0 max-w-measure font-body text-prose text-pretty text-ink-2",
    list: "m-0 flex max-w-measure list-disc flex-col gap-2 pl-5 font-body text-prose text-ink-2 marker:text-ink-muted",
    strong: "font-semibold text-ink",
  },
});

const s = infoStyles();

/** A part of the page under its own heading. */
export function Section({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className={s.section()} aria-labelledby={id}>
      <Heading level="section" id={id}>
        {title}
      </Heading>
      {children}
    </section>
  );
}

export const P = ({ children }: { children: ReactNode }) => (
  <p className={s.p()}>{children}</p>
);

export const List = ({ children }: { children: ReactNode }) => (
  <ul className={s.list()}>{children}</ul>
);

/** A word or two the reader should not miss, in the ink. */
export const Strong = ({ children }: { children: ReactNode }) => (
  <strong className={s.strong()}>{children}</strong>
);

/** When a page's wording last changed. */
export const Updated = ({ children }: { children: ReactNode }) => (
  <p className={s.updated()}>Last updated {children}</p>
);
