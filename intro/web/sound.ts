/**
 * The film's sound, made on the spot with Web Audio: no files to download.
 *
 * - Wind: pink noise through a low-pass whose cut-off and level breathe with
 *   the gusts.
 * - Water: a narrower band of the same noise, lapping, loud at the surface
 *   and fading as the camera climbs away from it.
 * - The three passes: a whoosh of band-passed noise sweeping up and down,
 *   panned across from the side the rider passes on.
 * - The sunset: a soft A major chord rising as the sun comes into view.
 *
 * It starts silent and off; a browser will not play sound before the reader
 * has asked for it, and a first impression should not shout.
 */
import { HERO_PASSES } from "../scene/fleet";

export interface FilmSound {
  setEnabled(on: boolean): void;
  update(t: number, cameraHeight: number): void;
  dispose(): void;
}

function pinkNoise(ctx: AudioContext, seconds: number): AudioBuffer {
  const buffer = ctx.createBuffer(2, ctx.sampleRate * seconds, ctx.sampleRate);
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    // Paul Kellet's economy pink filter.
    let b0 = 0, b1 = 0, b2 = 0;
    for (let i = 0; i < data.length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99765 * b0 + white * 0.099046;
      b1 = 0.963 * b1 + white * 0.2965164;
      b2 = 0.57 * b2 + white * 1.0526913;
      data[i] = (b0 + b1 + b2 + white * 0.1848) * 0.2;
    }
  }
  return buffer;
}

export function createSound(): FilmSound {
  const ctx = new AudioContext();
  const master = ctx.createGain();
  master.gain.value = 0;
  master.connect(ctx.destination);
  const noise = pinkNoise(ctx, 6);

  const loop = (offset: number) => {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    src.loop = true;
    src.start(0, offset);
    return src;
  };

  const windFilter = ctx.createBiquadFilter();
  windFilter.type = "lowpass";
  windFilter.frequency.value = 420;
  windFilter.Q.value = 0.7;
  const windGain = ctx.createGain();
  windGain.gain.value = 0.5;
  loop(0).connect(windFilter).connect(windGain).connect(master);

  const waterFilter = ctx.createBiquadFilter();
  waterFilter.type = "bandpass";
  waterFilter.frequency.value = 1300;
  waterFilter.Q.value = 0.8;
  const waterGain = ctx.createGain();
  waterGain.gain.value = 0.25;
  loop(2.7).connect(waterFilter).connect(waterGain).connect(master);

  const padFilter = ctx.createBiquadFilter();
  padFilter.type = "lowpass";
  padFilter.frequency.value = 900;
  const padGain = ctx.createGain();
  padGain.gain.value = 0;
  padFilter.connect(padGain).connect(master);
  const oscillators = [110, 164.81, 220, 277.18, 329.63].map((f, i) => {
    const o = ctx.createOscillator();
    o.type = i % 2 ? "triangle" : "sine";
    o.frequency.value = f;
    o.detune.value = (i - 2) * 4;
    const g = ctx.createGain();
    g.gain.value = 0.12 / (1 + i * 0.4);
    o.connect(g).connect(padFilter);
    o.start();
    return o;
  });

  const whoosh = (side: number) => {
    const now = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const band = ctx.createBiquadFilter();
    band.type = "bandpass";
    band.Q.value = 1.4;
    band.frequency.setValueAtTime(260, now);
    band.frequency.exponentialRampToValueAtTime(1500, now + 0.75);
    band.frequency.exponentialRampToValueAtTime(380, now + 1.8);
    const pan = ctx.createStereoPanner();
    pan.pan.setValueAtTime(side * 0.9, now);
    pan.pan.linearRampToValueAtTime(side * 0.2, now + 1.8);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, now);
    env.gain.exponentialRampToValueAtTime(1.1, now + 0.7);
    env.gain.exponentialRampToValueAtTime(0.0001, now + 2);
    src.connect(band).connect(pan).connect(env).connect(master);
    src.start(now, Math.random() * 3);
    src.stop(now + 2.1);
  };

  let last = -1;
  let enabled = false;
  return {
    setEnabled(on) {
      enabled = on;
      if (on) void ctx.resume();
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.25);
    },
    update(t, height) {
      const now = ctx.currentTime;
      const gust = 0.5 + 0.5 * Math.sin(t * 0.6) * Math.sin(t * 0.23 + 1);
      windGain.gain.setTargetAtTime(0.35 + 0.35 * gust, now, 0.3);
      windFilter.frequency.setTargetAtTime(320 + 380 * gust + Math.min(height, 60) * 4, now, 0.3);
      const surface = Math.max(0, 1 - height / 25);
      waterGain.gain.setTargetAtTime(0.06 + 0.32 * surface * (0.7 + 0.3 * Math.sin(t * 1.9)), now, 0.15);
      padGain.gain.setTargetAtTime(Math.min(1, Math.max(0, (t - 20) / 7)) * 0.5, now, 0.8);
      // A whoosh as each hero draws level, starting a little before.
      if (enabled)
        for (const pass of HERO_PASSES) {
          const at = pass.time - 0.75;
          if (last < at && t >= at) whoosh(Math.sign(pass.x));
        }
      last = t;
    },
    dispose() {
      oscillators.forEach((o) => o.stop());
      void ctx.close();
    },
  };
}
