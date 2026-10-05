import type { ReactNode } from "react";
import { tv } from "./tv";

/*
 * The headline: one a page, on a page that is read, saying the verdict in a
 * line. "Donabate: a three-star Friday morning on a 5.5 m". Fraunces at its
 * display cut, heavy and tight, with the soft part of the line in its light
 * italic and, where there is one, a mark in magenta (the colon after a name).
 *
 *   <Headline>
 *     Donabate<span className={headlineStyles().mark()}>:</span> a three-star
 *     Friday morning <em className={headlineStyles().soft()}>on a 5.5 m</em>
 *   </Headline>
 */
export const headlineStyles = tv({
  slots: {
    base: "m-0 font-display text-headline text-balance text-ink optical-display max-wide:text-title",
    soft: "font-normal tracking-tight italic",
    mark: "text-chart-magenta",
  },
});

export interface HeadlineProps {
  as?: "h1" | "h2";
  id?: string;
  className?: string;
  children: ReactNode;
}

export function Headline({
  as: Tag = "h1",
  id,
  className,
  children,
}: HeadlineProps) {
  return (
    <Tag id={id} className={headlineStyles().base({ className })}>
      {children}
    </Tag>
  );
}
