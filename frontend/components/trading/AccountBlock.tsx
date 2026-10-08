import { Wallet } from "lucide-react";

import { PaperBadge, Skeleton, Term } from "@/components/ui";
import { cx, fmtMoney, pnlClass } from "@/lib/format";
import type { AccountView } from "@/lib/types";

/** Margin level as a percentage (equity / used margin), null when flat. */
export function marginLevelPct(view: Pick<AccountView, "margin_level" | "margin_level_pct">): number | null {
  if (view.margin_level_pct !== undefined && view.margin_level_pct !== null) return view.margin_level_pct;
  return view.margin_level !== null && view.margin_level !== undefined ? view.margin_level * 100 : null;
}

function Tile({ label, value, tone, title }: { label: React.ReactNode; value: React.ReactNode; tone?: string; title?: string }) {
  return (
    <div className="min-w-0 rounded-md bg-white/[0.025] px-2.5 py-1.5" title={title}>
      <div className="truncate text-[10.5px] font-medium uppercase leading-4 tracking-[0.05em] text-muted">{label}</div>
      <div className={cx("num truncate text-[13px] font-semibold leading-5", tone ?? "text-text")}>{value}</div>
    </div>
  );
}

/**
 * PAPER ACCOUNT block of the terminal: Balance, Equity, Available margin, Used margin, Unrealized P/L and
 * margin level (every label explains itself in Explain mode). All money is virtual (USD).
 */
export function AccountBlock({ view, advanced, className }: { view?: AccountView | null; advanced?: boolean; className?: string }) {
  const lvl = view ? marginLevelPct(view) : null;
  const stopOut = view?.stop_out_level !== undefined ? view.stop_out_level * 100 : 50;
  const lvlTone = lvl === null ? "text-muted" : lvl < stopOut * 2 ? "text-down" : lvl < stopOut * 4 ? "text-warn" : "text-text";
  return (
    <section aria-label="Paper account" className={cx("space-y-2", className)}>
      <div className="flex items-center gap-2">
        <Wallet size={14} className="text-accent2" aria-hidden />
        <h3 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-text">Paper account</h3>
        <PaperBadge compact className="ml-auto" />
      </div>
      {!view ? (
        <div className="grid grid-cols-2 gap-1.5" aria-busy>
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-[42px] rounded-md" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          <Tile label={<Term k="balance">Balance</Term>} value={fmtMoney(view.balance)} />
          <Tile label={<Term k="equity">Equity</Term>} value={fmtMoney(view.equity)} />
          <Tile label={<Term k="freemargin">Available margin</Term>} value={fmtMoney(view.available_margin ?? view.free_margin)} />
          <Tile label={<Term k="margin">Used margin</Term>} value={fmtMoney(view.used_margin)} />
          <Tile label={<Term k="unrealized">Unrealized P/L</Term>} value={fmtMoney(view.unrealized_pnl, true)} tone={pnlClass(view.unrealized_pnl)} />
          <Tile
            label={<Term k="marginlevel">Margin level</Term>}
            value={lvl === null ? "—" : `${lvl.toLocaleString("en-US", { maximumFractionDigits: 0 })}%`}
            tone={lvlTone}
            title={`Stop-out под ${stopOut.toFixed(0)}%`}
          />
          {advanced && (
            <>
              <Tile label={<Term k="realized">Realized P/L</Term>} value={fmtMoney(view.realized_pnl, true)} tone={pnlClass(view.realized_pnl)} />
              <Tile label={<Term k="exposure">Exposure</Term>} value={fmtMoney(view.exposure)} />
            </>
          )}
        </div>
      )}
    </section>
  );
}
