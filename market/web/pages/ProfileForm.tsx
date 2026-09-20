import { useState } from "react";
import { ApiRequestError, useApi } from "../api";
import { useMarketAuth } from "../auth";
import {
  Field,
  Notice,
  Select,
  TextArea,
  TextInput,
  errorMessage,
} from "../components";
import { COUNTIES, type Profile, type ProfileInput } from "../../shared/types";
import { issuesByField, profileInputSchema } from "../../shared/validate";
import { userInputSchema } from "../../../site/shared/validate";

interface Props {
  profile: Profile;
  onSaved: (profile: Profile) => void;
  submitLabel?: string;
  /** Selling needs a way to reach you; nothing else on the site does. */
  requireContact?: boolean;
}

/** Edit your profile. Used inline before a first listing, where contact is asked for, and on the account page. */
export default function ProfileForm({
  profile,
  onSaved,
  submitLabel,
  requireContact = false,
}: Props) {
  const api = useApi();
  const auth = useMarketAuth();
  const [form, setForm] = useState({
    displayName: profile.displayName,
    handle: profile.handle,
    county: profile.county ?? "",
    // Offered only where contact is being asked for, never slipped into a plain save.
    contactEmail:
      profile.contactEmail ??
      (requireContact && !profile.contactPhone
        ? (auth.identity.email ?? "")
        : ""),
    contactPhone: profile.contactPhone ?? "",
    contactWhatsapp: profile.contactWhatsapp,
    bio: profile.bio ?? "",
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    setSaved(false);
  };

  const submit = async () => {
    const input: ProfileInput = {
      displayName: form.displayName,
      handle: form.handle,
      county: (form.county || null) as ProfileInput["county"],
      contactEmail: form.contactEmail || null,
      contactPhone: form.contactPhone || null,
      contactWhatsapp: form.contactWhatsapp,
      bio: form.bio || null,
    };
    const check = (
      requireContact ? profileInputSchema : userInputSchema
    ).safeParse(input);
    if (!check.success) return setErrors(issuesByField(check.error));
    setErrors({});
    setBusy(true);
    try {
      const result = await api.saveProfile(input);
      setForm((f) => ({ ...f, handle: result.handle }));
      setSaved(true);
      onSaved(result);
    } catch (e) {
      if (e instanceof ApiRequestError && e.details) setErrors(e.details);
      else setErrors({ _: errorMessage(e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="mk-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="mk-form__row">
        <Field
          label="Display name"
          hint="shown on your listings"
          error={errors.displayName}
          htmlFor="mk-p-name"
        >
          <TextInput
            id="mk-p-name"
            value={form.displayName}
            onChange={(e) => set({ displayName: e.target.value })}
            maxLength={40}
            autoComplete="name"
          />
        </Field>
        <Field
          label="Home county"
          hint="optional"
          error={errors.county}
          htmlFor="mk-p-county"
        >
          <Select
            id="mk-p-county"
            value={form.county}
            onChange={(e) => set({ county: e.target.value })}
          >
            <option value="">Prefer not to say</option>
            {COUNTIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field
        label="Handle"
        hint="how people mention you; lowercase letters, numbers and hyphens"
        error={errors.handle}
        htmlFor="mk-p-handle"
      >
        <TextInput
          id="mk-p-handle"
          value={form.handle}
          onChange={(e) => set({ handle: e.target.value })}
          maxLength={30}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
        />
      </Field>
      <div className="mk-form__row">
        <Field
          label="Contact email"
          hint={requireContact ? undefined : "optional until you sell"}
          error={errors.contactEmail}
          htmlFor="mk-p-email"
        >
          <TextInput
            id="mk-p-email"
            type="email"
            value={form.contactEmail}
            onChange={(e) => set({ contactEmail: e.target.value })}
            autoComplete="email"
          />
        </Field>
        <Field
          label="Phone"
          hint="optional"
          error={errors.contactPhone}
          htmlFor="mk-p-phone"
        >
          <TextInput
            id="mk-p-phone"
            type="tel"
            value={form.contactPhone}
            onChange={(e) => set({ contactPhone: e.target.value })}
            autoComplete="tel"
            placeholder="087 123 4567"
          />
        </Field>
      </div>
      <label className="mk-check">
        <input
          type="checkbox"
          checked={form.contactWhatsapp}
          disabled={!form.contactPhone}
          onChange={(e) => set({ contactWhatsapp: e.target.checked })}
        />
        <span>Buyers can WhatsApp this number</span>
      </label>
      <Field
        label="About you"
        hint="optional, shown on your seller page"
        error={errors.bio}
        htmlFor="mk-p-bio"
      >
        <TextArea
          id="mk-p-bio"
          value={form.bio}
          onChange={(e) => set({ bio: e.target.value })}
          maxLength={400}
          placeholder="Where you ride, what you tend to sell, how you like to hand over gear."
        />
      </Field>
      <p className="mk-meta">
        Only signed-in members can see your contact details, and only when they
        ask for them on a listing.
      </p>
      {errors._ && <Notice kind="warn">{errors._}</Notice>}
      {saved && <Notice>Profile saved.</Notice>}
      <div className="mk-form__actions">
        <button
          type="submit"
          className="f5-button f5-button--primary f5-button--lg"
          disabled={busy}
        >
          {busy ? "Saving…" : (submitLabel ?? "Save profile")}
        </button>
      </div>
    </form>
  );
}
