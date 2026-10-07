/**
 * wingfoil.ie in your AI assistant: the page that hands out the MCP server.
 * `src/main.tsx` lazy-loads it for /ai, so neither the map nor the other
 * sections pay for it.
 *
 * One click where a client has an install link (Claude, Cursor, VS Code), the
 * lines to paste where it does not. The endpoint itself is mcp/api/server.ts.
 *
 * Set as the chart's broadsheet: a headline, sections under a heavy rule, the
 * clients as ruled boxes with one filled action between them, and the address
 * and the config in the mono face, as figures are.
 */
import { ArrowLeft, Bot, Check, Copy, ExternalLink } from "lucide-react";
import { useState } from "react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { API_ROOT } from "../../shared/web/http";
import { usePageTitle } from "../../shared/web/usePageTitle";
import {
  Button,
  Headline,
  Kicker,
  Notice,
  Pane,
  SectionHeading,
  headlineStyles,
} from "../../ui";
import { Masthead, MastheadMark, mastheadStyles } from "../../ui/Masthead";
import { MONO_LABEL, tv } from "../../ui/tv";
import {
  EXAMPLE_PROMPTS,
  claudeCodeCommand,
  claudeLink,
  codexConfig,
  cursorLink,
  geminiConfig,
  mcpUrl,
  vscodeLink,
} from "./install";

const styles = tv({
  slots: {
    root: "flex min-h-dvh flex-col bg-ground paper-grain font-body text-prose text-ink antialiased",
    page: "mx-auto flex w-full max-w-form flex-1 flex-col px-safe-6 max-wide:px-safe-3",
    main: "flex flex-col gap-8 pt-5 pb-12",
    intro: "flex flex-col gap-3",
    lead: "m-0 font-body text-lead font-normal text-pretty text-ink-2 italic",
    // Each fact on its own line on a phone: wrapped side by side, "Every
    // model" and "The chance it rides" read as one phrase.
    facts: [
      "m-0 flex flex-wrap gap-x-4 gap-y-1 text-ink-muted max-wide:flex-col",
      MONO_LABEL,
    ],
    section: "flex flex-col gap-3",
    clients: "grid grid-cols-2 gap-3 max-wide:grid-cols-1",
    client: "flex flex-col gap-2",
    clientName: "m-0 font-display text-lead text-ink",
    note: "m-0 font-body text-body text-ink-2",
    where: "m-0 flex flex-wrap items-baseline gap-2",
    path: "font-mono text-caption text-ink-muted",
    actions: "mt-auto flex flex-wrap items-center gap-2 pt-1",
    // On a phone a command is wider than the screen, and a box that scrolls
    // sideways with no bar showing reads as a command cut off: there it wraps,
    // keeping its indents, and breaks a long address where it must.
    code: [
      "m-0 overflow-x-auto border-0 border-l-3 border-ink bg-sunken px-3 py-2 font-mono text-caption whitespace-pre text-ink",
      "max-wide:whitespace-pre-wrap max-wide:wrap-anywhere",
    ],
    // The copy button beside the line, or over it on a phone, where the
    // line needs the whole width.
    row: "flex items-center gap-2 max-wide:flex-col-reverse max-wide:items-end",
    rowCode: "min-w-0 flex-1 max-wide:self-stretch",
    prompts: "m-0 flex list-none flex-col p-0",
    prompt:
      "border-0 border-b border-line py-2.5 font-body text-prose text-ink-2 italic",
  },
});

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="pill"
      size="sm"
      aria-label={`Copy ${label}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1600);
        });
      }}
    >
      {copied ? (
        <Check size={14} aria-hidden="true" />
      ) : (
        <Copy size={14} aria-hidden="true" />
      )}
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

export default function AiApp() {
  usePageTitle("Add the forecast to your assistant", "AI");
  const s = styles();
  const url = mcpUrl(API_ROOT, window.location.origin);

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
          <div className={s.intro()}>
            <Headline>
              Ask your AI{" "}
              <em className={headlineStyles().soft()}>where the wind is</em>
            </Headline>
            <p className={s.lead()}>
              Add wingfoil.ie to Claude, ChatGPT or your coding agent and it
              reads the same forecast as the map.
            </p>
            <p className={s.facts()}>
              <span>Every model</span>
              <span>The chance it rides</span>
              <span>Waves · tides · daylight</span>
              <span>Free · read-only · no account</span>
            </p>
          </div>

          <section className={s.section()} aria-labelledby="ai-url">
            <SectionHeading id="ai-url">The server</SectionHeading>
            <Snippet value={url} label="the server address" />
            <p className={s.note()}>
              An MCP server over Streamable HTTP. Any MCP client can use this
              address; the buttons below fill it in for you.
            </p>
          </section>

          <section className={s.section()} aria-labelledby="ai-add">
            <SectionHeading id="ai-add">Add it</SectionHeading>
            <div className={s.clients()}>
              <Pane className={s.client()}>
                <h3 className={s.clientName()}>Claude</h3>
                <p className={s.note()}>
                  Opens Claude with the connector filled in; confirm with Add.
                  Once added it is in Claude on your phone too.
                </p>
                <div className={s.actions()}>
                  <Button
                    href={claudeLink(url)}
                    target="_blank"
                    rel="noopener"
                    variant="primary"
                    size="sm"
                  >
                    <Bot size={15} aria-hidden="true" />
                    <span>Add to Claude</span>
                  </Button>
                </div>
              </Pane>

              <Pane className={s.client()}>
                <h3 className={s.clientName()}>ChatGPT</h3>
                <p className={s.note()}>
                  On chatgpt.com, turn on Developer mode in Settings, then
                  create a connector with the server address above and no
                  authentication.
                </p>
                <div className={s.actions()}>
                  <Button
                    href="https://chatgpt.com/#settings"
                    target="_blank"
                    rel="noopener"
                    variant="pill"
                    size="sm"
                  >
                    <ExternalLink size={14} aria-hidden="true" />
                    <span>Open ChatGPT settings</span>
                  </Button>
                </div>
              </Pane>

              <Pane className={s.client()}>
                <h3 className={s.clientName()}>Cursor</h3>
                <p className={s.note()}>Installs the server in Cursor.</p>
                <div className={s.actions()}>
                  <Button href={cursorLink(url)} variant="pill" size="sm">
                    <span>Add to Cursor</span>
                  </Button>
                </div>
              </Pane>

              <Pane className={s.client()}>
                <h3 className={s.clientName()}>VS Code</h3>
                <p className={s.note()}>
                  Installs the server for Copilot agent mode.
                </p>
                <div className={s.actions()}>
                  <Button href={vscodeLink(url)} variant="pill" size="sm">
                    <span>Add to VS Code</span>
                  </Button>
                </div>
              </Pane>
            </div>
          </section>

          <section className={s.section()} aria-labelledby="ai-cli">
            <SectionHeading id="ai-cli">Command-line agents</SectionHeading>
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
            <Snippet value={geminiConfig(url)} label="the Gemini CLI config" />
          </section>

          <section className={s.section()} aria-labelledby="ai-try">
            <SectionHeading id="ai-try">Then ask</SectionHeading>
            <ul className={s.prompts()}>
              {EXAMPLE_PROMPTS.map((prompt) => (
                <li key={prompt} className={s.prompt()}>
                  &ldquo;{prompt}&rdquo;
                </li>
              ))}
            </ul>
          </section>

          <Notice>
            Your assistant reads model forecasts, not the beach. It is told
            never to call conditions safe: check the launch, the tide, offshore
            wind and local advice yourself.
          </Notice>
        </main>
      </div>
    </div>
  );
}
