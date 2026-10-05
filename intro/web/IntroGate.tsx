/**
 * Puts the opening film in front of the wind map on a first visit (see
 * decide.ts for exactly when). Everyone else gets the map straight away, and
 * never downloads the film: it is a lazy chunk with three.js inside.
 *
 * While the film plays the map is not mounted at all, so MapLibre and the
 * film never share the GPU. It mounts the moment the film reaches its menu
 * (or is skipped), and is ready behind the film by the time it fades.
 */
import { lazy, Suspense, useState, type ReactNode } from "react";
import { browserEnvironment, decideIntro } from "./decide";

const Intro = lazy(() => import("./Intro"));

type Phase = "film" | "menu" | "done";

export function IntroGate({ children }: { children: ReactNode }) {
  const [decision] = useState(() => decideIntro(browserEnvironment()));
  const [phase, setPhase] = useState<Phase>(decision.play ? "film" : "done");
  return (
    <>
      {phase !== "film" && children}
      {phase !== "done" && (
        <Suspense fallback={<div className="fixed inset-0 z-intro bg-film" />}>
          <Intro
            startAt={decision.startAt}
            onMenu={() => setPhase((p) => (p === "film" ? "menu" : p))}
            onDone={() => setPhase("done")}
          />
        </Suspense>
      )}
    </>
  );
}
