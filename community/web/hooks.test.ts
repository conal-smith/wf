import { describe, expect, it, vi } from "vitest";
import type { Category, Channel } from "../shared/types";
import {
  COUNT_EVERY_MS,
  railGroups,
  watchCount,
  type CountClock,
} from "./hooks";

const category = (id: string, position: number): Category => ({
  id,
  name: id,
  position,
});

const channel = (
  slug: string,
  categoryId: string,
  position: number,
): Channel => ({
  id: `ch_${slug}`,
  slug,
  categoryId,
  name: slug,
  description: "",
  postPolicy: "everyone",
  status: "active",
  position,
  threadCount: 0,
  followerCount: 0,
  lastMessageAt: null,
  tags: [],
});

describe("railGroups", () => {
  it("puts channels under their categories, both in the site's order", () => {
    const groups = railGroups(
      [category("riding", 2), category("gear", 1)],
      [
        channel("sessions", "riding", 2),
        channel("foils", "gear", 3),
        channel("spots", "riding", 1),
        channel("wings", "gear", 1),
      ],
    );
    expect(
      groups.map((g) => [g.category.id, g.channels.map((c) => c.slug)]),
    ).toEqual([
      ["gear", ["wings", "foils"]],
      ["riding", ["spots", "sessions"]],
    ]);
  });

  it("draws no head for a category with nothing under it", () => {
    const groups = railGroups(
      [category("gear", 1), category("social", 2)],
      [channel("wings", "gear", 1), channel("stray", "gone", 1)],
    );
    expect(groups.map((g) => g.category.id)).toEqual(["gear"]);
  });

  it("does not reorder what it was given", () => {
    const categories = [category("b", 2), category("a", 1)];
    railGroups(categories, []);
    expect(categories.map((c) => c.id)).toEqual(["b", "a"]);
  });
});

/** A window that only does what it is told: focus and the minute are fired by hand. */
function clock() {
  const state = {
    focus: [] as (() => void)[],
    ticks: [] as { handler: () => void; ms: number; id: number }[],
    cleared: [] as number[],
    hidden: false,
  };
  const fake: CountClock = {
    addEventListener: (_, listener) => state.focus.push(listener),
    removeEventListener: (_, listener) => {
      state.focus = state.focus.filter((l) => l !== listener);
    },
    setInterval: (handler, ms) => {
      state.ticks.push({ handler, ms, id: state.ticks.length + 1 });
      return state.ticks.length;
    },
    clearInterval: (id) => state.cleared.push(id),
    hidden: () => state.hidden,
  };
  return { fake, state };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe("watchCount: the bell's poll", () => {
  it("asks on load, on focus and every 60 s", async () => {
    const { fake, state } = clock();
    const seen: number[] = [];
    let n = 0;
    watchCount(
      async () => ++n,
      (count) => seen.push(count),
      fake,
    );
    await settle();
    expect(seen).toEqual([1]);

    expect(state.ticks.map((t) => t.ms)).toEqual([COUNT_EVERY_MS]);
    expect(COUNT_EVERY_MS).toBe(60_000);
    state.ticks[0].handler();
    await settle();
    expect(seen).toEqual([1, 2]);

    expect(state.focus).toHaveLength(1);
    state.focus[0]();
    await settle();
    expect(seen).toEqual([1, 2, 3]);
  });

  it("skips its minute in a hidden tab, and asks when the reader returns", async () => {
    const { fake, state } = clock();
    const load = vi.fn(async () => 4);
    watchCount(load, () => {}, fake);
    state.hidden = true;
    state.ticks[0].handler();
    expect(load).toHaveBeenCalledTimes(1);
    state.focus[0]();
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("keeps the number it had when an ask fails", async () => {
    const { fake, state } = clock();
    const seen: number[] = [];
    const load = vi
      .fn<() => Promise<number>>()
      .mockResolvedValueOnce(3)
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(5);
    watchCount(load, (count) => seen.push(count), fake);
    await settle();
    state.ticks[0].handler();
    await settle();
    expect(seen).toEqual([3]);
    state.ticks[0].handler();
    await settle();
    expect(seen).toEqual([3, 5]);
  });

  it("drops an answer that a later ask has overtaken", async () => {
    const { fake, state } = clock();
    const seen: number[] = [];
    const answers: ((count: number) => void)[] = [];
    watchCount(
      () => new Promise<number>((resolve) => answers.push(resolve)),
      (count) => seen.push(count),
      fake,
    );
    state.focus[0]();
    answers[1](7);
    answers[0](2);
    await settle();
    expect(seen).toEqual([7]);
  });

  it("stops: no listener, no timer, and a late answer goes nowhere", async () => {
    const { fake, state } = clock();
    const seen: number[] = [];
    let answer: (count: number) => void = () => {};
    const stop = watchCount(
      () => new Promise<number>((resolve) => (answer = resolve)),
      (count) => seen.push(count),
      fake,
    );
    stop();
    answer(9);
    await settle();
    expect(seen).toEqual([]);
    expect(state.focus).toEqual([]);
    expect(state.cleared).toEqual([1]);
  });
});
