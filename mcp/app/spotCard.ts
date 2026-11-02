/**
 * The spot card, as an AI app draws it beside get_spot_forecast's answer: an
 * MCP App (modelcontextprotocol.io/extensions/apps) in the app's own sandboxed
 * frame. The wordmark; the place from above with the wind blowing across it
 * in its own colour; the place's name, wind and stars at the hour; and the
 * day's hours as the site's colours, each a press away. "Open on wingfoil.ie"
 * asks the app to open the spot's page.
 *
 * It is handed its data (mcp/app/card.ts) with the tool's result, and draws
 * nothing of its own until then. It speaks to the app through
 * mcp/app/bridge.ts. Bundled whole into one HTML file, with its
 * styles, by scripts/mcp-card/build.mjs; served by mcp/api/server.ts.
 */
import { windCss } from "../../force5/src/windPalette";
import { connect, type HostContext } from "./bridge";
import { isSpotCardData, type CardHour, type SpotCardData } from "./card";
import { WORDMARK } from "./wordmark";

const root = document.getElementById("card")!;

/* ---------------------------------------------------------------- words */

const DAY = new Intl.DateTimeFormat("en-IE", {
  weekday: "short",
  day: "numeric",
  month: "short",
  timeZone: "Europe/Dublin",
});
const WEEKDAY = new Intl.DateTimeFormat("en-IE", {
  weekday: "short",
  timeZone: "Europe/Dublin",
});
const CLOCK = new Intl.DateTimeFormat("en-IE", {
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "Europe/Dublin",
});
const DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" });

const dateOf = (time: string) => DATE.format(new Date(time));
const clock = (time: string) => CLOCK.format(new Date(time));
const escape = (text: string) =>
  text.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

/** Five stars, the hour's solid and the rest faint, in the stars' own shades. */
function stars(n: number | null) {
  const solid = Math.max(0, Math.min(5, n ?? 0));
  return `<span class="stars" data-stars="${solid}" aria-label="${solid} of 5 stars">${"<i></i>".repeat(5)}</span>`;
}

/* ---------------------------------------------------------- the drawing */

const wordmark = `<svg class="mark" viewBox="${WORDMARK.viewBox}" role="img" aria-label="wingfoil.ie"><path class="mark-name" d="${WORDMARK.name}"/><path class="mark-ie" d="${WORDMARK.domain}"/></svg>`;

let data: SpotCardData | null = null;
let at: string | null = null;
let day: string | null = null;

function render() {
  if (!data) return;
  const hour = data.hours.find((h) => h.time === at) ?? data.hours[0];
  if (!hour) return;
  const days = [...new Set(data.hours.map((h) => dateOf(h.time)))].slice(0, 5);
  day ??= dateOf(hour.time);
  // The day's hours with light in them, or all of them where none has.
  const ofDay = data.hours.filter((h) => dateOf(h.time) === day);
  const lit = ofDay.filter((h) => h.light !== "dark");
  const strip = lit.length ? lit : ofDay;
  const today = dateOf(new Date().toISOString());
  const picture = data.picture;
  root.innerHTML = `
    <header class="head">
      ${wordmark}
      <span class="when">${escape(DAY.format(new Date(hour.time)))} · ${clock(hour.time)}</span>
    </header>
    <div class="map${picture ? "" : " is-plain"}" style="--aspect:${picture?.aspect ?? 2}">
      ${picture ? `<img src="${escape(picture.url)}" alt="" />` : ""}
      <canvas aria-hidden="true"></canvas>
      <div class="pin" style="left:${(picture?.x ?? 0.5) * 100}%;top:${(picture?.y ?? 0.5) * 100}%">
        <div class="tag">
          <b>${escape(data.spot.name)}</b>
          <span>${reading(hour)}</span>
          ${hour.stars !== null ? stars(hour.stars) : ""}
        </div>
        <i class="dot"></i>
      </div>
      ${picture ? `<small class="credit">${escape(picture.credit)}</small>` : ""}
    </div>
    <div class="foot">
      <div class="names">
        <h1 class="name">${escape(data.spot.name)}</h1>
        ${data.spot.county ? `<span class="county">Co. ${escape(data.spot.county)}</span>` : ""}
      </div>
      <a class="open" href="${escape(data.page)}" target="_blank" rel="noopener">Open on wingfoil.ie <span aria-hidden="true">↗</span></a>
    </div>
    ${
      days.length > 1
        ? `<div class="days" role="group" aria-label="Day">${days
            .map(
              (d) =>
                `<button type="button" data-day="${d}" aria-pressed="${d === day}">${d === today ? "Today" : WEEKDAY.format(new Date(`${d}T12:00:00Z`))}</button>`,
            )
            .join("")}</div>`
        : ""
    }
    <div class="hours" role="group" aria-label="Hours">
      ${strip
        .map(
          (h) => `
        <button type="button" class="hr${h.light === "dark" ? " is-dark" : ""}" data-at="${h.time}" aria-pressed="${h.time === hour.time}" aria-label="${clock(h.time)}, ${reading(h)}${h.stars !== null ? `, ${h.stars} stars` : ""}">
          <span class="kn" style="background:${h.wind_kn === null ? "var(--line)" : windCss(h.wind_kn)}">${h.wind_kn ?? "–"}</span>
          <span class="st" style="background:${h.stars ? `var(--stars-${h.stars})` : "var(--line)"}"></span>
          <span class="hh">${clock(h.time).slice(0, 2)}</span>
        </button>`,
        )
        .join("")}
    </div>`;
  wind(hour);
}

/** "18 kn g24 SW", or why there is none. */
function reading(h: CardHour) {
  if (h.wind_kn === null) return "no wind forecast";
  const gust = h.gust_kn !== null && h.gust_kn > h.wind_kn ? ` g${h.gust_kn}` : "";
  return `${h.wind_kn} kn${gust}${h.from ? ` ${h.from}` : ""}`;
}

root.addEventListener("click", (event) => {
  const target = event.target as Element;
  const hour = target.closest<HTMLElement>("[data-at]");
  const pick = target.closest<HTMLElement>("[data-day]");
  const open = target.closest<HTMLAnchorElement>("a.open");
  if (hour) {
    at = hour.dataset.at!;
    render();
  } else if (pick && data) {
    day = pick.dataset.day!;
    // The new day's best-lit hour, or its first.
    const ofDay = data.hours.filter((h) => dateOf(h.time) === day);
    const best = [...ofDay]
      .filter((h) => h.light !== "dark")
      .sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1))[0];
    at = (best ?? ofDay[0])?.time ?? at;
    render();
  } else if (open) {
    // The app opens it, as its frame may not.
    event.preventDefault();
    void app.openLink(open.href).catch(() => window.open(open.href));
  }
});

/* ------------------------------------------------- the wind across the map */

let frame = 0;
const still = matchMedia("(prefers-reduced-motion: reduce)");

/**
 * Streaks blowing across the picture the way the hour's wind goes, at a pace
 * that grows with it, in its colour edged in white so they read on sea and
 * land alike. Still, for a reader who asks for less motion.
 */
function wind(hour: CardHour) {
  cancelAnimationFrame(frame);
  const canvas = root.querySelector("canvas");
  if (!canvas || hour.wind_kn === null || hour.from_deg === null) return;
  const ctx = canvas.getContext("2d")!;
  const box = canvas.getBoundingClientRect();
  const ratio = devicePixelRatio || 1;
  canvas.width = Math.round(box.width * ratio);
  canvas.height = Math.round(box.height * ratio);
  ctx.scale(ratio, ratio);
  const w = box.width;
  const h = box.height;
  // Blowing towards the opposite of where it comes from; screen y is down.
  const to = ((hour.from_deg + 180) * Math.PI) / 180;
  const dx = Math.sin(to);
  const dy = -Math.cos(to);
  const pace = 0.5 + Math.min(40, hour.wind_kn) / 12;
  const length = 10 + Math.min(40, hour.wind_kn) * 0.9;
  const colour = windCss(hour.wind_kn);
  const count = Math.round((w * h) / 2600);
  const streaks = Array.from({ length: count }, () => ({
    x: Math.random() * w,
    y: Math.random() * h,
    age: Math.random(),
  }));
  const draw = () => {
    ctx.clearRect(0, 0, w, h);
    ctx.lineCap = "round";
    for (const s of streaks) {
      const fade = Math.sin(s.age * Math.PI);
      const x0 = s.x - dx * length;
      const y0 = s.y - dy * length;
      const grad = ctx.createLinearGradient(x0, y0, s.x, s.y);
      grad.addColorStop(0, "rgb(255 255 255 / 0)");
      grad.addColorStop(1, colour);
      ctx.globalAlpha = 0.85 * fade;
      ctx.strokeStyle = "rgb(255 255 255 / 0.55)";
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
      ctx.strokeStyle = grad;
      ctx.lineWidth = 1.6;
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  };
  const step = () => {
    for (const s of streaks) {
      s.x += dx * pace;
      s.y += dy * pace;
      s.age += 0.006 + pace * 0.0015;
      if (s.age >= 1 || s.x < -length || s.x > w + length || s.y < -length || s.y > h + length) {
        s.x = Math.random() * w;
        s.y = Math.random() * h;
        s.age = 0;
      }
    }
    draw();
    frame = requestAnimationFrame(step);
  };
  if (still.matches) draw();
  else frame = requestAnimationFrame(step);
}

let resized = 0;
new ResizeObserver(() => {
  cancelAnimationFrame(resized);
  resized = requestAnimationFrame(() => {
    const hour = data?.hours.find((h) => h.time === at);
    if (hour) wind(hour);
  });
}).observe(root);

/* ---------------------------------------------------------- the host */

function theme(context: HostContext) {
  const dark =
    context.theme === "dark" ||
    (context.theme !== "light" &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

theme({});
const app = connect({
  info: { name: "wingfoil.ie spot card", version: "1.0.0" },
  onToolResult: (result) => {
    const card = result.structuredContent;
    if (!isSpotCardData(card)) return;
    data = card;
    at = card.focus;
    day = null;
    render();
  },
  onContext: theme,
});
