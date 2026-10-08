"use client";

/*
 * Trade Simulator results: size, margin, R:R, P/L at stop and target, liquidation estimate, the ±1/2/5/10 % scenario
 * table and the costs — all from POST /learn/leverage/simulate (USD), with prices shown in the instrument's quote
 * currency. Money is in the account currency (USD).
 */
import { ShieldAlert } from "lucide-react";

import { RISK_META, fmtUnits, leverageWarning, signedPct, usd } from "@/components/labs/model";
import type { LeverageResult } from "@/components/labs/types";
import { Metric } from "@/components/risk/LeverageSimulator";
import { Badge, Card, Notice } from "@/components/ui";
import { cx, fmtPrice } from "@/lib/format";

const pnlTone = (v: number | null | undefined) =>
  (v === null || v === undefined || Math.abs(v) < 0.005 ? "text" : v > 0 ? "up" : "down") as "text" | "up" | "down";
const RISK_TONE = {
  low: "info",
  elevated: "warn",
  high: "down",
  extreme: "down",
} as const;

export function SimulatorResults({
  res,
  precision,
  base,
  quote,
  beginner,
  stale,
  convertedNote,
}: {
  /** the simulation with prices already in the quote currency (rescaleResult) */
  res: LeverageResult;
  precision: number;
  /** base unit label ("BTC", "AAPL", "EUR") */
  base: string;
  quote: string;
  beginner: boolean;
  /** inputs changed and a new result is loading */
  stale?: boolean;
  /** set for non-USD quotes: the step-by-step notes quote prices converted to USD */
  convertedNote?: string | null;
}) {
  const plan = res.plan;
  const p = (v: number | null | undefined) => (v === null || v === undefined ? "—" : fmtPrice(v, precision));
  const rr = plan?.reward_risk ?? null;
  const rrNet = plan?.reward_risk_net ?? null;
  const liq = res.liquidation_price;
  const isoDist = res.isolated_liquidation_distance_pct;

  return (
    <div className={cx("space-y-4 transition-opacity", stale && "opacity-70")} aria-live="polite">
      {!res.can_open && (
        <Notice tone="down" title="Позицията не може да се отвори">
          {res.cannot_open_reason ?? "Нужният margin е над наличното в сметката."} Намали размера или риска — ликвидацията и сценариите се показват само
          за позиция, която може да се отвори.
        </Notice>
      )}
      {plan?.liquidation_before_stop && (
        <Notice tone="down" title="Ликвидацията е преди stop loss-а">
          При този размер и leverage сметката би стигнала stop-out преди цената да стигне stop loss-а — stop-ът няма да ограничи загубата.
        </Notice>
      )}

      <div className="grid grid-cols-1 gap-2.5 min-[460px]:grid-cols-2 2xl:grid-cols-3">
        <Metric
          label="Размер на позицията"
          term="position_size"
          value={usd(res.position_notional)}
          sub={`${fmtUnits(res.units)} ${base} при ${p(res.entry_price)} ${quote}`}
        />
        <Metric label="Margin" term="margin" value={usd(res.required_margin)} sub={`при ${res.leverage}x · free margin ${usd(res.free_margin)}`} />
        <Metric
          label="R:R"
          term="rr"
          value={rr === null ? "—" : `1 : ${rr.toFixed(2)}`}
          tone={rr === null ? "muted" : "text"}
          sub={rr === null ? "Нужни са stop loss и take profit." : `след разходи 1 : ${rrNet === null ? "—" : rrNet.toFixed(2)}`}
        />
        <Metric
          label="P/L при stop"
          term="stoploss"
          value={plan?.pnl_at_stop === null || plan?.pnl_at_stop === undefined ? "—" : usd(plan.pnl_at_stop, true)}
          tone={pnlTone(plan?.pnl_at_stop)}
          sub={
            plan?.stop_price === null || plan?.stop_price === undefined
              ? "Няма stop loss — загубата не е ограничена."
              : `${p(plan.stop_price)} (${signedPct(res.side === "long" ? -(plan.stop_distance_pct ?? 0) : (plan.stop_distance_pct ?? 0))}) · ${signedPct(-(plan.risk_pct_of_equity ?? 0))} от сметката`
          }
        />
        <Metric
          label="P/L при target"
          term="takeprofit"
          value={plan?.pnl_at_target === null || plan?.pnl_at_target === undefined ? "—" : usd(plan.pnl_at_target, true)}
          tone={pnlTone(plan?.pnl_at_target)}
          sub={
            plan?.target_price === null || plan?.target_price === undefined
              ? "Няма take profit."
              : `${p(plan.target_price)} (${signedPct(res.side === "long" ? (plan.target_distance_pct ?? 0) : -(plan.target_distance_pct ?? 0))}) · ${signedPct(plan.pnl_at_target_pct_of_equity)} от сметката`
          }
        />
        {res.can_open ? (
          <Metric
            label="Ликвидация (оценка)"
            term="liquidation"
            value={liq === null ? "Недостижима" : p(liq)}
            tone={liq === null ? "muted" : "warn"}
            sub={
              <>
                {liq === null
                  ? "Cross margin: цялата сметка стои зад позицията."
                  : `${signedPct(res.liquidation_move_pct, 2)} от входа · cross margin`}
                <br />
                Isolated:{" "}
                {res.isolated_liquidation_price === null
                  ? "—"
                  : `${p(res.isolated_liquidation_price)} (${signedPct(res.side === "long" ? -(isoDist ?? 0) : (isoDist ?? 0), 2)})`}
              </>
            }
          />
        ) : (
          <Metric label="Ликвидация (оценка)" term="liquidation" value="—" tone="muted" sub="Позицията не може да се отвори с тази сметка." />
        )}
      </div>

      {res.can_open && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
            <ShieldAlert size={14} className="text-faint" aria-hidden />
            Risk level: <Badge tone={RISK_TONE[res.risk_level]}>{RISK_META[res.risk_level].label}</Badge>
            <span className="min-w-0">
              {res.liquidation_distance_daily_moves !== null
                ? `ликвидацията е на ~${res.liquidation_distance_daily_moves.toFixed(1)} типични дневни движения (${res.daily_vol_pct ?? "—"}% на ден)`
                : RISK_META[res.risk_level].text}
            </span>
          </div>

          <Card title="Сценарии: движение на цената" bodyClass="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-right text-xs">
                <thead>
                  <tr className="border-b border-white/[0.07] text-[11px] uppercase tracking-[0.06em] text-muted">
                    <th scope="col" className="px-4 py-2 text-left font-medium">
                      Движение
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      Цена ({quote})
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      P/L
                    </th>
                    <th scope="col" className="px-3 py-2 font-medium">
                      % от сметката
                    </th>
                    <th scope="col" className="px-4 py-2 font-medium">
                      Сметка след
                    </th>
                  </tr>
                </thead>
                <tbody className="num">
                  {res.scenarios.map((s) => (
                    <tr key={s.move_pct} className="border-b border-white/[0.04] last:border-0">
                      <th scope="row" className={cx("px-4 py-1.5 text-left font-semibold", s.move_pct < 0 ? "text-down" : "text-up")}>
                        {signedPct(s.move_pct, 0)}
                      </th>
                      <td className="px-3 py-1.5 text-text">{p(s.price)}</td>
                      <td className={cx("px-3 py-1.5 font-medium", s.pnl < 0 ? "text-down" : s.pnl > 0 ? "text-up" : "text-text")}>
                        {usd(s.pnl, true)}
                      </td>
                      <td className={cx("px-3 py-1.5", s.pnl < 0 ? "text-down" : s.pnl > 0 ? "text-up" : "text-text")}>
                        {signedPct(s.pnl_pct_of_equity)}
                      </td>
                      <td className="px-4 py-1.5 text-text">
                        {usd(s.equity_after)}
                        {s.liquidated && <span className="ml-1.5 rounded bg-down/15 px-1 py-px text-[10px] font-semibold text-down">ликвидация</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="border-t border-white/[0.05] px-4 py-2 text-[11px] text-faint">
              Движението е спрямо цената на влизане; P/L включва таксата за излизане и spread-а. „Ликвидация“ = сметката стига stop-out преди това
              ниво.
            </p>
          </Card>
        </>
      )}

      <Card title="Разходи">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
          <div>
            <dt className="text-[11px] text-muted">
              Такса при вход ({(res.fee_rate * 100).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}
              %)
            </dt>
            <dd className="num font-semibold text-text">{usd(res.entry_fee)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">Такса при изход (≈)</dt>
            <dd className="num font-semibold text-text">{usd(res.exit_fee)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">Spread ({res.spread_bps} bps)</dt>
            <dd className="num font-semibold text-text">{usd(res.spread_cost)}</dd>
          </div>
          <div>
            <dt className="text-[11px] text-muted">Общо вход + изход</dt>
            <dd className="num font-semibold text-down">{usd(-res.round_trip_cost, true)}</dd>
          </div>
        </dl>
        {!beginner && (
          <p className="mt-3 text-[11px] text-faint">
            Margin level {res.margin_level_pct === null ? "—" : `${res.margin_level_pct.toFixed(0)}%`} · maintenance margin{" "}
            {usd(res.maintenance_margin)} · експозиция {res.effective_leverage.toFixed(2)}x от сметката. Slippage и funding не са включени.
          </p>
        )}
      </Card>

      {res.notes.length > 0 && (
        <details className="rounded-xl border border-white/[0.06] bg-white/[0.015] px-3.5 py-2.5" open={beginner}>
          <summary className="cursor-pointer select-none text-xs font-semibold text-muted transition-colors hover:text-text">Как е сметнато</summary>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted">
            {res.notes.map((n, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-faint" aria-hidden />
                <span className="min-w-0">{n}</span>
              </li>
            ))}
          </ul>
          {convertedNote && <p className="mt-2 text-[11px] text-faint">{convertedNote}</p>}
        </details>
      )}

      <Notice tone="warn" title="WARNING">
        {leverageWarning(res)}
      </Notice>
    </div>
  );
}
