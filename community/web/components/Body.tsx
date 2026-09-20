/**
 * A message body, drawn. The tree comes from `body.ts`; every leaf of it is
 * text handed to React as text, so nothing a member types is ever markup.
 */
import { Fragment, type ReactNode } from "react";
import { linkStyles } from "../../../ui/Link";
import { tv } from "../../../ui/tv";
import type { Member } from "../../shared/types";
import { parseBody, type Block, type Inline } from "../body";

export const bodyStyles = tv({
  slots: {
    base: "grid max-w-measure min-w-0 gap-2 font-sans text-prose wrap-anywhere text-ink",
    paragraph: "m-0",
    list: "m-0 grid gap-1 pl-5",
    quote: "m-0 grid gap-2 border-l-2 border-line-strong pl-3 text-ink-muted",
    bold: "font-semibold",
    // Filled and heavier as well as recoloured: a name, not a link.
    mention: "rounded-full bg-sunken px-1 font-semibold text-ink-2",
  },
  variants: {
    ordered: { true: { list: "list-decimal" }, false: { list: "list-disc" } },
  },
});

/** Who a mention names. Someone the message does not carry is still a mention. */
export function mentionName(id: string, mentions: readonly Member[]): string {
  const member = mentions.find((m) => m.id === id);
  return `@${member ? member.displayName : "member"}`;
}

function inline(
  nodes: readonly Inline[],
  mentions: readonly Member[],
): ReactNode {
  const styles = bodyStyles();
  return nodes.map((node, i) => {
    switch (node.t) {
      case "text":
        return <Fragment key={i}>{node.text}</Fragment>;
      case "break":
        return <br key={i} />;
      case "bold":
        return (
          <strong key={i} className={styles.bold()}>
            {inline(node.children, mentions)}
          </strong>
        );
      case "italic":
        return <em key={i}>{inline(node.children, mentions)}</em>;
      case "link":
        return (
          <a
            key={i}
            className={linkStyles()}
            href={node.href}
            target="_blank"
            rel="nofollow noopener"
          >
            {inline(node.children, mentions)}
          </a>
        );
      case "mention":
        return (
          <span key={i} className={styles.mention()}>
            {mentionName(node.id, mentions)}
          </span>
        );
    }
  });
}

function blocks(
  nodes: readonly Block[],
  mentions: readonly Member[],
): ReactNode {
  return nodes.map((node, i) => {
    switch (node.t) {
      case "paragraph":
        return (
          <p key={i} className={bodyStyles().paragraph()}>
            {inline(node.children, mentions)}
          </p>
        );
      case "list": {
        const List = node.ordered ? "ol" : "ul";
        return (
          <List
            key={i}
            className={bodyStyles({ ordered: node.ordered }).list()}
          >
            {node.items.map((item, n) => (
              <li key={n}>{inline(item, mentions)}</li>
            ))}
          </List>
        );
      }
      case "quote":
        return (
          <blockquote key={i} className={bodyStyles().quote()}>
            {blocks(node.children, mentions)}
          </blockquote>
        );
    }
  });
}

export interface BodyProps {
  body: string;
  /** The people behind the body's <@user_id> tokens, from the message. */
  mentions: readonly Member[];
  className?: string;
}

export function Body({ body, mentions, className }: BodyProps) {
  return (
    <div className={bodyStyles().base({ className })}>
      {blocks(parseBody(body), mentions)}
    </div>
  );
}
