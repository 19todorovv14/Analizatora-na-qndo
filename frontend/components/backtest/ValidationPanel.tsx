"use client";

import {
  ArrowRight,
  BarChart3,
  Coins,
  FlaskConical,
  Gauge,
  Layers,
  ListChecks,
  ShieldAlert,
  SplitSquareHorizontal,
  TriangleAlert,
  Users,
} from "lucide-react";

import { REGIME_BAR, fmtPF, fmtSigned } from "@/components/backtest/format";
import { PAST_PERFORMANCE, type MetricsV2, type OosComparisonRow, type RunSummary, type Validation, type WalkForward } from "@/components/backtest/types";
import { REGIME_LABEL } from "@/components/strategy/meta";
import { Badge, Card, Meter, Notice, RegimeBadge, Term, Tooltip, type Tone } from "@/components/ui";
import { cx, fmtDate, fmtMoney, fmtPct, fmtR, pnlClass } from "@/lib/format";

/* ───────────────────────────────────────────────────────── helpers */

function SubHead({ icon: Icon, children, right }: { icon: typeof Gauge; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <div className="mb-2.5 flex min-h-6 flex-wrap items-center gap-2">
      <Icon size={14} strokeWidth={2} className="text-accent2" aria-hidden />
      <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text/90">{children}</h3>
      {right && <div className="ml-auto flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cx("min-w-0 rounded-xl border border-white/[0.07] bg-white/[0.02] p-3.5", className)}>{children}</div>;
}

function Explain({ show, children }: { show: boolean; children: React.ReactNode }) {
  if (!show) return null;
  return <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted">{children}</p>;
}

const RISK_TONE: Record<string, Tone> = { LOW: "up", MEDIUM: "warn", HIGH: "down" };
const RISK_TEXT: Record<string, string> = { LOW: "text-up", MEDIUM: "text-warn", HIGH: "text-down" };

/* ─────────────────────────────────────────────── past performance */

/** The mandatory banner with the exact English sentence (+ Bulgarian explanation). */
export function PastPerformanceBanner({ text = PAST_PERFORMANCE, className }: { text?: string; className?: string }) {
  return (
    <div role="note" className={cx("flex items-start gap-3 rounded-xl border border-warn/35 bg-warn/[0.08] px-3.5 py-3", className)}>
      <ShieldAlert size={18} strokeWidth={2} className="mt-0.5 shrink-0 text-warn" aria-hidden />
      <div className="min-w-0">
        <p className="text-sm font-semibold leading-snug text-warn">{text}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-muted">
          Резултатите са симулация върху минали данни с виртуални пари. Те показват как правилата биха се държали тогава — не какво ще стане занапред.
        </p>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────── overfitting */

function OverfittingCard({ v, beginner }: { v: Validation; beginner: boolean }) {
  const o = v.overfitting;
  if (!o) {
    return (
      <Panel>
        <SubHead icon={Gauge}>
          <Term k="overfitting">Overfitting risk</Term>
        </SubHead>
        <p className="text-sm text-muted">Оценката не е налична за този (по-стар) backtest — пусни го отново.</p>
      </Panel>
    );
  }
  const tone = RISK_TONE[o.risk] ?? "neutral";
  const inputs = o.inputs ?? {};
  return (
    <Panel className={cx(o.risk === "HIGH" && "border-down/25 bg-down/[0.035]", o.risk === "MEDIUM" && "border-warn/20")}>
      <SubHead icon={Gauge} right={<Badge tone={tone}>score {o.score}/100</Badge>}>
        <Term k="overfitting">Overfitting risk</Term>
      </SubHead>
      <div className="flex flex-wrap items-end gap-x-3 gap-y-1">
        <span className={cx("text-[26px] font-semibold leading-none tracking-[-0.02em]", RISK_TEXT[o.risk])}>{o.risk}</span>
        <span className="pb-0.5 text-xs text-muted">OVERFITTING RISK</span>
      </div>
      <Meter className="mt-3" value={o.score} max={100} tone="auto" />
      <div className="mt-1 flex justify-between text-[10px] uppercase tracking-[0.06em] text-faint">
        <span>Low</span>
        <span>Medium · 30</span>
        <span>High · 60</span>
      </div>
      {o.text && <p className="mt-3 text-[13px] leading-relaxed text-text/90">{o.text}</p>}
      {o.reasons.length > 0 && (
        <ul className="mt-2.5 space-y-1.5">
          {o.reasons.map((r) => (
            <li key={r} className="flex gap-2 text-xs leading-relaxed text-muted">
              <TriangleAlert size={13} strokeWidth={2} className={cx("mt-0.5 shrink-0", RISK_TEXT[o.risk] ?? "text-warn")} aria-hidden />
              <span className="min-w-0">{r}</span>
            </li>
          ))}
        </ul>
      )}
      {!beginner && o.factors && o.factors.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {o.factors.map((f) => (
            <Tooltip key={f.key} content={f.text}>
              <span className="inline-flex items-center gap-1 rounded-md border border-white/[0.08] bg-white/[0.03] px-1.5 py-0.5 text-[10.5px] text-muted">
                {f.key.replace(/_/g, " ")} <b className="num text-text">+{f.points}</b>
              </span>
            </Tooltip>
          ))}
        </div>
      )}
      {!beginner && (
        <div className="mt-3 grid grid-cols-3 gap-1.5 text-[11px]">
          {(
            [
              ["Параметри", inputs.parameters],
              ["Условия", inputs.conditions],
              ["Сделки", inputs.trades],
            ] as const
          ).map(([k, val]) => (
            <div key={k} className="glass-inset px-2 py-1.5">
              <div className="text-faint">{k}</div>
              <div className="num text-sm font-semibold text-text">{val ?? "—"}</div>
            </div>
          ))}
        </div>
      )}
      <Explain show={beginner}>
        Overfitting = правилата са „напаснати“ към миналото: изглеждат отлично в теста, но не работят на нови данни. Рискът расте с броя
        параметри и условия, при малко сделки и при прекалено добри резултати.
      </Explain>
    </Panel>
  );
}

/* ─────────────────────────────────────────────── sample size */

const SAMPLE_TONE: Record<string, Tone> = { adequate: "up", good: "up", limited: "warn", insufficient: "down", tiny: "down", none: "down" };

function SampleSizeCard({ v, m, beginner }: { v: Validation; m: MetricsV2; beginner: boolean }) {
  const n = v.sample_size.trades;
  return (
    <Panel>
      <SubHead icon={Users} right={<Badge tone={SAMPLE_TONE[v.sample_size.verdict] ?? "warn"}>{v.sample_size.verdict}</Badge>}>
        Sample size
      </SubHead>
      <div className="flex items-end gap-2">
        <span className="num text-[26px] font-semibold leading-none text-text">{n}</span>
        <span className="pb-0.5 text-xs text-muted">сделки</span>
        {m.trades_per_month !== undefined && m.trades_per_month !== null && (
          <span className="num ml-auto pb-0.5 text-[11px] text-faint">{m.trades_per_month.toFixed(1)} / месец</span>
        )}
      </div>
      <div className="relative mt-3">
        <Meter value={Math.min(n, 150)} max={150} tone={n >= 100 ? "up" : n >= 30 ? "warn" : "down"} />
        <span className="absolute -top-0.5 h-2.5 w-px bg-white/40" style={{ left: `${(30 / 150) * 100}%` }} aria-hidden />
        <span className="absolute -top-0.5 h-2.5 w-px bg-white/40" style={{ left: `${(100 / 150) * 100}%` }} aria-hidden />
      </div>
      <div className="relative mt-1 h-3 text-[10px] text-faint">
        <span className="absolute -translate-x-1/2" style={{ left: `${(30 / 150) * 100}%` }}>
          30
        </span>
        <span className="absolute -translate-x-1/2" style={{ left: `${(100 / 150) * 100}%` }}>
          100
        </span>
      </div>
      <p className="mt-2.5 text-[13px] leading-relaxed text-text/90">{v.sample_size.text}</p>
      <div className="mt-3 grid grid-cols-2 gap-1.5 text-[11px]">
        <div className="glass-inset px-2 py-1.5">
          <div className="text-faint">Условия</div>
          <div className="num text-sm font-semibold text-text">{v.complexity.conditions}</div>
        </div>
        <div className="glass-inset px-2 py-1.5">
          <div className="text-faint">Числови параметри</div>
          <div className="num text-sm font-semibold text-text">{v.complexity.parameters}</div>
        </div>
      </div>
      <Explain show={beginner}>
        Под 30 сделки резултатът е почти случаен; 100+ сделки дават по-стабилна картина. Всяко ново условие намалява броя сделки.
      </Explain>
    </Panel>
  );
}

/* ───────────────────────────────────────────── in-sample vs OOS */

function fmtCmp(key: string, v: number | null | undefined, delta = false): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return "—";
  switch (key) {
    case "total_trades":
      return delta ? fmtSigned(v, 0) : String(Math.round(v));
    case "win_rate":
    case "return_pct":
    case "max_drawdown_pct":
      return delta ? `${fmtSigned(v, 1)} pp` : fmtPct(v, key === "return_pct" ? 2 : 1, key === "return_pct");
    case "profit_factor":
      return delta ? fmtSigned(Math.max(-99, Math.min(99, v))) : fmtPF(v);
    case "expectancy_r":
      return fmtR(v);
    case "net_pnl":
      return fmtMoney(v, true);
    default:
      return delta ? fmtSigned(v) : v.toFixed(2);
  }
}

function deltaTone(key: string, d: number | null): string {
  if (d === null || !Number.isFinite(d) || d === 0 || key === "total_trades") return "text-muted";
  const good = key === "max_drawdown_pct" ? d < 0 : d > 0;
  return good ? "text-up" : "text-down";
}

function summaryRows(is: RunSummary, oos: RunSummary): OosComparisonRow[] {
  const keys: [keyof RunSummary, string][] = [
    ["total_trades", "Trades"],
    ["win_rate", "Win rate %"],
    ["profit_factor", "Profit factor"],
    ["expectancy_r", "Expectancy (R)"],
    ["net_pnl", "Net P/L"],
    ["max_drawdown_pct", "Max drawdown %"],
  ];
  return keys.map(([k, label]) => {
    const a = is[k] as number | null;
    const b = oos[k] as number | null;
    return { key: k, label, in_sample: a, out_of_sample: b, delta: a !== null && b !== null && Number.isFinite(a) && Number.isFinite(b) ? b - a : null };
  });
}

const DEGRADE_TONE: Record<string, Tone> = { reversed: "down", much_weaker: "down", weaker: "warn", similar_or_better: "up" };

function OosPanel({ v, beginner }: { v: Validation; beginner: boolean }) {
  const o = v.out_of_sample;
  return (
    <Panel>
      <SubHead icon={SplitSquareHorizontal} right={o?.degradation ? <Badge tone={DEGRADE_TONE[o.degradation.verdict] ?? "neutral"}>{o.degradation.verdict.replace(/_/g, " ")}</Badge> : undefined}>
        In-sample vs <Term k="out_of_sample">Out-of-sample</Term>
      </SubHead>
      {!o ? (
        <p className="text-sm text-muted">Периодът е твърде кратък за разделяне 70 / 30 — избери по-дълъг период.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[340px] text-xs">
              <thead className="text-left text-[10.5px] uppercase tracking-[0.06em] text-muted">
                <tr className="border-b border-white/[0.07]">
                  <th className="py-1.5 font-semibold">Метрика</th>
                  <th className="py-1.5 text-right font-semibold">
                    In-sample <span className="font-normal normal-case text-faint">70%</span>
                  </th>
                  <th className="py-1.5 text-right font-semibold">
                    OOS <span className="font-normal normal-case text-faint">30%</span>
                  </th>
                  <th className="py-1.5 text-right font-semibold">Δ</th>
                </tr>
              </thead>
              <tbody>
                {(o.comparison?.length ? o.comparison : summaryRows(o.in_sample, o.out_of_sample)).map((r) => (
                  <tr key={r.key} className="border-b border-white/[0.04] last:border-0">
                    <td className="py-1.5 text-muted">{r.label}</td>
                    <td className="num py-1.5 text-right text-text/90">{fmtCmp(r.key, r.in_sample)}</td>
                    <td className="num py-1.5 text-right font-medium text-text">{fmtCmp(r.key, r.out_of_sample)}</td>
                    <td className={cx("num py-1.5 text-right", deltaTone(r.key, r.delta))}>{fmtCmp(r.key, r.delta, r.key !== "net_pnl" && r.key !== "expectancy_r")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[10.5px] text-faint">
            {o.in_sample_period && (
              <span>
                IS: {fmtDate(o.in_sample_period.start_ts)} – {fmtDate(o.in_sample_period.end_ts)}
              </span>
            )}
            <span>
              OOS: от {fmtDate(o.out_of_sample_period?.start_ts ?? o.split_ts)}
              {o.out_of_sample_period ? ` – ${fmtDate(o.out_of_sample_period.end_ts)}` : ""}
            </span>
          </div>
          {o.degradation?.text && <p className="mt-2 text-[12.5px] leading-relaxed text-text/90">{o.degradation.text}</p>}
        </>
      )}
      <Explain show={beginner}>
        Първите 70% от периода са „in-sample“, последните 30% — „out-of-sample“ (данни, които правилата не са „виждали“ при избора им). Ако OOS е
        много по-слаб, предимството вероятно е случайно.
      </Explain>
    </Panel>
  );
}

/* ─────────────────────────────────────────────── walk-forward */

const WF_TONE: Record<string, Tone> = { consistent: "up", inconsistent: "warn", insufficient: "neutral" };

function WalkForwardChart({ wf }: { wf: WalkForward }) {
  const ws = wf.windows;
  const vals = ws.map((w) => w.return_pct ?? 0);
  const maxAbs = Math.max(0.5, ...vals.map((x) => Math.abs(x)));
  const W = 100 / Math.max(1, ws.length);
  return (
    <div className="relative h-36 w-full rounded-lg border border-white/[0.05] bg-black/15 px-2 pb-6 pt-3" role="img" aria-label="Walk-forward: доходност по прозорци">
      <div className="relative h-full">
        <span className="absolute inset-x-0 top-1/2 h-px bg-white/15" aria-hidden />
        {ws.map((w, i) => {
          const v = w.return_pct ?? 0;
          const h = (Math.abs(v) / maxAbs) * 40;
          return (
            <span key={w.index} className="absolute inset-y-0 block" style={{ left: `${i * W}%`, width: `${W}%` }}>
              <Tooltip
                content={`W${w.index}: ${fmtDate(w.start_ts)} – ${fmtDate(w.end_ts)} · ${w.trades} сделки · ${fmtPct(w.return_pct, 2, true)}`}
                className="absolute inset-0 block"
              >
                <span className="absolute inset-0 block">
                  <span
                    className={cx("absolute left-1/2 w-[46%] max-w-14 -translate-x-1/2 rounded-sm", v >= 0 ? "bg-up/75" : "bg-down/75", !w.trades && "opacity-30")}
                    style={v >= 0 ? { bottom: "50%", height: `${Math.max(h, 1)}%` } : { top: "50%", height: `${Math.max(h, 1)}%` }}
                  />
                  <span
                    className={cx("num absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-medium", v >= 0 ? "text-up" : "text-down")}
                    style={v >= 0 ? { bottom: `calc(50% + ${Math.max(h, 1)}% + 2px)` } : { top: `calc(50% + ${Math.max(h, 1)}% + 2px)` }}
                  >
                    {fmtSigned(v, 1)}%
                  </span>
                </span>
              </Tooltip>
            </span>
          );
        })}
      </div>
      <div className="absolute inset-x-2 bottom-1 flex">
        {ws.map((w) => (
          <span key={w.index} className="text-center text-[10px] font-semibold uppercase tracking-[0.06em] text-faint" style={{ width: `${W}%` }}>
            W{w.index}
          </span>
        ))}
      </div>
    </div>
  );
}

function WalkForwardPanel({ v, beginner }: { v: Validation; beginner: boolean }) {
  const wf = v.walk_forward;
  return (
    <Panel>
      <SubHead
        icon={Layers}
        right={
          wf?.available ? (
            <>
              <span className="num text-[11px] text-muted">
                {wf.profitable_windows ?? wf.windows.filter((w) => w.profitable).length} / {wf.windows.length} печеливши прозореца
              </span>
              <Badge tone={WF_TONE[wf.verdict] ?? "neutral"}>{wf.verdict}</Badge>
            </>
          ) : undefined
        }
      >
        <Term k="walk_forward">Walk-forward</Term>
        <span className="font-normal normal-case tracking-normal text-faint">· {wf?.method ?? "walk-forward evaluation of fixed rules"}</span>
      </SubHead>
      {!wf ? (
        <p className="text-sm text-muted">Walk-forward не е наличен за този (по-стар) backtest — пусни го отново.</p>
      ) : !wf.available || !wf.windows.length ? (
        <p className="text-sm text-muted">{wf.text ?? "Периодът е твърде кратък за няколко последователни прозореца."}</p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.6fr)]">
          <div className="min-w-0">
            <WalkForwardChart wf={wf} />
            {wf.text && <p className="mt-2.5 text-[12.5px] leading-relaxed text-text/90">{wf.text}</p>}
          </div>
          <div className="min-w-0 overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <thead className="text-left text-[10.5px] uppercase tracking-[0.06em] text-muted">
                <tr className="border-b border-white/[0.07]">
                  <th className="py-1.5 font-semibold">Прозорец</th>
                  <th className="py-1.5 font-semibold">Период</th>
                  <th className="py-1.5 text-right font-semibold">Trades</th>
                  <th className="py-1.5 text-right font-semibold">Return</th>
                  <th className="py-1.5 text-right font-semibold">Win</th>
                  <th className="py-1.5 text-right font-semibold">PF</th>
                  <th className="py-1.5 text-right font-semibold">Exp.</th>
                  <th className="py-1.5 text-right font-semibold">DD</th>
                </tr>
              </thead>
              <tbody>
                {wf.windows.map((w) => (
                  <tr key={w.index} className="border-b border-white/[0.04] last:border-0">
                    <td className="py-1.5">
                      <span className={cx("mr-1.5 inline-block h-1.5 w-1.5 rounded-full", w.profitable ? "bg-up" : "bg-down")} aria-hidden />
                      <span className="font-medium text-text">W{w.index}</span>
                    </td>
                    <td className="num py-1.5 text-muted">
                      {fmtDate(w.start_ts)} – {fmtDate(w.end_ts)}
                    </td>
                    <td className="num py-1.5 text-right text-text/90">{w.trades}</td>
                    <td className={cx("num py-1.5 text-right font-medium", pnlClass(w.return_pct))}>{fmtPct(w.return_pct, 2, true)}</td>
                    <td className="num py-1.5 text-right text-text/90">{fmtPct(w.win_rate, 0)}</td>
                    <td className="num py-1.5 text-right text-text/90">{fmtPF(w.profit_factor)}</td>
                    <td className={cx("num py-1.5 text-right", pnlClass(w.expectancy_r))}>{fmtR(w.expectancy_r)}</td>
                    <td className="num py-1.5 text-right text-muted">{fmtPct(w.max_drawdown_pct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {wf?.note && <p className="mt-2.5 text-[11px] leading-relaxed text-faint">{wf.note}</p>}
      <Explain show={beginner}>
        Периодът е разделен на последователни прозорци и ЕДНИТЕ И СЪЩИ правила са тествани във всеки. Ако резултатът сменя знака между
        прозорците, предимството зависи от конкретния период или пазарен режим.
      </Explain>
    </Panel>
  );
}

/* ──────────────────────────────────────── stress + sensitivity */

function StressPanel({ v, m, beginner }: { v: Validation; m: MetricsV2; beginner: boolean }) {
  const base: RunSummary = {
    total_trades: m.total_trades,
    net_pnl: m.net_pnl,
    win_rate: m.win_rate,
    profit_factor: m.profit_factor,
    expectancy_r: m.expectancy_r,
    max_drawdown_pct: m.max_drawdown_pct,
    return_pct: m.return_pct,
  };
  const rows: { label: React.ReactNode; s: RunSummary; kind: "base" | "stress" | "variant" }[] = [
    { label: "Основен тест", s: base, kind: "base" },
    { label: "Stress: 3× slippage, 2× spread", s: v.stress_test, kind: "stress" },
    ...v.sensitivity.map((s) => ({ label: s.variant, s, kind: "variant" as const })),
  ];
  const flips = v.sensitivity.filter((s) => Math.sign(s.net_pnl) !== Math.sign(base.net_pnl) && s.total_trades > 0).length;
  return (
    <Panel>
      <SubHead
        icon={FlaskConical}
        right={
          v.sensitivity.length ? (
            <Badge tone={flips ? "warn" : "up"}>{flips ? `${flips} от ${v.sensitivity.length} варианта обръщат знака` : "стабилно при ±параметри"}</Badge>
          ) : undefined
        }
      >
        Stress test · Sensitivity
      </SubHead>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-xs">
          <thead className="text-left text-[10.5px] uppercase tracking-[0.06em] text-muted">
            <tr className="border-b border-white/[0.07]">
              <th className="py-1.5 font-semibold">Вариант</th>
              <th className="py-1.5 text-right font-semibold">Trades</th>
              <th className="py-1.5 text-right font-semibold">Net</th>
              <th className="py-1.5 text-right font-semibold">Win</th>
              <th className="py-1.5 text-right font-semibold">PF</th>
              <th className="py-1.5 text-right font-semibold">Exp.</th>
              <th className="py-1.5 text-right font-semibold">DD</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const flip = r.kind === "variant" && Math.sign(r.s.net_pnl) !== Math.sign(base.net_pnl) && r.s.total_trades > 0;
              return (
                <tr
                  key={i}
                  className={cx(
                    "border-b border-white/[0.04] last:border-0",
                    r.kind === "base" && "bg-accent/[0.06]",
                    r.kind === "stress" && "bg-warn/[0.04]",
                  )}
                >
                  <td className={cx("py-1.5 pl-1.5 pr-2", r.kind === "base" ? "font-semibold text-text" : "text-text/85")}>
                    {r.label}
                    {flip && (
                      <Badge tone="warn" className="ml-1.5">
                        обръща
                      </Badge>
                    )}
                  </td>
                  <td className="num py-1.5 text-right text-text/90">{r.s.total_trades}</td>
                  <td className={cx("num py-1.5 text-right font-medium", pnlClass(r.s.net_pnl))}>{fmtMoney(r.s.net_pnl, true)}</td>
                  <td className="num py-1.5 text-right text-text/90">{fmtPct(r.s.win_rate, 0)}</td>
                  <td className="num py-1.5 text-right text-text/90">{fmtPF(r.s.profit_factor)}</td>
                  <td className={cx("num py-1.5 text-right", pnlClass(r.s.expectancy_r))}>{fmtR(r.s.expectancy_r)}</td>
                  <td className="num py-1.5 pr-1.5 text-right text-muted">{fmtPct(r.s.max_drawdown_pct)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Explain show={beginner}>
        Stress test утежнява разходите (3× slippage, 2× spread). Sensitivity сменя всеки числов параметър с ±10–25%. Устойчива идея работи
        приблизително еднакво при съседни стойности; ако малка промяна обръща резултата — правилата са „напаснати“.
      </Explain>
    </Panel>
  );
}

/* ───────────────────────────────────────────── regime breakdown */

function RegimePanel({ v, focusRegime, beginner }: { v: Validation; focusRegime?: string | null; beginner: boolean }) {
  const dist = Object.entries(v.regime_distribution).sort((a, b) => b[1] - a[1]);
  const maxAbs = Math.max(1, ...v.results_by_regime.map((r) => Math.abs(r.net_pnl)));
  return (
    <Panel>
      <SubHead icon={BarChart3}>
        <Term k="regime">Market regime</Term> breakdown
      </SubHead>
      {focusRegime && (
        <Notice tone="warn" className="mb-3 !py-2 text-xs">
          BOT AI COACH: фокус върху режим <b className="text-text">{focusRegime.replace(/_/g, " ")}</b> — сравни резултата в него с останалите.
        </Notice>
      )}
      <div className="label">Разпределение на периода</div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-white/[0.05]" aria-hidden>
        {dist.map(([k, pct]) => (
          <span key={k} className={cx("h-full", REGIME_BAR[k] ?? "bg-white/20", focusRegime && focusRegime !== k && "opacity-40")} style={{ width: `${pct}%` }} />
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted">
        {dist.map(([k, pct]) => (
          <span key={k} className="inline-flex items-center gap-1.5">
            <span className={cx("h-2 w-2 rounded-sm", REGIME_BAR[k] ?? "bg-white/20")} aria-hidden />
            {k.replace(/_/g, " ")} <span className="num text-text/80">{pct}%</span>
          </span>
        ))}
      </div>
      <div className="label mt-4">Резултат по режим (при входа)</div>
      {v.results_by_regime.length ? (
        <ul className="space-y-1.5">
          {v.results_by_regime.map((r) => (
            <li
              key={r.regime}
              className={cx(
                "grid grid-cols-[minmax(0,128px)_minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1.5 py-1 text-xs",
                focusRegime === r.regime && "bg-warn/[0.08] ring-1 ring-inset ring-warn/30",
              )}
            >
              <span className="min-w-0 truncate" title={REGIME_LABEL[r.regime]}>
                <RegimeBadge regime={r.regime} />
              </span>
              <span className="relative h-2 min-w-0 rounded-full bg-white/[0.04]">
                <span className="absolute inset-y-0 left-1/2 w-px bg-white/15" aria-hidden />
                <span
                  className={cx("absolute inset-y-0 rounded-full", r.net_pnl >= 0 ? "left-1/2 bg-up/70" : "right-1/2 bg-down/70")}
                  style={{ width: `${(Math.abs(r.net_pnl) / maxAbs) * 50}%` }}
                />
              </span>
              <span className="num whitespace-nowrap text-right">
                <span className="text-muted">{r.trades} tr · {fmtPct(r.win_rate, 0)}</span>{" "}
                <span className={cx("font-medium", pnlClass(r.net_pnl))}>{fmtMoney(r.net_pnl, true)}</span>
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">Няма сделки за разбивка.</p>
      )}
      <Explain show={beginner}>
        Повечето стратегии работят само в определен режим (тренд или range). Ако загубите идват от един режим, хипотезата за проверка е regime
        filter — тествай я на по-дълъг период, преди да промениш правилата.
      </Explain>
    </Panel>
  );
}

/* ───────────────────────────────────────────────────── costs */

function CostsPanel({ v, beginner }: { v: Validation; beginner: boolean }) {
  const c = v.costs;
  const gross = c.gross_pnl_before_fees;
  const scale = Math.max(1, Math.abs(gross), Math.abs(c.net_pnl), c.fees + c.slippage_est);
  const rows: { label: string; value: number; tone: string; bar: string }[] = [
    { label: "Брутно (преди такси)", value: gross, tone: pnlClass(gross), bar: gross >= 0 ? "bg-up/60" : "bg-down/60" },
    { label: "Такси", value: -c.fees, tone: "text-down", bar: "bg-down/45" },
    { label: "Slippage (оценка, вкл. в цените)", value: -c.slippage_est, tone: "text-warn", bar: "bg-warn/50" },
  ];
  const eaten = gross > 0 ? Math.min(999, ((c.fees + c.slippage_est) / gross) * 100) : null;
  return (
    <Panel>
      <SubHead icon={Coins} right={eaten !== null ? <Badge tone={eaten > 50 ? "down" : eaten > 25 ? "warn" : "neutral"}>разходи = {eaten.toFixed(0)}% от брутното</Badge> : undefined}>
        <Term k="fees">Transaction costs</Term>
      </SubHead>
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.label} className="text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted">{r.label}</span>
              <span className={cx("num font-medium", r.tone)}>{fmtMoney(r.value, true)}</span>
            </div>
            <span className="mt-1 block h-1.5 rounded-full bg-white/[0.04]">
              <span className={cx("block h-full rounded-full", r.bar)} style={{ width: `${(Math.abs(r.value) / scale) * 100}%` }} />
            </span>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center justify-between border-t border-white/[0.07] pt-2.5 text-sm">
        <span className="font-semibold text-text">Нетно</span>
        <span className={cx("num font-semibold", pnlClass(c.net_pnl))}>{fmtMoney(c.net_pnl, true)}</span>
      </div>
      <Explain show={beginner}>
        Всяка сделка плаща такси при вход и изход плюс slippage. Стратегия с много малки печалби често е печеливша „на хартия“, но губеща след
        разходите.
      </Explain>
    </Panel>
  );
}

/* ───────────────────────────────────────────────────── main card */

/**
 * "Strategy validation" card: past-performance banner, overfitting risk, sample size, warnings, in-sample vs
 * out-of-sample, walk-forward windows, stress + sensitivity, regime breakdown and costs.
 */
export function ValidationPanel({ v, m, beginner, focusRegime }: { v: Validation; m: MetricsV2; beginner: boolean; focusRegime?: string | null }) {
  const positive = m.net_pnl > 0;
  return (
    <Card
      title={
        <>
          <ListChecks size={15} strokeWidth={2} className="text-accent2" aria-hidden />
          Strategy validation
        </>
      }
      right={<Badge tone="warn">не е доказателство за предимство</Badge>}
    >
      <div className="space-y-4">
        <PastPerformanceBanner text={v.disclaimer || PAST_PERFORMANCE} />
        <Notice tone={positive ? "warn" : "info"} title={v.headline}>
          {v.robustness}
        </Notice>
        {v.warnings.length > 0 && (
          <ul className="grid gap-1.5 md:grid-cols-2">
            {v.warnings.map((w) => (
              <li key={w.code + w.text} className="flex items-start gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-xs leading-relaxed">
                <Badge tone={w.severity === "high" ? "down" : "warn"}>{w.code.replace(/_/g, " ")}</Badge>
                <span className="min-w-0 text-text/90">{w.text}</span>
              </li>
            ))}
          </ul>
        )}
        <div className="grid gap-3 lg:grid-cols-2">
          <OverfittingCard v={v} beginner={beginner} />
          <SampleSizeCard v={v} m={m} beginner={beginner} />
        </div>
        <OosPanel v={v} beginner={beginner} />
        <WalkForwardPanel v={v} beginner={beginner} />
        <StressPanel v={v} m={m} beginner={beginner} />
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <RegimePanel v={v} focusRegime={focusRegime} beginner={beginner} />
          <CostsPanel v={v} beginner={beginner} />
        </div>
        <p className="flex items-center gap-1.5 text-[11px] text-faint">
          <ArrowRight size={12} strokeWidth={2} aria-hidden />
          Следваща стъпка: forward test с paper бот в Bot Lab — същите правила върху нови свещи.
        </p>
      </div>
    </Card>
  );
}


