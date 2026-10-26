/**
 * wingfoil.ie in your AI app: the page that hands out the MCP server.
 * `src/main.tsx` lazy-loads it for /ai, so neither the map nor the other
 * sections pay for it.
 *
 * The mock-up the owner approved in PR 236 (2026-10-26-ai-page.html on
 * agent/ai-page-mockup): the spot finder's header, one line, then a list of
 * the apps, each its name and one button. The button does what
 * ai/web/install.ts says for that app on this device: Claude opens with the
 * address filled in; the others copy the address and open the app's page for
 * it, and then the row says the one thing left to do. The last row copies
 * the address for an app the page does not name. The endpoint is
 * mcp/api/server.ts.
 */
import { ArrowUpRight, Copy } from "lucide-react";
import { useMemo, useState } from "react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { API_ROOT } from "../../shared/web/http";
import { usePageTitle } from "../../shared/web/usePageTitle";
import { Button, PageHeader } from "../../ui";
import { tv } from "../../ui/tv";
import {
  ASSISTANTS,
  ASSISTANT_NAME,
  addPlan,
  deviceOf,
  mcpUrl,
  pasteLine,
  type Assistant,
} from "./install";

const styles = tv({
  slots: {
    root: "flex min-h-dvh flex-col bg-ground paper-grain font-body text-ink antialiased",
    main: [
      "mx-auto w-full max-w-ai px-6 pt-10 pb-18",
      "max-wide:px-3.5 max-wide:pt-4.5 max-wide:pb-14",
    ],
    intro: [
      "m-0 mb-5.5 font-body text-ai-intro text-pretty text-ink-2",
      "max-wide:mb-4 max-wide:text-ai-intro-sm",
    ],
    list: "m-0 list-none p-0",
    // The name and its button on a hairline, and under them, once pressed,
    // the line saying what is left to do.
    row: [
      "flex flex-wrap items-center gap-x-4 border-0 border-b border-line py-3.5",
      "first:border-t max-wide:py-3",
    ],
    name: "m-0 min-w-0 flex-1 font-display text-ai-name text-ink max-wide:text-ai-name-sm",
    // The last row's, which is not an app's name.
    other: "font-medium italic",
    // One width for every button, so they stand in a column.
    button: "h-touch w-52.5 gap-2 rounded-full max-wide:w-49",
    line: "m-0 w-full pt-2 font-body text-ai-line text-ink-2 max-wide:text-ai-line-sm",
  },
});

/** A row of the list: an app, or the last, for any other. */
type Row = Assistant | "other";

export default function AiApp() {
  usePageTitle("Connect your AI agent to the wing foil forecast", "AI");
  const s = styles();
  const url = mcpUrl(API_ROOT, window.location.origin);
  const device = useMemo(
    () => deviceOf(navigator.userAgent, navigator.maxTouchPoints),
    [],
  );
  // A computer keeps this page in its tab. A phone follows the link in the
  // same one: that is what hands it to the app (a universal link, or an
  // Android intent), where a new tab can stay in the browser.
  const away =
    device === "computer" ? { target: "_blank", rel: "noopener" } : {};
  // The row whose button last copied the address: its line stays until
  // another is pressed, since the rider reads it on coming back from the app.
  const [copied, setCopied] = useState<Row | null>(null);

  const copy = (row: Row) => {
    setCopied(null);
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(row),
      () => {},
    );
  };
  const lineFor = (row: Row) =>
    pasteLine(row === "other" ? undefined : ASSISTANT_NAME[row]);

  return (
    <div className={s.root()}>
      <PageHeader menu={<SiteMenu current="ai" />} />
      <main className={s.main()}>
        <h1 className="sr-only">Add wingfoil.ie to your AI app</h1>
        <p className={s.intro()}>
          wingfoil.ie is fully compatible with your bots. Click below to add
          your favourite bot.
        </p>
        <ul className={s.list()}>
          {ASSISTANTS.map((a) => {
            const plan = addPlan(a, device, url);
            const name = ASSISTANT_NAME[a];
            return (
              <li key={a} className={s.row()}>
                <h2 className={s.name()}>{name}</h2>
                <Button
                  href={plan.href}
                  {...away}
                  variant="raised"
                  className={s.button()}
                  onClick={() => (plan.copies ? copy(a) : setCopied(null))}
                  data-app={a}
                >
                  <span>Add to {name}</span>
                  <ArrowUpRight
                    size={14}
                    strokeWidth={1.5}
                    aria-hidden="true"
                  />
                </Button>
                {copied === a && (
                  <p className={s.line()} data-line>
                    {lineFor(a)}
                  </p>
                )}
              </li>
            );
          })}
          <li className={s.row()}>
            <h2 className={s.name({ className: s.other() })}>Another app</h2>
            <Button
              variant="raised"
              className={s.button()}
              onClick={() => copy("other")}
              data-app="other"
            >
              <span>Copy address</span>
              <Copy size={14} strokeWidth={1.5} aria-hidden="true" />
            </Button>
            {copied === "other" && (
              <p className={s.line()} data-line>
                {lineFor("other")}
              </p>
            )}
          </li>
        </ul>
        {/* The same line, said to a screen reader: a live region that is
            always there, so the change is heard. */}
        <p className="sr-only" role="status">
          {copied ? lineFor(copied) : ""}
        </p>
      </main>
    </div>
  );
}
