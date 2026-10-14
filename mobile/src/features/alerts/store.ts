/**
 * The rider's alerts on this phone: kept in localStorage first (so an alert
 * saved offline is never lost) and sent to the API by sync.ts. One store,
 * read with `useAlerts`, so the tab, the editor and the sync agree.
 */
import { useSyncExternalStore } from "react";
import type { AlertRule } from "../../../../alerts/shared/protocol";
import { ALERTS_KEY, parseLocal, upsertRule, type LocalAlerts, type SyncStatus } from "./alertsLogic";

export interface AlertsState extends LocalAlerts {
  /** Not kept: how the last sync went. */
  status: SyncStatus;
}

let state: AlertsState | null = null;
const listeners = new Set<() => void>();

function read(): AlertsState {
  if (!state) {
    let text: string | null = null;
    try {
      text = globalThis.localStorage?.getItem(ALERTS_KEY) ?? null;
    } catch {
      text = null;
    }
    state = { ...parseLocal(text), status: "idle" };
  }
  return state;
}

function write(next: AlertsState) {
  state = next;
  const { status: _status, ...kept } = next;
  try {
    globalThis.localStorage?.setItem(ALERTS_KEY, JSON.stringify(kept));
  } catch {
    // A full disk keeps the change for this session; it is synced all the same.
  }
  for (const listener of listeners) listener();
}

export const alertsStore = {
  get: read,
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  /** Any change; one that touches the rules or the preferences bumps `rev` to be synced. */
  update(change: (s: AlertsState) => Partial<AlertsState>, synced = false) {
    const current = read();
    const patch = change(current);
    write({ ...current, ...patch, ...(synced ? {} : { rev: current.rev + 1 }) });
  },
  saveRule(rule: AlertRule) {
    alertsStore.update((s) => ({ rules: upsertRule(s.rules, rule) }));
  },
  deleteRule(id: string) {
    alertsStore.update((s) => ({ rules: s.rules.filter((r) => r.id !== id) }));
  },
  setEnabled(id: string, enabled: boolean) {
    alertsStore.update((s) => ({ rules: s.rules.map((r) => (r.id === id ? { ...r, enabled } : r)) }));
  },
  /** Bookkeeping from the sync: never itself something to sync. */
  note(patch: Partial<AlertsState>) {
    alertsStore.update(() => patch, true);
  },
};

export function useAlerts(): AlertsState {
  return useSyncExternalStore(alertsStore.subscribe, alertsStore.get);
}
