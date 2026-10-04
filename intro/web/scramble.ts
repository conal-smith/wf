/**
 * Text that decodes into place: every letter not yet revealed shows a
 * flickering stand-in, and the real letters resolve left to right as
 * `progress` goes from 0 to 1. Spaces and punctuation hold still, so the
 * shape of the words is there from the first frame.
 */
const GLYPHS = "abcdefghijklmnopqrstuvwxyz0123456789";

const hash = (i: number, tick: number) => {
  const s = Math.sin(i * 127.1 + tick * 311.7) * 43758.5453;
  return s - Math.floor(s);
};

/** `tick` changes the stand-ins; pass a value that steps a few times a second. */
export function scramble(text: string, progress: number, tick: number): string {
  if (progress >= 1) return text;
  const p = Math.max(0, progress);
  const revealed = Math.floor(p * text.length);
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (i < revealed || !/[a-z0-9]/i.test(ch)) out += ch;
    else {
      const g = GLYPHS[Math.floor(hash(i, tick) * GLYPHS.length)];
      out += ch === ch.toUpperCase() && ch !== ch.toLowerCase() ? g.toUpperCase() : g;
    }
  }
  return out;
}
