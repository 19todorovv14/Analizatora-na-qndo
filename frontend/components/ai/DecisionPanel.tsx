"use client";

import { useState } from "react";

import { AiText, Badge, Button, InfoTip, RegimeBadge, WhyButton } from "@/components/ui";
import { cx } from "@/lib/format";
import type { Analysis } from "@/lib/types";

const DECISION_TONE: Record<string, string> = {
  "POSSIBLE LONG": "bg-up/15 text-up border-up/40",
  "POSSIBLE SHORT": "bg-down/15 text-down border-down/40",
  WAIT: "bg-warn/15 text-warn border-warn/40",
  "NO TRADE": "bg-panel3 text-text border-line",
};

export function DecisionPanel({
  analysis,
  panel,
  explanation,
  beginner,
}: {
  analysis: Analysis;
  panel: Record<string, string | number | null>;
  explanation?: { text: string; provider: string };
  beginner?: boolean;
}) {
  const [teach, setTeach] = useState(false);
  const rows: [string, string][] = [
    ["MARKET", "MARKET"],
    ["TIMEFRAME", "TIMEFRAME"],
    ["REGIME", "REGIME"],
    ["STRUCTURE", "STRUCTURE"],
    ["MOMENTUM", "MOMENTUM"],
    ["VOLATILITY", "VOLATILITY"],
    ["SUPPORT", "SUPPORT"],
    ["RESISTANCE", "RESISTANCE"],
    ["POSSIBLE SETUP", "POSSIBLE SETUP"],
    ["INVALIDATION", "INVALIDATION"],
    ["RISK", "RISK"],
    ["REWARD", "REWARD"],
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className={cx("rounded-md border px-4 py-2 text-lg font-extrabold tracking-wide", DECISION_TONE[analysis.decision] ?? "")}>
          DECISION: {analysis.decision}
        </span>
        <span className="flex items-center gap-1 rounded-md border border-line px-3 py-2 text-sm font-semibold">
          CONFIDENCE: {analysis.confidence}
          <InfoTip text={analysis.confidence_note} />
        </span>
        <Badge tone="info">signal: {analysis.signal}</Badge>
      </div>
      <p className="text-xs text-warn">Confidence НЕ означава вероятност за печалба. Това е образователен анализ, не сигнал за реални пари.</p>

      <div className="overflow-hidden rounded-md border border-line">
        <table className="w-full text-sm">
          <tbody>
            {rows.map(([label, key]) => (
              <tr key={key} className="border-b border-line last:border-0">
                <td className="w-40 bg-panel2 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-muted">{label}</td>
                <td className="px-3 py-1.5">
                  {key === "REGIME" ? <RegimeBadge regime={String(panel[key])} /> : <span className="text-text/90">{String(panel[key] ?? "—")}</span>}
                  {key === "REGIME" && <div className="mt-0.5 text-xs text-muted">{analysis.regime.reasons.join(" ")}</div>}
                  {key === "POSSIBLE SETUP" && analysis.setup?.reward_risk != null && (
                    <span className="ml-2 text-xs text-muted">R:R {analysis.setup.reward_risk}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {analysis.no_trade_reasons.length > 0 && (
        <div className="rounded-md border border-line p-3">
          <div className="mb-1.5 text-xs font-bold uppercase tracking-wider text-muted">No-trade / risk factors</div>
          <ul className="space-y-1 text-sm">
            {analysis.no_trade_reasons.map((r) => (
              <li key={r.code}>
                <Badge tone="down">{r.title}</Badge> <span className="text-text/90">{r.text}</span>
              </li>
            ))}
          </ul>
          <WhyButton>
            NO TRADE системата блокира setup-и при ниска ликвидност, екстремна волатилност, неясна структура, лош R:R,
            противоречиви сигнали, твърде голям спред или новинарски риск. Добрият trader не е постоянно в позиция.
          </WhyButton>
        </div>
      )}

      <div>
        <Button variant={teach ? "outline" : "primary"} onClick={() => setTeach((t) => !t)}>
          {teach ? "Скрий" : "🎓 Teach me why"}
        </Button>
        {teach && (
          <div className="fade-in mt-3 rounded-md border border-accent/40 bg-accent/5 p-4">
            <ol className="list-decimal space-y-1.5 pl-5 text-sm">
              {analysis.teach_me_why.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ol>
            <p className="mt-3 font-semibold">Conclusion: “{analysis.conclusion}”</p>
          </div>
        )}
      </div>

      <div className="rounded-md border border-line p-3">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted">Signal engine pipeline</div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          {analysis.pipeline.map((p, i) => (
            <span key={p.stage} className="flex items-center gap-1.5">
              <span className="rounded border border-line bg-panel2 px-2 py-1" title={p.detail}>
                <span className="font-semibold">{p.stage}</span>
                <span className="block max-w-44 truncate text-[10px] text-muted">{p.detail}</span>
              </span>
              {i < analysis.pipeline.length - 1 && <span className="text-muted">↓</span>}
            </span>
          ))}
        </div>
      </div>

      {explanation && (
        <div className="rounded-md border border-line p-3">
          <div className="mb-1 flex items-center gap-2 text-xs text-muted">
            Обяснение · provider: <Badge>{explanation.provider}</Badge>
          </div>
          <AiText text={explanation.text} />
        </div>
      )}
      {beginner && (
        <p className="text-xs text-muted">
          OBSERVATION = само факти от данните. ANALYSIS = тълкуване. HYPOTHESIS = възможен сценарий с ясна invalidation и алтернатива.
        </p>
      )}
      <p className="text-[11px] text-faint">{analysis.disclaimer}</p>
    </div>
  );
}
