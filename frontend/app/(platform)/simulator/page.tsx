import type { Metadata } from "next";

import { TradeSimulator } from "@/components/labs/simulator/TradeSimulator";

export const metadata: Metadata = {
  title: "Trade Simulator — Trading Academy",
  description:
    "What-if за една сделка без поръчка: размер, margin, R:R, P/L при stop и target, сценарии, ликвидация и разходи по спецификацията на инструмента.",
};

export default function SimulatorPage() {
  return <TradeSimulator />;
}
