"use client";

import { TriangleAlert } from "lucide-react";
import { useEffect, useState } from "react";

import { SymbolPicker } from "@/components/charts/ChartControls";
import { ErrorText, Field, Stat } from "@/components/ui";
import { errorMessage, post } from "@/lib/api";
import { fmtMoney, fmtPct } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";

type SizeResult = {
  qty: number;
  risk_amount: number;
  stop_distance: number;
  stop_distance_pct: number;
  notional: number;
  margin_required: number;
  effective_leverage: number;
  potential_loss: number;
  side: string;
  leverage: number;
  notes: string[];
  plan: { potential_profit: number | null; reward_risk: number | null };
  explanation: string[];
  ruin: { losses: number; remaining_pct: number; needed_gain_to_recover_pct: number }[];
};

/** Trims a number for an input field ("10000.5", not "10000.500000001"). */
const asField = (v: number) => String(Math.round(v * 100) / 100);

/**
 * Position size calculator (POST /api/risk/position-size). `defaults` prefill balance / risk % (e.g. the
 * paper equity and the user's max risk rule) until the user edits that field; later changes of the
 * defaults (data loading) are applied only to untouched fields.
 */
export function PositionSizeCalculator({ compact, defaults }: { compact?: boolean; defaults?: { balance?: number | null; risk_pct?: number | null } }) {
  const [form, setForm] = useState(() => ({
    balance: defaults?.balance ? asField(defaults.balance) : "10000",
    risk_pct: defaults?.risk_pct ? asField(defaults.risk_pct) : "1",
    entry: "100",
    stop: "98",
    take_profit: "106",
    leverage: "1",
    symbol: "",
  }));
  const [touched, setTouched] = useState<{ balance?: boolean; risk_pct?: boolean }>({});
  const [seen, setSeen] = useState(defaults);
  if (defaults?.balance !== seen?.balance || defaults?.risk_pct !== seen?.risk_pct) {
    // defaults arrived / changed after mount → apply them to the fields the user has not edited
    setSeen(defaults);
    setForm((f) => ({
      ...f,
      balance: !touched.balance && defaults?.balance ? asField(defaults.balance) : f.balance,
      risk_pct: !touched.risk_pct && defaults?.risk_pct ? asField(defaults.risk_pct) : f.risk_pct,
    }));
  }
  const [res, setRes] = useState<SizeResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const debounced = useDebounced(form, 300);

  useEffect(() => {
    const body = {
      balance: Number(debounced.balance),
      risk_pct: Number(debounced.risk_pct),
      entry: Number(debounced.entry),
      stop: Number(debounced.stop),
      take_profit: Number(debounced.take_profit) || undefined,
      leverage: Number(debounced.leverage) || 1,
      symbol: debounced.symbol || undefined,
    };
    if (!body.balance || !body.risk_pct || !body.entry || !body.stop) return;
    post<SizeResult>("/risk/position-size", body)
      .then((r) => {
        setRes(r);
        setError(null);
      })
      .catch((e) => setError(errorMessage(e)));
  }, [debounced]);

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => {
    if (k === "balance" || k === "risk_pct") setTouched((t) => ({ ...t, [k]: true }));
    setForm({ ...form, [k]: e.target.value.replace(",", ".") });
  };

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Field label="Account balance">
          <input className="input num" inputMode="decimal" value={form.balance} onChange={set("balance")} />
        </Field>
        <Field label="Risk %" hint="Колко % от сметката си готов да загубиш, ако стопът бъде ударен. Обичайно 0.5–1%.">
          <input className="input num" value={form.risk_pct} onChange={set("risk_pct")} />
        </Field>
        <Field label="Leverage">
          <input className="input num" value={form.leverage} onChange={set("leverage")} />
        </Field>
        <Field label="Entry price">
          <input className="input num" value={form.entry} onChange={set("entry")} />
        </Field>
        <Field label="Stop loss">
          <input className="input num" value={form.stop} onChange={set("stop")} />
        </Field>
        <Field label="Take profit">
          <input className="input num" value={form.take_profit} onChange={set("take_profit")} />
        </Field>
      </div>
      {!compact && (
        <Field label="Инструмент (по избор — закръгля към стъпката и включва таксите)">
          <div className="flex gap-2">
            <SymbolPicker value={form.symbol || "BTC/USDT"} onChange={(s) => setForm({ ...form, symbol: s })} />
            {form.symbol && (
              <button className="text-xs text-muted hover:text-text" onClick={() => setForm({ ...form, symbol: "" })}>
                без инструмент
              </button>
            )}
          </div>
        </Field>
      )}
      <ErrorText error={error} />
      {res && (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Position size" value={res.qty.toLocaleString("en-US", { maximumFractionDigits: 6 })} sub={`${res.side.toUpperCase()} units`} />
            <Stat label="Potential loss" value={fmtMoney(-res.potential_loss)} tone="text-down" sub={fmtPct((res.potential_loss / Number(form.balance)) * 100, 2)} />
            <Stat label="Potential profit" value={fmtMoney(res.plan.potential_profit)} tone="text-up" />
            <Stat label="Risk/Reward" term="rr" value={res.plan.reward_risk ? `1 : ${res.plan.reward_risk.toFixed(2)}` : "—"} />
            <Stat label="Notional" value={fmtMoney(res.notional)} />
            <Stat label="Margin" term="margin" value={fmtMoney(res.margin_required)} sub={`${res.leverage}x`} />
            <Stat label="Stop distance" value={fmtPct(res.stop_distance_pct, 2)} />
            <Stat label="Eff. leverage" term="leverage" value={`${res.effective_leverage.toFixed(2)}x`} />
          </div>
          <div className="rounded-xl border border-white/[0.07] bg-white/[0.025] p-3.5 text-sm leading-relaxed text-muted">
            <div className="mb-1 font-semibold text-text">Защо position sizing е важен?</div>
            {res.explanation.map((l) => (
              <p key={l}>• {l}</p>
            ))}
            {res.notes.map((n) => (
              <p key={n} className="mt-1 flex items-start gap-1.5 text-warn">
                <TriangleAlert size={13} strokeWidth={2.25} className="mt-1 shrink-0" aria-hidden /> <span>{n}</span>
              </p>
            ))}
          </div>
          {!compact && (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[22rem] text-sm">
                <thead className="text-left text-[10.5px] uppercase tracking-[0.05em] text-faint">
                  <tr>
                    <th>Поредни загуби при {form.risk_pct}%</th>
                    <th>Остава от сметката</th>
                    <th>Нужно, за да се върнеш</th>
                  </tr>
                </thead>
                <tbody>
                  {res.ruin.map((r) => (
                    <tr key={r.losses} className="border-t border-white/[0.05]">
                      <td className="py-1">{r.losses}</td>
                      <td className="num">{fmtPct(r.remaining_pct)}</td>
                      <td className="num text-warn">+{fmtPct(r.needed_gain_to_recover_pct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
