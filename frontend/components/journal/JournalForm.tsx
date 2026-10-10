"use client";

/*
 * Journal entry form (create / edit). Used on /journal and in the paper terminal's "Journal this trade"
 * modal (components/trading/Tables). Linking a closed paper trade pre-fills symbol, side, entry, stop,
 * target, exit, risk, setup and timeframe; the backend then owns result + R from that trade.
 * Anchors kept: the first <textarea> is "Reason"; the submit button reads "Добави в журнала".
 */
import { ImagePlus, Link2, TriangleAlert, X } from "lucide-react";
import { useMemo, useState } from "react";
import useSWR from "swr";

import { journalBody, parseNum, plannedRR, stopValid, type JournalEntry } from "@/components/journal/model";
import { Button, ErrorText, Field, Segmented } from "@/components/ui";
import { errorMessage, fetcher, post, put } from "@/lib/api";
import { cx, fmtMoney, fmtTime } from "@/lib/format";
import type { Trade } from "@/lib/types";

export type { JournalEntry } from "@/components/journal/model";

export const EMOTIONS = ["calm", "confident", "FOMO", "fear", "greed", "anger", "bored", "hopeful", "frustrated"];
export const MISTAKES = [
  "no stop loss",
  "position too large",
  "entered before confirmation",
  "chased the entry",
  "moved stop further away",
  "exited too early",
  "revenge trade",
  "traded against the trend",
  "overtrading",
];

type NumKey = "entry" | "stop" | "target" | "exit_price" | "risk_amount" | "result";
const NUM_KEYS: NumKey[] = ["entry", "stop", "target", "exit_price", "risk_amount", "result"];

async function fileToDataUrl(file: File, maxW = 1280): Promise<string> {
  const img = document.createElement("img");
  const url = URL.createObjectURL(file);
  await new Promise((res, rej) => {
    img.onload = res;
    img.onerror = rej;
    img.src = url;
  });
  const scale = Math.min(1, maxW / img.width);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
  URL.revokeObjectURL(url);
  return canvas.toDataURL("image/jpeg", 0.85);
}

const str = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? "" : String(v));
const meta = (t: Trade, k: string) => {
  const v = t.meta?.[k];
  return typeof v === "string" ? v : "";
};

/** Prefill from a closed paper trade (typed values win only where the user already filled them). */
function fromTrade(e: JournalEntry, t: Trade): JournalEntry {
  return {
    ...e,
    trade_id: t.id,
    symbol: t.symbol,
    side: t.side,
    entry: e.entry ?? t.entry_price,
    stop: e.stop ?? t.stop_price,
    target: e.target ?? t.target_price,
    exit_price: e.exit_price ?? t.exit_price,
    risk_amount: e.risk_amount ?? t.risk_amount,
    setup: e.setup || meta(t, "setup"),
    timeframe: e.timeframe || meta(t, "timeframe") || null,
    strategy: e.strategy || meta(t, "strategy") || null,
    result: t.net_pnl,
    r_multiple: t.r_multiple,
  };
}

export function JournalForm({ initial, onSaved }: { initial?: JournalEntry; onSaved?: (entry?: JournalEntry) => void }) {
  const [e, setE] = useState<JournalEntry>({
    setup: "",
    reason: "",
    emotion: "calm",
    confidence: 3,
    lesson: "",
    tags: [],
    mistakes: [],
    ...initial,
  });
  const [raw, setRaw] = useState<Record<NumKey, string>>(() => Object.fromEntries(NUM_KEYS.map((k) => [k, str(initial?.[k])])) as Record<NumKey, string>);
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: trades } = useSWR<{ trades: Trade[] }>("/paper/trades?limit=50", fetcher);

  // opened from a trade ("Journal this trade"): show that trade's numbers once the list has loaded
  const [prefilled, setPrefilled] = useState(false);
  if (!prefilled && trades && e.trade_id && !e.id) {
    setPrefilled(true);
    const t = trades.trades.find((x) => x.id === e.trade_id || x.position_id === e.trade_id);
    if (t) {
      const next = fromTrade(e, t);
      setE(next);
      setRaw(Object.fromEntries(NUM_KEYS.map((k) => [k, str(next[k])])) as Record<NumKey, string>);
    }
  }

  const set = <K extends keyof JournalEntry>(k: K, v: JournalEntry[K]) => setE((x) => ({ ...x, [k]: v }));
  const setNum = (k: NumKey, v: string) => {
    setRaw((r) => ({ ...r, [k]: v }));
    const n = parseNum(v);
    set(k, n === null || Number.isNaN(n) ? null : n);
  };
  const badNums = NUM_KEYS.filter((k) => {
    const n = parseNum(raw[k]);
    return n !== null && (!Number.isFinite(n) || (k !== "result" && n < 0));
  });
  const linked = !!e.trade_id;
  const rr = plannedRR(e);
  const stopOk = stopValid(e);
  const tradeOptions = useMemo(() => {
    const list = trades?.trades ?? [];
    // keep the linked trade selectable even when it is older than the last 50
    if (e.trade_id && !list.some((t) => t.id === e.trade_id)) return [{ id: e.trade_id, label: `${e.symbol ?? ""} · ${e.trade_id}` }];
    return list.map((t) => ({ id: t.id, label: `${fmtTime(t.closed_ts)} ${t.symbol} ${t.side} ${fmtMoney(t.net_pnl, true)}` }));
  }, [trades, e.trade_id, e.symbol]);

  const linkTrade = (id: string) => {
    if (!id) {
      set("trade_id", null);
      return;
    }
    const t = trades?.trades.find((x) => x.id === id);
    if (!t) {
      set("trade_id", id);
      return;
    }
    const next = fromTrade(e, t);
    setE(next);
    setRaw(Object.fromEntries(NUM_KEYS.map((k) => [k, str(next[k])])) as Record<NumKey, string>);
  };

  const save = async () => {
    if (badNums.length) {
      setError("Провери числовите полета — само положителни числа (резултатът може да е отрицателен).");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = journalBody(e, tags);
      const saved = e.id ? await put<JournalEntry>(`/journal/${e.id}`, body) : await post<JournalEntry>("/journal", body);
      onSaved?.(saved);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const numField = (k: NumKey, label: string, opts: { disabled?: boolean; placeholder?: string; hint?: string } = {}) => (
    <Field label={label} hint={opts.hint}>
      <input
        className={cx("input num", badNums.includes(k) && "!border-down/60", opts.disabled && "opacity-60")}
        inputMode="decimal"
        value={raw[k]}
        disabled={opts.disabled}
        placeholder={opts.placeholder}
        aria-invalid={badNums.includes(k) || undefined}
        onChange={(ev) => setNum(k, ev.target.value)}
      />
    </Field>
  );

  return (
    <div className="space-y-3.5 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Linked trade" hint="Свържи затворена paper сделка — входът, изходът, рискът и резултатът се попълват от нея.">
          <select className="input" value={e.trade_id ?? ""} onChange={(ev) => linkTrade(ev.target.value)}>
            <option value="">— без връзка —</option>
            {tradeOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Symbol">
          <input className="input" value={e.symbol ?? ""} onChange={(ev) => set("symbol", ev.target.value.toUpperCase())} placeholder="BTC/USDT" />
        </Field>
        <div className="min-w-0">
          <span className="label">Side</span>
          <Segmented
            options={[
              { value: "long", label: "Long" },
              { value: "short", label: "Short" },
            ]}
            value={(e.side as "long" | "short") ?? ("" as "long")}
            onChange={(v) => set("side", e.side === v ? null : v)}
            fullWidth
            ariaLabel="Посока"
          />
        </div>
      </div>
      {linked && (
        <p className="flex items-center gap-1.5 text-xs text-muted">
          <Link2 size={13} strokeWidth={2.25} className="text-accent2" aria-hidden /> Свързана със сделка — резултатът и R идват от нея.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Strategy">
          <input className="input" value={e.strategy ?? ""} onChange={(ev) => set("strategy", ev.target.value)} placeholder="EMA pullback…" />
        </Field>
        <Field label="Setup">
          <input className="input" value={e.setup ?? ""} onChange={(ev) => set("setup", ev.target.value)} placeholder="breakout, pullback…" />
        </Field>
        <Field label="Timeframe">
          <input className="input" value={e.timeframe ?? ""} onChange={(ev) => set("timeframe", ev.target.value)} placeholder="1h" />
        </Field>
      </div>

      <Field label="Reason (защо влезе?)">
        <textarea className="input min-h-20" value={e.reason ?? ""} onChange={(ev) => set("reason", ev.target.value)} placeholder="Кое условие от плана беше изпълнено?" />
      </Field>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {numField("entry", "Entry")}
        {numField("stop", "Stop")}
        {numField("target", "Target")}
        {numField("exit_price", "Exit")}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {numField("risk_amount", "Risk ($)", { hint: "Колко щеше да загубиш, ако стопът беше ударен." })}
        {numField("result", "Result ($)", linked ? { disabled: true, placeholder: "от сделката" } : { placeholder: "+/- P/L" })}
        <div className="min-w-0">
          <span className="label">Planned R:R</span>
          <div className="flex min-h-9 items-center rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 text-sm">
            {rr !== null ? <span className="num">1 : {rr.toFixed(2)}</span> : <span className="text-faint">—</span>}
          </div>
        </div>
      </div>
      {stopOk === false && (
        <p className="flex items-center gap-1.5 text-xs text-warn">
          <TriangleAlert size={13} strokeWidth={2.25} aria-hidden /> Стопът е от грешната страна на входа за {e.side} позиция.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Emotion">
          <select className="input" value={e.emotion ?? ""} onChange={(ev) => set("emotion", ev.target.value)}>
            {EMOTIONS.map((x) => (
              <option key={x}>{x}</option>
            ))}
          </select>
        </Field>
        <Field label={`Confidence: ${e.confidence ?? "—"}/5`}>
          <input type="range" min={1} max={5} value={e.confidence ?? 3} onChange={(ev) => set("confidence", Number(ev.target.value))} className="w-full" />
        </Field>
      </div>

      <div>
        <span className="label">Mistakes</span>
        <div className="flex flex-wrap gap-1.5">
          {MISTAKES.map((m) => {
            const on = e.mistakes?.includes(m);
            return (
              <button
                key={m}
                type="button"
                aria-pressed={on}
                onClick={() => set("mistakes", on ? (e.mistakes ?? []).filter((x) => x !== m) : [...(e.mistakes ?? []), m])}
                className={cx(
                  "rounded-full border px-2.5 py-0.5 text-xs transition-colors",
                  on ? "border-down/50 bg-down/15 text-down" : "border-white/10 text-muted hover:border-white/20 hover:text-text",
                )}
              >
                {m}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Lesson (какво научи?)">
          <textarea className="input min-h-16" value={e.lesson ?? ""} onChange={(ev) => set("lesson", ev.target.value)} />
        </Field>
        <Field label="Notes">
          <textarea className="input min-h-16" value={e.notes ?? ""} onChange={(ev) => set("notes", ev.target.value)} placeholder="Управление, изход, контекст…" />
        </Field>
      </div>
      <Field label="Tags (разделени със запетая)">
        <input className="input" value={tags} onChange={(ev) => setTags(ev.target.value)} />
      </Field>

      <div>
        <span className="label">Screenshot</span>
        <div className="flex flex-wrap items-center gap-3">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-medium text-text transition-colors hover:border-white/20 hover:bg-white/[0.07]">
            <ImagePlus size={14} strokeWidth={2} aria-hidden /> Избери изображение
            <input
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={async (ev) => {
                const f = ev.target.files?.[0];
                if (f) set("screenshot", await fileToDataUrl(f));
              }}
            />
          </label>
          {typeof e.screenshot === "string" && e.screenshot && (
            <span className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- local data URL preview */}
              <img src={e.screenshot} alt="Screenshot на сделката" className="h-16 rounded-md border border-white/10" />
              <button
                type="button"
                onClick={() => set("screenshot", "")}
                className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full border border-white/15 bg-surface2 text-muted hover:text-down"
                aria-label="Премахни screenshot"
              >
                <X size={11} strokeWidth={2.5} aria-hidden />
              </button>
            </span>
          )}
        </div>
      </div>

      <ErrorText error={error} />
      <Button onClick={save} disabled={busy}>
        {e.id ? "Запази промените" : "Добави в журнала"}
      </Button>
    </div>
  );
}
