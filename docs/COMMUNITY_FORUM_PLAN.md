# Community: plan

A forum inside wingfoil.ie, shaped like a chat community rather than a vote-ranked link board:
the site sets up channels, members start threads in them, and a thread is one
flat, live conversation. It runs on the marketplace's backend (Hono, Postgres,
Clerk) and is drawn with the Force5 design system.

Status: **proposal, nothing built.** Mockups are in `docs/community-mockups/`
(`index.html`, screenshots in `shots/`, rebuilt from the real bundle CSS with
`node docs/community-mockups/build.mjs`). Revised 20 September 2026 after the
review: every channel is set up by the site, sort options dropped, the
right-hand panel dropped entirely, following and notifications designed, a
first iteration scoped.

**The rule that came out of review: leave it out unless the forum is broken
without it.** Each thing cut below was cut because it was a second system to
build and keep running, not because it was a bad idea.

---

## 0. The first iteration

The smallest thing that is honestly a forum. The mockups show this and nothing more.

**In**

- Two columns: the channel rail and the conversation. No side panel.
- The channels of section 2, all set up by the site.
- Threads and flat replies: reply-to, photos, a fixed set of emoji reactions,
  edit and delete your own, one order (most recent activity first), tags as the
  only filter. Thread and follower counts on a channel.
- Following and notifications as in section 3: threads (automatic) and channels
  (by choice), @mentions, the bell. **In the page only. The forum sends no email
  at all**, so there is no email provider to choose or run.
- Replies arriving live in the thread you have open.
- A spot on a thread, picked from the spots the map already has (section 4).
- Reading signed out; posting through Clerk. One account and one profile for
  the whole site: the name and avatar on your listings are the ones on your posts.
- The safety floor: report (which lands in your bell), staff can remove, lock
  and pin in place, rate limits, new-member limits. No moderator screens.
- Search over titles and bodies (Postgres full text; an index, not a feature).

**Cut in review, and what would bring each back**

| Cut | Why | Comes back when |
| --- | --- | --- |
| Requesting a spot, from the forum or the map | A form, storage, a way to reach you, and a review habit: a feature of the map, not of the forum | Planned on its own, as map work |
| Channels for schools and clubs | An organisation's channel needs that organisation's say-so, and someone to set it up with them | One asks |
| Members starting channels | Permissions, limits, archiving, a browse page | The site's channels are busy and people ask |
| Blowing now | A second consumer of forecast data, with its own rules for which spots | There is a reason beyond decoration |
| Here now, and who is online | Presence tracking for a list nobody needs | Probably never as a list; a count, above 10 |
| Role badges (Coach, Team, local) | A roles-and-badges admin surface | There are staff besides you |
| "Before you post" guidance | Per-channel content to write and maintain; a pinned thread does the job | Not needed |
| Related threads | A similarity query to tune, for a box few people read | Search exists and the archive is large |
| Sort options | Three more queries and indexes | A channel is too busy for one order |
| Typing, marked-helpful, Market cards in messages | Each small, none essential | After launch, in that order |
| Email to members, digests | Templates, unsubscribe, deliverability | People say they miss replies |
| Advertising | Section 9: a sponsored thread, when the time comes | There is an audience to sponsor |

Roughly three weeks: foundations 3 days, read and write 6, following and live 4,
safety 2, spot on a thread 1.

---

## 1. The shape, and why

| | Vote-ranked forum | Chat community | **What we build** |
| --- | --- | --- | --- |
| Containers | Boards anyone creates | Channels in categories, admins create | Channels in categories, set up by the site |
| Unit of conversation | Post | A titled thread | Thread, started by any signed-in member |
| Replies | Nested tree, ranked by votes | Flat, in time order, with reply-to | Flat, in time order, with reply-to |
| Signal | Up and down votes, karma | Emoji reactions | Emoji reactions |
| Feel | Archive you search | Room you are in | Room you are in, that a search engine can still read |
| List order | Hot ranking | Last activity | Last activity |

What we keep from the archive model, because a chat log loses it: every thread
has a public URL and is readable signed out, and tags filter a channel.

**On the two counts.** "412 threads · 640 following" is the classic-forum pair,
and it is nearly free: both are counters we keep anyway. Site-wide, the member
count appears once there are 50 members, so it never advertises an empty room.
("Here now" was cut; if it returns it is a count, shown only above 10.)

What we deliberately leave out: voting and karma (a popularity contest in a
community where everyone knows everyone), nested trees, auto-archiving (old spot
threads are exactly the evergreen pages we want), voice, DMs.

**The empty room is the real risk**, not the feature list. The answers to it are
all honest ones: the home page is one feed across every channel, so a little
activity reads as one room rather than ten empty ones; reply counts of zero are
hidden; the member count waits until there are 50; and there are few channels.
**Nothing is seeded** (section 11): an empty channel says "No threads yet. Start
the first one." and means it.

## 2. Channels

The layout: categories that collapse, channels inside them. **Every
channel is set up by the site**, and every channel is open: any signed-in member
can start a thread anywhere except announcements.

| Category | Channels at launch | Who starts threads |
| --- | --- | --- |
| **Community** | announcements, general | Staff only in announcements (anyone replies); anyone in general |
| **Gear** | wings, boards, foils | Anyone |
| **Riding** | spots-and-conditions, sessions, technique | Anyone |
| **Social** | meetups, off-topic | Anyone |

Ten channels. Adding one is a row in a table, done by you; there is no screen
for it. Add one only when an existing channel is visibly doing two jobs.

Not in the first iteration, both designed and set aside:

- **Channels for organisations** (a school posting its sessions, only it
  starting threads). A company's name on a channel needs that company's
  permission and someone to set it up with them. When one asks, it is a
  `post_policy` value and a small table of who may post; nothing else changes.
- **Members starting their own channels.** A permissions system, a limits
  system and an archive, for a problem the site does not have yet.

## 3. Following, mentions and notifications

Three different things that are easy to blur:

| | What it is | How you get it |
| --- | --- | --- |
| **Following a thread** | You are told about replies | Automatically, when you start it or reply to it. Or the Follow button. |
| **Following a channel** | You are told about *new threads*, never every reply | Your choice. Automatic for a channel you start. |
| **A mention** | Someone typed `@you` | Always reaches you, unless you muted that thread or blocked that member |

Following a **member** (told when they start a thread) and following a **spot**
(told when a thread links it) use the same table and the same fan-out. They are
deliberately left out of the first iteration: member-follow brings follower
counts and a social graph the community does not need on day one.

**Per thread, three levels**, in a menu on the thread's Following button: every
reply, mentions only, nothing. Replying sets "every reply" unless you had chosen otherwise. One
setting in your profile turns automatic following off for people who find it loud.

**Mentions.** Typing `@` suggests the people in this thread first, then members
by handle. Stored as `<@user_id>`, so a rename does not break it. At most five
per message. No `@everyone`; staff alone get `@channel`, in announcements alone.
New members cannot mention until their first few messages have stood.

**The bell** (mockup 6) is the inbox, and it is what makes following bearable:

- Replies are **grouped per thread**: "Tomás B and Niamh R replied · 4 new", one
  row, updated in place, not four rows.
- A mention always gets its own row, with the line that mentions you.
- A followed channel produces "Pádraig D started *Autumn meet-up: Rush South…*".
- Reactions to your messages are grouped and quiet: they appear in the list
  and never raise the count.
- Opening a thread clears its rows. "Mark all read" clears the rest.

**The pages.** *Following* is the feed of threads you follow plus new threads in
channels you follow, most recent activity first, each row saying why it is
there ("You replied", "You follow this channel"). *Mentions* is every message
that mentions you, newest first. Both are the home feed's query with a filter.

**How a notification reaches you: inside the site, and only there.** No email
to members, no push. Concretely:

1. When a reply is saved, the same database transaction writes the
   notification rows: one per follower of the thread, one per person mentioned.
   There is no queue, no worker and no second service; it is two more `insert`
   statements in the handler that already saves the message.
2. The bell asks `GET /notifications/count` when a page loads, when the tab
   regains focus, and once a minute while it is open. That is the whole delivery
   mechanism. A reply shows on your bell within a minute, which is as live as a
   forum needs.
3. Opening the bell fetches the list. Opening a thread marks its rows read.

The one thing that *is* pushed live is new replies in the thread you are
looking at (section 6.4), because watching a conversation and having to refresh
it is what makes a forum feel dead.

**No email, to anyone.** A report on a message reaches you the same way a
reply does: it is a notification row for every staff account, so it shows in
your bell with a link to the message. That reuses the one delivery mechanism
the forum has, and it is why the first iteration needs no email provider. Email
to members, as a digest and never per reply, is the first thing to add if
people say they miss replies; that is when a provider gets chosen.

**Data.** `community_follows (user_id, target_type, target_id, level, source)`
where `source` is `auto` or `manual`, so switching automatic following off can
remove only what it added. A reply fans out in one statement: insert or update
one notification row per follower of the thread other than the author, keyed by
`(user_id, thread_id, kind)` so grouping is an upsert, not a job. Three tables
in all: `community_follows`, `community_mentions`, `community_notifications`.

## 4. A spot on a thread

The author may pick one spot, from the map's existing list
(`public/riding-locations.json`, 25 today), in the new-thread form. It is never
guessed from the text: "Rush" is a town, a beach and a verb. The thread shows
the spot as a card under the opening post: its name, a link to its forecast on
the map, and the current wind.

The reading is the one piece of forecast data the forum touches. It comes from
the same per-point series the map already loads, fetched by the browser; the
forum's API knows nothing about weather. If that turns out to be more than a
day's work, the card ships with the name and the link and gains the number later.

Set aside, as **map work with its own plan**, not forum work:

- *Requesting a spot* (from the forum or by pressing the map). It was designed
  and mocked, then moved out of scope: it is a feature of the map.
- *More spots.* `docs/IRISH_SPOTS_SOURCES.md` already sets the rules, which
  stand: Fáilte Ireland's open data and OpenStreetMap may be harvested with
  attribution; Windy's and Surfline's catalogues are not to be scraped, their
  terms forbid it; nothing unreviewed is published.
- *Blowing now*, a panel of live wind at recently discussed spots. Cut: a second
  consumer of forecast data, for decoration.

## 5. What already exists to build on

From `market/` (see `market/README.md`):

- Hono on `@hono/node-server`, one long-lived Node process, Postgres 16 through
  postgres.js tagged templates, no ORM. Railway hosts it.
- A `Repo` interface with a Postgres and an in-memory implementation, so the
  whole API is tested through `app.request()` with no database.
- `optionalAuth` on the whole subtree, `requireAuth` per route. The API reads
  only the `sub` of a Clerk session token. `Bearer dev:name` in dev and tests.
- zod schemas in `market/shared/validate.ts`, run by both the form and the server.
- `fail(status, code, message, details)` and one `onError`; errors are always
  `{ error, message, details? }`.
- Numbered SQL files applied on boot under an advisory lock. Tables prefixed
  `market_`.
- 16-character Crockford ids, checked against a pattern before any query.
- Presigned direct-to-bucket photo upload, keys namespaced per user.

What it does not have, and the forum needs: cursor pagination (the market pages
by offset), any realtime transport, moderation or roles, rate limiting, avatars,
notifications or email. Those are the new work; everything else is copying a
pattern that is already there and tested.

## 6. Backend

### 6.1 Where it lives

A new top-level `community/` beside `market/`, same three parts:

```
community/shared/   types.ts, validate.ts      imported by API and browser
community/api/      router.ts repo.ts repo-pg.ts repo-memory.ts hub.ts limits.ts
community/api/migrations/  0001_init.sql ...
community/web/      the React bundle
```

**One process, one database.** `community/api/router.ts` exports
`createCommunityRouter(deps)`, and `market/api/src/index.ts` mounts it at
`/api/community` next to `/api/market`. It reuses `auth.ts`, `db.ts`, `ids.ts`,
`storage.ts` and `env.ts` as they are. A second Railway service would double the
connection pool and the deploy for no gain at this size; the router boundary
means it can be split out later without touching a handler.

Two small changes to shared plumbing: `migrate(sql, dir, ledger)` takes the
ledger table name so `community_migrations` sits beside `market_migrations`, and
the storage key prefix becomes a parameter (`community/<userId>/<id>.jpg`).

### 6.2 Data model

Every table is prefixed `community_`. Ids are the marketplace's 16-character
ids. Sketch, not final DDL:

```sql
-- One table for the people of the site. The marketplace and the community both
-- point at it. It replaces market_profiles outright: nothing is public yet, so
-- there is no data to carry and no fallback to write.
users (
  id text primary key,                 -- the Clerk user id ("user_...")
  handle text unique not null,         -- for @mentions and /u/:handle
  display_name text not null,
  avatar_url text,
  county text, bio text,
  role text not null default 'member' check (role in ('member','staff')),
  suspended_until timestamptz,
  contact_email text, contact_phone text,          -- asked for when you sell, and only then
  contact_whatsapp boolean not null default false,
  created_at, updated_at
)

community_categories (id, name, position)

community_channels (
  id, slug unique, category_id, name, description,
  kind text check (kind in ('discussion','qa','announcement')),
  post_policy text check (post_policy in ('everyone','staff')),
  require_tag boolean,
  owner_id text,                       -- unused for now: room for member-made channels
  status text check (status in ('active','archived')),
  position integer,
  thread_count integer, follower_count integer, last_message_at timestamptz
)

community_tags (id, channel_id, label, position, staff_only boolean)

community_threads (
  id, channel_id, author_id, title, slug,
  spot_id text,                        -- a riding location from public/riding-locations.json
  status text check (status in ('open','locked','removed')),
  pinned boolean, locked_reason text,
  answer_message_id text,              -- "marked helpful"
  last_seq integer not null default 0, -- highest message seq, drives unread
  reply_count integer, participant_count integer,
  last_message_at timestamptz, last_message_by text,
  created_at
)
  index (channel_id, pinned desc, last_message_at desc, id)   -- the channel list, by cursor
  index (last_message_at desc, id) where status <> 'removed'  -- the home feed
  gin index on to_tsvector(title)                             -- search, with messages below

community_thread_tags (thread_id, tag_id)

community_messages (
  id, thread_id, seq integer,          -- 0 is the opening post; unique (thread_id, seq)
  author_id, body text,
  reply_to_id text,                    -- a reference, never a parent: the stream stays flat
  embeds jsonb,                        -- unfurled internal links, resolved at write time
  reactions jsonb not null default '{}', -- {"🤙": 12}, denormalised from the table below
  status text check (status in ('visible','removed')),
  removed_by text, edited_at, created_at
)
  index (thread_id, seq)
  gin index on to_tsvector(body)

community_message_photos   -- as market_listing_photos
community_reactions  (message_id, user_id, emoji, created_at)  primary key all three
community_mentions   (message_id, user_id)
community_reads      (user_id, thread_id, last_read_seq, updated_at)
community_channel_seen (user_id, channel_id, seen_at)   -- the unread count in the rail
community_follows    (user_id, target_type, target_id, level, source)
                     -- target: thread | channel (later member, spot); level: all | mentions | none; source: auto | manual
community_notifications (id, user_id, kind, thread_id, message_id, actor_id, read_at, created_at)
community_reports    (id, reporter_id, message_id, reason, note, created_at)   -- and a notification to staff
community_mod_log    (id, actor_id, action, target_type, target_id, reason, created_at)
```

Decisions inside that:

- **The opening post is message 0.** One table holds everything that is said,
  so edit, react, report and remove are written once.
- **`seq` per thread** makes unread trivial (`last_seq - last_read_seq`), gives
  messages a stable order that does not depend on clock ties, and is the cursor.
- **Cursor pagination everywhere.** Messages page by `seq` (`after`, `before`,
  `around`); thread lists page by `(last_message_at, id)`. Offset paging breaks
  the moment a reply bumps a thread between two requests.
- **Bodies are text with a small markdown subset** (bold, italic, links, lists,
  quotes), rendered by a safe client renderer. The API never accepts HTML.
  Mentions are stored as `<@user_id>`, so a renamed member stays mentioned.
- **Embeds are internal only.** A link to a Market listing or a spot is resolved
  by the server when the message is written. The server never fetches an
  external URL, so there is no SSRF surface.
- **Reactions come from a fixed list** of about twelve emoji. It keeps the
  counts legible and means no moderation of custom emoji.
- **Removal is soft**, as `status = 'removed'` is in the market: the row stays,
  the stream shows "removed by a moderator", the log keeps who and why.

**One `users` table for the whole site.** Signing up to wingfoil.ie is one
Clerk account, and it is one row here. The marketplace's listings, reviews and
saves reference it, and so do the community's threads, messages and follows.
Same sign-in, same name, same avatar, one profile page showing a person's
listings and their threads.

Nothing has been made public, so this is a replacement, not a migration with
care: `market_profiles` goes, `users` takes its place, the marketplace's foreign
keys and its `market_seller_stats` view point at the new table, and local
development databases are simply recreated. No copying of rows, no generated
handles for existing people, no compatibility view.

Where the code lives follows the table: a small `site/` module (its repo
functions, the `/api/me` endpoints, the Clerk lookup) that both `market/` and
`community/` import, rather than the marketplace owning the people and the
community borrowing them.

Two behaviours, both simpler than what the marketplace does today:

- The row is created the first time a signed-in person does anything that needs
  one, in either section. The server asks Clerk once (`@clerk/backend`, already
  a dependency, the secret key already configured) for a name and avatar to
  start from, and makes a handle from the name. The person can change all three.
- Contact details are nullable on the table. **Publishing a listing** is the
  one action that requires them, and the listing handler is where that is
  checked. Posting in the community never asks.

### 6.3 API

Base `/api/community`. Reading is public; writing needs a Clerk session.

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/meta` | none | Categories, channels, tags, reaction list, limits |
| GET | `/channels` | optional | With unread counts when there is a viewer |
| GET | `/feed?tab=latest\|following\|mentions&cursor` | optional | Home, Following and Mentions are one query |
| GET | `/channels/:slug/threads?tag&cursor` | optional | Most recent activity first. Other sorts are later |
| POST | `/channels/:slug/threads` | required | Title, tags, body, photos, spot. Returns the thread |
| GET | `/threads/:id` | optional | Thread, opening post, and a page of messages around the viewer's last read |
| GET | `/threads/:id/messages?after\|before\|around` | optional | By `seq` |
| POST | `/threads/:id/messages` | required | Body, `replyToId`, photos |
| PUT, DELETE | `/messages/:id` | author or moderator | Edit window for authors; delete is soft |
| PUT | `/messages/:id/reactions/:emoji` | required | `{ on: boolean }` |
| PUT | `/threads/:id/follow` | required | `{ level }` |
| PUT | `/threads/:id/read` | required | `{ seq }` |
| GET | `/threads/:id/events` | none | **SSE**: new, edited and removed messages, reactions |
| GET | `/notifications/count` | required | The bell's number. Polled on load, on focus, and each minute |
| GET, PUT | `/notifications`, `/notifications/read` | required | The list; mark read |
| POST | `/messages/:id/report` | required | Reason and a note. Saved, and notified to staff in the bell |
| GET, PUT | `/api/me` | required | Your `users` row. Site-level, not under `/community`; the marketplace uses the same endpoint |
| GET | `/members/:handle` | none | Public profile and recent threads |
| PUT | `/channels/:slug/follow` | required | `{ on }` |
| POST | `/uploads` | required | The marketplace's presign flow, reused |
| POST | `/threads/:id/(pin\|lock\|remove)` | staff | In place, from the thread's menu. Each writes the mod log |
| PUT | `/members/:id/suspend` | staff | `{ until }` |

### 6.4 Live updates

One thing is live: **new replies in the thread you have open.** Everything else
is fetched when you navigate, when the tab regains focus, or once a minute (the
bell, the rail's unread counts).

**Server-sent events, fed by Postgres `LISTEN/NOTIFY`.** The browser only
listens; everything it sends is an ordinary request. So there is no WebSocket
server to run and nothing new to host.

- A write commits, then `NOTIFY community, '{"t":"msg","thread":"…","seq":25}'`.
  Ids only: the payload cap is 8 KB and the client fetches what it needs.
- `hub.ts` holds **one** listening connection per process (postgres.js
  `sql.listen`) and fans out to the open SSE responses in memory. It works
  unchanged if a second API instance is ever added.
- The stream is public, like the thread, so plain `EventSource` works and no
  token is involved.
- A comment line every 25 seconds keeps proxies from closing the stream. On
  reconnect the client asks for `messages?after=<last seq it has>`, so a dropped
  connection loses nothing.

If this proves awkward behind Railway or Caddy, the fallback is the same
`messages?after=` request every ten seconds while a thread is open. The client
code barely changes, which is why `seq` is worth having.

### 6.5 Trust and safety

This ships **before** the forum is public. The marketplace could launch without
it because a listing is inert; a forum cannot. But with one person minding it,
it is a floor, not a system:

- **Two roles**: member and staff. Staff is you, set by hand in the database.
- **Report** on any message: a reason and a note. It is saved and shows in
  **your bell**, like any notification, with a link to the message. No email,
  no queue screen.
- **Staff act in place**, from the message or thread menu: remove (soft, the
  stream shows "removed"), lock with a visible reason, pin, suspend a member
  until a date. Every action writes a row to `community_mod_log`.
- **New members** (first three messages, or first day): no external links,
  three threads a day, no mentions.
- **Rate limits** in process, a token bucket per user per action: a message
  every three seconds, five threads an hour, sixty reactions a minute, five
  reports a day. Body size limits as the market has.

Later, when there is more than one of you: a moderator role, a queue, moving a
thread between channels or "this belongs in the Market".

## 7. Frontend

### 7.1 Routing and chrome

A third bundle, exactly as the marketplace was added:

- `force5/src/siteNav.ts`: a `community` section (`/community`, "Community") and
  `isCommunityPath`; the site menu gets its third row in both existing apps.
- `src/main.tsx` lazy-loads `community/web/CommunityApp` for `/community` URLs.
- `public/_redirects`: two more rules. Caddy's fallback already covers it.
- The header is the marketplace's bar with `Community` in the eyebrow chip.

```
/community                     home feed (Latest, Following, Unanswered)
/community/c/:slug             a channel
/community/t/:id/:slug?        a thread (the slug is decoration; the id resolves)
/community/u/:handle           a member
/community/following           threads and channels you follow
/community/mentions            messages that mention you
/community/notifications       the bell, as a page on a phone
```

Shared pieces move out of `market/web` into `shared/web/` first so the two
bundles do not fork them: the Clerk bridge (`auth.tsx`), the fetch client core,
`usePageTitle`, `Field`, `ConfirmDialog`, `Notice`, `Empty`.

### 7.2 The views (see the mockups)

Every view is two columns on a desktop: the channel rail, and the page. There
is no right-hand panel.

1. **Home.** One feed across every channel, each row naming its channel.
2. **Channel.** Threads in one pane, divided by hairlines, in one order: last
   activity. Tags are pills, a pinned thread sits on top, the head counts
   threads and followers.
3. **Thread.** The opening post is the one card. Replies stream below it on the
   ground, flat and in time order, grouped by day, with a "new since you were
   last here" line. Reply-to is a quoted line above a message that jumps to its
   target. Hover shows react, reply, report. A linked spot shows under the
   opening post. The notify level is a menu on the Following button. The
   composer is docked under the stream.
4. **New thread.** A dialog over the channel: title, tags, body, photos, an
   optional spot.
5. **Following, with the bell open** (section 3).
6. **Phone.** Three full pages (channels, threads, conversation), not a squeezed
   split view. New thread is a floating pill; the composer docks to the bottom.

A thread opens as **a page, not a side panel**. A page has a URL you can
paste into WhatsApp, works the same on a phone, and is what a search engine
reads. The channel rail stays visible on a desktop, so the room is still there.

Signed out, nothing is hidden: the reply slot becomes "Sign in to reply", and
pressing it opens Clerk's sign-in and returns to the thread. That is the
marketplace's pattern for Contact seller.

### 7.3 Design system work

The forum is the second content page, which the bundle's own Gaps list says is
the moment to stop copying and promote. Before any forum UI:

- **Into the bundle as variants**: the content-ground pill and chip (currently
  re-grounded under `.mk-root` in `market.css`), and the filled capsule.
- **Into the bundle as components** (the full trio each): `field` (the
  marketplace's `.mk-field`), `dialog`, `avatar`, `count` (the unread badge).
- **Stays in product CSS** (`community/web/community.css`, prefix `.cm-`,
  `--sem-*` only): the rail, thread rows, the message stream, the composer.
- `npm run design:lint` stays green, and `community/web` is added to whatever
  the project-side rule covers when that lands.

**Rulings to record in `principles.md`, dated, when we agree them:**

- *New thread is the accent on home and channel; on a thread the composer's
  Reply takes it and New thread goes quiet.* The 2026-09-17 Sell ruling, applied.
- *Unread is weight, a dot and a count.* Never colour alone.
- *Wind colour in the community is still data.* A swatch beside a knot value on
  a linked spot, and nowhere else. No wind colours on tags or avatars.
- *Reaction emoji are member content*, like a listing photo, not system colour.
- *Avatars* are initials on a teal step, or the member's photo.

**Gaps this will add**: no 16px step (the composer takes `lead` on a touch
device, as market fields do); no toast (a sent message appears in the stream,
which is the confirmation); no motion spec for a message arriving.

## 8. Site integration

Kept deliberately small for the first iteration: a thread can carry a spot, and
a rider can request one. The rest are good ideas that each cost a system, so
they wait until the forum has people in it:

- "Discuss this spot" on the map's spot card, with the latest thread titles.
- Market listing links unfurling inside messages.
- The site posting a "This weekend" forecast thread each Thursday, under the
  site's own name and plainly automatic. (Real information from the forecast,
  not invented activity; still later, and still your call.)

## 9. For later: sponsorship

Not now. The idea to keep, from review: **a sponsored thread.** An
advertisement is an ordinary thread in a channel, started by the sponsor's
account, marked *Sponsored* in words, and held at a fixed position in the list
for the period paid for. People can reply to it, which is more than a banner
offers a school or a shop, and it needs almost nothing built: a `sponsored_until`
date on a thread, a chip, and the list query placing it. No ad network, no
third-party scripts or cookies, no right-hand panel, no new surface to design.

To settle when it becomes real: how many per channel at once (one), whether
replies can be closed, that paying never buys position in the home feed or a
staff voice, and that sponsors are sold to directly (schools, shops, Irish
distributors).

## 10. Phases

| | Scope | Roughly |
| --- | --- | --- |
| **0. Foundations** | `shared/web` extraction; bundle promotions (pill, chip, field, dialog, avatar, count); site nav, path routing, `_redirects`; parametrised `migrate`; the `users` table and `site/` module replacing `market_profiles` (Clerk name and avatar, handle, contact required only to list) | 3 days |
| **1. Read and write** | Schema; both repos; categories, channels, threads, messages, tags, cursor paging; home, channel, thread and new-thread views; photos; reactions; sign-in gate; search; API tests in the `app.test.ts` style | 6 days |
| **2. Following and live** | Follows (thread, channel), mentions, notification rows and grouping, the bell on a one-minute poll, Following and Mentions pages, unread; the hub and the thread stream | 4 days |
| **3. Safety** | Staff role, remove, lock, pin, suspend, the log, new-member and rate limits; report to the staff bell. **Gate for going public** | 2 days |
| **4. Spot on a thread** | The picker, the card, the live reading if it is cheap | 1 day |
| *First iteration ends here* | | *about 3 weeks* |
| **Later, as wanted** | The cut list in section 0 | sized one at a time |

Launch itself: the forum opens empty. No threads, members or activity are
created to make it look used. You may start threads yourself, under your own
name, like any member; that is posting, not seeding. Inviting riders you know
before it is public is the one thing worth doing ahead of time.

Tests follow the market: Vitest over `app.request()` against the memory repo,
with a fake storage and `dev:` bearer tokens. Two additions the market does not
have and this needs: a Postgres-backed run of the same suite (cursor paging and
`seq` allocation under concurrency are exactly what a Map will not catch), and
Playwright coverage of post, reply and live arrival across two browser contexts.

## 11. Decisions

Settled in review, 20 September 2026:

- Channels and flat threads, not votes and nested trees. "Community", with Community / Gear / Riding / Social.
- Every channel is set up by the site and open to every member. No crews, no
  member-made channels, no organisation channels for now.
- Two columns. No right-hand panel: no Blowing now, no Here now or who is
  online, no "Before you post", no related threads, no role badges.
- One thread order, most recent activity. No sort options for now.
- Thread and follower counts on a channel. The member count shows from 50 members.
- Notifications are inside the site only. The forum sends no email; a report
  shows in the staff bell. So there is no email provider.
- Requesting a spot is out of scope here, in the forum and on the map. When it
  is built, as map work: adding needs sign-in, and a signed-in rider has no limit.
- Advertising, when it comes, is a sponsored thread, not a panel (section 9). Later.
- **One `users` table for the whole site**, replacing `market_profiles`. Nothing
  is public, so it is a clean replacement with no fallbacks. Contact details
  are asked for only when you sell.
- **Nothing is seeded in production.** No fake threads, no fake members, nothing
  made to look like more people are here. Fixtures exist for development and
  tests only. You may post threads yourself, as yourself.

Proceeding on these unless told otherwise; none needs an answer to start:

- A thread opens as a page, not a side panel (section 7.2).
- Replying follows the thread automatically, with one switch to turn that off.


- **Colour: Atlantic** (section 13). Navy ink, a neutral ground, electric blue
  for the one filled action, across the community, the marketplace and the map.

## 12. Before the first line of code

Nothing here needs a decision. It is the content and the constants that the
build would otherwise stop to invent, drafted so they can be corrected rather
than discussed.

**One prerequisite that is not ours to define.** The forum rides on the
marketplace API. Before the forum can be public, that API has to be running in
production: the Railway service and Postgres, production Clerk keys
(`CLERK_SECRET_KEY` or `CLERK_JWT_KEY`, `CLERK_AUTHORIZED_PARTIES`), the photo
bucket, `MARKET_CORS_ORIGINS`. Development needs none of it (`npm run market:db`
and `dev:` tokens). Worth confirming early that Railway holds a server-sent
event stream open; the ten-second fallback in 6.4 exists in case it does not.

**Your staff account.** Your Clerk user id, to set `role = 'staff'` by hand.

**Names.** A member has a *display name* ("Aoife K"), taken from Clerk on first
post and editable, and a unique *handle* (`aoife-k`) for @mentions and profile
links, generated from it, with a number added on a clash.

**Tags**, per channel, up to three on a thread, none required:

| Channel | Tags |
| --- | --- |
| wings, boards, foils | Question, Review, Sizing, Repair, New release |
| spots-and-conditions | Question, Conditions, Access, Hazard, plus one per province |
| sessions, meetups | Dublin, East, South, West, North |
| technique | Question, Beginner, Gybes and tacks, Jumps, Waves, Light wind |
| general, off-topic, announcements | none |

**Reactions**, a fixed twelve: 👍 🤙 ❤️ 😂 😮 🙏 🔥 👀 💨 🌊 ✅ 🙌

**Limits.** Title 120 characters. Message 5,000. Four photos a message, 6 MB
each, resized in the browser to 1600 px as the marketplace does. Edit your own
message for 30 minutes, delete it any time. 30 messages a page.

**House rules**, five lines, linked from the thread form: be sound; selling
goes in the Market; no advertising; say what you know and how you know it
(conditions and safety advice get acted on); staff may remove anything and will
say why.

**Test data stays in test.** Development and the test suite use fixture
threads and `dev:` members, in the memory repo and the local database only. No
migration, script or deploy step writes threads, messages or members into the
production database. The only rows a migration creates are the categories, the
ten channels and their tags.

**Empty states**, since they are what the first visitors will see: a channel
with no threads says "No threads yet" with *Start the first one*; Following
says "Nothing followed yet" and how following works; the bell says "Nothing
new". Statements, one plain sentence, the action that fixes it: the
marketplace's pattern.

## 13. Colour: Atlantic, across the site

Decided 20 September 2026. The teal was made to sit quietly over a map full of
wind colour; on a page with no map it read cold and still. Atlantic keeps the
sea but gives it contrast: near-black navy text, a neutral ground rather than a
blue-tinted one, and a saturated blue for the one filled action.

### 13.1 The values

Proposed, to be entered in `design/foundations/tokens.tokens.json` (never in
CSS) and regenerated. The ramp replaces `ref.color.teal.*` step for step, so
every `sem` alias keeps pointing at the same step number.

| `ref.color.navy` | 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| | `#f4f6fa` | `#eef2f9` | `#e1e8f3` | `#c3cfe2` | `#9db0cc` | `#7488a6` | `#4a607c` | `#1f3a5c` | `#0a1f3c` | `#081830` | `#050f20` |

Plus one new family, the accent: `ref.color.blue.500 #1463ff`, `600 #0d4fd1`.

| Semantic token | Was | Becomes |
| --- | --- | --- |
| `bg.content` | teal.50 `#f1fafc` | navy.50 `#f4f6fa` |
| `bg.page` (the ground behind the map) | teal.400 `#82aab4` | navy.400 `#9db0cc` |
| `surface.card` | white | white |
| `surface.solid`, `surface.glass` | teal.100 | navy.100 `#eef2f9` (glass at the same alpha) |
| `surface.sunken` | teal.200 `#d1e6ec` | navy.200 `#e1e8f3` |
| `surface.inverse` | teal.700 `#20525d` | navy.800-ish `#0b2545` |
| `border.strong` | teal.500 | navy.500 `#7488a6` |
| `text.primary / secondary / muted` | teal.800 / 700 / 600 | navy.800 `#0a1f3c` / 700 `#1f3a5c` / 600 `#4a607c` |
| `action.bg`, `action.bg-hover` | teal.600 / 700 | **blue.500 `#1463ff` / blue.600 `#0d4fd1`** |
| `action.quiet`, `action.focus` | teal.700 | `#0b2545` |
| ink alphas (hairline, shadows, scrim) | on `#0a2126` | on `#0a1f3c` |
| `warm.*`, `green.600`, all fourteen `wind.*` | | **unchanged** |

Contrast, measured the way the bundle records it: `text.muted` is about 5.9:1
on the content ground and 6.4:1 on a card; white on `action.bg` is about 4.8:1.
The dark-mode halves of these tokens need the same pass before dark is ever
adopted; it is not adopted today, so that is not on this path.

**Rulings to write, dated:** *"One hue" becomes one neutral family (navy) and
one accent (blue).* The accent rule itself does not change: one filled action
per view. Warm still means now or degraded. Wind colours still mean wind.

### 13.2 What it takes, section by section

Measured in the repo, because the three sections are in very different states:

| | Reads the tokens? | What changing the palette means |
| --- | --- | --- |
| **Marketplace** (`market/web/market.css`) | Entirely: 444 `var(--sem-*)`, 0 colour literals | **Nothing to do.** Change the token values and it is re-themed. Verified: the real page, running locally with only the tokens overridden, is the first screenshot in `docs/community-mockups/shots/08-*`. |
| **Community** | Will be built on them | Nothing to do |
| **Site menu, Force5 components** | Entirely | Nothing to do |
| **Wind map** (`src/styles.css`, `src/compact.css`, `src/dock.css`) | **Not at all: 237 colour literals, 0 tokens** | Real work, below |

**The map is a migration, not a recolour.** Its three stylesheets predate the
design system and hard-code teal in 237 places (112 + 37 + 88). Re-theming it
honestly means doing what the bundle's own principles already ask: replace each
literal with the `sem` token that says what it *is*, after which it follows the
palette like everything else. The harvest that built the teal ramp already
clustered these literals, so most map onto an existing token; the forecast grid
and dock are the bulk, and are already listed as the bundle's biggest gap. Three
to four days, with before and after screenshots of every map state, and it
should be its own piece of work with its own review, not folded into the forum.

Two things on the map are not CSS:

- **The basemap.** `WindMap.tsx` paints the land `#f0f1e8` and the water
  `#b8d0d7` over the third-party style. The water wants to move from grey-teal
  toward the navy ramp (about navy.300); the land can stay.
- **The wind field does not change**, and it constrains the accent: low winds
  are painted in blues (`wind.k00` to `k09`). The filled action on the map (Play)
  sits on a glass dock, not on the water, so an electric blue button should be
  safe, but it has to be looked at over a light-wind day before it ships. If it
  ever reads as a reading, the map's filled action takes `surface.inverse`
  (navy) and the blue stays on the content pages.

**Order.** (1) Tokens and rulings: the marketplace, site menu and bundle catalog
change together, in one commit, reviewed in the catalog in light mode. (2) The
community is built on the new values from its first line. (3) The map migration,
separately. Until (3) lands the map stays teal while the pages around it are
navy; they are separate page loads, so it is a visible seam, not a broken one.

## 14. Tailwind

**We are not using it.** There is no Tailwind anywhere in the repo. Styling is
plain CSS: the Force5 tokens as custom properties, the bundle's component
classes (`.f5-button`…), and one product stylesheet per section (`.mk-*`).

**Should we?** For the community, yes, and it fits better than it first looks:

- Tailwind 4 is configured in CSS, and its theme *is* custom properties. The
  theme can be declared entirely from the Force5 tokens, with Tailwind's own
  defaults switched off, so `bg-card`, `text-muted`, `rounded-surface`, `gap-loose`
  exist and `bg-[#123456]` or `p-[13px]` have nothing to resolve from. One source
  of truth stays one source of truth.
- The bundle's rule "no raw values, tokens only" becomes "no arbitrary values",
  which is a lint Tailwind projects already know how to run. The design-system
  guidance this repo follows anticipates exactly that.
- It is markedly faster for the kind of UI the forum is: many small layouts,
  responsive variants, states.

What it costs, and how to contain it:

- **Preflight**, Tailwind's reset, would land on the map's 237-literal
  stylesheets and move things. Import Tailwind's theme and utilities layers
  without Preflight (the repo already has the small reset it needs).
- **Two ways of styling in one repo.** The marketplace's 1,600 lines of working,
  token-only CSS should not be rewritten for its own sake: it would look
  identical afterwards. It converts when a page is next being reworked anyway.
  The Force5 component classes stay as they are and are used from Tailwind
  markup; they are the design system, not a rival to it.
- The map's stylesheets convert, if ever, as part of the migration in 13.2,
  not before.

So: Tailwind 4 via `@tailwindcss/vite`, themed only from Force5 tokens, no
Preflight, used for the community from day one; marketplace and map left alone
until they are being touched for another reason. It adds half a day to phase 0.
