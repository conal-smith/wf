/**
 * A message body, read into a tree. Bodies are text with a small markdown
 * subset (D18): paragraphs, bold, italic, lists, quotes, links and mentions.
 * Nothing here knows about HTML: whatever is not one of those is text, and
 * text is all it ever becomes. `components/Body.tsx` draws the tree.
 */
import { MENTION_PATTERN } from "../shared/validate";

export type Inline =
  | { t: "text"; text: string }
  | { t: "bold"; children: Inline[] }
  | { t: "italic"; children: Inline[] }
  | { t: "link"; href: string; children: Inline[] }
  /** A stored <@user_id>. The message's `mentions` say who that is. */
  | { t: "mention"; id: string }
  | { t: "break" };

export type Block =
  | { t: "paragraph"; children: Inline[] }
  | { t: "list"; ordered: boolean; items: Inline[][] }
  | { t: "quote"; children: Block[] };

/**
 * The address a link may carry: http or https, and nothing else. Anything the
 * URL parser will not read, or reads as another scheme, is null, and the
 * caller leaves what was typed as text.
 */
export function safeHref(text: string): string | null {
  if (!/^https?:\/\//i.test(text)) return null;
  try {
    const url = new URL(text);
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.href
      : null;
  } catch {
    return null;
  }
}

/** What a sentence ends with, which a bare address in it does not. */
const TRAILING = /[.,;:!?'")\]]+$/;

const MENTION = MENTION_PATTERN.source;

/**
 * One pass, the earliest match wins: a mention, a labelled link, a bare
 * address, bold, then italic by asterisk or by underscore. An underscore
 * inside a word (snake_case, a handle) is not emphasis.
 */
const INLINE = new RegExp(
  [
    MENTION,
    String.raw`\[([^\[\]\n]+)\]\(([^()\s]+)\)`,
    String.raw`(https?:\/\/[^\s<>]+)`,
    String.raw`\*\*([^\s*](?:[^\n]*?[^\s*])?)\*\*`,
    String.raw`\*([^\s*](?:[^*\n]*?[^\s*])?)\*`,
    String.raw`(?<![A-Za-z0-9_])_([^\s_](?:[^_\n]*?[^\s_])?)_(?![A-Za-z0-9_])`,
  ].join("|"),
  "g",
);

/** Emphasis inside emphasis, and no deeper: the subset is small on purpose. */
const MAX_DEPTH = 3;

function text(value: string): Inline[] {
  return value ? [{ t: "text", text: value }] : [];
}

export function parseInline(source: string, depth = 0): Inline[] {
  if (depth >= MAX_DEPTH) return text(source);
  const out: Inline[] = [];
  let at = 0;
  for (const match of source.matchAll(INLINE)) {
    const [whole, mention, label, target, bare, bold, star, under] = match;
    const start = match.index;
    // Inside something already taken.
    if (start < at) continue;
    let node: Inline | null = null;
    let length = whole.length;
    if (mention !== undefined) node = { t: "mention", id: mention };
    else if (label !== undefined) {
      const href = safeHref(target);
      if (href)
        node = { t: "link", href, children: parseInline(label, depth + 1) };
    } else if (bare !== undefined) {
      const address = bare.replace(TRAILING, "");
      const href = safeHref(address);
      if (href) {
        node = { t: "link", href, children: text(address) };
        length = address.length;
      }
    } else if (bold !== undefined)
      node = { t: "bold", children: parseInline(bold, depth + 1) };
    else
      node = {
        t: "italic",
        children: parseInline(star ?? under, depth + 1),
      };
    // Not a link after all: what was typed stays as it was typed.
    if (!node) continue;
    out.push(...text(source.slice(at, start)), node);
    at = start + length;
  }
  out.push(...text(source.slice(at)));
  return out;
}

const BULLET = /^\s{0,3}[-*]\s+(.*)$/;
const NUMBER = /^\s{0,3}\d{1,3}[.)]\s+(.*)$/;
const QUOTE = /^\s{0,3}>\s?(.*)$/;

/** Lines of one paragraph: a single newline is a line break, as in a chat. */
function paragraph(lines: string[]): Block {
  const children: Inline[] = [];
  lines.forEach((line, i) => {
    if (i > 0) children.push({ t: "break" });
    children.push(...parseInline(line.trim()));
  });
  return { t: "paragraph", children };
}

export function parseBody(source: string, quoted = false): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  /** The run of lines from here that match, each as what the pattern kept. */
  const run = (pattern: RegExp): string[] => {
    const kept: string[] = [];
    for (; i < lines.length; i++) {
      const match = pattern.exec(lines[i]);
      if (!match) break;
      kept.push(match[1]);
    }
    return kept;
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
    } else if (!quoted && QUOTE.test(line)) {
      // A quote holds paragraphs and lists. A quote inside it is its text.
      blocks.push({
        t: "quote",
        children: parseBody(run(QUOTE).join("\n"), true),
      });
    } else if (BULLET.test(line)) {
      blocks.push({
        t: "list",
        ordered: false,
        items: run(BULLET).map((item) => parseInline(item.trim())),
      });
    } else if (NUMBER.test(line)) {
      blocks.push({
        t: "list",
        ordered: true,
        items: run(NUMBER).map((item) => parseInline(item.trim())),
      });
    } else {
      const start = i;
      while (
        i < lines.length &&
        lines[i].trim() &&
        (i === start ||
          !(
            BULLET.test(lines[i]) ||
            NUMBER.test(lines[i]) ||
            (!quoted && QUOTE.test(lines[i]))
          ))
      )
        i++;
      blocks.push(paragraph(lines.slice(start, i)));
    }
  }
  return blocks;
}

/** The words of a tree, with each mention as `name(id)` gives it. For one-line excerpts. */
export function plainText(
  nodes: readonly Inline[],
  name: (id: string) => string,
): string {
  return nodes
    .map((node) => {
      switch (node.t) {
        case "text":
          return node.text;
        case "break":
          return " ";
        case "mention":
          return name(node.id);
        default:
          return plainText(node.children, name);
      }
    })
    .join("");
}
