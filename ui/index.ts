/**
 * The kit: every control the marketplace and the community draw, styled from
 * ui/theme.css and from nowhere else. Import from here, not from the files.
 *
 * The gallery (ui/Gallery.tsx) is not exported: src/main.tsx loads it by path,
 * under the dev server only, so nothing that imports the kit can carry it into a
 * build.
 */
export { Avatar, initials, type AvatarProps } from "./Avatar";
export { Button, type ButtonProps } from "./Button";
export { Checkbox, type CheckboxProps } from "./Checkbox";
export { Chip, type ChipProps } from "./Chip";
export { ConfirmDialog, type ConfirmDialogProps } from "./ConfirmDialog";
export { Count, type CountProps } from "./Count";
export { Dialog, type DialogProps } from "./Dialog";
export { Empty, type EmptyProps } from "./Empty";
export { Field, type FieldProps } from "./Field";
export { Link, type LinkProps } from "./Link";
export { Notice, type NoticeProps } from "./Notice";
export { Pager, type PagerProps } from "./Pager";
export { Pane, type PaneProps } from "./Pane";
export { SearchField, type SearchFieldProps } from "./SearchField";
export {
  Segmented,
  type SegmentedOption,
  type SegmentedProps,
} from "./Segmented";
export { Select, type SelectProps } from "./Select";
export { Skeleton, type SkeletonProps } from "./Skeleton";
export { Surface, type SurfaceProps } from "./Surface";
export { TextArea, type TextAreaProps } from "./TextArea";
export { TextInput, type TextInputProps } from "./TextInput";
