import type { ReactNode } from "react";
import { tv } from "./tv";

/*
 * The one thing on a view that matters, lifted off the page on a raised
 * paper card: the chosen hour's card in the dock, the open spot's light on
 * the chart, and here round a few words (a reply's name, "new"). A view has
 * one, two at most. It is a mark, not a control: nothing about it is pressed.
 */
export const liftStyles = tv({
  base: "relative inline-block -translate-y-px rounded-control bg-card paper-float px-1.5 py-0.5 shadow-float",
});

export interface LiftProps {
  children: ReactNode;
  className?: string;
}

/** Its children on a raised paper card: the one thing on the view that matters. */
export function Lift({ children, className }: LiftProps) {
  return <span className={liftStyles({ className })}>{children}</span>;
}
