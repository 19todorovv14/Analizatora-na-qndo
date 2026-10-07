"use client";

import { Activity, RefreshCw } from "lucide-react";
import { useState } from "react";

import { unavailableReason } from "@/components/backtest/format";
import { REGIME_LABEL } from "@/components/strategy/meta";
import { BLOCK_TITLE, activeBlocks, conditionPass, conditionValueText, passedCount, signalTone } from "@/components/strategy/signal";
import { SETUP_DISCLAIMER, type ConditionResult, type DefinitionV2, type SignalResponse } from "@/components/strategy/types";
import { Badge, Button, Checklist, DataNotAvailable, Disclaimer, ErrorText, Meter, RegimeBadge, Spinner } from "@/components/ui";
import { ApiError, errorMessage, post } from "@/lib/api";
import { cx, fmtTime, TF_LABEL } from "@/lib/format";

export { BLOCK_TITLE, activeBlocks, signalTone } from "@/components/strategy/signal";

/** Per-condition ✓ / ✕ list for one evaluated block. */
export function ConditionChecklist({ title, conditions, passed, logic, compact }: { title: string; conditions: ConditionResult[]; passed?: boolean; logic?: "all" | "any"; compact?: boolean }) {
  const { passed: n } = passedCount(conditions);
  return (
    <div className="min-w-0">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[12px] font-semibold text-text">{title}</span>
        {logic && <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-faint">{logic === "all" ? "AND" : "OR"}</span>}
        <span className="num ml-auto text-[11px] text-muted">
          {n}/{conditions.length}
        </span>
        {passed !== undefined && <Badge tone={passed ? "up" : "neutral"}>{passed ? "met" : "not met"}</Badge>}
      </div>
      {!compact && <Meter value={n} max={Math.max(1, conditions.length)} tone={passed ? "up" : "accent"} className="mb-2.5" />}
      <Checklist
        items={conditions.map((c) => ({
          label: <span className="text-[12.5px] font-medium">{c.label}</span>,
          pass: conditionPass(c),
          detail: <span className="num text-[11px]">{conditionValueText(c)}</span>,
        }))}
      />
    </div>
  );
}

/**
 * "Check current signal" for the (possibly unsaved) builder definition: POST /strategies/check evaluates it on
 * the latest CLOSED candle and returns the per-condition checklist.
 */
export function SignalCheck({ definition, symbol, timeframe, disabled }: { definition: DefinitionV2; symbol: string; timeframe: string; disabled?: boolean }) {
  const [res, setRes] = useState<{ key: string; data: SignalResponse } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unavailable, setUnavailable] = useState<string | null>(null);
  const key = JSON.stringify([definition, symbol, timeframe]);
  const stale = !!res && res.key !== key;

  const run = async () => {
    setBusy(true);
    setError(null);
    setUnavailable(null);
    try {
      const data = await post<SignalResponse>("/strategies/check", { definition, symbol, timeframe });
      setRes({ key, data });
    } catch (e) {
      if (e instanceof ApiError && e.status === 503) setUnavailable(e.message);
      else setError(errorMessage(e));
      setRes(null);
    } finally {
      setBusy(false);
    }
  };

  const data = res?.data;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={run} disabled={busy || disabled}>
          {busy ? <Spinner className="h-3.5 w-3.5" /> : stale ? <RefreshCw size={14} strokeWidth={2} aria-hidden /> : <Activity size={14} strokeWidth={2} aria-hidden />}
          Check current signal
        </Button>
        <span className="num text-[11px] text-muted">
          {symbol} · {TF_LABEL[timeframe] ?? timeframe}
        </span>
      </div>
      <ErrorText error={error} />
      {unavailable && <DataNotAvailable compact reason={unavailableReason(unavailable)} />}
      {data && (
        <div className={cx("fade-in space-y-3 rounded-xl border border-white/[0.07] bg-black/20 p-3", stale && "opacity-60")}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={signalTone(data.signal)} className="!px-2 !py-1 !text-xs">
              {data.signal}
            </Badge>
            {data.time && <span className="text-[11px] text-muted">затворена свещ {fmtTime(data.time)}</span>}
          </div>
          {data.regime && (
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted">
              Режим: <RegimeBadge regime={data.regime.regime} />
              <span className="text-faint">{REGIME_LABEL[data.regime.regime] ?? ""}</span>
              {data.regime_allowed === false && <Badge tone="warn">блокиран от regime filter</Badge>}
              {data.regime_allowed === true && <Badge tone="up">разрешен от filter</Badge>}
            </div>
          )}
          {stale && <p className="text-[11px] text-warn">Правилата / пазарът са променени — провери отново.</p>}
          <div className="space-y-4">
            {activeBlocks(data.evaluation).map(([k, b]) => (
              <ConditionChecklist key={k} title={BLOCK_TITLE[k] ?? k} conditions={b.conditions} passed={b.passed} logic={b.logic} />
            ))}
          </div>
          <Disclaimer>{data.disclaimer ?? SETUP_DISCLAIMER}</Disclaimer>
        </div>
      )}
    </div>
  );
}
