"use client";

import { Bot, SendHorizontal } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { AiText, Badge, Button, Spinner } from "@/components/ui";
import { errorMessage, post } from "@/lib/api";
import { cx } from "@/lib/format";

type Msg = { role: "user" | "assistant"; content: string; provider?: string };

const SUGGESTIONS = [
  "Какво е RSI?",
  "Защо тази свещ е bearish?",
  "Какво означава breakout?",
  "Какво виждаш на графиката сега?",
  "Защо загубих този trade?",
  "Какво направих грешно?",
];
const COMPACT_SUGGESTIONS = ["Какво виждаш на графиката сега?", "Какво е RSI?", "Защо загубих този trade?"];

export type ChatPanelProps = {
  symbol?: string;
  timeframe?: string;
  /** asked once on mount (e.g. /ai?q=…) */
  initialQuestion?: string | null;
  /** shorter history + 3 suggestions, for terminal side panels */
  compact?: boolean;
  /**
   * the message list grows to fill the panel's height instead of a fixed max height (give the panel —
   * or `className` — a height / flex-1); used by AIPanel's Ask tab
   */
  fill?: boolean;
  className?: string;
};

/** Free-form chat with the AI Teacher (POST /ai/chat). Optional chart context of the current symbol/timeframe. */
export function ChatPanel({ symbol, timeframe, initialQuestion, compact, fill, className }: ChatPanelProps) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Здравей! Аз съм AI Teacher. Питай ме за термин, за текущата графика или за последната си paper сделка. Обяснявам разсъжденията — не давам сигнали 'купи сега'.",
    },
  ]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [useChart, setUseChart] = useState(true);
  const scroller = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  useEffect(() => {
    // keep the newest message in view without scrolling the whole page
    const el = scroller.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || busy) return;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setBusy(true);
    try {
      const r = await post<{ session_id: number; answer: string; provider: string }>("/ai/chat", {
        message: q,
        session_id: sessionId,
        ...(useChart && symbol ? { symbol, timeframe } : {}),
      });
      setSessionId(r.session_id);
      setMessages((m) => [...m, { role: "assistant", content: r.answer, provider: r.provider }]);
    } catch (e) {
      setMessages((m) => [...m, { role: "assistant", content: `Грешка: ${errorMessage(e)}` }]);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (initialQuestion && !asked.current) {
      asked.current = true;
      send(initialQuestion);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuestion]);

  return (
    <div className={cx("flex h-full min-w-0 flex-col", className)}>
      <label className="mb-2 flex cursor-pointer items-center gap-2 text-xs text-muted">
        <input type="checkbox" className="accent-accent" checked={useChart} onChange={(e) => setUseChart(e.target.checked)} />
        <span className="min-w-0">
          Използвай текущата графика{symbol ? ` (${symbol} ${timeframe?.toUpperCase() ?? ""})` : ""}
        </span>
      </label>
      <div
        ref={scroller}
        aria-live="polite"
        className={cx("flex-1 space-y-2.5 overflow-y-auto rounded-xl border border-white/[0.07] bg-black/20 p-3", compact ? "min-h-40" : "min-h-48")}
        style={fill ? undefined : { maxHeight: compact ? 340 : 520 }}
      >
        {messages.map((m, i) => (
          <div key={i} className={cx("flex gap-2", m.role === "user" && "justify-end")}>
            {m.role === "assistant" && (
              <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-accent/15 text-accent2 ring-1 ring-inset ring-accent/30">
                <Bot size={13} strokeWidth={1.9} aria-hidden />
              </span>
            )}
            <div
              className={cx(
                "min-w-0 max-w-[88%] rounded-xl px-3 py-2",
                m.role === "user" ? "bg-accent/20 text-sm text-text ring-1 ring-inset ring-accent/25" : "bg-white/[0.04] ring-1 ring-inset ring-white/[0.06]",
              )}
            >
              {m.role === "assistant" ? <AiText text={m.content} /> : <span className="break-words">{m.content}</span>}
              {m.provider && (
                <div className="mt-1 text-right">
                  <Badge tone={m.provider === "offline" ? "neutral" : "violet"}>{m.provider}</Badge>
                </div>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 pl-8 text-sm text-muted">
            <Spinner /> AI Teacher мисли…
          </div>
        )}
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {(compact ? COMPACT_SUGGESTIONS : SUGGESTIONS).map((s) => (
          <button
            key={s}
            type="button"
            disabled={busy}
            onClick={() => send(s)}
            className="rounded-full border border-white/10 bg-white/[0.02] px-2.5 py-1 text-xs text-muted transition-colors hover:border-accent/50 hover:text-text disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>
      <form
        className="mt-2 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
      >
        <input
          className="input min-w-0 flex-1"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the AI Teacher…"
          aria-label="Въпрос към AI Teacher"
          maxLength={2000}
        />
        <Button disabled={busy || !input.trim()}>
          <SendHorizontal size={14} aria-hidden />
          Send
        </Button>
      </form>
    </div>
  );
}
