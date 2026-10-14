# The app

The wingfoil.ie forecast as a native app for iOS and Android, in `mobile/`
(Expo SDK 57, React Native, built and served by EAS). It draws the forecast
with the site's own code, so a fix to the stars or the blend reaches both.
[`mobile/AGENTS.md`](../mobile/AGENTS.md) says how the code is put together;
this page says how it is run, built, released and updated, which is the site's
release train ([RELEASES.md](RELEASES.md)) with one more artifact on it.

## Three apps

One codebase, three installs that live side by side on a phone. `APP_VARIANT`
picks one when the app is configured (`mobile/app.config.ts`); anything it does
not recognise is production, so a build nobody labelled is the one riders get.

| Variant | Name | Identifier | EAS build profile and channel | Who has it |
| --- | --- | --- | --- | --- |
| `development` | Wingfoil Dev | `ie.wingfoil.app.dev` | `development` | you, with `expo start` |
| `staging` | Wingfoil Staging | `ie.wingfoil.app.staging` | `staging` | TestFlight internal, Play internal testing |
| `production` | Wingfoil | `ie.wingfoil.app` | `production` | the App Store, Google Play |

The bundle never asks which it is: the app reads its identifier from the
binary (`src/config/variant.ts`), because one update runs on the staging app
and then, unchanged, on the production app. Staging reads production's forecast
data, as the staging site does: it is the app on trial, not the data.

## Running it locally

```sh
cd mobile
npm ci
APP_VARIANT=development npx expo run:ios       # or run:android; builds the dev client once
npx expo start                                 # afterwards: just the bundler
npm run ci                                     # typecheck, eslint, token lint, unit tests
npm run export:check                           # Metro bundles both platforms
```

`expo run:ios` needs Xcode (`run:android`, Android Studio); it generates the
native folders (`expo prebuild`, never edited or committed) and installs
Wingfoil Dev. A development build has over-the-air updates off, so the update
banner and *Check for updates* say so rather than doing anything. To try the
update code itself, make a staging build (`eas build --profile staging`), or
read `src/features/updates/updatesLogic.test.ts`, which is where its timing is
pinned down.

## Runtimes: what an update can reach

An over-the-air update is a JavaScript bundle and its assets. It can only run
on a binary whose native code it was built against, so each binary carries a
**runtime version** and EAS serves it only updates of the same runtime. Here
the runtime is a **fingerprint** (`runtimeVersion: { policy: "fingerprint" }`):
a hash of everything native, worked out by `@expo/fingerprint` from the native
modules in `package-lock.json`, the native parts of `app.config.ts`, the config
plugins and `eas.json`.

`mobile/fingerprint.config.js` leaves out what only tells the three apps apart
(name, identifier, scheme, icon, the EAS project, the version), so the staging
and production apps of one commit have **the same runtime**, and one update
serves both. It puts the major version back in, as t3code does: an update from
`2.x` never reaches a `1.x` binary that happens to share its native code.

```sh
cd mobile
APP_VARIANT=staging    npx expo-updates fingerprint:generate --platform ios | jq -r .hash
APP_VARIANT=production npx expo-updates fingerprint:generate --platform ios | jq -r .hash   # the same
```

iOS and Android have different fingerprints, so each nightly publishes two
update groups. `EAS_PROJECT_ID` counts too (it turns updates on in
`app.config.ts`), which is why CI computes the fingerprint with it set.

So a change ships one of two ways:

- **JavaScript only** (most changes): the fingerprint stays put, and the
  update reaches every binary already installed, with no store review.
- **Native** (a new native module, a config plugin, an `Info.plist` key, an
  Expo SDK upgrade): the fingerprint moves, and the train builds new store
  binaries. Riders get the change when they install the new binary; until then
  their app keeps running the last update of its own runtime. Pull requests
  say in CI's summary which kind they are (*App native change*).

## The train

The site's train, with the app's update as one more artifact built once and
promoted, never rebuilt.

```text
pull request / push to main ──► CI ─────── App: npm run ci, Metro bundles both platforms,
                                            fingerprints (and a PR's native change, advisory)

02:17 UTC ──► nightly ──► v2026.10.13-nightly.42 (prerelease, + mobile.json)
              CI gate (with the app), then the bundle published ONCE:
                eas update --branch v2026.10.13-nightly.42 --environment production
                one group per platform, on a branch no channel points at
              mobile.json: the groups, their runtimes, the store binaries that run them

dispatch "release" ──► Staging (app)
                         the branch checked: exactly the nightly's groups
                         channel staging ──► branch v2026.10.13-nightly.42
                         no staging binary for the runtime? eas build --profile staging
                           --auto-submit (TestFlight internal, Play internal), which
                           must come out with the update's runtime
                       Staging (the site and images, as before)
                       ──► v2026.10.13-rc.57 (+ mobile.json; staged.json says what
                           staging pointed and built)

          you try Wingfoil Staging (TestFlight / Play internal)

dispatch "promote" ──► Production
                         staged.json, mobile.json checked byte for byte
                         the branch checked again: exactly the groups staging ran
                         channel production ──► the same branch
                         app/latest.json written into the site, deployed with it
                         riders told (POST /api/alerts/announce)
                       ──► v2026.10.14 (+ mobile.json, latest.json)
                       Production (app binaries)
                         no production binary for the runtime? eas build
                           --profile production --auto-submit (App Store review,
                           Play production as a draft)
```

**Why production gets exactly what staging ran.** The nightly publishes the
bundle once, to an EAS branch named for the nightly that nothing else
publishes to. Staging and production are not given copies: their channels are
*pointed at that branch*. An EAS update group is immutable (its assets are
addressed by content), and before each channel moves the train checks that the
branch holds exactly the groups `mobile.json` recorded, each with the recorded
update id, runtime and commit (`mobile.mjs verify-update`). `mobile.json`
itself is hashed into `staged.json` at staging and checked at promote, like
`images.json` and `site.tar.gz`, and `staged.json` names the groups staging
pointed at. So the update production serves is the update staging served.

**One caveat about new binaries.** A binary embeds a bundle of its own, built
by EAS from the same commit with the same `EXPO_PUBLIC_*` settings, and an app
only switches to an update newer than what it already runs. A staging or
production binary built *after* the nightly therefore runs its embedded bundle,
not the nightly's update (same commit, same code, built twice), and picks up
the next nightly's update normally. Binaries that already existed, which is
every rider on a JavaScript-only release, run the nightly's update itself.

**What it skips, and when.** Every app step skips itself with a notice until
`EXPO_TOKEN` and `EAS_PROJECT_ID` exist, exactly as the site's deployment
waits for Cloudflare, so the site's train is untouched until then. A nightly
from before the app's train, or a candidate staged without the app, is
promoted without it, with a notice. A failed app update fails the nightly (it
is one of its artifacts); a failed announcement never fails a promote.

The logic is `scripts/release/mobile.mjs`, beside `release.mjs` and run from
the workflow's commit in the same way; its tests are
`tests/release-mobile.test.ts`.

## What tests what

| Check | Where | Catches |
| --- | --- | --- |
| `npm run ci` in `mobile/`: `tsc`, eslint (with the React Compiler rules), the design-token lint and its self-test, vitest | CI `mobile`, nightly gate | type errors, a raw colour or spacing, the forecast logic, the update timing (`updatesLogic.test.ts`) |
| `npm run export:check` (Metro, iOS and Android) | CI `mobile`, nightly gate | a bundle that cannot be built: what an update ships |
| Fingerprints in the job summary; *App native change* on pull requests | CI | a change that needs new store binaries |
| `eas update` | nightly | the bundle as EAS builds it, with production's EAS environment |
| `verify-update`, `check-built`, `verify-staged` | release, promote | a branch published to since, a binary that cannot run the update, files that differ from what staging recorded |
| You, on Wingfoil Staging | between release and promote | everything else |

There is no native compile in CI: EAS does that when a binary is needed, and
the fingerprint says when that is.

## How riders get an update

**Over the air, quietly.** The app looks for an update at launch (after
expo-updates' own start-up check, never holding the launch for the network:
`checkAutomatically: "ON_LOAD"`, `fallbackToCacheTimeout: 0`) and when it comes
back after 15 minutes or more away. One that is found is downloaded in the
background. The next time the rider leaves the app, it restarts into it, so
they come back to the new version without having seen anything. Settings,
favourites and alerts are on disk already, so nothing is lost.

**A banner, only if they stay.** If an update has been waiting for half an hour
of use (t3code's interval), a slip of paper at the top offers it: *Update
ready · It installs when you next leave the app* with *Later* and *Restart*.
It never appears over a gesture in progress: the dock's sheet being dragged
or the timeline being scrubbed hold it off. A roll back (see below) is applied
at once, but also never under the rider's finger.

**The store, when the native code moved.** At each promote the site gets
`app/latest.json`, describing per platform the runtime production's update
needs, the newest production binary in the store, and `MOBILE_MINIMUM_VERSION`
if set. The production app reads it at launch and on coming back (at most
every six hours). A binary on an older runtime that is behind the store gets
the same slip: *New in the App Store · Update*, linking to the App Store (by
its Apple ID) or Google Play (by `ie.wingfoil.app`), dismissed once per store
version. Below the minimum version the app is covered by a page that only
offers the store, for when an old app would draw a wrong forecast.

A new binary is advertised from the promote *after* the one that built it, and
not before `MOBILE_STORE_GRACE_HOURS` (48 by default) after it was built: it
has to clear review and be released in App Store Connect and the Play Console
first, and CI cannot see that happen. It is on the site rather than a release
asset because the app already reads the site (`siteUrl("app/latest.json")`,
`src/config/env.ts`), the site is public while the repository may not be, and
it changes at exactly the moment the site does: when production is promoted.
The release carries a copy for the record.

**Told, as well.** After the promote the train posts
`{ kind: "app-update", version, platforms, title, body }` to
`${ALERTS_API_URL}/api/alerts/announce`; the alerts API decides how riders
hear of it.

**About.** *More → About* (`/settings/about`) shows the version, build,
which app, its channel, runtime, the update it runs and when that was
published, and a visible *Check for updates* that goes Checking → Downloading
→ Restarting, or says Up to date. Tapping the version five times shows the
whole runtime and update ids, for a bug report.

### For feature code: holding updates

A gesture that must not be interrupted holds updates while it lasts:

```ts
import { holdUpdates, useUpdateHold } from "../updates/hold";

useUpdateHold(isDragging);          // the dock's sheet
const release = holdUpdates();      // or by hand: scrub start …
release();                          // … and scrub end
```

## Going back

Roll forward first: revert on main and ship it through the train, as for the
site. When production's app is broken now:

```sh
cd mobile
# Production back onto the branch it ran before (the previous release's mobile.json says which):
npx eas-cli@24.13.0 channel:edit production --branch v2026.10.12-nightly.40
# Or withdraw the newest update group on the branch production serves: the group before it is
# republished, or, if there is none, the apps go back to the bundle they shipped with:
npx eas-cli@24.13.0 update:rollback <group-id>
```

Moving the channel back works although the older branch's update is older
than the one riders run: EAS tags each update with its branch, and
expo-updates replaces an update from another branch whatever its date
(`LoaderSelectionPolicyFilterAware`). It arrives like any update, put in place
when the rider next leaves the app. A roll back directive from
`update:rollback` is applied at once instead. A branch only serves binaries of
its own runtime, so moving the channel to an older branch reaches only the
binaries that ran it. A binary in
the stores cannot be taken back: ship a new one (or, on Google Play, halt the
staged rollout). Like a by-hand image retag, a by-hand channel edit is not
recorded by the train: the next promote moves the channel again.

## One-time setup

Nothing here is needed for CI: the app's checks run as soon as the workflows
are on main. The release train's app steps wait for steps 1 to 3; store builds
for steps 4 and 5.

1. **EAS project.** `cd mobile && npx eas-cli@24.13.0 init` (account
   `sprintengine`, slug `wingfoil`), and copy the project ID. Then, in the
   project on expo.dev, **Environment variables**: `EAS_PROJECT_ID` (plain text)
   in all three environments (`development`, `preview`, `production`).
   `eas.json` cannot pass it, as EAS does not expand `$NAME` there, and
   `app.config.ts` refuses a store build without it. Put the app's
   `EXPO_PUBLIC_*` settings in `production` and `preview`, with the same
   values: `EXPO_PUBLIC_FORECAST_BASE_URL`, `EXPO_PUBLIC_SITE_URL`,
   `EXPO_PUBLIC_API_URL` and, optionally, `EXPO_PUBLIC_STAGING_API_URL` (each
   has a production default in `src/config/endpoints.ts`). The nightly's update
   is built with `production`'s; staging binaries with `preview`'s.
2. **A robot token.** expo.dev → account settings → *Access tokens* → a robot
   user with access to the project; its token is the `EXPO_TOKEN` secret.
3. **Channels.** Nothing to do: the train creates `staging` and `production`
   the first time it points them, and the build profiles write them into the
   binaries.
4. **Apple.** In App Store Connect create two apps, *Wingfoil*
   (`ie.wingfoil.app`) and *Wingfoil Staging* (`ie.wingfoil.app.staging`), and
   an App Store Connect API key (*Users and Access → Integrations*, App
   Manager). Then `cd mobile && npx eas-cli@24.13.0 credentials`, once for
   each of the two apps and profiles: let EAS create the distribution
   certificate and provisioning profiles, and upload the API key for
   submissions. Write each app's **Apple ID** (the number on its *App
   Information* page) into `mobile/eas.json`, `submit.staging.ios.ascAppId` and
   `submit.production.ios.ascAppId`, as strings: eas-cli reads this field as
   written, it does not expand `$NAME` there, and the train refuses to build an
   iOS binary it could not submit. Doing so changes the fingerprint once (it
   counts `eas.json`), so do it before the first release. Add your testers to
   the staging app's internal TestFlight group.
5. **Google.** In the Play Console create the two apps with the same
   identifiers. Google only lets a person upload an app's first build, so do
   one `eas build --profile staging --platform android` (and later
   `production`) by hand and upload the `.aab` in the console. Then create a
   Google Cloud service account with access to both apps and add its JSON key
   in `eas credentials` (Android → *Google Service Account*). Staging submits to
   the internal track; production to the production track as a **draft** that
   you release in the console.
6. **GitHub** (*Settings → Secrets and variables → Actions*):

   | Name | Kind | What |
   | --- | --- | --- |
   | `EXPO_TOKEN` | secret | the robot token (2) |
   | `EAS_PROJECT_ID` | variable | the project ID (1); also what CI's fingerprint is computed with |
   | `ASC_APP_ID` | variable | optional: the production app's Apple ID, for the App Store link in `app/latest.json` (default: `eas.json`'s) |
   | `ASC_APP_ID_STAGING` | variable | not read by the train: the staging app's Apple ID goes in `eas.json` (4) |
   | `ALERTS_API_URL` | variable | the alerts API, e.g. `https://api.wingfoil.ie/`; without it riders are not told |
   | `ALERTS_ADMIN_TOKEN` | secret | its admin token |
   | `MOBILE_MINIMUM_VERSION` | variable | optional: below this version the app requires the store update |
   | `MOBILE_STORE_GRACE_HOURS` | variable | optional: how long after a build the store banner waits (default 48) |

   `app/latest.json` is published with the site, so it needs Cloudflare Pages
   ([RELEASES.md](RELEASES.md), "One-time setup"); without it, it is on the
   release only and older binaries are not told about the store.

The EAS CLI the train runs is pinned (`EAS_CLI` in `release.yml`, used through
`expo/expo-github-action@v9`); `mobile.mjs` reads its JSON, so move the pin
deliberately and run a release by hand after.

## Costs and limits

- An `eas update` and the channel moves are seconds. A store build is 15 to 30
  minutes a platform on EAS, after a queue that is long on the free plan; the
  app jobs allow three hours. Builds only happen when the fingerprint moves.
- Each nightly leaves an EAS branch. They are small (EAS deduplicates assets)
  but are not pruned with the nightly releases; delete old ones with
  `eas branch:delete` when the list gets long.
- Not verifiable without an EAS account: the exact JSON of `eas update`,
  `eas build:list`, `eas branch:view` and `eas update:view` was read from
  eas-cli 24.13.0's source, not observed; the first nightly, release and
  promote with EAS configured should be watched.
