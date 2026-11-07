/**
 * The site's missing page, for an address nothing answers: the usual top bar,
 * the search in it, one line and the two ways on. The same state the market's
 * and the community's missing pages draw (ui/Empty.tsx), so a wrong link looks
 * the same wherever it lands, in the rider's own theme.
 */
import { Compass } from "lucide-react";
import { CHART_HREF, FINDER_HREF } from "../../force5/src/siteNav";
import { usePageTitle } from "../../shared/web/usePageTitle";
import { Button, Empty } from "../../ui";
import { SpotFrame } from "./Frame";

export default function MissingPage() {
  usePageTitle("Page not found", "Wind map");
  return (
    <SpotFrame back={CHART_HREF}>
      <main>
        <Empty
          as="h1"
          title="That page does not exist"
          icon={<Compass size={24} strokeWidth={1.75} />}
          actions={
            <>
              <Button variant="primary" href={FINDER_HREF}>
                Spot finder
              </Button>
              <Button variant="quiet" href={CHART_HREF}>
                Chart
              </Button>
            </>
          }
        >
          <p className="m-0">The link may be old or mistyped.</p>
        </Empty>
      </main>
    </SpotFrame>
  );
}
