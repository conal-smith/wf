import { ArrowLeft, ArrowRight, Camera, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { Button, Chip } from "../../../ui";
import { buttonStyles } from "../../../ui/Button";
import { RING_WITHIN, tv } from "../../../ui/tv";
import { ApiRequestError, useApi } from "../api";
import { useMarketAuth } from "../auth";
import {
  Field,
  LoadError,
  Notice,
  PageSkeleton,
  Select,
  TextArea,
  TextInput,
  errorMessage,
  pane,
  sharedStyles,
  useAsync,
  usePageTitle,
} from "../components";
import ProfileForm from "./ProfileForm";
import { Link, navigate, paths } from "../router";
import {
  CATEGORIES,
  CONDITIONS,
  COUNTIES,
  CURRENCIES,
  LIMITS,
  type Listing,
  type ListingInput,
  type PhotoInput,
  type Profile,
} from "../../shared/types";
import { hasContact } from "../../../site/shared/types";
import {
  issuesByField,
  listingInputSchema,
  parsePriceInput,
} from "../../shared/validate";

export const sellStyles = tv({
  slots: {
    /** Every section of the form, down the page. */
    page: "flex min-w-0 flex-col gap-6",
    /** What a pane holds, when it is one thing after another. */
    stack: "flex min-w-0 flex-col gap-5",
    /** A heading and whatever explains it. */
    head: "flex flex-col gap-2",
    step: "m-0 text-eyebrow text-ink-muted uppercase",
    title: "m-0 text-title text-balance text-ink",
    lead: "m-0 text-lead text-ink",
    quiet: "m-0 text-ink-muted",
    meta: "m-0 text-body text-ink-muted",
    /** What is wrong with the photographs, which are not a field. */
    error: "m-0 font-sans text-body text-warn",
    divider: "m-0 border-0 border-t border-line",
    /** Who the listing will go out under, beside the button that publishes it. */
    signature: "text-body text-ink-muted",

    // ---- the photo uploader -------------------------------------------------

    /** As many tiles as fit, at a photograph's size. */
    tiles: "grid grid-cols-tiles gap-3",
    tile: "group relative aspect-4/3 overflow-hidden rounded-control bg-sunken",
    /** An upload still on its way is dimmed until it has landed. */
    image: "block size-full object-cover group-data-busy:opacity-50",
    badge: "absolute top-1 left-1",
    tools: "absolute inset-x-1 bottom-1 flex justify-between gap-1",
    reorder: "flex items-center gap-1",
    /*
     * The tools lie on the photograph, so they are glass, as every other mark
     * over a picture in this kit is. ui/ has no glass Button — one page wanting
     * one is not yet a variant — so the recipe says it here, in the kit's own
     * words, including the way out of it for a reader who has declined
     * transparency.
     */
    tool: [
      "border border-card/70 bg-glass backdrop-blur-scrim",
      "reduced-transparency:bg-solid reduced-transparency:backdrop-filter-none",
    ],
    /** The way to add more, in the shape of what it will become. */
    add: [
      "relative grid aspect-4/3 cursor-pointer place-items-center overflow-hidden",
      "rounded-control border-2 border-line-strong border-dashed bg-ground p-2",
      "text-center text-ink-muted transition-colors duration-fast",
      // A label, not a button, so the site's reset never reaches this hover.
      "hover:bg-sunken hover:text-ink data-over:bg-sunken data-over:text-ink",
      RING_WITHIN,
    ],
    addLabel: "flex flex-col items-center gap-1",
    /** The native file input, over the whole tile and invisible on it. */
    addInput: "absolute inset-0 cursor-pointer opacity-0",
  },
});

interface PhotoItem extends PhotoInput {
  /** Local key for React; ids and storage keys are both unique so either serves. */
  localId: string;
  url: string;
  busy?: boolean;
  error?: string;
}

interface FormState {
  title: string;
  category: string;
  condition: string;
  brand: string;
  sizeLabel: string;
  year: string;
  price: string;
  currency: string;
  county: string;
  town: string;
  description: string;
  photos: PhotoItem[];
}

const empty = (defaultCounty: string): FormState => ({
  title: "",
  category: "wing",
  condition: "good",
  brand: "",
  sizeLabel: "",
  year: "",
  price: "",
  currency: "EUR",
  county: defaultCounty,
  town: "",
  description: "",
  photos: [],
});

const fromListing = (l: Listing): FormState => ({
  title: l.title,
  category: l.category,
  condition: l.condition,
  brand: l.brand ?? "",
  sizeLabel: l.sizeLabel ?? "",
  year: l.year ? String(l.year) : "",
  price: (l.priceCents / 100).toString(),
  currency: l.currency,
  county: l.county,
  town: l.town ?? "",
  description: l.description,
  photos: l.photos.map((p) => ({
    localId: p.id,
    id: p.id,
    url: p.url,
    width: p.width,
    height: p.height,
  })),
});

export default function SellPage({ editId }: { editId?: string }) {
  usePageTitle(editId ? "Edit listing" : "Sell your gear");
  const api = useApi();
  const auth = useMarketAuth();
  const me = useAsync(
    () => (auth.signedIn ? api.me() : Promise.resolve(null)),
    [api, auth.signedIn],
  );
  const existing = useAsync(
    () => (editId ? api.getListing(editId) : Promise.resolve(null)),
    [api, editId],
  );

  const styles = sellStyles();
  const shared = sharedStyles();

  if (!auth.loaded || me.loading || (editId && existing.loading)) {
    return <PageSkeleton />;
  }

  if (!auth.signedIn) {
    return (
      <section className={pane(shared.pane(), styles.stack())}>
        <div className={styles.head()}>
          <h1 className={styles.title()}>Sell your gear</h1>
          <p className={styles.quiet()}>
            Sign in so buyers can reach you and so you can manage your listings
            later.
          </p>
        </div>
        {auth.provider === "none" ? (
          <Notice kind="warn">
            Sign-in is not configured on this build (VITE_CLERK_PUBLISHABLE_KEY
            is unset), so listings cannot be created.
          </Notice>
        ) : (
          <div className={shared.formActions()}>
            <Button variant="primary" size="lg" onClick={auth.signIn}>
              Sign in to continue
            </Button>
          </div>
        )}
      </section>
    );
  }

  if (me.error || existing.error || !me.data)
    return (
      <LoadError
        message={me.error ?? existing.error ?? "Try again in a moment."}
        onRetry={() => {
          me.reload();
          existing.reload();
        }}
      />
    );

  if (editId && existing.data && !existing.data.isOwner) {
    return <Notice kind="warn">Only the seller can edit this listing.</Notice>;
  }

  // Selling is the one thing that needs a way to reach you (the API answers
  // 409 contact_required without one), so it is asked for here and not before.
  if (!hasContact(me.data.profile)) {
    return (
      <section className={pane(shared.pane(), styles.page())}>
        <div className={styles.head()}>
          <p className={styles.step()}>Step 1 of 2</p>
          <h1 className={styles.title()}>First, how buyers reach you</h1>
          <p className={styles.quiet()}>
            Buyers see your name and county on every listing, and your contact
            details when they ask for them.
          </p>
        </div>
        <ProfileForm
          profile={me.data.profile}
          requireContact
          submitLabel="Save and continue"
          onSaved={(profile: Profile) =>
            me.setData((d) => (d ? { ...d, profile } : d))
          }
        />
      </section>
    );
  }

  return (
    <ListingForm
      profile={me.data.profile}
      existing={existing.data ?? undefined}
    />
  );
}

function ListingForm({
  profile,
  existing,
}: {
  profile: Profile;
  existing?: Listing;
}) {
  const api = useApi();
  const [form, setForm] = useState<FormState>(() =>
    existing ? fromListing(existing) : empty(profile.county ?? ""),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const set = (patch: Partial<FormState>) =>
    setForm((f) => ({ ...f, ...patch }));

  const build = (): ListingInput => ({
    title: form.title,
    description: form.description,
    category: form.category as ListingInput["category"],
    condition: form.condition as ListingInput["condition"],
    brand: form.brand || null,
    sizeLabel: form.sizeLabel || null,
    year: form.year ? Number(form.year) : null,
    priceCents: parsePriceInput(form.price) ?? -1,
    currency: form.currency as ListingInput["currency"],
    county: form.county as ListingInput["county"],
    town: form.town || null,
    photos: form.photos
      .filter((p) => !p.busy && !p.error)
      .map((p) =>
        p.id ? { id: p.id } : { key: p.key, width: p.width, height: p.height },
      ),
  });

  const submit = async () => {
    if (form.photos.some((p) => p.busy))
      return setErrors({ photos: "Wait for the photos to finish uploading." });
    const input = build();
    const check = listingInputSchema.safeParse(input);
    const fieldErrors = check.success ? {} : issuesByField(check.error);
    if (input.priceCents < 0)
      fieldErrors.priceCents =
        "Enter a price like 450 or 449.99, or 0 for free.";
    if (Object.keys(fieldErrors).length) {
      setErrors(fieldErrors);
      document
        .querySelector<HTMLElement>("[data-invalid='true']")
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const listing = existing
        ? await api.updateListing(existing.id, input)
        : await api.createListing(input);
      navigate(paths.listing(listing.id));
    } catch (e) {
      if (e instanceof ApiRequestError && e.details)
        setErrors({ ...e.details, _: e.message });
      else setErrors({ _: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  const category = CATEGORIES.find((c) => c.id === form.category);
  const styles = sellStyles();
  const shared = sharedStyles();

  return (
    <form
      className={styles.page()}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      {existing && (
        <div>
          <Link
            to={paths.listing(existing.id)}
            className={buttonStyles({ size: "sm" })}
          >
            <ArrowLeft size={15} aria-hidden="true" /> Back to listing
          </Link>
        </div>
      )}
      <div className={styles.head()}>
        {!existing && <p className={styles.step()}>Step 2 of 2</p>}
        <h1 className={styles.title()}>
          {existing ? "Edit listing" : "What are you selling?"}
        </h1>
      </div>

      <section
        className={pane(shared.pane(), shared.form())}
        aria-label="Photos"
      >
        <div className={styles.head()}>
          <h2 className={styles.lead()}>Photos</h2>
          <p className={styles.meta()}>
            Up to {LIMITS.photosPerListing}. The first is the cover. Show the
            whole item, any damage, and the size label.
          </p>
        </div>
        <PhotoUploader
          photos={form.photos}
          onChange={(photos) => set({ photos })}
        />
        {errors.photos && (
          <p className={styles.error()} role="alert">
            {errors.photos}
          </p>
        )}
      </section>

      <section
        className={pane(shared.pane(), shared.form())}
        aria-label="Details"
      >
        <h2 className={styles.lead()}>Details</h2>
        <Field label="Title" error={errors.title} htmlFor="listing-title">
          <TextInput
            id="listing-title"
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            maxLength={LIMITS.titleMax}
            placeholder="e.g. Duotone Unit 5m 2024, great condition"
          />
        </Field>
        <div className={shared.formRow()}>
          <Field
            label="Category"
            hint={category?.hint}
            error={errors.category}
            htmlFor="listing-category"
          >
            <Select
              id="listing-category"
              value={form.category}
              onChange={(e) => set({ category: e.target.value })}
            >
              {CATEGORIES.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Condition"
            error={errors.condition}
            htmlFor="listing-condition"
          >
            <Select
              id="listing-condition"
              value={form.condition}
              onChange={(e) => set({ condition: e.target.value })}
            >
              {CONDITIONS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}: {c.hint}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className={shared.formRow()}>
          <Field
            label="Brand"
            hint="optional"
            error={errors.brand}
            htmlFor="listing-brand"
          >
            <TextInput
              id="listing-brand"
              value={form.brand}
              onChange={(e) => set({ brand: e.target.value })}
              maxLength={LIMITS.brandMax}
              placeholder="Duotone, Armstrong, F-One…"
            />
          </Field>
          <Field
            label="Size"
            hint="optional"
            error={errors.sizeLabel}
            htmlFor="listing-size"
          >
            <TextInput
              id="listing-size"
              value={form.sizeLabel}
              onChange={(e) => set({ sizeLabel: e.target.value })}
              maxLength={LIMITS.sizeMax}
              placeholder="5m, 95L, 1250cm², 85cm"
            />
          </Field>
          <Field
            label="Year"
            hint="optional"
            error={errors.year}
            htmlFor="listing-year"
          >
            <TextInput
              id="listing-year"
              inputMode="numeric"
              value={form.year}
              onChange={(e) =>
                set({ year: e.target.value.replace(/\D/g, "").slice(0, 4) })
              }
              placeholder="2024"
            />
          </Field>
        </div>
        <hr className={styles.divider()} />
        <h2 className={styles.lead()}>Price and location</h2>
        <div className={shared.formRow()}>
          <Field
            label="Price"
            hint="0 for free"
            error={errors.priceCents}
            htmlFor="listing-price"
          >
            <TextInput
              id="listing-price"
              inputMode="decimal"
              prefix={form.currency === "GBP" ? "£" : "€"}
              value={form.price}
              onChange={(e) => set({ price: e.target.value })}
              placeholder="450"
            />
          </Field>
          <Field
            label="Currency"
            error={errors.currency}
            htmlFor="listing-currency"
          >
            <Select
              id="listing-currency"
              value={form.currency}
              onChange={(e) => set({ currency: e.target.value })}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className={shared.formRow()}>
          <Field label="County" error={errors.county} htmlFor="listing-county">
            <Select
              id="listing-county"
              value={form.county}
              onChange={(e) => set({ county: e.target.value })}
            >
              <option value="">Choose a county</option>
              {COUNTIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
          <Field
            label="Town or area"
            hint="optional"
            error={errors.town}
            htmlFor="listing-town"
          >
            <TextInput
              id="listing-town"
              value={form.town}
              onChange={(e) => set({ town: e.target.value })}
              maxLength={LIMITS.townMax}
              placeholder="Tralee"
            />
          </Field>
        </div>
        <hr className={styles.divider()} />
        <Field
          label="Description"
          hint={`${form.description.length}/${LIMITS.descriptionMax}`}
          error={errors.description}
          htmlFor="listing-desc"
        >
          <TextArea
            id="listing-desc"
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            maxLength={LIMITS.descriptionMax}
            rows={7}
            placeholder="How long you've had it, how much it's been used, any repairs or marks, what's included, and how you'd like to hand it over."
          />
        </Field>
      </section>

      {errors._ && <Notice kind="warn">{errors._}</Notice>}
      <div className={shared.formActions()}>
        <Button type="submit" variant="primary" size="lg" disabled={busy}>
          {busy ? "Saving…" : existing ? "Save changes" : "Publish listing"}
          {!busy && <ArrowRight size={16} aria-hidden="true" />}
        </Button>
        <span className={styles.signature()}>
          Listing as {profile.displayName}
        </span>
      </div>
    </form>
  );
}

function PhotoUploader({
  photos,
  onChange,
}: {
  photos: PhotoItem[];
  onChange: (p: PhotoItem[]) => void;
}) {
  const api = useApi();
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const latest = useRef(photos);
  latest.current = photos;
  const styles = sellStyles();

  useEffect(
    () => () =>
      photos.forEach(
        (p) => p.url.startsWith("blob:") && URL.revokeObjectURL(p.url),
      ),
    [],
  ); // eslint-disable-line react-hooks/exhaustive-deps

  const patch = (localId: string, update: Partial<PhotoItem>) =>
    onChange(
      latest.current.map((p) =>
        p.localId === localId ? { ...p, ...update } : p,
      ),
    );

  const add = async (files: FileList | File[]) => {
    const room = LIMITS.photosPerListing - latest.current.length;
    const picked = Array.from(files).slice(0, Math.max(0, room));
    const items: PhotoItem[] = picked.map((file) => ({
      localId: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      url: URL.createObjectURL(file),
      busy: true,
    }));
    onChange([...latest.current, ...items]);
    await Promise.all(
      items.map(async (item, i) => {
        try {
          const uploaded = await api.uploadPhoto(picked[i]);
          patch(item.localId, {
            key: uploaded.key,
            width: uploaded.width,
            height: uploaded.height,
            busy: false,
          });
        } catch (e) {
          patch(item.localId, { busy: false, error: errorMessage(e) });
        }
      }),
    );
  };

  const remove = (localId: string) =>
    onChange(latest.current.filter((p) => p.localId !== localId));
  const move = (index: number, delta: number) => {
    const next = [...latest.current];
    const [item] = next.splice(index, 1);
    next.splice(index + delta, 0, item);
    onChange(next);
  };

  const drop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    if (e.dataTransfer.files.length) void add(e.dataTransfer.files);
  };

  return (
    <div className={styles.tiles()}>
      {photos.map((p, i) => (
        <div
          key={p.localId}
          className={styles.tile()}
          data-busy={p.busy || undefined}
        >
          <img className={styles.image()} src={p.url} alt={`Photo ${i + 1}`} />
          {i === 0 && !p.error && (
            <Chip tone="glass" eyebrow className={styles.badge()}>
              Cover
            </Chip>
          )}
          {p.error && (
            <Chip tone="warn" className={styles.badge()} role="alert">
              Failed
            </Chip>
          )}
          <div className={styles.tools()}>
            <span className={styles.reorder()}>
              <Button
                icon
                size="sm"
                className={styles.tool()}
                aria-label="Move photo earlier"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowLeft size={14} aria-hidden="true" />
              </Button>
              <Button
                icon
                size="sm"
                className={styles.tool()}
                aria-label="Move photo later"
                disabled={i === photos.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowRight size={14} aria-hidden="true" />
              </Button>
            </span>
            <Button
              icon
              size="sm"
              className={styles.tool()}
              aria-label="Remove photo"
              onClick={() => remove(p.localId)}
            >
              <X size={14} aria-hidden="true" />
            </Button>
          </div>
        </div>
      ))}
      {photos.length < LIMITS.photosPerListing && (
        <label
          className={styles.add()}
          data-over={over || undefined}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          <input
            ref={input}
            className={styles.addInput()}
            type="file"
            accept="image/*"
            multiple
            aria-label="Add photos"
            onChange={(e) => {
              if (e.target.files) void add(e.target.files);
              e.target.value = "";
            }}
          />
          <span className={styles.addLabel()}>
            <Camera size={22} aria-hidden="true" />
            <span className={styles.meta()}>Add photos</span>
          </span>
        </label>
      )}
    </div>
  );
}
