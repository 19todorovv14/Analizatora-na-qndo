"use client";

/*
 * Leverage Academy theory: seven short sections, each with a small visual and worked numbers on the same example
 * ($10,000 virtual account, $2,000 stake). The numbers come from the shared model (the paper broker's rules:
 * margin = position / leverage, stop-out at 50 % of the used margin), never from hard-coded results.
 */
import { useMemo } from "react";

import { LEVERAGES, LEVERAGE_WARNING, crossLiqMovePct, isolatedLiqMovePct, leverageColor, pnlAtMove, signedPct, usd } from "@/components/labs/model";
import { Term } from "@/components/ui";
import { cx } from "@/lib/format";

const EQUITY = 10_000;
const STAKE = 2_000;
const MAINT = 0.5;
/** typical daily move used for the comparison (BTC/USDT's daily volatility in the platform's instrument spec) */
const DAILY_MOVE = 3;

export const THEORY_SECTIONS = [
  { id: "what-is-leverage", title: "Какво е leverage?" },
  { id: "what-is-margin", title: "Какво е margin?" },
  { id: "what-is-liquidation", title: "Какво е ликвидация?" },
  { id: "maintenance-margin", title: "Какво е maintenance margin?" },
  { id: "leverage-increases", title: "Какво става, когато leverage расте?" },
  { id: "not-a-better-strategy", title: "Защо leverage НЕ прави стратегията по-добра" },
  { id: "liquidation-risk", title: "Защо leverage увеличава риска от ликвидация" },
] as const;

function Section({ n, id, title, children, className }: { n: number; id: string; title: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section id={id} className={cx("card min-w-0 scroll-mt-20 p-4", className)} aria-labelledby={`${id}-h`}>
      <h3 id={`${id}-h`} className="flex items-start gap-2.5 text-[15px] font-semibold leading-snug text-text">
        <span className="num mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent/15 text-xs font-semibold text-accent2">{n}</span>
        <span className="min-w-0">{title}</span>
      </h3>
      <div className="mt-3 space-y-3 text-sm leading-relaxed text-muted">{children}</div>
    </section>
  );
}

function Bar({ label, value, pct, tone = "accent", note }: { label: React.ReactNode; value: string; pct: number; tone?: "accent" | "muted" | "down" | "up"; note?: string }) {
  const fill = { accent: "bg-accent/70", muted: "bg-white/[0.14]", down: "bg-down/80", up: "bg-up/60" }[tone];
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-xs">
        <span className="min-w-0 text-muted">{label}</span>
        <span className="num shrink-0 font-semibold text-text">{value}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-white/[0.05]">
        <div className={cx("h-full rounded-full", fill)} style={{ width: `${Math.max(1.5, Math.min(100, pct))}%` }} />
      </div>
      {note && <div className="mt-0.5 text-[11px] text-faint">{note}</div>}
    </div>
  );
}

function Worked({ children }: { children: React.ReactNode }) {
  return <div className="glass-inset num space-y-0.5 px-3 py-2 text-xs leading-relaxed text-text">{children}</div>;
}

export function LeverageTheory() {
  const n = useMemo(() => {
    const pos5 = STAKE * 5;
    const pos20 = STAKE * 20;
    return {
      pos5,
      pos20,
      move1: pnlAtMove(pos5, 1),
      cross20: crossLiqMovePct(EQUITY, pos20, 20, MAINT),
      iso20: isolatedLiqMovePct(20, MAINT),
      maint: STAKE * MAINT,
      marginLevel: (EQUITY / STAKE) * 100,
      ladder: [1, 5, 20, 100].map((l) => {
        const pos = STAKE * l;
        const pnl = pnlAtMove(pos, -1);
        return { l, pos, pnl, pctEq: (pnl / EQUITY) * 100, iso: isolatedLiqMovePct(l, MAINT) };
      }),
      dist: LEVERAGES.map((l) => ({ l, iso: isolatedLiqMovePct(l, MAINT) })),
    };
  }, []);

  const trades = [1.5, -1, -1, 1.5, -1, 1.5];
  const sumR = trades.reduce((a, b) => a + b, 0);
  const expectancy = sumR / trades.length;
  const rUnits = [
    { l: 1, perR: 20 },
    { l: 10, perR: 200 },
  ];
  // liquidation ladder: entry 100, isolated and cross liquidation for $2,000 margin at 20x
  const liqCross = 100 * (1 - (n.cross20 ?? 0) / 100);
  const liqIso = 100 * (1 - n.iso20 / 100);
  const scaleLo = 75;
  const at = (p: number) => ((p - scaleLo) / (100 - scaleLo)) * 100;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Section n={1} id={THEORY_SECTIONS[0].id} title={<><Term k="leverage">Leverage</Term> — колко пъти позицията е по-голяма от парите ти</>}>
        <p>
          Leverage 5x означава: с {usd(STAKE)} собствени пари държиш позиция от {usd(n.pos5)}. Пазарът не се интересува откъде са парите —
          P/L се смята върху цялата позиция.
        </p>
        <div className="space-y-2">
          <Bar label="Твоите пари (margin)" value={usd(STAKE)} pct={(STAKE / n.pos5) * 100} tone="muted" />
          <Bar label="Позицията при 5x" value={usd(n.pos5)} pct={100} />
        </div>
        <Worked>
          {usd(STAKE)} × 5 = {usd(n.pos5)} позиция
          <br />
          1% движение = {usd(n.move1)} = {((n.move1 / STAKE) * 100).toFixed(0)}% от margin-а
        </Worked>
      </Section>

      <Section n={2} id={THEORY_SECTIONS[1].id} title={<><Term k="margin">Margin</Term> — парите, които позицията блокира</>}>
        <p>
          Margin = позиция / leverage. Той не е такса — блокиран е, докато позицията е отворена. Останалото е <Term k="freemargin">free margin</Term>:
          от него се покриват загубите и се отварят нови позиции.
        </p>
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>Сметка {usd(EQUITY)}</span>
            <span className="num">позиция {usd(n.pos5)} при 5x</span>
          </div>
          <div className="flex h-7 overflow-hidden rounded-lg text-[11px] font-medium" role="img" aria-label={`Използван margin ${usd(STAKE)}, free margin ${usd(EQUITY - STAKE)}`}>
            <div className="flex items-center justify-center bg-accent/60 text-white" style={{ width: `${(STAKE / EQUITY) * 100}%` }}>
              margin
            </div>
            <div className="flex flex-1 items-center justify-center border-l-2 border-surface bg-white/[0.07] text-muted">free margin {usd(EQUITY - STAKE)}</div>
          </div>
        </div>
        <Worked>
          {usd(n.pos5)} / 5x = {usd(STAKE)} използван margin
          <br />
          {usd(EQUITY)} − {usd(STAKE)} = {usd(EQUITY - STAKE)} free margin
        </Worked>
      </Section>

      <Section n={3} id={THEORY_SECTIONS[2].id} title={<><Term k="liquidation">Ликвидация</Term> — принудително затваряне</>}>
        <p>
          Когато загубата изяде сметката до maintenance margin, брокерът затваря позицията сам. Загубата до този момент остава — ликвидацията не
          я връща, а я заключва.
        </p>
        <div className="pt-5">
          <div className="relative h-2 rounded-full bg-gradient-to-r from-down/50 via-warn/25 to-white/[0.08]">
            {[
              { p: 100, label: "вход 100", cls: "bg-text" },
              { p: liqIso, label: `isolated ${liqIso.toFixed(1)}`, cls: "bg-warn" },
              { p: liqCross, label: `cross ${liqCross.toFixed(1)}`, cls: "bg-down" },
            ].map((m, i) => (
              <div key={m.label} className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2" style={{ left: `${at(m.p)}%` }}>
                <span className={cx("block h-4 w-1 rounded-full ring-2 ring-surface", m.cls)} aria-hidden />
                <span
                  className={cx(
                    "num absolute whitespace-nowrap text-[10.5px] text-muted",
                    i === 1 ? "top-5" : "-top-5",
                    m.p >= 99 ? "right-0" : m.p <= scaleLo + 4 ? "left-0" : "left-1/2 -translate-x-1/2",
                  )}
                >
                  {m.label}
                </span>
              </div>
            ))}
          </div>
          <div className="h-5" />
        </div>
        <Worked>
          {usd(STAKE)} margin × 20x = {usd(n.pos20)} позиция (long, вход 100)
          <br />
          Isolated: само margin-ът стои зад нея → ликвидация при {signedPct(-n.iso20, 1)}
          <br />
          Cross: цялата сметка стои зад нея → ликвидация при {signedPct(-(n.cross20 ?? 0), 1)}, но тогава загубата е {usd(EQUITY - n.maint)}
        </Worked>
      </Section>

      <Section n={4} id={THEORY_SECTIONS[3].id} title={<><Term k="maintenance_margin">Maintenance margin</Term> — линията, под която позицията се затваря</>}>
        <p>
          Това е минималното equity, което трябва да остане зад позициите. В paper брокера е 50% от използвания margin (<Term k="stop_out">stop-out</Term>{" "}
          при margin level 50%).
        </p>
        <div>
          <div className="mb-1 flex justify-between text-xs text-muted">
            <span>
              <Term k="marginlevel">Margin level</Term> = equity / използван margin
            </span>
            <span className="num font-semibold text-text">{n.marginLevel.toFixed(0)}% сега</span>
          </div>
          <div className="relative h-3 overflow-hidden rounded-full bg-white/[0.05]">
            <div className="h-full rounded-full bg-up/50" style={{ width: "100%" }} />
            <div className="absolute inset-y-0 left-0 border-r-2 border-surface bg-down/80" style={{ width: `${(50 / n.marginLevel) * 100}%` }} />
          </div>
          <div className="num mt-1 flex justify-between text-[10.5px] text-faint">
            <span className="text-down">stop-out 50%</span>
            <span>{n.marginLevel.toFixed(0)}%</span>
          </div>
        </div>
        <Worked>
          Използван margin {usd(STAKE)} → maintenance {usd(n.maint)} (50%)
          <br />
          Позицията се затваря, когато equity падне до {usd(n.maint)}
        </Worked>
      </Section>

      <Section n={5} id={THEORY_SECTIONS[4].id} title="Какво става, когато leverage расте?">
        <p>
          Същите {usd(STAKE)} margin, по-голям leverage → по-голяма позиция. Едно и също движение от −1% струва все повече от сметката, а isolated
          ликвидацията се приближава.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[340px] text-right text-xs">
            <thead>
              <tr className="border-b border-white/[0.07] text-[10.5px] uppercase tracking-[0.06em] text-muted">
                <th scope="col" className="py-1.5 text-left font-medium">
                  Leverage
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  Позиция
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  P/L при −1%
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  % от сметката
                </th>
                <th scope="col" className="py-1.5 font-medium">
                  Isolated ликв.
                </th>
              </tr>
            </thead>
            <tbody className="num">
              {n.ladder.map((r) => (
                <tr key={r.l} className="border-b border-white/[0.04] last:border-0">
                  <th scope="row" className="py-1.5 text-left font-semibold text-text">
                    <span className="inline-flex items-center gap-1.5">
                      <span className="inline-block h-[2px] w-3 rounded-full" style={{ background: leverageColor(r.l) }} aria-hidden />
                      {r.l}x
                    </span>
                  </th>
                  <td className="py-1.5 text-text">{usd(r.pos)}</td>
                  <td className="py-1.5 text-down">{usd(r.pnl, true)}</td>
                  <td className="py-1.5 text-down">{signedPct(r.pctEq, 1)}</td>
                  <td className="py-1.5 text-muted">{signedPct(-r.iso, 1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <Section n={6} id={THEORY_SECTIONS[5].id} title="Защо leverage НЕ прави стратегията по-добра">
        <p>
          Leverage мащабира и печалбите, и загубите. <Term k="winrate">Win rate</Term>, <Term k="rr">R:R</Term> и <Term k="expectancy">expectancy</Term>{" "}
          в R остават същите — ако стратегията губи, leverage-ът я кара да губи по-бързо.
        </p>
        <div className="space-y-2">
          {rUnits.map((u) => (
            <div key={u.l} className="flex min-w-0 items-center gap-2">
              <span className="num w-9 shrink-0 text-xs font-semibold text-text">{u.l}x</span>
              <div className="flex min-w-0 flex-1 flex-wrap gap-1">
                {trades.map((r, i) => (
                  <span
                    key={i}
                    className={cx("num rounded px-1.5 py-0.5 text-[11px] font-medium", r > 0 ? "bg-up/15 text-up" : "bg-down/15 text-down")}
                    title={`${r > 0 ? "+" : ""}${r}R`}
                  >
                    {usd(r * u.perR, true)}
                  </span>
                ))}
              </div>
              <span className="num shrink-0 text-xs font-semibold text-up">{usd(sumR * u.perR, true)}</span>
            </div>
          ))}
        </div>
        <Worked>
          Едни и същи 6 сделки: {trades.map((r) => `${r > 0 ? "+" : ""}${r}R`).join(" ")} = {sumR > 0 ? "+" : ""}
          {sumR}R
          <br />
          Expectancy = {expectancy > 0 ? "+" : ""}
          {expectancy.toFixed(2)}R на сделка при 1x и при 10x — по-голям е само размахът в $
        </Worked>
      </Section>

      <Section n={7} id={THEORY_SECTIONS[6].id} title="Защо leverage увеличава риска от ликвидация" className="lg:col-span-2">
        <p>
          При isolated margin ликвидацията е на ≈ (1 − 50%) / leverage от входа. Сравни това разстояние с типично дневно движение от ~{DAILY_MOVE}% (напр.
          BTC): над 10x ликвидацията е по-близо от един нормален ден. При cross margin останалата сметка я отдалечава, но загубата я изяжда.
        </p>
        <div className="space-y-1.5">
          {n.dist.map((r) => {
            const width = Math.min(100, (r.iso / 10) * 100);
            const inside = r.iso < DAILY_MOVE;
            return (
              <div key={r.l} className="flex items-center gap-2.5">
                <span className="num w-10 shrink-0 text-right text-xs font-semibold text-text">{r.l}x</span>
                <div className="relative h-4 min-w-0 flex-1 rounded bg-white/[0.04]">
                  <div className={cx("h-full rounded", inside ? "bg-down/70" : "bg-accent/45")} style={{ width: `${Math.max(1.5, width)}%` }} />
                  <div className="absolute inset-y-[-3px] w-px bg-warn" style={{ left: `${(DAILY_MOVE / 10) * 100}%` }} aria-hidden />
                </div>
                <span className={cx("num w-24 shrink-0 text-xs", inside ? "font-semibold text-down" : "text-muted")}>
                  {r.iso >= 10 ? `≥10% (${r.iso.toFixed(0)}%)` : `${r.iso.toFixed(1)}%`}
                </span>
              </div>
            );
          })}
          <div className="flex items-center gap-2.5 text-[11px] text-faint">
            <span className="w-10 shrink-0" />
            <span className="min-w-0 flex-1">
              Скала 0–10% от входа · <span className="text-warn">│</span> типично дневно движение ~{DAILY_MOVE}% · <span className="text-down">червено</span> = по-близо от
              един ден
            </span>
            <span className="w-24 shrink-0" />
          </div>
        </div>
        <p className="font-medium text-warn">{LEVERAGE_WARNING}</p>
      </Section>
    </div>
  );
}
