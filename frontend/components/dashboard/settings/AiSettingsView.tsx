"use client";

/*
 * AI SETTINGS (/settings/ai) — GET /api/system/ai: provider / model / effort status, offline fallback,
 * output structure, modes, safety rules and disclaimers; the explain-mode default (PUT /api/settings
 * explain_mode). No secret inputs: the provider and key are configured only in the server environment.
 */
import { Bot, Cpu, KeyRound, Languages, ListChecks, ShieldCheck, Sparkles, WifiOff } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";

import { EnvText } from "@/components/dashboard/settings/DataSourcesView";
import { yesNo, type AiInfo } from "@/components/dashboard/settings/system";
import { Badge, Card, ErrorState, ErrorText, Notice, PageHeader, SkeletonText, Switch } from "@/components/ui";
import { errorMessage, fetcher, put } from "@/lib/api";
import { useExplain } from "@/lib/explain";
import { cx } from "@/lib/format";

type SettingsPayload = { settings: { explain_mode?: boolean; app_mode?: "learn" | "trade" } };

function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-text">{children}</dd>
    </>
  );
}

export function AiSettingsView() {
  const { data, error, mutate } = useSWR<AiInfo>("/system/ai", fetcher);
  const { data: settings, mutate: mutateSettings } = useSWR<SettingsPayload>("/settings", fetcher);
  const { explain, setExplain } = useExplain();
  const [saveError, setSaveError] = useState<string | null>(null);
  const explainDefault = settings?.settings.explain_mode ?? data?.explain_mode_default ?? false;

  const saveExplain = async (v: boolean) => {
    setSaveError(null);
    setExplain(v);
    try {
      await put("/settings", { explain_mode: v });
      void mutateSettings();
    } catch (e) {
      setSaveError(errorMessage(e));
    }
  };

  const claude = data?.active === "anthropic";

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Cpu}
        title="AI Settings"
        subtitle="Как работи AI Teacher: доставчик, offline fallback, структура на отговорите и предпазни правила."
      />

      {!data ? (
        error ? (
          <ErrorState title="AI настройките не се заредиха" onRetry={() => void mutate()} />
        ) : (
          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <SkeletonText lines={7} />
            </Card>
            <Card>
              <SkeletonText lines={7} />
            </Card>
          </div>
        )
      ) : (
        <>
          <div className="grid gap-4 xl:grid-cols-2">
            <Card
              title={
                <>
                  <Bot size={14} strokeWidth={2} className="text-violet" aria-hidden /> Доставчик
                </>
              }
              right={<Badge tone={claude ? "violet" : "neutral"}>{claude ? "Claude" : "Offline teacher"}</Badge>}
            >
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
                <Row label="Активен">{data.active}</Row>
                <Row label="AI_PROVIDER">
                  <code className="font-mono text-xs">{data.provider}</code>
                </Row>
                <Row label="Модел">{data.model ?? <span className="text-faint">— (конфигуриран: {data.configured_model ?? "—"})</span>}</Row>
                <Row label="Effort">{data.effort ?? "—"}</Row>
                <Row label="Max tokens / timeout">
                  <span className="num">
                    {data.max_tokens ?? "—"} / {data.timeout_seconds ? `${data.timeout_seconds}s` : "—"}
                  </span>
                </Row>
                <Row label="Fallback">{data.fallbacks}</Row>
                <Row
                  label={
                    <span className="inline-flex items-center gap-1">
                      <KeyRound size={12} strokeWidth={2} aria-hidden /> Ключ налице
                    </span>
                  }
                >
                  <code className="font-mono text-xs text-muted">{data.key_env}</code>{" "}
                  <span className={data.key_present ? "text-up" : "text-faint"}>{yesNo(data.key_present)}</span>
                </Row>
              </dl>
              <p className="mt-3 text-sm text-muted">{data.status_note}</p>
            </Card>

            <Card
              title={
                <>
                  <WifiOff size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Offline fallback
                </>
              }
              right={<Badge tone={data.offline.active ? "warn" : "up"}>{data.offline.active ? "активен" : "резервен"}</Badge>}
            >
              {data.offline.reason && <p className="mb-2 text-sm font-medium text-text">{data.offline.reason}</p>}
              <p className="text-sm leading-relaxed text-muted">{data.offline.explanation}</p>
              <div className="mt-3 rounded-lg border border-white/[0.06] bg-white/[0.025] px-3 py-2.5 text-xs leading-relaxed text-muted">
                <EnvText text={data.how_to_enable} />
              </div>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
            <div className="space-y-4">
              <Card
                title={
                  <>
                    <Sparkles size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Explain mode
                  </>
                }
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm leading-relaxed text-muted">
                    Подчертава trading термините и показва обяснение (какво е, защо е важно, честа грешка) при посочване. По подразбиране за
                    профила ти:
                  </p>
                  <Switch checked={explainDefault} onChange={(v) => void saveExplain(v)} ariaLabel="Explain mode по подразбиране" />
                </div>
                <p className="mt-2 text-xs text-faint">Сега в този браузър: {explain ? "включен" : "изключен"} (бързо превключване — бутонът Explain горе).</p>
                <ErrorText error={saveError} />
              </Card>
              <Card
                title={
                  <>
                    <Languages size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Език
                  </>
                }
                right={<Badge tone="neutral">{data.language.code}</Badge>}
              >
                <p className="text-sm leading-relaxed text-muted">{data.language.note}</p>
              </Card>
              <Card
                title={
                  <>
                    <ListChecks size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Структура на анализа
                  </>
                }
              >
                <ol className="flex flex-wrap gap-1.5">
                  {data.output_sections.map((s, i) => (
                    <li key={s} className="rounded-md border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] font-semibold tracking-[0.06em] text-text/90">
                      <span className="num mr-1 text-faint">{i + 1}</span>
                      {s}
                    </li>
                  ))}
                </ol>
                <h3 className="mb-1.5 mt-4 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">Режими на AI Teacher</h3>
                <div className="flex flex-wrap gap-1.5">
                  {data.modes.map((m) => (
                    <Badge key={m.key} tone="violet">
                      {m.label}
                    </Badge>
                  ))}
                </div>
              </Card>
            </div>

            <Card
              title={
                <>
                  <ShieldCheck size={14} strokeWidth={2} className="text-up" aria-hidden /> Предпазни правила
                </>
              }
              right={<span className="num text-[11px] text-faint">{data.safety_rules.length} правила</span>}
            >
              <ul className="space-y-2.5">
                {data.safety_rules.map((r, i) => (
                  <li key={r.key} className="flex gap-3">
                    <span className={cx("num mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-up/10 text-[11px] font-semibold text-up ring-1 ring-inset ring-up/20")}>{i + 1}</span>
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text">{r.title}</div>
                      <p className="text-[13px] leading-relaxed text-muted">{r.text}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <div className="mt-4 space-y-2 border-t border-white/[0.06] pt-3">
                <Notice tone="info" title="Стандартен disclaimer">
                  {data.standard_disclaimer}
                </Notice>
                <Notice tone="info" title="Strategy setups">
                  {data.setup_disclaimer}
                </Notice>
              </div>
            </Card>
          </div>

          <Notice tone="info" title="Ключовете се задават само на сървъра">
            {data.keys_policy}
          </Notice>
        </>
      )}
    </div>
  );
}
