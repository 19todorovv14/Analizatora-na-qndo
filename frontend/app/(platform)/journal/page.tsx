"use client";

import { NotebookPen, Plus, Search, X } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";

import { fmtHold } from "@/components/analytics/model";
import { JournalForm } from "@/components/journal/JournalForm";
import { JournalTable } from "@/components/journal/JournalTable";
import {
  EMPTY_FILTERS,
  activeFilterCount,
  distinct,
  filterEntries,
  strategyOf,
  type JournalEntry,
  type JournalFilters,
  type JournalStats,
  type ResultFilter,
} from "@/components/journal/model";
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Modal,
  PageHeader,
  Segmented,
  Skeleton,
  StatTile,
  Switch,
  TableSkeleton,
  pnlTone,
} from "@/components/ui";
import { del, fetcher } from "@/lib/api";
import { cx, fmtMoney, fmtPct, fmtR, pnlClass } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";

const RESULTS: { value: ResultFilter; label: string }[] = [
  { value: "all", label: "Всички" },
  { value: "win", label: "Печеливши" },
  { value: "loss", label: "Губещи" },
  { value: "open", label: "Без резултат" },
];

function GroupTable({ rows, empty }: { rows: { key: string; trades: number; win_rate: number | null; net: number | null }[]; empty: string }) {
  if (!rows.length) return <p className="py-2 text-xs text-muted">{empty}</p>;
  return (
    <table className="w-full text-xs">
      <tbody>
        {rows.map((g) => (
          <tr key={g.key} className="border-t border-white/[0.05] first:border-0">
            <td className="max-w-[9rem] truncate py-1.5 text-text/90" title={g.key}>
              {g.key}
            </td>
            <td className="num text-right text-muted">{g.trades}</td>
            <td className="num text-right text-muted">{fmtPct(g.win_rate, 0)}</td>
            <td className={cx("num text-right", pnlClass(g.net))}>{g.net === null ? "—" : fmtMoney(g.net, true)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function JournalPage() {
  const { data, error, mutate } = useSWR<{ entries: JournalEntry[] }>("/journal", fetcher);
  const { data: stats, mutate: mutateStats } = useSWR<JournalStats>("/journal/stats", fetcher);
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [filters, setFilters] = useState<JournalFilters>(EMPTY_FILTERS);
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q, 250);
  const entries = useMemo(() => data?.entries ?? [], [data]);
  const shown = useMemo(() => filterEntries(entries, { ...filters, q: debouncedQ }), [entries, filters, debouncedQ]);
  const symbols = useMemo(() => distinct(entries.map((e) => e.symbol)), [entries]);
  const strategies = useMemo(() => distinct(entries.map(strategyOf)), [entries]);
  const nFilters = activeFilterCount({ ...filters, q });

  const refresh = () => {
    void mutate();
    void mutateStats();
  };
  const done = () => {
    setEditing(null);
    setCreating(false);
    refresh();
  };
  const remove = async (e: JournalEntry) => {
    if (!e.id || !window.confirm("Да изтрия ли този запис от журнала?")) return;
    await del(`/journal/${e.id}`);
    refresh();
  };
  const updated = (e: JournalEntry) => {
    void mutate((d) => (d ? { entries: d.entries.map((x) => (x.id === e.id ? e : x)) } : d), { revalidate: false });
  };

  return (
    <div className="space-y-5">
      <PageHeader
        icon={NotebookPen}
        title="Trading Journal"
        subtitle="Записвай защо влизаш, как управляваш и какво научаваш. AI review оценява процеса — не резултата."
        actions={
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus size={14} strokeWidth={2.25} aria-hidden /> Нов запис
          </Button>
        }
      />

      {stats ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatTile label="Записи" value={stats.entries} sub={`${stats.trades} paper сделки общо`} />
          <StatTile label="Average R" term="r" value={fmtR(stats.average_r)} tone={pnlTone(stats.average_r)} sub={`avg risk ${fmtPct(stats.average_risk_pct, 2)}`} />
          <StatTile
            label="Най-добър setup"
            value={<span className="font-sans text-base">{stats.most_profitable_setup?.key ?? "—"}</span>}
            sub={stats.most_profitable_setup ? fmtMoney(stats.most_profitable_setup.net_pnl, true) : "няма данни"}
          />
          <StatTile
            label="Най-честа грешка"
            value={<span className="font-sans text-base">{stats.most_common_mistake?.mistake ?? "—"}</span>}
            sub={stats.most_common_mistake ? `${stats.most_common_mistake.count}×` : "няма записани"}
            tone={stats.most_common_mistake ? "warn" : "neutral"}
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} className="h-[92px] !rounded-xl" />
          ))}
        </div>
      )}

      <Card
        title={`Entries${data ? ` (${shown.length}${shown.length !== entries.length ? ` от ${entries.length}` : ""})` : ""}`}
        bodyClass="p-0"
        right={
          nFilters > 0 && (
            <button
              type="button"
              onClick={() => {
                setFilters(EMPTY_FILTERS);
                setQ("");
              }}
              className="inline-flex items-center gap-1 text-xs text-muted hover:text-text"
            >
              <X size={12} strokeWidth={2.25} aria-hidden /> Изчисти филтрите ({nFilters})
            </button>
          )
        }
      >
        <div className="flex flex-wrap items-center gap-2 border-b border-white/[0.06] px-3 py-2.5">
          <label className="relative min-w-[12rem] flex-1 sm:max-w-xs">
            <Search size={14} strokeWidth={2} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
            <input className="input w-full !pl-8" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Търси…" aria-label="Търси в журнала" />
          </label>
          <Segmented options={RESULTS} value={filters.result} onChange={(v) => setFilters({ ...filters, result: v })} size="sm" ariaLabel="Резултат" />
          <select className="input w-auto" value={filters.symbol} onChange={(e) => setFilters({ ...filters, symbol: e.target.value })} aria-label="Инструмент">
            <option value="">Всички инструменти</option>
            {symbols.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className="input w-auto" value={filters.strategy} onChange={(e) => setFilters({ ...filters, strategy: e.target.value })} aria-label="Стратегия">
            <option value="">Всички стратегии</option>
            {strategies.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <Switch checked={filters.reviewed} onChange={(v) => setFilters({ ...filters, reviewed: v })} label="с AI review" />
        </div>
        {!data ? (
          error ? (
            <ErrorState title="Журналът не се зареди" onRetry={() => void mutate()} className="m-3" />
          ) : (
            <TableSkeleton rows={5} cols={8} className="p-3" />
          )
        ) : !entries.length ? (
          <EmptyState
            className="m-3"
            icon={NotebookPen}
            title="Журналът е празен"
            description="След всяка paper сделка натисни 📓 в историята на терминала или добави запис тук — причина, план, емоция и урок."
            action={
              <Button size="sm" onClick={() => setCreating(true)}>
                <Plus size={13} strokeWidth={2.25} aria-hidden /> Първи запис
              </Button>
            }
          />
        ) : !shown.length ? (
          <EmptyState className="m-3" compact icon={Search} title="Няма записи по тези филтри" description="Промени или изчисти филтрите." />
        ) : (
          <JournalTable entries={shown} onEdit={setEditing} onDelete={(e) => void remove(e)} onUpdated={updated} onOpenShot={setPreview} />
        )}
      </Card>

      {stats && stats.entries > 0 && (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <Card title="Setups">
            <GroupTable rows={stats.setups.map((g) => ({ key: g.key, trades: g.trades, win_rate: g.win_rate, net: g.net_pnl }))} empty="Няма данни." />
          </Card>
          <Card title="Strategies">
            <GroupTable
              rows={(stats.entries_by_strategy ?? []).map((g) => ({ key: g.key, trades: g.entries, win_rate: g.win_rate, net: g.net_result }))}
              empty="Добави стратегия към записите."
            />
          </Card>
          <Card title="Timeframes">
            <GroupTable rows={(stats.timeframes ?? []).map((g) => ({ key: g.key, trades: g.trades, win_rate: g.win_rate, net: g.net_pnl }))} empty="Няма данни." />
            <p className="mt-2 text-[11px] text-faint">Средно държане: {fmtHold(stats.average_holding_seconds)}</p>
          </Card>
          <Card title="Mistakes & emotions">
            {stats.mistakes.length ? (
              <ul className="space-y-1 text-xs">
                {stats.mistakes.map((m) => (
                  <li key={m.mistake} className="flex justify-between gap-2">
                    <span className="truncate">{m.mistake}</span>
                    <span className="num text-down">{m.count}×</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-muted">Няма записани грешки.</p>
            )}
            {Object.keys(stats.emotions).length > 0 && (
              <div className="mt-2.5 flex flex-wrap gap-1 border-t border-white/[0.05] pt-2.5">
                {Object.entries(stats.emotions).map(([k, v]) => (
                  <span key={k} className="rounded-full bg-white/[0.05] px-2 py-0.5 text-[11px] text-muted">
                    {k} <span className="num text-text">{v}</span>
                  </span>
                ))}
              </div>
            )}
            {Object.keys(stats.confidence_vs_r).length > 0 && (
              <div className="mt-2.5 border-t border-white/[0.05] pt-2.5 text-xs">
                <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">Confidence → avg R</div>
                {Object.entries(stats.confidence_vs_r).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span className="text-muted">{k}/5</span>
                    <span className={cx("num", pnlClass(v))}>{fmtR(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      <Modal open={creating || !!editing} onClose={() => (setCreating(false), setEditing(null))} title={editing ? "Редакция на запис" : "Нов запис в журнала"} wide>
        <JournalForm key={editing?.id ?? "new"} initial={editing ?? undefined} onSaved={done} />
      </Modal>
      <Modal open={!!preview} onClose={() => setPreview(null)} title="Screenshot" wide>
        {/* eslint-disable-next-line @next/next/no-img-element -- user-provided data URL */}
        {preview && <img src={preview} alt="Screenshot на сделката" className="w-full rounded-lg" />}
      </Modal>
    </div>
  );
}
