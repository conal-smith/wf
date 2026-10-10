import { ESTIMATE_WEIGHT_KG, windBand, type Rider } from "../force5/src/stars";

const SKILL_WORD: Record<Rider["skill"], string> = {
  beginner: "learning",
  intermediate: "intermediate",
  advanced: "advanced",
};

/** Who the stars are for, in figures: "80 kg intermediate · best 14–24 kn". */
export function riderLine(rider: Rider) {
  const band = windBand(rider);
  const kg = rider.weightKg ?? ESTIMATE_WEIGHT_KG;
  return `${rider.weightKg === null ? "~" : ""}${kg} kg ${SKILL_WORD[rider.skill]} · best ${Math.round(band.sweetLow)}–${Math.round(band.sweetHigh)} kn`;
}
