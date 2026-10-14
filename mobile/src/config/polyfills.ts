/**
 * The parts of the web platform the site's forecast code leans on that React
 * Native's AbortController does not have: a signal that times out, one that
 * follows several, and asking a signal to throw. Each is installed only where
 * it is missing. Imported first by src/app/_layout.tsx.
 */
type Signal = AbortSignal & { reason?: unknown; throwIfAborted?: () => void };

const proto = AbortSignal.prototype as Signal;

const abortError = (message: string, name = "AbortError") => {
  const error = new Error(message);
  error.name = name;
  return error;
};

/** Aborts `controller` with `reason`, recording it where the platform does not. */
function abortWith(controller: AbortController, reason: unknown) {
  const signal = controller.signal as Signal;
  if (signal.aborted) return;
  try {
    Object.defineProperty(signal, "reason", { value: reason, configurable: true });
  } catch {
    // A platform that records it itself.
  }
  (controller.abort as (reason?: unknown) => void)(reason);
}

if (typeof proto.throwIfAborted !== "function") {
  proto.throwIfAborted = function throwIfAborted(this: Signal) {
    if (this.aborted) throw this.reason ?? abortError("This operation was aborted");
  };
}

const statics = AbortSignal as unknown as {
  timeout?: (ms: number) => AbortSignal;
  any?: (signals: AbortSignal[]) => AbortSignal;
};

if (typeof statics.timeout !== "function") {
  statics.timeout = (ms: number) => {
    const controller = new AbortController();
    setTimeout(
      () => abortWith(controller, abortError("The operation timed out.", "TimeoutError")),
      ms,
    );
    return controller.signal;
  };
}

if (typeof statics.any !== "function") {
  statics.any = (signals: AbortSignal[]) => {
    const controller = new AbortController();
    for (const signal of signals) {
      if (signal.aborted) {
        abortWith(controller, (signal as Signal).reason);
        break;
      }
      signal.addEventListener(
        "abort",
        () => abortWith(controller, (signal as Signal).reason),
        { once: true } as AddEventListenerOptions,
      );
    }
    return controller.signal;
  };
}

export {};
