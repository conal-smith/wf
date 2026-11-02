# Listing the plugin in the AI apps' directories

The wingfoil.ie plugin ([`plugins/wingfoil-ie`](../plugins/wingfoil-ie)) can
already be installed from this repository's own marketplaces. To have it
listed in Anthropic's directory (claude.ai, Cowork and Claude Code) and in
OpenAI's (ChatGPT and Codex), it is submitted through each one's developer
portal while signed in to the owner's account. Neither takes a pull request.
This page has what each portal asks for, ready to paste.

## Still needed before submitting

- **Privacy policy, terms of service and support pages** on wingfoil.ie.
  OpenAI requires all three for a plugin with an MCP server, and Anthropic's
  listing shows them. Once the pages are up, add their addresses to both
  manifests: `privacyPolicyUrl`, `termsOfServiceUrl` and `supportUrl` in
  `.claude-plugin/plugin.json`, and `privacyPolicyURL` and
  `termsOfServiceURL` in the `interface` of `.codex-plugin/plugin.json`.
- **A demo video** (OpenAI): a short screen recording of the plugin in use,
  for example the first two test cases below, uploaded somewhere with a
  public link.
- **Domain verification** (OpenAI): the portal gives a token to serve as
  plain text at `https://wingfoil.ie/.well-known/openai-apps-challenge`.
  Add it under `public/.well-known/` and release before you continue in the
  portal.
- **Organisation verification** (OpenAI), to publish under the name
  wingfoil.ie: Settings ▸ Organization ▸ General on the OpenAI Platform.

## Anthropic

Submit at claude.ai/directory/manage (needs a paid claude.ai plan). Point it
at this repository and the plugin's folder, `plugins/wingfoil-ie`. The
listing reads its name, description, icon and links from
`.claude-plugin/plugin.json`. Check it first with:

```sh
claude plugin validate --strict plugins/wingfoil-ie
```

The portal can also list the MCP server on its own as a connector, for
people who add connectors rather than plugins. Its address is
`https://wingfoil.ie/api/mcp`; it needs no sign-in.

## OpenAI

Submit at platform.openai.com/plugins, "Upload new or existing plugin", using
the "With MCP" flow. Upload a ZIP of the plugin's folder:

```sh
cd plugins && zip -r ../wingfoil-ie.zip wingfoil-ie
```

Authentication is **none**. The listing text comes from the `interface` in
`.codex-plugin/plugin.json`:

| Field             | Value                          |
| ----------------- | ------------------------------ |
| Display name      | wingfoil.ie                    |
| Short description | Wind forecasts for Irish spots |
| Developer         | wingfoil.ie                    |
| Category          | Travel                         |
| Website           | https://wingfoil.ie/           |

### Test cases

OpenAI asks for five prompts that should use the plugin and three that
should not.

**Should use it**

1. _When's the next good session after work near Dublin this week?_
   Tools: `find_wind` (near Dublin), then `get_spot_forecast` if it looks
   closer at one spot. Expected: one or more Dublin-area spots with the local
   times of their best windows before last light, their stars, wind and
   gusts in knots, and any warning or offshore wind called out.
2. _Where's the best wing foiling in Ireland this Saturday, in daylight?_
   Tools: `find_wind`. Expected: a ranked shortlist of spots with each one's
   best session on Saturday in local time, ending by last light, crediting
   the weather models.
3. _Is Brandon Bay worth the drive tomorrow afternoon? Do the models agree?_
   Tools: `get_spot_forecast` (Brandon Bay, tomorrow afternoon). Expected: a
   yes or no from the hourly stars, the wind against the shore, and how
   closely the models agree, hedged where they don't.
4. _What's the tide doing at Dollymount when the wind picks up tomorrow?_
   Tools: `get_spot_forecast` (Dollymount). Expected: the hour the wind
   rises and the high and low tides around it, in local time.
5. _Which weather models is wingfoil.ie using right now, and how fresh are
   they?_ Tools: `forecast_sources`. Expected: the live models, when each run
   was made, and any that are stale.

**Should not use it**

1. _What's the weather in Barcelona this weekend?_ Not Ireland, and not a
   wing foiling question: the plugin has no forecast there.
2. _Book me a wing foiling lesson in Galway._ The plugin only reads
   forecasts; it books nothing.
3. _Explain how a hydrofoil generates lift._ General knowledge, with no
   place or time to forecast.

## After it is listed

A change to the server's tools reaches every listing without a new
submission: both apps read the tools from the server. A change to the
plugin's own files (name, description, icon, links) needs `version` raised
in both manifests and a new version submitted in each portal.
