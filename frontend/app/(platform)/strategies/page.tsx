"use client";

import { Blocks, Bot, Copy, FilePlus2, LayoutTemplate, Lock, Save, TestTubeDiagonal, Trash2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useRef, useState } from "react";
import useSWR from "swr";

import { SymbolPicker } from "@/components/charts/ChartControls";
import { emptyDefinition, normalizeDefinition, useBuilderMeta } from "@/components/strategy/meta";
import { SignalCheck } from "@/components/strategy/SignalCheck";
import { StrategyBuilder } from "@/components/strategy/StrategyBuilder";
import { StrategyList } from "@/components/strategy/StrategyList";
import { StrategySummary } from "@/components/strategy/StrategySummary";
import { TemplateGallery } from "@/components/strategy/TemplateGallery";
import { SETUP_DISCLAIMER, type DefinitionV2, type StrategyRow } from "@/components/strategy/types";
import {
  Badge,
  Button,
  Card,
  ErrorState,
  ErrorText,
  Field,
  Kbd,
  Modal,
  Notice,
  PageHeader,
  Section,
  Segmented,
  Skeleton,
  SkeletonText,
  Spinner,
} from "@/components/ui";
import { del, errorMessage, fetcher, post, put } from "@/lib/api";
import { TF_LABEL, TIMEFRAMES, cx } from "@/lib/format";
import { useHotkeys } from "@/lib/hotkeys";
import { useSession } from "@/lib/session";
import { LearnHint } from "@/lib/workspace";

type Draft = {
  id?: number;
  name: string;
  description: string;
  symbol: string;
  timeframe: string;
  definition: DefinitionV2;
  is_template?: boolean;
  template_key?: string | null;
};

function newDraft(): Draft {
  return { name: "Нова стратегия", description: "", symbol: "BTC/USDT", timeframe: "1h", definition: emptyDefinition() };
}

function fromRow(s: StrategyRow): Draft {
  return {
    id: s.id,
    name: s.name,
    description: s.description ?? "",
    symbol: s.symbol,
    timeframe: s.timeframe,
    definition: normalizeDefinition(s.definition),
    is_template: s.is_template,
    template_key: s.template_key ?? null,
  };
}

const snapshot = (d: Draft) => JSON.stringify([d.name, d.description, d.symbol, d.timeframe, d.definition]);

function PageSkeleton() {
  return (
    <div className="mx-auto max-w-[1680px] space-y-5" aria-busy="true">
      <div className="flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-xl" />
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-3 w-80" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[240px_minmax(0,1fr)_360px]">
        <div className="card hidden space-y-3 p-4 2xl:block">
          <SkeletonText lines={5} />
        </div>
        <div className="card space-y-4 p-4">
          <Skeleton className="h-9 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-28 w-full rounded-xl" />
        </div>
        <div className="card hidden space-y-3 p-4 xl:block">
          <SkeletonText lines={6} />
        </div>
      </div>
    </div>
  );
}

function StrategiesInner() {
  const router = useRouter();
  const params = useSearchParams();
  const qStrategy = Number(params.get("strategy")) || 0;
  const { beginner } = useSession();
  const { data, error: listError, mutate } = useSWR<{ strategies: StrategyRow[] }>("/strategies", fetcher);
  const { data: meta } = useBuilderMeta();

  const [draft, setDraft] = useState<Draft>(newDraft);
  const [saved, setSaved] = useState<string>(() => snapshot(newDraft()));
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [busy, setBusy] = useState<"save" | "delete" | "copy" | "test" | null>(null);
  const [copyId, setCopyId] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState<Draft | null>(null);
  const flashTimer = useRef<number | undefined>(undefined);

  const dirty = !draft.is_template && snapshot(draft) !== saved;

  // open ?strategy=ID (first visit: else the user's first strategy) whenever the query changes
  const [seenQ, setSeenQ] = useState<number | null>(null);
  if (data && seenQ !== qStrategy) {
    const initial = seenQ === null;
    setSeenQ(qStrategy);
    const target = qStrategy ? data.strategies.find((s) => s.id === qStrategy) : initial ? data.strategies.find((s) => !s.is_template) : undefined;
    if (target && target.id !== draft.id) {
      const d = fromRow(target);
      if (dirty) setPending(d);
      else {
        setDraft(d);
        setSaved(snapshot(d));
      }
    }
  }

  const note = (msg: string) => {
    setFlash(msg);
    window.clearTimeout(flashTimer.current);
    flashTimer.current = window.setTimeout(() => setFlash(null), 2600);
  };

  const load = (d: Draft) => {
    setDraft(d);
    setSaved(snapshot(d));
    setError(null);
    setConfirmDelete(false);
    router.replace(d.id ? `/strategies?strategy=${d.id}` : "/strategies", { scroll: false });
  };

  /** switch to another draft, asking first when there are unsaved edits */
  const open = (d: Draft) => {
    if (dirty) setPending(d);
    else load(d);
  };

  const save = async (): Promise<StrategyRow | null> => {
    if (draft.is_template) return null;
    setBusy("save");
    setError(null);
    const body = { name: draft.name.trim() || "Без име", description: draft.description, symbol: draft.symbol, timeframe: draft.timeframe, definition: draft.definition };
    try {
      const s = draft.id ? await put<StrategyRow>(`/strategies/${draft.id}`, body) : await post<StrategyRow>("/strategies", body);
      const d = fromRow(s);
      setDraft(d);
      setSaved(snapshot(d));
      router.replace(`/strategies?strategy=${s.id}`, { scroll: false });
      mutate();
      note("Запазено.");
      return s;
    } catch (e) {
      setError(errorMessage(e));
      return null;
    } finally {
      setBusy(null);
    }
  };

  const copy = async (id: number) => {
    setBusy("copy");
    setCopyId(id);
    setError(null);
    try {
      const s = await post<StrategyRow>(`/strategies/${id}/copy`);
      await mutate();
      load(fromRow(s));
      note("Копие създадено — вече можеш да редактираш.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      setCopyId(null);
    }
  };

  const remove = async () => {
    if (!draft.id || draft.is_template) return;
    setBusy("delete");
    try {
      await del(`/strategies/${draft.id}`);
      await mutate();
      load(newDraft());
      note("Стратегията е изтрита.");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(null);
      setConfirmDelete(false);
    }
  };

  /** Backtest / paper bot need a saved strategy: save first when needed, then navigate (prefilled). */
  const test = async (where: "backtesting" | "bots") => {
    let id = draft.id;
    if (!draft.is_template && (dirty || !id)) {
      setBusy("test");
      const s = await save();
      setBusy(null);
      if (!s) return;
      id = s.id;
    }
    if (!id) return;
    const q = new URLSearchParams({ strategy: String(id), symbol: draft.symbol, timeframe: draft.timeframe });
    router.push(`/${where}?${q.toString()}`);
  };

  useHotkeys({ "mod+s": () => void save() }, { allowInInputs: ["mod+s"], enabled: !draft.is_template });

  if (listError && !data) return <ErrorState title="Стратегиите не се заредиха" onRetry={() => mutate()} />;
  if (!data) return <PageSkeleton />;

  const mine = data.strategies.filter((s) => !s.is_template);
  const templates = data.strategies.filter((s) => s.is_template);
  const readOnly = !!draft.is_template;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const editorTitle = readOnly ? (
    <>
      <Lock size={14} strokeWidth={2} className="text-warn" aria-hidden />
      Шаблон · само за четене
    </>
  ) : draft.id ? (
    <>
      <Blocks size={15} strokeWidth={2} className="text-accent2" aria-hidden />
      Редактиране на стратегия
    </>
  ) : (
    <>
      <FilePlus2 size={15} strokeWidth={2} className="text-accent2" aria-hidden />
      Нова стратегия
    </>
  );

  return (
    <div className="mx-auto max-w-[1680px] space-y-5">
      <PageHeader
        title="Strategy Builder"
        icon={Blocks}
        subtitle="Визуални правила IF → AND → THEN. Резултатът е Potential LONG / SHORT Setup на затворена свещ — тествай го в backtest или с paper бот."
        badge={<Badge tone="accent">rule-based</Badge>}
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => document.getElementById("template-gallery")?.scrollIntoView({ behavior: "smooth", block: "start" })}
            >
              <LayoutTemplate size={15} strokeWidth={2} aria-hidden />
              Шаблони
            </Button>
            <Button onClick={() => open(newDraft())}>
              <FilePlus2 size={15} strokeWidth={2} aria-hidden />
              Нова стратегия
            </Button>
          </>
        }
      />

      {/* < xl: one column · xl: editor + right rail (list, summary, signal, tests) · 2xl: list | editor | rail */}
      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-[minmax(0,1fr)_340px] xl:grid-rows-[auto_1fr] 2xl:grid-cols-[240px_minmax(0,1fr)_360px] 2xl:grid-rows-none">
        <div className="min-w-0 xl:col-start-2 xl:row-start-1 2xl:col-start-1">
          <StrategyList strategies={mine} activeId={draft.id} dirty={dirty} onOpen={(s) => open(fromRow(s))} onNew={() => open(newDraft())} />
        </div>

        <Card
          className="min-w-0 xl:col-start-1 xl:row-span-2 xl:row-start-1 2xl:col-start-2 2xl:row-span-1"
          title={editorTitle}
          right={
            <div className="flex items-center gap-2">
              {flash && <span className="fade-in hidden text-xs text-up sm:inline">{flash}</span>}
              {dirty && (
                <Badge tone="warn" className="hidden sm:inline-flex">
                  незапазено
                </Badge>
              )}
              {draft.id && !readOnly && (
                <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)} disabled={!!busy} aria-label="Изтрий стратегията">
                  <Trash2 size={13} strokeWidth={2} aria-hidden />
                  <span className="hidden md:inline">Delete</span>
                </Button>
              )}
              {readOnly ? (
                <Button size="sm" onClick={() => draft.id && copy(draft.id)} disabled={!!busy}>
                  {busy === "copy" ? <Spinner className="h-3.5 w-3.5 border-white/30 border-t-white" /> : <Copy size={13} strokeWidth={2} aria-hidden />}
                  Copy & edit
                </Button>
              ) : (
                <Button size="sm" onClick={() => void save()} disabled={!!busy || (!dirty && !!draft.id)} title="Запази (Ctrl/⌘ + S)">
                  {busy === "save" ? <Spinner className="h-3.5 w-3.5 border-white/30 border-t-white" /> : <Save size={13} strokeWidth={2} aria-hidden />}
                  Save
                </Button>
              )}
            </div>
          }
        >
          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Име">
                <input className="input" value={draft.name} disabled={readOnly} maxLength={120} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="Описание / хипотеза">
                <input
                  className="input"
                  value={draft.description}
                  disabled={readOnly}
                  maxLength={2000}
                  onChange={(e) => set("description", e.target.value)}
                  placeholder="Защо мислиш, че това има предимство?"
                />
              </Field>
              <Field label="Asset">
                <SymbolPicker value={draft.symbol} onChange={(s) => set("symbol", s)} className="w-full" />
              </Field>
              <div className="min-w-0">
                <span className="label">Timeframe</span>
                <Segmented
                  fullWidth
                  className="[&>button]:px-1 sm:[&>button]:px-3"
                  ariaLabel="Timeframe"
                  value={draft.timeframe}
                  onChange={(tf) => set("timeframe", tf)}
                  options={TIMEFRAMES.map((tf) => ({ value: tf, label: TF_LABEL[tf] }))}
                />
              </div>
            </div>
            {readOnly && (
              <Notice tone="info" title="Образователен шаблон">
                Шаблоните не са представени като печеливши — те са отправна точка за учене. Натисни <b className="text-text">Copy & edit</b>, за да
                направиш своя версия. Asset и timeframe можеш да сменяш за проверка на сигнала и тестовете.
              </Notice>
            )}
            <ErrorText error={error} />
            <StrategyBuilder value={draft.definition} onChange={(d) => set("definition", d)} advanced={!beginner} beginner={beginner} readOnly={readOnly} />
          </div>
        </Card>

        <div className="grid min-w-0 grid-cols-1 gap-4 md:grid-cols-2 xl:col-start-2 xl:row-start-2 xl:grid-cols-1 2xl:col-start-3 2xl:row-start-1">
          <Card title="Plain-language summary" right={<Kbd>describe()</Kbd>}>
            <StrategySummary definition={draft.definition} beginner={beginner} />
          </Card>
          <div className="space-y-4">
            <Card title="Current signal">
              <SignalCheck key={draft.id ?? "new"} definition={draft.definition} symbol={draft.symbol} timeframe={draft.timeframe} />
              <LearnHint className="mt-3">
                Проверката оценява правилата на последната <b className="text-text">затворена</b> свещ — без да записва стратегията. Отметка ✓ =
                условието е изпълнено, ✕ = не е, — = индикаторът още няма достатъчно история.
              </LearnHint>
            </Card>
            <Card title="Тествай правилата">
              <div className="space-y-3">
                <p className="text-xs leading-relaxed text-muted">
                  {readOnly
                    ? "Шаблонът може да се тества директно."
                    : dirty || !draft.id
                      ? "Промените ще бъдат запазени преди теста."
                      : "Стратегията е запазена — тестът използва текущите правила."}
                </p>
                <div className="grid gap-2 sm:grid-cols-2 md:grid-cols-1">
                  <Button onClick={() => void test("backtesting")} disabled={!!busy}>
                    {busy === "test" ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : <TestTubeDiagonal size={15} strokeWidth={2} aria-hidden />}
                    Backtest →
                  </Button>
                  <Button variant="outline" onClick={() => void test("bots")} disabled={!!busy}>
                    <Bot size={15} strokeWidth={2} aria-hidden />
                    Create paper bot →
                  </Button>
                </div>
                <p className="text-[11px] leading-relaxed text-faint">
                  Стратегията генерира само SETUP (LONG / SHORT / NO TRADE) и НЕ търгува реални пари. {SETUP_DISCLAIMER}
                </p>
              </div>
            </Card>
          </div>
        </div>
      </div>

      <div id="template-gallery" className="scroll-mt-4">
        <Section
          title={
            <>
              <LayoutTemplate size={13} strokeWidth={2} aria-hidden /> Template gallery
            </>
          }
          right={<span className="text-[11px] text-faint">{templates.length} образователни шаблона · не са препоръки</span>}
        >
          <TemplateGallery
            templates={templates}
            meta={meta?.templates}
            activeId={readOnly ? draft.id : undefined}
            onView={(t) => {
              open(fromRow(t));
              window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            onCopy={(t) => copy(t.id)}
            busyId={copyId}
          />
        </Section>
      </div>

      <Modal open={confirmDelete} onClose={() => setConfirmDelete(false)} title="Изтриване на стратегия">
        <p className="text-sm text-muted">
          Да изтрия ли <b className="text-text">{draft.name}</b>? Backtest резултатите остават, но стратегията не може да бъде възстановена.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
            Отказ
          </Button>
          <Button variant="down" onClick={remove} disabled={busy === "delete"}>
            {busy === "delete" ? <Spinner className="h-4 w-4 border-white/30 border-t-white" /> : <Trash2 size={14} strokeWidth={2} aria-hidden />}
            Изтрий
          </Button>
        </div>
      </Modal>

      <Modal open={!!pending} onClose={() => setPending(null)} title="Незапазени промени">
        <p className="text-sm text-muted">Имаш незапазени промени в „{draft.name}“. Да ги запазя ли, преди да отворя друга стратегия?</p>
        <div className={cx("mt-4 flex flex-wrap justify-end gap-2")}>
          <Button variant="ghost" onClick={() => setPending(null)}>
            Отказ
          </Button>
          <Button
            variant="outline"
            onClick={() => {
              const p = pending;
              setPending(null);
              if (p) load(p);
            }}
          >
            Отхвърли промените
          </Button>
          <Button
            onClick={async () => {
              const p = pending;
              setPending(null);
              const s = await save();
              if (s && p) load(p);
            }}
          >
            <Save size={14} strokeWidth={2} aria-hidden />
            Запази и продължи
          </Button>
        </div>
      </Modal>
    </div>
  );
}

export default function StrategiesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <StrategiesInner />
    </Suspense>
  );
}
