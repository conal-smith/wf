/**
 * A member: their face, name, handle, county and bio, and the threads they
 * started. Public, like the threads. On your own there are two things more: the
 * form that edits the profile, and the one setting following has.
 *
 * The row is the site's (`/api/me`), one for the marketplace and the community.
 * How to reach someone is the marketplace's business and is neither shown nor
 * edited here; it is sent back as it came, because that PUT resets what it is
 * not sent.
 */
import { CloudOff, Compass, MessagesSquare, Pencil } from "lucide-react";
import { useEffect, useId, useState, type FormEvent } from "react";
import { useSiteAuth } from "../../../shared/web/auth";
import { usePageTitle } from "../../../shared/web/usePageTitle";
import {
  COUNTIES,
  USER_LIMITS,
  type County,
  type User,
  type UserInput,
} from "../../../site/shared/types";
import { userInputSchema } from "../../../site/shared/validate";
import {
  Avatar,
  Button,
  Chip,
  Empty,
  Field,
  Notice,
  Pane,
  Select,
  Skeleton,
  TextArea,
  TextInput,
} from "../../../ui";
import { RING, tv } from "../../../ui/tv";
import type { MemberProfile } from "../../shared/types";
import { ApiRequestError, useApi } from "../api";
import { MembersOnly } from "../components/MembersOnly";
import { ThreadList } from "../components/ThreadList";
import { useMember } from "../hooks";
import { ME, SETTINGS_ID, navigate, paths, routed } from "../router";

export const profileStyles = tv({
  slots: {
    head: "flex items-start gap-5 max-rail:gap-3",
    text: "grid min-w-0 flex-1 gap-2",
    name: "m-0 flex flex-wrap items-center gap-2 text-title text-ink",
    meta: "m-0 text-body text-ink-muted",
    bio: "m-0 max-w-reading text-prose whitespace-pre-line text-ink-2",
    section: "m-0 text-lead text-ink",
    form: "grid gap-5",
    pair: "grid gap-5 rail:grid-cols-2",
    actions: "flex flex-wrap items-center justify-end gap-2",
    edit: "self-start",
    // The whole row is the switch: a target a thumb finds.
    setting: [
      "flex min-h-touch w-full cursor-pointer items-center justify-between gap-5 rounded-control border-0 bg-transparent p-0 text-left font-body text-ink",
      "disabled:cursor-default",
      RING,
    ],
    settingText: "grid min-w-0 gap-1",
    settingTitle: "text-prose font-semibold text-ink",
    settingHint: "text-body text-ink-muted",
    state:
      "flex shrink-0 items-center gap-2 text-body font-semibold text-ink-2",
    track:
      "inline-flex h-6 w-11 items-center rounded-full border border-line-strong bg-sunken px-0.5 transition-colors duration-fast",
    thumb:
      "size-4.5 rounded-full bg-card shadow-control transition-transform duration-fast motion-reduce:transition-none",
    loading: "grid gap-3",
    short: "w-1/3",
    hidden: "sr-only",
  },
  variants: {
    // On is the thumb across, a filled track and the word: never colour alone.
    on: {
      true: {
        track: "border-transparent bg-inverse",
        thumb: "translate-x-5",
      },
    },
  },
});

const monthAndYear = new Intl.DateTimeFormat("en-IE", {
  month: "long",
  year: "numeric",
});

/** "@aoife-k · Dublin · Joined September 2026". */
export function memberLine(
  member: Pick<MemberProfile, "handle" | "county" | "joinedAt">,
): string {
  return [
    `@${member.handle}`,
    member.county,
    `Joined ${monthAndYear.format(new Date(member.joinedAt))}`,
  ]
    .filter(Boolean)
    .join(" · ");
}

/** What the profile form edits. The rest of the row is not this page's. */
export interface ProfileDraft {
  displayName: string;
  handle: string;
  county: County | null;
  bio: string;
}

export const draftOf = (user: User): ProfileDraft => ({
  displayName: user.displayName,
  handle: user.handle,
  county: user.county,
  bio: user.bio ?? "",
});

/**
 * The whole row, as PUT /api/me wants it, with what this page changed laid over
 * it. That PUT resets a contact field it is not sent, so how buyers reach this
 * member goes back exactly as it came.
 */
export function profileInput(
  user: User,
  changes: Partial<ProfileDraft> & { autoFollow?: boolean },
): UserInput {
  return {
    displayName: user.displayName,
    handle: user.handle,
    county: user.county,
    bio: user.bio,
    contactEmail: user.contactEmail,
    contactPhone: user.contactPhone,
    contactWhatsapp: user.contactWhatsapp,
    autoFollow: user.autoFollow,
    ...changes,
  };
}

const FIELDS = ["displayName", "handle", "county", "bio"] as const;
type FieldName = (typeof FIELDS)[number];
export type ProfileErrors = Partial<Record<FieldName, string>>;

/** The same check the API makes, made first so most mistakes never leave the page. */
export function checkProfile(input: UserInput): ProfileErrors {
  const parsed = userInputSchema.safeParse(input);
  if (parsed.success) return {};
  const fields: ProfileErrors = {};
  for (const issue of parsed.error.issues) {
    const name = String(issue.path[0]);
    if ((FIELDS as readonly string[]).includes(name))
      fields[name as FieldName] ??= issue.message;
  }
  return fields;
}

/** What a refused save says, under the fields it names; the rest goes on top. */
export function saveErrors(error: unknown): {
  fields: ProfileErrors;
  top: string | null;
} {
  const fields: ProfileErrors = {};
  if (error instanceof ApiRequestError)
    for (const [name, detail] of Object.entries(error.details ?? {}))
      if ((FIELDS as readonly string[]).includes(name))
        fields[name as FieldName] = detail;
  const message =
    error instanceof Error ? error.message : "That did not work. Try again.";
  return { fields, top: Object.keys(fields).length ? null : message };
}

export interface ProfileProps {
  handle: string;
}

export function Profile({ handle }: ProfileProps) {
  // `me` is nobody's handle: it is whoever is asking.
  if (handle === ME)
    return (
      <MembersOnly what="your profile">
        <Mine />
      </MembersOnly>
    );
  return <Member key={handle} handle={handle} />;
}

const Loading = ({ what }: { what: string }) => {
  const styles = profileStyles();
  return (
    <div className={styles.loading()} aria-busy="true">
      <span className={styles.hidden()}>Loading {what}…</span>
      <Skeleton className={styles.short()} />
      <Skeleton />
    </div>
  );
};

/** Finds out who is asking, and goes to their profile, keeping the part of it asked for. */
function Mine() {
  const api = useApi();
  const [failure, setFailure] = useState<string | null>(null);
  usePageTitle("Your profile", "Community");
  useEffect(() => {
    let current = true;
    api.me().then(
      (user) => {
        if (current)
          navigate(paths.member(user.handle) + location.hash, {
            replace: true,
          });
      },
      (error: unknown) => {
        if (current)
          setFailure(
            error instanceof Error
              ? error.message
              : "Your profile could not be loaded.",
          );
      },
    );
    return () => {
      current = false;
    };
  }, [api]);
  if (failure) return <Notice kind="warn">{failure}</Notice>;
  return <Loading what="your profile" />;
}

function Member({ handle }: ProfileProps) {
  const auth = useSiteAuth();
  const styles = profileStyles();
  const { state, reload, loadMore } = useMember(handle);
  usePageTitle(
    state.status === "ready" ? state.member.displayName : "Member",
    "Community",
  );

  if (state.status === "loading") return <Loading what="the profile" />;
  if (state.status === "missing")
    return (
      <Empty
        title="That member does not exist"
        icon={<Compass size={24} aria-hidden="true" />}
      >
        <p>The link may be old, or they may have changed their handle.</p>
        <Button {...routed(paths.home())} variant="pill">
          Back to the community
        </Button>
      </Empty>
    );
  if (state.status === "error")
    return (
      <Empty
        kind="warn"
        title="We could not load this profile"
        icon={<CloudOff size={24} aria-hidden="true" />}
      >
        <p role="alert">{state.message}</p>
        <Button variant="pill" onClick={reload}>
          Try again
        </Button>
      </Empty>
    );

  const { member, threads } = state;
  const own = auth.signedIn && auth.userId === member.id;
  return (
    <>
      <div className={styles.head()}>
        <Avatar name={member.displayName} src={member.avatarUrl} size="lg" />
        <div className={styles.text()}>
          <h1 className={styles.name()}>
            {member.displayName}
            {member.role === "staff" && <Chip>Staff</Chip>}
          </h1>
          <p className={styles.meta()}>{memberLine(member)}</p>
          {member.bio && <p className={styles.bio()}>{member.bio}</p>}
        </div>
      </div>
      {own && <Own onSaved={reload} />}
      <h2 className={styles.section()}>
        {own ? "Threads you started" : `Threads ${member.displayName} started`}
      </h2>
      <ThreadList
        state={threads}
        subject="their threads"
        showChannel
        onRetry={reload}
        onMore={loadMore}
        empty={
          <Empty
            title="No threads yet"
            icon={<MessagesSquare size={24} aria-hidden="true" />}
          >
            <p>
              {own
                ? "The threads you start are listed here."
                : "They have not started one."}
            </p>
          </Empty>
        }
      />
    </>
  );
}

/**
 * What only the member sees on their own profile. It reads their whole row,
 * which the public profile does not carry.
 */
function Own({ onSaved }: { onSaved: () => void }) {
  const api = useApi();
  const styles = profileStyles();
  const [user, setUser] = useState<User | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    api.me().then(
      (row) => {
        if (current) setUser(row);
      },
      (error: unknown) => {
        if (current)
          setFailure(
            error instanceof Error
              ? error.message
              : "Your settings could not be loaded.",
          );
      },
    );
    return () => {
      current = false;
    };
  }, [api]);

  // The bell's settings link lands on the switch, once there is one to land on.
  const ready = user !== null;
  useEffect(() => {
    if (!ready || location.hash !== `#${SETTINGS_ID}`) return;
    const setting = document.getElementById(SETTINGS_ID);
    setting?.scrollIntoView({ block: "center" });
    setting?.focus();
  }, [ready]);

  if (failure) return <Notice kind="warn">{failure}</Notice>;
  if (!user) return <Loading what="your settings" />;

  const setAutoFollow = async (on: boolean) => {
    setSaving(true);
    setFailure(null);
    try {
      setUser(await api.updateMe(profileInput(user, { autoFollow: on })));
    } catch (e) {
      setFailure(
        e instanceof Error ? e.message : "That did not work. Try again.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {editing ? (
        <Pane>
          <ProfileForm
            user={user}
            onCancel={() => setEditing(false)}
            onSaved={(saved) => {
              setUser(saved);
              setEditing(false);
              // A new handle is a new URL; the old one now names nobody.
              if (saved.handle !== user.handle)
                navigate(paths.member(saved.handle), { replace: true });
              else onSaved();
            }}
          />
        </Pane>
      ) : (
        <Button
          variant="pill"
          size="sm"
          className={styles.edit()}
          onClick={() => setEditing(true)}
        >
          <Pencil size={15} aria-hidden="true" />
          <span>Edit profile</span>
        </Button>
      )}
      <Pane>
        <FollowSwitch
          on={user.autoFollow}
          disabled={saving}
          onChange={setAutoFollow}
        />
      </Pane>
    </>
  );
}

/**
 * autoFollow, the one setting following has (D19): a switch, where the bell's
 * settings link lands.
 */
export function FollowSwitch({
  on,
  disabled,
  onChange,
}: {
  on: boolean;
  disabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  const styles = profileStyles();
  const id = useId();
  return (
    <button
      type="button"
      role="switch"
      id={SETTINGS_ID}
      aria-checked={on}
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-hint`}
      disabled={disabled}
      className={styles.setting()}
      onClick={() => onChange(!on)}
    >
      <span className={styles.settingText()}>
        <span className={styles.settingTitle()} id={`${id}-title`}>
          Follow threads I start or reply to
        </span>
        <span className={styles.settingHint()} id={`${id}-hint`}>
          The bell tells you about replies to a thread you follow. Off, a thread
          is followed only when you press Follow on it.
        </span>
      </span>
      <span className={styles.state()} aria-hidden="true">
        {on ? "On" : "Off"}
        <span className={styles.track({ on })}>
          <span className={styles.thumb({ on })} />
        </span>
      </span>
    </button>
  );
}

function ProfileForm({
  user,
  onCancel,
  onSaved,
}: {
  user: User;
  onCancel: () => void;
  onSaved: (user: User) => void;
}) {
  const api = useApi();
  const styles = profileStyles();
  const id = useId();
  const [draft, setDraft] = useState(() => draftOf(user));
  const [errors, setErrors] = useState<ProfileErrors>({});
  const [top, setTop] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const set = (changes: Partial<ProfileDraft>) =>
    setDraft((was) => ({ ...was, ...changes }));

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const input = profileInput(user, draft);
    const found = checkProfile(input);
    setErrors(found);
    setTop(null);
    if (Object.keys(found).length) return;
    setSaving(true);
    try {
      onSaved(await api.updateMe(input));
    } catch (e) {
      const refused = saveErrors(e);
      setErrors(refused.fields);
      setTop(refused.top);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className={styles.form()} onSubmit={submit} noValidate>
      {top && <Notice kind="warn">{top}</Notice>}
      <div className={styles.pair()}>
        <Field
          label="Name"
          htmlFor={`${id}-name`}
          error={errors.displayName}
          hint={`${draft.displayName.length}/${USER_LIMITS.displayNameMax}`}
        >
          <TextInput
            id={`${id}-name`}
            value={draft.displayName}
            maxLength={USER_LIMITS.displayNameMax}
            autoComplete="name"
            onChange={(e) => set({ displayName: e.target.value })}
          />
        </Field>
        <Field
          label="Handle"
          htmlFor={`${id}-handle`}
          error={errors.handle}
          hint="For @mentions and this page’s address"
        >
          <TextInput
            id={`${id}-handle`}
            prefix="@"
            value={draft.handle}
            maxLength={USER_LIMITS.handleMax}
            autoCapitalize="none"
            spellCheck={false}
            onChange={(e) => set({ handle: e.target.value.toLowerCase() })}
          />
        </Field>
      </div>
      <Field label="County" htmlFor={`${id}-county`} error={errors.county}>
        <Select
          id={`${id}-county`}
          value={draft.county ?? ""}
          onChange={(e) =>
            set({ county: (e.target.value || null) as County | null })
          }
        >
          <option value="">Not said</option>
          {COUNTIES.map((county) => (
            <option key={county} value={county}>
              {county}
            </option>
          ))}
        </Select>
      </Field>
      <Field
        label="Bio"
        htmlFor={`${id}-bio`}
        error={errors.bio}
        hint={`${draft.bio.length}/${USER_LIMITS.bioMax}`}
      >
        <TextArea
          id={`${id}-bio`}
          rows={4}
          value={draft.bio}
          maxLength={USER_LIMITS.bioMax}
          onChange={(e) => set({ bio: e.target.value })}
        />
      </Field>
      <div className={styles.actions()}>
        <Button onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        {/* Quiet: the view's one filled action is the header's New thread. */}
        <Button type="submit" variant="pill" disabled={saving}>
          {saving ? "Saving…" : "Save profile"}
        </Button>
      </div>
    </form>
  );
}
