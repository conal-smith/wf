/**
 * wingfoil.ie in your AI assistant: the page that hands out the MCP server.
 * `src/main.tsx` lazy-loads it for /ai, so neither the map nor the other
 * sections pay for it.
 *
 * One click where a client has an install link (Claude, Cursor, VS Code), the
 * lines to paste where it does not. The endpoint itself is mcp/api/server.ts.
 */
import { Bot, Check, Copy, ExternalLink, Wind } from "lucide-react";
import { useState } from "react";
import { SiteMenu } from "../../force5/src/SiteMenu";
import { API_ROOT } from "../../shared/web/http";
import { usePageTitle } from "../../shared/web/usePageTitle";
import { Button, Chip, Notice, Pane } from "../../ui";
import { RING, tv } from "../../ui/tv";
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
    root: "flex min-h-dvh flex-col bg-ground font-sans text-prose text-ink antialiased",
    page: "mx-auto flex w-full max-w-form flex-1 flex-col px-safe-6 max-wide:px-safe-3",
    header: "sticky top-0 z-header py-3",
    bar: "flex min-h-control-lg items-center gap-2 rounded-pill border border-line bg-card pr-2 pl-3 shadow-marker",
    brand: [
      "inline-flex min-w-0 items-center gap-2 rounded-control text-lead whitespace-nowrap text-ink no-underline",
      RING,
    ],
    domain: "font-normal text-ink-muted",
    main: "flex flex-col gap-6 pt-3 pb-10",
    intro: "flex flex-col gap-2",
    title: "m-0 text-title",
    lead: "m-0 text-ink-2",
    section: "flex flex-col gap-3",
    heading: "m-0 text-lead",
    clients: "grid grid-cols-2 gap-3 max-wide:grid-cols-1",
    client: "flex flex-col gap-2",
    clientName: "m-0 text-lead",
    note: "m-0 text-body text-ink-muted",
    actions: "mt-auto flex flex-wrap items-center gap-2 pt-1",
    code: "m-0 overflow-x-auto rounded-control bg-sunken px-3 py-2 text-body whitespace-pre text-ink",
    row: "flex items-center gap-2",
    rowCode: "min-w-0 flex-1",
    prompts: "m-0 flex list-none flex-col gap-2 p-0",
    prompt: "rounded-control bg-card px-4 py-3 text-ink-2 shadow-control",
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
        <header className={s.header()}>
          <div className={s.bar()}>
            <SiteMenu current="ai" size="sm" ground="content" />
            <a
              href="/"
              className={s.brand()}
              aria-label="wingfoil.ie, wind map"
            >
              <Wind size={22} aria-hidden="true" />
              <span>
                wingfoil<span className={s.domain()}>.ie</span>
              </span>
              <Chip eyebrow>AI</Chip>
            </a>
          </div>
        </header>

        <main className={s.main()}>
          <div className={s.intro()}>
            <h1 className={s.title()}>Ask your AI where the wind is</h1>
            <p className={s.lead()}>
              Add wingfoil.ie to Claude, ChatGPT or your coding agent and it can
              read the same forecast as the map: every weather model for each
              Irish spot, how well they agree, waves, tides, daylight and sea
              temperature. It is free, read-only and needs no account.
            </p>
          </div>

          <section className={s.section()} aria-labelledby="ai-url">
            <h2 id="ai-url" className={s.heading()}>
              The server
            </h2>
            <Snippet value={url} label="the server address" />
            <p className={s.note()}>
              An MCP server over Streamable HTTP. Any MCP client can use this
              address; the buttons below fill it in for you.
            </p>
          </section>

          <section className={s.section()} aria-labelledby="ai-add">
            <h2 id="ai-add" className={s.heading()}>
              Add it
            </h2>
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
            <h2 id="ai-cli" className={s.heading()}>
              Command-line agents
            </h2>
            <p className={s.note()}>Claude Code: run</p>
            <Snippet
              value={claudeCodeCommand(url)}
              label="the Claude Code command"
            />
            <p className={s.note()}>Codex: add to ~/.codex/config.toml</p>
            <Snippet value={codexConfig(url)} label="the Codex config" />
            <p className={s.note()}>
              Gemini CLI: add to ~/.gemini/settings.json
            </p>
            <Snippet value={geminiConfig(url)} label="the Gemini CLI config" />
          </section>

          <section className={s.section()} aria-labelledby="ai-try">
            <h2 id="ai-try" className={s.heading()}>
              Then ask
            </h2>
            <ul className={s.prompts()}>
              {EXAMPLE_PROMPTS.map((prompt) => (
                <li key={prompt} className={s.prompt()}>
                  {prompt}
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
