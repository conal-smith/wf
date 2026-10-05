/**
 * The page a section answers with while it is not open yet (see
 * force5/src/comingSoon.ts): its name, a line on what it will be, and the way
 * back to the wind map. `src/main.tsx` draws it in place of the section's own
 * bundle, so a closed section downloads nothing of itself.
 */
import { SiteMenu } from "../../force5/src/SiteMenu";
import { Button, Headline, headlineStyles } from "../../ui";
import { Masthead, MastheadMark, mastheadStyles } from "../../ui/Masthead";
import { tv } from "../../ui/tv";
import { usePageTitle } from "./usePageTitle";

const styles = tv({
  slots: {
    root: "flex min-h-dvh flex-col bg-ground paper-grain font-body text-prose text-ink antialiased",
    page: "mx-auto flex w-full max-w-form flex-1 flex-col px-safe-6 max-wide:px-safe-3",
    main: "flex flex-col items-start gap-5 pt-10 pb-12",
    lead: "m-0 font-body text-lead font-normal text-ink-2 italic",
  },
});

const SECTIONS = {
  market: {
    title: "Marketplace",
    mark: "Market",
    lead: "Buy and sell second-hand wings, boards and foils, from riders across Ireland.",
  },
  community: {
    title: "Community",
    mark: "Community",
    lead: "Ask questions, share your sessions and find people to ride with.",
  },
} as const;

export default function ComingSoon({
  section,
}: {
  section: keyof typeof SECTIONS;
}) {
  const s = styles();
  const words = SECTIONS[section];
  usePageTitle("Coming soon", words.title);
  return (
    <div className={s.root()}>
      <div className={s.page()}>
        <Masthead>
          <SiteMenu current={section} size="sm" ground="content" />
          <a
            href="/"
            className={mastheadStyles().brand()}
            aria-label="wingfoil.ie, wind map"
          >
            <MastheadMark section={words.mark} />
          </a>
        </Masthead>
        <main className={s.main()} data-coming-soon={section}>
          <Headline>
            {words.title}{" "}
            <em className={headlineStyles().soft()}>coming soon</em>
          </Headline>
          <p className={s.lead()}>{words.lead}</p>
          <Button variant="primary" href="/">
            Open the wind map
          </Button>
        </main>
      </div>
    </div>
  );
}
