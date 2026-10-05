import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { CircleAlert, SquarePen, X } from "lucide-react";
import { Button } from "../../ui";
import { loadPrefs, parseRider, savePrefs } from "../../force5/src/prefs";
import {
  COMPANION_NAME,
  type MapAction,
  type RiderContext,
} from "../shared/protocol";
import type { AssistantMessage, Message } from "./chat";
import { Composer } from "./Composer";
import { Gust } from "./Gust";
import { MOOD_LABEL } from "./mood";
import { ProposalCard } from "./ProposalCard";
import { RichText } from "./RichText";
import { SpotCard, Stars } from "./SpotCard";
import { ToolChips } from "./ToolChips";
import {
  useCompanion,
  type Companion as CompanionState,
  type CompanionContext,
} from "./useCompanion";

export interface CompanionProps {
  /** What the rider is looking at: sent with every message. */
  context: CompanionContext;
  /**
   * Move the map. Left out (a page with no map), selecting a spot opens the
   * map on it and everything else is ignored.
   */
  onAction?: (action: MapAction) => void;
  /** Save a confirmed profile. Left out, it is written to the stored prefs. */
  onRiderSaved?: (rider: RiderContext) => void;
  /** How far up the launcher floats, in px, so it covers nothing of the host's. */
  launcherBottom?: number;
  /** Where the panel's foot stands on a wide screen, in px. */
  panelBottom?: number;
}

const narrow = () => window.matchMedia("(max-width: 45rem)").matches;

function openMapAt(action: MapAction) {
  if (action.type === "select_spot")
    window.location.assign(`/?spot=${encodeURIComponent(action.id)}`);
}

/** The same validation and storage the dock's Display options use. */
function saveToPrefs(rider: RiderContext) {
  savePrefs({ ...loadPrefs(), rider: parseRider(rider) });
}

/**
 * Gust, self-contained: the floating launcher and the panel it opens. Mount it
 * anywhere; a host with a map passes `onAction` so Gust can drive it.
 */
export function Companion({
  context,
  onAction = openMapAt,
  onRiderSaved = saveToPrefs,
  launcherBottom,
  panelBottom,
}: CompanionProps) {
  const gust = useCompanion(context, {
    onAction: (action) => {
      onAction(action);
      // On a phone the drawer covers the map: step aside to show the move.
      if (action.type === "select_spot" && narrow()) gust.toggle(false);
    },
    onRiderSaved,
  });
  const launcher = useRef<HTMLButtonElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLElement>(null);
  const wasOpen = useRef(false);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        gust.toggle();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [gust.toggle]);

  useEffect(() => {
    // Straight to the box with a mouse; on a touch screen that would throw
    // the keyboard up over the drawer before anything was asked.
    if (gust.open) {
      if (window.matchMedia("(pointer: fine)").matches)
        input.current?.focus({ preventScroll: true });
      else panel.current?.focus({ preventScroll: true });
    } else if (wasOpen.current)
      launcher.current?.focus({ preventScroll: true });
    wasOpen.current = gust.open;
  }, [gust.open]);

  const style = {
    ...(launcherBottom === undefined
      ? {}
      : { "--gust-launcher-bottom": `${Math.round(launcherBottom)}px` }),
    ...(panelBottom === undefined
      ? {}
      : { "--gust-panel-bottom": `${Math.round(panelBottom)}px` }),
  } as CSSProperties;

  const showCard = (actions: MapAction[]) => {
    for (const action of actions) onAction(action);
    if (narrow()) gust.toggle(false);
  };

  const nudgeStars = gust.nudge?.best?.stars ?? 0;
  const label = gust.nudging
    ? `Open ${COMPANION_NAME}: ${gust.nudge!.name} has a ${nudgeStars}-star window, ${gust.nudge!.best!.local}`
    : gust.open
      ? `Close ${COMPANION_NAME}`
      : `Open ${COMPANION_NAME}, your wing-foiling buddy`;

  return (
    <div className="gust-root contents" style={style}>
      <button
        ref={launcher}
        type="button"
        className={[
          "gust-launcher group grid size-16 cursor-pointer place-items-center rounded-full",
          "border border-card/70 bg-glass shadow-surface backdrop-blur-glass backdrop-saturate-145",
          "reduced-transparency:bg-solid reduced-transparency:backdrop-filter-none",
          "not-disabled:hover:bg-card not-disabled:hover:-translate-y-0.5",
          "not-disabled:focus-visible:outline-3 not-disabled:focus-visible:outline-offset-2 not-disabled:focus-visible:outline-focus",
        ].join(" ")}
        data-open={gust.open}
        data-mood={gust.mood}
        aria-label={label}
        aria-expanded={gust.open}
        aria-controls="gust-panel"
        title={`Ask ${COMPANION_NAME} (⌘J)`}
        onClick={() => gust.toggle()}
      >
        <Gust mood={gust.mood} size={60} className="translate-x-2" />
        {gust.nudging && !gust.open && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -left-1 rounded-full bg-accent px-2 py-0.5 font-body text-caption font-bold text-accent-ink shadow-control"
          >
            {nudgeStars}★
          </span>
        )}
      </button>
      {gust.open && (
        <Panel
          gust={gust}
          context={context}
          panel={panel}
          input={input}
          onShow={showCard}
        />
      )}
    </div>
  );
}

function Panel({
  gust,
  context,
  panel,
  input,
  onShow,
}: {
  gust: CompanionState;
  context: CompanionContext;
  panel: RefObject<HTMLElement | null>;
  input: RefObject<HTMLTextAreaElement | null>;
  onShow: (actions: MapAction[]) => void;
}) {
  const asleep = gust.configured === false;
  const empty = gust.chat.messages.length === 0;
  return (
    <section
      ref={panel}
      id="gust-panel"
      role="dialog"
      aria-label={COMPANION_NAME}
      tabIndex={-1}
      className={[
        "gust-panel flex flex-col overflow-hidden rounded-surface font-body text-ink focus:outline-hidden",
        "border border-card/70 bg-glass shadow-surface backdrop-blur-glass backdrop-saturate-145",
        "reduced-transparency:bg-solid reduced-transparency:backdrop-filter-none",
      ].join(" ")}
      onKeyDown={(event) => {
        // The map closes its dock on Escape; inside Gust it closes Gust only.
        if (event.key === "Escape") {
          event.stopPropagation();
          gust.toggle(false);
        }
      }}
    >
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <Gust mood={gust.mood} size={40} labelled />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 text-lead">{COMPANION_NAME}</h2>
          <p
            className="m-0 truncate text-caption text-ink-muted"
            aria-live="polite"
          >
            {asleep
              ? "Asleep: not configured on this server"
              : gust.busy
                ? "Checking the forecast…"
                : "Your wing-foiling buddy"}
          </p>
        </div>
        <Button
          variant="quiet"
          size="sm"
          icon
          aria-label="New chat"
          title="New chat"
          disabled={empty && !gust.busy}
          onClick={() => {
            gust.newChat();
            input.current?.focus();
          }}
        >
          <SquarePen size={16} aria-hidden="true" />
        </Button>
        <Button
          variant="quiet"
          size="sm"
          icon
          aria-label={`Close ${COMPANION_NAME}`}
          onClick={() => gust.toggle(false)}
        >
          <X size={18} aria-hidden="true" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {asleep ? (
          <Asleep />
        ) : empty ? (
          <Welcome
            gust={gust}
            spotName={context.spot?.name ?? null}
            riderSet={context.rider?.weightKg != null}
            onShow={onShow}
          />
        ) : (
          <Conversation gust={gust} onShow={onShow} />
        )}
      </div>

      <footer className="flex flex-col gap-1 border-t border-line px-3 pt-3 pb-safe-3">
        {gust.chat.requestError && (
          <p
            role="alert"
            className="m-0 flex items-start gap-1 px-1 text-body text-warn"
          >
            <CircleAlert
              size={14}
              className="mt-0.5 shrink-0"
              aria-hidden="true"
            />
            {gust.chat.requestError.message}
          </p>
        )}
        <Composer
          inputRef={input}
          value={gust.draft}
          onChange={gust.setDraft}
          onSend={(text) => void gust.send(text)}
          disabled={asleep}
          busy={gust.busy}
          placeholder={asleep ? `${COMPANION_NAME} is asleep` : undefined}
        />
        <p className="m-0 px-1 text-caption text-ink-muted">
          Forecasts, not promises. Check the launch and conditions yourself.
        </p>
      </footer>
    </section>
  );
}

function Asleep() {
  return (
    <div
      className="flex flex-col items-center gap-3 py-8 text-center"
      role="status"
    >
      <Gust mood="asleep" size={96} />
      <p className="m-0 text-prose font-semibold">{COMPANION_NAME} is asleep</p>
      <p className="m-0 max-w-reading text-body text-ink-muted">
        The companion isn&rsquo;t configured on this server, so there&rsquo;s
        nobody to answer. The map, the dock and the stars all work as usual.
      </p>
    </div>
  );
}

function Welcome({
  gust,
  spotName,
  riderSet,
  onShow,
}: {
  gust: CompanionState;
  spotName: string | null;
  riderSet: boolean;
  onShow: (actions: MapAction[]) => void;
}) {
  const asks = [
    "Where's best tomorrow?",
    spotName ? `Is ${spotName} on this weekend?` : "Where's good this weekend?",
    "What wing should I take?",
    riderSet ? "Update my rider profile" : "Set up my rider profile",
  ];
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col items-center gap-2 pt-2 text-center">
        <Gust mood={gust.mood} size={84} />
        <p className="m-0 text-lead">Where to, rider?</p>
        <p className="m-0 max-w-reading text-body text-ink-muted">
          Ask me where and when to go. I read every model&rsquo;s forecast, rate
          it for you in stars, and can put it on the map.
        </p>
      </div>
      <ul
        className="m-0 flex list-none flex-wrap justify-center gap-2 p-0"
        aria-label="Suggestions"
      >
        {asks.map((ask) => (
          <li key={ask}>
            <Button
              variant="pill"
              size="sm"
              onClick={() => void gust.send(ask)}
            >
              {ask}
            </Button>
          </li>
        ))}
      </ul>
      {gust.nudge?.best && (
        <div className="flex flex-col gap-2">
          <p className="m-0 flex items-center gap-1 text-label text-ink-2">
            Heads up: <Stars stars={gust.nudge.best.stars} /> coming at{" "}
            {gust.nudge.name}
          </p>
          <SpotCard card={gust.nudge} onShow={onShow} compact />
        </div>
      )}
    </div>
  );
}

function Reply({
  message,
  gust,
  onShow,
}: {
  message: AssistantMessage;
  gust: CompanionState;
  onShow: (actions: MapAction[]) => void;
}) {
  return (
    <li className="flex flex-col gap-2" aria-busy={message.live || undefined}>
      <span className="sr-only">{COMPANION_NAME} said</span>
      <ToolChips tools={message.tools} />
      {message.parts.map((part, i) =>
        part.kind === "text" ? (
          <div key={i} className="text-prose leading-normal text-ink-2">
            <RichText text={part.text} />
          </div>
        ) : part.kind === "card" ? (
          <SpotCard
            key={i}
            card={part.card}
            onShow={onShow}
            // A run of cards is a ranking: the leader in full, the rest a line each.
            compact={message.parts[i - 1]?.kind === "card"}
          />
        ) : (
          <ProposalCard
            key={i}
            proposal={part.proposal}
            status={part.status}
            onConfirm={() =>
              gust.answerProposal(part.proposal.id, part.proposal.rider)
            }
            onDismiss={() => gust.answerProposal(part.proposal.id, null)}
          />
        ),
      )}
      {message.error && (
        <p className="m-0 flex items-start gap-2 rounded-control bg-warn-ground px-3 py-2 text-body text-warn">
          <CircleAlert
            size={14}
            className="mt-0.5 shrink-0"
            aria-hidden="true"
          />
          {message.error.message}
        </p>
      )}
    </li>
  );
}

function Conversation({
  gust,
  onShow,
}: {
  gust: CompanionState;
  onShow: (actions: MapAction[]) => void;
}) {
  const end = useRef<HTMLDivElement>(null);
  const messages: Message[] = gust.chat.messages;
  const last = messages.at(-1);
  const size =
    last?.role === "assistant"
      ? last.parts.length +
        last.tools.length +
        JSON.stringify(last.parts.at(-1) ?? "").length
      : 0;
  useEffect(() => {
    end.current?.scrollIntoView({ block: "end" });
  }, [messages.length, size]);
  const waiting =
    last?.role === "assistant" &&
    last.live &&
    !last.parts.length &&
    !last.tools.length;
  return (
    <div className="flex flex-col gap-4">
      <div
        role="log"
        aria-live="polite"
        aria-label={`Conversation with ${COMPANION_NAME}`}
      >
        <ol className="m-0 flex list-none flex-col gap-5 p-0">
          {messages.map((m) =>
            m.role === "user" ? (
              <li key={m.id} className="flex justify-end pl-10">
                <span className="sr-only">You said</span>
                <p className="m-0 rounded-surface rounded-br-control bg-inverse px-4 py-2 text-prose whitespace-pre-wrap text-ink-inverse">
                  {m.text}
                </p>
              </li>
            ) : (
              <Reply key={m.id} message={m} gust={gust} onShow={onShow} />
            ),
          )}
        </ol>
      </div>
      {waiting && (
        <p
          className="m-0 flex items-center gap-2 text-body text-ink-muted"
          role="status"
        >
          <Gust mood="thinking" size={30} /> {COMPANION_NAME} is{" "}
          {MOOD_LABEL.thinking}…
        </p>
      )}
      <div ref={end} />
    </div>
  );
}
