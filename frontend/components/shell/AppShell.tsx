"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { GuidedTour } from "@/components/shell/GuidedTour";
import { NAV } from "@/components/shell/nav";
import { Loading, PaperBadge } from "@/components/ui";
import { cx } from "@/lib/format";
import { useSession } from "@/lib/session";



export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, loading, beginner, setMode, logout } = useSession();
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) return <Loading text="Зареждане на профила…" />;

  return (
    <div className="flex min-h-screen">
      <aside
        className={cx(
          "fixed inset-y-0 left-0 z-40 w-56 shrink-0 border-r border-line bg-surface transition-transform lg:static lg:translate-x-0 lg:bg-panel",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <Link href="/" className="flex items-center gap-2 px-4 py-4 font-bold tracking-wide">
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-accent text-xs text-white">TA</span>
          Trading Academy
        </Link>
        <nav className="space-y-0.5 px-2 pb-4">
          {NAV.map((n) => {
            const active = pathname === n.href || pathname.startsWith(`${n.href}/`);
            return (
              <Link
                key={n.href}
                href={n.href}
                data-tour={n.href}
                onClick={() => setMobileOpen(false)}
                className={cx(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm",
                  active ? "bg-accent/15 font-semibold text-accent2" : "text-muted hover:bg-panel3 hover:text-text",
                )}
              >
                <span className="w-4 text-center">{n.icon}</span>
                {n.label}
              </Link>
            );
          })}
        </nav>
      </aside>
      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/50 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-bg/95 px-4 py-2 backdrop-blur">
          <button className="text-xl text-muted lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Меню">
            ☰
          </button>
          <PaperBadge />
          <div className="ml-auto flex items-center gap-3">
            <div className="flex items-center rounded-md border border-line bg-panel2 p-0.5 text-xs" data-tour="mode">
              {(["beginner", "advanced"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={cx(
                    "rounded px-2.5 py-1 font-semibold uppercase tracking-wide",
                    (beginner ? "beginner" : "advanced") === m ? "bg-accent text-white" : "text-muted hover:text-text",
                  )}
                  title={m === "beginner" ? "Повече обяснения, по-малко сложни метрики" : "Всички метрики и статистики"}
                >
                  {m === "beginner" ? "Beginner" : "Advanced"}
                </button>
              ))}
            </div>
            <span className="hidden text-xs text-muted sm:inline">
              {user.display_name} · <span className="text-gold">{user.xp} XP</span>
            </span>
            {user.is_guest && (
              <Link href="/settings" className="hidden text-xs text-accent2 hover:underline md:inline">
                Запази профила
              </Link>
            )}
            <button onClick={logout} className="text-xs text-muted hover:text-text">
              Изход
            </button>
          </div>
        </header>
        <main className="min-w-0 flex-1 p-3 sm:p-4">{children}</main>
      </div>
      <GuidedTour />
    </div>
  );
}
