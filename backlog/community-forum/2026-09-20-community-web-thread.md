---
type: feature
status: ready
difficulty: l
criticality: high
risk: normal
epic: community-forum
iteration: 1
dependsOn: community-web-shell, community-live
mockups: backlog/mockups/2026-09-20-community-atlantic.html
---

# Thread page: conversation, composer, reactions, live updates

GOAL: A member can read a thread, reply to it or to a message in it, react, attach photos, and watch replies arrive.
SPEC:
- S1 Head: back link to the channel, title, tags, "N replies · N riders · started <when>", Following menu (every reply | mentions only | nothing), copy link, overflow (report; staff: pin, lock, remove).
- S2 Opening post is the one card. Replies stream below on the ground, oldest first, grouped under day dividers.
- S3 Entering a thread loads the page around the viewer's last read and shows a "N new since you were last here" divider. Older and newer pages load by cursor in both directions. PUT /read fires when the newest message scrolls into view.
- S4 Reply-to: a quoted line above the message (author plus first line); pressing it scrolls to and briefly marks the target, loading it if needed.
- S5 Message actions on hover or long-press: react, reply, report; own message: edit within 30 min, delete. Edited messages say so. Removed messages render as removed.
- S6 Reactions: chips with counts; yours is outlined and raised as well as filled; picker offers only REACTIONS.
- S7 Body renderer: paragraphs, bold, italic, lists, quotes, links (rel nofollow noopener, http/https only), @mentions as chips. No HTML ever reaches the DOM from a body.
- S8 Composer docked under the stream: multiline, @ autocomplete (thread participants first), photos, "Replying to X" strip with cancel, Reply = the view's filled action (header New thread goes quiet). Enter sends, Shift+Enter breaks, on desktop only.
- S9 Signed out: the composer slot is "Sign in to reply"; pressing it opens sign-in and returns here.
- S10 Live: subscribes to /threads/:id/events; new messages append if the reader is at the bottom, otherwise a "N new" pill; fallback polling per community-live S5.
- S11 Locked thread: composer replaced by the reason.
TOUCH: community/web/pages/Thread.tsx, community/web/components/{Message,MessageStream,Composer,Reactions,Body,FollowMenu}.tsx, community/web/body.test.ts.
AVOID: Nesting, votes, typing indicators, marked answers, listing cards, a right-hand panel (D14 D24).
GATES: npm run ui:lint; npm test; npm run build.
ACCEPT:
- [ ] body.test.ts: script tags, javascript: links and raw HTML render as text.
- [ ] Matches mockups 3 and 6c.
- [ ] Two browsers: a reply in one appears in the other without refresh.
REFS: D14 D18 D20 D22. Mockups 3, 6c.
