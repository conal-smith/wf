# Star-condition alerts

"Tell me when Brandon Bay is four stars or better on a Saturday between 09:00
and 18:00." A rider sets that up in the app (Alerts tab); wingfoil.ie checks
every new forecast against it and sends one push notification per window:

```
Brandon Bay ★★★★ Sat 14:00–17:00
WSW 18–22 kn, gusts 26. Your 5.0 m wing.
```

Tapping it opens the chart at that spot and hour.

```
alerts/
  shared/          used by the API and by the app
    protocol.ts    the wire types and limits, no dependencies
    schema.ts      the zod checks the API applies (held to protocol.ts)
    match.ts       which windows a rule matches, from rated hours
    time.ts        Irish local time: days, hours, quiet hours, DST
    copy.ts        the words of every notification and summary
  api/             mounted by market/api at /api/alerts
    router.ts      the HTTP surface
    evaluate.ts    the evaluator, the delivery, receipts, announcements
    forecast.ts    the published blend, rated per rider
    push.ts        Expo's push service
    repo*.ts       memory and Postgres stores
    migrations/    plain SQL, ledger alerts_migrations
mobile/src/features/alerts/   the app's side (sync, permission, preview)
```

## How it works

**The stars are the rider's.** A rating depends on weight, level and wings,
or the rider's own star rating where they set one (docs/STAR_RATINGS.md), so
each phone registers with its rider and the server rates for that rider. Riders who share settings share the work: each place is
rated once per rider per run.

**The forecast is the published blend**, `weather/blend.json` and its 2° spot
squares, rebuilt hourly — the same file the map's lights come from, read from
`FORECAST_BASE_URL`. The service cannot import the map's `src/spotBlend.ts`
(Vite and browser code; the API compiles as plain Node ESM), so
`api/forecast.ts` goes the same way through the dependency-free pieces the
site shares with the forecast server — the spot-square loader, the stars, the
sun — and `api/forecast.test.ts` holds it equal to `parseSpotBlend`,
`spotBlendHours` and `daylightOn`, value for value. A blend older than six
hours is not trusted, by the map or by alerts: nothing is sent from it.

**One matcher.** `shared/match.ts` decides what a rule matches; the API sends
from it and the app previews with it, on the same blend.

- A column of the forecast stands for the time until the next one (hourly
  near, three-hourly further out), never more than three hours, and only one
  hour before a column that is not rated. Columns are cut into Irish clock
  hours, so days, hours and the clock changes are read hour by hour.
- An hour qualifies when it is rated (daylight, with a forecast) at the
  rule's stars or more, on one of its days and inside its hours. Night is
  never rated, so never matches.
- A window is a run of at least `minHours` qualifying hours on one Irish day,
  no further ahead than `leadDays` days after today (1 = today and tomorrow).
- **Its stars are its weakest hour's**, what it can be relied on for, as the
  dock's `bestWindow` rates a window; the best hour's are its `peakStars`.
- One window per rule, spot and Irish day: the best (most stars, then longest,
  then earliest), with a count of the others.

**What a rider hears about a window** (rule + spot + Irish day):

| When                                                  | Sent                             |
| ----------------------------------------------------- | -------------------------------- |
| first forecast                                        | the window                       |
| moves more than 2 h, or its stars change              | an update, at most two           |
| no longer forecast, before it starts, rule asks       | "Off: …" (per rule, default off) |
| the rider changed the rule, switched it off, or dropped the spot | nothing; it is forgotten |
| four or more new windows due at once                  | one digest: "★★★★ at 5 spots"    |

**Quiet hours** (per phone, on by default): nothing is delivered from 22:00 to
07:00 Irish time. What is found then waits in the outbox until 07:00; a later
word on the same window replaces it, and a window that disappears before 07:00
is withdrawn without a word. A window that would only be delivered once it is
over is not sent.

**The evaluator** runs in the API process every 15 minutes where
`ALERTS_EVALUATE=1`, holding a Postgres advisory lock so that of several
instances one evaluates at a time; the outbox is claimed with
`FOR UPDATE SKIP LOCKED`, so a message is sent once even so. It reads the
blend's pointer and only does work when the run has changed or a device or
its rules have. Messages go to Expo's push service in batches of 100
(`EXPO_ACCESS_TOKEN` sent if set); a failed send is retried five minutes later,
up to five times. Receipts are read after 15 minutes; a `DeviceNotRegistered`
ticket or receipt clears that phone's token.

## Configuration

| Variable              | Where       | What                                                                                     |
| --------------------- | ----------- | ---------------------------------------------------------------------------------------- |
| `FEATURE_ALERTS`      | API         | `1` serves `/api/alerts`; otherwise it answers 404 `off`                                 |
| `ALERTS_EVALUATE`     | API         | `1` on the instance(s) that evaluate and send; others only store devices and rules      |
| `ALERTS_ADMIN_TOKEN`  | API, CI     | bearer token for `POST /api/alerts/announce`, 24 characters or more; unset, it answers 503 |
| `EXPO_ACCESS_TOKEN`   | API         | Expo access token, required once "enhanced push security" is on for the project         |
| `FORECAST_BASE_URL`   | API         | where `weather/blend.json` is read: the data host, `https://data.wingfoil.ie/`           |
| `EAS_PROJECT_ID`      | app build   | push tokens need it (app.config.ts → `extra.eas.projectId`); without it the app says push is not available on that build |

With `MARKET_DB=memory` everything is kept in memory (development and tests).
With Postgres the migrations in `api/migrations/` run at boot, under their own
ledger `alerts_migrations`.

## The API

All routes are under `/api/alerts`. Errors are `{ error, message, details? }`;
a validation failure is 400 with `details` keyed by field; a rate limit is 429
with `Retry-After`.

| Method | Path                   | Auth   | Purpose                                                              |
| ------ | ---------------------- | ------ | -------------------------------------------------------------------- |
| GET    | `/status`              |        | `{ enabled, evaluating, forecast }`                                  |
| POST   | `/devices`             |        | register: `DeviceRegistration` → 201 `{ device, secret }`, once       |
| GET    | `/devices/me`          | device | the device (never its token or secret)                               |
| PUT    | `/devices/me`          | device | any of token, rider, `quietHours`, `appUpdates`, version, variant, zone |
| DELETE | `/devices/me`          | device | forget the device, its rules and everything sent                     |
| GET    | `/devices/me/rules`    | device | `{ rules, updatedAt }`                                               |
| PUT    | `/devices/me/rules`    | device | `{ rules }`: the whole list, at most 20, replaced                    |
| GET    | `/devices/me/preview`  | device | each rule's coming windows, as the server evaluates them             |
| POST   | `/announce`            | admin  | an app-update note (below)                                           |

`device` is `Authorization: Device <deviceId>.<secret>`. There is no sign-in:
the secret, given once at registration and kept by the app in the
keychain/keystore, is the phone's only key. Registering a push token that
another device holds moves it to the new one. Limits: 10 registrations an hour
per address, 20 writes a minute (300 an hour) and 20 previews a minute per
device.

The types are in `shared/protocol.ts`. A rule:

```json
{
  "id": "r1",
  "name": "Brandon on a Saturday",
  "spots": ["brandon", "inch"],
  "minStars": 4,
  "days": ["sat", "sun"],
  "fromHour": 9,
  "toHour": 18,
  "minHours": 2,
  "leadDays": 3,
  "calledOff": false,
  "enabled": true
}
```

Hours are Irish local time; `toHour` is exclusive, and `0`–`24` is the whole
day. A notification's `data` is
`{ kind, path, spot, t, alertId }`, `path` being an in-app path the app routes
(`/?spot=brandon&t=2026-10-17T13:00:00.000Z`), so no URL scheme per build
variant is needed. Alerts go on the Android channel `alerts` (high
importance), app updates on `updates`.

### The announce contract (release pipeline)

After a production promote, the release workflow calls:

```sh
curl -fsS -X POST "$API_URL/api/alerts/announce" \
  -H "Authorization: Bearer $ALERTS_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"kind":"app-update","version":"1.4.0","platforms":["ios","android"]}'
```

| Field       | Required | Meaning                                                                 |
| ----------- | -------- | ----------------------------------------------------------------------- |
| `kind`      | yes      | `"app-update"`, the only kind so far                                    |
| `version`   | yes      | the store version just released, dotted numbers (`1.4.0`)               |
| `platforms` | no       | `["ios"]`, `["android"]` or both (the default)                          |
| `title`     | no       | up to 80 characters; default `Wingfoil 1.4.0`                           |
| `body`      | no       | up to 240; default "A new version is out. Update from the App Store." (or Google Play) |

It goes to production installs that turned **New versions** on, have a push
token, and are on an older version than `version`. Quiet hours hold it until
07:00; it is dropped after three days undelivered. Tapping it opens
`/settings/about`.

Answers: **202** `{ "queued": n, "already": false }` the first time for a
version; **200** `{ "queued": 0, "already": true }` for a version already
announced (safe to retry); 401 without the token; 503 when
`ALERTS_ADMIN_TOKEN` is not set on the API; 400 for a malformed body.

## Privacy

Kept per phone, with no name, email or account:

- a random device id and a SHA-256 of its secret;
- the app's random installation id, the Expo push token (cleared when Expo
  says the app is gone), platform, build variant, app version and time zone;
- the rider as the app sends it (weight if given, level, wing sizes, and
  their own star rating if they set one) and the two preferences;
- the rules (spot ids, stars, days, hours);
- per window told: rule, spot, day, the window's times and stars; notifications
  waiting to go; Expo ticket ids for a day.

**Deletion.** *Remove this phone* (Alerts tab) deletes the device row and,
with it, its rules, the windows it was told of, waiting notifications and
tickets (`DELETE /api/alerts/devices/me`), then forgets the secret on the
phone. A phone not heard from for 180 days is deleted the same way, windows
are forgotten a day after they end, and tickets after a day. Uninstalling the
app leaves the row until Expo reports the token dead (then nothing more is
sent) and the 180 days run out.

## Tests

`npm test` at the root runs `alerts/**/*.test.ts`: the matcher (DST, the night,
merging, dedupe), the copy, the evaluator end to end on a synthetic blend, the
router, and the store contract — against Postgres too when `DATABASE_URL` is
set, in a schema of its own. The app's side is in
`mobile/src/features/alerts/alertsLogic.test.ts` (`npm test` in `mobile/`).
