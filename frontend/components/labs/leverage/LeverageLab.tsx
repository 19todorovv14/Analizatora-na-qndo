"use client";

/*
 * /learn/leverage — LEVERAGE ACADEMY: the interactive LeverageSimulator ($10,000 virtual account), the guided
 * "$2,000 at 1x → 5x → 20x" walkthrough and seven short theory sections with worked numbers. Explains risk —
 * never recommends a leverage value.
 */
import { BookOpen, Calculator, GraduationCap, Scale } from "lucide-react";
import Link from "next/link";

import { LeverageTheory, THEORY_SECTIONS } from "@/components/labs/leverage/LeverageTheory";
import { LeverageWalkthrough } from "@/components/labs/leverage/LeverageWalkthrough";
import { LEVERAGE_WARNING } from "@/components/labs/model";
import { LeverageSimulator } from "@/components/risk/LeverageSimulator";
import { Disclaimer, Notice, PageHeader } from "@/components/ui";
import { LearnHint } from "@/lib/workspace";

const linkCls =
  "inline-flex min-h-9 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-sm font-medium text-text transition-colors hover:border-white/[0.18] hover:bg-white/[0.07]";

export function LeverageLab() {
  return (
    <div className="space-y-5">
      <PageHeader
        icon={Scale}
        title="Leverage Academy"
        subtitle="Как leverage променя размера на позицията, margin-а, P/L и ликвидацията — с виртуална сметка от $10,000. Целта е да разбереш риска, не да използваш leverage."
        actions={
          <>
            <Link href="/learn/leverage-basics" className={linkCls}>
              <BookOpen size={15} aria-hidden /> Урок: Leverage
            </Link>
            <Link href="/simulator" className={linkCls}>
              <Calculator size={15} aria-hidden /> Trade Simulator
            </Link>
            <Link href="/learn" className={linkCls}>
              <GraduationCap size={15} aria-hidden /> Academy
            </Link>
          </>
        }
      />

      <Notice tone="warn" title={LEVERAGE_WARNING}>
        Тук няма препоръчан leverage — всеки бутон е само пример за сметката. Всичко е симулация с виртуални пари.
      </Notice>

      <nav aria-label="Теми" className="flex flex-wrap gap-1.5">
        {THEORY_SECTIONS.map((s, i) => (
          <a
            key={s.id}
            href={`#${s.id}`}
            className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.08] bg-white/[0.03] px-2.5 py-1 text-xs text-muted transition-colors hover:border-white/[0.16] hover:text-text"
          >
            <span className="num text-[10px] font-semibold text-accent2">{i + 1}</span> {s.title}
          </a>
        ))}
      </nav>

      <LearnHint title="Как да използваш симулатора">
        Избери leverage, въведи размер на позицията (или margin) и плъзни движението на цената. Сравни линиите на графиката: при същия margin по-голям
        leverage дава по-стръмна линия — и печалбата, и загубата растат, а ликвидацията се приближава.
      </LearnHint>

      <LeverageSimulator />

      <LeverageWalkthrough />

      <div className="space-y-3">
        <h2 className="text-base font-semibold text-text">7 въпроса за leverage</h2>
        <LeverageTheory />
      </div>

      <Disclaimer>
        Образователна симулация с виртуални пари по правилата на paper брокера (cross margin, stop-out при 50% margin level). Не е съвет за търговия и не
        препоръчва leverage. {LEVERAGE_WARNING}
      </Disclaimer>
    </div>
  );
}
