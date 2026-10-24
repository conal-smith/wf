import { createContext } from "react";

/** The parts of the map's information dialog, in the order its rail lists them. */
export type InfoSection =
  | "key"
  | "stars"
  | "wind"
  | "blend"
  | "foil"
  | "currents"
  | "rain"
  | "satellite"
  | "sources"
  | "about";

/**
 * Opens the map's information dialog at one of its parts. Provided by the map
 * (src/App.tsx), so that a "?" deep in the dock or the panel opens the same
 * dialog as the "i" under Layers; null anywhere else.
 */
export const MapInfoOpen = createContext<((at: InfoSection) => void) | null>(
  null,
);
