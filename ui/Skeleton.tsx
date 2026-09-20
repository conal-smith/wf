import { tv, type VariantProps } from "./tv";

export const skeletonStyles = tv({
  base: "block animate-pulse bg-sunken motion-reduce:animate-none",
  variants: {
    shape: {
      line: "h-3 rounded-full",
      block: "min-h-32 rounded-surface",
      circle: "size-control-md rounded-full",
    },
  },
  defaultVariants: { shape: "line" },
});

export type SkeletonProps = VariantProps<typeof skeletonStyles> & {
  className?: string;
};

/**
 * The shape of what is loading, so the page does not jump when it lands. It
 * says nothing itself: whatever holds it carries `aria-busy`.
 */
export function Skeleton({ shape, className }: SkeletonProps) {
  return (
    <span className={skeletonStyles({ shape, className })} aria-hidden="true" />
  );
}
