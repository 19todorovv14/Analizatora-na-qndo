"use client";

import { ArrowLeft, GraduationCap, ShieldCheck, Sparkles, Wallet, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Brand } from "@/components/shell/Brand";
import { Button, ErrorText, Field, Tabs } from "@/components/ui";
import { errorMessage, post } from "@/lib/api";
import { startGuest, useSession } from "@/lib/session";

const POINTS: { icon: LucideIcon; title: string; text: string }[] = [
  { icon: GraduationCap, title: "Academy от нулата", text: "Уроци, quizzes и упражнения — от свещите до риска." },
  { icon: Wallet, title: "$10,000 виртуални", text: "Paper trading с реалистични разходи. Без реални пари." },
  { icon: Sparkles, title: "AI Teacher", text: "Обяснява защо — правила, сценарии и риск. Без прогнози." },
];

export default function LoginPage() {
  const [tab, setTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { refresh } = useSession();
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      if (tab === "login") await post("/auth/login", { email, password });
      else await post("/auth/register", { email, password, display_name: name || "Trader" });
      await refresh();
      router.push("/dashboard");
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const guest = async () => {
    setBusy(true);
    try {
      await startGuest();
      await refresh();
      router.push("/dashboard");
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <main className="relative flex min-h-screen flex-col overflow-x-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="grid-mesh absolute inset-x-0 top-0 h-[640px] opacity-70" />
        <div className="absolute left-[18%] top-[-120px] h-[460px] w-[720px] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgb(59_130_246/0.14),transparent)]" />
      </div>

      <header className="relative mx-auto flex w-full max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
        <Link href="/" className="rounded-lg" aria-label="Trading Academy — начална страница">
          <Brand size={30} />
        </Link>
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs font-medium text-muted transition-colors hover:text-text">
          <ArrowLeft size={14} strokeWidth={2} aria-hidden />
          Начало
        </Link>
      </header>

      <div className="relative mx-auto grid w-full max-w-5xl flex-1 items-center gap-10 px-4 pb-12 pt-4 sm:px-6 lg:grid-cols-[1fr_400px]">
        <section className="hidden lg:block">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-warn/35 bg-warn/[0.08] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-warn">
            <ShieldCheck size={13} strokeWidth={2} aria-hidden />
            Paper trading only
          </span>
          <h1 className="text-gradient mt-5 max-w-md text-4xl font-semibold leading-[1.1] tracking-[-0.03em]">Учи, упражнявай и анализирай — без риск.</h1>
          <p className="mt-4 max-w-md text-sm leading-relaxed text-muted">
            Влез, за да продължиш прогреса си, или започни веднага с демо профил — всичко в платформата е симулация с виртуални пари.
          </p>
          <ul className="mt-8 max-w-md space-y-3">
            {POINTS.map((p) => {
              const Icon = p.icon;
              return (
                <li key={p.title} className="flex gap-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-gradient-to-b from-white/[0.08] to-white/[0.02] text-accent2">
                    <Icon size={17} strokeWidth={1.8} aria-hidden />
                  </span>
                  <span>
                    <span className="block text-sm font-semibold text-text">{p.title}</span>
                    <span className="block text-[13px] leading-relaxed text-muted">{p.text}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        <div className="mx-auto w-full max-w-sm lg:max-w-none">
          <div className="glass-strong rounded-2xl p-5 shadow-modal sm:p-6">
            <Tabs
              tabs={[
                { key: "login", label: "Вход" },
                { key: "register", label: "Регистрация" },
              ]}
              value={tab}
              onChange={setTab}
            />
            <form onSubmit={submit} className="mt-5 space-y-3.5">
              {tab === "register" && (
                <Field label="Име">
                  <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Trader" autoComplete="nickname" />
                </Field>
              )}
              <Field label="Email">
                <input className="input" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
              </Field>
              <Field label="Парола" hint={tab === "register" ? "Поне 8 символа, малки и главни букви и цифра." : undefined}>
                <input
                  className="input"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete={tab === "login" ? "current-password" : "new-password"}
                />
              </Field>
              <ErrorText error={error} />
              <Button className="w-full" disabled={busy}>
                {tab === "login" ? "Влез" : "Създай акаунт"}
              </Button>
            </form>
            <div className="my-4 flex items-center gap-2 text-xs text-faint">
              <span className="h-px flex-1 bg-white/[0.08]" /> или <span className="h-px flex-1 bg-white/[0.08]" />
            </div>
            <Button variant="outline" className="w-full" onClick={guest} disabled={busy}>
              Опитай веднага като гост (демо профил)
            </Button>
            <p className="mt-4 text-center text-xs text-muted">
              Демо акаунт: <span className="num">demo@trading-academy.local</span> / <span className="num">Demo12345</span>
            </p>
          </div>
          <p className="mt-4 text-center text-[11px] text-faint">Само виртуални средства. Не съхраняваме платежни данни или ключове.</p>
        </div>
      </div>
    </main>
  );
}
