---
type: feature
status: ready
difficulty: m
criticality: high
risk: normal
epic: community-forum
iteration: 1
dependsOn: community-web-feed, community-follow-notify
mockups: backlog/mockups/2026-09-20-community-atlantic.html
---

# Following, Mentions and the bell

GOAL: A member sees what they follow, where they were mentioned, and an inbox of grouped notifications.
SPEC:
- S1 /community/following: followed channels as pills with Manage, then threads with a `why` line (You started this | You replied | You follow this channel). Empty state explains how following works.
- S2 /community/mentions: messages that mention the viewer, newest first, each linking to the message.
- S3 Bell: count badge from useNotificationsCount. Desktop: popover anchored to the bell. Below 900: /community/notifications page.
- S4 Rows: reply (grouped: up to two names plus "N new replies"), mention (with the quoted line), thread (in a followed channel), reaction (quiet, no unread dot), report (staff only). Unread = dot plus tinted row, not colour alone.
- S5 Opening a row navigates to the message and marks it read. Mark all read. Settings link to the autoFollow switch on the profile page.
- S6 /community/u/:handle: avatar, name, handle, county, bio, their recent threads; on your own: edit profile and the autoFollow switch.
TOUCH: community/web/pages/{Following,Mentions,Notifications,Profile}.tsx, community/web/components/{Bell,NotificationRow}.tsx. Added: community/web/components/{MembersOnly,ThreadRow}.tsx, community/web/{api,hooks}.ts, community/web/{CommunityApp,Header,router}.tsx, community/web/pages/Thread.tsx, community/web/{following,feed,shell}.test.ts; for GET /members/:handle: community/api/handlers/read.ts, community/api/{repo-memory,repo-pg}.ts, community/api/{repo,router}.test.ts, community/shared/types.ts, site/api/{repo,repo-memory,repo-pg}.ts, site/api/users.test.ts (LOG).
AVOID: Email or push settings. Following members (D24).
GATES: npm run ui:lint; npm test; npm run build.
ACCEPT:
- [x] Matches mockup 5.
- [x] Popover: Escape closes and returns focus to the bell; outside press closes.
REFS: D19. Mockup 5.
OPEN:
- S1 names three `why` lines. The API has a fourth reason, `followed` (a thread followed from its Following menu without a reply; community/shared/types.ts FOLLOW_REASONS), and the row says "You follow this thread" for it.
- S6 says "edit profile" and the row is the site's (D15, D16), so the form saves through PUT /api/me, which resets a contact field it is not sent. The form edits name, handle, county and bio and sends the contact fields back as they came; how to reach a member stays the marketplace's to edit. The avatar is the identity provider's and is not edited here.
- S4's "report (staff only)" is the API's doing: a report row is only ever written to staff (community-safety). The web draws whatever rows it is sent, a report among them, and asks nobody's role.
LOG:
- 2026-09-20 agent: verified against e6cdd20. The item holds no path:line anchors. Both dependsOn are on the epic branch (community-web-feed fd7a73b, community-follow-notify d4b60d2), and so is community-web-thread (43ef611), whose page the rows link into; the branch was rebased onto it. The API's shapes were read from community/shared/types.ts (Notification, MentionItem, FollowReason, NotificationSelector) and the routes from community/api/handlers/{read,notifications,follow}.ts: GET /feed?tab=following|mentions, GET /notifications, GET /notifications/count, PUT /notifications/read, PUT /channels/:slug/follow.
- 2026-09-20 agent: TOUCH grew, and why. GET /members/:handle is in plan 6.3 and nothing served it, so S6 had nothing to read: read.ts serves the public fields named one by one (no contact) with a page of the threads that member started; the thread list narrows by authorId in both repos, and the users repo finds a row by handle. api.ts and hooks.ts: the routes, and one paging hook (usePaged) that the thread feed now sits on and Mentions and the bell share. CommunityApp.tsx, Header.tsx: the four pages take their places and the bell replaces the header's link; useNotificationsCount now answers {count, setCount} so that marking read moves the badge at once. ThreadRow.tsx: the why line. MembersOnly.tsx: what Following, Mentions, the notifications and `me` show a signed-out reader. router.tsx, pages/Thread.tsx: next line.
- 2026-09-20 agent: S2 and S5 need an address for one message, which community-web-thread left to this item (its OPEN 4). It is the hash the thread page's messages already carry as ids: paths.message gives /community/t/<id>/<slug>#m-<seq>, useLocation now reports the hash, and Thread.tsx reads it on arrival and on change and makes the jump a reply-to makes (reach(seq), then centre and raise). A hash rather than the `?at=` that note floated, because the reply-to anchors are already #m-<seq> and one address is enough.
- 2026-09-20 agent: S3 as built. The bell is a link to /community/notifications everywhere. Beside the rail (the theme's --breakpoint-rail, 900px, asked by matchMedia) a plain press opens the popover instead: role=dialog, hung under the bell with right edges together, 400 wide, the newest six rows, Mark all read, the settings link, See all notifications. A press with a modifier, the notifications page itself, and anything below 900 leave it a link; narrowing the window closes it. Each opening asks for the list again (D19); arriving anywhere closes it. It does not reuse components/Popover.tsx: that one hangs from a button, and this one from a link that must still work as a link.
- 2026-09-20 agent: S4 and S5 as built. The API folds; the row draws: up to two names and faces then "and N others", "N new replies" while unread and "N replies" after, a mention's excerpt on one truncated line, a followed channel's new thread with the channel's name, a reaction with its emoji and no dot, tint or count. Unread is a dot, a tinted row and the word Unread for a screen reader. Opening a row marks it read in hand first, then PUT /notifications/read {ids}; the answer's count goes to the badge; a refusal reloads the list, and a failed Mark all read says so. The settings link is /community/u/me#following-settings: `me` is a reserved handle, resolves to the member's own profile keeping the hash, and the switch takes the focus.
- 2026-09-20 agent: proved. ACCEPT 2: community/web/following.test.ts "ACCEPT: the popover" (watchPopover and focusAfterClose over a fake document), and in a browser (scratch Playwright script, vite dev on 4313 with VITE_MARKET_DEV_USER=aoife, the API answered in its own shapes by route): Escape closed the popover and document.activeElement was the bell; a press on an empty part of the page closed it and the focus was not on the bell; the bell toggled it. Same run: the badge read "Notifications, 3 unread"; the panel sat under the bell, right edges together, 400 wide; a row went to /community/t/t1/a-thread#m-7, sent {ids:["n1"]} and the badge took the answered count; at 390x844 the bell went to /community/notifications with no dialog and no sideways scroll, and Mark all read sent {all:true} and cleared every Unread. ACCEPT 1: by eye against mockup 5 at 1440x1000 with the bell open over /community/following (pills and Manage, the four row kinds, dot and tint, the foot link), and the page at 390x844.
- 2026-09-20 agent: also in a browser: arriving at #m-40 of a 120-reply thread asked messages?around=40 and brought m-40 into view, and with no hash nothing was jumped to; /community/u/me#following-settings became /community/u/aoife-k#following-settings with the switch focused; pressing it sent PUT /api/me with autoFollow false and the contact fields as they came; Edit profile opened the form filled in.
- 2026-09-20 agent: differences from mockup 5, on purpose: the settings cog is a link (to the profile's switch, S5) where the mockup has a button; an empty popover says "Nothing new.", which the mockup does not draw.
- 2026-09-20 agent: gates, on c85719f. npm test 1120 passed, 75 skipped (the Postgres repo tests, no DATABASE_URL); with DATABASE_URL set to a Postgres 16 container, npx vitest run community/api site/api market/api: 270 passed, none skipped, the member route and the authorId list among them. npm run build ok; npm run market:api:build ok; npm run ui:lint clean over 80 files; npm run test:e2e 75 passed (PREVIEW_PORT=4313). community/web/following.test.ts holds 47 tests, under S1 to S6 and ACCEPT by name.
- 2026-09-20 agent: not proved: the pages against the running API rather than answered routes (the client's paths and bodies are held by following.test.ts, the routes by community/api/router.test.ts); Manage's follow toggles in a browser; sign-in returning to a members-only page under the real identity provider.
