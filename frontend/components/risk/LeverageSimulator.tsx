"use client";

/*
 * LeverageSimulator — interactive what-if on a VIRTUAL account (default $10,000): leverage chips 1x … 100x (none of
 * them is "recommended"), position size or margin, direction and a ±20 % price-move slider. The live outputs come
 * from POST /learn/leverage/simulate — the paper broker's cross-margin maths (stop-out at a 50 % margin level):
 * position, margin, P/L, liquidation (cross, plus isolated for comparison), risk level and the warning. Below it,
 * "equity vs price move" for every leverage (chart or table). Used by /learn/leverage; reusable anywhere.
 */
import { ChartSpline, Table2, TrendingDown, TrendingUp, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { SliderField } from "@/components/academy/visuals/shared";
import { LeverageCurves } from "@/components/labs/leverage/LeverageCurves";
import { LEVERAGES, RISK_META, leverageRequest, leverageWarning, parseNum, signedPct, usd, type SizeMode } from "@/components/labs/model";
import type { LeverageResult, Side } from "@/components/labs/types";
import { useLeverageSim } from "@/components/labs/useLeverageSim";
import { Badge, Card, ErrorText, Notice, Segmented, Term } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { cx, fmtPrice } from "@/lib/format";
import { useDebounced } from "@/lib/hooks";
import { useSession } from "@/lib/session";

export type LeverageSimulatorProps = {
  /** virtual account size (default 10,000) */
  equity?: number;
  /** initially selected chip (default 1x — nothing is preselected as "recommended") */
  defaultLeverage?: number;
  defaultMode?: SizeMode;
  /** position size (notional) or margin in USD (default $2,000 notional) */
  defaultAmount?: number;
  defaultSide?: Side;
  /** initial price move in % (default −5) */
  defaultMove?: number;
  className?: string;
};

type Ink = "text" | "up" | "down" | "warn" | "info" | "muted";
const INK: Record<Ink, string> = { text: "text-text", up: "text-up", down: "text-down", warn: "text-warn", info: "text-info", muted: "text-muted" };
const RISK_INK: Record<string, Ink> = { low: "info", elevated: "warn", high: "down", extreme: "down" };

/** One output tile (label with its glossary term, big tabular value, one-line explanation). */
export function Metric({
  label,
  term,
  value,
  sub,
  tone = "text",
  className,
}: {
  label: React.ReactNode;
  term?: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  tone?: Ink;
  className?: string;
}) {
  return (
    <div className={cx("glass-inset min-w-0 px-3.5 py-3", className)}>
      <div className="text-[11px] font-medium uppercase tracking-[0.06em] text-muted">{term ? <Term k={term}>{label}</Term> : label}</div>
      <div className={cx("num mt-1 truncate text-lg font-semibold leading-tight tracking-tight sm:text-xl", INK[tone])}>{value}</div>
      {sub && <div className="mt-1 text-[11px] leading-snug text-faint">{sub}</div>}
    </div>
  );
}

const pnlInk = (v: number | null | undefined): Ink => (v === null || v === undefined || Math.abs(v) < 0.005 ? "text" : v > 0 ? "up" : "down");

function Outputs({ res, move, beginner }: { res: LeverageResult; move: number; beginner: boolean }) {
  const liq = res.liquidation_price;
  const L = res.leverage;
  return (
    <div className="grid grid-cols-1 gap-2.5 min-[460px]:grid-cols-2 xl:grid-cols-3">
      <Metric label="Размер на позицията" term="notional" value={usd(res.position_notional)} sub={`= margin ${usd(res.required_margin)} × ${L}x`} />
      <Metric label="Нужен margin" term="margin" value={usd(res.required_margin)} sub={`= ${usd(res.position_notional)} / ${L}x · free ${usd(res.free_margin)}`} />
      <Metric
        label="Движение на цената"
        value={signedPct(move, 1)}
        tone={pnlInk(move)}
        sub={`Примерна цена ${fmtPrice(res.entry_price, 2)} → ${fmtPrice(res.price_after_move, 2)}`}
      />
      <Metric
        label="Потенциален P/L"
        value={usd(res.pnl_at_move, true)}
        tone={pnlInk(res.pnl_at_move)}
        sub={res.pnl_pct_of_margin === null ? undefined : `${signedPct(res.pnl_pct_of_margin, 0)} от margin-а`}
      />
      <Metric
        label="P/L като % от сметката"
        term="equity"
        value={signedPct(res.pnl_pct_of_equity)}
        tone={pnlInk(res.pnl_pct_of_equity)}
        sub={`Equity след движението: ${usd(res.equity_after)}`}
      />
      <Metric
        label="Ликвидационна цена"
        term="liquidation"
        value={liq === null ? "Недостижима" : fmtPrice(liq, 2)}
        tone={liq === null ? "muted" : "warn"}
        sub={
          <>
            {liq === null ? "При cross margin цялата сметка стои зад позицията." : `${signedPct(res.liquidation_move_pct, 2)} от входа (cross margin)`}
            <br />
            Isolated (за сравнение):{" "}
            {res.isolated_liquidation_price === null
              ? "—"
              : `${fmtPrice(res.isolated_liquidation_price, 2)} · ${signedPct(res.side === "long" ? -(res.isolated_liquidation_distance_pct ?? 0) : (res.isolated_liquidation_distance_pct ?? 0), 2)}`}
          </>
        }
      />
      <Metric
        label="Risk level"
        value={RISK_META[res.risk_level].label}
        tone={RISK_INK[res.risk_level]}
        sub={
          <>
            {res.liquidation_distance_daily_moves !== null
              ? `Ликвидацията е на ~${res.liquidation_distance_daily_moves.toFixed(1)} типични дневни движения (${res.daily_vol_pct ?? "—"}%).`
              : RISK_META[res.risk_level].text}{" "}
            Isolated: {RISK_META[res.isolated_risk_level].label.toLowerCase()}.
          </>
        }
      />
      <div className="min-w-0 min-[460px]:col-span-2 xl:col-span-2">
        <Notice tone="warn" title="WARNING" className="h-full">
          {leverageWarning(res)}
        </Notice>
      </div>
      {!beginner && (
        <>
          <Metric label="Margin level" term="marginlevel" value={res.margin_level_pct === null ? "—" : `${res.margin_level_pct.toFixed(0)}%`} sub="equity / използван margin · stop-out при 50%" />
          <Metric label="Maintenance margin" term="maintenance_margin" value={usd(res.maintenance_margin)} sub={`${(res.maintenance_ratio * 100).toFixed(0)}% от използвания margin`} />
          <Metric label="Експозиция" term="exposure" value={`${res.effective_leverage.toFixed(2)}x`} sub="позиция / сметка (effective leverage)" />
        </>
      )}
    </div>
  );
}

export function LeverageSimulator({
  equity = 10_000,
  defaultLeverage = 1,
  defaultMode = "notional",
  defaultAmount = 2_000,
  defaultSide = "long",
  defaultMove = -5,
  className,
}: LeverageSimulatorProps) {
  const { beginner } = useSession();
  const [leverage, setLeverage] = useState<number>(defaultLeverage);
  const [mode, setMode] = useState<SizeMode>(defaultMode);
  const [amountText, setAmountText] = useState(String(defaultAmount));
  const [side, setSide] = useState<Side>(defaultSide);
  const [move, setMove] = useState(defaultMove);
  const [basis, setBasis] = useState<"margin" | "notional">("margin");
  const [view, setView] = useState<"chart" | "table">("chart");

  const amount = parseNum(amountText);
  const amountError =
    amount === null || !(amount > 0)
      ? "Въведи положителна сума."
      : mode === "margin" && amount > equity
        ? `Margin не може да е над сметката (${usd(equity)}).`
        : amount > 100 * equity
          ? `Позицията е над ${usd(100 * equity)} — извън обхвата на симулатора.`
          : null;

  const dAmount = useDebounced(amount, 250);
  const dMove = useDebounced(move, 120);
  const input = { leverage, mode, side, equity, amount: dAmount ?? 0 };
  const valid = !amountError && dAmount !== null && dAmount > 0;
  const main = useLeverageSim(valid ? leverageRequest({ ...input, move: dMove }, false) : null);
  // Both chart families come from the user's own inputs, so the highlighted chip's line is always the user's
  // position: "same margin" = this position's margin at every leverage, "same position" = this position's size.
  const curves = useLeverageSim(valid ? leverageRequest({ ...input, move: 0 }, true) : null);
  const res = main.data ?? null;
  const fam = basis === "margin" ? curves.data?.curves : curves.data?.curves_same_notional;
  const marginLabel = amount === null ? null : mode === "margin" ? amount : amount / leverage;
  const positionLabel = amount === null ? null : mode === "notional" ? amount : amount * leverage;

  const switchMode = (m: SizeMode) => {
    if (m === mode) return;
    // keep the same position: notional ↔ the margin it blocks at this leverage
    if (res && !amountError) setAmountText(String(Math.round((m === "margin" ? res.required_margin : res.position_notional) * 100) / 100));
    setMode(m);
  };

  return (
    <div className={cx("space-y-4", className)}>
      <Card
        title="Leverage симулатор"
        right={
          <span className="flex items-center gap-2">
            <span className="hidden text-xs text-muted sm:inline">Сметка</span>
            <span className="num text-sm font-semibold text-text">{usd(equity)}</span>
            <Badge tone="violet">virtual</Badge>
          </span>
        }
      >
        <div className="grid gap-5 lg:grid-cols-[minmax(0,330px)_minmax(0,1fr)]">
          <div className="min-w-0 space-y-4">
            <div>
              <div className="label mb-1.5">
                <Term k="leverage">Leverage</Term>
              </div>
              <Segmented<number>
                fullWidth
                options={LEVERAGES.map((l) => ({ value: l, label: `${l}x` }))}
                value={leverage}
                onChange={setLeverage}
                ariaLabel="Leverage"
              />
            </div>

            <div>
              <Segmented<SizeMode>
                size="sm"
                fullWidth
                options={[
                  { value: "notional", label: "Размер на позицията" },
                  { value: "margin", label: "Margin" },
                ]}
                value={mode}
                onChange={switchMode}
                ariaLabel="Какво въвеждаш"
              />
              <label className="relative mt-2 block">
                <span className="sr-only">{mode === "margin" ? "Margin в USD" : "Размер на позицията в USD"}</span>
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted" aria-hidden>
                  $
                </span>
                <input
                  className="input num pl-7"
                  inputMode="decimal"
                  value={amountText}
                  onChange={(e) => setAmountText(e.target.value)}
                  aria-invalid={!!amountError}
                />
              </label>
              <p className="mt-1 text-[11px] leading-relaxed text-faint">
                {mode === "margin"
                  ? "Парите, които блокираш. Позицията = margin × leverage."
                  : "Стойността на позицията (notional). Margin = позиция / leverage."}
              </p>
            </div>

            <div>
              <div className="label mb-1.5">Посока</div>
              <Segmented<Side>
                fullWidth
                options={[
                  {
                    value: "long",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <TrendingUp size={14} aria-hidden /> Long
                      </span>
                    ),
                  },
                  {
                    value: "short",
                    label: (
                      <span className="inline-flex items-center gap-1.5">
                        <TrendingDown size={14} aria-hidden /> Short
                      </span>
                    ),
                  },
                ]}
                value={side}
                onChange={setSide}
                ariaLabel="Посока"
              />
            </div>

            <div>
              <SliderField
                label="Движение на цената"
                value={move}
                display={signedPct(move, 1)}
                min={-20}
                max={20}
                step={0.5}
                onChange={setMove}
              />
              <div className="num mt-1 flex justify-between text-[10px] text-faint" aria-hidden>
                <span>−20%</span>
                <span>−10%</span>
                <span>0</span>
                <span>+10%</span>
                <span>+20%</span>
              </div>
            </div>

            <p className="text-[11px] leading-relaxed text-faint">
              Примерен инструмент на цена 100, без такси и spread — за чиста математика. Реален инструмент с разходи:{" "}
              <Link href="/simulator" className="text-accent2 hover:text-text">
                Trade Simulator
              </Link>
              .
            </p>
          </div>

          <div className={cx("min-w-0 space-y-3 transition-opacity", main.isValidating && "opacity-80")} aria-live="polite">
            <ErrorText error={amountError ?? (main.error ? errorMessage(main.error) : null)} />
            {res && !res.can_open && (
              <Notice tone="down" title="Позицията не може да се отвори">
                {res.cannot_open_reason ?? "Нужният margin е над наличното в сметката."}
              </Notice>
            )}
            {res && res.liquidated_at_move && (
              <Notice tone="down" title={`Ликвидация при ${signedPct(move, 1)}`}>
                Equity пада до maintenance margin и брокерът затваря позицията принудително. Загубата ({usd(res.pnl_at_move, true)}) е реална.
              </Notice>
            )}
            {res ? (
              <Outputs res={res} move={res.price_move_pct} beginner={beginner} />
            ) : (
              <div className="grid grid-cols-1 gap-2.5 min-[460px]:grid-cols-2 xl:grid-cols-3" aria-busy>
                {Array.from({ length: 6 }, (_, i) => (
                  <div key={i} className="glass-inset h-[92px] animate-pulse" />
                ))}
              </div>
            )}
            {res && res.notes.length > 0 && (
              <details className="group rounded-xl border border-white/[0.06] bg-white/[0.015] px-3.5 py-2.5" open={beginner}>
                <summary className="cursor-pointer select-none text-xs font-semibold text-muted transition-colors hover:text-text">Сметката стъпка по стъпка</summary>
                <ul className="mt-2 space-y-1 text-xs leading-relaxed text-muted">
                  {res.notes.map((n, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-faint" aria-hidden />
                      <span className="min-w-0">{n}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </div>
        </div>
      </Card>

      <Card
        title={
          <>
            <ChartSpline size={14} className="text-accent2" aria-hidden /> Equity спрямо движението на цената
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Segmented<"margin" | "notional">
              size="sm"
              options={[
                { value: "margin", label: `Същият margin${marginLabel && !amountError ? ` (${usd(marginLabel)})` : ""}` },
                { value: "notional", label: `Същата позиция${positionLabel && !amountError ? ` (${usd(positionLabel)})` : ""}` },
              ]}
              value={basis}
              onChange={setBasis}
              ariaLabel="Какво е еднакво за всички линии"
            />
            <Segmented<"chart" | "table">
              size="sm"
              options={[
                {
                  value: "chart",
                  label: (
                    <span className="inline-flex items-center gap-1">
                      <ChartSpline size={13} aria-hidden /> Графика
                    </span>
                  ),
                },
                {
                  value: "table",
                  label: (
                    <span className="inline-flex items-center gap-1">
                      <Table2 size={13} aria-hidden /> Таблица
                    </span>
                  ),
                },
              ]}
              value={view}
              onChange={setView}
              ariaLabel="Изглед"
            />
          </div>
          {curves.error && !fam ? (
            <ErrorText error={errorMessage(curves.error)} />
          ) : (
            <LeverageCurves family={fam} selected={leverage} move={move} loading={curves.isValidating} view={view} />
          )}
          {fam && (
            <p className="flex items-start gap-1.5 text-xs leading-relaxed text-muted">
              <TriangleAlert size={13} className="mt-0.5 shrink-0 text-warn" aria-hidden />
              <span className="min-w-0">
                {fam.basis === "margin"
                  ? `Всяка линия е същият margin ${usd(fam.margin)} при различен leverage: позиция от ${usd(fam.margin)} (1x) до ${usd((fam.margin ?? 0) * 100)} (100x). Маркираната линия (${leverage}x) е твоята позиция. По-голям leverage = по-стръмна линия и по-близка ликвидация при движение срещу теб.`
                  : `Всяка линия е същата позиция ${usd(fam.position_notional)} при различен leverage: P/L е еднакъв — leverage-ът сменя само блокирания margin (и с него stop-out нивото при cross margin).`}{" "}
                {view === "chart" && `Оста е от $0 до ${usd(2 * fam.equity)}; линиите извън нея са отрязани — точните стойности са в таблицата.`}
              </span>
            </p>
          )}
        </div>
      </Card>
    </div>
  );
}
