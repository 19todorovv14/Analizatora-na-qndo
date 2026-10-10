"use client";

import { ArrowRight, Calculator, Gauge, ShieldCheck } from "lucide-react";
import Link from "next/link";
import useSWR from "swr";

import { ExposureBreakdown, RiskEvents, RiskRulesEditor, RiskStatusBadge, RiskStatusSummary } from "@/components/analytics/RiskPanels";
import type { RiskStatus } from "@/components/analytics/types";
import { linkButton } from "@/components/learn/linkButton";
import { PositionSizeCalculator } from "@/components/risk/PositionSizeCalculator";
import { Badge, Card, ErrorState, PageHeader, SkeletonText } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { fmtMoney } from "@/lib/format";
import { LearnHint } from "@/lib/workspace";

export default function RiskPage() {
  const { data: st, error, mutate } = useSWR<RiskStatus>("/risk/status", fetcher, { refreshInterval: 15000 });

  return (
    <div className="space-y-5">
      <PageHeader
        icon={ShieldCheck}
        title="Risk Management"
        subtitle="Колко рискуваш на сделка, колко от сметката е изложено и кои правила пазят виртуалния ти капитал."
        actions={
          <>
            <Link href="/learn/leverage" className={linkButton("outline", "sm")}>
              <Gauge size={13} strokeWidth={2.25} aria-hidden /> Leverage lab
            </Link>
            <Link href="/trade" className={linkButton("outline", "sm")}>
              Paper Trading <ArrowRight size={13} strokeWidth={2.25} aria-hidden />
            </Link>
          </>
        }
      />

      <LearnHint title="Правилото на 1%">
        Професионалистите рискуват малък, фиксиран процент от сметката на сделка (обикновено 0.5–1%). Така серия от 10 загуби оставя ~90% от
        капитала. Размерът на позицията се изчислява от разстоянието до stop loss-а — не от това колко „сигурен“ се чувстваш.
      </LearnHint>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <Card
          title={
            <>
              <Calculator size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Position Size Calculator
            </>
          }
          right={st && <span className="num text-[11px] text-faint">equity {fmtMoney(st.equity)}</span>}
        >
          <PositionSizeCalculator defaults={{ balance: st?.equity, risk_pct: st?.rules.max_risk_per_trade_pct }} />
        </Card>

        <div className="space-y-4">
          <Card title="Risk status" right={st && <RiskStatusBadge status={st.status} />}>
            {st ? (
              <RiskStatusSummary st={st} />
            ) : error ? (
              <ErrorState title="Риск статусът не се зареди" onRetry={() => void mutate()} className="py-6" />
            ) : (
              <SkeletonText lines={6} />
            )}
          </Card>
          <Card title="Exposure" right={st && <Badge tone="info">{st.open_positions} позиции</Badge>}>
            {st ? <ExposureBreakdown st={st} /> : <SkeletonText lines={3} />}
          </Card>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Risk rules">
          {st ? <RiskRulesEditor rules={st.rules} onSaved={() => void mutate()} /> : <SkeletonText lines={6} />}
        </Card>
        <Card title="Risk events" right={st && st.recent_events.length > 0 && <Badge tone="warn">{st.recent_events.length}</Badge>}>
          {st ? <RiskEvents events={st.recent_events} /> : <SkeletonText lines={4} />}
        </Card>
      </div>
    </div>
  );
}
