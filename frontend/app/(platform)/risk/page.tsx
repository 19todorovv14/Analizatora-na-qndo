"use client";

import { useEffect, useState } from "react";
import useSWR from "swr";

import { PositionSizeCalculator } from "@/components/risk/PositionSizeCalculator";
import { Badge, Button, Card, ErrorText, Field, Loading, ProgressBar, Stat } from "@/components/ui";
import { errorMessage, fetcher, put } from "@/lib/api";
import { fmtMoney, fmtPct, fmtTime, pnlClass } from "@/lib/format";

type Rules = {
  max_risk_per_trade_pct: number;
  warn_risk_pct: number;
  max_daily_loss_pct: number;
  max_open_positions: number;
  max_portfolio_exposure_pct: number;
  min_reward_risk: number;
  require_stop_loss: boolean;
};
type Status = {
  status: string;
  rules: Rules;
  equity: number;
  day_pnl: number;
  day_loss_pct: number;
  daily_loss_limit_remaining: number;
  open_positions: number;
  exposure: number;
  exposure_pct: number;
  margin_level: number | null;
  max_drawdown_pct: number;
  recent_events: { ts: number; kind: string; severity: string; message: string }[];
};

const RULE_LABELS: [keyof Rules, string, string][] = [
  ["max_risk_per_trade_pct", "Max risk per trade %", "Над това получаваш предупреждение; ботовете не го надвишават."],
  ["warn_risk_pct", "'Unusually large' warning %", "Над това се показва силното предупреждение преди сделка."],
  ["max_daily_loss_pct", "Max daily loss %", "Дневен лимит — ботовете спират нови сделки до края на деня."],
  ["max_open_positions", "Max open positions", ""],
  ["max_portfolio_exposure_pct", "Max portfolio exposure %", "Обща стойност на позициите / equity."],
  ["min_reward_risk", "Min reward:risk", ""],
];

export default function RiskPage() {
  const { data: st, mutate } = useSWR<Status>("/risk/status", fetcher, { refreshInterval: 15000 });
  const [rules, setRules] = useState<Rules | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- initialise the editable copy once
    if (st && !rules) setRules(st.rules);
  }, [st, rules]);

  if (!st || !rules) return <Loading />;

  const save = async () => {
    setError(null);
    try {
      setRules(await put<Rules>("/risk/rules", rules));
      setMsg("Правилата са запазени.");
      mutate();
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Risk Management</h1>
      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <Card title="Position Size Calculator">
          <PositionSizeCalculator />
        </Card>
        <div className="space-y-4">
          <Card title="Risk status" right={<Badge tone={st.status === "OK" ? "up" : st.status === "WARNING" ? "warn" : "down"}>{st.status}</Badge>}>
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Equity" term="equity" value={fmtMoney(st.equity)} />
              <Stat label="Day P/L" value={fmtMoney(st.day_pnl, true)} tone={pnlClass(st.day_pnl)} />
              <Stat label="Open positions" value={`${st.open_positions}/${st.rules.max_open_positions}`} />
              <Stat label="Exposure" term="exposure" value={fmtPct(st.exposure_pct, 0)} />
              <Stat label="Max drawdown" term="drawdown" value={fmtPct(st.max_drawdown_pct)} />
              <Stat label="Margin level" term="marginlevel" value={st.margin_level ? fmtPct(st.margin_level * 100, 0) : "—"} />
            </div>
            <div className="mt-3">
              <div className="flex justify-between text-xs text-muted">
                <span>Daily loss vs limit</span>
                <span className="num">
                  {fmtPct(st.day_loss_pct, 2)} / {st.rules.max_daily_loss_pct}%
                </span>
              </div>
              <ProgressBar value={(st.day_loss_pct / st.rules.max_daily_loss_pct) * 100} tone={st.day_loss_pct > st.rules.max_daily_loss_pct * 0.7 ? "warn" : "up"} />
              <p className="mt-1 text-xs text-muted">Остава до дневния лимит: {fmtMoney(st.daily_loss_limit_remaining)}</p>
            </div>
          </Card>
          <Card title="Risk rules">
            <div className="space-y-2">
              {RULE_LABELS.map(([k, label, hint]) => (
                <Field key={k} label={label} hint={hint || undefined}>
                  <input className="input num" value={String(rules[k])} onChange={(e) => setRules({ ...rules, [k]: Number(e.target.value) })} />
                </Field>
              ))}
              <ErrorText error={error} />
              {msg && <p className="text-xs text-up">{msg}</p>}
              <Button onClick={save}>Save rules</Button>
            </div>
          </Card>
        </div>
      </div>
      <Card title="Risk events">
        {st.recent_events.length ? (
          <ul className="space-y-1 text-sm">
            {st.recent_events.map((e, i) => (
              <li key={i} className="flex gap-2 border-b border-line py-1">
                <span className="w-28 shrink-0 text-xs text-muted">{fmtTime(e.ts)}</span>
                <Badge tone={e.severity === "high" ? "down" : "warn"}>{e.kind}</Badge>
                <span className="text-text/90">{e.message}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">Няма нарушения на правилата. 👍</p>
        )}
      </Card>
    </div>
  );
}
