"use client";

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

export function ChatPanel({ symbol, timeframe, initialQuestion }: { symbol?: string; timeframe?: string; initialQuestion?: string | null }) {
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
  const bottom = useRef<HTMLDivElement>(null);
  const asked = useRef(false);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [messages]);

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
    <div className="flex h-full flex-col">
      <div className="mb-2 flex items-center gap-2 text-xs text-muted">
        <label className="flex items-center gap-1">
          <input type="checkbox" checked={useChart} onChange={(e) => setUseChart(e.target.checked)} />
          Използвай текущата графика ({symbol} {timeframe?.toUpperCase()})
        </label>
      </div>
      <div className="min-h-64 flex-1 space-y-3 overflow-y-auto rounded-md border border-line bg-panel2 p-3" style={{ maxHeight: 560 }}>
        {messages.map((m, i) => (
          <div key={i} className={cx("max-w-[92%] rounded-lg px-3 py-2", m.role === "user" ? "ml-auto bg-accent/20" : "bg-panel3")}>
            {m.role === "assistant" ? <AiText text={m.content} /> : <span className="text-sm">{m.content}</span>}
            {m.provider && (
              <div className="mt-1 text-right">
                <Badge>{m.provider}</Badge>
              </div>
            )}
          </div>
        ))}
        {busy && (
          <div className="flex items-center gap-2 text-sm text-muted">
            <Spinner /> AI Teacher мисли…
          </div>
        )}
        <div ref={bottom} />
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button key={s} onClick={() => send(s)} className="rounded-full border border-line px-2.5 py-1 text-xs text-muted hover:border-accent hover:text-text">
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
        <input className="input" value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask the AI Teacher…" />
        <Button disabled={busy || !input.trim()}>Send</Button>
      </form>
    </div>
  );
}
