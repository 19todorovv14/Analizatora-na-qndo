import { Compass, LayoutDashboard } from "lucide-react";
import Link from "next/link";

import { Brand } from "@/components/shell/Brand";

export default function NotFound() {
  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 text-center">
      <div aria-hidden className="grid-mesh pointer-events-none absolute inset-0 opacity-70" />
      <div className="relative w-full max-w-md">
        <Link href="/" className="mb-8 inline-flex rounded-lg" aria-label="Trading Academy — начална страница">
          <Brand size={30} />
        </Link>
        <div className="glass-strong rounded-2xl px-6 py-9 shadow-modal">
          <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.09] to-white/[0.02] text-accent2 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.07)]">
            <Compass size={22} strokeWidth={1.75} aria-hidden />
          </span>
          <div className="num mt-5 text-5xl font-semibold tracking-[-0.04em] text-gradient">404</div>
          <h1 className="mt-2 text-lg font-semibold">404 — страницата не е намерена</h1>
          <p className="mx-auto mt-2 max-w-xs text-sm leading-relaxed text-muted">Адресът може да е грешен или секцията да е преместена.</p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <Link
              href="/dashboard"
              className="inline-flex min-h-9 items-center gap-2 rounded-lg border border-[#5b95f7]/40 bg-gradient-to-b from-[#3b82f6] to-[#2563eb] px-3.5 py-1.5 text-sm font-medium text-white shadow-btn transition-colors hover:from-[#4a8cf7] hover:to-[#2f6df0]"
            >
              <LayoutDashboard size={15} strokeWidth={2} aria-hidden />
              Към Dashboard →
            </Link>
            <Link
              href="/"
              className="inline-flex min-h-9 items-center rounded-lg border border-white/10 bg-white/[0.04] px-3.5 py-1.5 text-sm font-medium text-text transition-colors hover:border-white/[0.18] hover:bg-white/[0.07]"
            >
              Начална страница
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
