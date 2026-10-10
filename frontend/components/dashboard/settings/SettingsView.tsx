"use client";

/*
 * SETTINGS (/settings): learning mode (Beginner / Advanced), workspace default (LEARN / TRADE), explain
 * mode default, guided tour reset, "Simulation realism" toggles of the paper engine, paper leverage and
 * reset, analysis options, links to Data Sources / AI Settings, guest → account claim and security notes.
 */
import { ArrowRight, Cpu, DatabaseZap, FlaskConical, GraduationCap, LogOut, RotateCcw, Settings as SettingsIcon, ShieldCheck, UserRound, Wallet } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";

import { Badge, Button, Card, ErrorText, Field, InfoTip, Loading, Notice, PageHeader, Segmented, Switch } from "@/components/ui";
import { errorMessage, fetcher, patch, post, put } from "@/lib/api";
import { useExplain } from "@/lib/explain";
import { cx } from "@/lib/format";
import { useSession } from "@/lib/session";
import type { AccountView } from "@/lib/types";
import { useWorkspace, type WorkspaceMode } from "@/lib/workspace";

type Settings = {
  settings: {
    execution: Record<string, number | boolean | string>;
    default_symbol: string;
    default_timeframe: string;
    news_risk: boolean;
    tour_done: boolean;
    max_trades_per_day: number;
    app_mode?: WorkspaceMode;
    explain_mode?: boolean;
  };
};
type Health = { execution_mode: string; live_trading: boolean; market_data: Record<string, string>; ai_provider: string; celery: boolean };

export const EXEC_TOGGLES: [string, string, string][] = [
  ["fees_enabled", "Fees", "Комисионни при всяко изпълнение."],
  ["spread_enabled", "Spread", "BUY на ask, SELL на bid."],
  ["slippage_enabled", "Slippage", "Неблагоприятна разлика в цената при market/stop поръчки."],
  ["latency_enabled", "Latency simulation", "Цената се движи, докато поръчката „пътува“."],
  ["partial_fills_enabled", "Partial fills", "Големите поръчки спрямо обема се изпълняват на части."],
  ["liquidation_enabled", "Liquidation", "Принудително затваряне при margin level под stop-out нивото."],
];

const LEVERAGES = [1, 2, 5, 10, 20, 30];

function Row({ title, hint, children }: { title: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
      <div className="min-w-0 flex-1 basis-60">
        <div className="text-sm font-medium text-text">{title}</div>
        {hint && <div className="mt-0.5 text-xs leading-relaxed text-muted">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

const cardTitle = (Icon: typeof Cpu, text: string) => (
  <>
    <Icon size={14} strokeWidth={2} className="text-accent2" aria-hidden /> {text}
  </>
);

export function SettingsView() {
  const { user, beginner, setMode, refresh, logout } = useSession();
  const { mode: workspace, setMode: setWorkspace } = useWorkspace();
  const { setExplain } = useExplain();
  const { data, mutate } = useSWR<Settings>("/settings", fetcher);
  const { data: health } = useSWR<Health>("/health", fetcher);
  const { data: account, mutate: mutateAcc } = useSWR<AccountView>("/paper/account", fetcher);
  const [balance, setBalance] = useState("10000");
  const [claim, setClaim] = useState({ email: "", password: "", display_name: "" });
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!data || !account || !user) return <Loading />;
  const exec = data.settings.execution;
  const appMode: WorkspaceMode = data.settings.app_mode ?? "learn";

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setError(null);
    setMsg(null);
    try {
      await fn();
      setMsg(ok);
      void mutate();
      void mutateAcc();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  const setExec = (k: string, v: unknown) => run(() => patch("/paper/account", { execution: { [k]: v } }), "Запазено.");

  return (
    <div className="mx-auto max-w-5xl space-y-5">
      <PageHeader icon={SettingsIcon} title="Settings" subtitle="Режим на обучение, реализъм на симулацията, paper сметка, източници на данни и AI." />
      <div aria-live="polite" className="space-y-2">
        <ErrorText error={error} />
        {msg && <Notice tone="up">{msg}</Notice>}
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title={cardTitle(GraduationCap, "Learning mode")}>
          <div className="divide-y divide-white/[0.05]">
            <Row
              title="Ниво"
              hint={
                beginner
                  ? "Beginner: скрити сложни метрики, обяснения навсякъде."
                  : "Advanced: market structure, ATR, margin, expectancy, SQN и разширени backtest статистики."
              }
            >
              <Segmented
                options={[
                  { value: "beginner", label: "Beginner" },
                  { value: "advanced", label: "Advanced" },
                ]}
                value={beginner ? "beginner" : "advanced"}
                onChange={(m) => void setMode(m)}
                ariaLabel="Ниво"
              />
            </Row>
            <Row title="Работно пространство по подразбиране" hint="LEARN: насоки и подсказки. TRADE: плътен терминал без обучителни бележки.">
              <Segmented
                options={[
                  { value: "learn", label: "LEARN" },
                  { value: "trade", label: "TRADE" },
                ]}
                value={appMode}
                onChange={(m) => {
                  setWorkspace(m);
                  void run(() => put("/settings", { app_mode: m }), `Работното пространство по подразбиране е ${m.toUpperCase()}.`);
                }}
                ariaLabel="Работно пространство"
              />
            </Row>
            <Row title="Explain mode по подразбиране" hint="Подчертава trading термините с обяснение при посочване.">
              <Switch
                checked={!!data.settings.explain_mode}
                onChange={(v) => {
                  setExplain(v);
                  void run(() => put("/settings", { explain_mode: v }), v ? "Explain mode е включен по подразбиране." : "Explain mode е изключен по подразбиране.");
                }}
                ariaLabel="Explain mode по подразбиране"
              />
            </Row>
            <Row title="Guided tour" hint="Обиколката на платформата се показва в Dashboard.">
              <Button size="sm" variant="outline" onClick={() => run(() => put("/settings", { tour_done: false }), "Обиколката ще се покаже отново в Dashboard.")}>
                <RotateCcw size={13} strokeWidth={2.25} aria-hidden /> Покажи guided tour отново
              </Button>
            </Row>
          </div>
          {workspace !== appMode && <p className="mt-2 text-[11px] text-faint">В момента си в {workspace.toUpperCase()} (превключва се от горната лента).</p>}
        </Card>

        <Card title={cardTitle(FlaskConical, "Simulation realism (paper engine)")}>
          <div className="grid gap-2 sm:grid-cols-2">
            {EXEC_TOGGLES.map(([k, label, hint]) => (
              <div key={k} className="flex items-center justify-between gap-2 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2">
                <span className="flex min-w-0 items-center gap-1 text-sm">
                  <span className="truncate">{label}</span>
                  <InfoTip text={hint} />
                </span>
                <Switch checked={Boolean(exec[k])} onChange={(v) => void setExec(k, v)} ariaLabel={label} />
              </div>
            ))}
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <Field label="Latency (ms)">
              <input className="input num" inputMode="numeric" defaultValue={String(exec.latency_ms)} onBlur={(e) => void setExec("latency_ms", Number(e.target.value))} />
            </Field>
            <Field label="Intrabar policy" hint="Когато SL и TP са в една свещ: worst_case приема, че първо е ударен стопът.">
              <select className="input" value={String(exec.intrabar_policy)} onChange={(e) => void setExec("intrabar_policy", e.target.value)}>
                <option value="worst_case">worst_case</option>
                <option value="path">path</option>
              </select>
            </Field>
          </div>
          <p className="mt-2 text-xs text-muted">Изключването на разходите прави симулацията нереалистично лесна — използвай го само за сравнение.</p>
        </Card>

        <Card title={cardTitle(Wallet, "Paper account")} right={<Badge tone="warn">virtual funds</Badge>}>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Leverage по подразбиране">
              <select
                className="input w-28"
                value={account.account.leverage}
                onChange={(e) => void run(() => patch("/paper/account", { leverage: Number(e.target.value) }), "Leverage е обновен.")}
              >
                {LEVERAGES.map((l) => (
                  <option key={l} value={l}>
                    {l}x
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Reset balance to">
              <input className="input num w-32" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} />
            </Field>
            <Button
              variant="down"
              onClick={() =>
                window.confirm("Да изтрия ли всички виртуални сделки и позиции и да започна отначало?") &&
                void run(() => post("/paper/reset", { balance: Number(balance) }), "Сметката е нулирана.")
              }
            >
              Reset paper account
            </Button>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted">
            Реалният leverage на позиция = min(избрания, лимита за класа актив). По-високият leverage не е препоръка — той увеличава и загубите,
            и риска от liquidation.
          </p>
        </Card>

        <Card title={cardTitle(ShieldCheck, "Analysis")}>
          <div className="divide-y divide-white/[0.05]">
            <Row title="Предстои важна новина / събитие" hint="NO-TRADE системата ще отчита News risk в анализа.">
              <Switch checked={data.settings.news_risk} onChange={(v) => void run(() => put("/settings", { news_risk: v }), "Запазено.")} ariaLabel="News risk" />
            </Row>
            <Row title="Overtrading праг" hint="Над този брой сделки на ден получаваш предупреждение.">
              <input
                className="input num w-24"
                inputMode="numeric"
                defaultValue={data.settings.max_trades_per_day}
                aria-label="Overtrading праг"
                onBlur={(e) => void run(() => put("/settings", { max_trades_per_day: Number(e.target.value) }), "Запазено.")}
              />
            </Row>
          </div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {[
          {
            href: "/settings/data-sources",
            icon: DatabaseZap,
            title: "Data Sources",
            text: health ? `Market data: ${Object.entries(health.market_data).map(([k, v]) => `${k}=${v}`).join(", ")}` : "Доставчици по клас актив, ключове (да/не), каталог.",
          },
          {
            href: "/settings/ai",
            icon: Cpu,
            title: "AI Settings",
            text: health ? `AI: ${health.ai_provider} · execution: ${health.execution_mode} · live trading: ${String(health.live_trading)}` : "Доставчик, offline fallback и предпазни правила.",
          },
        ].map((l) => (
          <Link
            key={l.href}
            href={l.href}
            className="card group flex min-w-0 items-center gap-3 px-4 py-3.5 transition-colors hover:border-white/[0.16]"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent2 ring-1 ring-inset ring-accent/25">
              <l.icon size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-semibold text-text group-hover:text-accent2">{l.title}</span>
              <span className="block truncate text-xs text-muted">{l.text}</span>
            </span>
            <ArrowRight size={15} strokeWidth={2} className="shrink-0 text-faint group-hover:text-accent2" aria-hidden />
          </Link>
        ))}
      </div>

      {user.is_guest && (
        <Card title={cardTitle(UserRound, "Запази профила (guest → акаунт)")}>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Име">
              <input className="input" value={claim.display_name} onChange={(e) => setClaim({ ...claim, display_name: e.target.value })} />
            </Field>
            <Field label="Email">
              <input className="input" type="email" autoComplete="email" value={claim.email} onChange={(e) => setClaim({ ...claim, email: e.target.value })} />
            </Field>
            <Field label="Парола">
              <input className="input" type="password" autoComplete="new-password" value={claim.password} onChange={(e) => setClaim({ ...claim, password: e.target.value })} />
            </Field>
          </div>
          <Button
            className="mt-3"
            onClick={() =>
              void run(async () => {
                await post("/auth/claim", claim);
                await refresh();
              }, "Профилът е запазен — целият прогрес остава.")
            }
          >
            Save account
          </Button>
        </Card>
      )}

      <Card title={cardTitle(ShieldCheck, "Security")}>
        <ul className="space-y-1.5 text-sm text-muted">
          {[
            "Платформата не съхранява private keys, seed phrases, платежни данни или API ключове с trading/withdrawal права.",
            "Няма депозити, тегления и реални поръчки — всички действия са paper (симулация).",
            "API ключовете за пазарни данни и AI се задават само в environment-а на сървъра — никога в браузъра.",
            "Сесията е HttpOnly cookie; паролите са хеширани (scrypt).",
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <ShieldCheck size={14} strokeWidth={2} className="mt-0.5 shrink-0 text-up" aria-hidden /> <span>{t}</span>
            </li>
          ))}
        </ul>
        <Button variant="outline" className={cx("mt-3")} onClick={() => void logout()}>
          <LogOut size={14} strokeWidth={2} aria-hidden /> Изход
        </Button>
      </Card>
    </div>
  );
}
