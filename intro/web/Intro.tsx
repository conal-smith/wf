/**
 * The opening film's frame: the canvas, the letterbox, the skip control, and
 * at the end the name and the three ways in. Loaded lazily by IntroGate, so
 * three.js is only ever downloaded by a reader who is going to see the film.
 *
 * The film drives the words, not React: every frame the scene reports its
 * clock and this writes opacities straight onto the elements, so nothing
 * re-renders sixty times a second.
 */
import { MessagesSquare, ShoppingBag, Volume2, VolumeX, Wind } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SITE_SECTIONS } from "../../force5/src/siteNav";
import { Button, Surface } from "../../ui";
import { tv } from "../../ui/tv";
import { startIntro, type IntroHandle } from "../scene/IntroScene";
import { markSeen } from "./decide";
import { scramble } from "./scramble";
import { createSound, type FilmSound } from "./sound";
import { progress, TIMELINE } from "./timeline";

const styles = tv({
  slots: {
    root: "fixed inset-0 z-intro overflow-hidden bg-film font-sans antialiased transition-opacity duration-slow",
    canvas: "absolute inset-0 block size-full",
    bar: "absolute inset-x-0 h-1/9 bg-film",
    titles: "pointer-events-none absolute top-1/5 left-1/12 flex flex-col items-start gap-3 text-ink-inverse",
    name: "m-0 text-display",
    domain: "font-normal text-ink-inverse/75",
    line: "m-0 text-lead font-medium text-ink-inverse/85",
    menuRow: "absolute bottom-1/6 left-1/12 flex",
    menu: "flex items-center gap-1 rounded-full p-2",
    skip: "absolute right-6 bottom-6",
    sound: "absolute bottom-6 left-6",
    caption: "pointer-events-none absolute bottom-1/6 left-1/12 m-0 text-label uppercase text-ink-inverse/90",
  },
  variants: {
    leaving: { true: { root: "pointer-events-none opacity-0" } },
  },
});

const NAME = "wingfoil";
const DOMAIN = ".ie";
const LINE = "Ireland's wind, read for riders.";

/** Title cards over the film, in film seconds: where we are, and who is here. */
const CAPTIONS = [
  { text: "Brandon Bay, Co. Kerry", from: 1.8, to: 8.4 },
  { text: "Fifty riders. One breeze.", from: 13.5, to: 20 },
];

const section = (id: string) => SITE_SECTIONS.find((s) => s.id === id)!;

export interface IntroProps {
  startAt: number;
  /** The film has reached its menu (or been skipped): mount the map behind it. */
  onMenu(): void;
  /** The film has faded away. */
  onDone(): void;
}

export default function Intro({ startAt, onMenu, onDone }: IntroProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const top = useRef<HTMLDivElement>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const titles = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const skip = useRef<HTMLDivElement>(null);
  const name = useRef<HTMLSpanElement>(null);
  const domain = useRef<HTMLSpanElement>(null);
  const line = useRef<HTMLSpanElement>(null);
  const captions = useRef<(HTMLParagraphElement | null)[]>([]);
  const sound = useRef<FilmSound | null>(null);
  const [soundOn, setSoundOn] = useState(false);
  const reachedMenu = useRef(false);
  const [leaving, setLeaving] = useState(false);
  const [interactive, setInteractive] = useState(false);

  const showMenu = useCallback(() => {
    if (reachedMenu.current) return;
    reachedMenu.current = true;
    markSeen();
    onMenu();
  }, [onMenu]);

  const leave = useCallback(() => {
    showMenu();
    setLeaving(true);
    sound.current?.setEnabled(false);
  }, [showMenu]);

  const toggleSound = () => {
    // Made on first use: a browser only lets sound start from a click.
    sound.current ??= createSound();
    sound.current.setEnabled(!soundOn);
    setSoundOn(!soundOn);
  };

  useEffect(() => () => sound.current?.dispose(), []);

  useEffect(() => {
    if (!leaving) return;
    // As long as the fade itself; `duration-slow` in ui/theme.css.
    const id = window.setTimeout(onDone, 900);
    return () => window.clearTimeout(id);
  }, [leaving, onDone]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") leave();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [leave]);

  useEffect(() => {
    let handle: IntroHandle | null = null;
    let cancelled = false;
    const set = (el: HTMLElement | null, opacity: number, lift = 0) => {
      if (!el) return;
      el.style.opacity = String(opacity);
      el.style.transform = lift ? `translateY(${lift}px)` : "";
    };
    startIntro(canvas.current!, {
      startAt,
      // `&freeze` holds a review frame still: `/?intro=17&freeze`.
      frozen: new URLSearchParams(window.location.search).has("freeze"),
      onTime(t, cameraHeight) {
        sound.current?.update(t, cameraHeight);
        // Words decode into place, a few new stand-ins every second.
        const tick = Math.floor(t * 14);
        const title = progress(TIMELINE.title, t);
        const decoded = scramble(NAME + DOMAIN, Math.min(1, title * 1.25), tick);
        if (name.current) name.current.textContent = decoded.slice(0, NAME.length);
        if (domain.current) domain.current.textContent = decoded.slice(NAME.length);
        if (line.current) line.current.textContent = scramble(LINE, progress([TIMELINE.title[0] + 0.6, TIMELINE.title[1] + 0.6], t), tick);
        CAPTIONS.forEach((c, i) => {
          const el = captions.current[i];
          if (!el) return;
          const shown = progress([c.from, c.from + 1.6], t) * (1 - progress([c.to - 0.8, c.to], t));
          el.style.opacity = String(shown);
          el.textContent = scramble(c.text, progress([c.from, c.from + 1.6], t), tick);
        });
        const open = progress(TIMELINE.letterboxOpen, t);
        if (top.current) top.current.style.transform = `translateY(${-open * 100}%)`;
        if (bottom.current) bottom.current.style.transform = `translateY(${open * 100}%)`;
        set(titles.current, Math.min(1, title * 2), (1 - title) * 14);
        const m = progress(TIMELINE.menu, t);
        set(menu.current, m, (1 - m) * 10);
        set(skip.current, Math.min(progress([TIMELINE.skipFrom, TIMELINE.skipFrom + 1], t), 1 - m));
        if (m > 0 && !reachedMenu.current) {
          showMenu();
          setInteractive(true);
        }
      },
    })
      .then((h) => {
        if (cancelled) h.dispose();
        else handle = h;
      })
      .catch(() => {
        // No film (a lost context, a driver that refuses): straight to the map.
        if (!cancelled) {
          showMenu();
          onDone();
        }
      });
    return () => {
      cancelled = true;
      handle?.dispose();
    };
    // The film starts once; its callbacks read refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = styles({ leaving });
  const market = section("market");
  const community = section("community");
  const map = section("map");
  return (
    <div className={s.root()} role="dialog" aria-modal="true" aria-label="Welcome to wingfoil.ie">
      <canvas ref={canvas} className={s.canvas()} aria-hidden="true" />
      <div ref={top} className={s.bar({ className: "top-0" })} aria-hidden="true" />
      <div ref={bottom} className={s.bar({ className: "bottom-0" })} aria-hidden="true" />

      <div ref={titles} className={s.titles()} style={{ opacity: 0 }}>
        <h1 className={s.name()} aria-label={NAME + DOMAIN}>
          <span ref={name} aria-hidden="true">{NAME}</span>
          <span ref={domain} className={s.domain()} aria-hidden="true">{DOMAIN}</span>
        </h1>
        <p className={s.line()}>
          <span ref={line}>{LINE}</span>
        </p>
      </div>

      {CAPTIONS.map((c, i) => (
        <p
          key={c.text}
          ref={(el) => {
            captions.current[i] = el;
          }}
          className={s.caption()}
          style={{ opacity: 0 }}
          aria-hidden="true"
        >
          {c.text}
        </p>
      ))}

      <div ref={menu} className={s.menuRow()} style={{ opacity: 0 }} inert={!interactive}>
        <Surface className={s.menu()}>
          <nav aria-label="Where to" className="flex items-center gap-1">
            <Button variant="primary" size="lg" onClick={leave}>
              <Wind aria-hidden="true" /> {map.label}
            </Button>
            <Button href={market.href} size="lg">
              <ShoppingBag aria-hidden="true" /> {market.label}
            </Button>
            <Button href={community.href} size="lg">
              <MessagesSquare aria-hidden="true" /> {community.label}
            </Button>
          </nav>
        </Surface>
      </div>

      <div className={s.sound()}>
        <Button variant="raised" size="md" pressed="worded" onClick={toggleSound}>
          {soundOn ? <Volume2 aria-hidden="true" /> : <VolumeX aria-hidden="true" />}
          {soundOn ? "Sound on" : "Sound off"}
        </Button>
      </div>

      <div ref={skip} className={s.skip()} style={{ opacity: 0 }}>
        <Button variant="raised" size="md" onClick={leave} autoFocus>
          Skip intro
        </Button>
      </div>
    </div>
  );
}
