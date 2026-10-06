"use client";

import { useState } from "react";
import useSWR from "swr";

import { JournalForm, type JournalEntry } from "@/components/journal/JournalForm";
import { Badge, Button, Card, Empty, Loading, Modal, Stat } from "@/components/ui";
import { del, fetcher } from "@/lib/api";
import { cx, fmtDuration, fmtMoney, fmtPct, fmtR, fmtTime, pnlClass } from "@/lib/format";

type Group = { key: string; trades: number; net_pnl: number; win_rate: number; average_r: number | null };
type Stats = {
  entries: number;
  trades: number;
  most_profitable_setup: Group | null;
  worst_setup: Group | null;
  setups: Group[];
  most_common_mistake: { mistake: string; count: number } | null;
  mistakes: { mistake: string; count: number }[];
  average_holding_seconds: number | null;
  best_timeframe: Group | null;
  worst_timeframe: Group | null;
  average_risk_pct: number | null;
  average_r: number | null;
  emotions: Record<string, number>;
  confidence_vs_r: Record<string, number>;
};

export default function JournalPage() {
  const { data, mutate } = useSWR<{ entries: JournalEntry[] }>("/journal", fetcher);
  const { data: stats, mutate: mutateStats } = useSWR<Stats>("/journal/stats", fetcher);
  const [editing, setEditing] = useState<JournalEntry | null>(null);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  if (!data || !stats) return <Loading />;

  const done = () => {
    setEditing(null);
    setCreating(false);
    mutate();
    mutateStats();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-bold">Trading Journal</h1>
        <Button size="sm" className="ml-auto" onClick={() => setCreating(true)}>
          + New entry
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Most profitable setup" value={stats.most_profitable_setup?.key ?? "—"} sub={stats.most_profitable_setup ? fmtMoney(stats.most_profitable_setup.net_pnl, true) : undefined} />
        <Stat label="Worst setup" value={stats.worst_setup?.key ?? "—"} sub={stats.worst_setup ? fmtMoney(stats.worst_setup.net_pnl, true) : undefined} />
        <Stat label="Most common mistake" value={<span className="text-sm">{stats.most_common_mistake?.mistake ?? "—"}</span>} sub={stats.most_common_mistake ? `${stats.most_common_mistake.count}×` : undefined} />
        <Stat label="Avg holding time" value={fmtDuration(stats.average_holding_seconds)} />
        <Stat label="Best timeframe" value={stats.best_timeframe?.key ?? "—"} />
        <Stat label="Worst timeframe" value={stats.worst_timeframe?.key ?? "—"} />
        <Stat label="Average risk" value={fmtPct(stats.average_risk_pct, 2)} />
        <Stat label="Average R" term="r" value={fmtR(stats.average_r)} />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
        <Card title={`Entries (${data.entries.length})`}>
          {data.entries.length ? (
            <div className="space-y-2">
              {data.entries.map((e) => (
                <div key={e.id} className="rounded-md border border-line bg-panel2 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs text-muted">{fmtTime(e.created_ts)}</span>
                    {e.symbol && <span className="font-semibold">{e.symbol}</span>}
                    {e.side && <Badge tone={e.side === "long" ? "up" : "down"}>{e.side}</Badge>}
                    {e.setup && <Badge tone="accent">{e.setup}</Badge>}
                    {e.emotion && <Badge>{e.emotion}</Badge>}
                    {e.confidence && <span className="text-xs text-muted">confidence {e.confidence}/5</span>}
                    {e.result !== null && e.result !== undefined && (
                      <span className={cx("num ml-auto font-semibold", pnlClass(e.result))}>
                        {fmtMoney(e.result, true)} {e.r_multiple !== null && e.r_multiple !== undefined && `(${fmtR(e.r_multiple)})`}
                      </span>
                    )}
                  </div>
                  {e.reason && <p className="mt-1.5 text-text/90">{e.reason}</p>}
                  {e.lesson && (
                    <p className="mt-1 text-xs">
                      <span className="text-accent2">Lesson:</span> {e.lesson}
                    </p>
                  )}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1">
                    {(e.mistakes ?? []).map((m) => (
                      <Badge key={m} tone="down">
                        {m}
                      </Badge>
                    ))}
                    {(e.tags ?? []).map((t) => (
                      <Badge key={t}>#{t}</Badge>
                    ))}
                    {typeof e.screenshot === "string" && (
                      <button onClick={() => setPreview(e.screenshot as string)} className="text-xs text-accent2">
                        🖼 screenshot
                      </button>
                    )}
                    <span className="ml-auto flex gap-1">
                      <Button size="sm" variant="ghost" onClick={() => setEditing(e)}>
                        Edit
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => del(`/journal/${e.id}`).then(done)}>
                        Delete
                      </Button>
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty>Журналът е празен. След всяка paper сделка натисни 📓 в History или добави запис тук.</Empty>
          )}
        </Card>
        <div className="space-y-3">
          <Card title="Setups">
            {stats.setups.length ? (
              <table className="w-full text-xs">
                <tbody>
                  {stats.setups.map((g) => (
                    <tr key={g.key} className="border-t border-line first:border-0">
                      <td className="py-1">{g.key}</td>
                      <td className="num">{g.trades}</td>
                      <td className="num">{fmtPct(g.win_rate, 0)}</td>
                      <td className={cx("num text-right", pnlClass(g.net_pnl))}>{fmtMoney(g.net_pnl, true)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="text-xs text-muted">Няма данни.</p>
            )}
          </Card>
          <Card title="Mistakes">
            {stats.mistakes.length ? (
              stats.mistakes.map((m) => (
                <div key={m.mistake} className="flex justify-between text-xs">
                  <span>{m.mistake}</span>
                  <span className="num text-down">{m.count}×</span>
                </div>
              ))
            ) : (
              <p className="text-xs text-muted">Няма записани грешки.</p>
            )}
          </Card>
          <Card title="Emotions">
            {Object.entries(stats.emotions).map(([k, v]) => (
              <div key={k} className="flex justify-between text-xs">
                <span>{k}</span>
                <span className="num">{v}</span>
              </div>
            ))}
            {Object.keys(stats.confidence_vs_r).length > 0 && (
              <div className="mt-2 border-t border-line pt-2 text-xs">
                <div className="label">Confidence → average R</div>
                {Object.entries(stats.confidence_vs_r).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <span>{k}/5</span>
                    <span className="num">{fmtR(v)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      </div>

      <Modal open={creating || !!editing} onClose={() => (setCreating(false), setEditing(null))} title={editing ? "Edit entry" : "New journal entry"} wide>
        <JournalForm initial={editing ?? undefined} onSaved={done} />
      </Modal>
      <Modal open={!!preview} onClose={() => setPreview(null)} title="Screenshot" wide>
        {/* eslint-disable-next-line @next/next/no-img-element -- user-provided data URL */}
        {preview && <img src={preview} alt="screenshot" className="w-full rounded" />}
      </Modal>
    </div>
  );
}
