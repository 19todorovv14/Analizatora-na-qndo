import type { Metadata } from "next";

import { LeverageLab } from "@/components/labs/leverage/LeverageLab";

export const metadata: Metadata = {
  title: "Leverage Academy — Trading Academy",
  description:
    "Leverage, margin, ликвидация и maintenance margin с работещ симулатор и виртуална сметка от $10,000. Higher leverage magnifies exposure and liquidation risk.",
};

export default function LeverageLabPage() {
  return <LeverageLab />;
}
