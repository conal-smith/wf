---
type: feature
status: ready
difficulty: m
criticality: high
risk: normal
epic: community-forum
iteration: 1
dependsOn: community-web-shell
mockups: backlog/mockups/2026-09-20-community-atlantic.html
---

# Home feed, channel page and the new-thread dialog

GOAL: A member can read the latest threads, open a channel, filter by tag and start a thread.
SPEC:
- S1 Home: title, one line of description, member count shown only when >= 50, thread list (each row names its channel). Infinite scroll by cursor with a Load more fallback.
- S2 Channel: name, description, "N threads · N following", Follow channel toggle, tag pills (All plus the channel's tags), "Most recent activity first", pinned threads first.
- S3 Thread row: avatar, title (unread = heavier weight plus dot), one-line preview of the last message, tags, author, reply count (hidden when 0), up to 3 participant avatars, relative time, "N new" count, optional 76x57 thumbnail.
- S4 Phone: compact row, tag pills on one scrolling line, floating New thread pill.
- S5 New thread: Dialog with title (counter to 120), tags (max 3), body, up to 4 photos (resized in the browser to 1600 px, reuse market/web/images.ts), optional spot select from public/riding-locations.json. Post thread is the dialog's one filled action. Field errors from the API's details map.
- S6 Signed out: New thread opens sign-in, then returns to the dialog.
- S7 Empty states: "No threads yet" with Start the first one; error state names the thing and offers Try again.
- S8 Staff-only channel: no New thread for members.
TOUCH: community/web/pages/{Home,Channel}.tsx, community/web/components/{ThreadRow,ThreadList,NewThreadDialog,TagPills}.tsx.
REUSE: ui/ kit; market/web/images.ts (move to shared/web if imported from both).
AVOID: Sort options, related threads, side panels, guidance panels, seeded content (D23 D24).
GATES: npm run ui:lint; npm test; npm run build.
ACCEPT:
- [ ] Matches mockups 1, 2, 4, 6b at 1240 and 390.
- [ ] Post a thread in dev -> lands on its page; appears first in the channel and on home.
- [ ] One filled action per view (check each view and the dialog).
REFS: D22 D23. Mockups 1, 2, 4, 6b.
