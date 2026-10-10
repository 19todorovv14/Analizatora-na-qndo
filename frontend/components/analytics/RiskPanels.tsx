"use client";

/*
 * Risk building blocks (GET /api/risk/status, PUT /api/risk/rules) shared by /risk and the dashboard:
 *   <RiskStatusSummary st compact? />  status + daily-loss / exposure / positions gauges, margin level, last events
 *   <ExposureBreakdown st />           exposure by asset class (bars) and by symbol (table)
 *   <RiskEvents events limit? />        rule violations / warnings log
 *   <RiskRulesEditor rules onSaved? />  validated editor for the user's risk rules
 */
import { CircleCheck, OctagonAlert, ShieldAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { useState } from "react";

import {
  dailyLossUse,
  exposureLimit,
  exposureUse,
  limitTone,
  marginLevelPct,
  marginTone,
  riskTone,
  limitShare,
} from "@/components/analytics/model";
import type { RiskEvent, RiskRules, RiskStatus } from "@/components/analytics/types";
import { Badge, Button, EmptyState, ErrorText, Meter, Notice, Switch, Term } from "@/components/ui";
import { errorMessage, put } from "@/lib/api";
import { cx, fmtMoney, fmtPct, fmtTime } from "@/lib/format";

const STATUS_TEXT: Record<string, string> = {
  OK: "В рамките на правилата",
  WARNING: "Близо до лимит",
  LIMIT: "Лимит достигнат",
};

const INK = { up: "text-up", down: "text-down", warn: "text-warn", info: "text-info", neutral: "text-text", accent: "text-accent2" } as const;

export function RiskStatusBadge({ status }: { status: string }) {
  const tone = riskTone(status);
  const Icon = tone === "up" ? ShieldCheck : tone === "down" ? OctagonAlert : ShieldAlert;
  return (
    <Badge tone={tone === "neutral" ? "neutral" : tone}>
      <Icon size={11} strokeWidth={2.25} aria-hidden /> {status}
    </Badge>
  );
}

function Gauge({ label, value, pct, sub }: { label: React.ReactNode; value: React.ReactNode; pct: number | null; sub?: React.ReactNode }) {
  const tone = limitTone(pct);
  return (
    <div className="min-w-0">
      <div className="mb-1 flex items-baseline justify-between gap-2 text-[11px] leading-4">
        <span className="truncate text-muted">{label}</span>
        <span className={cx("num shrink-0", pct !== null && pct >= 70 ? INK[tone] : "text-text")}>{value}</span>
      </div>
      <Meter value={pct ?? 0} max={100} tone={tone} />
      {sub && <div className="mt-1 text-[11px] text-faint">{sub}</div>}
    </div>
  );
}

/** Status + the three limit gauges. `compact` (dashboard) drops the explanation and shows ≤ 2 events. */
export function RiskStatusSummary({ st, compact, className }: { st: RiskStatus; compact?: boolean; className?: string }) {
  const r = st.rules;
  const loss = dailyLossUse(st);
  const exp = exposureUse(st);
  const pos = limitShare(st.open_positions, r.max_open_positions);
  const ml = marginLevelPct(st.margin_level);
  const tone = riskTone(st.status);
  return (
    <div className={cx("space-y-3.5", className)}>
      <div className="flex items-center gap-2.5">
        <span
          className={cx(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ring-1 ring-inset",
            tone === "up" ? "bg-up/10 text-up ring-up/20" : tone === "warn" ? "bg-warn/10 text-warn ring-warn/20" : "bg-down/10 text-down ring-down/20",
          )}
        >
          {tone === "up" ? <ShieldCheck size={17} strokeWidth={1.9} aria-hidden /> : <ShieldAlert size={17} strokeWidth={1.9} aria-hidden />}
        </span>
        <div className="min-w-0">
          <div className={cx("text-sm font-semibold", INK[tone])}>{STATUS_TEXT[st.status] ?? st.status}</div>
          <div className="text-[11px] text-muted">
            Остават <span className="num text-text">{fmtMoney(st.daily_loss_limit_remaining)}</span> до дневния лимит
          </div>
        </div>
      </div>
      <Gauge
        label={
          <>
            Дневна загуба / лимит <span className="num">{r.max_daily_loss_pct}%</span>
          </>
        }
        value={fmtPct(st.day_loss_pct, 2)}
        pct={loss}
      />
      <Gauge
        label={
          <>
            <Term k="exposure">Exposure</Term> / макс. <span className="num">{fmtPct(exposureLimit(st), 0)}</span>
          </>
        }
        value={fmtPct(st.exposure_pct, 0)}
        pct={exp}
      />
      <Gauge label="Отворени позиции" value={`${st.open_positions} / ${r.max_open_positions}`} pct={pos} />
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-2">
          <div className="text-[11px] text-muted">
            <Term k="marginlevel">Margin level</Term>
          </div>
          <div className={cx("num mt-0.5 font-semibold", INK[marginTone(ml)])}>{ml === null ? "—" : fmtPct(ml, 0)}</div>
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-2">
          <div className="text-[11px] text-muted">
            Max <Term k="drawdown">drawdown</Term>
          </div>
          <div className="num mt-0.5 font-semibold text-text">{fmtPct(-Math.abs(st.max_drawdown_pct || 0), 2)}</div>
        </div>
      </div>
      {compact ? (
        st.recent_events.length > 0 && <RiskEvents events={st.recent_events} limit={2} dense />
      ) : (
        <p className="text-xs leading-relaxed text-muted">
          Риск правилата не спират ръчните paper сделки — показват предупреждение. Ботовете спират нови входове, когато лимит е достигнат.
        </p>
      )}
    </div>
  );
}

/** Exposure by asset class (bars, % of equity) and by symbol. */
export function ExposureBreakdown({ st }: { st: RiskStatus }) {
  const byClass = st.exposure_breakdown?.by_class ?? [];
  const bySymbol = st.exposure_breakdown?.by_symbol ?? [];
  if (!byClass.length && !bySymbol.length) {
    return (
      <EmptyState
        compact
        icon={CircleCheck}
        title="Няма отворена експозиция"
        description="Когато отвориш paper позиция, тук ще видиш колко от equity е изложено по клас актив и по инструмент."
      />
    );
  }
  const limit = exposureLimit(st);
  const maxPct = Math.max(limit || 0, ...byClass.map((c) => c.pct_of_equity), 1);
  return (
    <div className="space-y-4">
      <ul className="space-y-2.5" aria-label="Exposure по клас актив">
        {byClass.map((c) => (
          <li key={c.asset_class}>
            <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
              <span className="text-text/90">{c.label}</span>
              <span className="num text-muted">
                {fmtMoney(c.notional)} · <span className="text-text">{fmtPct(c.pct_of_equity, 1)}</span>
              </span>
            </div>
            <Meter value={c.pct_of_equity} max={maxPct} tone="info" />
          </li>
        ))}
      </ul>
      {bySymbol.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[22rem] text-xs">
            <thead className="text-left text-[10.5px] uppercase tracking-[0.06em] text-faint">
              <tr>
                <th className="pb-1.5 font-medium">Инструмент</th>
                <th className="pb-1.5 font-medium">Посока</th>
                <th className="pb-1.5 text-right font-medium">
                  <Term k="notional">Notional</Term>
                </th>
                <th className="pb-1.5 text-right font-medium">% от equity</th>
              </tr>
            </thead>
            <tbody>
              {bySymbol.map((s) => (
                <tr key={`${s.symbol}-${s.side}`} className="border-t border-white/[0.05]">
                  <td className="py-1.5 font-medium">{s.symbol}</td>
                  <td>
                    <Badge tone={s.side === "long" ? "up" : "down"}>{s.side}</Badge>
                  </td>
                  <td className="num text-right">{fmtMoney(s.notional)}</td>
                  <td className="num text-right">{fmtPct(s.pct_of_equity, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function RiskEvents({ events, limit, dense }: { events: RiskEvent[]; limit?: number; dense?: boolean }) {
  const list = limit ? events.slice(0, limit) : events;
  if (!list.length) {
    return (
      <EmptyState
        compact
        icon={ShieldCheck}
        title="Няма нарушения на правилата"
        description="Предупрежденията (голям риск, сделка без стоп, дневен лимит) се записват тук."
      />
    );
  }
  return (
    <ul className={cx("divide-y divide-white/[0.05]", dense && "rounded-lg border border-white/[0.06] bg-white/[0.02]")}>
      {list.map((e, i) => (
        <li key={`${e.ts}-${e.kind}-${i}`} className={cx("flex items-start gap-2.5 text-xs", dense ? "px-2.5 py-2" : "py-2")}>
          {e.severity === "high" ? (
            <OctagonAlert size={14} strokeWidth={2} className="mt-px shrink-0 text-down" aria-hidden />
          ) : (
            <TriangleAlert size={14} strokeWidth={2} className="mt-px shrink-0 text-warn" aria-hidden />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="font-semibold text-text">{e.kind.replace(/_/g, " ")}</span>
              <span className="num text-[11px] text-faint">{fmtTime(e.ts)}</span>
            </div>
            <p className={cx("text-muted", dense && "line-clamp-2")}>{e.message}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}

type NumRule = Exclude<keyof RiskRules, "require_stop_loss">;

export const RULE_FIELDS: { key: NumRule; label: string; hint: string; min: number; max: number; step: number; suffix?: string; term?: string }[] = [
  { key: "max_risk_per_trade_pct", label: "Max risk per trade", hint: "Колко % от equity губиш, ако стопът бъде ударен. Обичайно 0.5–1%.", min: 0.1, max: 10, step: 0.1, suffix: "%", term: "risk_per_trade" },
  { key: "warn_risk_pct", label: "'Unusually large' warning", hint: "Над този риск получаваш силно предупреждение преди сделката.", min: 0.5, max: 50, step: 0.5, suffix: "%" },
  { key: "max_daily_loss_pct", label: "Max daily loss", hint: "Дневен лимит — ботовете спират нови сделки до края на деня (UTC).", min: 0.5, max: 50, step: 0.5, suffix: "%" },
  { key: "max_open_positions", label: "Max open positions", hint: "Колко позиции можеш да държиш едновременно.", min: 1, max: 100, step: 1 },
  { key: "max_portfolio_exposure_pct", label: "Max portfolio exposure", hint: "Обща номинална стойност на позициите / equity.", min: 10, max: 10000, step: 10, suffix: "%", term: "exposure" },
  { key: "min_reward_risk", label: "Min reward : risk", hint: "Минимално съотношение печалба/риск за план на сделка.", min: 0.5, max: 10, step: 0.1, term: "rr" },
];

/** Validation of the editable copy; returns an error per invalid field. */
export function validateRules(rules: Record<NumRule, string>): Partial<Record<NumRule, string>> {
  const out: Partial<Record<NumRule, string>> = {};
  for (const f of RULE_FIELDS) {
    const raw = rules[f.key];
    const v = Number(raw);
    if (raw === "" || !Number.isFinite(v)) out[f.key] = "Въведи число.";
    else if (v < f.min || v > f.max) out[f.key] = `Между ${f.min} и ${f.max}.`;
    else if (f.key === "max_open_positions" && !Number.isInteger(v)) out[f.key] = "Цяло число.";
  }
  const risk = Number(rules.max_risk_per_trade_pct);
  const warn = Number(rules.warn_risk_pct);
  if (!out.warn_risk_pct && !out.max_risk_per_trade_pct && warn < risk) out.warn_risk_pct = "Трябва да е ≥ max risk per trade.";
  return out;
}

const toDraft = (r: RiskRules) => Object.fromEntries(RULE_FIELDS.map((f) => [f.key, String(r[f.key])])) as Record<NumRule, string>;

export function RiskRulesEditor({ rules, onSaved }: { rules: RiskRules; onSaved?: (r: RiskRules) => void }) {
  const [draft, setDraft] = useState(() => toDraft(rules));
  const [requireStop, setRequireStop] = useState(rules.require_stop_loss);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const errors = validateRules(draft);
  const invalid = Object.keys(errors).length > 0;
  const dirty = RULE_FIELDS.some((f) => Number(draft[f.key]) !== rules[f.key]) || requireStop !== rules.require_stop_loss;

  const save = async () => {
    if (invalid) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const body = { ...Object.fromEntries(RULE_FIELDS.map((f) => [f.key, Number(draft[f.key])])), require_stop_loss: requireStop };
      const next = await put<RiskRules>("/risk/rules", body);
      setDraft(toDraft(next));
      setRequireStop(next.require_stop_loss);
      setSaved(true);
      onSaved?.(next);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {RULE_FIELDS.map((f) => (
          <label key={f.key} className="block min-w-0">
            <span className="label flex items-center gap-1">{f.term ? <Term k={f.term}>{f.label}</Term> : f.label}</span>
            <div className="relative">
              <input
                className={cx("input num w-full", f.suffix && "pr-7", errors[f.key] && "!border-down/60")}
                inputMode="decimal"
                value={draft[f.key]}
                aria-invalid={!!errors[f.key]}
                onChange={(e) => {
                  setSaved(false);
                  setDraft({ ...draft, [f.key]: e.target.value.replace(",", ".") });
                }}
              />
              {f.suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-faint">{f.suffix}</span>}
            </div>
            <span className={cx("mt-1 block text-[11px] leading-snug", errors[f.key] ? "text-down" : "text-faint")}>{errors[f.key] ?? f.hint}</span>
          </label>
        ))}
      </div>
      <div className="flex items-center justify-between gap-3 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2.5">
        <div className="min-w-0 text-sm">
          <div className="font-medium text-text">
            Задължителен <Term k="stoploss">stop loss</Term>
          </div>
          <div className="text-[11px] text-muted">Сделка без стоп се отбелязва като нарушение на правилата.</div>
        </div>
        <Switch
          checked={requireStop}
          onChange={(v) => {
            setSaved(false);
            setRequireStop(v);
          }}
          ariaLabel="Задължителен stop loss"
        />
      </div>
      <ErrorText error={error} />
      {saved && !dirty && <Notice tone="up">Правилата са запазени.</Notice>}
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={busy || invalid || !dirty}>
          Запази правилата
        </Button>
        {dirty && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setDraft(toDraft(rules));
              setRequireStop(rules.require_stop_loss);
            }}
          >
            Отказ
          </Button>
        )}
      </div>
    </form>
  );
}
