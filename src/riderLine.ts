import { ESTIMATE_WEIGHT_KG, windBand, type Rider } from "../force5/src/stars";

/**
 * Who the stars are for, in figures: "ours · best 15–22 kn", or "your own
 * stars · best 14–24 kn", then the weight ("~80 kg"), which never moves a star.
 */
export function riderLine(rider: Rider) {
  const band = windBand(rider);
  const kg = rider.weightKg ?? ESTIMATE_WEIGHT_KG;
  return `${rider.custom ? "your own stars" : "ours"} · best ${Math.round(band.sweetLow)}–${Math.round(band.sweetHigh)} kn · ${rider.weightKg === null ? "~" : ""}${kg} kg`;
}
