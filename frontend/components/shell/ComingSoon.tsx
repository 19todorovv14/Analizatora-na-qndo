/*
 * Temporary V2 placeholder used by routes whose feature package has not landed yet, so new nav
 * links never 404. Server-safe (no hooks).
 */
import { ArrowRight, Construction, type LucideIcon } from "lucide-react";
import Link from "next/link";

import { Badge, Checklist, EmptyState, PageHeader } from "@/components/ui";
import { cx } from "@/lib/format";

export type ComingSoonLink = { href: string; label: string; primary?: boolean };

export function ComingSoon({
  title,
  subtitle,
  icon,
  description,
  planned,
  links = [],
  padded = false,
}: {
  title: string;
  subtitle?: string;
  icon: LucideIcon;
  /** what the finished section will contain */
  description: React.ReactNode;
  /** short bullet list of planned features */
  planned?: string[];
  /** existing pages that already cover part of it */
  links?: ComingSoonLink[];
  /** add page padding (for full-bleed routes, where <main> has none) */
  padded?: boolean;
}) {
  return (
    <div className={cx("mx-auto max-w-5xl space-y-5", padded && "p-3 sm:p-4")}>
      <PageHeader title={title} subtitle={subtitle} icon={icon} badge={<Badge tone="accent">V2</Badge>} />
      <div className="card p-4 sm:p-6">
        <EmptyState
          icon={Construction}
          title="Тази секция се изгражда в V2"
          description={description}
          action={
            links.length ? (
              <>
                {links.map((l) => (
                  <Link
                    key={l.href}
                    href={l.href}
                    className={cx(
                      "inline-flex min-h-9 items-center gap-2 rounded-lg px-3.5 py-1.5 text-sm font-medium transition-[background-color,border-color,color] duration-150",
                      l.primary
                        ? "border border-[#5b95f7]/40 bg-gradient-to-b from-[#3b82f6] to-[#2563eb] text-white shadow-btn hover:from-[#4a8cf7] hover:to-[#2f6df0]"
                        : "border border-white/10 bg-white/[0.04] text-text hover:border-white/[0.18] hover:bg-white/[0.07]",
                    )}
                  >
                    {l.label}
                    <ArrowRight size={14} strokeWidth={2} aria-hidden />
                  </Link>
                ))}
              </>
            ) : undefined
          }
        />
        {planned && planned.length > 0 && (
          <div className="mx-auto mt-5 max-w-md">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted">Какво предстои</div>
            <Checklist items={planned.map((p) => ({ label: p, pass: null }))} />
          </div>
        )}
      </div>
    </div>
  );
}
