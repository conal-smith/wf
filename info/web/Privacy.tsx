/**
 * The privacy policy, at /privacy: what the site does with a visitor's data,
 * as the code does it, and nothing it does not.
 *
 * - No cookies, analytics, adverts or sign-in in the production build: the
 *   marketplace, the community, the Gust chat and accounts are switched off
 *   there (shared/web/features.ts; no VITE_FEATURE_* in the release build).
 * - What the browser keeps, in localStorage: the theme (shared/web/theme.ts),
 *   the settings and the rider (force5/src/prefs.ts), starred and recent spots
 *   (shared/web/favourites.ts), the place "Use my location" found
 *   (src/finder/location.ts), the map's last view and layers (src/lastView.ts,
 *   src/App.tsx) and the tour (src/tourOffer.ts). None of it is sent.
 * - Requests: the site and its forecast files on Cloudflare, the map's tiles
 *   and lettering from OpenFreeMap (force5/src/chartStyle.ts). Fonts and
 *   logos are the site's own.
 * - The AI connection (mcp/api/server.ts) keeps no session and writes no log
 *   of its own; WebMCP (mcp/web/webmcp.ts) hands an agent in the visitor's
 *   own browser their starred and recent spots, and sends nothing to us.
 * - The phone app (mobile/) and its alerts (alerts/) are described for when
 *   the app is out; the retention is alerts/api/repo-pg.ts `prune`.
 *
 * What the code cannot say (who is responsible, how to reach them, what is
 * switched on in Cloudflare's dashboard) is in brackets marked OWNER, for
 * the owner to fill in before the page is published.
 */
import { AI_HREF } from "../../force5/src/siteNav";
import { Heading, Link } from "../../ui";
import { List, P, Section, Strong, Updated } from "./parts";

/** Ireland's data protection authority, where anyone can complain. */
const DPC = "https://www.dataprotection.ie";

export function PrivacyPage() {
  return (
    <>
      <Heading
        level="page"
        lead="What wingfoil.ie knows about you, which is very little. Your settings stay on your phone or computer, and there are no accounts, adverts or tracking."
      >
        Privacy
      </Heading>
      <Updated>2 November 2026</Updated>

      <Section title="In short">
        <List>
          <li>You do not need an account, and you cannot sign in.</li>
          <li>
            We use no cookies, no adverts and no analytics or tracking tools.
          </li>
          <li>
            Your settings, your starred spots and your location stay on your own
            device. We never receive them.
          </li>
          <li>
            Like every website, the companies that deliver the site and its map
            see the technical details of each request, such as your IP address.
            They are named below.
          </li>
        </List>
      </Section>

      <Section title="Who is responsible">
        <P>
          wingfoil.ie is run by [OWNER: the name and postal address of the
          person or organisation responsible for the site, which is the "data
          controller" in data protection law]. For any question about your
          privacy, contact [OWNER: a contact for privacy questions, for example
          an email address].
        </P>
      </Section>

      <Section title="What stays on your device">
        <P>
          To remember your choices from one visit to the next, the site saves
          them in your browser's own storage on your phone or computer. This is
          not a cookie, and nothing in it is sent to us or to anyone else. It
          holds:
        </P>
        <List>
          <li>whether you chose the light or the dark look;</li>
          <li>
            your settings, such as units and forecast models, the map's layers,
            and the last place you looked at on the map;
          </li>
          <li>
            your weight, wing sizes and your own star ratings, if you set them;
          </li>
          <li>
            the spots you starred, and the spots you opened most recently, up to
            60, so the site can show your usual spots first;
          </li>
          <li>your location, if you pressed "Use my location";</li>
          <li>whether you have already seen the tour of the site.</li>
        </List>
        <P>
          To remove all of it, clear this site's data in your browser's
          settings. The site then starts again as it was on your first visit.
        </P>
      </Section>

      <Section title="Your location">
        <P>
          The site only asks for your location when you press "Use my location",
          and your browser asks for your permission first. Your location is used
          on your device to put the nearest spots first and to show where you
          are on the map. It is never sent to us. You can take the permission
          back at any time in your browser's settings.
        </P>
        <P>
          As with any online map, the pieces of the map for the area you are
          looking at are downloaded from OpenFreeMap (see below), so they show
          which part of the map you are viewing, but not who you are.
        </P>
      </Section>

      <Section title="Who handles your requests">
        <P>
          When you open a page, your browser asks these companies for it. Each
          of them receives your IP address (the number that identifies your
          internet connection), your browser's name and version, and the address
          of what it asks for, because that is how the internet delivers a page.
        </P>
        <List>
          <li>
            <Strong>Cloudflare</Strong> hosts the site, the forecast files and
            the connection for AI apps, and protects them from attacks.
            Cloudflare may keep records of requests for a short time for
            security and to keep the service running. [OWNER: check in the
            Cloudflare dashboard whether Web Analytics, Logpush or any other
            logging is switched on for wingfoil.ie and its data host, say how
            long any logs are kept, and confirm how Cloudflare's data processing
            terms cover transfers outside the European Economic Area.]
          </li>
          <li>
            <Strong>OpenFreeMap</Strong> supplies the map itself: its tiles and
            the lettering of its place names. Its map data comes from
            OpenStreetMap.
          </li>
        </List>
        <P>
          The site's fonts, logos and pictures come from wingfoil.ie itself, not
          from other companies.
        </P>
      </Section>

      <Section title="Using wingfoil.ie in an AI app">
        <P>
          When you add wingfoil.ie to an AI app from{" "}
          <Link href={AI_HREF}>Use with AI</Link>, your conversations happen in
          that app, under its own maker's privacy policy, not ours. When you ask
          about the wind, the app asks our forecast for the spots, times and
          conditions it needs. It may also send a county or a place to search
          near, which can be where you are, if you told the app.
        </P>
        <P>
          We do not keep these questions: the connection keeps no record of who
          asked what, and it needs no account. Cloudflare handles each request
          as described above.
        </P>
        <P>
          Some browsers let an AI assistant work inside the page you have open.
          In those browsers, the site lets that assistant read the forecast, the
          spot you have open, and your starred and recent spots, so you can ask
          it about "my spots". This happens inside your own browser, and nothing
          about it is sent to us.
        </P>
      </Section>

      <Section title="When you contact us">
        <P>
          If you report a problem on GitHub, as our support page suggests,
          GitHub's own privacy statement applies, and what you write there is
          public. [OWNER: if you add another way to contact you, such as email,
          say what you keep from those messages and for how long.]
        </P>
      </Section>

      <Section title="Parts of the site that are not open yet">
        <P>
          The code for wingfoil.ie includes a marketplace for second-hand gear,
          a community forum, accounts and a chat assistant. None of these is
          open on wingfoil.ie today, and none of them collects anything. If we
          open any of them, we will update this policy first to say what it
          keeps and why.
        </P>
      </Section>

      <Section title="The phone app">
        <P>
          The wingfoil.ie phone app is not available yet. When it is, it will
          keep your settings and starred spots on your phone, just as the site
          does, and will ask for your location only to find the spots near you.
        </P>
        <P>
          If you turn on wind alerts in the app, our alert service keeps what it
          needs to send them: a random code for your phone (no name or email),
          the address your phone's notification service gives it, your phone's
          time zone and type, the app's version, your alert rules, and your
          weight, wings and star settings. Alerts are delivered through Expo's
          notification service and Apple's or Google's. Choosing "Remove this
          phone" in the app deletes all of it at once, and we delete a phone's
          data by ourselves once it has not been in touch for 180 days. [OWNER:
          confirm this, and name the company that hosts the alert service,
          before the app is released.]
        </P>
      </Section>

      <Section title="Why we may handle your data">
        <P>
          The only personal data we handle is the technical detail of each
          request described above. We handle it because it is needed to deliver
          the site and keep it safe, which is in our legitimate interest and in
          yours. We do not sell it, share it for advertising, or use it to build
          a profile of you.
        </P>
      </Section>

      <Section title="Your rights">
        <P>
          Under data protection law, you can ask us what personal data we hold
          about you, and ask us to correct it, delete it or stop using it. Since
          we hold almost nothing that could identify you, there is usually
          nothing to send, but we will always answer. If you are not happy with
          our answer, you can complain to Ireland's{" "}
          <Link href={DPC}>Data Protection Commission</Link>.
        </P>
      </Section>

      <Section title="Children">
        <P>
          The site is for anyone interested in wing foiling. It does not ask for
          anyone's age, name or contact details, and so it collects none from
          children.
        </P>
      </Section>

      <Section title="Changes to this policy">
        <P>
          If what the site does with data changes, we will change this page
          before it happens. The date at the top says when it last changed.
        </P>
      </Section>
    </>
  );
}
