import { useState } from "react";
import { tv, type VariantProps } from "./tv";

export const avatarStyles = tv({
  slots: {
    base: "inline-grid shrink-0 place-items-center overflow-hidden rounded-full bg-inverse font-sans leading-none font-semibold text-ink-inverse",
    image: "size-full object-cover",
  },
  variants: {
    size: {
      sm: { base: "size-control-sm text-caption" },
      md: { base: "size-control-md text-body" },
      lg: { base: "size-18 text-title" },
    },
  },
  defaultVariants: { size: "md" },
});

/** Up to two letters: the first of the first word and of the last. */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (!words.length) return "?";
  const letters =
    words.length === 1 ? [words[0]] : [words[0], words[words.length - 1]];
  return letters.map((word) => [...word][0].toUpperCase()).join("");
}

export type AvatarProps = VariantProps<typeof avatarStyles> & {
  name: string;
  /** The member's photo. Initials stand in where there is none, or it fails. */
  src?: string | null;
  className?: string;
};

/**
 * A face for a name. Decoration: the name is always written beside it, so a
 * screen reader is not told it twice.
 */
export function Avatar({ name, src, size, className }: AvatarProps) {
  const [broken, setBroken] = useState<string | null>(null);
  const styles = avatarStyles({ size });
  return (
    <span className={styles.base({ className })} aria-hidden="true">
      {src && broken !== src ? (
        <img
          className={styles.image()}
          src={src}
          alt=""
          onError={() => setBroken(src)}
        />
      ) : (
        initials(name)
      )}
    </span>
  );
}
