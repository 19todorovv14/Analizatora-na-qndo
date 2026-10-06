"use client";

import { useState } from "react";
import useSWR from "swr";

import { Button, ErrorText, Field } from "@/components/ui";
import { errorMessage, fetcher, post, put } from "@/lib/api";
import { fmtMoney, fmtTime } from "@/lib/format";
import type { Trade } from "@/lib/types";

export type JournalEntry = {
  id?: number;
  trade_id?: string | null;
  symbol?: string | null;
  timeframe?: string | null;
  side?: string | null;
  setup?: string;
  reason?: string;
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  emotion?: string;
  confidence?: number | null;
  result?: number | null;
  r_multiple?: number | null;
  lesson?: string;
  tags?: string[];
  mistakes?: string[];
  screenshot?: string | null | boolean;
  created_ts?: number;
};

const EMOTIONS = ["calm", "confident", "FOMO", "fear", "greed", "anger", "bored", "hopeful", "frustrated"];
const MISTAKES = [
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

export function JournalForm({ initial, onSaved }: { initial?: JournalEntry; onSaved?: () => void }) {
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
  const [tags, setTags] = useState((initial?.tags ?? []).join(", "));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: trades } = useSWR<{ trades: Trade[] }>("/paper/trades?limit=50", fetcher);

  const set = <K extends keyof JournalEntry>(k: K, v: JournalEntry[K]) => setE((x) => ({ ...x, [k]: v }));
  const num = (v: string) => (v === "" ? null : Number(v));

  const save = async () => {
    setBusy(true);
    setError(null);
    const body = {
      ...e,
      tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
      screenshot: typeof e.screenshot === "string" ? e.screenshot : undefined,
      side: e.side || null,
      id: undefined,
      created_ts: undefined,
      r_multiple: undefined,
    };
    try {
      if (e.id) await put(`/journal/${e.id}`, body);
      else await post("/journal", body);
      onSaved?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Linked trade">
          <select className="input" value={e.trade_id ?? ""} onChange={(ev) => set("trade_id", ev.target.value || null)}>
            <option value="">— без връзка —</option>
            {(trades?.trades ?? []).map((t) => (
              <option key={t.id} value={t.id}>
                {fmtTime(t.closed_ts)} {t.symbol} {t.side} {fmtMoney(t.net_pnl, true)}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Setup">
          <input className="input" value={e.setup ?? ""} onChange={(ev) => set("setup", ev.target.value)} placeholder="breakout, pullback…" />
        </Field>
        <Field label="Timeframe">
          <input className="input" value={e.timeframe ?? ""} onChange={(ev) => set("timeframe", ev.target.value)} placeholder="1h" />
        </Field>
      </div>
      <Field label="Reason (защо влезе?)">
        <textarea className="input min-h-20" value={e.reason ?? ""} onChange={(ev) => set("reason", ev.target.value)} />
      </Field>
      <div className="grid gap-3 sm:grid-cols-4">
        <Field label="Entry">
          <input className="input num" value={e.entry ?? ""} onChange={(ev) => set("entry", num(ev.target.value))} />
        </Field>
        <Field label="Stop">
          <input className="input num" value={e.stop ?? ""} onChange={(ev) => set("stop", num(ev.target.value))} />
        </Field>
        <Field label="Target">
          <input className="input num" value={e.target ?? ""} onChange={(ev) => set("target", num(ev.target.value))} />
        </Field>
        <Field label="Result ($)">
          <input className="input num" value={e.result ?? ""} onChange={(ev) => set("result", num(ev.target.value))} placeholder="от сделката" />
        </Field>
      </div>
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
      <Field label="Mistakes">
        <div className="flex flex-wrap gap-1.5">
          {MISTAKES.map((m) => {
            const on = e.mistakes?.includes(m);
            return (
              <button
                key={m}
                type="button"
                onClick={() => set("mistakes", on ? e.mistakes!.filter((x) => x !== m) : [...(e.mistakes ?? []), m])}
                className={`rounded-full border px-2 py-0.5 text-xs ${on ? "border-down bg-down/15 text-down" : "border-line text-muted"}`}
              >
                {m}
              </button>
            );
          })}
        </div>
      </Field>
      <Field label="Lesson (какво научи?)">
        <textarea className="input min-h-16" value={e.lesson ?? ""} onChange={(ev) => set("lesson", ev.target.value)} />
      </Field>
      <Field label="Tags (разделени със запетая)">
        <input className="input" value={tags} onChange={(ev) => setTags(ev.target.value)} />
      </Field>
      <Field label="Screenshot">
        <div className="flex items-center gap-3">
          <input
            type="file"
            accept="image/*"
            className="text-xs"
            onChange={async (ev) => {
              const f = ev.target.files?.[0];
              if (f) set("screenshot", await fileToDataUrl(f));
            }}
          />
          {typeof e.screenshot === "string" && e.screenshot && (
            // eslint-disable-next-line @next/next/no-img-element -- local data URL preview
            <img src={e.screenshot} alt="screenshot" className="h-16 rounded border border-line" />
          )}
        </div>
      </Field>
      <ErrorText error={error} />
      <Button onClick={save} disabled={busy}>
        {e.id ? "Запази промените" : "Добави в журнала"}
      </Button>
    </div>
  );
}
