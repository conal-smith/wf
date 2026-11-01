import { Check, CircleAlert, LoaderCircle } from "lucide-react";
import type { ToolActivity } from "../shared/protocol";
import { COMPANION_NAME } from "../shared/protocol";

/** What Gust looked up for this answer: running, done or failed. */
export function ToolChips({ tools }: { tools: ToolActivity[] }) {
  if (!tools.length) return null;
  return (
    <ul
      className="m-0 flex list-none flex-wrap gap-1 p-0"
      aria-label={`What ${COMPANION_NAME} looked up`}
    >
      {tools.map((tool) => (
        <li
          key={tool.id}
          data-status={tool.status}
          className={[
            // The kit's tag (ui/Tag): a word in a soft capsule, the pen's red
            // on its tint for a lookup that failed.
            "inline-flex h-5.5 max-w-full items-center gap-1.5 rounded-full px-2 font-body text-label font-medium",
            tool.status === "error"
              ? "bg-warn-ground text-pen-ink"
              : "bg-sunken text-ink-2",
          ].join(" ")}
          title={tool.summary}
        >
          {tool.status === "running" ? (
            <LoaderCircle
              size={12}
              strokeWidth={1.75}
              className="gust-spin shrink-0"
              aria-hidden="true"
            />
          ) : tool.status === "done" ? (
            <Check
              size={12}
              strokeWidth={1.75}
              className="shrink-0 text-ok"
              aria-hidden="true"
            />
          ) : (
            <CircleAlert
              size={12}
              strokeWidth={1.75}
              className="shrink-0"
              aria-hidden="true"
            />
          )}
          <span className="truncate">
            {tool.status === "done" && tool.summary ? tool.summary : tool.label}
            {tool.status === "running" && "…"}
          </span>
          <span className="sr-only">
            {tool.status === "running"
              ? " (in progress)"
              : tool.status === "error"
                ? " (didn't work)"
                : " (done)"}
          </span>
        </li>
      ))}
    </ul>
  );
}
