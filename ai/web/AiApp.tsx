/**
 * wingfoil.ie in your AI assistant: the page that hands out the MCP server.
 * `src/main.tsx` lazy-loads it for /ai, so neither the map nor the other
 * sections pay for it.
 *
 * Two steps: add wingfoil.ie to your AI, then ask. Every assistant is a tile
 * with its own buttons, Add where it takes a server and Ask, so one tap opens
 * its app (ai/web/install.ts says how, on this device). The last one used is
 * remembered: its button is the one filled, the note under the tiles is its,
 * and the example questions open in it. The endpoint is mcp/api/server.ts.
 *
 * Set as the chart's broadsheet: the headline with the question it is all for
 * under it, the steps under heavy rules with their numbers in the chart's
 * ring, and the editors and terminals in a ruled column beside them on a
 * computer, under them on a phone, which can only copy their lines.
 */
import { ArrowLeft, ArrowUpRight, Check, Copy, Plus } from "lucide-react";
import {
  Fragment,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { CHART_HREF } from "../../force5/src/siteNav";
import { API_ROOT } from "../../shared/web/http";
import { usePageTitle } from "../../shared/web/usePageTitle";
import {
  Button,
  Headline,
  Kicker,
  Pane,
  PenUnderline,
  SectionHeading,
} from "../../ui";
import { Masthead, MastheadMark, mastheadStyles } from "../../ui/Masthead";
import { MONO_LABEL, RING, tv } from "../../ui/tv";
import {
  ASKING,
  ASSISTANTS,
  ASSISTANT_NAME,
  EXAMPLE_PROMPTS,
  NO_LIVE_DATA,
  addPlan,
  addressParts,
  askLink,
  askNote,
  askSends,
  claudeCodeCommand,
  codexConfig,
  cursorLink,
  deviceOf,
  geminiConfig,
  isAssistant,
  mcpUrl,
  vscodeLink,
  type Assistant,
} from "./install";

const styles = tv({
  slots: {
    root: "flex min-h-dvh flex-col bg-ground paper-grain font-body text-prose text-ink antialiased",
    page: "mx-auto flex w-full max-w-page flex-1 flex-col px-safe-6 max-wide:px-safe-3",
    main: "flex flex-col gap-10 pt-6 pb-14 max-wide:gap-8 max-wide:pt-5",
    hero: "flex max-w-form flex-col gap-3",
    // The question the page is for, under the headline: the display face's
    // light italic, as the headline's own soft part is set.
    ask: "m-0 font-display text-lead font-normal tracking-tight text-pretty text-ink-2 italic wide:text-title wide:font-normal",
    lead: "m-0 font-body text-prose text-pretty text-ink-2",
    // The steps, and on a computer the editors beside them.
    columns:
      "grid items-start gap-x-12 gap-y-10 rail:grid-cols-detail max-wide:gap-y-8",
    steps: "m-0 flex list-none flex-col gap-8 p-0",
    step: "flex gap-4 max-wide:gap-3",
    // The step's number as the chart draws a light's: a figure in a ring.
    number:
      "inline-grid size-9 shrink-0 place-items-center rounded-full border border-ink font-mono text-figure tabular-nums",
    stepBody: "flex min-w-0 flex-1 flex-col gap-3",
    // Two across on a phone, and as many as fit once there is the room.
    tiles: "m-0 grid list-none grid-cols-2 gap-2 p-0 wide:grid-cols-tiles",
    tileItem: "flex min-w-0",
    tile: "flex flex-1 flex-col gap-1 p-3",
    tileName: "m-0 font-display text-lead text-ink",
    tileBrief: "m-0 font-body text-body text-ink-2",
    // The buttons sit side by side where they fit, and a narrow tile stacks
    // them, each its full width, so the two are always the same size.
    tileActions: "mt-auto flex flex-wrap gap-2 pt-2",
    tileAction: "grow",
    actions: "flex flex-wrap items-center gap-2",
    note: "m-0 max-w-reading font-body text-body text-ink-2",
    prompts: "m-0 flex list-none flex-col p-0",
    prompt: "flex items-center gap-1 border-0 border-b border-line py-1",
    // The whole question is the link, its arrow saying it leaves the site.
    promptLink: [
      "flex min-w-0 flex-1 items-center justify-between gap-3 rounded-control py-1.5",
      "font-body text-prose text-ink italic no-underline hover:text-chart-magenta",
      RING,
    ],
    promptGlyph: "shrink-0 text-ink-muted",
    // The coding agents: a ruled column beside the steps on a computer, and
    // under them on a phone, which can copy their lines to send itself.
    coders:
      "flex flex-col gap-3 rail:border-0 rail:border-l rail:border-line rail:pl-8",
    where: "m-0 flex flex-wrap items-baseline gap-2",
    path: "font-mono text-caption text-ink-muted",
    // The column is narrow, and a box that scrolls sideways with no bar
    // showing reads as a command cut off: the lines wrap, keeping their
    // indents, and break a long address where they must.
    code: "m-0 border-0 border-l-3 border-ink bg-sunken px-3 py-2 font-mono text-caption whitespace-pre-wrap wrap-anywhere text-ink",
    row: "flex items-start gap-2",
    rowCode: "min-w-0 flex-1",
    address: ["m-0 flex items-center gap-2 text-ink-muted", MONO_LABEL],
    addressLabel: "shrink-0",
    // Broken only after a slash (addressParts), unless one piece is wider
    // than the phone: "…/api/mc" over "p" reads as a wrong address.
    addressValue:
      "min-w-0 font-mono text-caption tracking-normal wrap-break-word text-ink normal-case",
    // A glyph-only copy button says "Copied" in a tag above it, as the
    // worded ones say it in place: over the row, so nothing beside it moves.
    copyAt: "relative inline-flex shrink-0",
    copiedTag: [
      "pointer-events-none absolute right-0 bottom-full z-panel mb-1 rounded-control bg-inverse px-1.5 py-0.5 whitespace-nowrap text-ink-inverse",
      MONO_LABEL,
    ],
  },
});

const STORE_KEY = "wingfoil:ai-assistant";

/** The assistant used last time on this device, or Claude. */
function storedAssistant(): Assistant {
  try {
    const kept = globalThis.localStorage?.getItem(STORE_KEY);
    return isAssistant(kept) ? kept : "claude";
  } catch {
    return "claude";
  }
}

function keepAssistant(assistant: Assistant) {
  try {
    globalThis.localStorage?.setItem(STORE_KEY, assistant);
  } catch {
    // Storage blocked: the choice lasts as long as the page.
  }
}

/**
 * Copy, then say so for a moment. The copy answers once the clipboard has
 * it, so a caller can say more than "Copied".
 */
function useCopied(): [boolean, (value: string) => Promise<void>] {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const copy = async (value: string) => {
    if (!navigator.clipboard) throw new Error("No clipboard");
    await navigator.clipboard.writeText(value);
    setCopied(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1600);
  };
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return [copied, copy];
}

/**
 * What a copy says to a screen reader: the same "Copied" every button shows,
 * in a live region that is always there, so the change is heard.
 */
function CopiedStatus({ copied, label }: { copied: boolean; label: string }) {
  return (
    <span className="sr-only" role="status">
      {copied ? `Copied ${label}` : ""}
    </span>
  );
}

function CopyButton({
  value,
  label,
  bare = false,
}: {
  value: string;
  label: string;
  /** The glyph alone, in a row of text where words would crowd it. */
  bare?: boolean;
}) {
  const s = styles();
  const [copied, copy] = useCopied();
  const Glyph = copied ? Check : Copy;
  if (bare)
    return (
      <span className={s.copyAt()}>
        <Button
          icon
          variant="quiet"
          size="sm"
          aria-label={`Copy ${label}`}
          title="Copy"
          onClick={() => void copy(value).catch(() => {})}
        >
          <Glyph size={14} aria-hidden="true" />
        </Button>
        {copied && (
          <span className={s.copiedTag()} aria-hidden="true">
            Copied
          </span>
        )}
        <CopiedStatus copied={copied} label={label} />
      </span>
    );
  return (
    <>
      <Button
        variant="pill"
        size="sm"
        aria-label={`Copy ${label}`}
        onClick={() => void copy(value).catch(() => {})}
      >
        <Glyph size={14} aria-hidden="true" />
        <span>{copied ? "Copied" : "Copy"}</span>
      </Button>
      <CopiedStatus copied={copied} label={label} />
    </>
  );
}

/** A line to paste, with its own copy button. */
function Snippet({ value, label }: { value: string; label: string }) {
  const s = styles();
  return (
    <div className={s.row()}>
      <pre className={s.code({ className: s.rowCode() })}>{value}</pre>
      <CopyButton value={value} label={label} />
    </div>
  );
}

/**
 * The question the page is for, with the pen under the words that carry it
 * ("after work"): the one mark on the page.
 */
function Subhead({ prompt }: { prompt: string }) {
  const s = styles();
  const words = "after work";
  const at = prompt.indexOf(words);
  return (
    <p className={s.ask()}>
      &ldquo;
      {at < 0 ? (
        prompt
      ) : (
        <>
          {prompt.slice(0, at)}
          <PenUnderline>{words}</PenUnderline>
          {prompt.slice(at + words.length)}
        </>
      )}
      &rdquo;
    </p>
  );
}

/** One numbered step under its rule. */
function Step({
  n,
  id,
  title,
  children,
}: {
  n: number;
  id: string;
  title: string;
  children: ReactNode;
}) {
  const s = styles();
  return (
    <li className={s.step()} aria-labelledby={id}>
      <span className={s.number()} aria-hidden="true">
        {n}
      </span>
      <div className={s.stepBody()}>
        <SectionHeading id={id} as="h2">
          {title}
        </SectionHeading>
        {children}
      </div>
    </li>
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
  const phone = device !== "computer";
  const [assistant, setAssistant] = useState<Assistant>(storedAssistant);
  const [copied, copy] = useCopied();
  // The app the address was copied for, which the note under the tiles
  // keeps saying (the copy's own "Copied" is gone by the time the reader is
  // back from the app's tab), until another app is used.
  const [copiedFor, setCopiedFor] = useState<Assistant | null>(null);
  const use = (next: Assistant) => {
    if (next !== assistant) setCopiedFor(null);
    setAssistant(next);
    keepAssistant(next);
  };
  const name = ASSISTANT_NAME[assistant];
  const plan = addPlan(assistant, device, url);
  // A computer keeps this page in its tab. A phone follows the link in the
  // same one: that is what hands it to the app (a universal link, or an
  // Android intent), where a new tab can stay in the browser.
  const away = phone ? {} : { target: "_blank", rel: "noopener" };

  const add = (next: Assistant) => {
    use(next);
    if (addPlan(next, device, url)?.copies)
      void copy(url).then(
        () => setCopiedFor(next),
        () => {},
      );
  };
  // Copied on the way, for the app that may not type it in.
  const ask = (next: Assistant, prompt: string) => {
    use(next);
    if (!askSends(next)) void navigator.clipboard?.writeText(prompt);
  };
  const addNote = !plan
    ? `${name} can't take wingfoil.ie, so it answers without the forecast. Every app with an Add button can.`
    : copiedFor === assistant && plan.copiedNote
      ? plan.copiedNote
      : plan.note;

  return (
    <div className={s.root()}>
      <div className={s.page()}>
        <Masthead>
          <SiteMenu current="ai" size="sm" ground="content" />
          <a
            href="/"
            className={mastheadStyles().brand()}
            aria-label="wingfoil.ie, wind map"
          >
            <MastheadMark section="AI" />
          </a>
          {/* The way back, as the spot pages give it. */}
          <span className={mastheadStyles().actions()}>
            <Button variant="link" size="sm" href={CHART_HREF} data-back-to-map>
              <ArrowLeft size={13} strokeWidth={1.5} aria-hidden="true" />
              <span>Chart</span>
            </Button>
          </span>
        </Masthead>

        <main className={s.main()}>
          <div className={s.hero()}>
            <Headline>Ask your AI.</Headline>
            <Subhead prompt={EXAMPLE_PROMPTS[0]} />
            <p className={s.lead()}>
              wingfoil.ie is built into your AI. Add it once and you won&rsquo;t
              need to check this site again: just ask.
            </p>
          </div>

          <div className={s.columns()}>
            <ol className={s.steps()}>
              <Step n={1} id="ai-add" title="Add wingfoil.ie to your AI">
                <ul className={s.tiles()}>
                  {ASSISTANTS.map((a) => {
                    const tilePlan = addPlan(a, device, url);
                    const tileName = ASSISTANT_NAME[a];
                    const current = a === assistant;
                    const flash = copied && copiedFor === a;
                    // A button that copies says so before it is pressed,
                    // with the copy glyph, and after, with the same "Copied"
                    // as every copy button on the page.
                    const AddGlyph = flash
                      ? Check
                      : tilePlan?.copies
                        ? Copy
                        : Plus;
                    const AskGlyph =
                      ASKING[a] === "paste" ? Copy : ArrowUpRight;
                    return (
                      <li key={a} className={s.tileItem()}>
                        <Pane className={s.tile()} data-assistant={a}>
                          <h3 className={s.tileName()}>{tileName}</h3>
                          <p className={s.tileBrief()}>
                            {tilePlan ? tilePlan.brief : NO_LIVE_DATA}
                          </p>
                          <div className={s.tileActions()}>
                            {/* The app used last has the one filled button:
                                Add where it takes the server, else Ask. */}
                            {tilePlan && (
                              <Button
                                href={tilePlan.href}
                                {...away}
                                variant={current ? "primary" : "pill"}
                                className={s.tileAction()}
                                onClick={() => add(a)}
                                aria-label={`Add wingfoil.ie to ${tileName}`}
                                data-add={a}
                              >
                                <AddGlyph size={14} aria-hidden="true" />
                                <span>{flash ? "Copied" : "Add"}</span>
                              </Button>
                            )}
                            <Button
                              href={askLink(a, EXAMPLE_PROMPTS[0], device)}
                              {...away}
                              variant={
                                current && !tilePlan ? "primary" : "pill"
                              }
                              className={s.tileAction()}
                              onClick={() => ask(a, EXAMPLE_PROMPTS[0])}
                              aria-label={`Ask ${tileName}`}
                              data-ask={a}
                            >
                              <AskGlyph size={14} aria-hidden="true" />
                              <span>Ask</span>
                            </Button>
                          </div>
                        </Pane>
                      </li>
                    );
                  })}
                </ul>
                <CopiedStatus
                  copied={copied && copiedFor !== null}
                  label="the server address"
                />
                {/* The address under the buttons that copy it, so what is
                    on the clipboard is in sight. */}
                <p className={s.address()}>
                  <span className={s.addressLabel()}>The address</span>
                  <code className={s.addressValue()}>
                    {addressParts(url).map((part, i) => (
                      <Fragment key={i}>
                        {part}
                        <wbr />
                      </Fragment>
                    ))}
                  </code>
                  <CopyButton value={url} label="the server address" bare />
                </p>
                <p className={s.note()} aria-live="polite" data-add-note>
                  {addNote}
                </p>
              </Step>

              <Step n={2} id="ai-ask" title="Ask">
                <ul className={s.prompts()}>
                  {EXAMPLE_PROMPTS.map((prompt) => (
                    <li key={prompt} className={s.prompt()}>
                      <a
                        className={s.promptLink()}
                        href={askLink(assistant, prompt, device)}
                        {...away}
                        onClick={() => ask(assistant, prompt)}
                        aria-label={`Ask ${name}: ${prompt}`}
                      >
                        <span>&ldquo;{prompt}&rdquo;</span>
                        <ArrowUpRight
                          size={15}
                          className={s.promptGlyph()}
                          aria-hidden="true"
                        />
                      </a>
                      <CopyButton value={prompt} label="the question" bare />
                    </li>
                  ))}
                </ul>
                <p className={s.note()} data-ask-note>
                  {askNote(assistant)} To ask another app, press its Ask above.
                </p>
              </Step>
            </ol>

            <section className={s.coders()} aria-labelledby="ai-coders">
              <SectionHeading id="ai-coders">Coding agents</SectionHeading>
              {/* Cursor's and VS Code's links open the editor on this
                  machine, which a phone has not got. */}
              {phone ? (
                <p className={s.note()}>
                  These run on a computer. Copy a line to send yourself, or open
                  this page there to add wingfoil.ie to Cursor or VS Code in one
                  click.
                </p>
              ) : (
                <div className={s.actions()}>
                  <Button href={cursorLink(url)} variant="pill" size="sm">
                    <span>Add to Cursor</span>
                  </Button>
                  <Button href={vscodeLink(url)} variant="pill" size="sm">
                    <span>Add to VS Code</span>
                  </Button>
                </div>
              )}
              <Kicker>Claude Code</Kicker>
              <Snippet
                value={claudeCodeCommand(url)}
                label="the Claude Code command"
              />
              <p className={s.where()}>
                <Kicker as="span">Codex</Kicker>
                <code className={s.path()}>~/.codex/config.toml</code>
              </p>
              <Snippet value={codexConfig(url)} label="the Codex config" />
              <p className={s.where()}>
                <Kicker as="span">Gemini CLI</Kicker>
                <code className={s.path()}>~/.gemini/settings.json</code>
              </p>
              <Snippet
                value={geminiConfig(url)}
                label="the Gemini CLI config"
              />
            </section>
          </div>
        </main>
      </div>
    </div>
  );
}
