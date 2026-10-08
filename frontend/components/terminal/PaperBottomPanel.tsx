"use client";

import { Activity, History, Layers, ListOrdered, Rewind } from "lucide-react";

import { LinkButton } from "@/components/market/LinkButton";
import { SessionInfo } from "@/components/terminal/SessionInfo";
import { termKey } from "@/components/terminal/model";
import type { BottomPanelConfig, PanelTab } from "@/components/terminal/TerminalLayout";
import { ActivityList } from "@/components/trading/ActivityList";
import { OrdersTable, PositionsTable, TradesTable, type TradeCapture } from "@/components/trading/Tables";
import { ErrorState, TableSkeleton, useStoredState } from "@/components/ui";
import { errorMessage } from "@/lib/api";
import { TF_LABEL } from "@/lib/format";
import { usePaperEvents } from "@/lib/hooks";
import type { AccountView, MarketSession, Trade } from "@/lib/types";

export const BOTTOM_TABS = ["positions", "orders", "history", "activity", "replay"] as const;
export type BottomTab = (typeof BOTTOM_TABS)[number];
const asTab = (v: unknown) => (typeof v === "string" && (BOTTOM_TABS as readonly string[]).includes(v) ? (v as BottomTab) : undefined);

/** Market Replay shortcut for the current instrument / timeframe. */
export function ReplayCard({ symbol, timeframe }: { symbol: string; timeframe: string }) {
  const href = `/replay?symbol=${encodeURIComponent(symbol)}&tf=${encodeURIComponent(timeframe)}`;
  return (
    <div className="flex flex-wrap items-center gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-text">Market Replay</div>
        <p className="text-xs leading-relaxed text-muted">
          Минали свещи една по една, бъдещето е скрито — решаваш LONG / SHORT / WAIT със stop и target, после AI преглед. Паричните
          резултати са виртуални.
        </p>
      </div>
      <LinkButton href={href} variant="primary" size="sm">
        <Rewind size={13} aria-hidden /> Replay {symbol} · {TF_LABEL[timeframe] ?? timeframe}
      </LinkButton>
    </div>
  );
}

/**
 * Bottom panel of the paper terminals: Positions | Orders | History | Activity | Replay (tab persisted
 * per route) + session info (market status, UTC clock, bar countdown).
 */
export function usePaperBottomPanel({
  route,
  view,
  viewError,
  trades,
  beginner,
  symbol,
  timeframe,
  marketStatus,
  onChanged,
  onSelectSymbol,
  capture,
}: {
  route: string;
  view?: AccountView | null;
  viewError?: unknown;
  trades?: Trade[] | null;
  beginner: boolean;
  symbol: string;
  timeframe: string;
  marketStatus?: MarketSession | null;
  /** refresh the account + trades after a change */
  onChanged: () => void;
  onSelectSymbol?: (symbol: string) => void;
  /** chart screenshot for "Journal this trade" */
  capture?: TradeCapture;
}): BottomPanelConfig {
  const [active, setActive] = useStoredState<BottomTab>(termKey(route, "bottom-tab"), "positions", { validate: asTab });
  const events = usePaperEvents(50, 15_000, active === "activity");

  const tabs: PanelTab[] = [
    { key: "positions", label: "Positions", icon: Layers, badge: view ? view.positions.length : undefined },
    { key: "orders", label: "Orders", icon: ListOrdered, badge: view ? view.orders.length : undefined },
    { key: "history", label: "History", icon: History, badge: trades ? trades.length : undefined },
    { key: "activity", label: "Activity", icon: Activity },
    { key: "replay", label: "Replay", icon: Rewind },
  ];

  const accountState = (body: (v: AccountView) => React.ReactNode) =>
    view ? body(view) : viewError ? <ErrorState description={errorMessage(viewError)} onRetry={onChanged} className="m-3 py-6" /> : <TableSkeleton rows={3} cols={8} className="p-3" />;

  const render = (tab: string) => {
    switch (tab as BottomTab) {
      case "positions":
        return accountState((v) => <PositionsTable positions={v.positions} onChanged={onChanged} beginner={beginner} onSelectSymbol={onSelectSymbol} />);
      case "orders":
        return accountState((v) => <OrdersTable orders={v.orders} onChanged={onChanged} onSelectSymbol={onSelectSymbol} />);
      case "history":
        return trades ? <TradesTable trades={trades} captureScreenshot={capture} onSelectSymbol={onSelectSymbol} /> : <TableSkeleton rows={3} cols={8} className="p-3" />;
      case "activity":
        return events.error ? (
          <ErrorState description={errorMessage(events.error)} onRetry={() => void events.mutate()} className="m-3 py-6" />
        ) : (
          <ActivityList events={events.data?.events} loading={events.isLoading} />
        );
      case "replay":
        return <ReplayCard symbol={symbol} timeframe={timeframe} />;
      default:
        return null;
    }
  };

  return {
    tabs,
    active,
    onActive: (k) => setActive(asTab(k) ?? "positions"),
    render,
    extra: <SessionInfo timeframe={timeframe} marketStatus={marketStatus} />,
  };
}
