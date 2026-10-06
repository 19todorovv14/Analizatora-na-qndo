"use client";

import { useState } from "react";
import useSWR from "swr";

import { useAssets } from "@/components/charts/ChartControls";
import { Badge, Button, Card, ErrorText, Field, InfoTip, Loading, Notice } from "@/components/ui";
import { errorMessage, fetcher, patch, post, put } from "@/lib/api";
import { useSession } from "@/lib/session";
import type { AccountView } from "@/lib/types";

type Settings = {
  settings: {
    execution: Record<string, number | boolean | string>;
    default_symbol: string;
    default_timeframe: string;
    news_risk: boolean;
    tour_done: boolean;
    max_trades_per_day: number;
  };
};
type Health = { execution_mode: string; live_trading: boolean; market_data: Record<string, string>; ai_provider: string; celery: boolean };

const EXEC: [string, string, string][] = [
  ["fees_enabled", "Fees", "Комисионни при всяко изпълнение."],
  ["spread_enabled", "Spread", "BUY на ask, SELL на bid."],
  ["slippage_enabled", "Slippage", "Неблагоприятна разлика в цената при market/stop."],
  ["latency_enabled", "Latency simulation", "Цената се движи, докато поръчката 'пътува'."],
  ["partial_fills_enabled", "Partial fills", "Големите поръчки спрямо обема се изпълняват на части."],
  ["liquidation_enabled", "Liquidation", "Принудително затваряне при margin level < 50%."],
];

export default function SettingsPage() {
  const { user, beginner, setMode, refresh, logout } = useSession();
  const { data, mutate } = useSWR<Settings>("/settings", fetcher);
  const { data: health } = useSWR<Health>("/health", fetcher);
  const { data: account, mutate: mutateAcc } = useSWR<AccountView>("/paper/account", fetcher);
  const { data: assets } = useAssets();
  const [balance, setBalance] = useState("10000");
  const [claim, setClaim] = useState({ email: "", password: "", display_name: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data || !account || !user) return <Loading />;
  const exec = data.settings.execution;

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      mutate();
      mutateAcc();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <h1 className="text-lg font-bold">Settings</h1>
      <ErrorText error={error} />
      {msg && <Notice tone="up">{msg}</Notice>}

      <Card title="Learning mode">
        <div className="flex flex-wrap items-center gap-3">
          {(["beginner", "advanced"] as const).map((m) => (
            <Button key={m} variant={(beginner ? "beginner" : "advanced") === m ? "primary" : "outline"} onClick={() => setMode(m)}>
              {m === "beginner" ? "BEGINNER MODE" : "ADVANCED MODE"}
            </Button>
          ))}
        </div>
        <p className="mt-2 text-sm text-muted">
          Beginner: скрити сложни метрики, обяснения навсякъде, AI обяснява термините. Advanced: market structure, ATR, margin, expectancy, SQN,
          разширени backtest статистики.
        </p>
        <Button size="sm" variant="ghost" className="mt-2" onClick={() => run(() => put("/settings", { tour_done: false }), "Обиколката ще се покаже отново в Dashboard.")}>
          Покажи guided tour отново
        </Button>
      </Card>

      <Card title="Simulation realism (paper engine)">
        <div className="grid gap-2 sm:grid-cols-2">
          {EXEC.map(([k, label, hint]) => (
            <label key={k} className="flex items-center gap-2 rounded-md border border-line bg-panel2 px-3 py-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(exec[k])}
                onChange={(e) => run(() => patch("/paper/account", { execution: { [k]: e.target.checked } }), "Запазено.")}
              />
              {label}
              <InfoTip text={hint} />
            </label>
          ))}
          <Field label="Latency (ms)">
            <input
              className="input num"
              defaultValue={String(exec.latency_ms)}
              onBlur={(e) => run(() => patch("/paper/account", { execution: { latency_ms: Number(e.target.value) } }), "Запазено.")}
            />
          </Field>
          <Field label="Intrabar policy" hint="Когато SL и TP са в една свещ: worst_case приема, че първо е ударен стопът.">
            <select
              className="input"
              value={String(exec.intrabar_policy)}
              onChange={(e) => run(() => patch("/paper/account", { execution: { intrabar_policy: e.target.value } }), "Запазено.")}
            >
              <option value="worst_case">worst_case</option>
              <option value="path">path</option>
            </select>
          </Field>
        </div>
        <p className="mt-2 text-xs text-muted">Изключването на разходите прави симулацията нереалистично лесна — използвай го само за сравнение.</p>
      </Card>

      <Card title="Paper account">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Leverage (cap по клас актив)">
            <select className="input w-28" value={account.account.leverage} onChange={(e) => run(() => patch("/paper/account", { leverage: Number(e.target.value) }), "Leverage е обновен.")}>
              {[1, 2, 5, 10, 20, 30].map((l) => (
                <option key={l} value={l}>
                  {l}x
                </option>
              ))}
            </select>
          </Field>
          <Field label="Reset balance to">
            <input className="input num w-32" value={balance} onChange={(e) => setBalance(e.target.value)} />
          </Field>
          <Button
            variant="down"
            onClick={() => window.confirm("Да изтрия ли всички виртуални сделки и позиции и да започна отначало?") && run(() => post("/paper/reset", { balance: Number(balance) }), "Сметката е нулирана.")}
          >
            Reset paper account
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted">Реалният leverage на позиция = min(избрания, лимита за класа актив: crypto 2x, FX 20–30x, индекси 20x, акции 5x).</p>
      </Card>

      <Card title="Analysis">
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={data.settings.news_risk} onChange={(e) => run(() => put("/settings", { news_risk: e.target.checked }), "Запазено.")} />
          Предстои важна новина/събитие (NO-TRADE системата ще отчита News risk)
        </label>
        <Field label="Overtrading threshold (сделки на ден)">
          <input
            className="input num w-24"
            defaultValue={data.settings.max_trades_per_day}
            onBlur={(e) => run(() => put("/settings", { max_trades_per_day: Number(e.target.value) }), "Запазено.")}
          />
        </Field>
      </Card>

      <Card title="Data & AI providers">
        {health && (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap gap-2">
              <Badge tone="warn">execution: {health.execution_mode}</Badge>
              <Badge tone="down">live trading: {String(health.live_trading)}</Badge>
              <Badge tone="accent">AI: {health.ai_provider}</Badge>
              <Badge>celery: {String(health.celery)}</Badge>
            </div>
            <div className="text-xs text-muted">
              Market data: crypto={health.market_data.crypto}, fx={health.market_data.fx}, stocks/indices/commodities={health.market_data.stocks}
            </div>
            <ul className="max-h-48 overflow-y-auto text-xs">
              {(assets?.assets ?? []).map((a) => (
                <li key={a.symbol} className="flex justify-between border-b border-line py-0.5">
                  <span>{a.symbol}</span>
                  <span className="text-muted">{a.source.name}</span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted">
              Доставчиците се конфигурират в backend/.env (MARKET_DATA_CRYPTO=binance, TWELVEDATA_API_KEY, AI_PROVIDER=anthropic, ANTHROPIC_API_KEY). Ключовете
              никога не се пазят в базата и не стигат до браузъра.
            </p>
          </div>
        )}
      </Card>

      {user.is_guest && (
        <Card title="Запази профила (guest → акаунт)">
          <div className="grid gap-2 sm:grid-cols-3">
            <Field label="Име">
              <input className="input" value={claim.display_name} onChange={(e) => setClaim({ ...claim, display_name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" value={claim.email} onChange={(e) => setClaim({ ...claim, email: e.target.value })} />
            </Field>
            <Field label="Парола">
              <input className="input" type="password" value={claim.password} onChange={(e) => setClaim({ ...claim, password: e.target.value })} />
            </Field>
          </div>
          <Button className="mt-3" onClick={() => run(async () => { await post("/auth/claim", claim); await refresh(); }, "Профилът е запазен — целият прогрес остава.")}>
            Save account
          </Button>
        </Card>
      )}

      <Card title="Security">
        <ul className="space-y-1 text-sm text-muted">
          <li>• Платформата не съхранява private keys, seed phrases, платежни данни или API ключове с trading/withdrawal права.</li>
          <li>• Няма депозити, тегления и реални поръчки — всички действия са paper (симулация).</li>
          <li>• Сесията е HttpOnly cookie; паролите са хеширани (scrypt).</li>
        </ul>
        <Button variant="outline" className="mt-3" onClick={logout}>
          Изход
        </Button>
      </Card>
    </div>
  );
}
