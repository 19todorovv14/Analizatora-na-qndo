"use client";

/*
 * /learn/market-structure — MARKET STRUCTURE LAB. A past window of 80–140 closed candles (GET
 * /learn/structure/exercise, signed token); the user labels swings (HH / HL / LH / LL — a click snaps to the
 * candle's High / Low) and events (Breakout / Retest / Fakeout), picks the structure and gets a deterministic,
 * explained check (POST /learn/structure/check): CORRECT / INCORRECT badges on the chart, missed swings as ghost
 * markers, score, explanations, "Show answer" and the attempt history.
 */
import { CircleHelp, Eraser, Eye, EyeOff, RefreshCw, ScanSearch, Send, Trash2, Undo2, Waypoints } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";
import useSWR, { useSWRConfig } from "swr";

import { StructureChart } from "@/components/labs/structure/StructureChart";
import { StructureResults } from "@/components/labs/structure/StructureResults";
import { HISTORY_KEY, StructureHistoryCard, StructureTheory } from "@/components/labs/structure/StructureSidebar";
import {
  DIFFICULTY_META,
  EVENT_LABELS,
  LABEL_META,
  STRUCTURE_META,
  SWING_LABELS,
  labelKind,
  marksChanged,
  removeMarks,
  snapMark,
  structureMarkers,
  upsertMark,
} from "@/components/labs/model";
import type { Difficulty, StructureCheck, StructureExercise, StructureKind, StructureLabel, StructureMark } from "@/components/labs/types";
import {
  Badge,
  Button,
  Card,
  ChartSkeleton,
  DataNotAvailable,
  Disclaimer,
  ErrorState,
  ErrorText,
  Notice,
  PageHeader,
  Segmented,
  SourceBadge,
  Term,
  Tooltip,
} from "@/components/ui";
import { ApiError, errorMessage, errorReason, fetcher, post } from "@/lib/api";
import { cx, fmtPrice } from "@/lib/format";
import { useHotkeys } from "@/lib/hotkeys";
import { useSession } from "@/lib/session";
import { LearnHint } from "@/lib/workspace";

type Tool = StructureLabel | "erase";

type Work = {
  token: string;
  marks: StructureMark[];
  history: StructureMark[][];
  structure: StructureKind | null;
  check: StructureCheck | null;
  showAnswer: boolean;
};

const fresh = (token: string): Work => ({ token, marks: [], history: [], structure: null, check: null, showAnswer: false });

export function exerciseKey(difficulty: Difficulty, round: number): string {
  // `round` only makes the SWR key unique per "new exercise" (the backend ignores unknown params)
  return `/learn/structure/exercise?difficulty=${difficulty}&round=${round}`;
}

function ToolButton({ active, onClick, label, hint, kbd, tone = "accent", children }: { active: boolean; onClick: () => void; label: string; hint: string; kbd?: string; tone?: "accent" | "info"; children: React.ReactNode }) {
  return (
    <Tooltip content={<span>{hint}{kbd && <span className="ml-1.5 text-faint">[{kbd}]</span>}</span>} side="bottom">
      <button
        type="button"
        aria-pressed={active}
        aria-label={label}
        onClick={onClick}
        className={cx(
          "inline-flex h-8 min-w-10 items-center justify-center gap-1 rounded-md border px-2.5 text-xs font-semibold transition-colors",
          active
            ? tone === "info"
              ? "border-info/50 bg-info/15 text-info"
              : "border-accent/50 bg-accent/20 text-accent2"
            : "border-white/10 bg-white/[0.03] text-text hover:border-white/20 hover:bg-white/[0.06]",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

export function StructureLab() {
  const { beginner } = useSession();
  const { mutate: globalMutate } = useSWRConfig();
  const [difficulty, setDifficulty] = useState<Difficulty>(beginner ? "easy" : "medium");
  const [round, setRound] = useState(0);
  const [tool, setTool] = useState<Tool>("HH");
  const [work, setWork] = useState<Work>(fresh(""));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const key = exerciseKey(difficulty, round);
  const { data: ex, error: exError, isLoading, mutate } = useSWR<StructureExercise>(key, fetcher, {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    keepPreviousData: false,
  });

  // the work (marks, structure, result) belongs to one exercise token
  const w: Work = ex && work.token === ex.token ? work : fresh(ex?.token ?? "");
  const update = useCallback(
    (fn: (w: Work) => Work) => {
      if (!ex) return;
      setWork((prev) => fn(prev.token === ex.token ? prev : fresh(ex.token)));
    },
    [ex],
  );

  const setMarks = useCallback(
    (fn: (m: StructureMark[]) => StructureMark[]) =>
      update((cur) => {
        const next = fn(cur.marks);
        return next === cur.marks ? cur : { ...cur, marks: next, history: [...cur.history.slice(-49), cur.marks], showAnswer: false };
      }),
    [update],
  );

  const onPick = useCallback(
    (index: number, price: number | null) => {
      if (!ex) return;
      const c = ex.candles[index];
      if (!c) return;
      if (tool === "erase") {
        setMarks((m) => removeMarks(m, c.time));
        return;
      }
      const mark = snapMark(ex.candles, index, tool, price);
      if (mark) setMarks((m) => upsertMark(m, mark));
    },
    [ex, tool, setMarks],
  );

  const stale = marksChanged(w.marks, w.check) && !!w.check;
  const markers = useMemo(
    () =>
      ex
        ? structureMarkers({ candles: ex.candles, anchors: ex.anchors, marks: w.marks, check: stale ? null : w.check, showAnswer: w.showAnswer })
        : [],
    [ex, w.marks, w.check, w.showAnswer, stale],
  );

  const runCheck = async (reveal: boolean) => {
    if (!ex) return;
    setBusy(true);
    setError(null);
    try {
      const res = await post<StructureCheck>("/learn/structure/check", { token: ex.token, marks: w.marks, structure: w.structure ?? undefined });
      update((cur) => ({ ...cur, check: res, showAnswer: reveal || cur.showAnswer }));
      globalMutate(HISTORY_KEY);
    } catch (e) {
      setError(e instanceof ApiError && e.status === 400 ? `${errorMessage(e)} Зареди ново упражнение.` : errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const newExercise = () => {
    setError(null);
    setRound((r) => r + 1);
  };

  useHotkeys(
    {
      ...Object.fromEntries([...SWING_LABELS, ...EVENT_LABELS].map((l, i) => [String(i + 1), () => setTool(l)])),
      "0": () => setTool("erase"),
      "mod+z": () => update((cur) => (cur.history.length ? { ...cur, marks: cur.history[cur.history.length - 1], history: cur.history.slice(0, -1) } : cur)),
    },
    { enabled: !!ex },
  );

  const toolHint =
    tool === "erase"
      ? "клик = изтрий етикетите на свещта"
      : labelKind(tool) === "event"
        ? `клик = ${LABEL_META[tool].title} на свещта`
        : `клик = ${tool} на ${labelKind(tool) === "high" ? "High" : "Low"} на свещта`;

  /* ── exercise body ─────────────────────────────────────────── */
  let main: React.ReactNode;
  if (exError && !ex) {
    main =
      exError instanceof ApiError && (exError.status === 503 || exError.code === "DATA_NOT_AVAILABLE") ? (
        <DataNotAvailable reason={errorReason(exError)} provider={(exError.data as { symbol?: string } | null)?.symbol ?? undefined} />
      ) : (
        <ErrorState title="Упражнението не се зареди" description={errorReason(exError)} onRetry={() => mutate()} />
      );
  } else if (isLoading || !ex) {
    main = (
      <Card>
        <ChartSkeleton height={460} />
      </Card>
    );
  } else {
    const prec = ex.precision ?? 2;
    main = (
      <div className="space-y-4">
        <Card
          title={
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              <span className="truncate">
                {ex.symbol} · {ex.timeframe}
              </span>
              <Badge tone={ex.difficulty === "hard" ? "violet" : ex.difficulty === "medium" ? "info" : "neutral"}>{DIFFICULTY_META[ex.difficulty].label}</Badge>
            </span>
          }
          right={
            <span className="flex items-center gap-2">
              <span className="num hidden text-xs text-muted sm:inline">{ex.bars} свещи</span>
              <SourceBadge source={ex.source} />
            </span>
          }
        >
          <div className="space-y-3">
            {!ex.difficulty_matched && (
              <Notice tone="info">Няма прозорец точно за тази трудност в данните — показан е най-близкият с ясни swing точки.</Notice>
            )}
            <ol className="grid gap-1.5 text-sm sm:grid-cols-3">
              {ex.tasks_bg.map((t, i) => (
                <li key={i} className="flex gap-2 rounded-lg bg-white/[0.025] px-2.5 py-2 text-xs leading-relaxed text-muted">
                  <span className="num flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent/15 text-[11px] font-semibold text-accent2">{i + 1}</span>
                  <span className="min-w-0">{t}</span>
                </li>
              ))}
            </ol>

            <div className="flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Етикети">
              {SWING_LABELS.map((l, i) => (
                <ToolButton key={l} active={tool === l} onClick={() => setTool(l)} label={LABEL_META[l].title} hint={LABEL_META[l].hint} kbd={String(i + 1)}>
                  {l}
                </ToolButton>
              ))}
              <span className="mx-1 h-6 w-px bg-white/10" aria-hidden />
              {EVENT_LABELS.map((l, i) => (
                <ToolButton key={l} active={tool === l} onClick={() => setTool(l)} label={LABEL_META[l].title} hint={LABEL_META[l].hint} kbd={String(i + 5)} tone="info">
                  {LABEL_META[l].title}
                </ToolButton>
              ))}
              <span className="mx-1 h-6 w-px bg-white/10" aria-hidden />
              <ToolButton active={tool === "erase"} onClick={() => setTool("erase")} label="Гума" hint="Клик върху свещ изтрива етикетите ѝ" kbd="0">
                <Eraser size={14} aria-hidden />
              </ToolButton>
              <Button
                size="sm"
                variant="ghost"
                type="button"
                disabled={!w.history.length}
                onClick={() => update((cur) => (cur.history.length ? { ...cur, marks: cur.history[cur.history.length - 1], history: cur.history.slice(0, -1) } : cur))}
                aria-label="Отмени последното"
              >
                <Undo2 size={14} aria-hidden />
              </Button>
              <Button size="sm" variant="ghost" type="button" disabled={!w.marks.length} onClick={() => setMarks(() => [])} aria-label="Изчисти всички етикети">
                <Trash2 size={14} aria-hidden />
              </Button>
            </div>

            <StructureChart
              chartKey={ex.token}
              candles={ex.candles}
              precision={prec}
              timeframe={ex.timeframe}
              markers={markers}
              onPick={onPick}
              hint={toolHint}
            />

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-violet" aria-hidden /> REF — първите swing high / low (дадени, не се оценяват)
              </span>
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-2 rounded-full bg-accent2" aria-hidden /> твой етикет
              </span>
              {w.check && !stale && (
                <>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-up" aria-hidden /> ✓ CORRECT
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-down" aria-hidden /> ✗ INCORRECT
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-warn" aria-hidden /> NOT A SWING
                  </span>
                  <span className="inline-flex items-center gap-1">
                    <span className="h-2 w-2 rounded-full bg-muted/70" aria-hidden /> {w.showAnswer ? "отговор" : "пропуснат"}
                  </span>
                </>
              )}
            </div>

            {w.marks.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Поставени етикети">
                {w.marks.map((m) => (
                  <li key={`${m.time}-${m.label}`}>
                    <button
                      type="button"
                      onClick={() => setMarks((all) => removeMarks(all, m.time, m.label))}
                      className="inline-flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.03] px-2 py-0.5 text-[11px] text-text transition-colors hover:border-down/40 hover:text-down"
                      aria-label={`Изтрий ${m.label} при ${fmtPrice(m.price, prec)}`}
                    >
                      <span className="font-semibold">{LABEL_META[m.label].short}</span>
                      <span className="num text-muted">{fmtPrice(m.price, prec)}</span>
                      <span aria-hidden>×</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.06] pt-3">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-xs text-muted">
                  <Term k="trend">Структура</Term>:
                </span>
                <Segmented<StructureKind>
                  size="sm"
                  options={(["uptrend", "downtrend", "range"] as const).map((s) => ({ value: s, label: STRUCTURE_META[s].label }))}
                  value={(w.structure ?? "") as StructureKind}
                  onChange={(s) => update((cur) => ({ ...cur, structure: s }))}
                  ariaLabel="Каква е структурата"
                />
              </div>
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  disabled={busy}
                  onClick={() => (w.check && !stale ? update((cur) => ({ ...cur, showAnswer: !cur.showAnswer })) : runCheck(true))}
                  title={w.check ? undefined : "Проверява текущите етикети и показва отговора"}
                >
                  {w.showAnswer && w.check && !stale ? <EyeOff size={14} aria-hidden /> : <Eye size={14} aria-hidden />}
                  {w.showAnswer && w.check && !stale ? "Скрий отговора" : "Покажи отговора"}
                </Button>
                <Button size="sm" type="button" disabled={busy} onClick={() => runCheck(false)}>
                  <Send size={14} aria-hidden /> {busy ? "Проверка…" : w.check && !stale ? "Провери отново" : "Провери"}
                </Button>
              </div>
            </div>
            {!w.structure && w.marks.length > 0 && !w.check && (
              <p className="flex items-center gap-1.5 text-[11px] text-faint">
                <CircleHelp size={12} aria-hidden /> Избери и структура — тя носи 25% от резултата.
              </p>
            )}
            <ErrorText error={error} />
            {ex.hint && (
              <LearnHint title="Подсказка">
                {ex.hint} Свещите в първите и последните {ex.pivot.left} от прозореца не могат да бъдат потвърдени swing точки.
              </LearnHint>
            )}
          </div>
        </Card>

        {w.check ? (
          <StructureResults check={w.check} precision={prec} stale={stale} />
        ) : (
          <Disclaimer>{ex.disclaimer}</Disclaimer>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        icon={Waypoints}
        title="Market Structure Lab"
        subtitle="Маркирай swing high / low (HH, HL, LH, LL), определи структурата и намери breakout, retest и fakeout върху минали затворени свещи."
        actions={
          <>
            <Segmented<Difficulty>
              options={(["easy", "medium", "hard"] as const).map((d) => ({ value: d, label: DIFFICULTY_META[d].label, title: DIFFICULTY_META[d].hint }))}
              value={difficulty}
              onChange={(d) => {
                setDifficulty(d);
                setError(null);
              }}
              ariaLabel="Трудност"
            />
            <Button variant="outline" type="button" onClick={newExercise} disabled={isLoading}>
              <RefreshCw size={15} aria-hidden /> Ново упражнение
            </Button>
          </>
        }
      />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0">{main}</div>
        <aside className="min-w-0 space-y-4">
          <LearnHint title="Как се работи">
            Избери етикет (HH, HL, LH, LL) и кликни върху свещ — етикетът „прилепва“ към нейния High или Low. За Breakout / Retest / Fakeout кликни
            свещта, на която се случва. Кликни отново със същия етикет, за да го махнеш.
          </LearnHint>
          <StructureTheory rules={ex?.rules} />
          <StructureHistoryCard />
          <Link
            href="/replay"
            className="card flex items-center gap-3 p-3.5 text-sm text-muted transition-colors hover:border-white/[0.16] hover:text-text"
          >
            <ScanSearch size={16} className="shrink-0 text-accent2" aria-hidden />
            <span className="min-w-0">Упражнявай структурата и в Market Replay — свещ по свещ.</span>
          </Link>
        </aside>
      </div>
    </div>
  );
}
