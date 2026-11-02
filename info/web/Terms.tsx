/**
 * The terms of use, at /terms: plain terms for a free forecast site and its
 * connection for AI apps (mcp/api/server.ts). The forecast is a guide and the
 * rider judges the water; the public endpoint is there to use fairly, with no
 * promise that it is always up; the code is AGPL-3.0-only (LICENSE) and the
 * data keeps the licences README.md credits; Irish law. Where the owner has a
 * decision to make, the page says so in a bracket marked OWNER, for the owner
 * to fill in before it is published.
 */
import { AI_HREF } from "../../force5/src/siteNav";
import { Heading, Link } from "../../ui";
import { List, P, Section, Strong, Updated } from "./parts";
import { REPOSITORY } from "./Support";

const LICENCE = `${REPOSITORY}/blob/main/LICENSE`;
const PLACES = `${REPOSITORY}/blob/main/data/locations/README.md`;

export function TermsPage() {
  return (
    <>
      <Heading
        level="page"
        lead="The terms for using wingfoil.ie, its forecast, and its connection for AI apps. In short: it is free, it is a guide, and you decide whether to go out."
      >
        Terms of use
      </Heading>
      <Updated>2 November 2026</Updated>

      <Section title="Who we are">
        <P>
          wingfoil.ie is run by [OWNER: the name of the person or organisation
          that runs the site, and the country it is based in]. In these terms,
          "we" and "us" mean them, and "you" means anyone who uses the site or
          its forecast, directly or through an app.
        </P>
        <P>
          By using wingfoil.ie, or an app that reads its forecast for you, you
          accept these terms. If you do not accept them, please do not use the
          site. We may change these terms. The date at the top says when they
          last changed, and the version in use is always the one on this page.
          [OWNER: say whether you will announce bigger changes anywhere, or
          leave this as it is.]
        </P>
      </Section>

      <Section title="The forecast is a guide, not a safety service">
        <P>
          <Strong>
            Wing foiling can be dangerous. You alone decide whether, where and
            when to ride.
          </Strong>
        </P>
        <P>
          The wind, waves, tides, currents, depths and weather on wingfoil.ie
          come from computer forecasts and measurements made by others. A
          forecast can be wrong, late or missing, and conditions on the water
          can change quickly and differ from one beach to the next. The stars
          are our own rating of the forecast for the weight and wings you set,
          not a promise that an hour will be good or safe. The depths and
          currents are a rough guide and must not be used to find your way on
          the water.
        </P>
        <List>
          <li>
            Always look at the water and judge the conditions yourself before
            and while you ride.
          </li>
          <li>
            Check the official warnings from Met Éireann and any local notices
            before you go out.
          </li>
          <li>
            Ride within your ability and your equipment's limits, and tell
            someone where you are going.
          </li>
          <li>
            In an emergency on the water in Ireland, call 112 or 999 and ask for
            the Coast Guard.
          </li>
        </List>
      </Section>

      <Section title="Riding places">
        <P>
          A place on wingfoil.ie is a place people ride, not a promise that you
          may launch there or that it is safe. Follow local rules and bye-laws,
          keep clear of swimmers and bathing areas, respect private land, and
          take care around wildlife.
        </P>
      </Section>

      <Section title="Using the forecast in an AI app">
        <P>
          You can add the forecast to an AI app from{" "}
          <Link href={AI_HREF}>Use with AI</Link>. The app is run by its own
          maker, under its own terms and privacy policy, not ours. The app reads
          our forecast, but it writes its own answers, and it can leave things
          out or get them wrong. Check anything important on wingfoil.ie itself,
          and on the water.
        </P>
      </Section>

      <Section title="Fair use of the forecast by apps and programs">
        <P>
          The forecast is open for any app or program to read, at
          https://wingfoil.ie/api/mcp, free and with no account. Please use it
          fairly:
        </P>
        <List>
          <li>
            do not send so many requests that the site slows down for others;
          </li>
          <li>
            do not try to break into the site or get around any limit we set;
          </li>
          <li>
            if you show our forecast to others, say that it comes from
            wingfoil.ie and keep the credits to its sources.
          </li>
        </List>
        <P>
          We may limit or block use that harms the site or other people's use of
          it. [OWNER: add a request limit here if you want to set one.]
        </P>
        <P>
          We offer the site and the forecast for free, and we cannot promise
          they will always be there. We may change, pause or stop any part of
          them, including the connection for apps, at any time and without
          notice.
        </P>
      </Section>

      <Section title="The code and the data">
        <P>
          The code that runs wingfoil.ie is free software. You may use, change
          and share it under the{" "}
          <Link href={LICENCE}>
            GNU Affero General Public License, version 3
          </Link>{" "}
          (AGPL-3.0-only). If you run a changed version for others to use over
          the internet, you must offer them its source code.
        </P>
        <P>
          The data the site shows keeps its own licence, and is credited where
          it is shown:
        </P>
        <List>
          <li>
            forecasts from Met Éireann, DWD, ECMWF, NOAA, Météo-France and the
            Marine Institute, whose surface currents are a rough guide and not
            for safety;
          </li>
          <li>
            Northern Ireland's tides from the Environment Agency's tide gauges
            (Open Government Licence v3.0) and the EOT20 ocean tide model
            (DGFI-TUM, CC BY 4.0);
          </li>
          <li>
            riding places from Fáilte Ireland (CC BY 4.0), OpenStreetMap (ODbL)
            and the <Link href={PLACES}>other sources we list</Link>;
          </li>
          <li>depths from EMODnet Bathymetry (CC BY 4.0);</li>
          <li>
            the map from OpenStreetMap's contributors, drawn by OpenFreeMap;
          </li>
          <li>
            satellite pictures that contain modified Copernicus Sentinel data.
          </li>
        </List>
        <P>
          If you reuse any of this data, follow its own licence. [OWNER: say
          whether others may reuse the site's own words, star ratings and
          pictures, and on what terms, or that they stay under copyright.]
        </P>
      </Section>

      <Section title="No guarantee, and the limits of our responsibility">
        <P>
          We provide wingfoil.ie free of charge and as it is, without any
          promise that it is accurate, complete, up to date or available. As far
          as the law allows, we are not responsible for any loss, damage or
          injury that comes from using the site or its forecast, or from relying
          on it, including through an AI app.
        </P>
        <P>
          Nothing in these terms limits a responsibility that the law does not
          allow us to limit, such as for death or personal injury caused by our
          negligence, or for fraud, and nothing in them takes away your rights
          as a consumer.
        </P>
      </Section>

      <Section title="Links to other sites">
        <P>
          The site links to other sites, such as GitHub, the AI apps and the
          sources of our data. We do not run them and are not responsible for
          them.
        </P>
      </Section>

      <Section title="The law">
        <P>
          These terms are governed by the law of Ireland, and the courts of
          Ireland deal with any dispute about them. If you live elsewhere in the
          European Union, you keep the protection the law of your own country
          gives you as a consumer.
        </P>
      </Section>
    </>
  );
}
