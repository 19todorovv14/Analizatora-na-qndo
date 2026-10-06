"use client";

import {
  ArrowRight,
  Blocks,
  BookOpen,
  ChartCandlestick,
  CircleCheck,
  FlaskConical,
  NotebookPen,
  Rewind,
  ShieldCheck,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Brand } from "@/components/shell/Brand";
import { Button, Disclaimer, ErrorText } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { startGuest, useSession } from "@/lib/session";

const FEATURES: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: BookOpen, title: "Interactive lessons", text: "От 'какво е пазар' до market structure, индикатори, риск и психология — с анимирани графики и quizzes." },
  { icon: ChartCandlestick, title: "Realistic charts", text: "TradingView-подобен терминал: свещи, timeframes от 1m до 1W, индикатори и инструменти за чертане." },
  { icon: FlaskConical, title: "Paper trading", text: "$10,000 виртуален баланс. Спред, такси, slippage, latency, partial fills и ликвидация — като истински пазар." },
  { icon: Sparkles, title: "AI explanations", text: "AI Teacher обяснява ЗАЩО: observation → analysis → hypothesis, invalidation и риск. Никога 'купи сега'." },
  { icon: Blocks, title: "Strategy testing", text: "Визуален Strategy Builder, backtesting с out-of-sample и overfitting проверки, и paper ботове." },
  { icon: ShieldCheck, title: "Risk management", text: "Position size калкулатор, risk engine, дневни лимити и предупреждения преди всяка сделка." },
  { icon: NotebookPen, title: "Trading journal", text: "Setup, причина, емоция, урок и screenshot за всяка сделка + статистика на грешките ти." },
];

const FLOW = ["LEARN", "UNDERSTAND", "PRACTICE", "REPLAY", "BACKTEST", "PAPER TRADE", "REVIEW", "IMPROVE"];

/* Decorative candles for the hero illustration (shape only — no prices, no market data). */
const CANDLES: [number, number, number, number][] = [
  // open, close, high, low  (in "chart units", 0 = top)
  [70, 62, 58, 76],
  [62, 66, 57, 70],
  [66, 55, 50, 68],
  [55, 58, 51, 63],
  [58, 47, 44, 60],
  [47, 50, 42, 54],
  [50, 41, 37, 52],
  [41, 44, 36, 49],
  [44, 35, 31, 46],
  [35, 39, 32, 43],
  [39, 30, 26, 41],
  [30, 33, 27, 37],
  [33, 25, 21, 35],
  [25, 28, 22, 32],
];

function HeroIllustration() {
  const w = 14;
  const gap = 8;
  return (
    <div className="relative">
      <div aria-hidden className="absolute -inset-6 rounded-[28px] bg-[radial-gradient(60%_60%_at_60%_40%,rgb(59_130_246/0.22),transparent_70%)] blur-2xl" />
      <div className="card relative overflow-hidden p-0">
        <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <span className="h-2.5 w-2.5 rounded-full bg-white/10" />
            <span className="ml-2 text-xs font-medium text-muted">Paper terminal</span>
          </div>
          <span className="inline-flex items-center gap-1.5 rounded-md border border-warn/30 bg-warn/[0.08] px-2 py-0.5 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-warn">
            <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden />
            Illustration · virtual
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2 border-b border-white/[0.06] px-4 py-3 text-[11px]">
          {[
            ["Stop loss", "зададен"],
            ["Risk / trade", "≤ 1%"],
            ["Reward : risk", "2R"],
          ].map(([k, v]) => (
            <div key={k} className="glass-inset px-2.5 py-2">
              <div className="text-faint">{k}</div>
              <div className="num mt-0.5 font-semibold text-text">{v}</div>
            </div>
          ))}
        </div>
        <div className="relative px-4 pb-5 pt-4">
          <div className="grid-mesh absolute inset-0 opacity-70" aria-hidden />
          <svg viewBox={`0 0 ${CANDLES.length * (w + gap) + 20} 90`} className="relative h-52 w-full" aria-hidden preserveAspectRatio="none">
            <path
              d={CANDLES.map((c, i) => `${i ? "L" : "M"}${10 + i * (w + gap) + w / 2} ${(c[0] + c[1]) / 2 + 3}`).join(" ")}
              fill="none"
              stroke="var(--color-accent2)"
              strokeOpacity="0.55"
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
            />
            {CANDLES.map(([o, c, h, l], i) => {
              const x = 10 + i * (w + gap);
              const up = c < o;
              const color = up ? "var(--color-up)" : "var(--color-down)";
              return (
                <g key={i}>
                  <line x1={x + w / 2} x2={x + w / 2} y1={h} y2={l} stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke" opacity="0.85" />
                  <rect x={x} y={Math.min(o, c)} width={w} height={Math.max(1.5, Math.abs(o - c))} rx="1.5" fill={color} opacity={up ? 0.9 : 0.75} />
                </g>
              );
            })}
            <line x1="0" x2="1000" y1="80" y2="80" stroke="var(--color-down)" strokeOpacity="0.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
            <line x1="0" x2="1000" y1="16" y2="16" stroke="var(--color-up)" strokeOpacity="0.5" strokeDasharray="4 4" vectorEffect="non-scaling-stroke" />
          </svg>
          <div className="pointer-events-none absolute left-5 top-3 flex gap-3 text-[10px] font-medium uppercase tracking-[0.08em]" aria-hidden>
            <span className="text-up/80">Take profit</span>
            <span className="text-faint">·</span>
            <span className="text-down/80">Stop loss</span>
          </div>
        </div>
      </div>
      <div className="glass-strong absolute -bottom-8 -right-5 hidden w-56 rounded-xl p-3 sm:block">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-accent2">
          <Sparkles size={13} strokeWidth={2} aria-hidden />
          AI Teacher
        </div>
        <ul className="mt-2 space-y-1.5 text-xs text-muted">
          {["OBSERVATION", "RULES", "SCENARIO", "INVALIDATION", "RISK"].map((s) => (
            <li key={s} className="flex items-center gap-1.5">
              <CircleCheck size={13} strokeWidth={2} className="text-up" aria-hidden />
              <span className="font-medium tracking-wide text-text/85">{s}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export default function Landing() {
  const { user, refresh } = useSession();
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const go = async (path: string) => {
    setError(null);
    if (user) return router.push(path);
    setBusy(path);
    try {
      await startGuest();
      await refresh();
      router.push(path);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <main className="relative min-h-screen overflow-x-hidden">
      {/* soft gradient mesh + technical grid behind the hero */}
      <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-[760px]">
        <div className="grid-mesh absolute inset-0 opacity-80" />
        <div className="absolute left-1/2 top-[-180px] h-[520px] w-[900px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(59_130_246/0.16),transparent)]" />
      </div>

      <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <Brand size={32} />
        <div className="flex items-center gap-3 text-sm">
          {user ? (
            <Link href="/dashboard" className="inline-flex items-center gap-1.5 font-medium text-accent2 transition-colors hover:text-text">
              Към платформата <ArrowRight size={14} strokeWidth={2} aria-hidden />
            </Link>
          ) : (
            <Link
              href="/login"
              className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 font-medium text-muted transition-colors hover:border-white/[0.18] hover:text-text"
            >
              Вход / Регистрация
            </Link>
          )}
        </div>
      </nav>

      <section className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 pb-20 pt-10 sm:px-6 lg:grid-cols-[1.05fr_0.95fr] lg:pt-16">
        <div className="text-center lg:text-left">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/35 bg-warn/[0.08] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-warn">
            <ShieldCheck size={13} strokeWidth={2} aria-hidden />
            Paper trading only · No real money · No profit promises
          </span>
          <h1 className="mx-auto mt-6 max-w-2xl text-4xl font-semibold leading-[1.08] tracking-[-0.03em] sm:text-5xl lg:mx-0 lg:text-[56px]">
            <span className="text-gradient">Learn trading.</span>{" "}
            <span className="text-gradient block">Practice without risking real money.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base leading-relaxed text-muted sm:text-lg lg:mx-0">
            Образователна trading платформа за абсолютно начинаещи: научи как работят пазарите, тествай идеи върху
            исторически данни и разбери дали изобщо имаш работеща система — преди да рискуваш и един лев.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
            <Button size="lg" onClick={() => go("/learn")} disabled={!!busy}>
              {busy === "/learn" ? "Подготвям…" : "START LEARNING"}
            </Button>
            <Button size="lg" variant="outline" onClick={() => go("/paper")} disabled={!!busy}>
              {busy === "/paper" ? "Подготвям…" : "OPEN PAPER TRADING"}
            </Button>
          </div>
          <p className="mt-3 text-xs text-faint">Без регистрация: получаваш собствен демо профил с $10,000 виртуални пари.</p>
          <div className="mx-auto mt-4 max-w-md lg:mx-0">
            <ErrorText error={error} />
          </div>
        </div>
        <div className="mx-auto w-full max-w-lg lg:max-w-none">
          <HeroIllustration />
        </div>
      </section>

      {/* the learning loop */}
      <section className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="card p-5 sm:p-7">
          <div className="text-center">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent2">Философията</div>
            <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.015em]">Учи → разбери → упражнявай → подобрявай</h2>
          </div>
          <ol className="mt-6 flex flex-wrap items-center justify-center gap-x-1.5 gap-y-2.5">
            {FLOW.map((s, i) => (
              <li key={s} className="flex items-center gap-1.5">
                <span className="rounded-lg border border-up/25 bg-up/[0.08] px-2.5 py-1.5 text-xs font-semibold tracking-wide text-up">{s}</span>
                {i < FLOW.length - 1 && <ArrowRight size={13} strokeWidth={2} className="text-faint" aria-hidden />}
              </li>
            ))}
          </ol>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 opacity-75">
            <span className="text-sm text-muted">Не:</span>
            {["DEPOSIT", "GUESS", "TRADE", "LOSE"].map((s, i) => (
              <span key={s} className="flex items-center gap-2">
                <span className="rounded-md bg-down/[0.12] px-2.5 py-1 text-[13px] font-semibold text-down line-through">{s}</span>
                {i < 3 && <ArrowRight size={13} strokeWidth={2} className="text-faint" aria-hidden />}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* features */}
      <section className="relative mx-auto max-w-6xl px-4 pb-16 sm:px-6">
        <div className="mb-5 flex items-end justify-between gap-4">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-accent2">Всичко на едно място</div>
            <h2 className="mt-1.5 text-xl font-semibold tracking-[-0.015em]">Инструменти на професионален терминал — за обучение</h2>
          </div>
          <span className="hidden items-center gap-1.5 text-xs text-faint sm:inline-flex">
            <Rewind size={13} strokeWidth={2} aria-hidden /> + Market Replay свещ по свещ
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className="card hover-lift p-4">
                <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.09] to-white/[0.02] text-accent2 shadow-[inset_0_1px_0_0_rgb(255_255_255/0.07)]">
                  <Icon size={19} strokeWidth={1.75} aria-hidden />
                </span>
                <h3 className="mt-3 font-semibold">{f.title}</h3>
                <p className="mt-1 text-sm leading-relaxed text-muted">{f.text}</p>
              </div>
            );
          })}
          <div className="card flex flex-col justify-center border-accent/25 bg-accent/[0.08] p-4">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-accent/30 bg-accent/15 text-accent2">
              <ShieldCheck size={19} strokeWidth={1.75} aria-hidden />
            </span>
            <h3 className="mt-3 font-semibold">Без хазарт</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">
              Няма депозити, тегления, реални поръчки или API ключове с права за търговия. Всичко е симулация.
            </p>
          </div>
        </div>
      </section>

      {/* risk disclaimer */}
      <footer className="relative mx-auto max-w-6xl px-4 pb-14 sm:px-6">
        <Disclaimer className="mx-auto max-w-3xl justify-center text-xs">
          Trading носи значителен риск. Платформата не дава финансови съвети и не обещава печалби. Резултатите в симулацията и в
          backtest-ите не гарантират бъдещи резултати.
        </Disclaimer>
        <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t border-white/[0.06] pt-6 text-xs text-faint">
          <Brand size={22} />
          <span>Само виртуални средства · образователна цел</span>
        </div>
      </footer>
    </main>
  );
}
