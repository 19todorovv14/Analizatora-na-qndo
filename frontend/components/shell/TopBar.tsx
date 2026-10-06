"use client";

import {
  Award,
  ChevronDown,
  Database,
  GraduationCap,
  Keyboard,
  Lightbulb,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  UserPlus,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { BrandMark } from "@/components/shell/Brand";
import { LevelCard } from "@/components/shell/Sidebar";
import { ShortcutKeys } from "@/components/shell/ShortcutKeys";
import { levelInfo } from "@/components/shell/level";
import { IconButton, Kbd, PaperBadge, Popover, Segmented, Switch } from "@/components/ui";
import { useExplain } from "@/lib/explain";
import { cx } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { User } from "@/lib/types";
import { useWorkspace, type WorkspaceMode } from "@/lib/workspace";

/* ───────────────────────────────────────────────────────── pieces */

export function Avatar({ name, size = 28, className }: { name: string; size?: number; className?: string }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? "")
      .join("") || "T";
  return (
    <span
      aria-hidden
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-gradient-to-b from-[#3a4a6b] to-[#1c2539] font-semibold text-text shadow-[inset_0_1px_0_rgb(255_255_255/0.14)] ring-1 ring-white/10",
        className,
      )}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}
    >
      {initials}
    </span>
  );
}

/** LEARN | TRADE workspace switch: sets the workspace mode and opens /learn or /trade. */
export function WorkspaceSwitch({ fullWidth, onNavigate }: { fullWidth?: boolean; onNavigate?: () => void }) {
  const { mode, setMode } = useWorkspace();
  const router = useRouter();
  return (
    <Segmented<WorkspaceMode>
      ariaLabel="Работно пространство"
      fullWidth={fullWidth}
      value={mode}
      onChange={(m) => {
        setMode(m);
        router.push(m === "learn" ? "/learn" : "/trade");
        onNavigate?.();
      }}
      options={[
        {
          value: "learn",
          title: "Learn workspace — уроци, обяснения и подсказки",
          label: (
            <>
              <GraduationCap size={13} strokeWidth={2} aria-hidden />
              LEARN
            </>
          ),
        },
        {
          value: "trade",
          title: "Paper trading — virtual funds only",
          label: (
            <>
              <Wallet size={13} strokeWidth={2} aria-hidden />
              TRADE
            </>
          ),
        },
      ]}
    />
  );
}

/** Explain-mode switch (lightbulb + "Explain"). */
export function ExplainSwitch({ className }: { className?: string }) {
  const { explain, setExplain } = useExplain();
  return (
    <Switch
      checked={explain}
      onChange={setExplain}
      className={className}
      title="Explain mode — термините се подчертават и показват обяснение при посочване (клавиш E)"
      label={
        <span className="inline-flex items-center gap-1">
          <Lightbulb size={14} strokeWidth={1.9} aria-hidden className={cx("transition-colors", explain ? "text-gold" : "text-faint")} />
          Explain
        </span>
      }
    />
  );
}

function MenuRow({ icon: Icon, children, href, onClick }: { icon: LucideIcon; children: React.ReactNode; href?: string; onClick?: () => void }) {
  const cls =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-muted transition-colors hover:bg-white/[0.06] hover:text-text focus-visible:bg-white/[0.06] focus-visible:text-text";
  const inner = (
    <>
      <Icon size={15} strokeWidth={1.8} className="shrink-0 text-faint" aria-hidden />
      <span className="flex min-w-0 flex-1 items-center justify-between gap-2">{children}</span>
    </>
  );
  if (href)
    return (
      <Link href={href} className={cls} onClick={onClick}>
        {inner}
      </Link>
    );
  return (
    <button type="button" className={cls} onClick={onClick}>
      {inner}
    </button>
  );
}

function UserMenu({ user, onOpenHelp }: { user: User; onOpenHelp: () => void }) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const close = () => setOpen(false);
  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label="Профилно меню"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          "flex h-9 items-center gap-2 rounded-lg pl-1 pr-1.5 transition-colors duration-150",
          open ? "bg-white/[0.07]" : "hover:bg-white/[0.05]",
        )}
      >
        <Avatar name={user.display_name} />
        <span className="hidden max-w-[132px] truncate text-[13px] font-medium text-text @7xl:block">{user.display_name}</span>
        <ChevronDown size={14} strokeWidth={2} aria-hidden className={cx("text-faint transition-transform duration-150", open && "rotate-180")} />
      </button>
      <Popover open={open} onClose={close} anchor={btn} align="end" className="w-72 p-0" ariaLabel="Профил">
        <div className="border-b border-white/[0.06] p-3">
          <div className="flex items-center gap-3">
            <Avatar name={user.display_name} size={36} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-text">{user.display_name}</div>
              <div className="truncate text-xs text-faint">{user.is_guest ? "Гост профил · временен демо акаунт" : user.email}</div>
            </div>
          </div>
          <div className="mt-3">
            <LevelCard xp={user.xp} onNavigate={close} />
          </div>
        </div>
        <div className="p-1.5">
          <MenuRow icon={Settings} href="/settings" onClick={close}>
            Профил и настройки
          </MenuRow>
          <MenuRow icon={Database} href="/settings/data-sources" onClick={close}>
            Източници на данни
          </MenuRow>
          <MenuRow
            icon={Keyboard}
            onClick={() => {
              close();
              onOpenHelp();
            }}
          >
            Клавишни комбинации
            <ShortcutKeys combo="?" />
          </MenuRow>
        </div>
        {user.is_guest && (
          <div className="border-t border-white/[0.06] px-3.5 py-3 text-xs leading-relaxed text-muted">
            Гост профилът пази прогреса само в този браузър.{" "}
            <Link href="/settings" onClick={close} className="font-medium text-accent2 hover:text-text">
              Създай акаунт от него →
            </Link>
          </div>
        )}
      </Popover>
    </>
  );
}

/* ───────────────────────────────────────────────────────── top bar */

/**
 * Sticky glass top bar. It is a size container: optional pieces appear as the bar gets wider
 * (the width depends on the sidebar state, not only on the viewport).
 */
export function TopBar({
  collapsed,
  onToggleSidebar,
  onOpenMenu,
  onOpenSearch,
  onOpenHelp,
}: {
  collapsed: boolean;
  onToggleSidebar: () => void;
  onOpenMenu: () => void;
  onOpenSearch: () => void;
  onOpenHelp: () => void;
}) {
  const { user, beginner, setMode, logout } = useSession();
  if (!user) return null;
  const lv = levelInfo(user.xp);

  return (
    <header className="glass-strong @container sticky top-0 z-20 h-topbar shrink-0 border-x-0 border-t-0 border-b-white/[0.07] shadow-[0_1px_0_rgb(0_0_0/0.25),0_8px_24px_-16px_rgb(0_0_0/0.8)]">
      <div className="flex h-full items-center gap-1.5 px-2.5 @xl:gap-2 @xl:px-4">
        {/* left: menu / sidebar toggle */}
        <div className="flex items-center gap-1 lg:hidden">
          <IconButton icon={Menu} label="Меню" onClick={onOpenMenu} tooltip={false} />
          <Link href="/dashboard" aria-label="Trading Academy — Dashboard" className="rounded-lg">
            <BrandMark size={26} />
          </Link>
        </div>
        <div className="hidden lg:block">
          <IconButton
            icon={collapsed ? PanelLeftOpen : PanelLeftClose}
            label={collapsed ? "Разгъни менюто" : "Свий менюто"}
            shortcut="["
            onClick={onToggleSidebar}
          />
        </div>

        <div data-tour="workspace" className="hidden @2xl:block">
          <WorkspaceSwitch />
        </div>

        {/* search trigger (opens the command palette) */}
        <div data-tour="search" className="flex min-w-0 @xl:max-w-[420px] @xl:flex-1">
          <button
            type="button"
            onClick={onOpenSearch}
            aria-haspopup="dialog"
            aria-keyshortcuts="/ Control+K Meta+K"
            className="group hidden h-9 min-w-0 flex-1 items-center gap-2.5 rounded-[10px] border border-white/[0.09] bg-black/25 px-3 text-left text-[13px] text-faint shadow-[inset_0_1px_1px_rgb(0_0_0/0.25)] transition-[border-color,color,background-color] duration-150 hover:border-white/[0.16] hover:bg-black/30 hover:text-muted @xl:flex"
          >
            <Search size={15} strokeWidth={2} className="shrink-0 text-faint group-hover:text-muted" aria-hidden />
            <span className="min-w-0 flex-1 truncate">Търси актив, урок или страница…</span>
            <Kbd>/</Kbd>
          </button>
          <div className="@xl:hidden">
            <IconButton icon={Search} label="Търсене" shortcut="/" onClick={onOpenSearch} />
          </div>
        </div>

        {/* right cluster */}
        <div className="ml-auto flex items-center gap-1.5 @xl:gap-2.5">
          <div className="hidden @3xl:flex">
            <ExplainSwitch />
          </div>
          <div data-tour="mode">
            <Segmented
              size="sm"
              variant="accent"
              ariaLabel="Ниво на детайлност"
              value={beginner ? "beginner" : "advanced"}
              onChange={(m) => void setMode(m)}
              options={[
                { value: "beginner", label: "Beginner", title: "Повече обяснения, по-малко сложни метрики" },
                { value: "advanced", label: "Advanced", title: "Всички метрики и статистики" },
              ]}
            />
          </div>
          <PaperBadge compact className="hidden @6xl:inline-flex" />
          <Link
            href="/learn"
            title={`Level ${lv.level} · ${lv.xp} XP · още ${lv.toNext} XP до Level ${lv.level + 1}`}
            className="hidden h-6 items-center gap-1.5 rounded-md border border-gold/20 bg-gold/[0.07] px-2 text-[11px] font-semibold leading-none text-gold transition-colors hover:border-gold/35 hover:bg-gold/[0.1] @6xl:inline-flex"
          >
            <Award size={12} strokeWidth={2.2} aria-hidden />
            L{lv.level}
            <span className="text-gold/45" aria-hidden>
              ·
            </span>
            <span className="num">{lv.xp} XP</span>
          </Link>

          <span aria-hidden className="mx-0.5 hidden h-5 w-px bg-white/[0.08] @4xl:block" />

          <div className="hidden @4xl:block">
            <UserMenu user={user} onOpenHelp={onOpenHelp} />
          </div>
          {user.is_guest && (
            <Link
              href="/settings"
              className="hidden items-center gap-1.5 whitespace-nowrap rounded-lg px-2 py-1.5 text-xs font-medium text-accent2 transition-colors hover:bg-accent/10 hover:text-text @4xl:inline-flex"
              title="Запази гост профила с имейл и парола"
            >
              <UserPlus size={14} strokeWidth={2} aria-hidden />
              Запази профила
            </Link>
          )}
          <button
            type="button"
            onClick={() => void logout()}
            title="Изход от профила"
            className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-xs font-medium text-muted transition-colors hover:bg-white/[0.05] hover:text-text"
          >
            <LogOut size={15} strokeWidth={1.9} aria-hidden />
            <span className="sr-only @md:not-sr-only">Изход</span>
          </button>
        </div>
      </div>
    </header>
  );
}
