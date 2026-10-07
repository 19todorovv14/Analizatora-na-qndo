/*
 * Button styling for <Link>s (the ui Button is a <button>). Mirrors components/ui Button variants so
 * navigation CTAs look identical to actions.
 */
import { cx } from "@/lib/format";

const VARIANT = {
  primary:
    "border border-[#5b95f7]/40 bg-gradient-to-b from-[#3b82f6] to-[#2563eb] text-white shadow-btn hover:from-[#4a8cf7] hover:to-[#2f6df0]",
  outline:
    "border border-white/10 bg-white/[0.04] text-text shadow-[inset_0_1px_0_0_rgb(255_255_255/0.04)] hover:border-white/[0.18] hover:bg-white/[0.07]",
  ghost: "border border-transparent text-text hover:bg-white/[0.06]",
  accent: "border border-accent/30 bg-accent/[0.1] text-accent2 hover:bg-accent/[0.16] hover:text-text",
} as const;

const SIZE = {
  sm: "min-h-7 gap-1.5 rounded-md px-2.5 py-1 text-xs",
  md: "min-h-9 gap-2 rounded-lg px-3.5 py-1.5 text-sm",
  lg: "min-h-11 gap-2 rounded-lg px-5 py-2 text-[15px]",
} as const;

export function linkButton(variant: keyof typeof VARIANT = "outline", size: keyof typeof SIZE = "md", className?: string): string {
  return cx(
    "inline-flex select-none items-center justify-center font-medium leading-tight transition-[background-color,border-color,color] duration-150 [&_svg]:shrink-0",
    VARIANT[variant],
    SIZE[size],
    className,
  );
}
