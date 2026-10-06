"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import useSWR from "swr";

import { SymbolPicker, TimeframeBar } from "@/components/charts/ChartControls";
import { StrategyBuilder, emptyDefinition } from "@/components/strategy/StrategyBuilder";
import { Badge, Button, Card, ErrorText, Field, Loading, Notice } from "@/components/ui";
import { api, del, errorMessage, fetcher, post, put } from "@/lib/api";
import { cx } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Strategy, StrategyDefinition } from "@/lib/types";

type Draft = { id?: number; name: string; description: string; symbol: string; timeframe: string; definition: StrategyDefinition; is_template?: boolean };
type SignalRes = {
  signal: string;
  evaluation: Record<string, { active: boolean; passed: boolean; conditions: { label: string; left: number | null; right: number | null; passed: boolean }[] }>;
};

const NEW: Draft = { name: "Нова стратегия", description: "", symbol: "BTC/USDT", timeframe: "1h", definition: emptyDefinition() };

export default function StrategiesPage() {
  const { beginner } = useSession();
  const { data, mutate } = useSWR<{ strategies: Strategy[] }>("/strategies", fetcher);
  const [draft, setDraft] = useState<Draft>(NEW);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [signal, setSignal] = useState<SignalRes | null>(null);

  useEffect(() => {
    if (draft.id || !data) return;
    const mine = data.strategies.find((s) => !s.is_template);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- open the user's first strategy once data arrives
    if (mine) setDraft({ ...mine });
  }, [data, draft.id]);

  if (!data) return <Loading />;
  const mine = data.strategies.filter((s) => !s.is_template);
  const templates = data.strategies.filter((s) => s.is_template);

  const save = async () => {
    setError(null);
    setSaved(null);
    const body = { name: draft.name, description: draft.description, symbol: draft.symbol, timeframe: draft.timeframe, definition: draft.definition };
    try {
      const s = draft.id && !draft.is_template ? await put<Strategy>(`/strategies/${draft.id}`, body) : await post<Strategy>("/strategies", body);
      setDraft({ ...s });
      setSaved("Запазено.");
      mutate();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const copy = async (id: number) => {
    const s = await post<Strategy>(`/strategies/${id}/copy`);
    setDraft({ ...s });
    mutate();
  };

  const check = async () => {
    if (!draft.id) return setError("Първо запази стратегията.");
    try {
      setSignal(await api<SignalRes>(`/strategies/${draft.id}/signal?symbol=${encodeURIComponent(draft.symbol)}&timeframe=${draft.timeframe}`));
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
      <div className="space-y-3">
        <Card title="Моите стратегии" right={<Button size="sm" onClick={() => setDraft({ ...NEW, definition: emptyDefinition() })}>+ New</Button>}>
          <ul className="space-y-1">
            {mine.map((s) => (
              <li key={s.id}>
                <button
                  onClick={() => {
                    setDraft({ ...s });
                    setSignal(null);
                  }}
                  className={cx("w-full rounded px-2 py-1.5 text-left text-sm hover:bg-panel2", draft.id === s.id && "bg-accent/15 text-accent2")}
                >
                  {s.name}
                  <span className="block text-[11px] text-muted">
                    {s.symbol} · {s.timeframe} · {s.rules_count} правила
                  </span>
                </button>
              </li>
            ))}
            {!mine.length && <li className="text-xs text-muted">Нямаш стратегии — копирай шаблон или създай нова.</li>}
          </ul>
        </Card>
        <Card title="Шаблони (образователни)">
          <ul className="space-y-2">
            {templates.map((t) => (
              <li key={t.id} className="rounded-md bg-panel2 p-2">
                <div className="text-sm font-semibold">{t.name}</div>
                <p className="mt-0.5 text-[11px] text-muted">{t.description}</p>
                <div className="mt-1.5 flex gap-1">
                  <Button size="sm" variant="outline" onClick={() => setDraft({ ...t })}>
                    View
                  </Button>
                  <Button size="sm" onClick={() => copy(t.id)}>
                    Copy & edit
                  </Button>
                </div>
              </li>
            ))}
          </ul>
          <p className="mt-2 text-[11px] text-faint">Шаблоните не са представени като печеливши — те са отправна точка за учене.</p>
        </Card>
      </div>

      <div className="space-y-3">
        <Card
          title={draft.is_template ? `Шаблон: ${draft.name}` : draft.id ? "Редактиране на стратегия" : "Нова стратегия"}
          right={
            <div className="flex gap-2">
              {draft.id && !draft.is_template && (
                <Button size="sm" variant="ghost" onClick={async () => { await del(`/strategies/${draft.id}`); setDraft({ ...NEW, definition: emptyDefinition() }); mutate(); }}>
                  Delete
                </Button>
              )}
              {draft.is_template ? (
                <Button size="sm" onClick={() => copy(draft.id!)}>
                  Copy & edit
                </Button>
              ) : (
                <Button size="sm" onClick={save}>
                  Save
                </Button>
              )}
            </div>
          }
        >
          <div className="mb-3 grid gap-3 md:grid-cols-2">
            <Field label="Име">
              <input className="input" value={draft.name} disabled={draft.is_template} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
            </Field>
            <Field label="Описание / хипотеза">
              <input
                className="input"
                value={draft.description}
                disabled={draft.is_template}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Защо мислиш, че това има предимство?"
              />
            </Field>
            <Field label="Asset">
              <SymbolPicker value={draft.symbol} onChange={(s) => setDraft({ ...draft, symbol: s })} />
            </Field>
            <Field label="Timeframe">
              <TimeframeBar value={draft.timeframe} onChange={(tf) => setDraft({ ...draft, timeframe: tf })} />
            </Field>
          </div>
          <StrategyBuilder value={draft.definition} onChange={(d) => setDraft({ ...draft, definition: d })} advanced={!beginner} readOnly={draft.is_template} />
          <div className="mt-3">
            <ErrorText error={error} />
            {saved && <p className="text-sm text-up">{saved}</p>}
          </div>
        </Card>

        <Card title="Какво прави тази стратегия">
          <ul className="space-y-1 text-sm">
            {((data.strategies.find((s) => s.id === draft.id)?.summary as string[] | undefined) ?? ["Запази, за да видиш обобщението."]).map((l) => (
              <li key={l} className="num text-text/90">
                {l}
              </li>
            ))}
          </ul>
          <Notice tone="info" className="mt-3">
            Стратегията генерира само SETUP (LONG / SHORT / NO TRADE). Тя НЕ търгува реални пари — може да се backtest-не или да управлява paper бот.
          </Notice>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="outline" onClick={check} disabled={!draft.id}>
              Check current signal
            </Button>
            <Link href={draft.id ? `/backtesting?strategy=${draft.id}` : "#"}>
              <Button disabled={!draft.id}>Backtest →</Button>
            </Link>
            <Link href={draft.id ? `/bots?strategy=${draft.id}` : "#"}>
              <Button variant="outline" disabled={!draft.id}>
                Create paper bot →
              </Button>
            </Link>
          </div>
          {signal && (
            <div className="mt-3 rounded-md border border-line p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm font-bold">
                  {draft.symbol} {draft.timeframe}:
                </span>
                <Badge tone={signal.signal === "LONG SETUP" ? "up" : signal.signal === "SHORT SETUP" ? "down" : "neutral"}>{signal.signal}</Badge>
              </div>
              {Object.entries(signal.evaluation)
                .filter(([, b]) => b.active)
                .map(([name, b]) => (
                  <div key={name} className="mb-2">
                    <div className="text-xs font-semibold uppercase text-muted">
                      {name.replace("_", " ")} → {b.passed ? <span className="text-up">PASSED</span> : <span className="text-down">not met</span>}
                    </div>
                    {b.conditions.map((c) => (
                      <div key={c.label} className="flex items-center gap-2 text-xs">
                        <span className={c.passed ? "text-up" : "text-down"}>{c.passed ? "✓" : "✗"}</span>
                        <span className="num">{c.label}</span>
                        <span className="num text-muted">
                          ({c.left?.toFixed(4) ?? "—"} vs {c.right?.toFixed(4) ?? "—"})
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
