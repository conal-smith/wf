/**
 * Starting a thread: a dialog over the channel it will land in, or over home,
 * asked for by `?new=1` so that a sign-in on the way comes back to it. A title,
 * tags, what you want to say; a spot and photos are optional. Post thread is
 * the dialog's one filled action.
 */
import { Hash, ImagePlus, Plus, X } from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { useSiteAuth, type SiteAuth } from "../../../shared/web/auth";
import {
  Button,
  Dialog,
  Field,
  Notice,
  Select,
  TextArea,
  TextInput,
} from "../../../ui";
import { RING, tv } from "../../../ui/tv";
import { LIMITS, type Channel, type ThreadInput } from "../../shared/types";
import { threadInputSchema } from "../../shared/validate";
import { ApiRequestError, useApi } from "../api";
import {
  NEW_THREAD,
  navigate,
  paths,
  routed,
  withoutNewThread,
} from "../router";

export const newThreadStyles = tv({
  slots: {
    form: "grid gap-5",
    where: "m-0 flex flex-wrap items-center gap-1 text-body text-ink-muted",
    channel: "inline-flex items-center gap-0.5 font-semibold text-ink-2",
    tags: "flex flex-wrap gap-1",
    tag: "text-body",
    photos: "m-0 flex list-none flex-wrap gap-2 p-0",
    photo: "relative h-18 w-24 overflow-hidden rounded-control bg-sunken",
    image: "size-full object-cover",
    remove: "absolute top-1 right-1 bg-card shadow-control",
    failed:
      "absolute inset-x-0 bottom-0 bg-warn-ground px-1 text-center text-caption text-warn",
    add: [
      "grid h-18 w-24 cursor-pointer place-items-center rounded-control border-2 border-dashed border-line-strong bg-ground text-ink-muted",
      "transition-colors duration-fast not-disabled:hover:border-ink-muted not-disabled:hover:text-ink",
      "disabled:cursor-default disabled:opacity-100",
      RING,
    ],
    file: "hidden",
    // The way in on a phone, where the header does not carry one.
    fab: "fixed right-3 bottom-5 z-popover shadow-marker rail:hidden",
  },
  variants: {
    // Still on its way to storage.
    busy: { true: { image: "animate-pulse motion-reduce:animate-none" } },
    on: { false: { tag: "font-normal shadow-none" } },
  },
});

/** What `?new=1` comes to for this reader, right now. */
export type NewThreadStep =
  /** Nobody asked, or nobody can answer: no provider is configured. */
  | "closed"
  /** The provider has not yet said whether there is a session. */
  | "wait"
  | "sign-in"
  | "dialog";

export function newThreadStep(
  asked: boolean,
  auth: Pick<SiteAuth, "provider" | "loaded" | "signedIn">,
): NewThreadStep {
  if (!asked || auth.provider === "none") return "closed";
  if (!auth.loaded) return "wait";
  return auth.signedIn ? "dialog" : "sign-in";
}

/** A tag pressed: off if it was on, on if there is room for it. */
export function toggleTag(
  picked: readonly string[],
  id: string,
  max: number = LIMITS.tagsPerThread,
): string[] {
  if (picked.includes(id)) return picked.filter((tag) => tag !== id);
  return picked.length < max ? [...picked, id] : [...picked];
}

/** The channels a member can start a thread in from home: the open, live ones. */
export function postable(channels: readonly Channel[]): Channel[] {
  return channels.filter(
    (channel) =>
      channel.postPolicy === "everyone" && channel.status === "active",
  );
}

/** A riding location, as public/riding-locations.json holds one. */
export interface Spot {
  id: string;
  name: string;
  county: string;
}

export const spotLabel = (spot: Spot) => `${spot.name}, Co. ${spot.county}`;

/** The spots in the order a reader looks for one: by name. */
export function spotOptions(spots: readonly Spot[]): Spot[] {
  return [...spots].sort((a, b) => a.name.localeCompare(b.name, "en-IE"));
}

const FIELDS = ["title", "tagIds", "body", "photoKeys", "spotId"] as const;
type FieldName = (typeof FIELDS)[number];
export type FieldErrors = Partial<Record<FieldName, string>>;

/**
 * What a refused post says, field by field, from the API's `details` map. It is
 * keyed by the input's own names, which are the form's. A value is one of two
 * things: what is wrong with the field, in words, or the part of the field that
 * was refused (a tag's id, a photo's key), in which case the words are the
 * reply's own message. `top` is what is left to say above the form: the message,
 * when no field has taken it.
 */
export function fieldErrors(
  error: { message: string; details?: Record<string, string> },
  sent: ThreadInput,
): { fields: FieldErrors; top: string | null } {
  const fields: FieldErrors = {};
  let placed = false;
  let stray = false;
  for (const [name, detail] of Object.entries(error.details ?? {})) {
    if (!(FIELDS as readonly string[]).includes(name)) {
      stray = true;
      continue;
    }
    const field = name as FieldName;
    const echo = echoes(detail, sent[field]);
    fields[field] = echo ? error.message : detail;
    placed ||= echo;
  }
  const named = Object.keys(fields).length > 0;
  return { fields, top: placed || (named && !stray) ? null : error.message };
}

/** Whether a detail is a piece of what was sent, not a sentence about it. */
function echoes(detail: string, sent: ThreadInput[FieldName]): boolean {
  const parts = detail.split(", ").filter(Boolean);
  if (!parts.length || sent == null) return false;
  return parts.every((part) => sent.includes(part));
}

/** The same check the API makes, made first so most mistakes never leave the page. */
export function checkThread(input: ThreadInput): FieldErrors {
  const parsed = threadInputSchema.safeParse(input);
  if (parsed.success) return {};
  const fields: FieldErrors = {};
  for (const issue of parsed.error.issues) {
    const name = String(issue.path[0]);
    if ((FIELDS as readonly string[]).includes(name))
      fields[name as FieldName] ??= issue.message;
  }
  return fields;
}

interface PhotoItem {
  localId: string;
  url: string;
  key?: string;
  busy: boolean;
  error?: string;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "That did not work. Try again.";

export interface NewThreadProps {
  /** The page's URL, from `useLocation`: `?new=1` in it is the asking. */
  pathname: string;
  search: URLSearchParams;
  /** The channel the dialog is over. Null over home, where one is picked. */
  channel: Channel | null;
  /** Every channel, for the pick over home. */
  channels: readonly Channel[];
  /** A thread went up: what the shell holds (a channel's counts) is now behind. */
  onPosted: () => void;
}

/**
 * The way to the dialog. Signed out, asking for it opens sign-in instead.
 * Sign-in comes back to the URL it was opened from (shared/web/auth.tsx), which
 * is still asking, so the dialog is what the member arrives to. The page's own
 * URL then stops asking: a reader who shuts the sign-in is back where they
 * were, with New thread there to press again.
 */
export function NewThread({
  pathname,
  search,
  channel,
  channels,
  onPosted,
}: NewThreadProps) {
  const auth = useSiteAuth();
  const step = newThreadStep(search.has(NEW_THREAD), auth);
  const signIn = useRef(auth.signIn);
  signIn.current = auth.signIn;
  const close = () =>
    navigate(withoutNewThread(pathname, search), { replace: true });
  // Once for each asking. `search` is a new object after every navigation, and
  // an effect run twice over, as a strict render runs it, sees the same one: a
  // second sign-in would be opened from the URL that has stopped asking.
  const answered = useRef<URLSearchParams | null>(null);
  useEffect(() => {
    if (step !== "sign-in" || answered.current === search) return;
    answered.current = search;
    signIn.current();
    close();
  });
  if (step !== "dialog") return null;
  return (
    <NewThreadDialog
      channel={channel}
      channels={channels}
      onClose={close}
      onPosted={onPosted}
    />
  );
}

function NewThreadDialog({
  channel,
  channels,
  onClose,
  onPosted,
}: {
  channel: Channel | null;
  channels: readonly Channel[];
  onClose: () => void;
  onPosted: () => void;
}) {
  const api = useApi();
  const auth = useSiteAuth();
  const styles = newThreadStyles();
  const formId = useId();
  const ids = { title: useId(), body: useId(), spot: useId(), into: useId() };

  const choices = postable(channels);
  const [slug, setSlug] = useState(channel?.slug ?? "");
  const into = channel ?? choices.find((c) => c.slug === slug) ?? null;

  const [title, setTitle] = useState("");
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [body, setBody] = useState("");
  const [spotId, setSpotId] = useState("");
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [spots, setSpots] = useState<Spot[]>([]);
  const [errors, setErrors] = useState<FieldErrors & { into?: string }>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [posting, setPosting] = useState(false);
  // A field that is being mended stops saying what was wrong with it.
  const mended = (name: keyof typeof errors) =>
    setErrors((now) => (now[name] ? { ...now, [name]: undefined } : now));

  // The spots are the map's own file. Without it the field is simply not drawn.
  useEffect(() => {
    let current = true;
    fetch(`${import.meta.env.BASE_URL}riding-locations.json`)
      .then((reply) => (reply.ok ? reply.json() : []))
      .then(
        (list: Spot[]) => {
          if (current && Array.isArray(list)) setSpots(spotOptions(list));
        },
        () => {},
      );
    return () => {
      current = false;
    };
  }, []);

  const latest = useRef(photos);
  latest.current = photos;
  useEffect(
    () => () => latest.current.forEach((p) => URL.revokeObjectURL(p.url)),
    [],
  );
  const patch = (localId: string, update: Partial<PhotoItem>) =>
    setPhotos((now) =>
      now.map((p) => (p.localId === localId ? { ...p, ...update } : p)),
    );

  // The dialog opens on the first thing to fill in, not on its close button.
  // This runs after the kit's own effect has opened it.
  const firstInput = useRef<HTMLInputElement>(null);
  const firstSelect = useRef<HTMLSelectElement>(null);
  useEffect(() => (firstSelect.current ?? firstInput.current)?.focus(), []);

  const file = useRef<HTMLInputElement>(null);
  const room = LIMITS.photosPerMessage - photos.length;
  const add = async (event: ChangeEvent<HTMLInputElement>) => {
    const picked = Array.from(event.target.files ?? []).slice(
      0,
      Math.max(0, room),
    );
    // Cleared so that picking the same file again is still a change.
    event.target.value = "";
    const items: PhotoItem[] = picked.map((f) => ({
      localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      url: URL.createObjectURL(f),
      busy: true,
    }));
    setPhotos((now) => [...now, ...items]);
    await Promise.all(
      items.map(async (item, i) => {
        try {
          const key = await api.uploadPhoto(picked[i]);
          patch(item.localId, { key, busy: false });
        } catch (e) {
          patch(item.localId, { busy: false, error: errorMessage(e) });
        }
      }),
    );
  };
  const remove = (item: PhotoItem) => {
    URL.revokeObjectURL(item.url);
    setPhotos((now) => now.filter((p) => p.localId !== item.localId));
    mended("photoKeys");
  };

  const uploading = photos.some((p) => p.busy);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (posting || uploading) return;
    setFailure(null);
    const input: ThreadInput = {
      title,
      body,
      tagIds,
      photoKeys: photos.flatMap((p) => (p.key ? [p.key] : [])),
      spotId: spotId || null,
    };
    const found: typeof errors = checkThread(input);
    if (!into) found.into = "Pick the channel this belongs in";
    setErrors(found);
    if (!into || Object.values(found).some(Boolean)) return;
    setPosting(true);
    try {
      const thread = await api.createThread(into.slug, input);
      onPosted();
      // In place of the URL that asked for the dialog: Back from the thread is
      // the list it was started from, not an empty form.
      navigate(paths.thread(thread.id, thread.slug), { replace: true });
    } catch (e) {
      const { fields, top } =
        e instanceof ApiRequestError
          ? fieldErrors(e, input)
          : { fields: {}, top: errorMessage(e) };
      setErrors(fields);
      setFailure(top);
      setPosting(false);
    }
  };

  return (
    <Dialog
      open
      size="wide"
      title="Start a thread"
      busy={posting}
      onClose={onClose}
      actions={
        <>
          <Button variant="pill" disabled={posting} onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            variant="primary"
            disabled={posting || uploading}
          >
            {posting ? "Posting…" : "Post thread"}
          </Button>
        </>
      }
    >
      <form id={formId} className={styles.form()} onSubmit={submit} noValidate>
        <p className={styles.where()}>
          {channel && (
            <>
              <span>in</span>
              <span className={styles.channel()}>
                <Hash size={13} aria-hidden="true" />
                {channel.name}
              </span>
              {auth.identity.name && <span aria-hidden="true">·</span>}
            </>
          )}
          {auth.identity.name && <span>posting as {auth.identity.name}</span>}
        </p>

        {failure && <Notice kind="warn">{failure}</Notice>}

        {!channel && (
          <Field label="Channel" htmlFor={ids.into} error={errors.into}>
            <Select
              ref={firstSelect}
              id={ids.into}
              value={slug}
              aria-invalid={errors.into ? true : undefined}
              onChange={(e) => {
                setSlug(e.target.value);
                // A tag belongs to its channel, and does not follow to another.
                setTagIds([]);
                mended("into");
              }}
            >
              <option value="">Pick a channel</option>
              {choices.map((c) => (
                <option key={c.id} value={c.slug}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field
          label="Title"
          hint={`${title.length} / ${LIMITS.titleMax}`}
          htmlFor={ids.title}
          error={errors.title}
        >
          <TextInput
            ref={firstInput}
            id={ids.title}
            value={title}
            maxLength={LIMITS.titleMax}
            aria-invalid={errors.title ? true : undefined}
            onChange={(e) => {
              setTitle(e.target.value);
              mended("title");
            }}
          />
        </Field>

        {into && into.tags.length > 0 && (
          <Field
            label="Tags"
            hint={`Up to ${LIMITS.tagsPerThread}`}
            error={errors.tagIds}
          >
            <div className={styles.tags()} role="group" aria-label="Tags">
              {[...into.tags]
                .sort((a, b) => a.position - b.position)
                .map((tag) => {
                  const on = tagIds.includes(tag.id);
                  return (
                    <Button
                      key={tag.id}
                      variant="pill"
                      size="sm"
                      pressed={on}
                      // Three are picked: a fourth has to take one's place.
                      disabled={!on && tagIds.length >= LIMITS.tagsPerThread}
                      className={newThreadStyles({ on }).tag()}
                      onClick={() => {
                        setTagIds(toggleTag(tagIds, tag.id));
                        mended("tagIds");
                      }}
                    >
                      {tag.label}
                    </Button>
                  );
                })}
            </div>
          </Field>
        )}

        <Field
          label="What’s on your mind?"
          htmlFor={ids.body}
          error={errors.body}
        >
          <TextArea
            id={ids.body}
            value={body}
            maxLength={LIMITS.bodyMax}
            aria-invalid={errors.body ? true : undefined}
            onChange={(e) => {
              setBody(e.target.value);
              mended("body");
            }}
          />
        </Field>

        <Field
          label="Photos"
          hint={`Optional, up to ${LIMITS.photosPerMessage}`}
          error={errors.photoKeys}
        >
          <ul className={styles.photos()}>
            {photos.map((photo, i) => (
              <li key={photo.localId} className={styles.photo()}>
                <img
                  className={newThreadStyles({ busy: photo.busy }).image()}
                  src={photo.url}
                  alt={`Photo ${i + 1}`}
                />
                {photo.error && (
                  <span className={styles.failed()} role="alert">
                    {photo.error}
                  </span>
                )}
                <Button
                  variant="pill"
                  size="sm"
                  icon
                  aria-label={`Remove photo ${i + 1}`}
                  className={styles.remove()}
                  onClick={() => remove(photo)}
                >
                  <X size={14} aria-hidden="true" />
                </Button>
              </li>
            ))}
            {room > 0 && (
              <li>
                <button
                  type="button"
                  className={styles.add()}
                  aria-label="Add photos"
                  onClick={() => file.current?.click()}
                >
                  <ImagePlus size={20} aria-hidden="true" />
                </button>
              </li>
            )}
          </ul>
          <input
            ref={file}
            className={styles.file()}
            type="file"
            accept="image/*"
            multiple
            tabIndex={-1}
            aria-hidden="true"
            onChange={add}
          />
        </Field>

        {spots.length > 0 && (
          <Field
            label="Spot"
            hint="Optional. Shows the live wind on your thread."
            htmlFor={ids.spot}
            error={errors.spotId}
          >
            <Select
              id={ids.spot}
              value={spotId}
              onChange={(e) => {
                setSpotId(e.target.value);
                mended("spotId");
              }}
            >
              <option value="">No spot</option>
              {spots.map((spot) => (
                <option key={spot.id} value={spot.id}>
                  {spotLabel(spot)}
                </option>
              ))}
            </Select>
          </Field>
        )}
      </form>
    </Dialog>
  );
}

export interface NewThreadPillProps {
  /** `paths.newThread`, for the channel that is open. */
  to: string;
}

/** The floating New thread of a phone's list: the view's filled action there. */
export function NewThreadPill({ to }: NewThreadPillProps) {
  const styles = newThreadStyles();
  return (
    <Button
      {...routed(to)}
      variant="primary"
      size="lg"
      className={styles.fab()}
    >
      <Plus size={18} aria-hidden="true" />
      New thread
    </Button>
  );
}
