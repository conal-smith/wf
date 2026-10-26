/**
 * The first visit's one quiet offer: a 30-second tour, or no thanks. A chunk
 * of its own and only fetched on a first visit (src/tourOffer.ts); the tour
 * itself (src/Tour.tsx) only when it is taken. It stands on the chart rather
 * than over it, so nothing waits on an answer.
 */
import "./tour.css";
import { useEffect } from "react";
import { Button } from "../ui/Button";
import { Puffin } from "../ui/Puffin";

export default function TourPrompt({
  onTour,
  onNo,
}: {
  onTour: () => void;
  onNo: () => void;
}) {
  useEffect(() => {
    const key = (event: KeyboardEvent) => event.key === "Escape" && onNo();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onNo]);
  return (
    <div
      className="tour-prompt chart-box"
      role="dialog"
      aria-labelledby="tour-prompt-t"
    >
      <Puffin size={70} bob />
      <div>
        <h3 id="tour-prompt-t">New here?</h3>
        <p>Take a 30-second tour of how the site works.</p>
        <div className="tour-acts">
          <Button variant="primary" onClick={onTour}>
            Take the tour
          </Button>
          <Button variant="quiet" onClick={onNo}>
            No thanks
          </Button>
        </div>
      </div>
    </div>
  );
}
