"use client";

import { Clock } from "lucide-react";

import { MarketStatusDot } from "@/components/market/MarketStatusDot";
import { barCloseIn, fmtCountdown, fmtUtcClock } from "@/components/terminal/model";
import { TF_LABEL } from "@/lib/format";
import { useNow } from "@/lib/hooks";
import type { MarketSession } from "@/lib/types";

/** Bottom-bar time info: market session, UTC clock and the countdown to the close of the current bar. */
export function SessionInfo({ timeframe, marketStatus }: { timeframe: string; marketStatus?: MarketSession | null }) {
  const now = useNow(1000);
  const left = now ? barCloseIn(now, timeframe) : null;
  return (
    <div className="num hidden items-center gap-3 whitespace-nowrap text-[11px] text-muted md:flex">
      {marketStatus && <MarketStatusDot status={marketStatus} showLabel />}
      <span className="hidden items-center gap-1 2xl:flex" title="Време (UTC)">
        <Clock size={12} className="text-faint" aria-hidden />
        {fmtUtcClock(now)}
      </span>
      <span title={`До затварянето на текущата ${TF_LABEL[timeframe] ?? timeframe} свещ`}>
        {TF_LABEL[timeframe] ?? timeframe} close <span className="text-text">{fmtCountdown(left)}</span>
      </span>
    </div>
  );
}
