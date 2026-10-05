/**
 * The little formatting Gust writes (pure): paragraphs, "- " / "1. " lists and
 * **bold**. Everything else is plain text; nothing is ever rendered as HTML.
 */
export type Inline = { text: string; bold: boolean };
export type RichBlock =
  | { kind: "paragraph"; inlines: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] };

export function inlines(text: string): Inline[] {
  const out: Inline[] = [];
  let last = 0;
  for (const m of text.matchAll(/\*\*(.+?)\*\*/g)) {
    if (m.index > last)
      out.push({ text: text.slice(last, m.index), bold: false });
    out.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), bold: false });
  return out;
}

const BULLET = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/;

export function richText(source: string): RichBlock[] {
  const blocks: RichBlock[] = [];
  for (const chunk of source.replace(/\r\n/g, "\n").split(/\n{2,}/)) {
    let para: string[] = [];
    const flush = () => {
      if (para.length)
        blocks.push({
          kind: "paragraph",
          inlines: inlines(para.join(" ").trim()),
        });
      para = [];
    };
    for (const line of chunk.split("\n").filter((l) => l.trim())) {
      const m = BULLET.exec(line);
      if (!m) {
        para.push(line.trim());
        continue;
      }
      flush();
      const ordered = m[1] !== undefined;
      const prev = blocks.at(-1);
      if (prev?.kind === "list" && prev.ordered === ordered)
        prev.items.push(inlines(m[2]));
      else blocks.push({ kind: "list", ordered, items: [inlines(m[2])] });
    }
    flush();
  }
  return blocks;
}
