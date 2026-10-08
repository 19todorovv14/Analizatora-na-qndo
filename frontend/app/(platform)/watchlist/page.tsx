import type { Metadata } from "next";

import { WatchlistPage } from "@/components/market/watchlist/WatchlistPage";

export const metadata: Metadata = {
  title: "Watchlist — Trading Academy",
  description: "Твоят watchlist: цена, промяна, обем, волатилност, тренд, режим и AI статус.",
};

export default function WatchlistRoute() {
  return <WatchlistPage />;
}
