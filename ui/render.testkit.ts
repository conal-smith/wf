/**
 * Just enough of a renderer to press, type into and step through the kit's
 * controls in a test, with no DOM to hand: the test run is Node's, and the
 * site carries no browser emulation. A component is called as React would
 * call it, its hooks answered from a store kept per place in the tree, and
 * what it draws is kept as a plain tree of elements whose handlers a test can
 * call. After every handler the tree is drawn again, effects and all.
 *
 * It holds what the kit uses (state, refs, effects, memo, ids, an external
 * store, context at its default) and nothing more. Rendering to markup
 * (react-dom/server) remains the way to check what is drawn; this is for what
 * a press or a key does to it.
 */
import * as React from "react";
import type { ReactElement, ReactNode } from "react";

/** One element as drawn: its tag, its props, and what is inside it. */
export interface Drawn {
  type: string;
  props: Record<string, unknown>;
  children: (Drawn | string)[];
  path: string;
}

/** What a ref on a drawn element holds: the little of an element the kit asks. */
export interface FakeElement {
  readonly path: string;
  readonly isConnected: true;
  readonly tagName: string;
  readonly isContentEditable: false;
  focus(): void;
  blur(): void;
  contains(other: unknown): boolean;
  querySelectorAll(selector: string): FakeElement[];
  getBoundingClientRect(): {
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
}

interface Internals {
  H: unknown;
}

const internals = (
  React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: Internals;
  }
).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE;

type Deps = readonly unknown[] | undefined;
const changed = (a: Deps, b: Deps) =>
  !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));

interface Effect {
  run: () => void | (() => void);
  slot: { deps: Deps; cleanup?: void | (() => void) };
}

export interface Mounted {
  /** Every drawn element that passes the test, in document order. */
  all(test: (node: Drawn) => boolean): Drawn[];
  /** The one drawn element that passes; throws for none or several. */
  one(test: (node: Drawn) => boolean): Drawn;
  byRole(role: string): Drawn[];
  /** The element a ref on it would hold. */
  element(node: Drawn): FakeElement;
  /** Calls a handler as the browser would, then draws again. */
  fire(node: Drawn, handler: string, event?: Record<string, unknown>): void;
  /** Types into a field: its onChange with the new value. */
  type(node: Drawn, value: string): void;
  key(node: Drawn, key: string): void;
  /** The drawn element with the focus, if any. */
  focused(): Drawn | null;
  /** A new element in place of the one mounted, the hooks kept. */
  update(element: ReactElement): void;
  unmount(): void;
}

/** The words inside a drawn element, as a reader would see them. */
export function text(node: Drawn | string): string {
  return typeof node === "string" ? node : node.children.map(text).join("");
}

export function mount(root: ReactElement): Mounted {
  const hooks = new Map<string, unknown[]>();
  const elements = new Map<string, FakeElement>();
  let current = root;
  let tree: (Drawn | string)[] = [];
  let pending: Effect[] = [];
  let focus: string | null = null;
  let dirty = false;
  let busy = false;

  const fake = (path: string, tagName: string): FakeElement => {
    const known = elements.get(path);
    if (known) return known;
    const made: FakeElement = {
      path,
      isConnected: true,
      tagName: tagName.toUpperCase(),
      isContentEditable: false,
      focus: () => {
        focus = path;
      },
      blur: () => {
        if (focus === path) focus = null;
      },
      contains: (other) =>
        !!other &&
        typeof (other as FakeElement).path === "string" &&
        ((other as FakeElement).path === path ||
          (other as FakeElement).path.startsWith(`${path}/`)),
      querySelectorAll: (selector) => {
        const m = selector.match(/^\[([\w-]+)="([^"]*)"\]$/);
        if (!m) throw new Error(`render.testkit: no selector ${selector}`);
        return find(
          (n) =>
            n.path.startsWith(`${path}/`) && String(n.props[m[1]]) === m[2],
        ).map((n) => fake(n.path, n.type));
      },
      getBoundingClientRect: () => ({ left: 0, right: 0, top: 0, bottom: 0 }),
    };
    elements.set(path, made);
    return made;
  };

  const schedule = () => {
    dirty = true;
    if (!busy) draw();
  };

  function dispatcher(slots: unknown[], path: string) {
    let at = 0;
    const slot = <T>(make: () => T): T => {
      const k = at++;
      if (slots[k] === undefined) slots[k] = make();
      return slots[k] as T;
    };
    const effect = (run: Effect["run"], deps: Deps) => {
      const s = slot<Effect["slot"]>(() => ({ deps: undefined }));
      if (s.deps === undefined || changed(s.deps, deps)) {
        pending.push({ run, slot: s });
        s.deps = deps ?? [Symbol()];
      }
    };
    return {
      useState<T>(init: T | (() => T)) {
        const s = slot(() => {
          const state = {
            value: typeof init === "function" ? (init as () => T)() : init,
            set: (next: T | ((was: T) => T)) => {
              const value =
                typeof next === "function"
                  ? (next as (was: T) => T)(state.value)
                  : next;
              if (Object.is(value, state.value)) return;
              state.value = value;
              schedule();
            },
          };
          return state;
        });
        return [s.value, s.set];
      },
      useRef<T>(init: T) {
        return slot(() => ({ current: init }));
      },
      useEffect: effect,
      useLayoutEffect: effect,
      useInsertionEffect: effect,
      useMemo<T>(make: () => T, deps: Deps) {
        const s = slot<{ deps: Deps; value?: T }>(() => ({ deps: undefined }));
        if (s.deps === undefined || changed(s.deps, deps)) {
          s.value = make();
          s.deps = deps;
        }
        return s.value as T;
      },
      useCallback<T>(fn: T, deps: Deps) {
        const s = slot<{ deps: Deps; value?: T }>(() => ({ deps: undefined }));
        if (s.deps === undefined || changed(s.deps, deps)) {
          s.value = fn;
          s.deps = deps;
        }
        return s.value as T;
      },
      useId() {
        const k = at;
        return slot(() => `:r${path.length}-${k}:`);
      },
      useSyncExternalStore<T>(_subscribe: unknown, get: () => T) {
        at++;
        return get();
      },
      useContext<T>(context: { _currentValue: T }) {
        return context._currentValue;
      },
      useDebugValue() {},
    };
  }

  function render(node: ReactNode, path: string): (Drawn | string)[] {
    if (node === null || node === undefined || typeof node === "boolean")
      return [];
    if (typeof node === "string" || typeof node === "number")
      return [String(node)];
    if (Array.isArray(node))
      return node.flatMap((child, i) =>
        render(
          child as ReactNode,
          `${path}/[${(child as ReactElement | null)?.key ?? i}]`,
        ),
      );
    const element = node as ReactElement<Record<string, unknown>>;
    const { type, props } = element;
    if (type === React.Fragment)
      return render(props.children as ReactNode, `${path}/~`);
    // memo() and forwardRef(), as lucide draws its icons: the function inside.
    const wrapped = type as unknown as {
      $$typeof?: symbol;
      type?: unknown;
      render?: (props: unknown, ref: unknown) => ReactNode;
    };
    if (wrapped && typeof wrapped === "object") {
      if (wrapped.$$typeof === Symbol.for("react.memo"))
        return render({ ...element, type: wrapped.type } as ReactElement, path);
      if (wrapped.$$typeof === Symbol.for("react.forward_ref")) {
        const { render: inner } = wrapped;
        const named = (p: Record<string, unknown>) => inner!(p, p.ref ?? null);
        return render({ ...element, type: named } as ReactElement, path);
      }
    }
    if (typeof type === "function") {
      const name = type.name || "Anon";
      const slots = hooks.get(path) ?? [];
      hooks.set(path, slots);
      const was = internals.H;
      internals.H = dispatcher(slots, path);
      let out: ReactNode;
      try {
        out = (type as (p: unknown) => ReactNode)(props);
      } finally {
        internals.H = was;
      }
      return render(out, `${path}/${name}`);
    }
    if (typeof type === "string") {
      const here = `${path}/${type}`;
      const drawn: Drawn = {
        type,
        props,
        children: render(props.children as ReactNode, here),
        path: here,
      };
      const ref = props.ref as
        | { current: unknown }
        | ((el: unknown) => void)
        | undefined;
      if (typeof ref === "function") ref(fake(here, type));
      else if (ref) ref.current = fake(here, type);
      return [drawn];
    }
    throw new Error(`render.testkit: cannot draw ${String(type)}`);
  }

  function draw() {
    for (let round = 0; round < 25; round++) {
      dirty = false;
      busy = true;
      try {
        tree = render(current, "");
        const run = pending;
        pending = [];
        for (const e of run) {
          if (typeof e.slot.cleanup === "function") e.slot.cleanup();
          e.slot.cleanup = e.run();
        }
      } finally {
        busy = false;
      }
      if (!dirty) return;
    }
    throw new Error("render.testkit: drawing does not settle");
  }

  function find(test: (node: Drawn) => boolean): Drawn[] {
    const out: Drawn[] = [];
    const walk = (nodes: (Drawn | string)[]) => {
      for (const n of nodes) {
        if (typeof n === "string") continue;
        if (test(n)) out.push(n);
        walk(n.children);
      }
    };
    walk(tree);
    return out;
  }

  const fire: Mounted["fire"] = (node, handler, event = {}) => {
    const fn = node.props[handler] as ((e: unknown) => void) | undefined;
    if (!fn) throw new Error(`render.testkit: <${node.type}> has no ${handler}`);
    const target = fake(node.path, node.type);
    let prevented = false;
    busy = true;
    try {
      fn({
        target,
        currentTarget: target,
        relatedTarget: null,
        button: 0,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        get defaultPrevented() {
          return prevented;
        },
        preventDefault: () => {
          prevented = true;
        },
        stopPropagation: () => {},
        ...event,
      });
    } finally {
      busy = false;
    }
    draw();
  };

  draw();

  return {
    all: find,
    one(test) {
      const found = find(test);
      if (found.length !== 1)
        throw new Error(`render.testkit: ${found.length} found, not one`);
      return found[0];
    },
    byRole: (role) => find((n) => n.props.role === role),
    element: (node) => fake(node.path, node.type),
    fire,
    type: (node, value) => fire(node, "onChange", { target: { value } }),
    key: (node, key) => fire(node, "onKeyDown", { key }),
    focused: () => (focus ? (find((n) => n.path === focus)[0] ?? null) : null),
    update(element) {
      current = element;
      draw();
    },
    unmount() {
      for (const slots of hooks.values())
        for (const s of slots) {
          const cleanup = (s as Effect["slot"] | undefined)?.cleanup;
          if (typeof cleanup === "function") cleanup();
        }
      hooks.clear();
      tree = [];
    },
  };
}
