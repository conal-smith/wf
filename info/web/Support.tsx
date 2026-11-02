/**
 * Help and support, at /support: how to report a problem or ask a question
 * (the repository's issues), how to report a security problem privately
 * (SECURITY.md), and what adding the forecast to an AI app means and where
 * to do it (/ai). The address an app asks for is the endpoint
 * mcp/api/server.ts serves, as ai/web/install.ts writes it.
 */
import { AI_HREF, STARS_HREF } from "../../force5/src/siteNav";
import { Heading, Link, Row, Rows } from "../../ui";
import { List, P, Section, Strong, Updated } from "./parts";

export const REPOSITORY = "https://github.com/slopsmith/wf";
export const ISSUES = `${REPOSITORY}/issues`;
export const NEW_ISSUE = `${ISSUES}/new`;
export const SECURITY_REPORT = `${REPOSITORY}/security/advisories/new`;
export const SECURITY_POLICY = `${REPOSITORY}/blob/main/SECURITY.md`;
/** What an AI app asks for when it is added by hand. */
export const AI_ADDRESS = "https://wingfoil.ie/api/mcp";

export function SupportPage() {
  return (
    <>
      <Heading
        level="page"
        lead="How to get help with wingfoil.ie, tell us about a problem, or add the forecast to your AI app."
      >
        Help and support
      </Heading>
      <Updated>2 November 2026</Updated>

      <Section title="Report a problem or ask a question">
        <P>
          wingfoil.ie is built in the open, on GitHub. The best way to reach us
          is to open an issue there: a short public note that we read and
          answer. You need a free GitHub account to write one.
        </P>
        <Rows>
          <Row
            inList
            href={NEW_ISSUE}
            title="Report a problem"
            detail="Open a new issue on GitHub"
            chevron
          />
          <Row
            inList
            href={ISSUES}
            title="See what others have reported"
            detail="Your problem may already be known, with an answer"
            chevron
          />
        </Rows>
        <P>It helps us most when you tell us:</P>
        <List>
          <li>which page you were on, and which spot, if any;</li>
          <li>what you expected to see, and what you saw instead;</li>
          <li>
            the phone or computer and the browser you use, and a screenshot if
            you can.
          </li>
        </List>
        <P>
          <Strong>Issues are public.</Strong> Anyone can read them, so do not
          put your email address, phone number or anything else personal in one.
        </P>
        <P>
          [OWNER: say whether there is another way to reach you for people
          without a GitHub account, for example an email address, or say there
          is none.]
        </P>
      </Section>

      <Section title="Report a security problem">
        <P>
          If you find a weakness in the site, please do not open a public issue.
          Report it privately instead, using{" "}
          <Link href={SECURITY_REPORT}>Report a vulnerability</Link> on GitHub.
          Our <Link href={SECURITY_POLICY}>security policy</Link> says what to
          include and what is covered. You will get an answer within a week.
        </P>
      </Section>

      <Section title="Add the forecast to your AI app">
        <P>
          You can add wingfoil.ie to an AI chat app, such as ChatGPT or Claude.
          Then you can ask the app where and when to ride, and it reads the same
          forecast as this site: the wind, the gusts, the tide and every spot's
          stars. It is free, it only reads the forecast, and it needs no
          account.
        </P>
        <P>
          <Link href={AI_HREF}>Use with AI</Link> adds it to your app in a tap
          or two. If your app asks for an address, give it this one:{" "}
          <Strong>{AI_ADDRESS}</Strong>. Some apps call what you are adding a
          connector, an integration or a plugin.
        </P>
        <P>
          If your app cannot reach wingfoil.ie, or tells you something that does
          not match the site, report it as above and say which app you use.
        </P>
      </Section>

      <Section title="Questions about the forecast">
        <P>
          <Link href={STARS_HREF}>How the stars work</Link> explains how we rate
          each hour for your weight and wings. About the map, in the site menu,
          says where the forecast comes from.
        </P>
        <P>
          The forecast is a guide, not a safety service. Always look at the
          water and judge the conditions yourself before you go out.
        </P>
      </Section>
    </>
  );
}
