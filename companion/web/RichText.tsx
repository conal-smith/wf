import { richText, type Inline } from "./format";

function Inlines({ parts }: { parts: Inline[] }) {
  return parts.map((p, i) =>
    p.bold ? (
      <strong key={i} className="font-semibold text-ink">
        {p.text}
      </strong>
    ) : (
      <span key={i}>{p.text}</span>
    ),
  );
}

/** Gust's words: paragraphs, lists and bold only, never HTML. */
export function RichText({ text }: { text: string }) {
  return (
    <div className="flex flex-col gap-2">
      {richText(text).map((block, i) =>
        block.kind === "paragraph" ? (
          <p key={i}>
            <Inlines parts={block.inlines} />
          </p>
        ) : (
          (() => {
            const List = block.ordered ? "ol" : "ul";
            return (
              <List
                key={i}
                className={`m-0 flex flex-col gap-1 pl-5 ${block.ordered ? "list-decimal" : "list-disc"}`}
              >
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Inlines parts={item} />
                  </li>
                ))}
              </List>
            );
          })()
        ),
      )}
    </div>
  );
}
