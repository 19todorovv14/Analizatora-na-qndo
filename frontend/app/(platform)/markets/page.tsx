import type { Metadata } from "next";

import { MarketsExplorer } from "@/components/market/explorer/MarketsExplorer";

export const metadata: Metadata = {
  title: "Markets — Trading Academy",
  description: "Пазарен explorer: търсене, категории, топ движения, heatmap и пълен каталог с инструменти (данни само за четене).",
};

export default function MarketsPage() {
  return <MarketsExplorer />;
}
