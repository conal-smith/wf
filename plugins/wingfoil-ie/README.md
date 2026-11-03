# wingfoil.ie plugin

wingfoil.ie's forecast for an AI assistant: wind, waves and tides for every
wing foiling spot in Ireland, each hour rated in stars as the spot page rates
it. The plugin adds one thing, the wingfoil.ie MCP server at
`https://wingfoil.ie/api/mcp` (source in [`mcp/`](../../mcp)). It is public
and read-only, with no account and nothing to configure.

## Install

Claude Code:

```sh
claude plugin marketplace add slopsmith/wf
claude plugin install wingfoil-ie@wingfoil-ie
```

or, in a session, `/plugin install wingfoil-ie --marketplace slopsmith/wf`.

Codex:

```sh
codex plugin marketplace add slopsmith/wf
codex plugin add wingfoil-ie@wingfoil-ie
```

Any other MCP client takes the address directly; wingfoil.ie/ai has a button
for each chat app.

## Tools

| Tool                | What it answers                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------- |
| `find_wind`         | Where to go: spots ranked by their stars over a window, near a place or in chosen counties                  |
| `get_spot_forecast` | When to go: one spot hour by hour, with stars, shore, waves, tides, rain, light, warnings and water quality |
| `list_spots`        | Which spots there are, by county                                                                            |
| `forecast_sources`  | Which weather models are live and how fresh each run is                                                     |

Things worth asking:

- When's the next good session after work near me?
- Where's the best wing foiling in Ireland this Saturday, in daylight?
- Is Brandon Bay worth the drive tomorrow afternoon? Do the models agree?
- What's the tide doing at Dollymount when the wind picks up?

## Layout

One folder serves both apps. `.claude-plugin/plugin.json` is Claude's
manifest and `.codex-plugin/plugin.json` is Codex's; both point at the same
`.mcp.json`. The marketplaces that list it are `.claude-plugin/marketplace.json`
and `.agents/plugins/marketplace.json` at the root of the repository. What
goes into each app's own directory listing is in
[`docs/AI_PLUGIN_LISTING.md`](../../docs/AI_PLUGIN_LISTING.md).

Raise `version` in both manifests whenever the plugin's files change, or
installed copies keep the old ones. A change to the server's tools needs no
new version: the plugin only points at it.
