"use client";

import { Activity, ArrowDownUp, Copy, Eye, Layers3, LineChart, Sparkles, Waves, Zap } from "lucide-react";

import type { StrategyRow, TemplateMeta } from "@/components/strategy/types";
import { Badge, Button, EmptyState } from "@/components/ui";
import { TF_LABEL, cx } from "@/lib/format";

const KEY_ICON: Record<string, typeof Activity> = {
  rsi_ema200_volume: Activity,
  ema_cross_trend: LineChart,
  bb_mean_reversion: Waves,
  breakout_volume: Zap,
  macd_momentum: ArrowDownUp,
  trend_momentum_structure: Layers3,
};

/** Template gallery: educational starting points (never presented as profitable). */
export function TemplateGallery({
  templates,
  meta,
  activeId,
  onView,
  onCopy,
  busyId,
}: {
  templates: StrategyRow[];
  meta?: TemplateMeta[];
  activeId?: number;
  onView: (s: StrategyRow) => void;
  onCopy: (s: StrategyRow) => void;
  busyId?: number | null;
}) {
  if (!templates.length) return <EmptyState compact title="Няма шаблони" description="Шаблоните се зареждат от сървъра при стартиране." />;
  // newest (v2) templates first
  const sorted = [...templates].sort((a, b) => {
    const va = meta?.find((m) => m.key === a.template_key)?.tags?.includes("v2") ? 1 : 0;
    const vb = meta?.find((m) => m.key === b.template_key)?.tags?.includes("v2") ? 1 : 0;
    return vb - va || a.id - b.id;
  });
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {sorted.map((t) => {
        const m = meta?.find((x) => x.key === t.template_key);
        const isNew = !!m?.tags?.includes("v2");
        const Icon = KEY_ICON[t.template_key ?? ""] ?? Sparkles;
        const active = t.id === activeId;
        return (
          <article
            key={t.id}
            className={cx(
              "card hover-lift flex min-w-0 flex-col p-4",
              isNew && "border-accent/30 bg-[linear-gradient(180deg,rgb(59_130_246/0.09),rgb(255_255_255/0.02))]",
              active && "ring-1 ring-inset ring-accent/50",
            )}
          >
            <div className="flex items-start gap-3">
              <span
                className={cx(
                  "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
                  isNew ? "bg-accent/15 text-accent2 ring-accent/30" : "bg-white/[0.05] text-muted ring-white/10",
                )}
              >
                <Icon size={17} strokeWidth={1.9} aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  {isNew && <Badge tone="accent">NEW</Badge>}
                  <Badge tone="neutral">{TF_LABEL[m?.timeframe ?? t.timeframe] ?? t.timeframe}</Badge>
                  <span className="num text-[10.5px] text-faint">
                    {t.rules_count} {t.rules_count === 1 ? "условие" : "условия"}
                  </span>
                </div>
                <h3 className="mt-1.5 text-[13.5px] font-semibold leading-snug text-text">{t.name}</h3>
              </div>
            </div>
            <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-muted">{t.description}</p>
            {m?.tags && m.tags.filter((x) => x !== "v2").length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1">
                {m.tags
                  .filter((x) => x !== "v2")
                  .map((tag) => (
                    <span key={tag} className="rounded border border-white/[0.07] bg-white/[0.03] px-1.5 py-px text-[10px] uppercase tracking-[0.05em] text-faint">
                      {tag}
                    </span>
                  ))}
              </div>
            )}
            <div className="mt-auto flex flex-wrap gap-2 pt-3.5">
              <Button size="sm" variant="outline" onClick={() => onView(t)} aria-pressed={active}>
                <Eye size={13} strokeWidth={2} aria-hidden />
                {active ? "Отворен" : "Виж правилата"}
              </Button>
              <Button size="sm" onClick={() => onCopy(t)} disabled={busyId === t.id}>
                <Copy size={13} strokeWidth={2} aria-hidden />
                Copy & edit
              </Button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
