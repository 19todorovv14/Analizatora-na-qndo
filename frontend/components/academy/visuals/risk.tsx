"use client";

/*
 * Risk visuals: drawdown & recovery (default / leverage / correlation focus), expectancy Monte-Carlo
 * (seeded, synthetic paths — labelled as a simulation) and the position-size calculator wrapper.
 */
import { Dices, Link2, Unlink2 } from "lucide-react";
import { useMemo, useState } from "react";

import { LEVERAGE_WARNING } from "@/components/academy/visuals/leverage";
import { Caption, Readout, ReadoutPanel, SliderField, useElementWidth } from "@/components/academy/visuals/shared";
import { PositionSizeCalculator } from "@/components/risk/PositionSizeCalculator";
import { Badge, Button, Notice, Segmented, Term } from "@/components/ui";
import { cx } from "@/lib/format";
import { PALETTE, withAlpha } from "@/lib/theme";

/* ───────────────────────────────────────────────────── drawdown */

export function DrawdownVisual({ focus }: { focus: string }) {
  if (focus === "leverage") return <LeverageDrawdown />;
  if (focus === "correlation") return <CorrelationRisk />;
  return <LossStreaks />;
}

function LossBar({ left }: { left: number }) {
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-down/25">
      <div className="h-full rounded-full bg-gradient-to-r from-up/70 to-up transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(100, left))}%` }} />
    </div>
  );
}

function LossStreaks() {
  const [risk, setRisk] = useState(2);
  const rows = [3, 5, 10, 20].map((n) => {
    const left = Math.pow(1 - risk / 100, n) * 100;
    return { n, left, need: (100 / left - 1) * 100 };
  });
  return (
    <div className="space-y-3">
      <SliderField label="Риск на сделка" term="risk_per_trade" value={risk} display={`${risk}%`} min={0.25} max={20} step={0.25} onChange={setRisk} />
      <div className="glass-inset space-y-2.5 p-3">
        {rows.map((r) => (
          <div key={r.n}>
            <div className="mb-1 flex flex-wrap justify-between gap-x-3 text-xs">
              <span className="text-text/90">{r.n} поредни загуби</span>
              <span className="num text-muted">
                остава <span className="text-text">{r.left.toFixed(1)}%</span> · за възстановяване{" "}
                <span className={cx(r.need > 50 ? "text-down" : "text-warn")}>+{r.need.toFixed(0)}%</span>
              </span>
            </div>
            <LossBar left={r.left} />
          </div>
        ))}
      </div>
      <Caption>
        Загубите се възстановяват асиметрично: −50% изисква +100%. Затова малкият риск на сделка е основата на всяка <Term k="drawdown">drawdown</Term> защита.
      </Caption>
    </div>
  );
}

function LeverageDrawdown() {
  const [base, setBase] = useState(1);
  const mults = [1, 2, 5, 10];
  return (
    <div className="space-y-3">
      <SliderField label="Риск на сделка при експозиция 1x" term="risk_per_trade" value={base} display={`${base}%`} min={0.25} max={3} step={0.25} onChange={setBase} />
      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-[0.06em] text-muted">
              <th className="py-1.5 pr-3 font-medium">Експозиция</th>
              <th className="pr-3 font-medium">Риск / сделка</th>
              <th className="pr-3 font-medium">
                <Term k="expectancy">Expectancy</Term>
              </th>
              <th className="pr-3 font-medium">След 10 загуби</th>
              <th className="font-medium">За възстановяване</th>
            </tr>
          </thead>
          <tbody>
            {mults.map((m) => {
              const r = Math.min(99, base * m);
              const left = Math.pow(1 - r / 100, 10) * 100;
              const need = (100 / left - 1) * 100;
              return (
                <tr key={m} className="border-t border-white/[0.06]">
                  <td className="num py-2 pr-3 font-semibold text-text">{m}x</td>
                  <td className="num py-2 pr-3 text-text/85">{r.toFixed(2)}%</td>
                  <td className="py-2 pr-3 text-muted">същата в R</td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="w-20 shrink-0">
                        <LossBar left={left} />
                      </span>
                      <span className="num text-text/85">{left.toFixed(1)}%</span>
                    </div>
                  </td>
                  <td className={cx("num py-2", need > 50 ? "text-down" : "text-warn")}>+{need.toFixed(0)}%</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Caption>
        Едни и същи сделки, една и съща стратегия: средният резултат в R не се променя, но всяка серия от загуби удря сметката по-силно. {LEVERAGE_WARNING}
      </Caption>
    </div>
  );
}

function CorrelationRisk() {
  const [n, setN] = useState(3);
  const [risk, setRisk] = useState(1);
  const [mode, setMode] = useState<"correlated" | "independent">("correlated");
  const together = n * risk;
  const allLoseIndependent = Math.pow(0.5, n) * 100;
  return (
    <div className="space-y-3">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="min-w-0 space-y-3">
          <SliderField label="Брой отворени позиции" value={n} min={1} max={6} onChange={setN} />
          <SliderField label="Риск на всяка позиция" term="risk_per_trade" value={risk} display={`${risk}%`} min={0.25} max={3} step={0.25} onChange={setRisk} />
          <Segmented
            options={[
              { value: "correlated", label: <><Link2 size={12} strokeWidth={2} aria-hidden /> Силно корелирани</> },
              { value: "independent", label: <><Unlink2 size={12} strokeWidth={2} aria-hidden /> Независими</> },
            ]}
            value={mode}
            onChange={setMode}
            ariaLabel="Корелация"
          />
        </div>
        <div className="min-w-0 space-y-2">
          <div className="glass-inset p-3">
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted">Позиции</div>
            <div className="flex flex-wrap gap-1.5">
              {Array.from({ length: n }, (_, i) => (
                <span
                  key={i}
                  className={cx(
                    "num rounded-md px-2 py-1 text-xs ring-1 ring-inset",
                    mode === "correlated" ? "bg-down/10 text-down ring-down/25" : i % 2 ? "bg-up/10 text-up ring-up/25" : "bg-down/10 text-down ring-down/25",
                  )}
                >
                  #{i + 1} −{risk}%
                </span>
              ))}
            </div>
          </div>
          <ReadoutPanel>
            <Readout label="Обща експозиция към един сценарий" term="exposure" value={mode === "correlated" ? `−${together.toFixed(2)}%` : `−${risk.toFixed(2)}% … −${together.toFixed(2)}%`} tone="down" strong focus />
            <Readout
              label="Шанс всички да загубят наведнъж"
              value={mode === "correlated" ? "почти колкото за една" : `${allLoseIndependent.toFixed(1)}% (при 50/50)`}
              tone={mode === "correlated" ? "down" : "muted"}
            />
          </ReadoutPanel>
        </div>
      </div>
      <Caption>
        {n} позиции по {risk}% в силно корелирани активи (напр. няколко crypto или няколко tech акции) се държат като ЕДНА позиция с риск {together.toFixed(1)}%.
        Сумирай риска по сценарий, не по сделка.
      </Caption>
    </div>
  );
}

/* ───────────────────────────────────────────────────── expectancy */

function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function ExpectancySim({ focus }: { focus: string }) {
  const [wr, setWr] = useState(40);
  const [rr, setRr] = useState(2);
  const [seed, setSeed] = useState(1);
  const [wrapRef, width] = useElementWidth<HTMLDivElement>(560);
  const exp = (wr / 100) * rr - (1 - wr / 100);
  const N = 100;
  const paths = useMemo(() => {
    const out: number[][] = [];
    for (let k = 0; k < 15; k++) {
      const rand = mulberry32(seed * 100 + k);
      let eq = 0;
      const p = [0];
      for (let i = 0; i < N; i++) {
        eq += rand() < wr / 100 ? rr : -1;
        p.push(eq);
      }
      out.push(p);
    }
    return out;
  }, [wr, rr, seed]);
  const finals = paths.map((p) => p[p.length - 1]).sort((a, b) => a - b);
  const maxDD = (p: number[]) => {
    let peak = -Infinity;
    let dd = 0;
    for (const v of p) {
      peak = Math.max(peak, v);
      dd = Math.max(dd, peak - v);
    }
    return dd;
  };
  const worstDD = Math.max(...paths.map(maxDD));
  const all = paths.flat();
  const min = Math.min(...all, -10);
  const max = Math.max(...all, 10);
  const W = Math.max(260, width);
  const H = 210;
  const padL = 34;
  const y = (v: number) => 10 + ((max - v) / (max - min)) * (H - 28);
  const x = (i: number) => padL + (i / N) * (W - padL - 8);
  const ticks = [min, 0, max].map((v) => Math.round(v));
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <SliderField label="Win rate" term="winrate" value={wr} display={`${wr}%`} min={10} max={90} onChange={setWr} />
        <SliderField label="Reward : Risk" term="rr" value={rr} display={rr.toFixed(2)} min={0.5} max={5} step={0.25} onChange={setRr} />
      </div>
      <div className="text-sm text-text/90">
        <Term k="expectancy">Expectancy</Term> = {wr}% × {rr}R − {100 - wr}% × 1R ={" "}
        <span className={cx("num font-semibold", exp > 0 ? "text-up" : "text-down")}>
          {exp > 0 ? "+" : ""}
          {exp.toFixed(2)}R на сделка
        </span>{" "}
        <span className="text-muted">(преди разходите)</span>
      </div>
      <div ref={wrapRef} className="glass-inset overflow-hidden">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block" role="img" aria-label="15 симулирани equity криви по 100 сделки">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={padL} x2={W - 8} y1={y(t)} y2={y(t)} stroke={t === 0 ? withAlpha(PALETTE.muted, 0.5) : PALETTE.line} strokeDasharray={t === 0 ? "4 4" : "2 5"} />
              <text x={padL - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10} fill={PALETTE.faint} style={{ fontFamily: "var(--font-mono)" }}>
                {t > 0 ? "+" : ""}
                {t}R
              </text>
            </g>
          ))}
          {paths.map((p, k) => (
            <polyline
              key={k}
              fill="none"
              stroke={p[p.length - 1] >= 0 ? withAlpha(PALETTE.up, 0.6) : withAlpha(PALETTE.down, 0.6)}
              strokeWidth={1.3}
              strokeLinejoin="round"
              points={p.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ")}
            />
          ))}
          <text x={W - 10} y={H - 6} textAnchor="end" fontSize={10} fill={PALETTE.faint}>
            100 сделки →
          </text>
        </svg>
      </div>
      {focus === "equity" && (
        <ReadoutPanel title="15 криви, една и съща система">
          <Readout label="Най-добър краен резултат" value={`${finals[finals.length - 1] > 0 ? "+" : ""}${finals[finals.length - 1].toFixed(0)}R`} tone="up" />
          <Readout label="Медиана" value={`${finals[7] > 0 ? "+" : ""}${finals[7].toFixed(0)}R`} />
          <Readout label="Най-лош краен резултат" value={`${finals[0] > 0 ? "+" : ""}${finals[0].toFixed(0)}R`} tone="down" />
          <Readout label="Най-дълбок drawdown по пътя" term="drawdown" value={`−${worstDD.toFixed(0)}R`} tone="down" focus />
        </ReadoutPanel>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" type="button" onClick={() => setSeed((s) => s + 1)}>
          <Dices size={13} strokeWidth={2} aria-hidden /> Нова симулация
        </Button>
        <Badge tone="warn">simulation</Badge>
        <span className="text-xs text-muted">15 трейдъри × 100 сделки с ЕДНАКВА система — разликите са случайност, не умение.</span>
      </div>
    </div>
  );
}

/* ───────────────────────────────────────────────────── risk calculator */

export function RiskCalcVisual({ focus }: { focus: string }) {
  return (
    <div className="space-y-3">
      {focus === "leverage" && (
        <Notice tone="info" title="Leverage е детайл на margin-а, не регулатор на риска">
          Рискът се определя от разстоянието до stop loss-а и размера на позицията. Смени leverage-а в калкулатора: размерът на позицията и рискът в $ остават
          същите — променя се само блокираният margin. {LEVERAGE_WARNING}
        </Notice>
      )}
      {focus === "rules" && (
        <Notice tone="info" title="Правила преди сделката">
          Максимален риск на сделка (напр. 1% от сметката) и минимален R:R се проверяват ПРЕДИ входа. Ако сделката не минава правилата — няма сделка.
        </Notice>
      )}
      <PositionSizeCalculator compact />
    </div>
  );
}
