"use client";

import { UserPlus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import { Brand } from "@/components/shell/Brand";
import { CommandPalette } from "@/components/shell/CommandPalette";
import { GuidedTour } from "@/components/shell/GuidedTour";
import { NAV, isFullBleed } from "@/components/shell/nav";
import { ShortcutsHelp } from "@/components/shell/ShortcutsHelp";
import { DesktopSidebar, LevelCard, PaperNote, SidebarNav } from "@/components/shell/Sidebar";
import { ExplainSwitch, TopBar, WorkspaceSwitch } from "@/components/shell/TopBar";
import { Drawer, IconButton, Loading, useStoredState } from "@/components/ui";
import { useExplain } from "@/lib/explain";
import { cx } from "@/lib/format";
import { useHotkeys, type HotkeyHandler } from "@/lib/hotkeys";
import { useSession } from "@/lib/session";

type SidebarState = "expanded" | "collapsed";
const asSidebar = (v: unknown): SidebarState | undefined => (v === "expanded" || v === "collapsed" ? v : undefined);

/**
 * Authenticated platform chrome: collapsible glass sidebar (drawer below lg), sticky top bar,
 * global hotkeys, command palette, shortcuts help and the first-run guided tour.
 * Terminal routes (FULL_BLEED_PREFIXES) render edge-to-edge at viewport height − top bar.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading } = useSession();
  const { toggle: toggleExplain } = useExplain();
  const pathname = usePathname() ?? "/";
  const router = useRouter();

  const [sidebar, setSidebar] = useStoredState<SidebarState>("ta-sidebar", "expanded", { validate: asSidebar });
  const collapsed = sidebar === "collapsed";
  const [animateSidebar, setAnimateSidebar] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // close the mobile drawer whenever the route changes (state-during-render: no effect needed)
  const [routeSeen, setRouteSeen] = useState(pathname);
  if (routeSeen !== pathname) {
    setRouteSeen(pathname);
    if (mobileOpen) setMobileOpen(false);
  }

  const toggleSidebar = useCallback(() => {
    setAnimateSidebar(true);
    setSidebar((s) => (s === "collapsed" ? "expanded" : "collapsed"));
  }, [setSidebar]);
  const openSearch = useCallback(() => {
    setHelpOpen(false);
    setSearchOpen(true);
  }, []);
  const openHelp = useCallback(() => {
    setSearchOpen(false);
    setHelpOpen(true);
  }, []);

  const bindings = useMemo(() => {
    const b: Record<string, HotkeyHandler> = {
      "/": openSearch,
      "mod+k": () => (searchOpen ? setSearchOpen(false) : openSearch()),
      "?": () => (helpOpen ? setHelpOpen(false) : openHelp()),
      e: toggleExplain,
      "[": toggleSidebar,
    };
    for (const item of NAV) if (item.shortcut) b[item.shortcut] = () => router.push(item.href);
    return b;
  }, [openSearch, openHelp, searchOpen, helpOpen, toggleExplain, toggleSidebar, router]);
  useHotkeys(bindings, { enabled: !!user, allowInInputs: ["mod+k"] });

  if (loading || !user) return <Loading text="Зареждане на профила…" />;

  const fullBleed = isFullBleed(pathname);

  return (
    <div className="flex min-h-dvh">
      <DesktopSidebar pathname={pathname} collapsed={collapsed} xp={user.xp} animate={animateSidebar} />

      <Drawer open={mobileOpen} onClose={() => setMobileOpen(false)} side="left" ariaLabel="Навигация" padded={false} className="lg:hidden">
        <div className="flex h-topbar items-center justify-between gap-2 border-b border-white/[0.06] pl-4 pr-2">
          <Brand size={28} sub="Learn · Practice · Paper" />
          <IconButton icon={X} label="Затвори менюто" onClick={() => setMobileOpen(false)} tooltip={false} />
        </div>
        <div className="space-y-3 border-b border-white/[0.06] p-3">
          <WorkspaceSwitch fullWidth onNavigate={() => setMobileOpen(false)} />
          <div className="flex items-center justify-between gap-3 px-1">
            <ExplainSwitch />
            <span className="min-w-0 truncate text-xs text-muted">{user.display_name}</span>
          </div>
          {user.is_guest && (
            <Link
              href="/settings"
              onClick={() => setMobileOpen(false)}
              className="flex items-center gap-2 rounded-lg border border-accent/20 bg-accent/[0.07] px-3 py-2 text-xs font-medium text-accent2 transition-colors hover:bg-accent/[0.12] hover:text-text"
            >
              <UserPlus size={14} strokeWidth={2} aria-hidden />
              Запази профила
            </Link>
          )}
        </div>
        <div className="pt-3">
          <SidebarNav pathname={pathname} onNavigate={() => setMobileOpen(false)} />
        </div>
        <div className="space-y-2.5 border-t border-white/[0.06] p-3">
          <LevelCard xp={user.xp} onNavigate={() => setMobileOpen(false)} />
          <PaperNote />
        </div>
      </Drawer>

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          collapsed={collapsed}
          onToggleSidebar={toggleSidebar}
          onOpenMenu={() => setMobileOpen(true)}
          onOpenSearch={openSearch}
          onOpenHelp={openHelp}
        />
        <main
          data-full-bleed={fullBleed || undefined}
          className={cx("min-w-0 flex-1", fullBleed ? "h-[calc(100dvh-var(--spacing-topbar))] min-h-0" : "p-3 sm:p-4")}
        >
          {children}
        </main>
      </div>

      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} onOpenHelp={openHelp} />
      <ShortcutsHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
      <GuidedTour />
    </div>
  );
}
