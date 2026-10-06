"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button, ErrorText } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { startGuest, useSession } from "@/lib/session";

const FEATURES = [
  { icon: "📘", title: "Interactive lessons", text: "От 'какво е пазар' до market structure, индикатори, риск и психология — с анимирани графики и quizzes." },
  { icon: "📈", title: "Realistic charts", text: "TradingView-подобен терминал: свещи, timeframes от 1m до 1W, индикатори и инструменти за чертане." },
  { icon: "🧪", title: "Paper trading", text: "$10,000 виртуален баланс. Спред, такси, slippage, latency, partial fills и ликвидация — като истински пазар." },
  { icon: "🤖", title: "AI explanations", text: "AI Teacher обяснява ЗАЩО: observation → analysis → hypothesis, invalidation и риск. Никога 'купи сега'." },
  { icon: "🧩", title: "Strategy testing", text: "Визуален Strategy Builder, backtesting с out-of-sample и overfitting проверки, и paper ботове." },
  { icon: "🛡️", title: "Risk management", text: "Position size калкулатор, risk engine, дневни лимити и предупреждения преди всяка сделка." },
  { icon: "📓", title: "Trading journal", text: "Setup, причина, емоция, урок и screenshot за всяка сделка + статистика на грешките ти." },
];

const FLOW = ["LEARN", "UNDERSTAND", "PRACTICE", "BACKTEST", "PAPER TRADE", "REVIEW", "IMPROVE"];

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
    <main className="min-h-screen bg-bg">
      <nav className="mx-auto flex max-w-6xl items-center justify-between px-4 py-4">
        <div className="flex items-center gap-2 font-bold tracking-wide">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent text-white">TA</span>
          Trading Academy
        </div>
        <div className="flex items-center gap-3 text-sm">
          {user ? (
            <Link href="/dashboard" className="text-accent2 hover:underline">
              Към платформата →
            </Link>
          ) : (
            <Link href="/login" className="text-muted hover:text-text">
              Вход / Регистрация
            </Link>
          )}
        </div>
      </nav>

      <section className="mx-auto max-w-6xl px-4 pb-10 pt-12 text-center">
        <span className="inline-flex items-center gap-1 rounded-full border border-warn/40 bg-warn/10 px-3 py-1 text-xs font-semibold uppercase tracking-wider text-warn">
          Paper trading only · No real money · No profit promises
        </span>
        <h1 className="mx-auto mt-6 max-w-3xl text-4xl font-extrabold leading-tight tracking-tight sm:text-5xl">
          Learn trading. Practice without risking real money.
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-base text-muted sm:text-lg">
          Образователна trading платформа за абсолютно начинаещи: научи как работят пазарите, тествай идеи върху
          исторически данни и разбери дали изобщо имаш работеща система — преди да рискуваш и един лев.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Button size="lg" onClick={() => go("/learn")} disabled={!!busy}>
            {busy === "/learn" ? "Подготвям…" : "START LEARNING"}
          </Button>
          <Button size="lg" variant="outline" onClick={() => go("/paper")} disabled={!!busy}>
            {busy === "/paper" ? "Подготвям…" : "OPEN PAPER TRADING"}
          </Button>
        </div>
        <p className="mt-3 text-xs text-faint">Без регистрация: получаваш собствен демо профил с $10,000 виртуални пари.</p>
        <div className="mx-auto mt-4 max-w-md">
          <ErrorText error={error} />
        </div>
      </section>

      <section className="mx-auto grid max-w-6xl gap-3 px-4 pb-14 sm:grid-cols-2 lg:grid-cols-4">
        {FEATURES.map((f) => (
          <div key={f.title} className="card p-4">
            <div className="text-2xl">{f.icon}</div>
            <h3 className="mt-2 font-semibold">{f.title}</h3>
            <p className="mt-1 text-sm leading-relaxed text-muted">{f.text}</p>
          </div>
        ))}
        <div className="card flex flex-col justify-center bg-accent/10 p-4">
          <h3 className="font-semibold">Без хазарт</h3>
          <p className="mt-1 text-sm text-muted">
            Няма депозити, тегления, реални поръчки или API ключове с права за търговия. Всичко е симулация.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 pb-20">
        <div className="card p-6">
          <h2 className="text-center text-lg font-bold">Философията</h2>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
            {FLOW.map((s, i) => (
              <span key={s} className="flex items-center gap-2">
                <span className="rounded-md bg-up/15 px-3 py-1.5 text-sm font-bold text-up">{s}</span>
                {i < FLOW.length - 1 && <span className="text-muted">→</span>}
              </span>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2 opacity-70">
            <span className="text-sm text-muted">Не:</span>
            {["DEPOSIT", "GUESS", "TRADE", "LOSE"].map((s, i) => (
              <span key={s} className="flex items-center gap-2">
                <span className="rounded-md bg-down/15 px-3 py-1.5 text-sm font-bold text-down line-through">{s}</span>
                {i < 3 && <span className="text-muted">→</span>}
              </span>
            ))}
          </div>
          <p className="mx-auto mt-6 max-w-2xl text-center text-xs leading-relaxed text-faint">
            Trading носи значителен риск. Платформата не дава финансови съвети и не обещава печалби. Резултатите в
            симулацията и в backtest-ите не гарантират бъдещи резултати.
          </p>
        </div>
      </section>
    </main>
  );
}
