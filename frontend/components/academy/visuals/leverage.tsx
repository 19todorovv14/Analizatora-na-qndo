"use client";

/*
 * Leverage & margin visuals (lesson visual type "leverage"). Pure maths on user inputs with a
 * virtual account — no leverage value is ever suggested. Config keys (all optional):
 * account (virtual equity, e.g. 10000), focus "margin" | "maintenance" | "liquidation",
 * variant "distance" (liquidation distance per leverage + cross-margin calculator).
 */
import { Skull, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Caption, Readout, ReadoutPanel, SliderField } from "@/components/academy/visuals/shared";
import { Badge, Term } from "@/components/ui";
import { cx, fmtMoney, fmtPct } from "@/lib/format";

export const LEVERAGE_WARNING = "Higher leverage magnifies exposure and liquidation risk.";
const STOP_OUT = 0.5; // stop-out at a 50% margin level (the platform's paper rule used in the lessons)

export function LeverageVisual({ account, focus, variant }: { account?: number; focus: string; variant?: string }) {
  if (variant === "distance") return <LeverageDistance account={account ?? 10_000} />;
  return <LeverageSim account={account} focus={focus} />;
}

function LeverageSim({ account, focus }: { account?: number; focus: string }) {
  const maxMargin = account ? Math.min(account, 10_000) : 5000;
  const [margin, setMargin] = useState(1000);
  const [lev, setLev] = useState(10);
  const [move, setMove] = useState(-3);
  const size = margin * lev;
  const pnl = (size * move) / 100;
  const posEquity = margin + pnl;
  const marginLevel = margin > 0 ? (posEquity / margin) * 100 : 0;
  const liqMove = -(STOP_OUT / lev) * 100;
  const liquidated = move <= liqMove;
  // after a stop-out the position is closed at the 50% margin level (gaps ignored in this teaching model)
  const shownPnl = liquidated ? -margin * (1 - STOP_OUT) : pnl;
  const lvlTone = marginLevel <= 50 ? "down" : marginLevel < 100 ? "warn" : "up";
  const LVL_INK = { down: "text-down", warn: "text-warn", up: "text-up" } as const;

  return (
    <div className="space-y-3">
      {account !== undefined && (
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <Badge tone="warn">virtual</Badge>
          Сметка <span className="num text-text">{fmtMoney(account)}</span> · stop-out при margin level <span className="num text-text">50%</span> (isolated)
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <SliderField label="Margin (блокирани от сметката)" term="margin" value={margin} display={fmtMoney(margin)} min={100} max={maxMargin} step={100} onChange={setMargin} />
          <SliderField label="Leverage" term="leverage" value={lev} display={`${lev}x`} min={1} max={100} onChange={setLev} />
          <SliderField
            label="Движение на цената (long)"
            value={move}
            display={`${move > 0 ? "+" : ""}${move}%`}
            min={-20}
            max={20}
            step={0.5}
            onChange={setMove}
          />
          <div>
            <div className="mb-1 flex items-baseline justify-between text-xs">
              <span className="text-muted">
                <Term k="marginlevel">Margin level</Term>
              </span>
              <span className={cx("num font-medium", LVL_INK[lvlTone])}>{liquidated ? "stop-out" : `${Math.max(0, marginLevel).toFixed(0)}%`}</span>
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={cx("h-full rounded-full transition-[width] duration-300", lvlTone === "down" ? "bg-down" : lvlTone === "warn" ? "bg-warn" : "bg-up")}
                style={{ width: `${Math.max(0, Math.min(100, marginLevel / 2))}%` }}
              />
              <span className="absolute inset-y-0 left-1/4 w-px bg-down" aria-hidden />
              <span className="absolute inset-y-0 left-1/2 w-px bg-white/30" aria-hidden />
            </div>
            <div className="mt-1 flex justify-between text-[10px] text-faint">
              <span className="num">0%</span>
              <span className="num text-down">stop-out 50%</span>
              <span className="num">100%</span>
              <span className="num">200%</span>
            </div>
          </div>
        </div>
        <div className="min-w-0 space-y-2">
          <ReadoutPanel title="Позиция">
            <Readout label="Размер на позицията (notional)" term="position_size" value={fmtMoney(size)} focus={focus === "margin"} strong />
            <Readout label="Използван margin" value={fmtMoney(margin)} focus={focus === "margin"} />
            {account !== undefined && <Readout label="Free margin" term="freemargin" value={fmtMoney(account - margin)} />}
            {account !== undefined && <Readout label="Ефективен leverage (notional / сметка)" value={`${(size / account).toFixed(2)}x`} />}
            <Readout label="P/L" term="unrealized" value={fmtMoney(shownPnl, true)} tone={pnl >= 0 ? "up" : "down"} strong />
            <Readout label="P/L като % от margin-а" value={fmtPct((shownPnl / margin) * 100, 1, true)} tone={pnl >= 0 ? "up" : "down"} />
            {account !== undefined && (
              <Readout label="P/L като % от сметката" value={fmtPct((shownPnl / account) * 100, 2, true)} tone={pnl >= 0 ? "up" : "down"} />
            )}
            <Readout label="Margin level" term="marginlevel" value={liquidated ? "≤ 50%" : `${marginLevel.toFixed(0)}%`} tone={lvlTone} focus={focus === "maintenance"} />
            <Readout label="Ликвидация при движение около" term="liquidation" value={`${liqMove.toFixed(2)}%`} tone="down" focus={focus === "liquidation"} strong={focus === "liquidation"} />
          </ReadoutPanel>
          {liquidated && (
            <div role="alert" className="flex items-center gap-2 rounded-lg border border-down/40 bg-down/[0.12] px-3 py-2 text-sm font-semibold text-down">
              <Skull size={16} strokeWidth={2} aria-hidden /> LIQUIDATED — позицията е затворена принудително
            </div>
          )}
        </div>
      </div>
      <Caption icon={TriangleAlert}>
        Leverage не променя шанса движението да е в твоя полза — само колко силно те засяга. При {lev}x движение от {(100 / lev).toFixed(1)}% е
        равно на целия margin. {LEVERAGE_WARNING}
      </Caption>
    </div>
  );
}

const LEVELS = [2, 5, 10, 20, 50, 100];

function LeverageDistance({ account }: { account: number }) {
  const [notional, setNotional] = useState(20_000);
  const [lev, setLev] = useState(10);
  const used = notional / lev;
  const crossDist = notional > 0 ? ((account - STOP_OUT * used) / notional) * 100 : 0;
  const maxD = (STOP_OUT / LEVELS[0]) * 100;
  return (
    <div className="space-y-4">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted">
          <Badge tone="neutral">isolated margin</Badge>
          margin <span className="num text-text">{fmtMoney(1000)}</span> от <span className="num text-text">{fmtMoney(account)}</span> virtual · stop-out при 50%
        </div>
        <div className="glass-inset space-y-1.5 p-3">
          <div className="grid grid-cols-[52px_minmax(0,1fr)_64px] gap-3 text-[10px] uppercase tracking-[0.08em] text-faint sm:grid-cols-[52px_96px_minmax(0,1fr)_64px]">
            <span>Leverage</span>
            <span className="hidden sm:block">Notional</span>
            <span>Разстояние до ликвидация</span>
            <span className="text-right">Движение</span>
          </div>
          {LEVELS.map((l) => {
            const d = (STOP_OUT / l) * 100;
            return (
              <div key={l} className="grid grid-cols-[52px_minmax(0,1fr)_64px] items-center gap-3 text-sm sm:grid-cols-[52px_96px_minmax(0,1fr)_64px]">
                <span className="num font-semibold text-text">{l}x</span>
                <span className="num hidden text-muted sm:block">{fmtMoney(1000 * l)}</span>
                <span className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
                  <span className="block h-full rounded-full bg-gradient-to-r from-down/50 to-down/80" style={{ width: `${Math.max(1.2, (d / maxD) * 100)}%` }} />
                </span>
                <span className="num text-right text-down">−{d.toFixed(d < 1 ? 2 : 1)}%</span>
              </div>
            );
          })}
        </div>
        <Caption className="mt-1.5">Разстояние ≈ 0.5 / L. Сравни го с нормалното движение на актива (ATR в Charts): 0.5–1% може да бъде изминато от обикновен шум.</Caption>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-[0.08em] text-muted">Cross margin — една позиция</div>
          <SliderField label="Notional на позицията" term="position_size" value={notional} display={fmtMoney(notional)} min={1000} max={200_000} step={1000} onChange={setNotional} />
          <SliderField label="Leverage на позицията" term="leverage" value={lev} display={`${lev}x`} min={1} max={100} onChange={setLev} />
        </div>
        <div className="min-w-0 space-y-2">
          <ReadoutPanel title={`Сметка ${fmtMoney(account)} virtual`}>
            <Readout label="Ефективен leverage" value={`${(notional / account).toFixed(1)}x`} />
            <Readout label="Използван margin" term="margin" value={fmtMoney(used)} />
            <Readout
              label="Разстояние до ликвидация"
              term="liquidation"
              value={crossDist <= 0 ? "веднага" : `−${crossDist.toFixed(1)}%`}
              tone="down"
              strong
              focus
            />
          </ReadoutPanel>
          <Caption>(Equity − 0.5 × Used margin) / Notional — решаващ е размерът на позицията спрямо сметката.</Caption>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
        <span className="font-medium text-warn">{LEVERAGE_WARNING}</span>
        <Link href="/learn/leverage" className="font-medium text-accent2 hover:text-text">
          Leverage Lab →
        </Link>
      </div>
    </div>
  );
}
