/**
 * The kit: every control the sections draw, styled from ui/theme.css and from
 * nowhere else. Import from here, not from the files. The parts and when to
 * use each are in design-system/components/ and the /ui gallery.
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
export { Button, buttonStyles, type ButtonProps } from "./Button";
export { Card, cardStyles, type CardProps } from "./Card";
export { Checkbox, type CheckboxProps } from "./Checkbox";
export { Chip, type ChipProps } from "./Chip";
export { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";
export { Count, type CountProps } from "./Count";
export { Dialog, type DialogProps } from "./Dialog";
export { Empty, type EmptyProps } from "./Empty";
export { Field, type FieldProps } from "./Field";
export { Heading, headingStyles, type HeadingProps } from "./Heading";
export { Figure, type FigureProps } from "./Figure";
export { Link, type LinkProps } from "./Link";
export {
  Notice,
  NoticeMark,
  type NoticeLevel,
  type NoticeMarkProps,
  type NoticeProps,
} from "./Notice";
export {
  NumberField,
  type NumberFieldProps,
} from "./NumberField";
export { Pager, type PagerProps } from "./Pager";
export { RatingTip, ratingTipStyles, type RatingTipProps } from "./RatingTip";
export { Row, Rows, type RowProps, type RowsProps } from "./Rows";
export { SearchField, type SearchFieldProps } from "./SearchField";
export {
  Segmented,
  type SegmentedOption,
  type SegmentedProps,
} from "./Segmented";
export { Select, type SelectProps } from "./Select";
export { Disclosure, type DisclosureProps } from "./Disclosure";
export { Skeleton, type SkeletonProps } from "./Skeleton";
export { Slider, type SliderProps } from "./Slider";
export { SpotSearch, loadPlaces, type SpotSearchProps } from "./SpotSearch";
export { StarGlyphs, starsLabel, type StarGlyphsProps } from "./StarGlyphs";
export { Switch, type SwitchProps } from "./Switch";
export { Tabs, type TabItem, type TabsProps } from "./Tabs";
export { Tag, type TagProps } from "./Tag";
export { TextArea, type TextAreaProps } from "./TextArea";
export { TextInput, type TextInputProps } from "./TextInput";
export { ThemeButton } from "./ThemeButton";
export { TopBar, type TopBarProps, type TopBarView } from "./TopBar";
export { Wordmark, type WordmarkProps } from "./Wordmark";
