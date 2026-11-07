/**
 * wingfoil.ie in your AI app: the page that hands out the MCP server.
 * `src/main.tsx` lazy-loads it for /ai, so neither the map nor the other
 * sections pay for it.
 *
 * Under the site's top bar, a short scene (ai/web/scene.ts, its look in
 * ai/web/ai.css): "wingfoil.ie is fully compatible with your bots" types
 * itself; a phone rises with an AI app on it, asked where to wing foil on
 * Saturday, answering with a little wind chart from wingfoil.ie; then the
 * phone slides over and the ways in come beside it. Those are a list of the
 * apps, each its own mark from its maker's brand page (public/logos/),
 * and one row: pressed, it does what ai/web/install.ts says for that app on
 * this device. Claude opens with the address filled in; the others copy the
 * address and open the app's page for it, and then the row says the one
 * thing left to do. The last row copies the address for an app the page does
 * not name. The endpoint is mcp/api/server.ts.
 */
import { ArrowUpRight, Copy, Link2, MessageSquareText, RotateCcw } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { CHART_HREF, spotHref } from "../../force5/src/siteNav";
import { API_ROOT } from "../../shared/web/http";
import { usePageTitle } from "../../shared/web/usePageTitle";
import { Button, SpotSearch, TopBar } from "../../ui";
import { tv } from "../../ui/tv";
import "./ai.css";
import {
  ASSISTANTS,
  ASSISTANT_NAME,
  addPlan,
  deviceOf,
  mcpUrl,
  pasteLine,
  type Assistant,
} from "./install";
import { startScene } from "./scene";

const styles = tv({
  slots: {
    root: "flex min-h-dvh flex-col overflow-x-hidden bg-ground font-body text-ink antialiased",
    // A row: the app's mark, "Add to …", and the arrow, the whole row one
    // press, lifted onto the ground under the pointer.
    row: [
      "ai-row grid h-auto w-full grid-cols-ai-row items-center justify-stretch gap-x-3.5 rounded-control px-3 py-2.75 text-left whitespace-normal",
      "not-disabled:hover:bg-ground not-disabled:hover:shadow-card pointer-coarse:min-h-0",
    ],
    name: "block font-body text-ai-row font-semibold tracking-tight text-ink",
    other: "text-ink-2",
    line: "mt-0.5 block font-body text-body font-normal text-ok",
  },
});

/** A row of the list: an app, or the last, for any other. */
type Row = Assistant | "other";


/**
 * Each app's mark, its maker's own file, unaltered. A mark its maker draws in
 * one colour only is drawn through its shape in the ink, black on light and
 * white on dark, as each maker asks; the others are drawn as they are.
 */
const LOGO: Record<Assistant, { file: string; mono?: boolean; wide?: boolean }> = {
  chatgpt: { file: "openai-blossom.svg", mono: true, wide: true },
  claude: { file: "claude-spark.svg" },
  grok: { file: "grok-logomark.svg", mono: true },
  perplexity: { file: "perplexity-symbol.svg", mono: true },
  lechat: { file: "mistral-icon.svg" },
};

function Logo({ app }: { app: Row }) {
  if (app === "other")
    return (
      <span className="ai-logo">
        <Link2 size={18} strokeWidth={1.7} aria-hidden="true" />
      </span>
    );
  const { file, mono, wide } = LOGO[app];
  // Not under /ai/: public/_redirects hands every /ai/* to the app.
  const src = `/logos/${file}`;
  return (
    <span className="ai-logo">
      {mono ? (
        <i
          className={wide ? "mono is-wide" : "mono"}
          style={{ "--ai-mark": `url(${src})` } as CSSProperties}
          aria-hidden="true"
        />
      ) : (
        <img src={src} alt="" />
      )}
    </span>
  );
}

const STAR =
  "M0,-5 L1.47,-2.02 4.76,-1.55 2.38,0.77 2.94,4.05 0,2.5 -2.94,4.05 -2.38,0.77 -4.76,-1.55 -1.47,-2.02Z";

/** The phone, with an AI app open on it: the scene moves what is inside. */
function Phone() {
  const star = (
    <svg width="9" height="9" viewBox="-5 -5 10 10" aria-hidden="true">
      <path d={STAR} fill="currentColor" />
    </svg>
  );
  return (
    <div
      className="ai-phone"
      role="img"
      aria-label="A phone running an AI chat app. Asked where to wing foil this Saturday, the assistant answers with a wingfoil.ie wind chart pinned on Rosslare, 18 to 22 knots, four stars."
    >
      <span className="ai-key l1" />
      <span className="ai-key l2" />
      <span className="ai-key l3" />
      <span className="ai-key r1" />
      <div className="ai-screen" aria-hidden="true">
        <div className="ai-island" />
        <div className="ai-status">
          <span>9:41</span>
          <span className="ic">
            <svg width="17" height="11" viewBox="0 0 17 11" fill="currentColor">
              <rect x="0" y="7" width="3" height="4" rx="1" />
              <rect x="4.5" y="5" width="3" height="6" rx="1" />
              <rect x="9" y="2.5" width="3" height="8.5" rx="1" />
              <rect x="13.5" y="0" width="3" height="11" rx="1" />
            </svg>
            <svg width="15" height="11" viewBox="0 0 15 11" fill="currentColor">
              <path d="M7.5 2.2c2.1 0 4 .8 5.4 2.1l1.1-1.1C12.3 1.6 10 .6 7.5.6S2.7 1.6 1 3.2l1.1 1.1C3.5 3 5.4 2.2 7.5 2.2Zm0 3.1c1.2 0 2.3.5 3.2 1.2l1.1-1.1C10.6 4.3 9.1 3.7 7.5 3.7s-3.1.6-4.3 1.7l1.1 1.1c.9-.7 2-1.2 3.2-1.2Zm0 3.1c-.4 0-.8.2-1.1.4l1.1 1.1 1.1-1.1c-.3-.2-.7-.4-1.1-.4Z" />
            </svg>
            <svg width="25" height="12" viewBox="0 0 25 12" fill="none">
              <rect x="0.5" y="0.5" width="21" height="11" rx="3.2" stroke="currentColor" opacity="0.4" />
              <rect x="2" y="2" width="15" height="8" rx="1.8" fill="currentColor" />
              <path d="M23 4v4c.8-.3 1.3-1.1 1.3-2S23.8 4.3 23 4Z" fill="currentColor" opacity="0.45" />
            </svg>
          </span>
        </div>
        <div className="ai-apphead">
          <span className="ib">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M4 8h16M4 14h10" />
            </svg>
          </span>
          <span className="ttl">
            <b>Assistant</b>
            <span className="ai-conn">
              <i />
              wingfoil.ie connected
            </span>
          </span>
          <span className="ib">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 5H6.5A1.5 1.5 0 0 0 5 6.5v11A1.5 1.5 0 0 0 6.5 19h11a1.5 1.5 0 0 0 1.5-1.5V12" />
              <path d="m17.5 4.5 2 2L13 13l-2.6.6.6-2.6Z" />
            </svg>
          </span>
        </div>
        <div className="ai-msgs">
          <div className="ai-track" data-scene="track">
            <div className="ai-it ai-hello on" data-scene="hello">
              <b>Good morning</b>
              Ask anything. wingfoil.ie is on, so I can read the wind, tide and every spot's stars.
            </div>
            <div className="ai-it ai-user" data-scene="user">
              Where should I wing foil this Saturday?
            </div>
            <div className="ai-it ai-tool" data-scene="tool">
              <span className="ai-av">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 2.5l2.1 6.3 6.4 2.2-6.4 2.2L12 19.5l-2.1-6.3L3.5 11l6.4-2.2Z" />
                </svg>
              </span>
              <span className="ai-tk">
                <span className="g" data-scene="tool-icon">
                  <span className="ai-spin" />
                </span>
                <span className="ai-shimmer" data-scene="tool-text">
                  Checking wingfoil.ie
                </span>
              </span>
            </div>
            <div className="ai-it ai-say" data-scene="say1" data-say>
              Saturday afternoon at <b>Rosslare</b>. A south-westerly builds all morning and holds <b>18–22 kn</b> from noon, side-shore on the strand.
            </div>
            <div className="ai-it ai-card" data-scene="card">
              <div className="ai-card-head">
                <span className="ai-wm">
                  wingfoil<span className="ai-wm-ie">.ie</span>
                </span>
                <span className="ai-card-time">Sat 7 Nov · 14:00</span>
              </div>
              <div className="ai-map" data-scene="map">
                <canvas data-scene="canvas" />
                <div className="ai-pin" data-scene="pin">
                  <b />
                  <i />
                </div>
                <div className="ai-tag" data-scene="tag">
                  Rosslare
                  <span className="dot" />
                  <span className="k">18–22 kn</span>
                  <span className="dot" />
                  <span className="ai-stars">
                    {star}
                    {star}
                    {star}
                    {star}
                  </span>
                </div>
                <div className="ai-scale fade">
                  <span>0</span>
                  <span className="bar" data-scene="scale-bar" />
                  <span>40 kn</span>
                </div>
              </div>
              <div className="ai-card-foot">
                <div className="top">
                  <span className="nm">Rosslare Strand</span>
                  <span className="open">
                    Open chart <ArrowUpRight size={10} strokeWidth={2.2} />
                  </span>
                </div>
                <div className="ai-hours" data-scene="hours" />
              </div>
            </div>
            <div className="ai-it ai-say" data-scene="say2" data-say>
              High water 15:40, so the bar stays covered all afternoon. Brittas Bay is the backup at 15–18 kn.
            </div>
          </div>
        </div>
        <div className="ai-composer">
          <div className="ai-cbox">
            <span className="plus">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
            </span>
            <span className="txt ph" data-scene="ctext">
              Ask anything
            </span>
            <span className="ai-send" data-scene="send">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </span>
          </div>
        </div>
        <div className="ai-homebar">
          <i />
        </div>
      </div>
    </div>
  );
}

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
  const stage = useRef<HTMLElement>(null);
  useEffect(() => (stage.current ? startScene(stage.current) : undefined), []);

  const copy = (row: Row) => {
    setCopied(null);
    void navigator.clipboard?.writeText(url).then(
      () => setCopied(row),
      () => {},
    );
  };
  const lineFor = (row: Row) =>
    pasteLine(row === "other" ? undefined : ASSISTANT_NAME[row]);
  const line = (row: Row) =>
    copied === row && (
      <span className={s.line()} data-line>
        {lineFor(row)}
      </span>
    );

  return (
    <div className={s.root()}>
      <TopBar
        search={
          <SpotSearch
            onPick={(spot) => window.location.assign(spotHref(spot.id))}
          />
        }
        view={{ to: "chart", href: CHART_HREF }}
        menu={<SiteMenu current="ai" />}
      />
      <main className="ai-stage" ref={stage}>
        <div className="ai-intro" data-scene="intro" aria-hidden="true" />
        <div className="ai-layout">
          <div className="ai-head ai-reveal" data-scene="head">
            <span className="ai-eyebrow">
              <MessageSquareText size={16} strokeWidth={1.6} aria-hidden="true" />
              Use with AI
            </span>
            <h1 className="ai-h1" data-scene="h1">
              <span className="ai-wm">
                wingfoil<span className="ai-wm-ie">.ie</span>
              </span>{" "}
              is fully compatible <span className="ai-soft">with your bots.</span>
            </h1>
          </div>
          <div className="ai-slot" data-scene="slot">
            <Phone />
          </div>
          <p className="ai-sub ai-reveal" data-scene="sub">
            Ask the AI app you already use where to ride this weekend. It reads
            the same forecast as the chart: wind, gusts, tide and every spot's
            stars.
          </p>
          <div className="ai-apps">
            <ul className="ai-list ai-reveal" data-scene="list">
              {ASSISTANTS.map((a) => {
                const plan = addPlan(a, device, url);
                return (
                  <li key={a}>
                    <Button
                      href={plan.href}
                      {...away}
                      variant="quiet"
                      className={s.row()}
                      onClick={() => (plan.copies ? copy(a) : setCopied(null))}
                      data-app={a}
                    >
                      <Logo app={a} />
                      <span>
                        <span className={s.name()}>Add to {ASSISTANT_NAME[a]}</span>
                        {line(a)}
                      </span>
                      <span className="ai-go">
                        <ArrowUpRight size={15} strokeWidth={2} aria-hidden="true" />
                      </span>
                    </Button>
                  </li>
                );
              })}
              <li>
                <Button
                  variant="quiet"
                  className={s.row()}
                  onClick={() => copy("other")}
                  data-app="other"
                >
                  <Logo app="other" />
                  <span>
                    <span className={s.name({ className: s.other() })}>
                      Another app
                    </span>
                    {line("other")}
                  </span>
                  <span className="ai-go">
                    <Copy size={15} strokeWidth={1.8} aria-hidden="true" />
                  </span>
                </Button>
              </li>
            </ul>
            <p className="ai-fine ai-reveal" data-scene="fine">
              Free and read-only. No account, no sign-in.
              <span className="ai-tm">
                Product names and logos are trademarks of their owners, who do
                not endorse wingfoil.ie.
              </span>
            </p>
          </div>
        </div>
        <Button className="ai-replay" data-scene="replay" variant="outline" size="sm">
          <RotateCcw size={15} strokeWidth={2} aria-hidden="true" />
          Replay
        </Button>
        {/* The copied line, said to a screen reader: a live region that is
            always there, so the change is heard. */}
        <p className="sr-only" role="status">
          {copied ? lineFor(copied) : ""}
        </p>
      </main>
    </div>
  );
}
