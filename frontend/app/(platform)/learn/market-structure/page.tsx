import type { Metadata } from "next";

import { StructureLab } from "@/components/labs/structure/StructureLab";

export const metadata: Metadata = {
  title: "Market Structure Lab — Trading Academy",
  description:
    "Маркирай HH / HL / LH / LL, определи структурата (uptrend / downtrend / range) и намери breakout, retest и fakeout върху минали затворени свещи — с обяснена проверка.",
};

export default function MarketStructureLabPage() {
  return <StructureLab />;
}
