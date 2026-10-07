"use client";

/*
 * Market-basics visuals: order book & spread, asset classes, order types and trading costs
 * (fees / funding / costs in a backtest). Every number is either user input or a clearly labelled
 * teaching example — never a market quote.
 */
import { ArrowDownRight, ArrowUpRight, CirclePause, CirclePlay, RotateCcw, Shuffle } from "lucide-react";
import { useEffect, useState } from "react";

import { useAssets } from "@/components/charts/ChartControls";
import { Caption, Readout, ReadoutPanel, SliderField } from "@/components/academy/visuals/shared";
import { Badge, Button, Disclaimer, Notice, Term } from "@/components/ui";
import { cx, fmtMoney, fmtPrice } from "@/lib/format";
import { PALETTE, withAlpha } from "@/lib/theme";

/* ───────────────────────────────────────────────────── order book */

export function OrderBook({ mode }: { mode: string }) {
  const [mid, setMid] = useState(100);
  const [spread, setSpread] = useState(0.1);
  const [log, setLog] = useState<{ t: string; tone: "up" | "down" | "warn" }[]>([]);
  const bid = mid - spread / 2;
  const ask = mid + spread / 2;
  const levels = [5, 4, 3, 2, 1];
  const push = (t: string, tone: "up" | "down" | "warn") => setLog((l) => [{ t, tone }, ...l].slice(0, 4));
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="glass-inset p-3 text-sm">
        <div className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">
          <span>Order book (опростен)</span>
          <Badge tone="warn">пример</Badge>
        </div>
        <div className="mb-1 grid grid-cols-2 text-[10px] uppercase tracking-[0.08em] text-faint">
          <span>Цена</span>
          <span className="text-right">Количество</span>
        </div>
        {levels.map((l) => (
          <div key={`a${l}`} className="relative grid grid-cols-2 py-[3px]">
            <span className="absolute inset-y-0 right-0 rounded-sm bg-down/[0.09]" style={{ width: `${l * 16}%` }} aria-hidden />
            <span className="num relative text-down">{fmtPrice(ask + (l - 1) * 0.05, 2)}</span>
            <span className="num relative text-right text-muted">{(l * 1.7).toFixed(1)}</span>
          </div>
        ))}
        <div className={cx("my-1.5 rounded-md px-2 py-1 text-center text-xs", mode !== "intro" ? "bg-warn/[0.12] text-warn ring-1 ring-inset ring-warn/25" : "bg-white/[0.05] text-muted")}>
          <Term k="spread">Spread</Term> = Ask − Bid = <span className="num font-semibold">{spread.toFixed(2)}</span>
        </div>
        {levels.map((l) => (
          <div key={`b${l}`} className="relative grid grid-cols-2 py-[3px]">
            <span className="absolute inset-y-0 right-0 rounded-sm bg-up/[0.09]" style={{ width: `${(6 - l) * 16}%` }} aria-hidden />
            <span className="num relative text-up">{fmtPrice(bid - (5 - l) * 0.05, 2)}</span>
            <span className="num relative text-right text-muted">{((6 - l) * 1.9).toFixed(1)}</span>
          </div>
        ))}
        <div className="mt-2 flex justify-between text-[11px] text-muted">
          <span>
            <Term k="bid">Bid</Term> — купувачи (долу)
          </span>
          <span>
            <Term k="ask">Ask</Term> — продавачи (горе)
          </span>
        </div>
      </div>
      <div className="min-w-0 space-y-3">
        <SliderField label="Цена (mid)" value={mid} display={mid.toFixed(2)} min={95} max={105} step={0.05} onChange={setMid} />
        <SliderField
          label="Spread"
          term="spread"
          value={spread}
          display={spread.toFixed(2)}
          min={0.02}
          max={1}
          step={0.02}
          onChange={setSpread}
          hint={spread > 0.3 ? <span className="text-warn">Широк spread — ниска ликвидност или новини.</span> : "Тесен spread — ликвиден пазар."}
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="up" type="button" onClick={() => push(`Market BUY → изпълнено на ASK ${ask.toFixed(2)}`, "up")}>
            <ArrowUpRight size={13} strokeWidth={2} aria-hidden /> Market BUY
          </Button>
          <Button size="sm" variant="down" type="button" onClick={() => push(`Market SELL → изпълнено на BID ${bid.toFixed(2)}`, "down")}>
            <ArrowDownRight size={13} strokeWidth={2} aria-hidden /> Market SELL
          </Button>
          <Button size="sm" variant="outline" type="button" onClick={() => push(`Купи и веднага продай → −${spread.toFixed(2)} на единица (spread)`, "warn")}>
            <Shuffle size={13} strokeWidth={2} aria-hidden /> Buy & sell instantly
          </Button>
        </div>
        <ul className="space-y-1 text-xs" aria-live="polite">
          {log.length === 0 && <li className="text-faint">Натисни бутон, за да видиш на каква цена се изпълнява поръчката.</li>}
          {log.map((l, i) => (
            <li
              key={`${l.t}-${i}`}
              className={cx(
                "animate-fade-in rounded-md border px-2 py-1",
                l.tone === "up" ? "border-up/20 bg-up/[0.06]" : l.tone === "down" ? "border-down/20 bg-down/[0.06]" : "border-warn/20 bg-warn/[0.06]",
              )}
            >
              <span className="num text-text/90">{l.t}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────── asset classes */

const CLASS_ROWS = [
  { cls: "crypto", label: "Crypto", hours: "24/7", driver: "настроение, ликвидност, регулации", cap: "2:1" },
  { cls: "forex", label: "Forex", hours: "24/5", driver: "лихви, макро данни, централни банки", cap: "30:1 / 20:1" },
  { cls: "index", label: "Indices", hours: "сесии на борсата", driver: "икономика, печалби на компаниите", cap: "20:1" },
  { cls: "stock", label: "Stocks", hours: "сесии на борсата", driver: "отчети, новини за компанията", cap: "5:1" },
  { cls: "etf", label: "ETFs", hours: "сесии на борсата", driver: "състава на фонда (индекс, сектор)", cap: "5:1" },
  { cls: "commodity", label: "Commodities", hours: "почти 24/5", driver: "предлагане/търсене, геополитика", cap: "20:1 / 10:1" },
];

export function AssetTable() {
  const { data } = useAssets();
  const list = data?.assets ?? [];
  const byClass = (cls: string) => list.filter((a) => a.asset_class === cls);
  return (
    <div className="space-y-2">
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="py-1.5 pr-3 font-medium">Клас</th>
              <th className="pr-3 font-medium">Часове</th>
              <th className="pr-3 font-medium">Какво го движи</th>
              <th className="pr-3 font-medium">
                Retail <Term k="leverage">leverage</Term> лимит (ESMA)
              </th>
              <th className="font-medium">В платформата</th>
            </tr>
          </thead>
          <tbody>
            {CLASS_ROWS.map((r) => {
              const items = byClass(r.cls);
              return (
                <tr key={r.cls} className="border-t border-white/[0.06] align-top">
                  <td className="py-2 pr-3 font-semibold text-text">{r.label}</td>
                  <td className="py-2 pr-3 text-text/85">{r.hours}</td>
                  <td className="py-2 pr-3 text-muted">{r.driver}</td>
                  <td className="num py-2 pr-3 text-text/85">{r.cap}</td>
                  <td className="py-2 text-xs text-muted">
                    {items.length ? (
                      <>
                        <span className="num text-text">{items.length}</span> · {items.slice(0, 3).map((a) => a.symbol).join(", ")}
                        {items.length > 3 && " …"}
                      </>
                    ) : (
                      <span className="text-faint">—</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Caption>
        Лимитите са максимумите за retail клиенти в ЕС (ESMA) — таван, не препоръка. Higher leverage magnifies exposure and liquidation risk.
      </Caption>
    </div>
  );
}

/* ───────────────────────────────────────────────────── order types */

const PATH = [100, 99.2, 98.4, 97.6, 98.1, 99.3, 100.4, 101.6, 102.4, 101.8, 103.1, 104];

export function OrderTypes({ highlight }: { highlight: string }) {
  const [t, setT] = useState(PATH.length - 1);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setT((x) => {
        if (x >= PATH.length - 1) {
          setPlaying(false);
          return x;
        }
        return x + 1;
      });
    }, 480);
    return () => clearInterval(id);
  }, [playing]);
  const W = 560;
  const H = 210;
  const min = 96.5;
  const max = 105;
  const x = (i: number) => 24 + (i / (PATH.length - 1)) * (W - 48);
  const y = (p: number) => H - 18 - ((p - min) / (max - min)) * (H - 36);
  const levels = [
    { key: "limit", price: 98, label: "Buy LIMIT 98 (под цената)", color: PALETTE.up },
    { key: "stop", price: 102, label: "Buy STOP 102 (над цената)", color: PALETTE.warn },
  ];
  const filledAt = (lv: { key: string; price: number }) =>
    PATH.findIndex((p, i) => i <= t && (lv.key === "limit" ? p <= lv.price : p >= lv.price));
  return (
    <div className="space-y-2.5">
      <svg viewBox={`0 0 ${W} ${H}`} className="glass-inset block w-full" role="img" aria-label="Market, limit и stop поръчка върху движение на цената">
        {levels.map((lv) => {
          const fi = filledAt(lv);
          const on = highlight === lv.key || highlight === "market";
          return (
            <g key={lv.key} opacity={on ? 1 : 0.55}>
              <line x1={0} x2={W} y1={y(lv.price)} y2={y(lv.price)} stroke={lv.color} strokeDasharray="5 4" strokeOpacity={0.8} />
              <text x={W - 8} y={y(lv.price) - 6} fontSize={11} fill={lv.color} textAnchor="end" fontWeight={600}>
                {lv.label} {fi >= 0 ? "· FILLED" : ""}
              </text>
              {fi >= 0 && <circle cx={x(fi)} cy={y(lv.price)} r={5} fill={lv.color} stroke={PALETTE.surface} strokeWidth={2} />}
            </g>
          );
        })}
        <polyline fill="none" stroke={PALETTE.text} strokeOpacity={0.85} strokeWidth={2} strokeLinejoin="round" points={PATH.slice(0, t + 1).map((p, i) => `${x(i)},${y(p)}`).join(" ")} />
        <circle cx={x(0)} cy={y(PATH[0])} r={5.5} fill={PALETTE.accent} stroke={PALETTE.surface} strokeWidth={2} />
        <text x={x(0) + 10} y={y(PATH[0]) - 9} fontSize={11} fill={PALETTE.accent2} fontWeight={600} opacity={highlight === "market" ? 1 : 0.75}>
          MARKET BUY → веднага на 100
        </text>
        <circle cx={x(t)} cy={y(PATH[t])} r={4} fill={withAlpha(PALETTE.text, 0.95)} />
      </svg>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          type="button"
          onClick={() => {
            if (t >= PATH.length - 1) {
              setT(0);
              setPlaying(true);
            } else setPlaying((p) => !p);
          }}
        >
          {playing ? <CirclePause size={13} strokeWidth={2} aria-hidden /> : t >= PATH.length - 1 ? <RotateCcw size={13} strokeWidth={2} aria-hidden /> : <CirclePlay size={13} strokeWidth={2} aria-hidden />}
          {playing ? "Pause" : t >= PATH.length - 1 ? "Replay" : "Play"}
        </Button>
        <span className="text-xs text-muted">
          <Term k="market_order">Market</Term> се изпълнява веднага. <Term k="limit_order">Limit</Term> чака по-добра цена.{" "}
          <Term k="stop_order">Stop</Term> се активира при пробив (и може да има <Term k="slippage">slippage</Term>).
        </span>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────── costs */

export function FeesCalc({ focus }: { focus: string }) {
  if (focus === "funding") return <FundingCalc />;
  if (focus === "backtest") return <BacktestCosts />;
  return <TradingCosts />;
}

function TradingCosts() {
  const [size, setSize] = useState(5000);
  const [fee, setFee] = useState(0.06);
  const [spreadBps, setSpreadBps] = useState(2);
  const [perDay, setPerDay] = useState(6);
  const perTrade = size * (fee / 100) * 2 + size * (spreadBps / 1e4);
  const monthly = perTrade * perDay * 21;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="min-w-0 space-y-3">
        <SliderField label="Размер на сделка" term="position_size" value={size} display={fmtMoney(size)} min={500} max={50000} step={500} onChange={setSize} />
        <SliderField label="Такса (taker), на страна" term="fees" value={fee} display={`${fee.toFixed(2)}%`} min={0} max={0.2} step={0.01} onChange={setFee} />
        <SliderField label="Spread" term="spread" value={spreadBps} display={`${spreadBps} bps`} min={0} max={30} onChange={setSpreadBps} />
        <SliderField label="Сделки на ден" value={perDay} min={1} max={40} onChange={setPerDay} />
      </div>
      <div className="min-w-0 space-y-2">
        <ReadoutPanel title="Разходи (пример)">
          <Readout label="1 сделка (вход + изход)" value={fmtMoney(perTrade)} />
          <Readout label="Месечно (~21 търговски дни)" value={fmtMoney(monthly)} tone="down" strong focus />
        </ReadoutPanel>
        <Caption>
          Този разход е сигурен. Печалбата — не. Колкото повече сделки, толкова по-голямо предимство трябва да имаш, само за да
          покриеш разходите.
        </Caption>
      </div>
    </div>
  );
}

function FundingCalc() {
  const [notional, setNotional] = useState(20000);
  const [rate, setRate] = useState(0.01);
  const [periodsPerDay, setPeriodsPerDay] = useState(3);
  const [days, setDays] = useState(14);
  const perPeriod = notional * (rate / 100);
  const total = perPeriod * periodsPerDay * days;
  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <SliderField label="Notional (размер на позицията)" term="position_size" value={notional} display={fmtMoney(notional)} min={1000} max={100000} step={1000} onChange={setNotional} />
          <SliderField label="Хипотетична ставка за период" value={rate} display={`${rate.toFixed(3)}%`} min={0} max={0.1} step={0.005} onChange={setRate} />
          <SliderField
            label="Плащания на ден"
            value={periodsPerDay}
            display={periodsPerDay === 1 ? "1 (overnight swap)" : `${periodsPerDay} (funding на ${24 / periodsPerDay} ч)`}
            min={1}
            max={3}
            onChange={setPeriodsPerDay}
          />
          <SliderField label="Дни в позицията" value={days} min={1} max={60} onChange={setDays} />
        </div>
        <div className="min-w-0 space-y-2">
          <ReadoutPanel title="Цена на държането">
            <Readout label="На едно плащане" value={fmtMoney(perPeriod)} />
            <Readout label={`За ${days} дни`} value={fmtMoney(total)} tone="down" strong focus />
            <Readout label="Като % от notional" value={`${notional ? ((total / notional) * 100).toFixed(2) : "0.00"}%`} />
          </ReadoutPanel>
          <Caption>Разходът расте с размера на позицията (notional), не с margin-а — затова по-висок leverage прави държането по-скъпо спрямо сметката.</Caption>
        </div>
      </div>
      <Disclaimer>
        Ставката тук е хипотетична стойност за упражнението, не реална пазарна ставка: реалните funding/swap ставки се променят във времето, могат да
        бъдат положителни или отрицателни и се определят от борсата или брокера. Paper engine-ът на платформата не начислява funding.
      </Disclaimer>
    </div>
  );
}

function BacktestCosts() {
  const [gross, setGross] = useState(0.25);
  const [fee, setFee] = useState(0.05);
  const [slip, setSlip] = useState(3);
  const [trades, setTrades] = useState(200);
  const cost = fee * 2 + slip / 100; // % of position per round trip (slippage in bps → %)
  const net = gross - cost;
  const max = Math.max(Math.abs(gross), Math.abs(net), cost, 0.01);
  const bar = (v: number) => `${(Math.abs(v) / max) * 100}%`;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="min-w-0 space-y-3">
        <SliderField label="Среден резултат на сделка преди разходи" value={gross} display={`${gross >= 0 ? "+" : ""}${gross.toFixed(2)}%`} min={-0.2} max={1} step={0.01} onChange={setGross} />
        <SliderField label="Такса на страна" term="fees" value={fee} display={`${fee.toFixed(2)}%`} min={0} max={0.2} step={0.01} onChange={setFee} />
        <SliderField label="Spread + slippage на сделка" term="slippage" value={slip} display={`${slip} bps`} min={0} max={30} onChange={setSlip} />
        <SliderField label="Брой сделки в теста" value={trades} min={20} max={1000} step={10} onChange={setTrades} />
      </div>
      <div className="min-w-0 space-y-3">
        <div className="glass-inset space-y-2.5 p-3">
          {[
            { label: "Gross (без разходи)", v: gross, tone: gross >= 0 ? "bg-up" : "bg-down" },
            { label: "Разходи на сделка", v: -cost, tone: "bg-warn" },
            { label: "Net (с разходи)", v: net, tone: net >= 0 ? "bg-up" : "bg-down" },
          ].map((r) => (
            <div key={r.label}>
              <div className="mb-1 flex justify-between text-xs">
                <span className="text-muted">{r.label}</span>
                <span className={cx("num", r.v >= 0 ? "text-up" : "text-down")}>
                  {r.v >= 0 ? "+" : ""}
                  {r.v.toFixed(2)}%
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                <div className={cx("h-full rounded-full opacity-80", r.tone)} style={{ width: bar(r.v) }} />
              </div>
            </div>
          ))}
        </div>
        <ReadoutPanel>
          <Readout label={`Разходи за ${trades} сделки`} value={`${(cost * trades).toFixed(1)}% от позицията`} tone="warn" />
          <Readout label="Резултат след разходи" value={net > 0 ? "предимството оцелява" : "предимството изчезва"} tone={net > 0 ? "up" : "down"} strong focus />
        </ReadoutPanel>
        {net <= 0 && gross > 0 && (
          <Notice tone="warn" title="Печеливш на хартия, губещ в реалността">
            Backtest без разходи би показал печалба; със същите сделки и реалистични такси и slippage резултатът е отрицателен.
          </Notice>
        )}
      </div>
    </div>
  );
}
