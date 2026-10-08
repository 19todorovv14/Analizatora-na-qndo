import { Badge, Empty, type Tone } from "@/components/ui";
import { fmtTime } from "@/lib/format";
import type { PaperEvent } from "@/lib/types";

/** Badge tone of a paper account event type (stop / liquidation / reject → down, take profit → up). */
export function eventTone(type: string): Tone {
  const t = type.toLowerCase();
  if (t.includes("stop") || t.includes("liquid") || t.includes("reject") || t.includes("margin_call")) return "down";
  if (t.includes("take") || t.includes("target")) return "up";
  if (t.includes("fill") || t.includes("open")) return "info";
  return "neutral";
}

/** Account activity (GET /paper/events, newest first). */
export function ActivityList({ events, loading }: { events?: PaperEvent[] | null; loading?: boolean }) {
  if (!events?.length) return loading ? <p className="px-3 py-4 text-sm text-muted">Зареждане…</p> : <Empty>Още няма активност по сметката.</Empty>;
  return (
    <ul className="divide-y divide-white/[0.05] text-[12.5px]">
      {events.map((e) => (
        <li key={e.id} className="flex items-start gap-3 px-3 py-1.5">
          <span className="w-28 shrink-0 whitespace-nowrap pt-0.5 text-[11px] text-muted">{fmtTime(e.ts)}</span>
          <Badge tone={eventTone(e.type)} className="shrink-0">
            {e.type.replace(/_/g, " ")}
          </Badge>
          <span className="min-w-0 text-text/90">{e.message}</span>
        </li>
      ))}
    </ul>
  );
}
