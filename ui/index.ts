/**
 * The kit: every control the sections draw, styled from ui/theme.css and from
 * nowhere else. Import from here, not from the files. How to use it in the
 * chart's style is docs/BRAND.md.
 *
 * The gallery (ui/Gallery.tsx) is not exported: src/main.tsx loads it by path,
 * under the dev server only, so nothing that imports the kit can carry it into a
 * build.
 */
export { Avatar, initials, type AvatarProps } from "./Avatar";
export {
  Backdrop,
  backdropStyles,
  useFadeOut,
  type BackdropProps,
} from "./Backdrop";
export {
  BeaufortGlyph,
  beaufortGlyphStyles,
  forceLabel,
  type BeaufortGlyphProps,
} from "./BeaufortGlyph";
export { beaufortPath, type BeaufortDrawing } from "./beaufortPath";
export { Button, type ButtonProps } from "./Button";
export { Checkbox, type CheckboxProps } from "./Checkbox";
export { Chip, type ChipProps } from "./Chip";
export { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";
export { Count, type CountProps } from "./Count";
export { Dialog, type DialogProps } from "./Dialog";
export { Empty, type EmptyProps } from "./Empty";
export { Field, type FieldProps } from "./Field";
export { Figure, type FigureProps } from "./Figure";
export { Headline, headlineStyles, type HeadlineProps } from "./Headline";
export { Kicker, type KickerProps } from "./Kicker";
export { Link, type LinkProps } from "./Link";
export {
  Masthead,
  MastheadMark,
  mastheadStyles,
  type MastheadProps,
} from "./Masthead";
export { Notice, type NoticeProps } from "./Notice";
export {
  PageHeader,
  pageHeaderStyles,
  type PageHeaderProps,
} from "./PageHeader";
export { Pager, type PagerProps } from "./Pager";
export { Pane, type PaneProps } from "./Pane";
export { Lift, liftStyles, type LiftProps } from "./Lift";
export { PenNote, PenStrike, PenUnderline, type PenNoteProps } from "./Pen";
export { strikePath, underlinePath } from "./penPaths";
export { Puffin, type PuffinProps } from "./Puffin";
export { RatingTip, ratingTipStyles, type RatingTipProps } from "./RatingTip";
export { SearchField, type SearchFieldProps } from "./SearchField";
export { SectionHeading, type SectionHeadingProps } from "./SectionHeading";
export {
  Segmented,
  type SegmentedOption,
  type SegmentedProps,
} from "./Segmented";
export { Select, type SelectProps } from "./Select";
export { Skeleton, type SkeletonProps } from "./Skeleton";
export { StarGlyphs, starsLabel, type StarGlyphsProps } from "./StarGlyphs";
export { Surface, type SurfaceProps } from "./Surface";
export { TextArea, type TextAreaProps } from "./TextArea";
export { TextInput, type TextInputProps } from "./TextInput";
export { Wordmark, type WordmarkProps } from "./Wordmark";
