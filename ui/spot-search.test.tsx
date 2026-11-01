import { beforeAll, describe, expect, it, vi } from "vitest";
import { FAVOURITES_KEY } from "../shared/web/favourites";
import { mount, text, type Drawn, type Mounted } from "./render.testkit";
import { SpotSearch } from "./SpotSearch";

/**
 * The top bar's search, as a rider uses it: an ARIA combobox over a list box
 * of places. Typing filters at once, accents and case let go of; the arrow
 * keys move the active option, which the field points at; Enter picks it;
 * Escape clears what was typed and then closes. With nothing typed it offers
 * the rider's own spots, and the ones they look at.
 */

interface Place {
  id: string;
  name: string;
  county: string;
}

const PLACES: Place[] = [
  { id: "dollymount", name: "Dollymount", county: "Dublin" },
  { id: "brandon", name: "Brandon Bay", county: "Kerry" },
  { id: "inch", name: "Inch", county: "Kerry" },
  { id: "beal-ban", name: "Béal Bán", county: "Kerry" },
  { id: "rosslare", name: "Rosslare", county: "Wexford" },
  { id: "bundoran", name: "Bundoran", county: "Donegal" },
];

beforeAll(() => {
  // Two starred spots, and one looked at often: what an empty query offers.
  const stored = new Map<string, string>([
    [
      FAVOURITES_KEY,
      JSON.stringify({
        starred: ["inch", "brandon"],
        visits: { rosslare: { count: 4, last: 1 } },
      }),
    ],
  ]);
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => stored.get(k) ?? null,
    setItem: (k: string, v: string) => void stored.set(k, v),
  });
  vi.stubGlobal("window", {
    addEventListener: () => {},
    removeEventListener: () => {},
    matchMedia: () => ({ matches: false }),
  });
});

function search() {
  const picked: Place[] = [];
  const view = mount(
    <SpotSearch spots={PLACES} onPick={(spot) => picked.push(spot)} />,
  );
  const field = () => view.one((n) => n.props.role === "combobox");
  const options = () => view.byRole("option");
  // An option's words: the name, then its county under it.
  const names = () =>
    options().map((o) => text((o.children[0] as Drawn).children[0]));
  const active = () => field().props["aria-activedescendant"];
  return { view, picked, field, options, names, active };
}

const type = (s: { view: Mounted; field: () => Drawn }, value: string) =>
  s.view.type(s.field(), value);
const key = (s: { view: Mounted; field: () => Drawn }, name: string) =>
  s.view.key(s.field(), name);

describe("SpotSearch", () => {
  it("is a combobox that owns a list box, closed until it is used", () => {
    const s = search();
    const field = s.field();
    expect(field.type).toBe("input");
    expect(field.props).toMatchObject({
      "aria-label": "Search spots",
      "aria-autocomplete": "list",
      "aria-expanded": false,
      autoComplete: "off",
    });
    expect(field.props["aria-activedescendant"]).toBeUndefined();
    expect(s.options()).toHaveLength(0);
  });

  it("with nothing typed, offers the rider's own spots and the ones they look at", () => {
    const s = search();
    s.view.fire(s.field(), "onFocus");
    expect(s.field().props["aria-expanded"]).toBe(true);
    const groups = s.view
      .byRole("group")
      .map((g) => text(g.children[0] as Drawn));
    expect(groups).toEqual(["Your spots", "You look at"]);
    expect(s.names()).toEqual(["Inch", "Brandon Bay", "Rosslare"]);
    expect(s.active()).toBe(s.options()[0].props.id);
  });

  it("filters as the rider types, by name or the start of a county", () => {
    const s = search();
    type(s, "dolly");
    expect(s.names()).toEqual(["Dollymount"]);
    expect(text(s.view.one((n) => n.props.role === "status"))).toBe("1 spot");
    type(s, "kerry");
    // The starred first, then by name.
    expect(s.names()).toEqual(["Brandon Bay", "Inch", "Béal Bán"]);
    expect(text(s.view.one((n) => n.props.role === "status"))).toBe("3 spots");
    // One list, not grouped, once something is typed.
    expect(
      s.view.byRole("group").map((g) => text(g.children[0] as Drawn)),
    ).toEqual(["Spots"]);
  });

  it("lets go of accents and case, and underlines the part of the name typed", () => {
    const s = search();
    for (const typed of ["beal", "BEAL", "Béal", "bán"]) {
      type(s, typed);
      expect(s.names(), typed).toEqual(["Béal Bán"]);
    }
    type(s, "beal");
    const mark = s.view.one((n) => n.type === "mark");
    expect(text(mark)).toBe("Béal");
  });

  it("moves the active option with the arrow keys, wrapping at both ends", () => {
    const s = search();
    type(s, "kerry");
    const ids = s.options().map((o) => o.props.id);
    expect(s.active()).toBe(ids[0]);
    expect(s.options()[0].props["aria-selected"]).toBe(true);
    key(s, "ArrowDown");
    expect(s.active()).toBe(ids[1]);
    expect(s.options()[1].props["aria-selected"]).toBe(true);
    expect(s.options()[0].props["aria-selected"]).toBe(false);
    key(s, "ArrowDown");
    key(s, "ArrowDown");
    expect(s.active()).toBe(ids[0]);
    key(s, "ArrowUp");
    expect(s.active()).toBe(ids[2]);
    key(s, "ArrowUp");
    expect(s.active()).toBe(ids[1]);
    // Every option the field points at is one of the list box's.
    const list = s.view.one((n) => n.props.role === "listbox");
    expect(s.field().props["aria-controls"]).toBe(list.props.id);
  });

  it("picks the active option with Enter, and clears and closes after", () => {
    const s = search();
    type(s, "kerry");
    key(s, "ArrowDown");
    key(s, "Enter");
    expect(s.picked.map((p) => p.id)).toEqual(["inch"]);
    expect(s.field().props.value).toBe("");
    expect(s.field().props["aria-expanded"]).toBe(false);
  });

  it("picks an option by a press too", () => {
    const s = search();
    type(s, "ross");
    s.view.fire(s.options()[0], "onClick");
    expect(s.picked.map((p) => p.id)).toEqual(["rosslare"]);
  });

  it("clears what was typed with Escape, then closes with a second", () => {
    const s = search();
    type(s, "dolly");
    key(s, "Escape");
    expect(s.field().props.value).toBe("");
    // Still open, offering the rider's own.
    expect(s.field().props["aria-expanded"]).toBe(true);
    expect(s.names()).toEqual(["Inch", "Brandon Bay", "Rosslare"]);
    key(s, "Escape");
    expect(s.field().props["aria-expanded"]).toBe(false);
    expect(s.options()).toHaveLength(0);
  });

  it("says plainly when no spot matches, and offers no option to pick", () => {
    const s = search();
    type(s, "zzz");
    const none = s.view.one(
      (n) => n.props["data-spot-search-none"] !== undefined,
    );
    expect(text(none)).toBe("No spots match “zzz”");
    expect(s.options()).toHaveLength(0);
    expect(s.view.byRole("listbox")).toHaveLength(0);
    expect(s.active()).toBeUndefined();
    key(s, "Enter");
    expect(s.picked).toHaveLength(0);
  });

  it("clears with its own button, back to an empty field", () => {
    const s = search();
    type(s, "dolly");
    const clear = s.view.one(
      (n) =>
        n.type === "button" && n.props["aria-label"] === "Clear the search",
    );
    s.view.fire(clear, "onClick");
    expect(s.field().props.value).toBe("");
    expect(s.view.focused()?.props.role).toBe("combobox");
  });
});
