import { ArrowLeft, ArrowRight, Camera, X } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { ApiRequestError, useApi } from "../api";
import { useMarketAuth } from "../auth";
import {
  Field,
  LoadError,
  Notice,
  Select,
  TextArea,
  TextInput,
  errorMessage,
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

  if (!auth.loaded || me.loading || (editId && existing.loading)) {
    return (
      <div className="mk-skeleton" aria-busy="true" aria-label="Loading" />
    );
  }

  if (!auth.signedIn) {
    return (
      <section className="mk-pane mk-stack">
        <div className="mk-page-head">
          <h1 className="mk-title">Sell your gear</h1>
          <p className="mk-muted">
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
          <div className="mk-form__actions">
            <button
              type="button"
              className="f5-button f5-button--primary f5-button--lg"
              onClick={auth.signIn}
            >
              Sign in to continue
            </button>
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
      <section className="mk-pane mk-stack mk-stack--loose">
        <div className="mk-page-head">
          <p className="mk-eyebrow">Step 1 of 2</p>
          <h1 className="mk-title">First, how buyers reach you</h1>
          <p className="mk-muted">
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

  return (
    <form
      className="mk-stack mk-stack--loose"
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
            className="f5-button f5-button--sm"
          >
            <ArrowLeft size={15} aria-hidden="true" /> Back to listing
          </Link>
        </div>
      )}
      <div className="mk-page-head">
        {!existing && <p className="mk-eyebrow">Step 2 of 2</p>}
        <h1 className="mk-title">
          {existing ? "Edit listing" : "What are you selling?"}
        </h1>
      </div>

      <section className="mk-pane mk-form" aria-label="Photos">
        <div className="mk-page-head">
          <h2 className="mk-lead">Photos</h2>
          <p className="mk-meta">
            Up to {LIMITS.photosPerListing}. The first is the cover. Show the
            whole item, any damage, and the size label.
          </p>
        </div>
        <PhotoUploader
          photos={form.photos}
          onChange={(photos) => set({ photos })}
        />
        {errors.photos && (
          <p className="mk-meta mk-field__error" role="alert">
            {errors.photos}
          </p>
        )}
      </section>

      <section className="mk-pane mk-form" aria-label="Details">
        <h2 className="mk-lead">Details</h2>
        <Field label="Title" error={errors.title} htmlFor="mk-l-title">
          <TextInput
            id="mk-l-title"
            value={form.title}
            onChange={(e) => set({ title: e.target.value })}
            maxLength={LIMITS.titleMax}
            placeholder="e.g. Duotone Unit 5m 2024, great condition"
          />
        </Field>
        <div className="mk-form__row">
          <Field
            label="Category"
            hint={category?.hint}
            error={errors.category}
            htmlFor="mk-l-category"
          >
            <Select
              id="mk-l-category"
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
            htmlFor="mk-l-condition"
          >
            <Select
              id="mk-l-condition"
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
        <div className="mk-form__row">
          <Field
            label="Brand"
            hint="optional"
            error={errors.brand}
            htmlFor="mk-l-brand"
          >
            <TextInput
              id="mk-l-brand"
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
            htmlFor="mk-l-size"
          >
            <TextInput
              id="mk-l-size"
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
            htmlFor="mk-l-year"
          >
            <TextInput
              id="mk-l-year"
              inputMode="numeric"
              value={form.year}
              onChange={(e) =>
                set({ year: e.target.value.replace(/\D/g, "").slice(0, 4) })
              }
              placeholder="2024"
            />
          </Field>
        </div>
        <hr className="mk-divider" />
        <h2 className="mk-lead">Price and location</h2>
        <div className="mk-form__row">
          <Field
            label="Price"
            hint="0 for free"
            error={errors.priceCents}
            htmlFor="mk-l-price"
          >
            <TextInput
              id="mk-l-price"
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
            htmlFor="mk-l-currency"
          >
            <Select
              id="mk-l-currency"
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
        <div className="mk-form__row">
          <Field label="County" error={errors.county} htmlFor="mk-l-county">
            <Select
              id="mk-l-county"
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
            htmlFor="mk-l-town"
          >
            <TextInput
              id="mk-l-town"
              value={form.town}
              onChange={(e) => set({ town: e.target.value })}
              maxLength={LIMITS.townMax}
              placeholder="Tralee"
            />
          </Field>
        </div>
        <hr className="mk-divider" />
        <Field
          label="Description"
          hint={`${form.description.length}/${LIMITS.descriptionMax}`}
          error={errors.description}
          htmlFor="mk-l-desc"
        >
          <TextArea
            id="mk-l-desc"
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            maxLength={LIMITS.descriptionMax}
            rows={7}
            placeholder="How long you've had it, how much it's been used, any repairs or marks, what's included, and how you'd like to hand it over."
          />
        </Field>
      </section>

      {errors._ && <Notice kind="warn">{errors._}</Notice>}
      <div className="mk-form__actions">
        <button
          type="submit"
          className="f5-button f5-button--primary f5-button--lg"
          disabled={busy}
        >
          {busy ? "Saving…" : existing ? "Save changes" : "Publish listing"}
          {!busy && <ArrowRight size={16} aria-hidden="true" />}
        </button>
        <span className="mk-meta">Listing as {profile.displayName}</span>
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
    <div className="mk-photos">
      {photos.map((p, i) => (
        <div key={p.localId} className="mk-photo" data-busy={p.busy}>
          <img src={p.url} alt={`Photo ${i + 1}`} />
          {i === 0 && !p.error && (
            <span className="f5-chip f5-chip--glass f5-chip--eyebrow mk-photo__cover">
              Cover
            </span>
          )}
          {p.error && (
            <span
              className="f5-chip f5-chip--warn mk-photo__cover"
              role="alert"
            >
              Failed
            </span>
          )}
          <div className="mk-photo__tools">
            <span
              className="mk-row"
              style={{ gap: "var(--sem-space-gap-tight)" }}
            >
              <button
                type="button"
                className="f5-button f5-button--icon f5-button--sm"
                aria-label="Move photo earlier"
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                <ArrowLeft size={14} aria-hidden="true" />
              </button>
              <button
                type="button"
                className="f5-button f5-button--icon f5-button--sm"
                aria-label="Move photo later"
                disabled={i === photos.length - 1}
                onClick={() => move(i, 1)}
              >
                <ArrowRight size={14} aria-hidden="true" />
              </button>
            </span>
            <button
              type="button"
              className="f5-button f5-button--icon f5-button--sm"
              aria-label="Remove photo"
              onClick={() => remove(p.localId)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        </div>
      ))}
      {photos.length < LIMITS.photosPerListing && (
        <label
          className="mk-photo mk-photo--add"
          data-over={over}
          onDragOver={(e) => {
            e.preventDefault();
            setOver(true);
          }}
          onDragLeave={() => setOver(false)}
          onDrop={drop}
        >
          <input
            ref={input}
            type="file"
            accept="image/*"
            multiple
            aria-label="Add photos"
            onChange={(e) => {
              if (e.target.files) void add(e.target.files);
              e.target.value = "";
            }}
          />
          <span className="mk-stack--tight">
            <Camera size={22} aria-hidden="true" />
            <span className="mk-meta">Add photos</span>
          </span>
        </label>
      )}
    </div>
  );
}
