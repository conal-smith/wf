/**
 * wingfoil.ie in your AI assistant: the page that hands out the MCP server.
 * `src/main.tsx` lazy-loads it for /ai, so neither the map nor the other
 * sections pay for it.
 *
 * Three steps driven by one choice: pick your AI, add wingfoil.ie to it, ask.
 * The pick is remembered, and it sets both the one filled button (the way
 * that app takes a server on this device, ai/web/install.ts) and where every
 * example question opens. The endpoint itself is mcp/api/server.ts.
 *
 * Set as the chart's broadsheet: the headline with the question it is all for
 * under it, the steps under heavy rules with their numbers in the chart's
 * ring, and on a computer the editors and terminals in a ruled column beside
 * them. A phone gets the apps and the questions and nothing else.
 */
import { ArrowLeft, ArrowUpRight, Check, Copy, Plus } from "lucide-react";
import { useMemo, useState, type MouseEvent, type ReactNode } from "react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { API_ROOT } from "../../shared/web/http";
import { usePageTitle } from "../../shared/web/usePageTitle";
import {
  Button,
  Headline,
  Kicker,
  PenUnderline,
  Segmented,
  SectionHeading,
} from "../../ui";
import { Masthead, MastheadMark, mastheadStyles } from "../../ui/Masthead";
import { MONO_LABEL, RING, tv } from "../../ui/tv";
import {
  ASSISTANTS,
  ASSISTANT_NAME,
  EXAMPLE_PROMPTS,
  addPlan,
  askLink,
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
    // The pick keeps its own width, as the dock's switch does.
    picker: "self-start",
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
    // The coding agents: a ruled column on a computer, and not on a phone,
    // which has none of them.
    coders:
      "flex flex-col gap-3 rail:border-0 rail:border-l rail:border-line rail:pl-8 max-wide:hidden",
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
    addressValue:
      "min-w-0 font-mono text-caption tracking-normal wrap-anywhere text-ink normal-case",
  },
});

const STORE_KEY = "wingfoil:ai-assistant";

/** The assistant picked last time on this device, or Claude. */
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
    // Storage blocked: the pick lasts as long as the page.
  }
}

/** Copy, then say so for a moment. */
function useCopied(): [boolean, (value: string) => void] {
  const [copied, setCopied] = useState(false);
  const copy = (value: string) => {
    void navigator.clipboard?.writeText(value).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    });
  };
  return [copied, copy];
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
  const [copied, copy] = useCopied();
  const Glyph = copied ? Check : Copy;
  if (bare)
    return (
      <Button
        icon
        variant="quiet"
        size="sm"
        aria-label={copied ? "Copied" : `Copy ${label}`}
        title={copied ? "Copied" : "Copy"}
        onClick={() => copy(value)}
      >
        <Glyph size={14} aria-hidden="true" />
      </Button>
    );
  return (
    <Button
      variant="pill"
      size="sm"
      aria-label={`Copy ${label}`}
      onClick={() => copy(value)}
    >
      <Glyph size={14} aria-hidden="true" />
      <span>{copied ? "Copied" : "Copy"}</span>
    </Button>
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
  usePageTitle("Ask your AI", "AI");
  const s = styles();
  const url = mcpUrl(API_ROOT, window.location.origin);
  const device = useMemo(
    () => deviceOf(navigator.userAgent, navigator.maxTouchPoints),
    [],
  );
  const phone = device !== "computer";
  const [assistant, setAssistant] = useState<Assistant>(storedAssistant);
  const pick = (next: Assistant) => {
    setAssistant(next);
    keepAssistant(next);
  };
  const name = ASSISTANT_NAME[assistant];
  const sends = askSends(assistant);
  const plan = addPlan(assistant, device, url);
  const [copied, copy] = useCopied();
  // A computer keeps this page in its tab. A phone follows the link in the
  // same one: that is what hands it to the app (a universal or app link),
  // where a new tab can stay in the browser.
  const away = phone ? {} : { target: "_blank", rel: "noopener" };

  const add = (event: MouseEvent) => {
    if (plan.copies) copy(url);
    if (!plan.href) event.preventDefault();
  };

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
            <Button variant="link" size="sm" href="/" data-back-to-map>
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
              <Step n={1} id="ai-pick" title="Pick your AI">
                <Segmented
                  aria-label="Your AI"
                  className={s.picker()}
                  options={ASSISTANTS.map((a) => ({
                    value: a,
                    label: ASSISTANT_NAME[a],
                  }))}
                  value={assistant}
                  onChange={pick}
                />
              </Step>

              <Step n={2} id="ai-add" title="Add wingfoil.ie">
                <div className={s.actions()}>
                  {plan.href ? (
                    <Button
                      href={plan.href}
                      {...away}
                      variant="primary"
                      size="lg"
                      onClick={add}
                      data-add={assistant}
                    >
                      <Plus size={15} aria-hidden="true" />
                      <span>{plan.label}</span>
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      size="lg"
                      onClick={add}
                      data-add={assistant}
                    >
                      {copied ? (
                        <Check size={15} aria-hidden="true" />
                      ) : (
                        <Copy size={15} aria-hidden="true" />
                      )}
                      <span>{copied ? "Copied" : plan.label}</span>
                    </Button>
                  )}
                </div>
                <p className={s.note()} aria-live="polite">
                  {plan.copies && plan.href && copied
                    ? `Address copied. ${plan.note}`
                    : plan.note}
                </p>
                <p className={s.address()}>
                  <span className={s.addressLabel()}>The address</span>
                  <code className={s.addressValue()}>{url}</code>
                  <CopyButton value={url} label="the server address" bare />
                </p>
              </Step>

              <Step n={3} id="ai-ask" title="Ask">
                <ul className={s.prompts()}>
                  {EXAMPLE_PROMPTS.map((prompt) => (
                    <li key={prompt} className={s.prompt()}>
                      <a
                        className={s.promptLink()}
                        href={askLink(assistant, prompt)}
                        {...away}
                        // Copied on the way, for the app that may not
                        // type it in.
                        onClick={() => {
                          if (!sends)
                            void navigator.clipboard?.writeText(prompt);
                        }}
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
                <p className={s.note()}>
                  {sends
                    ? `Each opens in ${name} and asks it.`
                    : `Each opens in ${name}, and is copied as it goes: if it is not typed in, paste it.`}
                </p>
              </Step>
            </ol>

            <section className={s.coders()} aria-labelledby="ai-coders">
              <SectionHeading id="ai-coders">Coding agents</SectionHeading>
              <div className={s.actions()}>
                <Button href={cursorLink(url)} variant="pill" size="sm">
                  <span>Add to Cursor</span>
                </Button>
                <Button href={vscodeLink(url)} variant="pill" size="sm">
                  <span>Add to VS Code</span>
                </Button>
              </div>
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
