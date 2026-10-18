import { useEffect, useRef, type CSSProperties, type RefObject } from "react";
import { CircleAlert, SquarePen, X } from "lucide-react";
import { Button, Kicker, StarGlyphs } from "../../ui";
import { AI_HREF } from "../../force5/src/siteNav";
import { MONO_LABEL, RING } from "../../ui/tv";
import { loadPrefs, parseRider, saveRider } from "../../force5/src/prefs";
import {
  COMPANION_NAME,
  type MapAction,
  type RiderContext,
} from "../shared/protocol";
import type { AssistantMessage, Message } from "./chat";
import { Composer } from "./Composer";
import { Character } from "./Character";
import { MOOD_LABEL } from "./mood";
import { ProposalCard } from "./ProposalCard";
import { RichText } from "./RichText";
import { SpotCard } from "./SpotCard";
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

/**
 * The same validation and storage the dock's Display options use. Gust
 * proposes a weight, level and wings; the rider's own star rating stays.
 */
function saveToPrefs(rider: RiderContext) {
  saveRider(parseRider({ ...loadPrefs().rider, ...rider }));
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
    if (gust.hidden) return;
    const key = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "j") {
        event.preventDefault();
        gust.toggle();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [gust.toggle, gust.hidden]);

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

  if (gust.hidden) return null;

  return (
    <div className="gust-root contents" style={style}>
      <button
        ref={launcher}
        type="button"
        className={[
          // Paper in an ink ring, like a light on the chart: not glass.
          "gust-launcher group grid size-16 cursor-pointer place-items-center rounded-full",
          "border border-ink bg-card paper-grain shadow-marker inset-shadow-frame",
          "not-disabled:hover:bg-card not-disabled:hover:-translate-y-0.5",
          RING,
        ].join(" ")}
        data-open={gust.open}
        data-mood={gust.mood}
        aria-label={label}
        aria-expanded={gust.open}
        aria-controls="gust-panel"
        title={`Ask ${COMPANION_NAME} (⌘J)`}
        onClick={() => gust.toggle()}
      >
        <Character mood={gust.mood} size={60} className="translate-x-2" />
        {gust.nudging && !gust.open && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -left-1 flex rounded-full bg-inverse px-2 py-1 shadow-control"
          >
            <StarGlyphs
              stars={nudgeStars}
              size={9}
              slots="potential"
              tone="inverse"
            />
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
  const resting = gust.availability === "resting";
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
        // The chart's box: opaque paper with its grain, ruled twice in ink.
        "gust-panel flex flex-col overflow-hidden rounded-surface font-body text-ink focus:outline-hidden",
        "border border-ink bg-card paper-grain shadow-surface inset-shadow-frame",
      ].join(" ")}
      onKeyDown={(event) => {
        // The map closes its dock on Escape; inside Gust it closes Gust only.
        if (event.key === "Escape") {
          event.stopPropagation();
          gust.toggle(false);
        }
      }}
    >
      <header className="mx-1 mt-1 flex items-center gap-3 border-0 border-b-3 border-double border-ink px-3 py-2.5">
        <Character mood={gust.mood} size={40} labelled />
        <div className="min-w-0 flex-1">
          <h2 className="m-0 font-display text-lead text-ink">
            {COMPANION_NAME}
          </h2>
          <p
            className={["m-0 truncate text-ink-muted", MONO_LABEL].join(" ")}
            aria-live="polite"
          >
            {resting
              ? "Resting until next month"
              : asleep
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
          <SquarePen size={16} strokeWidth={1.5} aria-hidden="true" />
        </Button>
        <Button
          variant="quiet"
          size="sm"
          icon
          aria-label={`Close ${COMPANION_NAME}`}
          onClick={() => gust.toggle(false)}
        >
          <X size={18} strokeWidth={1.5} aria-hidden="true" />
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
        {resting ? (
          <Resting resumes={gust.resumes} />
        ) : asleep ? (
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

      <footer className="flex flex-col gap-1 border-0 border-t border-ink px-3 pt-3 pb-safe-3">
        {gust.chat.requestError && !resting && (
          <p
            role="alert"
            className="m-0 flex items-start gap-1 px-1 font-body text-body text-warn"
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
          placeholder={
            resting
              ? `${COMPANION_NAME} is resting`
              : asleep
                ? `${COMPANION_NAME} is asleep`
                : undefined
          }
        />
        <p className="m-0 px-1 font-body text-caption text-ink-muted italic">
          Forecasts, not promises. Check the launch and conditions yourself.
        </p>
      </footer>
    </section>
  );
}

/** "1 November", or null when the server did not say. */
function dayOf(iso: string | null): string | null {
  if (!iso || !Number.isFinite(Date.parse(iso))) return null;
  return new Intl.DateTimeFormat("en-IE", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(iso));
}

/** This month's allowance is spent: where to ask instead. */
function Resting({ resumes }: { resumes: string | null }) {
  const back = dayOf(resumes);
  return (
    <div
      className="flex flex-col items-center gap-3 py-8 text-center"
      role="status"
    >
      <Character mood="asleep" size={96} />
      <p className="m-0 font-display text-lead text-ink">
        {COMPANION_NAME} is resting
      </p>
      <p className="m-0 max-w-reading font-body text-body text-ink-2">
        He&rsquo;s answered all he can this month
        {back ? <> and is back on {back}</> : null}. Until then, bring your own
        AI: wingfoil.ie works in Claude, ChatGPT and more, with the same
        forecast {COMPANION_NAME} reads.
      </p>
      <Button href={AI_HREF} variant="primary">
        Use wingfoil.ie with your AI
      </Button>
    </div>
  );
}

function Asleep() {
  return (
    <div
      className="flex flex-col items-center gap-3 py-8 text-center"
      role="status"
    >
      <Character mood="asleep" size={96} />
      <p className="m-0 font-display text-lead text-ink">
        {COMPANION_NAME} is asleep
      </p>
      <p className="m-0 max-w-reading font-body text-body text-ink-2">
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
        <Character mood={gust.mood} size={84} />
        <p className="m-0 font-display text-lead text-ink">Where to, rider?</p>
        <p className="m-0 max-w-reading font-body text-body text-ink-2">
          Ask me where and when to go. I read every model&rsquo;s forecast, rate
          it for you in stars, and can put it on the map.
        </p>
      </div>
      <ul
        className="m-0 flex list-none flex-col border-0 border-t border-ink p-0"
        aria-label="Suggestions"
      >
        {asks.map((ask) => (
          <li key={ask} className="border-0 border-b border-line">
            <button
              type="button"
              className={[
                "flex min-h-touch w-full cursor-pointer items-center gap-2 border-0 bg-transparent px-1 py-2 text-left font-body text-prose text-ink italic",
                "not-disabled:hover:bg-sunken not-disabled:hover:text-chart-magenta",
                RING,
              ].join(" ")}
              onClick={() => void gust.send(ask)}
            >
              <span className="min-w-0 flex-1">{ask}</span>
              <span aria-hidden="true" className="font-mono text-ink-muted">
                →
              </span>
            </button>
          </li>
        ))}
      </ul>
      {gust.nudge?.best && (
        <div className="flex flex-col gap-2">
          <Kicker className="flex items-center gap-1.5">
            Heads up:{" "}
            <StarGlyphs
              stars={gust.nudge.best.stars}
              potential={gust.nudge.best.stars}
              size={10}
            />{" "}
            at {gust.nudge.name}
          </Kicker>
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
          <div key={i} className="font-body text-prose leading-normal text-ink">
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
        <p className="m-0 flex items-start gap-2 border-0 border-l-3 border-warn bg-warn-ground px-3 py-2 font-body text-body text-warn">
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
                <p className="m-0 border-0 border-r-3 border-ink pr-3 text-right font-body text-prose whitespace-pre-wrap text-ink italic">
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
          className="m-0 flex items-center gap-2 font-body text-body text-ink-muted italic"
          role="status"
        >
          <Character mood="thinking" size={30} /> {COMPANION_NAME} is{" "}
          {MOOD_LABEL.thinking}…
        </p>
      )}
      <div ref={end} />
    </div>
  );
}
