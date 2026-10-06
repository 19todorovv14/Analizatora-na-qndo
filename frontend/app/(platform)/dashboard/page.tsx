"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import { SymbolPicker } from "@/components/charts/ChartControls";
import { Badge, Button, Card, Empty, Loading, ProgressBar, RegimeBadge, Stat, WhyButton } from "@/components/ui";
import { del, fetcher, post } from "@/lib/api";
import { cx, fmtMoney, fmtNum, fmtPct, fmtPrice, fmtR, fmtTime, pnlClass } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { Position, Trade } from "@/lib/types";

type WatchRow = {
  symbol: string;
  name: string;
  asset_class: string;
  price?: number;
  change_24h_pct?: number | null;
  volume_24h?: number | null;
  volatility_pct?: number | null;
  trend?: string;
  regime?: string;
  precision?: number;
  error?: string;
};

type Dashboard = {
  user: { display_name: string; xp: number; is_guest: boolean };
  market_overview: WatchRow[];
  watchlist: WatchRow[];
  account: { balance: number; equity: number; unrealized_pnl: number; realized_pnl: number; day_pnl: number; free_margin: number; max_drawdown_pct: number };
  open_positions: Position[];
  recent_trades: Trade[];
  learning: {
    xp: number;
    level: number;
    categories: { category: string; percent: number }[];
    lessons_completed: number;
    lessons_total: number;
    next_module: { key: string; title: string; percent: number } | null;
  };
  bots: { id: number; name: string; symbol: string; timeframe: string; status: string; regime: string | null; last_signal: string | null }[];
  strategy_performance: { id: number; strategy: string; symbol: string; timeframe: string; status: string; net_pnl: number | null; trades: number | null; profit_factor: number | null }[];
  risk: {
    status: string;
    day_loss_pct: number;
    rules: { max_daily_loss_pct: number; max_open_positions: number; max_risk_per_trade_pct: number };
    open_positions: number;
    exposure_pct: number;
    recent_events: { ts: number; kind: string; severity: string; message: string }[];
  };
  ai_insights: { kind: string; title: string; text: string; lesson: string }[];
};

export default function DashboardPage() {
  const { data, mutate } = useSWR<Dashboard>("/dashboard", fetcher, { refreshInterval: 15000 });
  const { beginner } = useSession();
  const [adding, setAdding] = useState("TSLA");
  if (!data) return <Loading />;

  const r = data.risk;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold">Здравей, {data.user.display_name}</h1>
          <p className="text-sm text-muted">LEARN → UNDERSTAND → PRACTICE → BACKTEST → PAPER TRADE → REVIEW → IMPROVE</p>
        </div>
        <div className="flex gap-2">
          <Link href="/learn">
            <Button variant="outline">Продължи обучението</Button>
          </Link>
          <Link href="/paper">
            <Button>Paper Trading</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        {data.market_overview.map((m) => (
          <Link key={m.symbol} href={`/charts?symbol=${encodeURIComponent(m.symbol)}`} className="card block p-3 hover:border-accent">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{m.symbol}</span>
              <RegimeBadge regime={m.regime} />
            </div>
            <div className="num mt-1 text-lg font-bold">{fmtPrice(m.price, m.precision)}</div>
            <div className={cx("num text-xs", pnlClass(m.change_24h_pct))}>{fmtPct(m.change_24h_pct, 2, true)} 24h</div>
          </Link>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card
          title="Watchlist"
          className="xl:col-span-2"
          right={
            <div className="flex items-center gap-1">
              <SymbolPicker value={adding} onChange={setAdding} className="!py-1 text-xs" />
              <Button size="sm" onClick={() => post("/market/watchlist", { symbol: adding }).then(() => mutate())}>
                + Add
              </Button>
            </div>
          }
        >
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-1">Asset</th>
                  <th>Price</th>
                  <th>Change</th>
                  <th>Volume</th>
                  <th>Volatility</th>
                  <th>Trend</th>
                  <th>Regime</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.watchlist.map((w) => (
                  <tr key={w.symbol} className="border-t border-line">
                    <td className="py-1.5">
                      <Link href={`/charts?symbol=${encodeURIComponent(w.symbol)}`} className="font-semibold hover:text-accent2">
                        {w.symbol}
                      </Link>
                      <div className="text-[11px] text-muted">{w.name}</div>
                    </td>
                    <td className="num">{fmtPrice(w.price, w.precision)}</td>
                    <td className={cx("num", pnlClass(w.change_24h_pct))}>{fmtPct(w.change_24h_pct, 2, true)}</td>
                    <td className="num text-muted">{fmtNum(w.volume_24h)}</td>
                    <td className="num">{fmtPct(w.volatility_pct, 2)}</td>
                    <td className={cx(w.trend === "Up" ? "text-up" : w.trend === "Down" ? "text-down" : "text-muted")}>{w.trend ?? "—"}</td>
                    <td>
                      <RegimeBadge regime={w.regime} />
                    </td>
                    <td className="text-right">
                      <button className="text-xs text-faint hover:text-down" onClick={() => del(`/market/watchlist/${w.symbol}`).then(() => mutate())}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {beginner && <p className="mt-2 text-[11px] text-muted">Volatility = ATR като % от цената на 1H. Regime = класификация на пазара (виж AI Teacher за причините).</p>}
        </Card>

        <Card title="AI insights" right={<Badge tone="accent">AI Teacher</Badge>}>
          <div className="space-y-3">
            {data.ai_insights.map((i, idx) => (
              <div key={idx} className="rounded-md border border-line bg-panel2 p-3">
                <div className="text-sm font-semibold">{i.title}</div>
                <p className="mt-1 text-xs leading-relaxed text-muted">{i.text}</p>
                <WhyButton>
                  {i.kind === "behavior"
                    ? "Засякохме този модел в историята на твоите paper сделки (поведенчески анализ). Целта е да го видиш навреме, преди да стане навик."
                    : i.kind === "market"
                      ? "Това е автоматична класификация на режима на пазара от индикатори (EMA, ADX, ATR). Режимът определя кои стратегии имат смисъл."
                      : "Препоръчваме следващата стъпка според прогреса ти."}{" "}
                  <Link href={`/learn/${i.lesson}`} className="text-accent2 hover:underline">
                    Свързан урок →
                  </Link>
                </WhyButton>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Paper account" right={<Link href="/paper" className="text-xs text-accent2">Open →</Link>}>
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Equity" term="equity" value={fmtMoney(data.account.equity)} />
            <Stat label="Balance" term="balance" value={fmtMoney(data.account.balance)} />
            <Stat label="Unrealized" term="unrealized" value={fmtMoney(data.account.unrealized_pnl, true)} tone={pnlClass(data.account.unrealized_pnl)} />
            <Stat label="Day P/L" value={fmtMoney(data.account.day_pnl, true)} tone={pnlClass(data.account.day_pnl)} />
          </div>
        </Card>

        <Card title="Risk status" right={<Badge tone={r.status === "OK" ? "up" : r.status === "WARNING" ? "warn" : "down"}>{r.status}</Badge>}>
          <div className="space-y-2 text-sm">
            <div>
              <div className="flex justify-between text-xs text-muted">
                <span>Daily loss</span>
                <span className="num">
                  {fmtPct(r.day_loss_pct, 2)} / {r.rules.max_daily_loss_pct}%
                </span>
              </div>
              <ProgressBar value={(r.day_loss_pct / r.rules.max_daily_loss_pct) * 100} tone={r.day_loss_pct > r.rules.max_daily_loss_pct * 0.7 ? "warn" : "up"} />
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">Open positions</span>
              <span className="num">
                {r.open_positions} / {r.rules.max_open_positions}
              </span>
            </div>
            <div className="flex justify-between text-xs">
              <span className="text-muted">Exposure</span>
              <span className="num">{fmtPct(r.exposure_pct, 0)}</span>
            </div>
            {r.recent_events.slice(0, 2).map((e) => (
              <div key={e.ts + e.kind} className="rounded bg-panel2 p-2 text-xs">
                <Badge tone={e.severity === "high" ? "down" : "warn"}>{e.kind}</Badge> <span className="text-muted">{e.message}</span>
              </div>
            ))}
            <Link href="/risk" className="text-xs text-accent2">
              Risk Management →
            </Link>
          </div>
        </Card>

        <Card title="Learning progress" right={<span className="text-xs text-gold">Level {data.learning.level} · {data.learning.xp} XP</span>}>
          <div className="space-y-2">
            {data.learning.categories.map((c) => (
              <div key={c.category}>
                <div className="flex justify-between text-xs">
                  <span>{c.category}</span>
                  <span className="num text-muted">{c.percent}%</span>
                </div>
                <ProgressBar value={c.percent} tone={c.percent === 100 ? "up" : "accent"} />
              </div>
            ))}
            {data.learning.next_module && (
              <Link href="/learn" className="block pt-1 text-xs text-accent2">
                Следващо: {data.learning.next_module.title} →
              </Link>
            )}
          </div>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Open paper positions">
          {data.open_positions.length ? (
            <table className="w-full text-sm">
              <tbody>
                {data.open_positions.map((p) => (
                  <tr key={p.id} className="border-t border-line first:border-0">
                    <td className="py-1.5 font-semibold">{p.symbol}</td>
                    <td>
                      <Badge tone={p.side === "long" ? "up" : "down"}>{p.side}</Badge>
                    </td>
                    <td className="num">{p.qty}</td>
                    <td className={cx("num text-right", pnlClass(p.unrealized_pnl))}>{fmtMoney(p.unrealized_pnl, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Няма отворени позиции.</Empty>
          )}
        </Card>
        <Card title="Recent trades" right={<Link href="/stats" className="text-xs text-accent2">Report →</Link>}>
          {data.recent_trades.length ? (
            <table className="w-full text-sm">
              <tbody>
                {data.recent_trades.map((t) => (
                  <tr key={t.id} className="border-t border-line first:border-0">
                    <td className="py-1.5 text-xs text-muted">{fmtTime(t.closed_ts)}</td>
                    <td className="font-semibold">{t.symbol}</td>
                    <td className="text-xs">{t.exit_reason}</td>
                    <td className="num">{fmtR(t.r_multiple)}</td>
                    <td className={cx("num text-right", pnlClass(t.net_pnl))}>{fmtMoney(t.net_pnl, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Още няма сделки.</Empty>
          )}
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Bot status" right={<Link href="/bots" className="text-xs text-accent2">Bot Lab →</Link>}>
          {data.bots.length ? (
            <table className="w-full text-sm">
              <tbody>
                {data.bots.map((b) => (
                  <tr key={b.id} className="border-t border-line first:border-0">
                    <td className="py-1.5">
                      <Link href={`/bots/${b.id}`} className="font-semibold hover:text-accent2">
                        {b.name}
                      </Link>
                    </td>
                    <td className="text-xs text-muted">
                      {b.symbol} · {b.timeframe}
                    </td>
                    <td>
                      <Badge tone={b.status === "RUNNING" ? "up" : b.status === "PAUSED" ? "warn" : "neutral"}>{b.status}</Badge>
                    </td>
                    <td className="text-right text-xs text-muted">{b.last_signal ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Нямаш paper ботове. Създай стратегия → backtest → бот.</Empty>
          )}
        </Card>
        <Card title="Strategy performance (последни backtests)" right={<Link href="/backtesting" className="text-xs text-accent2">Lab →</Link>}>
          {data.strategy_performance.length ? (
            <table className="w-full text-sm">
              <tbody>
                {data.strategy_performance.map((b) => (
                  <tr key={b.id} className="border-t border-line first:border-0">
                    <td className="py-1.5 font-semibold">{b.strategy}</td>
                    <td className="text-xs text-muted">
                      {b.symbol} {b.timeframe}
                    </td>
                    <td className="num text-xs">{b.trades ?? "—"} tr.</td>
                    <td className={cx("num text-right", pnlClass(b.net_pnl))}>{fmtMoney(b.net_pnl, true)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <Empty>Още няма backtests.</Empty>
          )}
          <p className="mt-2 text-[11px] text-faint">Past backtest performance does not guarantee future results.</p>
        </Card>
      </div>
    </div>
  );
}
