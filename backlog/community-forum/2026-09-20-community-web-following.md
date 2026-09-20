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
TOUCH: community/web/pages/{Following,Mentions,Notifications,Profile}.tsx, community/web/components/{Bell,NotificationRow}.tsx.
AVOID: Email or push settings. Following members (D24).
GATES: npm run ui:lint; npm test; npm run build.
ACCEPT:
- [ ] Matches mockup 5.
- [ ] Popover: Escape closes and returns focus to the bell; outside press closes.
REFS: D19. Mockup 5.
