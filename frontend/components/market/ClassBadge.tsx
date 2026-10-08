/*
 * Asset-class icon chip + badge. No hooks: renders in Server Components too.
 */
import { ArrowLeftRight, Bitcoin, ChartLine, CircleDot, Gem, Landmark, Layers, type LucideIcon } from "lucide-react";

import { CLASS_META, classLabel } from "@/components/market/model";
import { cx } from "@/lib/format";

export const CLASS_ICON: Record<string, LucideIcon> = {
  crypto: Bitcoin,
  stock: Landmark,
  etf: Layers,
  forex: ArrowLeftRight,
  index: ChartLine,
  commodity: Gem,
};

const CLASS_TINT: Record<string, string> = {
  crypto: "text-gold bg-gold/10 ring-gold/20",
  stock: "text-accent2 bg-accent/12 ring-accent/25",
  etf: "text-violet bg-violet/10 ring-violet/20",
  forex: "text-info bg-info/10 ring-info/20",
  index: "text-up bg-up/10 ring-up/20",
  commodity: "text-warn bg-warn/10 ring-warn/20",
};

/** Square icon chip for an asset class (size in px). */
export function ClassIcon({ cls, size = 24, className }: { cls: string | null | undefined; size?: number; className?: string }) {
  const Icon = (cls && CLASS_ICON[cls]) || CircleDot;
  const tint = (cls && CLASS_TINT[cls]) || "text-muted bg-white/[0.05] ring-white/10";
  return (
    <span
      className={cx("inline-flex shrink-0 items-center justify-center rounded-md ring-1 ring-inset", tint, className)}
      style={{ width: size, height: size }}
      title={cls ? (CLASS_META[cls]?.bg ?? cls) : undefined}
      aria-hidden
    >
      <Icon size={Math.round(size * 0.56)} strokeWidth={1.9} />
    </span>
  );
}

/** Small uppercase class label ("CRYPTO", "ETF"…) with the class icon. */
export function ClassBadge({ cls, className, icon = true }: { cls: string | null | undefined; className?: string; icon?: boolean }) {
  const Icon = (cls && CLASS_ICON[cls]) || CircleDot;
  const tint = (cls && CLASS_TINT[cls]) || "text-muted bg-white/[0.05] ring-white/10";
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 whitespace-nowrap rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase leading-4 tracking-[0.06em] ring-1 ring-inset",
        tint,
        className,
      )}
    >
      {icon && <Icon size={11} strokeWidth={2} aria-hidden />}
      {classLabel(cls)}
    </span>
  );
}
