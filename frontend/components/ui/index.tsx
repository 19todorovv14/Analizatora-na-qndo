/*
 * Design-system barrel. Every existing `@/components/ui` import keeps working.
 * No "use client" here: stateless primitives (primitives.tsx, feedback.tsx, data.tsx) render in
 * Server Components; interactive modules carry their own "use client".
 */
export {
  AiText,
  Badge,
  Button,
  buttonClass,
  Card,
  Empty,
  ErrorText,
  Field,
  Kbd,
  Loading,
  Notice,
  PageHeader,
  PaperBadge,
  ProgressBar,
  RegimeBadge,
  RichText,
  Section,
  Select,
  SourceBadge,
  Spinner,
  Stat,
  Tabs,
} from "@/components/ui/primitives";
export type { ButtonSize, ButtonVariant, CardVariant, SourceLike, SourceStatus, Tone } from "@/components/ui/primitives";

export {
  ChartSkeleton,
  Checklist,
  DataNotAvailable,
  Disclaimer,
  EmptyState,
  ErrorState,
  Skeleton,
  SkeletonText,
  TableSkeleton,
} from "@/components/ui/feedback";
export type { ChecklistItem } from "@/components/ui/feedback";

export { ChangePill, Meter, Sparkline, StatTile, pnlTone } from "@/components/ui/data";
export type { MeterTone } from "@/components/ui/data";

export { GlossaryCard, GlossaryTip, InfoTip, Term } from "@/components/ui/term";

export { Drawer, Modal, Popover, Tooltip } from "@/components/ui/overlay";
export type { DrawerProps, PopoverProps, TooltipProps } from "@/components/ui/overlay";

export { IconButton, PriceText, Segmented, Switch, WhyButton } from "@/components/ui/interactive";
export type { IconButtonProps, SegmentedOption } from "@/components/ui/interactive";

export { ResizeHandle, VirtualList, usePanelSize } from "@/components/ui/panels";

export { useStoredState } from "@/components/ui/storage";
export type { StoredStateOptions } from "@/components/ui/storage";
