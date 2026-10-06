"use client";

import { useEffect, useMemo, useState } from "react";
import useSWR from "swr";

import { ChatPanel } from "@/components/ai/ChatPanel";
import { DecisionPanel } from "@/components/ai/DecisionPanel";
import { SymbolPicker, TimeframeBar } from "@/components/charts/ChartControls";
import TradingChart, { type PriceLineDef } from "@/components/charts/TradingChart";
import { Badge, Button, Card, ErrorText, Loading } from "@/components/ui";
import { errorMessage, fetcher, post } from "@/lib/api";
import { useCandles, useLocalState } from "@/lib/hooks";
import { buildIndicatorSeries } from "@/lib/indicators";
import { useSession } from "@/lib/session";
import type { Analysis, Strategy } from "@/lib/types";

type AnalyzeResponse = { analysis: Analysis; panel: Record<string, string | number | null>; explanation?: { text: string; provider: string } };

export default function AiTeacherPage() {
  const { beginner } = useSession();
  const [symbol, setSymbol] = useLocalState("ta-ai-symbol", "BTC/USDT");
  const [tf, setTf] = useLocalState("ta-ai-tf", "1h");
  const [strategyId, setStrategyId] = useState<number | "">("");
  const [res, setRes] = useState<AnalyzeResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [question, setQuestion] = useState<string | null>(null);
  const { data: strategies } = useSWR<{ strategies: Strategy[] }>("/strategies", fetcher);
  const keys = useMemo(() => ["ema20", "ema50", "ema200"], []);
  const { data: candles } = useCandles(symbol, tf, keys, 300);
  const { data: status } = useSWR<{ active: string; model: string | null; note: string }>("/ai/status", fetcher);

  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("symbol")) setSymbol(p.get("symbol")!);
    if (p.get("tf")) setTf(p.get("tf")!);
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read the optional ?q= prefill once
    if (p.get("q")) setQuestion(p.get("q"));
  }, [setSymbol, setTf]);

  const analyze = async () => {
    setBusy(true);
    setError(null);
    try {
      setRes(await post<AnalyzeResponse>("/ai/analyze", { symbol, timeframe: tf, strategy_id: strategyId || undefined }));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the stale analysis when the market changes
    setRes(null);
  }, [symbol, tf]);

  const { overlays } = useMemo(() => buildIndicatorSeries(candles, keys), [candles, keys]);
  const lines = useMemo<PriceLineDef[]>(() => {
    if (!res) return [];
    const a = res.analysis;
    const out: PriceLineDef[] = [
      ...a.support.map((s, i) => ({ id: `s${i}`, price: s.price, color: "#26a69a", title: "Support", dashed: true })),
      ...a.resistance.map((r, i) => ({ id: `r${i}`, price: r.price, color: "#ef5350", title: "Resistance", dashed: true })),
    ];
    if (a.setup) {
      out.push({ id: "inv", price: a.setup.invalidation, color: "#f5a623", title: "Invalidation" });
      out.push({ id: "tgt", price: a.setup.target, color: "#42a5f5", title: "Target" });
    }
    return out;
  }, [res]);

  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_420px]">
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-2 text-lg font-bold">AI Teacher</h1>
          <SymbolPicker value={symbol} onChange={setSymbol} />
          <TimeframeBar value={tf} onChange={setTf} />
          <select className="input w-auto" value={strategyId} onChange={(e) => setStrategyId(e.target.value ? Number(e.target.value) : "")}>
            <option value="">Без стратегия (общ анализ)</option>
            {(strategies?.strategies ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.is_template ? "📋 " : ""}
                {s.name}
              </option>
            ))}
          </select>
          <Button onClick={analyze} disabled={busy}>
            {busy ? "Анализирам…" : "Analyze chart"}
          </Button>
          {status && <Badge tone={status.active === "offline" ? "neutral" : "accent"}>AI: {status.active}</Badge>}
        </div>
        <Card bodyClass="p-2">
          <TradingChart candles={candles?.candles ?? []} precision={candles?.precision ?? 2} height={360} overlays={overlays} priceLines={lines} fitKey={symbol + tf} />
        </Card>
        <ErrorText error={error} />
        {busy && !res && <Loading text="Signal engine: indicators → structure → regime → rules → risk…" />}
        {res ? (
          <Card title="Trade decision panel">
            <DecisionPanel analysis={res.analysis} panel={res.panel} explanation={res.explanation} beginner={beginner} />
          </Card>
        ) : (
          !busy && (
            <Card>
              <p className="text-sm text-muted">
                Натисни <b>Analyze chart</b>. Engine-ът изчислява индикатори, пазарна структура (HH/HL/LH/LL), режим, support/resistance,
                проверява NO-TRADE условията и показва решение WAIT / POSSIBLE LONG / POSSIBLE SHORT / NO TRADE — с обяснение защо.
              </p>
            </Card>
          )
        )}
      </div>
      <Card title="Ask the AI Teacher" className="h-fit">
        <ChatPanel symbol={symbol} timeframe={tf} initialQuestion={question} />
        {status && <p className="mt-2 text-[11px] text-faint">{status.note}</p>}
      </Card>
    </div>
  );
}
