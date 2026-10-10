"use client";

/*
 * /replay — Historical Replay V2 (S5): setup → candle-by-candle replay with LONG / SHORT / WAIT decisions
 * (future candles hidden) → AI HISTORY REVIEW. ?symbol= &tf= &preset= &mode= prefill the setup;
 * ?session=<id> reopens a session (or its stored review).
 */
import { BrainCircuit, EyeOff, History, ListChecks, StepForward } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import {
  ReplayHistory,
  ReplayReview,
  ReplayScreen,
  ReplaySetup,
  ReplayStatsCard,
  ReplayToasts,
  defaultSetup,
  readReplayQuery,
  useReplaySession,
  type ReplayOptions,
  type ReplaySetupValues,
  type SessionRow,
} from "@/components/replay";
import { ChartSkeleton, DataNotAvailable, ErrorText, PageHeader, PaperBadge } from "@/components/ui";
import { fetcher } from "@/lib/api";
import { useSession } from "@/lib/session";

const HOW = [
  {
    icon: History,
    title: "Избери период",
    text: "Дата или preset (Trend, Range, Breakout…). Графиката започва в началото му.",
  },
  {
    icon: EyeOff,
    title: "Бъдещето е скрито",
    text: "Виждаш само миналото. Решаваш LONG / SHORT / WAIT със stop и target.",
  },
  {
    icon: StepForward,
    title: "Next candle",
    text: "Всяка свещ показва какво стана наистина. Прогнозите се оценяват автоматично.",
  },
  {
    icon: BrainCircuit,
    title: "AI history review",
    text: "Score, грешки в процеса и какво биха направили правилата на стратегия.",
  },
];

export default function ReplayPage() {
  const { beginner } = useSession();
  const api = useReplaySession();
  const { mutate } = useSWRConfig();
  const [setup, setSetup] = useState<ReplaySetupValues>(() => defaultSetup());
  const { data: options } = useSWR<ReplayOptions>("/replay/options", fetcher, {
    revalidateOnFocus: false,
  });
  const { open } = api;

  useEffect(() => {
    const q = readReplayQuery(window.location.search);
    if (q.session) {
      void open(q.session);
      return;
    }
    if (q.symbol || q.timeframe || q.preset || q.mode)
      // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time prefill from the URL (?symbol / tf / preset / mode)
      setSetup((s) => ({
        ...s,
        symbol: q.symbol ?? s.symbol,
        timeframe: q.timeframe ?? s.timeframe,
        period: q.preset ?? s.period,
        mode: q.mode ?? s.mode,
      }));
  }, [open]);

  const refreshLists = useCallback(() => {
    void mutate("/replay/stats");
    void mutate((k) => typeof k === "string" && k.startsWith("/replay?limit="));
  }, [mutate]);

  const start = useCallback(
    async (values: ReplaySetupValues) => {
      const s = await api.start(values);
      if (s) refreshLists();
    },
    [api, refreshLists],
  );

  const finished = !!api.review;
  useEffect(() => {
    if (finished) refreshLists();
  }, [finished, refreshLists]);

  const openRow = (row: SessionRow) => void open(row.id, row.status !== "active");

  const fromSession = () => {
    const s = api.review?.session ?? api.state?.session;
    if (!s) return setup;
    return {
      ...setup,
      symbol: s.symbol,
      timeframe: s.timeframe,
      mode: s.mode ?? setup.mode,
    };
  };

  let body: React.ReactNode;
  if (api.review) {
    body = (
      <>
        {api.error && (
          <div className="mb-3">
            {api.error.unavailable ? <DataNotAvailable reason={api.error.reason ?? api.error.message} compact /> : <ErrorText error={api.error.message} />}
          </div>
        )}
        <ReplayReview
          data={api.review}
          busy={api.busy}
          onAnother={() => {
            const next: ReplaySetupValues = {
              ...fromSession(),
              period: "random",
            };
            setSetup(next);
            void start(next);
          }}
          onSetup={() => {
            setSetup(fromSession());
            api.reset();
          }}
          history={<ReplayHistory onOpen={openRow} activeId={api.review.session.id} />}
        />
      </>
    );
  } else if (api.state) {
    body = (
      <ReplayScreen
        api={api}
        state={api.state}
        options={options}
        beginner={beginner}
        onNew={() => {
          setSetup(fromSession());
          api.reset();
        }}
      />
    );
  } else if (api.opening) {
    body = (
      <div className="space-y-3" aria-busy>
        <div className="skeleton h-12 rounded-xl" />
        <ChartSkeleton height={460} />
      </div>
    );
  } else {
    body = (
      <div className="space-y-4">
        <PageHeader
          title="Market Replay"
          icon={History}
          badge={<PaperBadge compact />}
          subtitle="Исторически период свещ по свещ. Бъдещето е скрито — решаваш LONG / SHORT / WAIT само с това, което е на графиката, и виждаш какво стана наистина."
        />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <ReplaySetup
            value={setup}
            onChange={setSetup}
            onStart={() => void start(setup)}
            busy={api.busy}
            error={api.error}
            options={options}
            beginner={beginner}
          />
          <div className="flex min-w-0 flex-col gap-4">
            <section className="card min-w-0" aria-label="Как работи replay">
              <header className="flex min-h-11 items-center gap-1.5 border-b border-white/[0.06] px-4 py-2.5">
                <ListChecks size={14} className="text-faint" aria-hidden />
                <h2 className="text-[13px] font-semibold text-text">Как работи</h2>
              </header>
              <ol className="space-y-3 p-4">
                {HOW.map((h, i) => (
                  <li key={h.title} className="flex gap-3">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-accent2">
                      <h.icon size={14} aria-hidden />
                    </span>
                    <div className="min-w-0">
                      <div className="text-[13px] font-medium text-text">
                        <span className="num mr-1 text-faint">{i + 1}.</span>
                        {h.title}
                      </div>
                      <p className="text-xs leading-relaxed text-muted">{h.text}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
            <ReplayStatsCard />
          </div>
        </div>
        <ReplayHistory onOpen={openRow} />
      </div>
    );
  }

  return (
    <>
      {body}
      {/* the active replay screen shows its toasts over the chart */}
      {(!api.state || api.review) && <ReplayToasts toasts={api.toasts} onDismiss={api.dismissToast} />}
    </>
  );
}
