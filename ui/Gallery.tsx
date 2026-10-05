/**
 * The kit gallery, at /ui in development: every component, in every variant
 * and every state that can be held still. Hover and focus are live: point at a
 * control, or tab through the page, and the same ring should land on each one.
 *
 * Loaded by path from src/main.tsx in development mode only, and exported
 * from nowhere, so it is not part of any build.
 */
import { Bell, Heart, MessageSquare, Plus, Trash2, Wind } from "lucide-react";
import { useState, type ReactNode } from "react";
import {
  Avatar,
  Button,
  Checkbox,
  Chip,
  ConfirmDialog,
  Count,
  Dialog,
  Empty,
  Field,
  Link,
  Notice,
  Pager,
  Pane,
  SearchField,
  Segmented,
  Select,
  Skeleton,
  Surface,
  TextArea,
  TextInput,
} from "./index";
// Gust, the companion, is not part of the kit; he is drawn here so his moods
// can be looked at side by side.
import { Gust } from "../companion/web/Gust";
import { GUST_MOODS } from "../companion/web/mood";
import { SpotCard } from "../companion/web/SpotCard";

const VARIANTS = [
  "quiet",
  "primary",
  "pill",
  "raised",
  "link",
  "danger",
] as const;
const SIZES = ["sm", "md", "lg"] as const;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Pane className="grid gap-4" data-section={title}>
      <h2 className="m-0 text-lead text-ink">{title}</h2>
      {children}
    </Pane>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-2">
      <p className="m-0 text-eyebrow text-ink-muted uppercase">{label}</p>
      <div className="flex flex-wrap items-center gap-3">{children}</div>
    </div>
  );
}

export default function Gallery() {
  const [saved, setSaved] = useState(true);
  const [whatsapp, setWhatsapp] = useState(true);
  const [notify, setNotify] = useState<"all" | "mentions" | "none">("mentions");
  const [sort, setSort] = useState<"latest" | "unread">("latest");
  const [page, setPage] = useState(2);
  const [dialog, setDialog] = useState<"plain" | "wide" | "confirm" | null>(
    null,
  );
  const [busy, setBusy] = useState(false);

  return (
    <main className="grid min-h-dvh content-start gap-6 bg-ground p-6 font-sans text-prose text-ink">
      <header className="grid gap-1">
        <h1 className="m-0 text-title text-ink">Kit</h1>
        <p className="m-0 max-w-reading text-ink-muted">
          Every component in ui/, in every variant and state. Development only.
        </p>
      </header>

      <Section title="Button">
        {VARIANTS.map((variant) => (
          <Row key={variant} label={variant}>
            {SIZES.map((size) => (
              <Button key={size} variant={variant} size={size}>
                {variant} {size}
              </Button>
            ))}
            <Button variant={variant}>
              <Plus size={16} aria-hidden="true" /> With an icon
            </Button>
            <Button variant={variant} disabled>
              Disabled
            </Button>
            <Button variant={variant} href="#button">
              As a link
            </Button>
          </Row>
        ))}
        <Row label="icon only">
          {SIZES.map((size) => (
            <Button
              key={size}
              variant="pill"
              size={size}
              icon
              aria-label={`Notifications, ${size}`}
            >
              <Bell size={size === "sm" ? 15 : 18} aria-hidden="true" />
            </Button>
          ))}
          <Button icon aria-label="Reply">
            <MessageSquare size={18} aria-hidden="true" />
          </Button>
          <Button variant="pill" icon disabled aria-label="Delete">
            <Trash2 size={18} aria-hidden="true" />
          </Button>
        </Row>
        <Row label="pressed">
          <Button
            variant="pill"
            pressed={saved}
            onClick={() => setSaved(!saved)}
          >
            <Heart size={16} aria-hidden="true" /> {saved ? "Saved" : "Save"}
          </Button>
          <Button variant="pill" pressed>
            Question
          </Button>
          <Button variant="pill" pressed={false}>
            Review
          </Button>
          <Button variant="quiet" pressed>
            Quiet, pressed
          </Button>
          <Button variant="pill" icon pressed aria-label="Notifications, open">
            <Bell size={18} aria-hidden="true" />
          </Button>
          <Button variant="pill" pressed disabled>
            Pressed, disabled
          </Button>
          <Button variant="pill" size="sm" href="#button" pressed>
            Current link
          </Button>
        </Row>
        <Row label="pressed, worded">
          <Button
            variant="pill"
            size="lg"
            pressed={saved ? "worded" : false}
            onClick={() => setSaved(!saved)}
          >
            <Heart
              size={16}
              fill={saved ? "currentColor" : "none"}
              aria-hidden="true"
            />
            {saved ? "Saved" : "Save"}
          </Button>
        </Row>
      </Section>

      <Section title="Link">
        <Row label="in text, and plain">
          <p className="m-0">
            Read the <Link href="#link">house rules</Link> before you post.
          </p>
          <Link href="#link" plain>
            Browse gear
          </Link>
        </Row>
      </Section>

      <Section title="Chip">
        <Row label="tone">
          <Chip>Wings</Chip>
          <Chip tone="warn">Forecast is 9 hours old</Chip>
          {/* Glass is for a badge over a photograph; here it stands on the
              gallery's own ground, which shows the hairline and little else. */}
          <Chip tone="glass">Saved</Chip>
        </Row>
        <Row label="eyebrow">
          <Chip eyebrow>New</Chip>
          <Chip eyebrow tone="warn">
            Degraded
          </Chip>
        </Row>
      </Section>

      <Section title="Count">
        <Row label="tone, and the ceiling">
          <Count value={4} label="unread" />
          <Count value={27} />
          <Count value={120} />
          <Count value={3} tone="quiet" />
          <span className="text-ink-muted">Zero draws nothing:</span>
          <Count value={0} />
        </Row>
      </Section>

      <Section title="Avatar">
        <Row label="initials">
          {SIZES.map((size) => (
            <Avatar key={size} name="Aoife Byrne" size={size} />
          ))}
          <Avatar name="conor" />
          <Avatar name="" />
        </Row>
        <Row label="image, and an image that fails">
          {SIZES.map((size) => (
            <Avatar key={size} name="Wingfoil" src="/favicon.svg" size={size} />
          ))}
          <Avatar name="Niamh Walsh" src="/no-such-photo.jpg" />
        </Row>
      </Section>

      <Section title="Pane and Surface">
        <div className="flex flex-wrap gap-4">
          <Pane className="min-w-72 flex-1">
            <p className="m-0">Pane, card</p>
          </Pane>
          <Pane kind="sunken" className="min-w-72 flex-1">
            <p className="m-0">Pane, sunken</p>
          </Pane>
          <Pane standing className="min-w-72 flex-1">
            <p className="m-0">Pane, standing</p>
          </Pane>
          <div className="min-w-72 flex-1 rounded-surface bg-sea p-5">
            <Surface>
              <p className="m-0">Surface: glass, over the map</p>
            </Surface>
          </div>
        </div>
      </Section>

      <Section title="Field, TextInput, TextArea, Select">
        <div className="flex flex-wrap gap-4">
          <Field
            className="min-w-72 flex-1"
            label="Title"
            hint="Up to 120 characters"
            htmlFor="g-title"
          >
            <TextInput id="g-title" placeholder="What is it about?" />
          </Field>
          <Field className="min-w-72 flex-1" label="Price" htmlFor="g-price">
            <TextInput id="g-price" prefix="€" inputMode="numeric" active />
          </Field>
          <Field
            className="min-w-72 flex-1"
            label="Title"
            error="Give the thread a title"
            htmlFor="g-bad"
          >
            <TextInput id="g-bad" defaultValue="" aria-invalid />
          </Field>
          <Field className="min-w-72 flex-1" label="Disabled" htmlFor="g-off">
            <TextInput id="g-off" defaultValue="Dollymount" disabled />
          </Field>
          <Field
            className="min-w-72 flex-1"
            label="Channel"
            htmlFor="g-channel"
          >
            <Select id="g-channel" defaultValue="gear">
              <option value="gear">Gear talk</option>
              <option value="spots">Spots</option>
            </Select>
          </Field>
          <Field
            className="min-w-72 flex-1"
            label="Condition"
            hint="Filtering"
            htmlFor="g-condition"
          >
            <Select id="g-condition" defaultValue="used" active>
              <option value="">Any</option>
              <option value="used">Used</option>
            </Select>
          </Field>
          <Field
            className="min-w-72 flex-1"
            label="Channel"
            error="Choose a channel"
            htmlFor="g-nochan"
          >
            <Select id="g-nochan" defaultValue="">
              <option value="">Choose…</option>
            </Select>
          </Field>
          <Field
            className="min-w-72 flex-1"
            label="Disabled"
            htmlFor="g-seloff"
          >
            <Select id="g-seloff" disabled defaultValue="a">
              <option value="a">Nothing to choose</option>
            </Select>
          </Field>
          <Field className="min-w-72 flex-1" label="Message" htmlFor="g-body">
            <TextArea id="g-body" placeholder="Say it plainly…" />
          </Field>
          <Field
            className="min-w-72 flex-1"
            label="Message"
            error="Write something first"
            htmlFor="g-nobody"
          >
            <TextArea id="g-nobody" />
          </Field>
        </div>
      </Section>

      <Section title="Checkbox">
        <Row label="off, on, and disabled either way">
          <Checkbox
            checked={whatsapp}
            onChange={(event) => setWhatsapp(event.target.checked)}
          >
            Buyers can message this number
          </Checkbox>
          <Checkbox defaultChecked={false} disabled>
            Add a phone number first
          </Checkbox>
          <Checkbox defaultChecked disabled>
            On, and not yours to turn off
          </Checkbox>
        </Row>
      </Section>

      <Section title="SearchField">
        <Row label="size, and busy">
          <SearchField
            aria-label="Search threads"
            placeholder="Search threads"
          />
          <SearchField
            aria-label="Search gear"
            placeholder="Search gear"
            size="md"
          />
          <SearchField
            aria-label="Search, busy"
            defaultValue="foil mast"
            busy
          />
          <SearchField
            aria-label="Search gear, the page's own"
            placeholder="Search by brand, model or size"
            size="hero"
          />
        </Row>
      </Section>

      <Section title="Segmented">
        <Row label="row">
          <Segmented
            aria-label="Sort threads"
            value={sort}
            onChange={setSort}
            options={[
              { value: "latest", label: "Latest" },
              { value: "unread", label: "Unread" },
            ]}
          />
        </Row>
        <Row label="stack, with one disabled">
          <Segmented
            stack
            aria-label="Notify me"
            value={notify}
            onChange={setNotify}
            options={[
              { value: "all", label: "Every reply" },
              { value: "mentions", label: "Mentions only" },
              { value: "none", label: "Nothing", disabled: true },
            ]}
          />
        </Row>
      </Section>

      <Section title="Notice">
        <Notice>Your listing is saved as a draft.</Notice>
        <Notice kind="warn">
          You are offline. What you write is kept until you are back.
        </Notice>
      </Section>

      <Section title="Empty">
        <div className="flex flex-wrap gap-4">
          <Empty
            className="min-w-72 flex-1"
            title="No threads here yet"
            icon={<Wind size={24} />}
          >
            <p className="m-0">Be the first to start one.</p>
            <Button variant="pill">New thread</Button>
          </Empty>
          <Empty
            className="min-w-72 flex-1"
            kind="warn"
            title="This could not be loaded"
          >
            <p className="m-0">The connection dropped.</p>
            <Button variant="pill">Try again</Button>
          </Empty>
        </div>
      </Section>

      <Section title="Pager">
        <Pager page={page} pageSize={20} total={58} onPage={setPage} />
        <Pager page={1} pageSize={20} total={58} onPage={() => {}} />
      </Section>

      <Section title="Skeleton">
        <div className="grid gap-3" aria-busy="true">
          <div className="flex items-center gap-3">
            <Skeleton shape="circle" />
            <div className="grid flex-1 gap-2">
              <Skeleton />
              <Skeleton className="w-2/3" />
            </div>
          </div>
          <Skeleton shape="block" />
        </div>
      </Section>

      <Section title="Dialog and ConfirmDialog">
        <Row label="openers: focus comes back to the one that was used">
          <Button variant="pill" onClick={() => setDialog("plain")}>
            Open a dialog
          </Button>
          <Button variant="pill" onClick={() => setDialog("wide")}>
            Open a wide dialog
          </Button>
          <Button variant="pill" onClick={() => setDialog("confirm")}>
            Open a confirm dialog
          </Button>
        </Row>
        <Dialog
          open={dialog === "plain"}
          title="Follow this channel?"
          onClose={() => setDialog(null)}
          actions={
            <>
              <Button variant="pill" onClick={() => setDialog(null)}>
                Not now
              </Button>
              <Button variant="primary" onClick={() => setDialog(null)}>
                Follow
              </Button>
            </>
          }
        >
          New threads in Gear talk will show under your bell.
        </Dialog>
        <Dialog
          open={dialog === "wide"}
          size="wide"
          title="New thread"
          onClose={() => setDialog(null)}
          actions={
            <Button variant="primary" onClick={() => setDialog(null)}>
              Post thread
            </Button>
          }
        >
          <Field
            className="min-w-72 flex-1"
            label="Title"
            htmlFor="g-dialog-title"
          >
            <TextInput id="g-dialog-title" />
          </Field>
          <Field
            className="min-w-72 flex-1"
            label="Message"
            htmlFor="g-dialog-body"
          >
            <TextArea id="g-dialog-body" />
          </Field>
        </Dialog>
        <ConfirmDialog
          open={dialog === "confirm"}
          title="Delete this listing?"
          confirmLabel={busy ? "Deleting…" : "Delete listing"}
          busy={busy}
          onCancel={() => setDialog(null)}
          onConfirm={() => {
            setBusy(true);
            window.setTimeout(() => {
              setBusy(false);
              setDialog(null);
            }, 1200);
          }}
        >
          Its photos go with it. This cannot be undone.
        </ConfirmDialog>
      </Section>

      <Section title="Gust, the companion">
        <Row label="Moods">
          {GUST_MOODS.map((mood) => (
            <figure key={mood} className="m-0 grid justify-items-center gap-1">
              <Gust mood={mood} size={88} />
              <figcaption className="text-caption text-ink-muted">
                {mood}
              </figcaption>
            </figure>
          ))}
        </Row>
        <Row label="At launcher size">
          {GUST_MOODS.map((mood) => (
            <Gust key={mood} mood={mood} size={46} />
          ))}
        </Row>
        <Row label="Spot card">
          <div className="w-full max-w-dialog">
            <SpotCard
              onShow={() => {}}
              card={{
                kind: "spot",
                id: "brandon",
                name: "Brandon Bay",
                county: "Kerry",
                best: {
                  from: "2026-10-04T13:00:00Z",
                  to: "2026-10-04T17:00:00Z",
                  local: "Sat, 4 Oct, 14:00–18:00",
                  stars: 4,
                  potential: 5,
                  wind_kn: 18,
                  gust_kn: 24,
                  direction: "WSW",
                  direction_deg: 248,
                  wing_m2: 5,
                  own_wing_m2: 5,
                  session: "Powered up",
                  shore: "cross-offshore",
                  agreement: "moderate",
                },
                windows: [
                  {
                    from: "2026-10-05T09:00:00Z",
                    to: "2026-10-05T12:00:00Z",
                    local: "Sun, 5 Oct, 10:00–13:00",
                    stars: 3,
                  },
                ],
                rider: { weightKg: 80, assumed: true, skill: "intermediate" },
                note: null,
              }}
            />
          </div>
        </Row>
      </Section>
    </main>
  );
}
