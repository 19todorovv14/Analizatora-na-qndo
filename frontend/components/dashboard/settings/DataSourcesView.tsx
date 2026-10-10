"use client";

/*
 * DATA SOURCES (/settings/data-sources) — GET /api/system/data-sources[?check=true]: per asset class the
 * configured provider chain and status (DEMO / LIVE / DELAYED / N/A), instrument coverage, provider
 * health (key present yes/no — never the key), catalog counts + last syncs, market-cap and news
 * providers and how to enable real data. Keys live only in the server environment.
 */
import { BookOpen, DatabaseZap, ExternalLink, KeyRound, Lock, Newspaper, RefreshCw, ServerCog, ShieldCheck, Wifi } from "lucide-react";
import { useState } from "react";
import useSWR from "swr";

import {
  STATUS_LABEL,
  chainText,
  coveragePct,
  orderProviders,
  reachText,
  splitEnv,
  statusTone,
  yesNo,
  type AuxProvider,
  type ClassSource,
  type DataSources,
  type ProviderInfo,
} from "@/components/dashboard/settings/system";
import { ClassIcon } from "@/components/market/ClassBadge";
import { Badge, Button, Card, ErrorState, Meter, Notice, PageHeader, PaperBadge, SkeletonText, Spinner } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { cx, fmtTime } from "@/lib/format";

const INK = { up: "text-up", down: "text-down", neutral: "text-muted" } as const;

/** Text with ENV_VAR names rendered as code chips. */
export function EnvText({ text, className }: { text: string; className?: string }) {
  return (
    <span className={className}>
      {splitEnv(text).map((p, i) =>
        p.code ? (
          <code key={i} className="rounded bg-white/[0.06] px-1 py-px font-mono text-[0.92em] text-accent2">
            {p.t}
          </code>
        ) : (
          <span key={i}>{p.t}</span>
        ),
      )}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const tone = statusTone(status);
  return <Badge tone={tone}>{STATUS_LABEL[status] ?? status}</Badge>;
}

function ClassCard({ c }: { c: ClassSource }) {
  const cov = coveragePct(c);
  return (
    <Card
      title={
        <span className="flex min-w-0 items-center gap-2">
          <ClassIcon cls={c.asset_class} size={22} />
          <span className="truncate">{c.label}</span>
        </span>
      }
      right={<StatusChip status={c.status} />}
    >
      <div className="space-y-3 text-sm">
        <div>
          <div className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">Верига</div>
          <code className="mt-0.5 block truncate font-mono text-xs text-text/90" title={chainText(c)}>
            {chainText(c)}
          </code>
          {c.inherited && c.fallback_env && <p className="mt-0.5 text-[11px] text-faint">Наследено от {c.fallback_env}.</p>}
        </div>
        <ul className="space-y-1">
          {c.providers.map((p, i) => (
            <li key={p.id} className="flex items-center gap-2 text-xs">
              <span className="num w-4 shrink-0 text-faint">{i + 1}.</span>
              <span className="min-w-0 flex-1 truncate">{p.name}</span>
              <span className="num shrink-0 text-faint">{p.supported_instruments}</span>
              <StatusChip status={p.status} />
            </li>
          ))}
        </ul>
        {c.providers.some((p) => p.problem) && (
          <p className="text-[11px] leading-snug text-warn">{c.providers.find((p) => p.problem)?.problem}</p>
        )}
        <div>
          <div className="mb-1 flex items-baseline justify-between text-[11px]">
            <span className="text-muted">Инструменти с данни</span>
            <span className="num text-text">
              {c.instruments.available}/{c.instruments.total}
            </span>
          </div>
          <Meter value={cov} tone={cov === 100 ? "up" : cov > 0 ? "warn" : "down"} />
          <p className="num mt-1 text-[11px] text-faint">
            Поддържани:{" "}
            {Object.entries(c.instruments.supported_by)
              .map(([k, v]) => `${k} ${v}`)
              .join(" · ")}
          </p>
        </div>
        {!c.available && c.reason && <p className="text-xs text-muted">{c.reason}</p>}
        <details className="group text-xs">
          <summary className="cursor-pointer select-none font-medium text-accent2 hover:text-text">Как да включа реални данни</summary>
          <p className="mt-1.5 leading-relaxed text-muted">
            <EnvText text={c.how_to_enable} />
          </p>
        </details>
      </div>
    </Card>
  );
}

function ProviderRow({ p }: { p: ProviderInfo }) {
  const reach = reachText(p);
  return (
    <tr className="border-t border-white/[0.05] align-top">
      <td className="py-2.5 pr-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-text">{p.name}</span>
          <StatusChip status={p.status} />
        </div>
        <p className="mt-0.5 text-[11px] leading-snug text-muted">{p.note}</p>
        {p.problem && <p className="mt-0.5 text-[11px] text-warn">{p.problem}</p>}
      </td>
      <td className="py-2.5 pr-3 text-xs">{p.used_by.length ? p.used_by.join(", ") : <span className="text-faint">не се ползва</span>}</td>
      <td className="py-2.5 pr-3 text-xs">
        {p.key_required ? (
          <span className="flex items-center gap-1">
            <KeyRound size={12} strokeWidth={2} className={p.key_present ? "text-up" : "text-faint"} aria-hidden />
            <code className="font-mono text-[11px] text-muted">{p.key_env}</code>
            <span className={p.key_present ? "text-up" : "text-warn"}>{yesNo(p.key_present)}</span>
          </span>
        ) : (
          <span className="text-faint">не е нужен</span>
        )}
      </td>
      <td className={cx("py-2.5 pr-3 text-xs", INK[reach.tone])}>
        {reach.text}
        {p.checked_at ? <span className="num block text-[10.5px] text-faint">{fmtTime(p.checked_at)}</span> : null}
      </td>
      <td className="py-2.5 text-[11px] leading-snug text-muted">
        {p.rate_limit}
        {p.docs_url && (
          <a href={p.docs_url} target="_blank" rel="noreferrer noopener" className="mt-0.5 flex items-center gap-1 font-medium text-accent2 hover:text-text">
            Документация <ExternalLink size={11} aria-hidden />
          </a>
        )}
      </td>
    </tr>
  );
}

function AuxCard({ title, icon: Icon, p }: { title: string; icon: typeof Newspaper; p: AuxProvider }) {
  const reach = reachText(p);
  return (
    <Card
      title={
        <>
          <Icon size={14} strokeWidth={2} className="text-accent2" aria-hidden /> {title}
        </>
      }
      right={<StatusChip status={p.status} />}
    >
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-muted">Доставчик</dt>
        <dd className="font-medium">{p.provider === "none" ? "няма" : p.provider}</dd>
        <dt className="text-muted">Ключ</dt>
        <dd>
          <code className="font-mono text-[11px] text-muted">{p.key_env}</code>{" "}
          <span className={p.key_present ? "text-up" : p.key_required ? "text-warn" : "text-faint"}>
            {yesNo(p.key_present)}
            {!p.key_required && " (по желание)"}
          </span>
        </dd>
        <dt className="text-muted">Връзка</dt>
        <dd className={INK[reach.tone]}>{reach.text}</dd>
        <dt className="text-muted">За какво</dt>
        <dd className="text-text/85">{p.used_for}</dd>
        <dt className="text-muted">Лимити</dt>
        <dd className="text-muted">{p.rate_limit}</dd>
      </dl>
      {p.disclaimer && <p className="mt-2 text-[11px] leading-snug text-faint">{p.disclaimer}</p>}
      <p className="mt-2 text-xs leading-relaxed text-muted">
        <EnvText text={p.how_to_enable} />
      </p>
    </Card>
  );
}

export function DataSourcesView() {
  const [check, setCheck] = useState(false);
  const key = check ? "/system/data-sources?check=true" : "/system/data-sources";
  const { data, error, isValidating, mutate } = useSWR<DataSources>(key, fetcher, { keepPreviousData: true });

  return (
    <div className="space-y-5">
      <PageHeader
        icon={DatabaseZap}
        title="Data Sources"
        subtitle="Откъде идват пазарните данни за всеки клас актив и как да включиш реални (read-only) данни."
        badge={<PaperBadge compact />}
        actions={
          <Button
            size="sm"
            variant="outline"
            disabled={isValidating}
            onClick={() => {
              if (check) void mutate();
              else setCheck(true);
            }}
          >
            {isValidating ? <Spinner className="!h-3 !w-3" /> : <Wifi size={13} strokeWidth={2.25} aria-hidden />} Провери връзката
          </Button>
        }
      />

      <Notice tone="info" title="Ключовете живеят само в сървъра">
        {data?.keys_policy ??
          "API ключовете се задават само като environment variables на сървъра и никога не се показват или приемат от браузъра. Платформата не иска ключове с trading или withdrawal права."}
        <span className="mt-1 flex items-center gap-1.5 text-xs text-faint">
          <Lock size={12} strokeWidth={2.25} aria-hidden /> {data?.paper_note ?? "Изпълнението на сделки винаги е PAPER (виртуално)."}
        </span>
      </Notice>

      {!data ? (
        error ? (
          <ErrorState title="Информацията за източниците не се зареди" onRetry={() => void mutate()} />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Card key={i}>
                <SkeletonText lines={6} />
              </Card>
            ))}
          </div>
        )
      ) : (
        <>
          {check && data.health_checks && !data.health_checks.enabled && (
            <Notice tone="warn">Проверките на връзката са изключени на този сървър (тестова среда) — показваме последния кеширан резултат.</Notice>
          )}
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.classes.map((c) => (
              <ClassCard key={c.asset_class} c={c} />
            ))}
          </div>

          <Card
            title={
              <>
                <ServerCog size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Доставчици
              </>
            }
            right={
              <span className="text-[11px] text-faint">
                проверка на всеки {Math.round((data.health_checks?.ttl_seconds ?? 300) / 60)} мин · {data.health_checks?.enabled ? "включена" : "изключена"}
              </span>
            }
          >
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead className="text-left text-[10.5px] uppercase tracking-[0.06em] text-faint">
                  <tr>
                    <th className="pb-2 font-medium">Доставчик</th>
                    <th className="pb-2 font-medium">Ползва се за</th>
                    <th className="pb-2 font-medium">Ключ налице</th>
                    <th className="pb-2 font-medium">Връзка</th>
                    <th className="pb-2 font-medium">Лимити</th>
                  </tr>
                </thead>
                <tbody>
                  {orderProviders(data.providers).map((p) => (
                    <ProviderRow key={p.id} p={p} />
                  ))}
                </tbody>
              </table>
            </div>
            {data.health_checks?.method && <p className="mt-2 text-[11px] text-faint">{data.health_checks.method}</p>}
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <AuxCard title="Пазарна капитализация" icon={DatabaseZap} p={data.market_cap} />
            <AuxCard title="Новини и календар" icon={Newspaper} p={data.news} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
            <Card
              title={
                <>
                  <BookOpen size={14} strokeWidth={2} className="text-accent2" aria-hidden /> Каталог
                </>
              }
              right={<Badge tone={data.catalog.auto_sync ? "up" : "neutral"}>auto sync {data.catalog.auto_sync ? "on" : "off"}</Badge>}
            >
              <div className="grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
                {Object.entries(data.catalog.by_class).map(([k, v]) => (
                  <div key={k} className="rounded-lg border border-white/[0.06] bg-white/[0.025] px-2 py-1.5 text-center">
                    <div className="truncate text-[10.5px] text-muted">{k}</div>
                    <div className="num font-semibold">{v}</div>
                  </div>
                ))}
              </div>
              <p className="num mt-2 text-xs text-muted">
                Общо {data.catalog.total} инструмента · {data.catalog.available} с данни · източник{" "}
                {Object.entries(data.catalog.by_source)
                  .map(([k, v]) => `${k} ${v}`)
                  .join(", ")}
              </p>
              <p className="mt-2 text-xs leading-relaxed text-muted">{data.catalog.how_to_sync}</p>
              <h3 className="mb-1 mt-3 text-[10.5px] font-semibold uppercase tracking-[0.08em] text-faint">Последни синхронизации</h3>
              {data.catalog.last_syncs.length ? (
                <ul className="divide-y divide-white/[0.05] text-xs">
                  {data.catalog.last_syncs.map((s) => (
                    <li key={s.id} className="flex items-center gap-2 py-1.5">
                      <Badge tone={s.status === "ok" || s.status === "success" ? "up" : s.status === "running" ? "info" : "down"}>{s.status}</Badge>
                      <span className="font-medium">{s.provider}</span>
                      <span className="text-muted">{s.kind}</span>
                      <span className="num text-muted">{s.count ?? "—"}</span>
                      <span className="num ml-auto text-faint">{fmtTime(s.finished_ts ?? s.started_ts)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-faint">Още няма синхронизации — ползва се вграденият каталог.</p>
              )}
            </Card>

            <Card
              title={
                <>
                  <ShieldCheck size={14} strokeWidth={2} className="text-up" aria-hidden /> Как да включа реални данни
                </>
              }
            >
              <ol className="space-y-2 text-sm leading-relaxed text-text/90">
                {data.how_to_enable.map((s) => (
                  <li key={s}>
                    <EnvText text={s} />
                  </li>
                ))}
              </ol>
              <ul className="mt-3 space-y-1 border-t border-white/[0.06] pt-3 text-xs text-muted">
                <li className="flex gap-1.5">
                  <Lock size={12} strokeWidth={2.25} className="mt-0.5 shrink-0 text-up" aria-hidden /> Никога не въвеждай API ключове в браузъра — тази страница няма полета за ключове.
                </li>
                <li className="flex gap-1.5">
                  <Lock size={12} strokeWidth={2.25} className="mt-0.5 shrink-0 text-up" aria-hidden /> Платформата никога не иска ключове с trading или withdrawal права, private keys или seed phrases.
                </li>
                <li className="flex gap-1.5">
                  <RefreshCw size={12} strokeWidth={2.25} className="mt-0.5 shrink-0 text-accent2" aria-hidden /> Без доставчик данните са DEMO (синтетични) или DATA NOT AVAILABLE — числата не се измислят.
                </li>
              </ul>
            </Card>
          </div>
          <p className="num text-[11px] text-faint">Обновено {fmtTime(data.as_of)}</p>
        </>
      )}
    </div>
  );
}
