"use client";

import { Award } from "lucide-react";
import Link from "next/link";

import { BrandMark } from "@/components/shell/Brand";
import { levelInfo } from "@/components/shell/level";
import { NAV_GROUPS, activeHref, type NavItem } from "@/components/shell/nav";
import { ShortcutKeys } from "@/components/shell/ShortcutKeys";
import { ProgressBar, Tooltip } from "@/components/ui";
import { cx } from "@/lib/format";

/* ─────────────────────────────────────────────────────────── nav list */

function NavLink({ item, active, collapsed, onNavigate }: { item: NavItem; active: boolean; collapsed: boolean; onNavigate?: () => void }) {
  const Icon = item.icon;
  const link = (
    <Link
      href={item.href}
      data-tour={item.href}
      aria-current={active ? "page" : undefined}
      aria-label={collapsed ? item.label : undefined}
      onClick={onNavigate}
      className={cx(
        "group relative flex items-center rounded-lg text-[13px] font-medium transition-[background-color,color] duration-150",
        collapsed ? "mx-auto h-10 w-10 justify-center" : "h-9 gap-3 px-2.5",
        active ? "bg-accent/[0.13] text-text shadow-[inset_0_0_0_1px_rgb(59_130_246/0.16)]" : "text-muted hover:bg-white/[0.045] hover:text-text",
      )}
    >
      {active && (
        <span
          aria-hidden
          className={cx(
            "absolute top-1/2 h-5 w-[2px] -translate-y-1/2 rounded-r-full bg-accent shadow-[0_0_10px_rgb(59_130_246/0.75)]",
            collapsed ? "-left-[14px]" : "-left-3",
          )}
        />
      )}
      <Icon
        size={17}
        strokeWidth={1.8}
        aria-hidden
        className={cx("shrink-0 transition-colors duration-150", active ? "text-accent2" : "text-faint group-hover:text-muted")}
      />
      {!collapsed && (
        <>
          <span className="min-w-0 flex-1 truncate">{item.label}</span>
          {item.shortcut && <ShortcutKeys combo={item.shortcut} className="opacity-0 transition-opacity duration-150 group-hover:opacity-100" />}
        </>
      )}
    </Link>
  );
  if (!collapsed) return link;
  return (
    <Tooltip
      side="right"
      className="flex"
      contentClassName="whitespace-nowrap"
      content={
        <span className="flex items-center gap-2.5">
          {item.label}
          {item.shortcut && <ShortcutKeys combo={item.shortcut} />}
        </span>
      }
    >
      {link}
    </Tooltip>
  );
}

/** Grouped navigation (desktop sidebar and mobile drawer). */
export function SidebarNav({ pathname, collapsed = false, onNavigate }: { pathname: string; collapsed?: boolean; onNavigate?: () => void }) {
  const current = activeHref(pathname);
  return (
    <nav aria-label="Основна навигация" className={cx("pb-3", collapsed ? "px-0" : "px-3")}>
      {NAV_GROUPS.map((g, gi) => (
        <div key={g.key} role="group" aria-label={g.label}>
          {collapsed ? (
            gi > 0 && <div aria-hidden className="mx-auto my-2.5 h-px w-7 bg-white/[0.07]" />
          ) : (
            <div className={cx("px-2.5 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-faint", gi === 0 ? "pt-1" : "pt-4")}>
              {g.label}
            </div>
          )}
          <div className={cx(collapsed ? "space-y-1" : "space-y-0.5")}>
            {g.items.map((item) => (
              <NavLink key={item.href} item={item} active={current === item.href} collapsed={collapsed} onNavigate={onNavigate} />
            ))}
          </div>
        </div>
      ))}
    </nav>
  );
}

/* ─────────────────────────────────────────────────────── level / XP */

function LevelRing({ pct, level }: { pct: number; level: number }) {
  const r = 15;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex h-10 w-10 items-center justify-center">
      <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden>
        <circle cx="18" cy="18" r={r} fill="none" stroke="rgb(148 163 184 / 0.14)" strokeWidth="2.5" />
        <circle
          cx="18"
          cy="18"
          r={r}
          fill="none"
          stroke="var(--color-gold)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={`${(c * Math.max(0, Math.min(100, pct))) / 100} ${c}`}
        />
      </svg>
      <span className="num text-[11px] font-semibold text-gold">L{level}</span>
    </span>
  );
}

/** Compact level / XP progress card (links to the Academy). */
export function LevelCard({ xp, collapsed = false, onNavigate }: { xp: number; collapsed?: boolean; onNavigate?: () => void }) {
  const lv = levelInfo(xp);
  if (collapsed) {
    return (
      <Tooltip
        side="right"
        className="flex justify-center"
        contentClassName="whitespace-nowrap"
        content={`Level ${lv.level} · ${lv.xp} XP · още ${lv.toNext} XP до Level ${lv.level + 1}`}
      >
        <Link href="/learn" onClick={onNavigate} aria-label={`Level ${lv.level}, ${lv.xp} XP`} className="rounded-full">
          <LevelRing pct={lv.pct} level={lv.level} />
        </Link>
      </Tooltip>
    );
  }
  return (
    <Link
      href="/learn"
      onClick={onNavigate}
      className="glass-inset group block px-3 py-2.5 transition-colors duration-150 hover:border-white/10"
      title="Прогрес в Academy"
    >
      <div className="flex items-center justify-between gap-2 text-[11px]">
        <span className="flex items-center gap-1.5 font-semibold uppercase tracking-[0.08em] text-muted group-hover:text-text">
          <Award size={13} strokeWidth={2} className="text-gold" aria-hidden />
          Level {lv.level}
        </span>
        <span className="num font-medium text-gold">{lv.xp} XP</span>
      </div>
      <ProgressBar value={lv.pct} className="mt-2 h-1.5" />
      <div className="mt-1.5 text-[10.5px] leading-4 text-faint">
        още <span className="num text-muted">{lv.toNext}</span> XP до Level {lv.level + 1}
      </div>
    </Link>
  );
}

/** "PAPER · virtual funds only" note. */
export function PaperNote({ collapsed = false }: { collapsed?: boolean }) {
  if (collapsed) {
    return (
      <Tooltip side="right" className="flex justify-center" contentClassName="whitespace-nowrap" content="PAPER · virtual funds only — без реални пари">
        <span tabIndex={0} aria-label="PAPER · virtual funds only" className="flex h-6 w-6 items-center justify-center rounded-full">
          <span className="h-2 w-2 rounded-full bg-warn shadow-[0_0_0_3px_rgb(245_184_74/0.15)]" />
        </span>
      </Tooltip>
    );
  }
  return (
    <div className="flex items-center gap-2 px-1 text-[10.5px] font-semibold uppercase leading-4 tracking-[0.08em] text-faint" title="Няма реални пари и реални поръчки.">
      <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn shadow-[0_0_0_3px_rgb(245_184_74/0.15)]" />
      PAPER · virtual funds only
    </div>
  );
}

/* ────────────────────────────────────────────────── desktop sidebar */

/** Sticky glass sidebar for ≥ lg: 248px expanded / 68px icon rail. */
export function DesktopSidebar({ pathname, collapsed, xp, animate }: { pathname: string; collapsed: boolean; xp: number; animate: boolean }) {
  return (
    <aside
      aria-label="Странично меню"
      className={cx(
        "glass-strong sticky top-0 z-30 hidden h-dvh shrink-0 flex-col border-y-0 border-l-0 border-r-white/[0.07] shadow-none lg:flex",
        collapsed ? "w-rail" : "w-sidebar",
        animate && "transition-[width] duration-200 ease-out-quart",
      )}
    >
      <div className={cx("flex h-topbar shrink-0 items-center border-b border-white/[0.06]", collapsed ? "justify-center" : "px-4")}>
        <Link href="/" className="flex min-w-0 items-center gap-2.5 rounded-lg" aria-label="Trading Academy — начална страница">
          <BrandMark size={30} />
          {!collapsed && (
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-[14.5px] font-semibold tracking-[-0.01em] text-text">Trading Academy</span>
              <span className="block truncate text-[10px] font-medium uppercase tracking-[0.14em] text-faint">Learn · Practice · Paper</span>
            </span>
          )}
        </Link>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden overscroll-contain pt-3">
        <SidebarNav pathname={pathname} collapsed={collapsed} />
      </div>
      <div className={cx("shrink-0 space-y-2.5 border-t border-white/[0.06]", collapsed ? "flex flex-col items-center py-3" : "p-3")}>
        <LevelCard xp={xp} collapsed={collapsed} />
        <PaperNote collapsed={collapsed} />
      </div>
    </aside>
  );
}
