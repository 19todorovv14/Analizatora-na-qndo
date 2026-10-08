"use client";

import { Eye, EyeOff, Star } from "lucide-react";

import { useFavoriteToggle, useMembership, useWatchlistToggle } from "@/components/market/hooks";
import { Tooltip } from "@/components/ui";
import { cx } from "@/lib/format";

type Variant = "icon" | "button";

export type MembershipButtonProps = {
  /** canonical symbol ("BTC/USDT") */
  symbol: string;
  /** icon-only (default) or a labelled button */
  variant?: Variant;
  size?: "sm" | "md";
  className?: string;
  /** initial state before /markets/membership loads (e.g. is_favorite of the asset page) */
  initial?: boolean | null;
};

function useIsIn(kind: "favorites" | "watchlist", symbol: string, initial?: boolean | null): boolean | null {
  const { data } = useMembership();
  if (!data) return initial ?? null;
  return data[kind].some((s) => s.toUpperCase() === symbol.toUpperCase());
}

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-1.5 font-medium transition-[background-color,border-color,color] duration-150 disabled:cursor-not-allowed disabled:opacity-50";

function shape(variant: Variant, size: "sm" | "md") {
  if (variant === "icon") return size === "sm" ? "h-7 w-7 rounded-md" : "h-9 w-9 rounded-lg";
  return size === "sm" ? "h-7 rounded-md px-2.5 text-xs" : "h-9 rounded-lg px-3 text-sm";
}

/** ☆ / ★ — adds the instrument to the user's favorites (POST/DELETE /api/market/favorites). */
export function FavoriteButton({ symbol, variant = "icon", size = "md", className, initial }: MembershipButtonProps) {
  const on = useIsIn("favorites", symbol, initial);
  const { busy, error, toggle } = useFavoriteToggle();
  const label = on ? "Премахни от любими" : "Добави в любими";
  const btn = (
    <button
      type="button"
      aria-pressed={!!on}
      aria-label={variant === "icon" ? label : undefined}
      disabled={busy || on === null}
      onClick={(e) => {
        e.stopPropagation();
        void toggle(symbol, !on);
      }}
      className={cx(
        BASE,
        shape(variant, size),
        "border",
        on
          ? "border-gold/35 bg-gold/10 text-gold hover:bg-gold/15"
          : "border-white/10 bg-white/[0.04] text-muted hover:border-white/[0.18] hover:bg-white/[0.07] hover:text-text",
        className,
      )}
    >
      <Star size={size === "sm" ? 14 : 16} strokeWidth={1.9} fill={on ? "currentColor" : "none"} aria-hidden />
      {variant === "button" && (on ? "Любим" : "Любими")}
    </button>
  );
  return (
    <Tooltip content={error ? `Грешка: ${error}` : label} side="bottom">
      {btn}
    </Tooltip>
  );
}

/** 👁 — adds / removes the instrument from the watchlist (POST/DELETE /api/market/watchlist). */
export function WatchlistButton({ symbol, variant = "button", size = "md", className, initial }: MembershipButtonProps) {
  const on = useIsIn("watchlist", symbol, initial);
  const { busy, error, toggle } = useWatchlistToggle();
  const label = on ? "Премахни от watchlist" : "Добави в watchlist";
  const Icon = on ? EyeOff : Eye;
  return (
    <Tooltip content={error ? `Грешка: ${error}` : on ? "Следиш този актив — натисни, за да го премахнеш" : "Следи цената, тренда и AI статуса"} side="bottom">
      <button
        type="button"
        aria-pressed={!!on}
        aria-label={variant === "icon" ? label : undefined}
        disabled={busy || on === null}
        onClick={(e) => {
          e.stopPropagation();
          void toggle(symbol, !on);
        }}
        className={cx(
          BASE,
          shape(variant, size),
          "border",
          on
            ? "border-accent/35 bg-accent/12 text-accent2 hover:bg-accent/18"
            : "border-white/10 bg-white/[0.04] text-text hover:border-white/[0.18] hover:bg-white/[0.07]",
          className,
        )}
      >
        <Icon size={size === "sm" ? 14 : 16} strokeWidth={1.9} aria-hidden />
        {variant === "button" && (on ? "В watchlist" : "Watchlist +")}
      </button>
    </Tooltip>
  );
}
