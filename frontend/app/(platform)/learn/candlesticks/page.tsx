import type { Metadata } from "next";

import { CandlestickLab } from "@/components/labs/candlesticks/CandlestickLab";

export const metadata: Metadata = {
  title: "Candlestick Lab — Trading Academy",
  description: "Свещни модели с правила, контекст, интерактивна свещ, примери от реални графики и практика (моделът не е сигнал сам по себе си).",
};

export default function CandlesticksLabPage() {
  return <CandlestickLab />;
}
