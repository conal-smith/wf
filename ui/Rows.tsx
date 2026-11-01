import type {
  AnchorHTMLAttributes,
  ButtonHTMLAttributes,
  HTMLAttributes,
  ReactNode,
  Ref,
} from "react";
import { ChevronRight } from "lucide-react";
import { RING, tv } from "./tv";

/*
 * A list of rows in one soft card, a hairline between them inside it: the
 * key, the spot index, the models, a setting with its value. The name in
 * Inter semibold, a grey line under it, and the value or action on the right.
 */
export const rowsStyles = tv({
  slots: {
    list: "m-0 list-none divide-y divide-line overflow-hidden rounded-surface bg-sunken p-0",
    row: [
      "flex min-h-14 w-full items-center gap-3.5 border-0 bg-transparent px-4 py-3.25 text-left",
      "font-body text-ink no-underline",
    ],
    // A row that goes somewhere or does something: a wash under the pointer.
    action: ["cursor-pointer transition-colors duration-fast not-disabled:hover:bg-line", RING, "focus-visible:-outline-offset-2"],
    lead: "grid shrink-0 place-items-center text-ink-2",
    main: "grid min-w-0 flex-1 gap-0.5",
    title: "text-prose leading-tight font-semibold text-ink",
    detail: "text-body leading-normal text-ink-2",
    end: "flex shrink-0 items-center gap-2 text-body text-ink-2",
    chevron: "text-ink-muted",
  },
  variants: {
    dim: { true: { title: "text-ink-muted", detail: "text-ink-muted" } },
  },
});

export type RowsProps = HTMLAttributes<HTMLElement> & {
  /** A list (the default) or a plain group of rows. */
  as?: "ul" | "div";
};

/** The card the rows stand in. */
export function Rows({ as: Tag = "ul", className, ...props }: RowsProps) {
  return <Tag {...props} className={rowsStyles().list({ className })} />;
}

interface RowContent {
  /** An icon or a mark before the words. */
  lead?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  /** The value or the action, on the right. */
  end?: ReactNode;
  /** A chevron at the end: a row that opens a page. */
  chevron?: boolean;
  /** Not available: the words in grey. */
  dim?: boolean;
}

type RowAs =
  | ({ href?: undefined; onClick?: undefined } & Omit<
      HTMLAttributes<HTMLDivElement>,
      "title"
    >)
  | ({ href: string; ref?: Ref<HTMLAnchorElement> } & Omit<
      AnchorHTMLAttributes<HTMLAnchorElement>,
      "title"
    >)
  | ({ href?: undefined; onClick: () => void } & Omit<
      ButtonHTMLAttributes<HTMLButtonElement>,
      "title" | "onClick"
    >);

export type RowProps = RowContent & RowAs & { className?: string };

/**
 * One row: a plain row, a link (`href`), or a button (`onClick`). In a
 * `<Rows>` list (a `<ul>`), `inList` wraps it in its `<li>`.
 */
export function Row(props: RowProps & { inList?: boolean }) {
  const {
    lead,
    title,
    detail,
    end,
    chevron,
    dim,
    className,
    inList = false,
    ...rest
  } = props;
  const s = rowsStyles({ dim });
  const body = (
    <>
      {lead && <span className={s.lead()}>{lead}</span>}
      <span className={s.main()}>
        <span className={s.title()}>{title}</span>
        {detail && <span className={s.detail()}>{detail}</span>}
      </span>
      {(end || chevron) && (
        <span className={s.end()}>
          {end}
          {chevron && (
            <ChevronRight
              className={s.chevron()}
              size={18}
              strokeWidth={1.75}
              aria-hidden="true"
            />
          )}
        </span>
      )}
    </>
  );
  let element;
  if (rest.href !== undefined)
    element = (
      <a
        {...(rest as AnchorHTMLAttributes<HTMLAnchorElement>)}
        className={s.row({ className: [s.action(), className] })}
      >
        {body}
      </a>
    );
  else if (rest.onClick !== undefined)
    element = (
      <button
        type="button"
        {...(rest as ButtonHTMLAttributes<HTMLButtonElement>)}
        className={s.row({ className: [s.action(), className] })}
      >
        {body}
      </button>
    );
  else
    element = (
      <div
        {...(rest as HTMLAttributes<HTMLDivElement>)}
        className={s.row({ className })}
      >
        {body}
      </div>
    );
  return inList ? <li>{element}</li> : element;
}
