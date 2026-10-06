"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import useSWR from "swr";

import { useAssets } from "@/components/charts/ChartControls";
import TradingChart, { type MarkerDef, type PriceLineDef, type ZoneDef } from "@/components/charts/TradingChart";
import { PositionSizeCalculator } from "@/components/risk/PositionSizeCalculator";
import { Badge, Button, RegimeBadge } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { TF_LABEL, cx, fmtMoney, fmtPct, fmtPrice } from "@/lib/format";
import { useCandles } from "@/lib/hooks";
import { INDICATORS, buildIndicatorSeries, lastValue } from "@/lib/indicators";
import type { Candle } from "@/lib/types";

export type Visual = { type: string; [k: string]: unknown };

export function LessonVisual({ visual }: { visual: Visual }) {
  switch (visual.type) {
    case "orderbook":
      return <OrderBook mode={String(visual.mode ?? "bid_ask")} />;
    case "asset_table":
      return <AssetTable />;
    case "order_types":
      return <OrderTypes highlight={String(visual.highlight ?? "market")} />;
    case "leverage":
      return <LeverageSim focus={String(visual.focus ?? "")} />;
    case "fees":
      return <FeesCalc />;
    case "candle":
      return <CandleVisual candles={(visual.candles as number[][]) ?? []} highlight={visual.highlight as string} builder={!!visual.builder} pattern={visual.pattern as string} />;
    case "live_chart":
      return <LiveChart symbol={String(visual.symbol ?? "BTC/USDT")} tf={String(visual.timeframe ?? "1h")} showRegime={!!visual.show_regime} />;
    case "timeframes":
      return <TimeframesVisual symbol={String(visual.symbol ?? "BTC/USDT")} tfs={(visual.timeframes as string[]) ?? ["5m", "1h", "1d"]} />;
    case "scenario":
      return <ScenarioChart scenario={String(visual.scenario)} />;
    case "indicator":
      return <IndicatorVisual indicator={String(visual.indicator)} symbol={String(visual.symbol ?? "BTC/USDT")} tf={String(visual.timeframe ?? "1h")} />;
    case "risk_calc":
      return <PositionSizeCalculator compact />;
    case "drawdown":
      return <DrawdownVisual />;
    case "expectancy":
      return <ExpectancySim />;
    case "reflection":
      return <Reflection prompts={(visual.prompts as string[]) ?? []} />;
    case "strategy_flow":
      return <StrategyFlow focus={String(visual.focus ?? "")} />;
    default:
      return null;
  }
}

/* ------------------------------------------------------------- order book */
function OrderBook({ mode }: { mode: string }) {
  const [mid, setMid] = useState(100);
  const [spread, setSpread] = useState(0.1);
  const [log, setLog] = useState<string[]>([]);
  const bid = mid - spread / 2;
  const ask = mid + spread / 2;
  const levels = [5, 4, 3, 2, 1];
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="rounded-md border border-line bg-panel2 p-3 text-sm">
        <div className="mb-2 text-xs uppercase tracking-wide text-muted">Order book (опростен)</div>
        {levels.map((l) => (
          <div key={`a${l}`} className="flex justify-between text-down">
            <span className="num">{fmtPrice(ask + (l - 1) * 0.05, 2)}</span>
            <span className="num opacity-70">{(l * 1.7).toFixed(1)}</span>
          </div>
        ))}
        <div className={cx("my-1 rounded px-2 py-1 text-center text-xs", mode !== "intro" ? "bg-warn/15 text-warn" : "bg-panel3 text-muted")}>
          Spread = Ask − Bid = <span className="num font-bold">{spread.toFixed(2)}</span>
        </div>
        {levels.map((l) => (
          <div key={`b${l}`} className="flex justify-between text-up">
            <span className="num">{fmtPrice(bid - (5 - l) * 0.05, 2)}</span>
            <span className="num opacity-70">{((6 - l) * 1.9).toFixed(1)}</span>
          </div>
        ))}
        <div className="mt-2 flex justify-between text-xs text-muted">
          <span>Bid (купувачи)</span>
          <span>Ask (продавачи)</span>
        </div>
      </div>
      <div className="space-y-3 text-sm">
        <label className="block text-xs text-muted">
          Цена (mid): {mid.toFixed(2)}
          <input type="range" min={95} max={105} step={0.05} value={mid} onChange={(e) => setMid(Number(e.target.value))} className="w-full" />
        </label>
        <label className="block text-xs text-muted">
          Spread: {spread.toFixed(2)} {spread > 0.3 && <span className="text-warn">(широк — ниска ликвидност / новини)</span>}
          <input type="range" min={0.02} max={1} step={0.02} value={spread} onChange={(e) => setSpread(Number(e.target.value))} className="w-full" />
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="up" onClick={() => setLog([`Market BUY → изпълнено на ASK ${ask.toFixed(2)}`, ...log].slice(0, 5))}>
            Market BUY
          </Button>
          <Button size="sm" variant="down" onClick={() => setLog([`Market SELL → изпълнено на BID ${bid.toFixed(2)}`, ...log].slice(0, 5))}>
            Market SELL
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setLog([`Купи и веднага продай → загуба ${spread.toFixed(2)} на единица (spread)`, ...log].slice(0, 5))}
          >
            Buy & sell instantly
          </Button>
        </div>
        <ul className="space-y-1 text-xs">
          {log.map((l, i) => (
            <li key={i} className="rounded bg-panel2 px-2 py-1">
              {l}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------- asset table */
function AssetTable() {
  const { data } = useAssets();
  const rows = [
    { cls: "crypto", hours: "24/7", driver: "настроение, ликвидност, регулации", lev: "2:1" },
    { cls: "forex", hours: "24/5", driver: "лихви, макро данни, централни банки", lev: "20–30:1" },
    { cls: "index", hours: "сесии на борсата", driver: "икономика, печалби на компаниите", lev: "20:1" },
    { cls: "stock", hours: "сесии на борсата", driver: "отчети, новини за компанията", lev: "5:1" },
    { cls: "commodity", hours: "почти 24/5", driver: "предлагане/търсене, геополитика", lev: "10–20:1" },
  ];
  const vol = (cls: string) => {
    const list = (data?.assets ?? []).filter((a) => a.asset_class === cls);
    return list.map((a) => a.symbol).join(", ");
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="text-left text-[11px] uppercase text-muted">
          <tr>
            <th className="py-1">Клас</th>
            <th>Часове</th>
            <th>Какво го движи</th>
            <th>Max leverage (симулация)</th>
            <th>Инструменти в платформата</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cls} className="border-t border-line">
              <td className="py-1.5 font-semibold uppercase">{r.cls}</td>
              <td>{r.hours}</td>
              <td className="text-muted">{r.driver}</td>
              <td className="num">{r.lev}</td>
              <td className="text-xs text-muted">{vol(r.cls)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* -------------------------------------------------------------- order types */
const PATH = [100, 99.2, 98.4, 97.6, 98.1, 99.3, 100.4, 101.6, 102.4, 101.8, 103.1, 104];
function OrderTypes({ highlight }: { highlight: string }) {
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setT((x) => (x >= PATH.length - 1 ? (setPlaying(false), x) : x + 1)), 500);
    return () => clearInterval(id);
  }, [playing]);
  const W = 520;
  const H = 200;
  const min = 96.5;
  const max = 105;
  const x = (i: number) => 20 + (i / (PATH.length - 1)) * (W - 40);
  const y = (p: number) => H - 15 - ((p - min) / (max - min)) * (H - 30);
  const levels = [
    { key: "limit", price: 98, label: "Buy LIMIT 98 (под цената)", color: "#26a69a" },
    { key: "stop", price: 102, label: "Buy STOP 102 (над цената)", color: "#f5a623" },
  ];
  const filled = (lv: { key: string; price: number }) =>
    PATH.slice(0, t + 1).some((p) => (lv.key === "limit" ? p <= lv.price : p >= lv.price));
  return (
    <div className="space-y-2">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-md bg-panel2">
        {levels.map((lv) => (
          <g key={lv.key} opacity={highlight === lv.key || highlight === "market" ? 1 : 0.5}>
            <line x1={0} x2={W} y1={y(lv.price)} y2={y(lv.price)} stroke={lv.color} strokeDasharray="5 4" />
            <text x={W - 6} y={y(lv.price) - 4} fontSize={11} fill={lv.color} textAnchor="end">
              {lv.label} {filled(lv) ? "✓ FILLED" : ""}
            </text>
          </g>
        ))}
        <polyline fill="none" stroke="#d1d4dc" strokeWidth={2} points={PATH.slice(0, t + 1).map((p, i) => `${x(i)},${y(p)}`).join(" ")} />
        <circle cx={x(0)} cy={y(PATH[0])} r={5} fill="#2962ff" />
        <text x={x(0) + 8} y={y(PATH[0]) - 8} fontSize={11} fill="#5b8cff">
          MARKET BUY → веднага на 100
        </text>
        <circle cx={x(t)} cy={y(PATH[t])} r={4} fill="#fff" />
      </svg>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={() => (t >= PATH.length - 1 ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))}>
          {playing ? "Pause" : t >= PATH.length - 1 ? "Replay" : "Play"}
        </Button>
        <span className="text-xs text-muted">
          Market се изпълнява веднага. Limit чака по-добра цена. Stop се активира при пробив (и може да има slippage).
        </span>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------- leverage */
function LeverageSim({ focus }: { focus: string }) {
  const [margin, setMargin] = useState(1000);
  const [lev, setLev] = useState(10);
  const [move, setMove] = useState(-3);
  const size = margin * lev;
  const pnl = (size * move) / 100;
  const pctOfMargin = (pnl / margin) * 100;
  const liqMove = -(0.5 / lev) * 100; // stop-out at 50% margin level
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3 text-sm">
        <label className="block text-xs text-muted">
          Margin (твои пари): {fmtMoney(margin)}
          <input type="range" min={100} max={5000} step={100} value={margin} onChange={(e) => setMargin(Number(e.target.value))} className="w-full" />
        </label>
        <label className="block text-xs text-muted">
          Leverage: {lev}x
          <input type="range" min={1} max={50} value={lev} onChange={(e) => setLev(Number(e.target.value))} className="w-full" />
        </label>
        <label className="block text-xs text-muted">
          Движение на цената: {move > 0 ? "+" : ""}
          {move}%
          <input type="range" min={-15} max={15} step={0.5} value={move} onChange={(e) => setMove(Number(e.target.value))} className="w-full" />
        </label>
      </div>
      <div className="space-y-2 rounded-md border border-line bg-panel2 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Размер на позицията</span>
          <span className="num">{fmtMoney(size)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">P/L</span>
          <span className={cx("num font-bold", pnl >= 0 ? "text-up" : "text-down")}>{fmtMoney(pnl, true)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Като % от margin-а</span>
          <span className={cx("num font-bold", pnl >= 0 ? "text-up" : "text-down")}>{fmtPct(pctOfMargin, 1, true)}</span>
        </div>
        <div className={cx("flex justify-between", focus === "liquidation" && "rounded bg-down/10 p-1")}>
          <span className="text-muted">Ликвидация при движение около</span>
          <span className="num text-down">{liqMove.toFixed(1)}%</span>
        </div>
        {move <= liqMove && <div className="rounded bg-down/20 p-2 text-center font-bold text-down">LIQUIDATED — позицията е затворена принудително</div>}
        <p className="text-xs text-muted">
          Leverage не променя шанса движението да е в твоя полза — само колко силно те засяга. При {lev}x едно движение от{" "}
          {(100 / lev).toFixed(1)}% е равно на целия ти margin.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------- fees */
function FeesCalc() {
  const [size, setSize] = useState(5000);
  const [fee, setFee] = useState(0.06);
  const [spreadBps, setSpreadBps] = useState(2);
  const [perDay, setPerDay] = useState(6);
  const perTrade = size * (fee / 100) * 2 + size * (spreadBps / 1e4);
  const monthly = perTrade * perDay * 21;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3 text-xs text-muted">
        <label className="block">
          Размер на сделка: {fmtMoney(size)}
          <input type="range" min={500} max={50000} step={500} value={size} onChange={(e) => setSize(Number(e.target.value))} className="w-full" />
        </label>
        <label className="block">
          Такса (taker): {fee.toFixed(2)}% на страна
          <input type="range" min={0} max={0.2} step={0.01} value={fee} onChange={(e) => setFee(Number(e.target.value))} className="w-full" />
        </label>
        <label className="block">
          Spread: {spreadBps} bps
          <input type="range" min={0} max={30} value={spreadBps} onChange={(e) => setSpreadBps(Number(e.target.value))} className="w-full" />
        </label>
        <label className="block">
          Сделки на ден: {perDay}
          <input type="range" min={1} max={40} value={perDay} onChange={(e) => setPerDay(Number(e.target.value))} className="w-full" />
        </label>
      </div>
      <div className="space-y-2 rounded-md border border-line bg-panel2 p-3 text-sm">
        <div className="flex justify-between">
          <span className="text-muted">Разход за 1 сделка (вход+изход)</span>
          <span className="num">{fmtMoney(perTrade)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted">Месечно (~21 търговски дни)</span>
          <span className="num font-bold text-down">{fmtMoney(monthly)}</span>
        </div>
        <p className="text-xs text-muted">
          Този разход е сигурен. Печалбата — не. Колкото повече сделки, толкова по-голямо предимство трябва да имаш, само за да
          покриеш разходите.
        </p>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ candles */
type OHLC = [number, number, number, number];
function classify(c: OHLC): { dir: string; patterns: string[] } {
  const [o, h, l, cl] = c;
  const range = h - l || 1e-9;
  const body = Math.abs(cl - o);
  const upper = h - Math.max(o, cl);
  const lower = Math.min(o, cl) - l;
  const out: string[] = [];
  if (body / range <= 0.1) out.push("doji");
  if (lower >= 2 * body && upper / range <= 0.15 && body / range > 0.05) out.push("hammer");
  if (upper >= 2 * body && lower / range <= 0.15 && body / range > 0.05) out.push("shooting star");
  if (body / range >= 0.9) out.push("marubozu");
  return { dir: cl > o ? "bullish" : cl < o ? "bearish" : "neutral", patterns: out };
}

function CandleSvg({ candles, highlight }: { candles: OHLC[]; highlight?: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const all = candles.flat();
  const min = Math.min(...all);
  const max = Math.max(...all);
  const H = 240;
  const W = Math.max(220, candles.length * 120);
  const y = (p: number) => 20 + ((max - p) / (max - min || 1)) * (H - 40);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full max-w-xl rounded-md bg-panel2">
      {candles.map((c, i) => {
        const [o, h, l, cl] = c;
        const cx0 = 60 + i * 120;
        const up = cl >= o;
        const color = up ? "#26a69a" : "#ef5350";
        const top = y(Math.max(o, cl));
        const bot = y(Math.min(o, cl));
        const hl = (k: string) => highlight === k;
        return (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
            <rect x={cx0 - 40} y={0} width={80} height={H} fill="transparent" />
            <line x1={cx0} x2={cx0} y1={y(h)} y2={y(l)} stroke={hl("wick") ? "#f5c542" : color} strokeWidth={hl("wick") ? 4 : 2} />
            <rect x={cx0 - 16} y={top} width={32} height={Math.max(bot - top, 1.5)} fill={color} stroke={hl("body") ? "#f5c542" : "none"} strokeWidth={3} />
            {(hover === i || highlight) && (
              <g fontSize={11} fill="#d1d4dc">
                <text x={cx0 + 22} y={y(h) + 4} fill={hl("high") ? "#f5c542" : "#d1d4dc"} fontWeight={hl("high") ? 700 : 400}>
                  H {h}
                </text>
                <text x={cx0 + 22} y={y(l) + 4} fill={hl("low") ? "#f5c542" : "#d1d4dc"} fontWeight={hl("low") ? 700 : 400}>
                  L {l}
                </text>
                <text x={cx0 - 22} y={y(o) + 4} textAnchor="end" fill={hl("open") ? "#f5c542" : "#d1d4dc"} fontWeight={hl("open") ? 700 : 400}>
                  O {o}
                </text>
                <text x={cx0 - 22} y={y(cl) + 4 + (Math.abs(y(cl) - y(o)) < 12 ? 12 : 0)} textAnchor="end" fill={hl("close") ? "#f5c542" : "#d1d4dc"} fontWeight={hl("close") ? 700 : 400}>
                  C {cl}
                </text>
              </g>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function CandleVisual({ candles, highlight, builder, pattern }: { candles: number[][]; highlight?: string; builder?: boolean; pattern?: string }) {
  const [b, setB] = useState<OHLC>([100, 108, 96, 105]);
  const info = classify(b);
  const valid = b[2] <= Math.min(b[0], b[3]) && b[1] >= Math.max(b[0], b[3]);
  const setK = (i: number, v: number) => setB((prev) => prev.map((x, j) => (j === i ? v : x)) as OHLC);
  return (
    <div className="space-y-4">
      <div>
        <CandleSvg candles={candles as OHLC[]} highlight={highlight} />
        <p className="mt-1 text-xs text-muted">Задръж мишката върху свещ, за да видиш Open / High / Low / Close.{pattern && ` Модел: ${pattern.replace("_", " ")}.`}</p>
      </div>
      {builder && (
        <div className="grid gap-4 rounded-md border border-line p-3 md:grid-cols-2">
          <div className="space-y-2 text-xs text-muted">
            <div className="font-semibold text-text">Candle builder</div>
            {(["Open", "High", "Low", "Close"] as const).map((label, i) => (
              <label key={label} className="block">
                {label}: <span className="num text-text">{b[i]}</span>
                <input type="range" min={90} max={115} step={0.5} value={b[i]} onChange={(e) => setK(i, Number(e.target.value))} className="w-full" />
              </label>
            ))}
          </div>
          <div>
            {valid ? (
              <>
                <CandleSvg candles={[b]} />
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge tone={info.dir === "bullish" ? "up" : info.dir === "bearish" ? "down" : "neutral"}>{info.dir}</Badge>
                  {info.patterns.map((p) => (
                    <Badge key={p} tone="accent">
                      {p}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-xs text-muted">
                  {info.dir === "bearish" ? "Bearish, защото Close е под Open." : info.dir === "bullish" ? "Bullish, защото Close е над Open." : "Open = Close."}
                </p>
              </>
            ) : (
              <p className="text-sm text-down">Невалидна свещ: High трябва да е най-високата, а Low — най-ниската стойност.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- live chart */
function LiveChart({ symbol, tf, showRegime }: { symbol: string; tf: string; showRegime?: boolean }) {
  const { data } = useCandles(symbol, tf, [], 200);
  const { data: regime } = useSWR<{ regime: string; reasons: string[] }>(
    showRegime ? `/market/regime?symbol=${encodeURIComponent(symbol)}&timeframe=${tf}` : null,
    fetcher,
  );
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className="font-semibold">
          {symbol} · {TF_LABEL[tf]}
        </span>
        <Badge tone="info">demo data</Badge>
        {regime && <RegimeBadge regime={regime.regime} />}
        <Link href={`/charts?symbol=${encodeURIComponent(symbol)}`} className="ml-auto text-accent2">
          Отвори в Charts →
        </Link>
      </div>
      <TradingChart candles={data?.candles ?? []} precision={data?.precision ?? 2} height={300} fitKey={symbol + tf} visibleBars={100} />
      {regime && <p className="mt-1 text-xs text-muted">{regime.reasons.join(" ")}</p>}
    </div>
  );
}

function TimeframesVisual({ symbol, tfs }: { symbol: string; tfs: string[] }) {
  return (
    <div className="grid gap-2 md:grid-cols-3">
      {tfs.map((tf) => (
        <TfMini key={tf} symbol={symbol} tf={tf} />
      ))}
      <p className="text-xs text-muted md:col-span-3">Един и същ пазар. Lower timeframe = more noise. Higher timeframe = broader context.</p>
    </div>
  );
}

function TfMini({ symbol, tf }: { symbol: string; tf: string }) {
  const { data } = useCandles(symbol, tf, [], 120);
  return (
    <div className="rounded-md border border-line p-1">
      <div className="px-1 text-xs font-semibold">{TF_LABEL[tf]}</div>
      <TradingChart candles={data?.candles ?? []} precision={data?.precision ?? 2} height={200} volume={false} fitKey={tf} visibleBars={120} />
    </div>
  );
}

/* ---------------------------------------------------------- scenario chart */
type Scenario = {
  key: string;
  title: string;
  candles: Candle[];
  annotations: { type: string; index?: number; time?: number; text?: string; position?: string; color?: string; price?: number; label?: string; low?: number; high?: number; style?: string }[];
  steps: { at: number; text: string }[];
};

export function ScenarioChart({ scenario, height = 320 }: { scenario: string; height?: number }) {
  const { data } = useSWR<Scenario>(`/academy/scenarios/${scenario}`, fetcher, { revalidateOnFocus: false });
  const [n, setN] = useState(0);
  const [playing, setPlaying] = useState(false);
  const total = data?.candles.length ?? 0;
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- start each scenario fully revealed
    if (data) setN(data.candles.length);
  }, [data]);

  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => {
      setN((x) => {
        if (x >= total) {
          setPlaying(false);
          return x;
        }
        return x + 1;
      });
    }, 220);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, [playing, total]);

  const shown = useMemo(() => data?.candles.slice(0, Math.max(n, 2)) ?? [], [data, n]);
  const range = useMemo(() => (total ? { from: -1, to: total + 2 } : undefined), [total]);
  const lastIdx = shown.length; // path index of the last shown candle
  const markers: MarkerDef[] = (data?.annotations ?? [])
    .filter((a) => a.type === "marker" && (a.index ?? 0) <= lastIdx)
    .map((a) => ({
      time: a.time!,
      position: a.position === "below" ? "belowBar" : "aboveBar",
      shape: a.position === "below" ? "arrowUp" : "arrowDown",
      color: a.color ?? "#d1d4dc",
      text: a.text,
    }));
  const lines: PriceLineDef[] = (data?.annotations ?? [])
    .filter((a) => a.type === "line")
    .map((a, i) => ({ id: `l${i}`, price: a.price!, color: a.color ?? "#38bdf8", title: a.label, dashed: true }));
  const zones: ZoneDef[] = (data?.annotations ?? [])
    .filter((a) => a.type === "zone")
    .map((a, i) => ({ id: `z${i}`, low: a.low!, high: a.high!, color: a.color ?? "rgba(56,189,248,0.12)", label: a.label }));
  const steps = (data?.steps ?? []).filter((s) => s.at <= lastIdx);

  return (
    <div>
      <div className="mb-1 flex items-center gap-2">
        <span className="text-sm font-semibold">{data?.title}</span>
        <Badge tone="info">animated scenario</Badge>
      </div>
      <TradingChart
        candles={shown}
        precision={2}
        height={height}
        markers={markers}
        priceLines={lines}
        zones={zones}
        fitKey={scenario}
        logicalRange={range}
        hideTimeAxis
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          onClick={() => {
            if (n >= total) setN(8);
            setPlaying((p) => !p);
          }}
        >
          {playing ? "Pause" : n >= total ? "▶ Replay animation" : "▶ Play"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => setN((x) => Math.min(total, x + 1))}>
          Next candle
        </Button>
        <span className="num text-xs text-muted">
          {Math.min(n, total)}/{total}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {steps.map((s) => (
          <div key={s.at} className="fade-in rounded border-l-2 border-accent bg-panel2 px-2 py-1 text-sm">
            {s.text}
          </div>
        ))}
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- indicators */
function IndicatorVisual({ indicator, symbol, tf }: { indicator: string; symbol: string; tf: string }) {
  const map: Record<string, string> = { sma: "sma20", ema: "ema50", rsi: "rsi", macd: "macd", bb: "bb", atr: "atr", vwap: "vwap", volume_sma: "" };
  const key = map[indicator] ?? "";
  const keys = useMemo(() => (key ? (indicator === "ema" ? ["ema20", "ema50", "ema200"] : [key]) : []), [key, indicator]);
  const { data } = useCandles(symbol, tf, keys, 300);
  const { overlays, panes } = useMemo(() => buildIndicatorSeries(data, keys), [data, keys]);
  const def = INDICATORS.find((d) => d.key === key);
  const v = def ? lastValue(data, def, def.name === "macd" ? "hist" : "value") : null;
  return (
    <div>
      <div className="mb-1 flex items-center gap-2 text-xs">
        <span className="font-semibold">
          {symbol} · {TF_LABEL[tf]}
        </span>
        <Badge tone="info">demo data</Badge>
        {def && v !== null && (
          <span className="text-muted">
            {def.label} сега: <span className="num text-text">{v.toFixed(2)}</span>
          </span>
        )}
      </div>
      <TradingChart candles={data?.candles ?? []} precision={data?.precision ?? 2} height={360} overlays={overlays} panes={panes} fitKey={symbol + tf + key} visibleBars={140} />
      {indicator === "rsi" && v !== null && v > 70 && (
        <p className="mt-1 text-xs text-warn">RSI is currently high. This does NOT automatically mean price must fall.</p>
      )}
      {indicator === "volume_sma" && <p className="mt-1 text-xs text-muted">Стълбчетата долу са обемът — сравни движенията с голям и малък обем.</p>}
    </div>
  );
}

/* --------------------------------------------------------------- drawdown */
function DrawdownVisual() {
  const [risk, setRisk] = useState(2);
  const rows = [3, 5, 10, 20].map((n) => {
    const left = Math.pow(1 - risk / 100, n) * 100;
    return { n, left, need: (100 / left - 1) * 100 };
  });
  return (
    <div className="space-y-3">
      <label className="block text-xs text-muted">
        Риск на сделка: {risk}%
        <input type="range" min={0.25} max={20} step={0.25} value={risk} onChange={(e) => setRisk(Number(e.target.value))} className="w-full" />
      </label>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.n} className="text-sm">
            <div className="flex justify-between text-xs">
              <span>{r.n} поредни загуби</span>
              <span className="num">
                остава {r.left.toFixed(1)}% · нужно +{r.need.toFixed(0)}% за възстановяване
              </span>
            </div>
            <div className="h-2.5 w-full rounded-full bg-down/30">
              <div className="h-full rounded-full bg-up" style={{ width: `${r.left}%` }} />
            </div>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">Загубите се възстановяват асиметрично: −50% изисква +100%. Затова малкият риск на сделка е основата.</p>
    </div>
  );
}

/* --------------------------------------------------------------- expectancy */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ExpectancySim() {
  const [wr, setWr] = useState(40);
  const [rr, setRr] = useState(2);
  const [seed, setSeed] = useState(1);
  const exp = (wr / 100) * rr - (1 - wr / 100);
  const paths = useMemo(() => {
    const out: number[][] = [];
    for (let k = 0; k < 15; k++) {
      const rand = mulberry32(seed * 100 + k);
      let eq = 0;
      const p = [0];
      for (let i = 0; i < 100; i++) {
        eq += rand() < wr / 100 ? rr : -1;
        p.push(eq);
      }
      out.push(p);
    }
    return out;
  }, [wr, rr, seed]);
  const all = paths.flat();
  const min = Math.min(...all, -10);
  const max = Math.max(...all, 10);
  const W = 520;
  const H = 200;
  const y = (v: number) => 10 + ((max - v) / (max - min)) * (H - 20);
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-xs text-muted">
          Win rate: {wr}%
          <input type="range" min={10} max={90} value={wr} onChange={(e) => setWr(Number(e.target.value))} className="w-full" />
        </label>
        <label className="block text-xs text-muted">
          Reward:Risk: {rr}
          <input type="range" min={0.5} max={5} step={0.25} value={rr} onChange={(e) => setRr(Number(e.target.value))} className="w-full" />
        </label>
      </div>
      <div className="text-sm">
        Expectancy = {wr}% × {rr}R − {100 - wr}% × 1R ={" "}
        <span className={cx("num font-bold", exp > 0 ? "text-up" : "text-down")}>
          {exp > 0 ? "+" : ""}
          {exp.toFixed(2)}R на сделка
        </span>{" "}
        (преди разходите)
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-md bg-panel2">
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="#5d6273" strokeDasharray="3 3" />
        {paths.map((p, k) => (
          <polyline
            key={k}
            fill="none"
            stroke={p[p.length - 1] >= 0 ? "rgba(38,166,154,0.7)" : "rgba(239,83,80,0.7)"}
            strokeWidth={1.2}
            points={p.map((v, i) => `${(i / 100) * W},${y(v)}`).join(" ")}
          />
        ))}
      </svg>
      <div className="flex items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => setSeed((s) => s + 1)}>
          Нова симулация
        </Button>
        <span className="text-xs text-muted">15 трейдъри × 100 сделки с ЕДНАКВА система. Виж колко различни са резултатите — това е случайността.</span>
      </div>
    </div>
  );
}

/* --------------------------------------------------------------- reflection */
function Reflection({ prompts }: { prompts: string[] }) {
  return (
    <div className="space-y-3">
      {prompts.map((p) => (
        <label key={p} className="block">
          <span className="text-sm font-medium">{p}</span>
          <textarea className="input mt-1 min-h-16" placeholder="Отговорът е само за теб…" />
        </label>
      ))}
      <Link href="/journal" className="text-xs text-accent2">
        Запиши наблюденията си в Journal →
      </Link>
    </div>
  );
}

/* ------------------------------------------------------------ strategy flow */
function StrategyFlow({ focus }: { focus: string }) {
  const stages =
    focus === "validation"
      ? ["In-sample (70%)", "Out-of-sample (30%)", "Sensitivity ±10–25%", "Cost stress test", "Forward test (paper bot)"]
      : focus === "backtest"
        ? ["Свещ i затваря", "Сигнал по правилата", "Вход на OPEN на i+1", "SL / TP / такси / slippage", "Метрики + validation"]
        : ["Market data", "Indicators", "Market structure", "Strategy rules", "Risk engine", "Signal"];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {stages.map((s, i) => (
        <span key={s} className="flex items-center gap-2">
          <span className="rounded-md border border-accent/40 bg-accent/10 px-3 py-2 text-sm font-semibold">{s}</span>
          {i < stages.length - 1 && <span className="text-muted">→</span>}
        </span>
      ))}
      <p className="mt-2 w-full text-xs text-muted">
        {focus === "validation"
          ? "Past backtest performance does not guarantee future results."
          : "Изходът е LONG SETUP / SHORT SETUP / WAIT / NO TRADE — никога автоматична реална поръчка."}
      </p>
    </div>
  );
}
