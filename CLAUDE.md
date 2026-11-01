# Wingfoil: notes for agents

## What may be published

This repository is public, and so is everything on GitHub around it: files,
commit messages, branch names, pull request titles and descriptions, issues
and comments. GitHub keeps the history of every edit, so a slip cannot be
edited away.

**No personal information.** No real machine or host names, tailnet names or
ids, Tailscale or LAN addresses, links to servers on the owner's machines,
home-directory paths, email addresses, phone numbers or postal addresses.
Placeholders: `tail1234.ts.net`, `mac-mini`, `build-box`, `/Users/dev/...`,
`dev@example.com`. To show a mock-up in a pull request, give its path in the
repository and how to open it (`npx vite`, then the path); a link to a
private server belongs in chat only.

**No competitors.** Do not name other forecast products or services: every
wind, surf, wave and weather forecast site or app, and the forums run by them.
This file names none, on purpose. Describe the idea itself instead. Not "a
narrow list beside the map, as <some site> does", but "a narrow list beside a
plain map". In research, write "one popular forecast site" rather than its
name, and leave out links to it. Data sources (ECMWF, Met Éireann,
Open-Meteo and the like) and the tools the site is built with are not
competitors.

The pull request workflow (`.github/workflows/pull-request.yml`) runs
`scripts/publication-check.mjs` over the title, the description, every commit
message and every added line. It finds tailnets, Tailscale addresses, home
paths and email addresses by their shape, and the competitors' names and the
owner's own details from the `PUBLICATION_DENYLIST` repository secret, one
regular expression per line, so that they are never written down here.

## Commits and pull requests

Every commit message and every pull request title is a
[Conventional Commit](https://www.conventionalcommits.org):

    type(scope)!: summary

- `type` is one of `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`,
  `build`, `ci`, `chore`, `revert`. `(scope)` is optional, lower case (for
  example `spot`, `finder`, `chart`, `e2e`, `satellite`); `!` marks a breaking
  change.
- The summary is in the imperative, at most 100 characters for the whole
  line, with no full stop.
- Pull requests are squash-merged, and the title becomes the commit on `main`.

The pull request workflow (`.github/workflows/pull-request.yml`, running
`scripts/conventional-commits.mjs`) fails a pull request whose title or
commits do not follow this. Merge commits from bringing `main` into a branch
are exempt.
