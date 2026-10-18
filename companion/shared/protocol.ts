/**
 * Gust, the wing-foiling companion: what the browser and the server say to
 * each other. Pure and dependency-free, so both ends import the same words.
 *
 * The browser POSTs a bounded conversation and the context it is looking at
 * (selected spot, timeline time, rider profile, its clock) to
 * /api/companion/chat. The answer is a stream of server-sent events over the
 * fetch response:
 *
 *   text      a delta of Gust's words
 *   tool      a lookup starting or finishing, with a human label
 *   card      structured data to draw (a spot card): numbers come from the
 *             forecast, never from the model's prose
 *   action    something for the map to do, only ever at the rider's ask
 *   proposal  a rider-profile change waiting for the rider's Confirm
 *   error     what went wrong, in words fit to show
 *   done      the end of the turn
 */

import type { CustomRating } from "../../force5/src/stars.js";

export const COMPANION_NAME = "Gust";

/** How many past messages the server reads; the browser sends no more than this. */
export const MAX_HISTORY = 20;
export const MAX_MESSAGE_CHARS = 2000;
/** The longest assistant message the browser echoes back, cards' notes included. */
export const MAX_ECHO_CHARS = 4000;

/**
 * Whether Gust can answer on this site, as GET /api/companion/status says:
 *
 *   awake    answering
 *   asleep   no API key on this server: shown, and says so (development)
 *   resting  this month's budget is spent: hidden until the 1st
 *   off      switched off (FEATURE_GUST): hidden
 */
export type Availability = "awake" | "asleep" | "resting" | "off";

export interface CompanionStatus {
  state: Availability;
  /** Kept for browsers from before `state`: true only when awake. */
  configured: boolean;
  fake: boolean;
  /** ISO, when resting: the start of next month, when Gust is back. */
  resumes: string | null;
}

export type Skill = "beginner" | "intermediate" | "advanced";

/** The rider's own words for a level, as the dock's Display options write them. */
export const SKILL_LABEL: Record<Skill, string> = {
  beginner: "Learning",
  intermediate: "Riding",
  advanced: "Advanced",
};

export interface RiderContext {
  /** Kilograms, or null when the rider has not said (ratings assume 80 kg). */
  weightKg: number | null;
  skill: Skill;
  /** Wing sizes owned, in square metres. */
  wings: number[];
  /** The rider's own star rating, which Gust then rates with. */
  custom?: CustomRating | null;
}

export interface ChatContext {
  spot: { id: string; name: string } | null;
  /** The hour selected on the map's timeline, ISO. */
  time: string | null;
  /** Null when the rider has never opened Display options. */
  rider: RiderContext | null;
  /** The browser's clock when the message was sent, ISO. */
  now: string;
}

export type ChatTurn =
  | { role: "user"; text: string; context?: ChatContext }
  | { role: "assistant"; text: string };

export interface ChatRequest {
  messages: ChatTurn[];
  context: ChatContext;
}

// ---- what the server sends ------------------------------------------------------

export interface WindowChip {
  /** ISO start and end (end is exclusive: the hour after the last rated one). */
  from: string;
  to: string;
  /** "Sat, 4 Oct, 14:00–18:00" in Irish time. */
  local: string;
  stars: number;
}

export interface WindowSummary extends WindowChip {
  potential: number;
  wind_kn: number;
  gust_kn: number | null;
  direction: string;
  direction_deg: number;
  /** The wing the curve recommends for the window's mean wind. */
  wing_m2: number;
  /** Which of the rider's own wings to take, when they have listed any. */
  own_wing_m2: number | null;
  /** "cross-onshore", "offshore"…; null where the shore's facing is unknown. */
  shore: string | null;
  agreement: "high" | "moderate" | "low" | null;
}

export interface SpotCardData {
  kind: "spot";
  id: string;
  name: string;
  county: string;
  best: WindowSummary | null;
  /** The other good windows in the search, earliest first. */
  windows: WindowChip[];
  rider: { weightKg: number; assumed: boolean; skill: Skill };
  /** Why there is no best window, when there is none. */
  note: string | null;
}

export type Card = SpotCardData;

export type MapAction =
  | { type: "select_spot"; id: string }
  | { type: "set_time"; iso: string }
  | { type: "highlight_spots"; ids: string[] };

export interface ProfileProposal {
  id: string;
  rider: RiderContext;
  /** "Save 85 kg · Riding · 4/5/6 m?" */
  summary: string;
}

export type ToolStatus = "running" | "done" | "error";

export interface ToolActivity {
  id: string;
  name: string;
  status: ToolStatus;
  /** "Checking Brandon Bay" */
  label: string;
  /** What it found, once done. */
  summary?: string;
}

export interface TurnError {
  code: string;
  message: string;
}

export type ServerEvent =
  | { event: "text"; data: { delta: string } }
  | { event: "tool"; data: ToolActivity }
  | { event: "card"; data: Card }
  | { event: "action"; data: MapAction }
  | { event: "proposal"; data: ProfileProposal }
  | { event: "error"; data: TurnError }
  | { event: "done"; data: Record<string, never> };

export type ServerEventName = ServerEvent["event"];

const EVENT_NAMES: readonly ServerEventName[] = [
  "text",
  "tool",
  "card",
  "action",
  "proposal",
  "error",
  "done",
];

/** Labels and summaries for the profile, as a proposal card reads them. */
export function riderSummary(rider: RiderContext): string {
  const parts = [
    rider.weightKg === null ? "80 kg (assumed)" : `${rider.weightKg} kg`,
    SKILL_LABEL[rider.skill],
  ];
  if (rider.wings.length) parts.push(`${rider.wings.join("/")} m`);
  return parts.join(" · ");
}

// ---- server-sent events -------------------------------------------------------------

/** One event on the wire. JSON never holds a raw newline, so one data line is enough. */
export function encodeSse(event: ServerEvent): string {
  return `event: ${event.event}\ndata: ${JSON.stringify(event.data)}\n\n`;
}

export interface SseMessage {
  event: string;
  data: string;
}

/**
 * A parser for a text/event-stream read in arbitrary chunks: feed it text,
 * get back every complete message so far. Comments and unknown fields are
 * skipped; multi-line data is joined with newlines, as the spec says.
 */
export function createSseParser(): (chunk: string) => SseMessage[] {
  let buffer = "";
  return (chunk) => {
    buffer += chunk.replace(/\r\n?/g, "\n");
    const out: SseMessage[] = [];
    let end = buffer.indexOf("\n\n");
    while (end >= 0) {
      const frame = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      const data: string[] = [];
      for (const line of frame.split("\n")) {
        if (line === "" || line.startsWith(":")) continue;
        const colon = line.indexOf(":");
        const field = colon < 0 ? line : line.slice(0, colon);
        const value = colon < 0 ? "" : line.slice(colon + 1).replace(/^ /, "");
        if (field === "event") event = value;
        else if (field === "data") data.push(value);
      }
      if (data.length) out.push({ event, data: data.join("\n") });
      end = buffer.indexOf("\n\n");
    }
    return out;
  };
}

/** A parsed message as one of ours, or null for anything else. */
export function toServerEvent(message: SseMessage): ServerEvent | null {
  if (!EVENT_NAMES.includes(message.event as ServerEventName)) return null;
  try {
    const data: unknown = JSON.parse(message.data);
    if (typeof data !== "object" || data === null) return null;
    return { event: message.event, data } as ServerEvent;
  } catch {
    return null;
  }
}
